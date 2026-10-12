// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Vm } from "forge-std/src/Vm.sol";
import { Panorama } from "../src/Panorama.sol";
import { PanoramaMintController } from "../src/PanoramaMintController.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";

/// @dev Bounded actor that drives random-but-valid placeBid/increaseBid calls at the auction, plus
///      permissionless settlement/emergency actions so the invariants are checked through the whole
///      lifecycle (bidding -> finalize -> settled, and bidding -> stuck -> emergency refund).
contract AuctionHandler {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    PanoramaSeason3Auction public auction;
    PanoramaSeason3SignalController public signals;
    address[] public actors;

    /// @dev Expected signal per bid id (keccak of the text, zero for empty), from placeBid and setBidSignal.
    mapping(uint32 => bytes32) public ghostSignalHash;
    /// @dev setBidSignal calls accepted from someone other than the live bid's bidder. Must stay zero.
    uint256 public ghostForeignSignalWrites;
    /// @dev Bid signals accepted over an existing one, or empty. Must stay zero (write-once).
    uint256 public ghostSignalOverwrites;
    /// @dev setBidSignal calls accepted (shows the campaign exercises adding signals later).
    uint256 public ghostSignalReplacements;

    /// @dev Bids accepted with a signal over MAX_SIGNAL_BYTES. Must stay zero.
    uint256 public ghostOversizedSignalsAccepted;
    /// @dev Bids accepted with a non-empty signal (shows the campaign exercises signals).
    uint256 public ghostSignalledBids;
    /// @dev Every amount a bid was ever placed at or raised to, for the bidsAtAmount invariant.
    uint96[] public ghostAmounts;
    /// @dev Id of the last bid placed while the auction still had open slots.
    uint32 public fillBidId;
    mapping(uint96 => bool) internal _seenAmount;

    function ghostAmountCount() external view returns (uint256) {
        return ghostAmounts.length;
    }

    function _recordAmount(uint256 amount) internal {
        uint96 a = uint96(amount);
        if (!_seenAmount[a]) {
            _seenAmount[a] = true;
            ghostAmounts.push(a);
        }
    }

    constructor(PanoramaSeason3Auction a, address[] memory actors_) {
        auction = a;
        signals = PanoramaSeason3SignalController(address(a.signalController()));
        actors = actors_;
    }

    function _hash(string memory signal) internal pure returns (bytes32) {
        return bytes(signal).length == 0 ? bytes32(0) : keccak256(bytes(signal));
    }

    /// @dev Add a signal to a bid later. The caller is usually the bid's own bidder, sometimes another
    ///      actor (which must be rejected); the bid may be live or long gone, and may already have a
    ///      signal (which must never be overwritten).
    function setBidSignal(uint256 actorSeed, uint256 idSeed, uint256 signalSeed) external {
        uint32 next = auction.nextBidId();
        if (next == 1) return;
        uint32 id = uint32(1 + (idSeed % (next - 1)));
        (address bidder,) = auction.bids(id);
        address caller = (actorSeed % 4 != 0 && bidder != address(0)) ? bidder : actors[actorSeed % actors.length];
        string memory signal = _signal(signalSeed);
        bool hadSignal = bytes(signals.bidSignal(id)).length != 0;
        vm.prank(caller);
        try signals.setBidSignal(id, signal) {
            if (hadSignal || bytes(signal).length == 0) ++ghostSignalOverwrites;
            if (bidder == address(0) || caller != bidder) ++ghostForeignSignalWrites;
            if (bytes(signal).length > signals.MAX_SIGNAL_BYTES()) ++ghostOversizedSignalsAccepted;
            ghostSignalHash[id] = _hash(signal);
            ++ghostSignalReplacements;
        } catch { }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function placeBid(uint256 actorSeed, uint256 amtSeed, uint256 signalSeed) external {
        address who = actors[actorSeed % actors.length];
        if (auction.activeBidCount(who) >= auction.MAX_BIDS_PER_WALLET()) return;
        // Always on the tick. Mostly a few ticks above the minimum, so ties form before the auction
        // fills and AmountTaken collisions happen after; sometimes a large jump.
        uint256 ticks = amtSeed % 8 == 7 ? (amtSeed >> 16) % 5000 : (amtSeed >> 8) % 24;
        uint256 amount = auction.minimumBid() + ticks * 0.001 ether;
        string memory signal = _signal(signalSeed);
        uint32 id = auction.nextBidId();
        bool fullBefore = auction.isFull();
        vm.deal(who, amount);
        vm.prank(who);
        try auction.placeBid{ value: amount }(signal) {
            _recordAmount(amount);
            ghostSignalHash[id] = _hash(signal);
            if (!fullBefore) fillBidId = id;
            if (bytes(signal).length > signals.MAX_SIGNAL_BYTES()) ++ghostOversizedSignalsAccepted;
            if (bytes(signal).length != 0) ++ghostSignalledBids;
        } catch { }
    }

    /// @dev Half the bids carry no signal; the rest carry a short pseudo-random one, and one in
    ///      eight tries a signal one byte over the limit (which must always be rejected).
    function _signal(uint256 seed) internal pure returns (string memory) {
        uint256 mode = seed % 8;
        if (mode < 4) return "";
        uint256 len = mode == 7 ? 281 : 1 + ((seed >> 8) % 48);
        bytes memory out = new bytes(len);
        bytes32 entropy = keccak256(abi.encode(seed));
        for (uint256 i; i < len; ++i) {
            out[i] = entropy[i % 32];
        }
        return string(out);
    }

    function increaseBid(uint256 actorSeed, uint256 amtSeed) external {
        address who = actors[actorSeed % actors.length];
        (uint32[] memory ids,) = auction.bidsOf(who);
        if (ids.length == 0) return;
        uint32 id = ids[amtSeed % ids.length];
        uint256 amount = (1 + (amtSeed % 1000)) * 0.001 ether;
        (, uint96 before) = auction.bids(id);
        vm.deal(who, amount);
        vm.prank(who);
        try auction.increaseBid{ value: amount }(id) {
            _recordAmount(uint256(before) + amount);
        } catch { }
    }

    /// @dev End the auction and settle a batch via the permissionless (post-grace) path.
    function endAndFinalize(uint256 batchSeed) external {
        uint256 graceEnd = uint256(auction.endTime()) + auction.FINALIZE_GRACE() + 1;
        if (block.timestamp < graceEnd) vm.warp(graceEnd);
        try auction.finalize(1 + (batchSeed % 30)) { } catch { }
    }

    /// @dev Trigger the permissionless emergency refund (covers the stuck-settlement paths).
    function triggerEmergency(uint256 batchSeed) external {
        uint256 graceEnd = uint256(auction.absoluteEndTime()) + auction.EMERGENCY_GRACE() + 1;
        if (block.timestamp < graceEnd) vm.warp(graceEnd);
        try auction.emergencyRefund(1 + (batchSeed % 30)) { } catch { }
    }

    /// @dev Exercise owner cancellation followed by permissionless batched refunds.
    function cancelAndRefund(uint256 batchSeed) external {
        if (uint8(auction.phase()) == 0) {
            vm.prank(auction.owner());
            try auction.cancelAuction() { } catch { }
        }
        if (uint8(auction.phase()) == 3) {
            try auction.refundAll(1 + (batchSeed % 30)) { } catch { }
        }
    }

    /// @dev Model a competing authorized/owner mint before or between settlement batches.
    function competingMint(uint256 actorSeed) external {
        Panorama targetNft = Panorama(address(auction.nft()));
        if (targetNft.totalMinted() >= targetNft.mintCap()) return;
        vm.prank(auction.owner());
        try targetNft.mintTo(actors[actorSeed % actors.length]) returns (uint256) { } catch { }
    }

    /// @dev Exercise the dedicated immediate/grace-gated supply-mismatch recovery path.
    function recoverSupplyMismatch(uint256 batchSeed) external {
        try auction.recoverFromSupplyMismatch(1 + (batchSeed % 30)) { } catch { }
    }

    /// @dev Objectively remove one of the two settlement capabilities covered by the post-grace path.
    function makeMintingUnavailable(uint256 mode) external {
        uint8 ph = uint8(auction.phase());
        if (ph != 0 && ph != 1) return;

        Panorama targetNft = Panorama(address(auction.nft()));
        address admin = auction.owner();
        if (mode % 2 == 0) {
            vm.prank(admin);
            targetNft.setAuthorizedOperator(address(auction), false);
        } else {
            PanoramaMintController controller = PanoramaMintController(targetNft.mintController());
            vm.prank(admin);
            controller.setSeasonMintCap(3, 0);
        }
    }

    /// @dev Exercise objective unavailable-mint recovery at the exact finalize-grace boundary.
    function recoverMintingUnavailable(uint256 batchSeed) external {
        uint256 eligibleAt = uint256(auction.endTime()) + auction.FINALIZE_GRACE();
        if (block.timestamp < eligibleAt) vm.warp(eligibleAt);
        try auction.recoverFromMintingUnavailable(1 + (batchSeed % 30)) { } catch { }
    }
}

contract PanoramaSeason3AuctionInvariants is Test {
    Panorama nft;
    PanoramaMintController controller;
    PanoramaSeason3Auction auction;
    PanoramaSeason3SignalController signals;
    AuctionHandler handler;

    address[] actors;

    function setUp() public {
        vm.warp(1_700_000_000);

        nft = new Panorama();
        controller = new PanoramaMintController();
        nft.setMintController(address(controller));
        controller.setSeasonMintCap(1, 90);
        controller.setSeasonMintCap(2, 90);
        nft.mintTo(address(this), 180);
        controller.setSeasonMintCap(3, 30);

        uint64 start = uint64(block.timestamp + 1 hours);
        signals = new PanoramaSeason3SignalController(address(nft));
        auction = new PanoramaSeason3Auction(
            address(nft), 0.1 ether, 500, start, 24 hours, address(0xA), address(0xB), address(signals)
        );
        signals.setAuction(address(auction));
        nft.setAuthorizedOperator(address(auction), true);
        vm.warp(start);

        for (uint256 i; i < 30; ++i) {
            actors.push(address(uint160(0x20000 + i)));
        }
        handler = new AuctionHandler(auction, actors);

        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                    UNIVERSAL (hold in every phase)
    //////////////////////////////////////////////////////////////*/

    /// @dev The auction never mints beyond Season 3's 30 units (#181..#210), and never below the
    ///      Seasons 1+2 baseline. Catches any over-mint / double-mint in settlement.
    function invariant_neverOverMint() public view {
        assertLe(nft.totalMinted(), 210, "must never mint past #210");
        assertGe(nft.totalMinted(), 180, "seasons 1 + 2 baseline preserved");
    }

    /// @dev While bidding is live, bidsAtAmount equals the number of active bids at that amount,
    ///      for every amount ever used (so a stale nonzero count would also be caught).
    function invariant_bidsAtAmountMatchesLiveBids() public view {
        if (uint8(auction.phase()) != 0) return;
        (,, uint96[] memory amounts) = auction.getBids();
        uint256 count = handler.ghostAmountCount();
        for (uint256 g; g < count; ++g) {
            uint96 a = handler.ghostAmounts(g);
            uint256 live;
            for (uint256 k; k < amounts.length; ++k) {
                if (amounts[k] == a) ++live;
            }
            assertEq(auction.bidsAtAmount(a), live, "bidsAtAmount out of sync");
        }
    }

    /// @dev Once full, no two bids share an amount unless both were placed before the auction filled.
    ///      Checked indirectly: every bid id above the fill point has a unique amount.
    function invariant_uniqueAmountsAfterFill() public view {
        if (uint8(auction.phase()) != 0 || !auction.isFull()) return;
        (uint32[] memory ids,, uint96[] memory amounts) = auction.getBids();
        for (uint256 j; j < ids.length; ++j) {
            if (ids[j] <= handler.fillBidId()) continue;
            for (uint256 l; l < ids.length; ++l) {
                if (l != j) assertTrue(amounts[l] != amounts[j], "post-fill bid shares an amount");
            }
        }
    }

    /// @dev Every live bid's stored signal is exactly the one its bidder sent (with the bid or added
    ///      later), and no one else ever wrote it.
    function invariant_bidSignalsMatchTheirBidders() public view {
        assertEq(handler.ghostForeignSignalWrites(), 0, "someone else changed a bid signal");
        (uint32[] memory ids,,) = auction.getBids();
        for (uint256 k; k < ids.length; ++k) {
            string memory stored = signals.bidSignal(ids[k]);
            bytes32 got = bytes(stored).length == 0 ? bytes32(0) : keccak256(bytes(stored));
            assertEq(got, handler.ghostSignalHash(ids[k]), "stored bid signal drifted");
        }
    }

    /// @dev Bid signals are write-once: never overwritten, never empty.
    function invariant_bidSignalsWriteOnce() public view {
        assertEq(handler.ghostSignalOverwrites(), 0, "a bid signal was overwritten or set empty");
    }

    /// @dev A signal longer than MAX_SIGNAL_BYTES is never accepted.
    function invariant_oversizedSignalNeverAccepted() public view {
        assertEq(handler.ghostOversizedSignalsAccepted(), 0, "oversized signal accepted");
    }

    /// @dev The contract balance always backs every tracked liability, in every phase.
    function invariant_pullLedgerBacked() public view {
        assertGe(address(auction).balance, auction.totalLiabilities(), "all liabilities must be backed");
        assertGe(address(auction).balance, auction.totalPendingReturns(), "pull-ledger must always be backed");
    }

    /// @dev No handler donates ETH, so balance and tracked liabilities must match exactly. This is
    ///      the useful solvency direction: a deficit is forbidden; a real forced donation would be surplus.
    function invariant_solvency() public view {
        assertEq(address(auction).balance, auction.totalLiabilities(), "balance != tracked liabilities");
        assertEq(auction.totalEscrowed(), _activeBidSum(), "escrow aggregate != live bids");
        assertEq(auction.totalPendingReturns(), _pendingSum(), "pending aggregate != per-user ledger");
    }

    /// @dev Remaining counts and terminal completion fields stay internally consistent.
    function invariant_progressAccounting() public view {
        uint8 ph = uint8(auction.phase());
        (uint32[] memory ids,,) = auction.getBids();
        assertEq(ids.length, auction.remainingBidCount(), "compact live view length mismatch");

        if (ph == 0) {
            assertEq(auction.finalizeCursor(), 0, "active auction has finalize progress");
            assertEq(auction.winnerCount(), 0, "active auction has frozen winners");
            assertEq(
                auction.requiredMintCapForSettlement(),
                auction.expectedNftSupply() + auction.remainingBidCount(),
                "active required cap mismatch"
            );
        } else if (ph == 1) {
            assertEq(
                auction.finalizeCursor() + auction.remainingBidCount(),
                auction.winnerCount(),
                "finalizing progress mismatch"
            );
            assertEq(
                auction.requiredMintCapForSettlement(),
                auction.expectedNftSupply() + auction.remainingBidCount(),
                "finalizing required cap mismatch"
            );
        } else if (ph == 2) {
            assertEq(auction.remainingBidCount(), 0, "settled auction has live bids");
            assertEq(auction.finalizeCursor(), auction.winnerCount(), "settled cursor mismatch");
            assertEq(auction.unreleasedProceeds(), 0, "settled proceeds unreleased");
        }

        if (ph == 2 || ph == 3) {
            assertEq(auction.requiredMintCapForSettlement(), 0, "terminal required cap not suppressed");
            assertFalse(auction.mintingUnavailable(), "terminal unavailable flag not suppressed");
        }

        if (auction.refundsComplete()) {
            assertEq(ph, 3, "refund completion outside cancellation");
            assertEq(auction.remainingBidCount(), 0, "completed recovery has live bids");
            assertEq(auction.totalEscrowed(), 0, "completed recovery has escrow");
            assertEq(auction.unreleasedProceeds(), 0, "completed recovery has proceeds");
        }
    }

    /*//////////////////////////////////////////////////////////////
                BIDDING-PHASE ONLY (heap is live)
    //////////////////////////////////////////////////////////////*/

    /// @dev Heap size is bounded and equals the reported active bid count.
    function invariant_sizeBounded() public view {
        uint256 n = auction.activeBids();
        assertLe(n, auction.MAX_UNITS(), "heap over capacity");
        (uint32[] memory ids,,) = auction.getBids();
        assertEq(ids.length, n, "getBids length mismatch");
    }

    /// @dev The min-heap property holds: every parent <= its children. (Only while bidding is live;
    ///      settlement deletes bid entries in place, which intentionally breaks the ordering.)
    function invariant_heapProperty() public view {
        if (uint8(auction.phase()) != 0) return;
        (,, uint96[] memory amounts) = auction.getBids();
        uint256 n = amounts.length;
        for (uint256 k = 1; k < n; ++k) {
            uint256 heapIdx = k + 1; // 1-based heap index of amounts[k]
            uint256 parentArr = (heapIdx / 2) - 1;
            assertLe(amounts[parentArr], amounts[k], "min-heap property violated");
        }
    }

    /// @dev heapPos is a bijection: the id at heap position i maps back to i.
    function invariant_bijection() public view {
        if (uint8(auction.phase()) != 0) return;
        (uint32[] memory ids,,) = auction.getBids();
        for (uint256 k; k < ids.length; ++k) {
            assertEq(auction.heapPos(ids[k]), k + 1, "heapPos bijection broken");
        }
    }

    /// @dev Per-wallet counts match the compact live view in every phase and stay within the cap.
    function invariant_countAndFloor() public view {
        (, address[] memory bidders, uint96[] memory amounts) = auction.getBids();
        uint256 reserve = auction.reservePrice();

        for (uint256 k; k < amounts.length; ++k) {
            assertGe(amounts[k], reserve, "active bid below reserve");
        }

        for (uint256 i; i < actors.length; ++i) {
            uint256 realCount;
            for (uint256 k; k < bidders.length; ++k) {
                if (bidders[k] == actors[i]) ++realCount;
            }
            assertEq(auction.activeBidCount(actors[i]), realCount, "activeBidCount mismatch");
            assertLe(realCount, auction.MAX_BIDS_PER_WALLET(), "over per-wallet cap");
        }
    }

    /*//////////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////////*/

    function _activeBidSum() internal view returns (uint256 sum) {
        (,, uint96[] memory amounts) = auction.getBids();
        for (uint256 k; k < amounts.length; ++k) {
            sum += amounts[k];
        }
    }

    function _pendingSum() internal view returns (uint256 sum) {
        for (uint256 i; i < actors.length; ++i) {
            sum += auction.pendingReturns(actors[i]);
        }
    }
}
