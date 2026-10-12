// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Panorama } from "../src/Panorama.sol";
import { PanoramaMintController } from "../src/PanoramaMintController.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";
import { DeployAuction } from "../script/DeployAuction.s.sol";
import { AuctionSettlementBatchLib, SettleAuctionAtomic } from "../script/SettleAuctionAtomic.s.sol";

contract AuctionSettlementBatchHarness {
    function finalizeCallCount(uint256 winners, uint256 finalized, uint256 batch) external pure returns (uint256) {
        return AuctionSettlementBatchLib.finalizeCallCount(winners, finalized, batch);
    }
}

contract PanoramaSeason3AuctionAtomicSettlementTest is Test {
    AuctionSettlementBatchHarness internal harness;

    function setUp() public {
        harness = new AuctionSettlementBatchHarness();
    }

    function test_finalizeCallCount_freshAuction() public view {
        assertEq(harness.finalizeCallCount(30, 0, 30), 1, "default batch settles all 30 in one call");
        assertEq(harness.finalizeCallCount(30, 0, 15), 2);
        assertEq(harness.finalizeCallCount(30, 0, 10), 3);
        assertEq(harness.finalizeCallCount(7, 0, 30), 1, "undersubscribed sale is one call");
    }

    function test_finalizeCallCount_partialRetryUsesRemainingWinners() public view {
        assertEq(harness.finalizeCallCount(30, 15, 15), 1, "one batch remains, not two total-winner batches");
        assertEq(harness.finalizeCallCount(30, 16, 15), 1);
        assertEq(harness.finalizeCallCount(30, 10, 15), 2);
        assertEq(harness.finalizeCallCount(30, 29, 15), 1);
        assertEq(harness.finalizeCallCount(30, 30, 15), 0);
    }

    function test_finalizeCallCount_rejectsInvalidInputs() public {
        vm.expectRevert(bytes("INVALID_FINALIZE_BATCH"));
        harness.finalizeCallCount(30, 0, 0);

        vm.expectRevert(bytes("INVALID_FINALIZE_PROGRESS"));
        harness.finalizeCallCount(29, 30, 15);
    }

    function testFuzz_finalizeCallCount_matchesCeilingOfRemaining(
        uint8 winnersSeed,
        uint8 cursorSeed,
        uint8 batchSeed
    ) public view {
        uint256 winners = bound(uint256(winnersSeed), 1, 30);
        uint256 finalized = bound(uint256(cursorSeed), 0, winners);
        uint256 batch = bound(uint256(batchSeed), 1, 30);
        uint256 remaining = winners - finalized;
        uint256 expected = remaining == 0 ? 0 : ((remaining - 1) / batch) + 1;
        assertEq(harness.finalizeCallCount(winners, finalized, batch), expected);
    }

    /*//////////////////////////////////////////////////////////////
              DEPLOY + SETTLE SCRIPTS, END TO END (LOCAL)
    //////////////////////////////////////////////////////////////*/

    // Every env write below is test-local configuration for the scripts under test.
    // forge-lint: disable-start(unsafe-cheatcode)

    uint256 internal constant DEPLOYER_KEY = 0xA11CE;
    address internal constant PAYOUT_A = address(0xA);
    address internal constant PAYOUT_B = address(0xB);
    uint256 internal constant RESERVE = 0.1 ether;

    struct Stack {
        Panorama nft;
        PanoramaMintController controller;
    }

    /// @dev A fresh collection in the exact mainnet pre-auction shape: seasons 1 and 2 at 90 each,
    ///      180 minted, owned by the script broadcaster.
    function _freshStack(address deployer) internal returns (Stack memory s) {
        vm.startPrank(deployer);
        s.nft = new Panorama();
        s.controller = new PanoramaMintController();
        s.nft.setMintController(address(s.controller));
        s.controller.setSeasonMintCap(1, 90);
        s.controller.setSeasonMintCap(2, 90);
        s.nft.mintTo(deployer, 180);
        vm.stopPrank();
    }

    function _setDeployEnv(Stack memory s, uint256 start, string memory reserve) internal {
        vm.setEnv("PANORAMA_NFT", vm.toString(address(s.nft)));
        vm.setEnv("PANORAMA_MINT_CONTROLLER", vm.toString(address(s.controller)));
        vm.setEnv("PANORAMA_AUCTION_RESERVE_PRICE", reserve);
        vm.setEnv("PANORAMA_AUCTION_MIN_INCREMENT_BPS", "500");
        vm.setEnv("PANORAMA_AUCTION_START", vm.toString(start));
        vm.setEnv("PANORAMA_AUCTION_DURATION", "86400");
        vm.setEnv("PANORAMA_PAYOUT_A", vm.toString(PAYOUT_A));
        vm.setEnv("PANORAMA_PAYOUT_B", vm.toString(PAYOUT_B));
        vm.setEnv("PANORAMA_FINALIZE_BATCH", "30");
    }

    function _bid(PanoramaSeason3Auction auction, address who, uint256 amount, string memory signal) internal {
        vm.deal(who, amount);
        vm.prank(who);
        auction.placeBid{ value: amount }(signal);
    }

    /// @dev Deploys through DeployAuction, bids, then settles through SettleAuctionAtomic and
    ///      checks the exact-winners cap, mint range, revocation and the 58/42 payout split.
    function _runFlow(uint256 bidders, uint256 displacements) internal {
        address deployer = vm.addr(DEPLOYER_KEY);
        Stack memory s = _freshStack(deployer);
        uint256 start = block.timestamp + 1 hours;
        _setDeployEnv(s, start, vm.toString(RESERVE));

        PanoramaSeason3Auction auction = new DeployAuction().run();
        assertEq(auction.owner(), deployer);
        assertEq(auction.MAX_BIDS_PER_WALLET(), 2);
        assertEq(auction.BID_TICK(), 0.001 ether);
        assertEq(auction.FIRST_TOKEN_ID(), 181);
        PanoramaSeason3SignalController signals = PanoramaSeason3SignalController(address(auction.signalController()));
        assertEq(signals.auction(), address(auction), "controller points back at the auction");
        assertEq(signals.owner(), deployer);
        assertEq(address(signals.nft()), address(s.nft));
        assertEq(signals.MAX_SIGNAL_BYTES(), 280);

        vm.warp(start);
        for (uint256 i; i < bidders; ++i) {
            _bid(auction, address(uint160(0x5000 + i)), RESERVE + i * 0.01 ether, i % 2 == 0 ? "" : "signal");
        }
        for (uint256 j; j < displacements; ++j) {
            _bid(auction, address(uint160(0x6000 + j)), auction.minimumBid(), "a displacing signal");
        }
        uint256 winners = auction.activeBids();
        uint256 clearing = auction.currentClearingPrice();
        vm.warp(auction.endTime() + 1);

        vm.setEnv("PANORAMA_AUCTION_ADDRESS", vm.toString(address(auction)));
        vm.setEnv("PANORAMA_AUCTION_RUNTIME_CODEHASH", vm.toString(address(auction).codehash));
        vm.setEnv("PANORAMA_AUCTION_OWNER", vm.toString(deployer));

        // A wrong expected payout is refused before anything is broadcast.
        vm.setEnv("PANORAMA_PAYOUT_B", vm.toString(address(0xC)));
        SettleAuctionAtomic wrongPayout = new SettleAuctionAtomic();
        vm.expectRevert(bytes("PAYOUT_MISMATCH"));
        wrongPayout.run();
        vm.setEnv("PANORAMA_PAYOUT_B", vm.toString(PAYOUT_B));

        SettleAuctionAtomic settle = new SettleAuctionAtomic();
        settle.safeBatch(); // read-only Safe JSON path must pass the same preflight
        settle.run();

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        assertEq(auction.winnerCount(), winners);
        assertEq(s.nft.totalMinted(), 180 + winners);
        assertEq(s.nft.mintCap(), 180 + winners, "cap opened by exactly the winner count");
        assertEq(s.controller.seasonCount(), 3);
        assertEq(s.controller.seasonMintCap(3), winners);
        assertFalse(s.nft.authorizedOperators(address(auction)), "mint power revoked in the same run");
        assertTrue(s.nft.ownerOf(181) != address(0));
        assertTrue(s.nft.ownerOf(180 + winners) != address(0));

        // The top bid (id = bidders, an odd index, so it carried "signal" when bidders is even) won #181.
        assertEq(
            signals.signalOf(181, uint32(bidders)), (bidders - 1) % 2 == 0 ? "" : "signal", "day 1 reads its bid signal"
        );
        // A day whose winning bid carried no signal can get one from its holder, at any time.
        if ((bidders - 1) % 2 == 0) {
            vm.warp(block.timestamp + 365 days);
            vm.prank(s.nft.ownerOf(181));
            signals.setTokenSignal(181, "added by the holder a year later");
            assertEq(signals.signalOf(181, uint32(bidders)), "added by the holder a year later");
        }

        uint256 proceeds = winners * clearing;
        assertEq(PAYOUT_A.balance, (proceeds * 5800) / 10_000);
        assertEq(PAYOUT_A.balance + PAYOUT_B.balance, proceeds);
        vm.deal(PAYOUT_A, 0);
        vm.deal(PAYOUT_B, 0);
    }

    /// @dev One test function on purpose: scripts read process-wide env, so keeping every env
    ///      write in a single sequential test avoids races with parallel test execution.
    function test_scripts_deployAndSettle_endToEnd() public {
        vm.chainId(1);
        vm.warp(1_700_000_000);
        vm.setEnv("PRIVATE_KEY", vm.toString(DEPLOYER_KEY));
        address deployer = vm.addr(DEPLOYER_KEY);

        // The reserve is validated full-width before narrowing: below the 0.1 ETH floor, and
        // 2^96 + 0.1 ETH (which would truncate to exactly 0.1 ETH if narrowed first).
        Stack memory s = _freshStack(deployer);
        uint256 start = block.timestamp + 1 hours;
        DeployAuction deploy = new DeployAuction();

        string[2] memory bad = ["99999999999999999", "79228162514364337593543950336"];
        for (uint256 i; i < bad.length; ++i) {
            _setDeployEnv(s, start, bad[i]);
            vm.expectRevert(bytes("INVALID_RESERVE_PRICE"));
            deploy.run();
        }

        // An off-tick reserve is refused before anything is broadcast (the constructor would too).
        _setDeployEnv(s, start, "100000000000000001");
        vm.expectRevert(bytes("RESERVE_NOT_ON_TICK"));
        deploy.run();

        // The deploy script refuses a collection whose Season 3 slot is already configured.
        vm.prank(deployer);
        s.controller.setSeasonMintCap(3, 0);
        _setDeployEnv(s, start, vm.toString(RESERVE));
        vm.expectRevert(bytes("UNEXPECTED_SEASON_COUNT"));
        deploy.run();

        // Full sale with displacements, then an undersubscribed sale on a fresh stack.
        _runFlow(30, 3);
        _runFlow(7, 0);
    }
    // forge-lint: disable-end(unsafe-cheatcode)
}
