// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Vm } from "forge-std/src/Vm.sol";
import { Panorama } from "../src/Panorama.sol";
import { PanoramaMintController } from "../src/PanoramaMintController.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/*//////////////////////////////////////////////////////////////
                          MOCK RECEIVERS
//////////////////////////////////////////////////////////////*/

/// @dev Reverts on any plain ETH receipt. Used to prove refunds cannot be blocked.
contract RevertingReceiver {
    PanoramaSeason3Auction public auction;

    constructor(PanoramaSeason3Auction a) {
        auction = a;
    }

    function bid(uint256 v) external {
        auction.placeBid{ value: v }("");
    }

    function increase(uint32 id, uint256 v) external {
        auction.increaseBid{ value: v }(id);
    }

    function withdraw() external {
        auction.withdraw();
    }

    receive() external payable {
        revert("no ETH");
    }
}

/// @dev Attempts to re-enter the auction on ETH receipt (reverts propagate; no try/catch).
contract ReentrantBidder {
    PanoramaSeason3Auction public auction;
    uint256 public mode; // 0 none, 1 placeBid, 2 withdraw, 3 finalize

    constructor(PanoramaSeason3Auction a) {
        auction = a;
    }

    function setMode(uint256 m) external {
        mode = m;
    }

    function bid(uint256 v) external {
        auction.placeBid{ value: v }("");
    }

    receive() external payable {
        if (mode == 1) auction.placeBid{ value: 0 }("");
        else if (mode == 2) auction.withdraw();
        else if (mode == 3) auction.finalize(1);
    }
}

/// @dev Exercises sequential top-ups from one smart wallet in a single transaction.
contract SplitIncreaseBidder {
    PanoramaSeason3Auction public immutable auction;

    constructor(PanoramaSeason3Auction auction_) {
        auction = auction_;
    }

    function bid(uint256 amount) external {
        auction.placeBid{ value: amount }("");
    }

    function splitIncrease(uint32 bidId, uint256 first, uint256 second) external {
        auction.increaseBid{ value: first }(bidId);
        auction.increaseBid{ value: second }(bidId);
    }

    receive() external payable { }
}

/// @dev Burns every unit of gas it is given on ETH receipt (worst-case refund receiver).
contract GasBurnerBidder {
    PanoramaSeason3Auction public immutable auction;

    constructor(PanoramaSeason3Auction auction_) {
        auction = auction_;
    }

    function bid(uint256 amount) external {
        auction.placeBid{ value: amount }("");
    }

    receive() external payable {
        while (true) { }
    }
}

/// @dev Minimal token used to verify accidental ERC20 recovery.
contract AuctionTestERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Sends ETH without invoking the auction, creating provable balance surplus.
contract AuctionForceETH {
    constructor() payable { }

    function force(address payable to) external {
        selfdestruct(to);
    }
}

/// @dev Panorama-shaped mint target that deliberately returns a token id other than the id minted.
contract WrongIdPanorama {
    uint256 public totalMinted = 180;
    uint256 public mintCap = 210;
    uint256 public constant maxSupply = 365;
    mapping(address => bool) public authorizedOperators;

    function setAuthorizedOperator(address operator, bool authorized) external {
        authorizedOperators[operator] = authorized;
    }

    function mintTo(address) external returns (uint256) {
        ++totalMinted;
        return totalMinted + 1;
    }
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

contract PanoramaSeason3AuctionTest is Test {
    uint256 constant WRITE_GAS_LIMIT = 15_000_000;
    uint256 constant UNITS = 30;
    uint256 constant FIRST_ID = 181;
    uint256 constant LAST_ID = 210;
    uint256 constant BASELINE = 180;
    uint256 constant TICK = 0.001 ether;

    Panorama nft;
    PanoramaMintController controller;
    PanoramaSeason3Auction auction;
    PanoramaSeason3SignalController signals;

    address owner;
    address payoutA = address(0xA);
    address payoutB = address(0xB);

    uint96 constant RESERVE = 0.1 ether;
    uint16 constant INC_BPS = 500; // 5%
    uint64 constant DURATION = 24 hours;
    uint64 constant START_DELAY = 1 hours;

    function setUp() public {
        owner = address(this);
        vm.warp(1_700_000_000);

        nft = new Panorama();
        controller = new PanoramaMintController();
        nft.setMintController(address(controller));
        controller.setSeasonMintCap(1, 90);
        controller.setSeasonMintCap(2, 90);

        // Seasons 1 and 2 fully minted -> totalMinted == 180 so the auction mints #181..#210.
        nft.mintTo(owner, 180);
        controller.setSeasonMintCap(3, 30);

        uint64 start = uint64(block.timestamp + START_DELAY);
        signals = new PanoramaSeason3SignalController(address(nft));
        auction = new PanoramaSeason3Auction(
            address(nft), RESERVE, INC_BPS, start, DURATION, payoutA, payoutB, address(signals)
        );
        signals.setAuction(address(auction));
        nft.setAuthorizedOperator(address(auction), true);
        vm.warp(start);
    }

    /*//////////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////////*/

    function _actor(uint256 i) internal pure returns (address) {
        return address(uint160(0x100000 + i));
    }

    function _place(address who, uint256 amount) internal returns (uint32 id) {
        id = auction.nextBidId();
        vm.deal(who, amount);
        vm.prank(who);
        auction.placeBid{ value: amount }("");
    }

    function _increase(address who, uint32 id, uint256 amount) internal {
        vm.deal(who, amount);
        vm.prank(who);
        auction.increaseBid{ value: amount }(id);
    }

    /// @dev Fill all 30 slots with distinct increasing amounts. Floor = RESERVE.
    function _fillAll() internal {
        for (uint256 i; i < UNITS; ++i) {
            _place(_actor(i), RESERVE + i * 0.001 ether);
        }
    }

    function _endAuction() internal {
        vm.warp(auction.endTime() + 1);
    }

    function _placeWithSignal(address who, uint256 amount, string memory signal) internal returns (uint32 id) {
        id = auction.nextBidId();
        vm.deal(who, amount);
        vm.prank(who);
        auction.placeBid{ value: amount }(signal);
    }

    /// @dev `unit` repeated `n` times (used to build signals of an exact byte length).
    function _repeat(bytes memory unit, uint256 n) internal pure returns (bytes memory out) {
        for (uint256 i; i < n; ++i) {
            out = bytes.concat(out, unit);
        }
    }

    /// @dev Number of BidSignalSet logs in `logs` emitted by the signal controller.
    function _signalLogCount(Vm.Log[] memory logs) internal view returns (uint256 count) {
        bytes32 topic = PanoramaSeason3SignalController.BidSignalSet.selector;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(signals) && logs[i].topics[0] == topic) ++count;
        }
    }

    /*//////////////////////////////////////////////////////////////
                          CONFIG / CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_constructor_setsConfig() public view {
        assertEq(address(auction.nft()), address(nft));
        assertEq(auction.reservePrice(), RESERVE);
        assertEq(auction.minIncrementBps(), INC_BPS);
        assertEq(auction.payoutA(), payoutA);
        assertEq(auction.payoutB(), payoutB);
        assertEq(auction.endTime(), auction.startTime() + DURATION);
        assertEq(auction.absoluteEndTime(), auction.endTime() + 24 hours);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Active));
        assertEq(auction.SPLIT_A_BPS(), 5800);
        assertEq(auction.MIN_RESERVE_PRICE(), 0.1 ether);
        assertEq(auction.MAX_UNITS(), 30);
        assertEq(auction.FIRST_TOKEN_ID(), 181);
        assertEq(auction.LAST_TOKEN_ID(), 210);
        assertEq(signals.MAX_SIGNAL_BYTES(), 280);
    }

    /// @dev The reserve is contract-floored at 0.1 ETH: exactly 0.1 deploys, one wei less
    ///      reverts, so no accepted bid can ever be below 0.1 ETH on any deployment.
    function test_constructor_enforcesReserveFloor() public {
        uint64 futureStart = uint64(block.timestamp + 1 hours);

        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), 0.1 ether - 1, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );

        PanoramaSeason3Auction atFloor = new PanoramaSeason3Auction(
            address(nft), 0.1 ether, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        assertEq(atFloor.reservePrice(), atFloor.MIN_RESERVE_PRICE());

        // A bid below the floored reserve is rejected even on a floor-priced auction.
        vm.warp(futureStart);
        address bidder = _actor(777);
        vm.deal(bidder, 1 ether);
        vm.prank(bidder);
        vm.expectRevert(PanoramaSeason3Auction.BelowReserve.selector);
        atFloor.placeBid{ value: 0.1 ether - 1 }("");
    }

    function test_constructor_revertsBadConfig() public {
        uint64 futureStart = uint64(block.timestamp + 1 hours);
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(0), RESERVE, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), 0, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), 0.1 ether + 1, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), 0.1 ether - 1, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), RESERVE, 0, futureStart, DURATION, payoutA, payoutB, address(signals));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), RESERVE, INC_BPS, futureStart, 0, payoutA, payoutB, address(signals));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), RESERVE, 10_001, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), RESERVE, INC_BPS, 0, DURATION, payoutA, payoutB, address(signals));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), RESERVE, INC_BPS, uint64(block.timestamp), DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            _actor(123), RESERVE, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft),
            RESERVE,
            INC_BPS,
            uint64(type(uint64).max - 1 hours),
            2 hours,
            payoutA,
            payoutB,
            address(signals)
        );
    }

    function test_constructor_requiresExactSeason3BaselineSupply() public {
        nft.mintTo(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft),
            RESERVE,
            INC_BPS,
            uint64(block.timestamp + 1 hours),
            DURATION,
            payoutA,
            payoutB,
            address(signals)
        );
    }

    function test_setSchedule_beforeAnyBid() public {
        auction.setSchedule(uint64(block.timestamp + 100), 24 hours);
        assertEq(auction.startTime(), block.timestamp + 100);
        assertEq(auction.endTime(), block.timestamp + 100 + 24 hours);
        assertEq(auction.absoluteEndTime(), block.timestamp + 100 + 48 hours);
    }

    function test_setSchedule_requiresExplicitFutureStart() public {
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        auction.setSchedule(0, 24 hours);
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        auction.setSchedule(uint64(block.timestamp), 24 hours);
    }

    function test_setSchedule_revertsAfterFirstBid() public {
        _place(_actor(0), RESERVE);
        vm.expectRevert(PanoramaSeason3Auction.TooLateToConfigure.selector);
        auction.setSchedule(0, 24 hours);
    }

    function test_setSchedule_onlyOwner() public {
        vm.prank(_actor(1));
        vm.expectRevert(Ownable.Unauthorized.selector);
        auction.setSchedule(0, 24 hours);
    }

    /*//////////////////////////////////////////////////////////////
                            BASIC BIDDING
    //////////////////////////////////////////////////////////////*/

    function test_placeBid_basic() public {
        uint32 id = _place(_actor(0), RESERVE);
        assertEq(id, 1);
        assertEq(auction.activeBids(), 1);
        assertEq(auction.activeBidCount(_actor(0)), 1);
        (address bidder, uint96 amount) = auction.bids(id);
        assertEq(bidder, _actor(0));
        assertEq(amount, RESERVE);
        assertEq(auction.currentClearingPrice(), RESERVE);
    }

    function test_placeBid_belowReserveReverts() public {
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.BelowReserve.selector);
        auction.placeBid{ value: RESERVE - 1 }("");
    }

    function test_placeBid_beforeStartReverts() public {
        auction.setSchedule(uint64(block.timestamp + 1000), DURATION);
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.NotStarted.selector);
        auction.placeBid{ value: RESERVE }("");
    }

    function test_placeBid_afterEndReverts() public {
        _endAuction();
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.AuctionEnded.selector);
        auction.placeBid{ value: RESERVE }("");
    }

    function test_placeBid_maxTwoPerWallet() public {
        address w = _actor(0);
        assertEq(auction.MAX_BIDS_PER_WALLET(), 2);
        for (uint256 i; i < 2; ++i) {
            _place(w, RESERVE + i * TICK);
        }
        assertEq(auction.activeBidCount(w), 2);
        vm.deal(w, RESERVE);
        vm.prank(w);
        vm.expectRevert(PanoramaSeason3Auction.TooManyBids.selector);
        auction.placeBid{ value: RESERVE }("");
    }

    function test_bidsOf() public {
        address w = _actor(0);
        _place(w, RESERVE);
        _place(w, RESERVE + 1 ether);
        (uint32[] memory ids, uint96[] memory amounts) = auction.bidsOf(w);
        assertEq(ids.length, 2);
        assertEq(amounts.length, 2);
        assertEq(uint256(amounts[0]) + amounts[1], uint256(RESERVE) + RESERVE + 1 ether);
    }

    /*//////////////////////////////////////////////////////////////
                        CAPACITY / DISPLACEMENT
    //////////////////////////////////////////////////////////////*/

    function test_fillAll_thenFull() public {
        _fillAll();
        assertEq(auction.activeBids(), 30);
        assertTrue(auction.isFull());
        assertEq(auction.currentClearingPrice(), RESERVE); // lowest bid is the floor
        // The floor plus 5% is 0.105, but _fillAll holds every tick from 0.100 to 0.129, so the
        // lowest placeable amount steps past them to 0.130.
        assertEq(RESERVE + (uint256(RESERVE) * INC_BPS) / 10_000, 0.105 ether);
        assertEq(auction.minimumBid(), 0.13 ether);
    }

    function test_subFloorBidReverts_whenFull() public {
        _fillAll();
        uint256 minReq = 0.105 ether; // floor 0.1 + 5%, already on the tick
        vm.deal(_actor(999), minReq);
        vm.prank(_actor(999));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidTooLow.selector, minReq));
        auction.placeBid{ value: minReq - TICK }("");
        assertEq(auction.activeBids(), 30);
    }

    function test_displacement_evictsLowest_refundsFull() public {
        _fillAll();
        address lowest = _actor(0); // bid exactly RESERVE
        assertEq(auction.activeBidCount(lowest), 1);

        uint256 newBid = auction.minimumBid();
        address challenger = _actor(999);
        vm.deal(challenger, newBid);
        vm.prank(challenger);
        auction.placeBid{ value: newBid }("");

        // lowest displaced: refunded in full, slot freed, no longer in heap.
        assertEq(lowest.balance, RESERVE, "displaced refunded full");
        assertEq(auction.activeBidCount(lowest), 0);
        assertEq(auction.activeBids(), 30);
        // new clearing floor is now the previous 2nd-lowest (RESERVE + 0.001)
        assertEq(auction.currentClearingPrice(), RESERVE + 0.001 ether);
    }

    function test_displacement_revertingReceiver_stillWorks() public {
        // Fill 29 normal + 1 reverting receiver at the floor.
        for (uint256 i; i < 29; ++i) {
            _place(_actor(i), RESERVE + 0.001 ether + i * 0.001 ether);
        }
        RevertingReceiver rr = new RevertingReceiver(auction);
        vm.deal(address(rr), RESERVE);
        rr.bid(RESERVE); // lowest bid, will be displaced
        assertEq(auction.activeBids(), 30);
        assertEq(auction.currentClearingPrice(), RESERVE);

        // Challenger outbids: the reverting receiver must still be evicted & refunded (force-send).
        uint256 newBid = auction.minimumBid();
        address challenger = _actor(500);
        vm.deal(challenger, newBid);
        vm.prank(challenger);
        auction.placeBid{ value: newBid }("");

        assertEq(address(rr).balance, RESERVE, "griefer force-refunded via selfdestruct");
        assertEq(auction.activeBidCount(address(rr)), 0);
        assertEq(auction.activeBids(), 30);
    }

    /*//////////////////////////////////////////////////////////////
                            INCREASE BID
    //////////////////////////////////////////////////////////////*/

    function test_increaseBid_raisesAmount() public {
        uint32 id = _place(_actor(0), RESERVE);
        _increase(_actor(0), id, 1 ether);
        (, uint96 amount) = auction.bids(id);
        assertEq(amount, uint256(RESERVE) + 1 ether);
    }

    function test_increaseBid_notYourBidReverts() public {
        uint32 id = _place(_actor(0), RESERVE);
        vm.deal(_actor(1), 1 ether);
        vm.prank(_actor(1));
        vm.expectRevert(PanoramaSeason3Auction.NotYourBid.selector);
        auction.increaseBid{ value: 1 ether }(id);
    }

    function test_increaseBid_zeroReverts() public {
        uint32 id = _place(_actor(0), RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.ZeroIncrease.selector);
        auction.increaseBid{ value: 0 }(id);
    }

    function test_increaseBid_rootRaisesClearing() public {
        _fillAll();
        // The floor bid is actor(0) at RESERVE, which is the heap root.
        assertEq(auction.currentClearingPrice(), RESERVE);
        // Raise the floor bid above the 2nd lowest -> clearing must rise.
        // 0.100 -> 0.130: once full the new total must be free, and 0.101-0.129 are all held.
        _increase(_actor(0), 1, 0.03 ether);
        assertGt(auction.currentClearingPrice(), RESERVE);
        assertEq(auction.currentClearingPrice(), RESERVE + 0.001 ether); // new floor = actor(1)
    }

    function test_increaseBid_nonRootKeepsClearing() public {
        _fillAll();
        uint256 before = auction.currentClearingPrice();
        // Raise a high bid (actor 20), floor unaffected.
        _increase(_actor(20), 21, 5 ether);
        assertEq(auction.currentClearingPrice(), before);
    }

    /*//////////////////////////////////////////////////////////////
                            ANTI-SNIPE
    //////////////////////////////////////////////////////////////*/

    function test_antiSnipe_extends() public {
        uint64 end0 = auction.endTime();
        vm.warp(end0 - 2 minutes); // within 5-min window
        _place(_actor(0), RESERVE);
        assertEq(auction.endTime(), block.timestamp + 10 minutes);
        assertEq(auction.extensionCount(), 1);
    }

    function test_antiSnipe_noExtendOutsideWindow() public {
        uint64 end0 = auction.endTime();
        vm.warp(end0 - 10 minutes);
        _place(_actor(0), RESERVE);
        assertEq(auction.endTime(), end0);
        assertEq(auction.extensionCount(), 0);
    }

    function test_antiSnipe_extensionsStopAtAbsoluteEnd() public {
        uint64 hardEnd = auction.absoluteEndTime();
        assertEq(hardEnd, auction.endTime() + 24 hours);

        uint256 i;
        while (auction.endTime() < hardEnd) {
            vm.warp(auction.endTime() - 1 minutes);
            _place(_actor(i), auction.minimumBid());
            ++i;
            assertLt(i, 300, "extension loop must converge on hard end");
        }

        assertEq(auction.endTime(), hardEnd, "end must clamp to immutable hard deadline");
        vm.warp(hardEnd - 1);
        _place(_actor(10_000), auction.minimumBid());
        assertEq(auction.endTime(), hardEnd, "qualifying bid cannot move the hard deadline");
    }

    /*//////////////////////////////////////////////////////////////
                              FINALIZE
    //////////////////////////////////////////////////////////////*/

    function test_finalize_full_uniformPrice_split() public {
        _fillAll();
        _endAuction();

        uint256 aBefore = payoutA.balance;
        uint256 bBefore = payoutB.balance;

        auction.finalize(30);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        assertEq(auction.clearingPrice(), RESERVE);
        assertEq(nft.totalMinted(), 210); // 180 (seasons 1 + 2) + 30 winners
        // every winner owns exactly one token
        uint256 owned;
        for (uint256 i; i < UNITS; ++i) {
            owned += nft.balanceOf(_actor(i));
        }
        assertEq(owned, 30, "all 30 winners each own one token");

        uint256 proceeds = 30 * uint256(RESERVE);
        uint256 aShare = (proceeds * 5800) / 10_000;
        assertEq(payoutA.balance - aBefore, aShare);
        assertEq(payoutB.balance - bBefore, proceeds - aShare);

        // Excess for actor(0) was 0 (bid == clearing); actor(29) got 0.029 back.
        assertEq(_actor(29).balance, 0.029 ether);
    }

    function test_finalize_descendingRevealOrder() public {
        // _fillAll: actor(i) bids RESERVE + i*0.001 -> actor(29) is highest, actor(0) lowest.
        _fillAll();
        _endAuction();
        auction.finalize(30);
        // Highest bid gets the earliest token (#181 -> first daily reveal); lowest gets #210.
        assertEq(nft.ownerOf(181), _actor(29), "highest bid -> #181");
        assertEq(nft.ownerOf(182), _actor(28), "2nd highest -> #182");
        assertEq(nft.ownerOf(209), _actor(1), "2nd lowest -> #209");
        assertEq(nft.ownerOf(210), _actor(0), "lowest winning -> #210");
    }

    function test_finalize_descendingOrder_survivesBatching() public {
        _fillAll();
        _endAuction();
        auction.finalize(13);
        auction.finalize(13);
        auction.finalize(13);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        // Order is preserved across batches.
        assertEq(nft.ownerOf(181), _actor(29), "highest bid -> #181 across batches");
        assertEq(nft.ownerOf(194), _actor(16), "first id of batch 2 continues the order");
        assertEq(nft.ownerOf(210), _actor(0), "lowest winning -> #210 across batches");
    }

    function test_finalize_batched_equalsSingle() public {
        _fillAll();
        _endAuction();
        auction.finalize(10);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Finalizing));
        auction.finalize(10);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Finalizing));
        auction.finalize(10);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        assertEq(nft.totalMinted(), 210);
        assertEq(auction.clearingPrice(), RESERVE);
        // every id in #181..#210 is minted
        for (uint256 t = FIRST_ID; t <= LAST_ID; ++t) {
            assertTrue(nft.ownerOf(t) != address(0));
        }
    }

    function test_finalize_doubleFinalizeReverts() public {
        _fillAll();
        _endAuction();
        auction.finalize(30);
        vm.expectRevert(PanoramaSeason3Auction.NotFinalizable.selector);
        auction.finalize(30);
    }

    function test_finalize_beforeEndReverts() public {
        _fillAll();
        vm.expectRevert(PanoramaSeason3Auction.AuctionNotEnded.selector);
        auction.finalize(30);
    }

    function test_finalize_undersubscribed_clearingIsReserve() public {
        // Only 10 bids -> clearing = reserve, mint 10.
        for (uint256 i; i < 10; ++i) {
            _place(_actor(i), RESERVE + i * 0.01 ether);
        }
        _endAuction();
        auction.finalize(30);
        assertEq(auction.clearingPrice(), RESERVE);
        assertEq(nft.totalMinted(), 190); // 180 + 10
        uint256 proceeds = 10 * uint256(RESERVE);
        assertEq(payoutA.balance, (proceeds * 5800) / 10_000);
        assertEq(payoutB.balance, proceeds - (proceeds * 5800) / 10_000);
    }

    function test_finalize_zeroBids_settlesCleanly() public {
        _endAuction();
        auction.finalize(30);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        assertEq(nft.totalMinted(), 180);
        assertEq(payoutA.balance, 0);
        assertEq(payoutB.balance, 0);
    }

    function test_finalize_notOperatorReverts() public {
        _fillAll();
        _endAuction();
        nft.setAuthorizedOperator(address(auction), false);
        vm.expectRevert(PanoramaSeason3Auction.NotOperatorAuthorized.selector);
        auction.finalize(30);
    }

    function test_finalize_insufficientMintCapReverts() public {
        _fillAll();
        _endAuction();
        // Drop the season-3 cap so headroom < 30.
        controller.setSeasonMintCap(3, 10);
        vm.expectRevert(PanoramaSeason3Auction.InsufficientMintCap.selector);
        auction.finalize(30);
    }

    function test_finalize_multipleBidsSameWallet_winsMultiple() public {
        address whale = _actor(777);
        // 2 high bids from one wallet + 28 others.
        for (uint256 i; i < 2; ++i) {
            vm.deal(whale, 10 ether);
            vm.prank(whale);
            auction.placeBid{ value: 5 ether + i * TICK }("");
        }
        for (uint256 i; i < 28; ++i) {
            _place(_actor(i), RESERVE + i * 0.001 ether);
        }
        _endAuction();
        auction.finalize(30);
        assertEq(nft.balanceOf(whale), 2, "whale won 2 tokens");
    }

    function test_finalize_permissionlessAfterGrace() public {
        _fillAll();
        _endAuction();
        // Non-owner before grace -> revert.
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.NotAuthorizedToFinalize.selector);
        auction.finalize(30);
        // After grace, anyone can.
        vm.warp(auction.endTime() + auction.FINALIZE_GRACE() + 1);
        vm.prank(_actor(999));
        auction.finalize(30);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
    }

    function test_finalize_revertingWinner_excessToLedger() public {
        // 29 normal winners + 1 reverting receiver bidding above clearing.
        RevertingReceiver rr = new RevertingReceiver(auction);
        vm.deal(address(rr), 1 ether);
        rr.bid(1 ether); // high bid, excess = 1 - clearing
        for (uint256 i; i < 29; ++i) {
            _place(_actor(i), RESERVE + i * 0.001 ether);
        }
        _endAuction();
        auction.finalize(30);

        assertEq(nft.balanceOf(address(rr)), 1, "griefer still won the token");
        uint256 clearing = auction.clearingPrice();
        uint256 expectedExcess = 1 ether - clearing;
        assertEq(auction.pendingReturns(address(rr)), expectedExcess, "excess parked in ledger");

        // Withdraw delivers via force-send despite the reverting receiver.
        rr.withdraw();
        assertEq(address(rr).balance, expectedExcess);
        assertEq(auction.pendingReturns(address(rr)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                          CANCEL / REFUND-ALL
    //////////////////////////////////////////////////////////////*/

    function test_cancel_thenRefundAll() public {
        _fillAll();
        auction.cancelAuction();
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));

        auction.refundAll(30);
        // every bidder made whole
        for (uint256 i; i < UNITS; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether);
        }
        assertEq(nft.totalMinted(), 180); // nothing minted
    }

    function test_cancel_batchedRefundAll() public {
        _fillAll();
        auction.cancelAuction();
        auction.refundAll(12);
        auction.refundAll(12);
        auction.refundAll(12);
        for (uint256 i; i < UNITS; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether);
        }
    }

    function test_cancel_afterFinalizeReverts() public {
        _fillAll();
        _endAuction();
        auction.finalize(10); // enters Finalizing
        vm.expectRevert(PanoramaSeason3Auction.NotCancellable.selector);
        auction.cancelAuction();
    }

    function test_refundAll_requiresCancelled() public {
        _fillAll();
        vm.expectRevert(PanoramaSeason3Auction.NotCancelled.selector);
        auction.refundAll(30);
    }

    function test_cancel_onlyOwner() public {
        vm.prank(_actor(0));
        vm.expectRevert(Ownable.Unauthorized.selector);
        auction.cancelAuction();
    }

    /*//////////////////////////////////////////////////////////////
                          REENTRANCY / WITHDRAW
    //////////////////////////////////////////////////////////////*/

    function test_reentrancy_displacedBidder_blocked() public {
        // 29 normal + 1 reentrant bidder at the floor.
        for (uint256 i; i < 29; ++i) {
            _place(_actor(i), RESERVE + 0.001 ether + i * 0.001 ether);
        }
        ReentrantBidder rb = new ReentrantBidder(auction);
        rb.setMode(1); // try to re-enter placeBid on receive
        vm.deal(address(rb), RESERVE);
        rb.bid(RESERVE);

        // Outbid it: displacement force-send triggers receive -> nested placeBid reverts (guard),
        // force-send falls back to selfdestruct so the refund still lands and the outer bid succeeds.
        uint256 newBid = auction.minimumBid();
        vm.deal(_actor(500), newBid);
        vm.prank(_actor(500));
        auction.placeBid{ value: newBid }("");

        assertEq(address(rb).balance, RESERVE, "reentrant griefer refunded");
        assertEq(auction.activeBids(), 30);
    }

    function test_withdraw_nothingReverts() public {
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.NothingToWithdraw.selector);
        auction.withdraw();
    }

    /*//////////////////////////////////////////////////////////////
                                PAUSE
    //////////////////////////////////////////////////////////////*/

    function test_pause_blocksBids() public {
        auction.setPaused(true);
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3Auction.IsPaused.selector);
        auction.placeBid{ value: RESERVE }("");
        // unpausing restores bidding
        auction.setPaused(false);
        _place(_actor(0), RESERVE);
        assertEq(auction.activeBids(), 1);
    }

    /*//////////////////////////////////////////////////////////////
                            GAS BENCHMARKS
    //////////////////////////////////////////////////////////////*/

    function test_gas_placeBid_insert() public {
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        uint256 g = gasleft();
        auction.placeBid{ value: RESERVE }("");
        uint256 used = g - gasleft();
        assertLt(used, WRITE_GAS_LIMIT);
        emit log_named_uint("gas placeBid (insert)", used);
    }

    function test_gas_placeBid_displacement() public {
        _fillAll();
        uint256 newBid = auction.minimumBid();
        vm.deal(_actor(999), newBid);
        vm.prank(_actor(999));
        uint256 g = gasleft();
        auction.placeBid{ value: newBid }("");
        uint256 used = g - gasleft();
        assertLt(used, WRITE_GAS_LIMIT);
        emit log_named_uint("gas placeBid (displacement)", used);
    }

    function test_gas_placeBid_withMaxSignal() public {
        string memory signal = string(_repeat("a", 280));
        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        uint256 g = gasleft();
        auction.placeBid{ value: RESERVE }(signal);
        uint256 used = g - gasleft();
        assertLt(used, WRITE_GAS_LIMIT);
        emit log_named_uint("gas placeBid (insert, 280-byte signal)", used);
    }

    /// @dev Marks every account settlement touches as cold, so the measurement matches a fresh
    ///      transaction instead of the warm state this test built while placing the bids.
    function _coolSettlement(uint256 actors) internal {
        vm.cool(address(auction));
        vm.cool(address(nft));
        vm.cool(address(controller));
        vm.cool(payoutA);
        vm.cool(payoutB);
        for (uint256 i; i < actors; ++i) {
            vm.cool(_actor(i));
        }
    }

    /// @dev Descending-order settlement is O(winners) per mint. At 30 winners one finalize(30)
    ///      settles the whole sale in a single transaction well under the block limit.
    function test_gas_finalize_all30_singleBatch() public {
        _fillAll();
        _endAuction();
        _coolSettlement(UNITS);

        uint256 g = gasleft();
        auction.finalize(30);
        uint256 used = g - gasleft();
        assertLt(used, 6_000_000, "finalize(30) must stay far under the block limit");
        emit log_named_uint("gas finalize(30), 30 winners, cold (excl. 21k base)", used);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
    }

    function test_gas_finalize_twoBatchesOf15() public {
        _fillAll();
        _endAuction();
        _coolSettlement(UNITS);

        uint256 g = gasleft();
        auction.finalize(15);
        uint256 b1 = g - gasleft();
        assertLt(b1, WRITE_GAS_LIMIT, "finalize batch 1 must fit under 15M");
        emit log_named_uint("gas finalize(15) batch 1", b1);

        _coolSettlement(UNITS);
        g = gasleft();
        auction.finalize(15);
        uint256 b2 = g - gasleft();
        assertLt(b2, WRITE_GAS_LIMIT, "finalize batch 2 must fit under 15M");
        emit log_named_uint("gas finalize(15) batch 2", b2);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
    }

    /// @dev Worst case: every winner is a contract that burns the whole 100k refund stipend.
    function test_gas_finalize_all30_hostileReceivers() public {
        GasBurnerBidder[] memory burners = new GasBurnerBidder[](UNITS);
        for (uint256 i; i < UNITS; ++i) {
            burners[i] = new GasBurnerBidder(auction);
            uint256 amount = RESERVE + i * 0.001 ether;
            vm.deal(address(burners[i]), amount);
            burners[i].bid(amount);
        }
        _endAuction();
        _coolSettlement(0);
        for (uint256 i; i < UNITS; ++i) {
            vm.cool(address(burners[i]));
        }

        uint256 g = gasleft();
        auction.finalize(30);
        uint256 used = g - gasleft();
        assertLt(used, 10_000_000, "hostile finalize(30) must still fit comfortably");
        emit log_named_uint("gas finalize(30), 30 stipend-burning winners", used);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Settled));
        // 29 winners had excess over the clearing price; every push failed into the ledger.
        assertEq(auction.totalPendingReturns(), 29 * 15 * 0.001 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                FUZZ
    //////////////////////////////////////////////////////////////*/

    function testFuzz_heapRootIsMinimum(uint96[20] memory raw) public {
        uint256 minAmt = type(uint256).max;
        for (uint256 i; i < 20; ++i) {
            uint256 amt = RESERVE + (uint256(raw[i]) % 100_000) * TICK;
            if (amt < minAmt) minAmt = amt;
            _place(_actor(i), amt);
        }
        // The heap root must always be the smallest active bid.
        assertEq(auction.lowestActiveBid(), minAmt, "root must be the minimum bid");
    }

    function testFuzz_increaseNeverLowersClearing(uint96 add) public {
        // Actor 15 holds 0.115 and 0.100-0.129 are all taken, so start above 0.129.
        uint256 amount = bound(uint256(add), 15, 1_000_000) * TICK;
        _fillAll();
        uint256 before = auction.lowestActiveBid();
        // increase a mid bid
        _increase(_actor(15), 16, amount);
        assertGe(auction.lowestActiveBid(), before);
    }

    function testFuzz_endToEndSplitExact(uint8 n) public {
        uint256 winners = bound(n, 1, 12);
        for (uint256 i; i < winners; ++i) {
            _place(_actor(i), RESERVE);
        }
        _endAuction();
        auction.finalize(30);
        uint256 proceeds = winners * uint256(RESERVE);
        assertEq(payoutA.balance + payoutB.balance, proceeds, "split must not strand wei");
        assertEq(payoutA.balance, (proceeds * 5800) / 10_000);
        assertEq(address(auction).balance, 0, "no funds stuck after full settlement");
    }

    /*//////////////////////////////////////////////////////////////
                  M-3: FLOOR-BASED EXTENSION THRESHOLD
    //////////////////////////////////////////////////////////////*/

    function test_minIncreaseForExtension_isBpsOfFloor() public {
        assertEq(auction.minIncreaseForExtension(), 0, "no bids -> 0");
        _place(_actor(0), 1 ether); // floor = 1 ETH
        assertEq(auction.minIncreaseForExtension(), (uint256(1 ether) * INC_BPS) / 10_000); // 0.05
    }

    function test_increaseBid_trivialTopUp_revertsInsideExtensionWindow() public {
        uint32 id = _place(_actor(0), 1 ether); // floor 1 ETH, threshold 0.05
        vm.warp(auction.endTime() - 2 minutes); // inside the 5-min window
        uint64 endBefore = auction.endTime();

        vm.deal(_actor(0), TICK);
        vm.prank(_actor(0));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidIncreaseTooLow.selector, 0.05 ether));
        auction.increaseBid{ value: TICK }(id); // the smallest legal top-up
        assertEq(auction.endTime(), endBefore, "dust top-up must not extend");
        assertEq(auction.extensionCount(), 0);

        (, uint96 amt) = auction.bids(id);
        assertEq(amt, 1 ether, "rejected top-up must not mutate the bid");
    }

    function test_increaseBid_splitRaiseInSmartWallet_cannotBypassExtension() public {
        SplitIncreaseBidder smartWallet = new SplitIncreaseBidder(auction);
        vm.deal(address(smartWallet), 2 ether);
        smartWallet.bid(1 ether);
        uint32 id = 1;
        uint256 part = 0.05 ether - TICK; // each part one tick short of the threshold

        vm.warp(auction.endTime() - 1 minutes);
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidIncreaseTooLow.selector, 0.05 ether));
        smartWallet.splitIncrease(id, part, part);

        (, uint96 amount) = auction.bids(id);
        assertEq(amount, 1 ether, "atomic split raise must fully revert");
        assertEq(auction.extensionCount(), 0);
    }

    function test_increaseBid_thresholdIsFloorBased_notOwnBid() public {
        // A small floor bid sets the bar; a whale's huge bid does NOT raise their own bar.
        _place(_actor(1), RESERVE); // floor = 0.1 ETH -> threshold 0.005 ETH
        uint32 whaleId = _place(_actor(0), 10 ether); // whale; floor still 0.1
        assertEq(auction.minIncreaseForExtension(), 0.005 ether);

        vm.warp(auction.endTime() - 2 minutes);
        uint64 endBefore = auction.endTime();

        // Whale adds only 5% of the FLOOR (0.005), not 5% of their own 10 ETH (0.5): still extends.
        _increase(_actor(0), whaleId, 0.005 ether);
        assertGt(auction.endTime(), endBefore, "floor-sized top-up extends");
        assertEq(auction.extensionCount(), 1);
    }

    function test_increaseBid_belowFloorThreshold_reverts_whale() public {
        _place(_actor(1), RESERVE); // floor 0.1 -> threshold 0.005
        uint32 whaleId = _place(_actor(0), 10 ether);
        vm.warp(auction.endTime() - 2 minutes);
        uint64 endBefore = auction.endTime();

        vm.deal(_actor(0), 0.005 ether - TICK);
        vm.prank(_actor(0));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidIncreaseTooLow.selector, 0.005 ether));
        auction.increaseBid{ value: 0.005 ether - TICK }(whaleId);
        assertEq(auction.endTime(), endBefore, "rejected top-up cannot extend");
        assertEq(auction.extensionCount(), 0);
    }

    /*//////////////////////////////////////////////////////////////
              M-1/M-2: PERMISSIONLESS EMERGENCY REFUND
    //////////////////////////////////////////////////////////////*/

    function test_emergencyRefund_beforeGraceReverts() public {
        _fillAll();
        _endAuction();
        vm.warp(auction.endTime() + auction.FINALIZE_GRACE() + 1); // past finalize grace, not emergency
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.NotYetEmergency.selector);
        auction.emergencyRefund(30);
    }

    function test_emergencyRefund_afterSettledReverts() public {
        _fillAll();
        _endAuction();
        auction.finalize(30); // Settled
        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.AlreadySettled.selector);
        auction.emergencyRefund(30);
    }

    /// @dev M-1: auction fills, is NEVER authorized to mint, owner disappears. `finalize` is bricked
    ///      for everyone (even post-grace) yet anyone can still recover every bid in full.
    function test_emergencyRefund_neverAuthorized_permissionlessFullRefund() public {
        _fillAll();
        nft.setAuthorizedOperator(address(auction), false); // never authorized
        _endAuction();

        // finalize is bricked for everyone, even after the finalize grace.
        vm.warp(auction.endTime() + auction.FINALIZE_GRACE() + 1);
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.NotOperatorAuthorized.selector);
        auction.finalize(30);

        // After the emergency grace, a random caller refunds everyone in full.
        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        vm.prank(_actor(424_242));
        auction.emergencyRefund(30);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        for (uint256 i; i < UNITS; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether, "full refund");
        }
        assertEq(nft.totalMinted(), 180, "nothing minted");
        assertEq(address(auction).balance, 0, "no ETH stranded");
    }

    function test_emergencyRefund_batched() public {
        _fillAll();
        nft.setAuthorizedOperator(address(auction), false);
        _endAuction();
        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);

        auction.emergencyRefund(12);
        auction.emergencyRefund(12);
        auction.emergencyRefund(12); // idempotent tail is safe
        for (uint256 i; i < UNITS; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether);
        }
        assertEq(address(auction).balance, 0);
    }

    /// @dev M-2(a): owner starts settlement then bricks it (revokes mint auth) while `cancelAuction`
    ///      is already locked out. Emergency recovery still frees the unminted remainder in full,
    ///      leaves already-minted winners with their tokens, and releases their proceeds.
    function test_emergencyRefund_fromFinalizing_bricked_recoversRemainder() public {
        _fillAll(); // clearing = RESERVE (floor bid = actor 0)
        _endAuction();

        auction.finalize(10); // mints the highest 10 (actors 20..29) -> #181..#190
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Finalizing));
        assertEq(nft.totalMinted(), 190);
        uint96 cp = auction.clearingPrice();
        assertEq(cp, RESERVE);

        // Owner bricks the remainder and cannot cancel (not Active anymore).
        nft.setAuthorizedOperator(address(auction), false);
        vm.expectRevert(PanoramaSeason3Auction.NotOperatorAuthorized.selector);
        auction.finalize(10);
        vm.expectRevert(PanoramaSeason3Auction.NotCancellable.selector);
        auction.cancelAuction();

        // After the emergency grace, anyone recovers the 20 unminted bids in full.
        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        uint256 aBefore = payoutA.balance;
        uint256 bBefore = payoutB.balance;

        vm.prank(_actor(999));
        auction.emergencyRefund(30);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertEq(nft.totalMinted(), 190, "no further mints");

        // The 20 unminted bidders (actors 0..19) are refunded in full.
        for (uint256 i; i < 20; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether, "unminted bidder fully refunded");
        }
        // The 10 already-minted winners keep their tokens.
        for (uint256 t = FIRST_ID; t <= 190; ++t) {
            assertTrue(nft.ownerOf(t) != address(0));
        }
        // Proceeds for the 10 completed sales are released to the payout split.
        uint256 proceeds = 10 * uint256(cp);
        assertEq(payoutA.balance - aBefore, (proceeds * 5800) / 10_000);
        assertEq(payoutB.balance - bBefore, proceeds - (proceeds * 5800) / 10_000);
        assertEq(address(auction).balance, 0, "no ETH stranded after emergency recovery");
    }

    function test_emergencyRefund_composesWithPartialOwnerRefund() public {
        // Owner cancels + refunds part, then disappears; emergency completes the rest.
        _fillAll();
        auction.cancelAuction();
        auction.refundAll(12); // owner refunds the first 12

        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        vm.prank(_actor(999));
        auction.emergencyRefund(30); // shares refundCursor, finishes the remaining 18

        for (uint256 i; i < UNITS; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * 0.001 ether, "all fully refunded");
        }
        assertEq(address(auction).balance, 0);
    }

    /*//////////////////////////////////////////////////////////////
             POST-GRACE OBJECTIVE MINT-CAPABILITY RECOVERY
    //////////////////////////////////////////////////////////////*/

    function test_mintingUnavailable_viewsTrackAuthorizationAndCap() public {
        _place(_actor(0), RESERVE);
        _place(_actor(1), RESERVE + TICK);
        _place(_actor(2), RESERVE + 2 * TICK);

        assertEq(auction.requiredMintCapForSettlement(), 183);
        assertFalse(auction.mintingUnavailable());

        nft.setAuthorizedOperator(address(auction), false);
        assertTrue(auction.mintingUnavailable(), "missing authorization is unavailable");

        nft.setAuthorizedOperator(address(auction), true);
        controller.setSeasonMintCap(3, 2); // cumulative cap 182, but all three winners require 183
        assertTrue(auction.mintingUnavailable(), "insufficient cap is unavailable");

        controller.setSeasonMintCap(3, 3);
        assertFalse(auction.mintingUnavailable(), "exact remaining headroom is sufficient");
    }

    function test_recoverFromMintingUnavailable_finalizeGraceBoundary() public {
        _place(_actor(0), RESERVE);
        nft.setAuthorizedOperator(address(auction), false);
        _endAuction();

        uint256 eligibleAt = uint256(auction.endTime()) + auction.FINALIZE_GRACE();
        vm.warp(eligibleAt - 1);
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.NotYetMintingUnavailableRecovery.selector);
        auction.recoverFromMintingUnavailable(1);

        vm.warp(eligibleAt);
        vm.expectEmit();
        emit PanoramaSeason3Auction.MintingUnavailableRecoveryStarted(false, 210, 181, 0, 1);
        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(1);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertTrue(auction.refundsComplete());
        assertEq(_actor(0).balance, RESERVE);
    }

    function test_recoverFromMintingUnavailable_healthySettlementRejected() public {
        _place(_actor(0), RESERVE);
        controller.setSeasonMintCap(3, 1); // cumulative cap 181: exactly enough for the sole winner
        _endAuction();
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());

        assertEq(auction.requiredMintCapForSettlement(), 181);
        assertFalse(auction.mintingUnavailable());
        vm.prank(_actor(999));
        vm.expectRevert(PanoramaSeason3Auction.MintingStillAvailable.selector);
        auction.recoverFromMintingUnavailable(1);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Active));
        assertEq(auction.totalEscrowed(), RESERVE);
    }

    function test_recoverFromMintingUnavailable_zeroBatchReverts() public {
        _place(_actor(0), RESERVE);
        nft.setAuthorizedOperator(address(auction), false);
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());

        vm.expectRevert(PanoramaSeason3Auction.ZeroBatch.selector);
        auction.recoverFromMintingUnavailable(0);
    }

    function test_recoverFromMintingUnavailable_neverAuthorizedBatched() public {
        for (uint256 i; i < 5; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        nft.setAuthorizedOperator(address(auction), false);
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());

        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(2);
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertEq(auction.remainingBidCount(), 3);
        assertFalse(auction.refundsComplete());

        vm.prank(_actor(998));
        auction.refundAll(2);
        vm.prank(_actor(997));
        auction.refundAll(2);

        assertTrue(auction.refundsComplete());
        for (uint256 i; i < 5; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * TICK, "full refund");
        }
        assertEq(nft.totalMinted(), 180);
        assertEq(address(auction).balance, 0);
        assertEq(auction.requiredMintCapForSettlement(), 0, "terminal view is suppressed");
        assertFalse(auction.mintingUnavailable(), "terminal view is suppressed");
    }

    function test_recoverFromMintingUnavailable_activeInsufficientCap() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        controller.setSeasonMintCap(3, 2); // cap 182 < required 183
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());

        vm.expectEmit();
        emit PanoramaSeason3Auction.MintingUnavailableRecoveryStarted(true, 182, 183, 0, 3);
        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(10);

        assertTrue(auction.refundsComplete());
        assertEq(auction.totalEscrowed(), 0);
        assertEq(address(auction).balance, 0);
    }

    function test_recoverFromMintingUnavailable_partialFinalizeThenRevoke() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * 0.01 ether);
        }
        _endAuction();
        auction.finalize(1);
        assertEq(nft.ownerOf(181), _actor(2));
        assertEq(auction.requiredMintCapForSettlement(), 183);

        nft.setAuthorizedOperator(address(auction), false);
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());
        uint256 aBefore = payoutA.balance;
        uint256 bBefore = payoutB.balance;

        vm.expectEmit();
        emit PanoramaSeason3Auction.MintingUnavailableRecoveryStarted(false, 210, 183, 1, 2);
        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(1);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertEq(auction.finalizeCursor(), 1);
        assertEq(auction.remainingBidCount(), 1);
        assertEq(auction.unreleasedProceeds(), RESERVE, "proceeds wait for completed recovery");

        vm.prank(_actor(998));
        auction.refundAll(10);
        assertTrue(auction.refundsComplete());
        assertEq(_actor(0).balance, RESERVE);
        assertEq(_actor(1).balance, RESERVE + 0.01 ether);
        assertEq(nft.ownerOf(181), _actor(2), "already-minted winner keeps token");
        assertEq(payoutA.balance - aBefore, (uint256(RESERVE) * 5800) / 10_000);
        assertEq(payoutB.balance - bBefore, uint256(RESERVE) - (uint256(RESERVE) * 5800) / 10_000);
        assertEq(address(auction).balance, 0);
    }

    function test_recoverFromMintingUnavailable_partialFinalizeThenCapLowered() public {
        for (uint256 i; i < 5; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        _endAuction();
        auction.finalize(2);
        assertEq(auction.finalizeCursor(), 2);
        assertEq(auction.requiredMintCapForSettlement(), 185);

        controller.setSeasonMintCap(3, 2); // current cap 182: enough for minted tokens, not the remaining three
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());
        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(10);

        assertTrue(auction.refundsComplete());
        assertEq(auction.finalizeCursor(), 2);
        assertEq(nft.totalMinted(), 182);
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.unreleasedProceeds(), 0);
        assertEq(payoutA.balance + payoutB.balance, 2 * uint256(RESERVE));
        assertEq(address(auction).balance, 0);
    }

    function test_recoverFromMintingUnavailable_hostileRecipientsPreserveAccounting() public {
        RevertingReceiver rr = new RevertingReceiver(auction);
        ReentrantBidder rb = new ReentrantBidder(auction);
        vm.deal(address(rr), 1 ether);
        rr.bid(1 ether);
        vm.deal(address(rb), RESERVE);
        rb.bid(RESERVE);
        rb.setMode(2); // re-enter withdraw during the refund push

        nft.setAuthorizedOperator(address(auction), false);
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());
        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(10);

        assertTrue(auction.refundsComplete());
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.pendingReturns(address(rr)), 1 ether);
        assertEq(auction.pendingReturns(address(rb)), RESERVE);
        assertEq(auction.totalPendingReturns(), 1 ether + RESERVE);
        assertEq(auction.totalLiabilities(), 1 ether + RESERVE);
        assertEq(address(auction).balance, 1 ether + RESERVE);

        rr.withdraw();
        rb.setMode(0);
        vm.prank(address(rb));
        auction.withdraw();
        assertEq(auction.totalPendingReturns(), 0);
        assertEq(auction.totalLiabilities(), 0);
        assertEq(address(auction).balance, 0);
    }

    function testFuzz_recoverFromMintingUnavailable_batchesRemainSolvent(
        uint8 nSeed,
        uint8 batchSeed,
        bool revokeAuthorization
    ) public {
        uint256 n = bound(uint256(nSeed), 1, 20);
        uint256 batch = bound(uint256(batchSeed), 1, n);
        for (uint256 i; i < n; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        if (revokeAuthorization) {
            nft.setAuthorizedOperator(address(auction), false);
        } else {
            controller.setSeasonMintCap(3, n - 1); // one unit short of all winners
        }
        vm.warp(uint256(auction.endTime()) + auction.FINALIZE_GRACE());

        vm.prank(_actor(999));
        auction.recoverFromMintingUnavailable(batch);
        while (!auction.refundsComplete()) {
            vm.prank(_actor(998));
            auction.refundAll(batch);
        }

        for (uint256 i; i < n; ++i) {
            assertEq(_actor(i).balance, RESERVE + i * TICK, "every unminted bid fully refunded");
        }
        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.totalPendingReturns(), 0);
        assertEq(auction.totalLiabilities(), 0);
        assertEq(address(auction).balance, 0);
        assertEq(nft.totalMinted(), 180);
    }

    /*//////////////////////////////////////////////////////////////
              I-3: SETTLEMENT PROPERTY / SOLVENCY FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @dev Random bids + random batch size must settle to: descending id order (highest bid ->
    ///      earliest token), each winner minted exactly once, uniform price, exact split, zero dust.
    function testFuzz_settlement_orderingPriceSolvency(uint96[20] memory raw, uint8 batchSeed) public {
        uint256 n = 20; // < 30 -> undersubscribed, clearing = reserve, every bidder wins one
        uint256[] memory placed = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            // Distinct amounts: 1-ETH spacing dominates the sub-1-ETH jitter, so no ties.
            uint256 amt = RESERVE + i * 1 ether + (uint256(raw[i]) % 1000) * TICK;
            placed[i] = amt;
            _place(_actor(i), amt);
        }
        _endAuction();

        uint256 batch = 1 + (uint256(batchSeed) % 20);
        while (uint256(auction.phase()) < uint256(PanoramaSeason3Auction.Phase.Settled)) {
            auction.finalize(batch);
        }

        // Each of the n bidders won exactly one token; nothing over-minted.
        assertEq(nft.totalMinted(), BASELINE + n);
        for (uint256 i; i < n; ++i) {
            assertEq(nft.balanceOf(_actor(i)), 1, "each bidder minted exactly once");
        }

        // Ascending token ids <=> descending bids (highest bid -> #181 -> earliest reveal).
        for (uint256 t = FIRST_ID; t < BASELINE + n; ++t) {
            uint256 k1 = uint160(nft.ownerOf(t)) - 0x100000;
            uint256 k2 = uint160(nft.ownerOf(t + 1)) - 0x100000;
            assertGe(placed[k1], placed[k2], "ids ascending must be bids descending");
        }

        // Uniform price = reserve (undersubscribed); exact split; no wei stranded.
        assertEq(auction.clearingPrice(), RESERVE);
        uint256 proceeds = n * uint256(RESERVE);
        assertEq(payoutA.balance, (proceeds * 5800) / 10_000);
        assertEq(payoutB.balance, proceeds - (proceeds * 5800) / 10_000);
        assertEq(address(auction).balance, 0, "no funds stuck after settlement");
    }

    /// @dev Oversubscribed: clearing price rises above reserve and every winner pays it uniformly.
    function test_finalize_oversubscribed_clearingAboveReserve() public {
        for (uint256 i; i < UNITS; ++i) {
            _place(_actor(i), 1 ether + i * 0.01 ether); // 1.00 .. 1.29, floor = 1.00
        }
        // Displace the floor so the 30th-highest (the new clearing) is actor(1) at 1.01.
        uint256 nb = auction.minimumBid();
        _place(_actor(1000), nb);
        assertEq(auction.currentClearingPrice(), 1.01 ether);

        _endAuction();
        auction.finalize(30);

        assertEq(auction.clearingPrice(), 1.01 ether, "clearing = 30th-highest, above reserve");
        uint256 proceeds = 30 * uint256(1.01 ether);
        assertEq(payoutA.balance, (proceeds * 5800) / 10_000);
        assertEq(payoutB.balance, proceeds - (proceeds * 5800) / 10_000);
        assertEq(address(auction).balance, 0, "no funds stuck");
    }

    /*//////////////////////////////////////////////////////////////
                   REMEDIATION REGRESSION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_finalize_competingMintBeforeFirstBatch_revertsWithoutStateChange() public {
        _place(_actor(0), RESERVE);
        _endAuction();

        nft.mintTo(_actor(999)); // consumes #181 outside the auction
        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedSupply.selector, uint256(180), uint256(181))
        );
        auction.finalize(1);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Active));
        assertEq(auction.finalizeCursor(), 0);
        assertEq(auction.remainingBidCount(), 1);
        assertEq(auction.totalEscrowed(), RESERVE);
    }

    function test_finalize_competingMintBetweenBatches_revertsAndEmergencyRecovers() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * 0.01 ether);
        }
        _endAuction();
        auction.finalize(1); // actor(2) receives #181
        assertEq(nft.ownerOf(181), _actor(2));

        nft.mintTo(_actor(999)); // outsider consumes #182
        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedSupply.selector, uint256(181), uint256(182))
        );
        auction.finalize(2);

        assertEq(auction.finalizeCursor(), 1);
        assertEq(auction.remainingBidCount(), 2);
        assertEq(auction.unreleasedProceeds(), RESERVE);

        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        vm.prank(_actor(777));
        auction.emergencyRefund(10);

        assertTrue(auction.refundsComplete());
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.unreleasedProceeds(), 0);
        assertEq(payoutA.balance + payoutB.balance, RESERVE, "completed mint proceeds released");
        assertEq(_actor(0).balance, RESERVE, "unminted floor bid fully refunded");
        assertEq(_actor(1).balance, RESERVE + 0.01 ether, "unminted bid fully refunded");
    }

    function test_finalize_competingMintBetweenFullSaleBatches_cannotStealSlot() public {
        _fillAll();
        _endAuction();
        auction.finalize(15);
        assertEq(nft.totalMinted(), 195);

        nft.mintTo(_actor(999)); // consumes #196 and would previously shift/brick the remaining sale
        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedSupply.selector, uint256(195), uint256(196))
        );
        auction.finalize(15);

        assertEq(auction.finalizeCursor(), 15);
        assertEq(auction.remainingBidCount(), 15);
        assertEq(nft.totalMinted(), 196);
    }

    function test_supplyMismatch_finalizing_allowsImmediatePermissionlessRecovery() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * 0.01 ether);
        }
        _endAuction();
        auction.finalize(1);

        assertEq(auction.expectedNftSupply(), 181);
        assertFalse(auction.supplyMismatched());
        assertEq(nft.ownerOf(181), _actor(2));
        assertEq(auction.unreleasedProceeds(), RESERVE);

        nft.mintTo(_actor(999)); // outsider consumes auction-expected #182
        assertEq(nft.totalMinted(), 182);
        assertTrue(auction.supplyMismatched());

        uint256 aBefore = payoutA.balance;
        uint256 bBefore = payoutB.balance;
        vm.prank(_actor(777)); // no grace wait once finalization has started
        auction.recoverFromSupplyMismatch(10);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertTrue(auction.refundsComplete());
        assertFalse(auction.supplyMismatched(), "terminal phase must suppress stale mismatch alert");
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.unreleasedProceeds(), 0);
        assertEq(_actor(0).balance, RESERVE);
        assertEq(_actor(1).balance, RESERVE + 0.01 ether);

        uint256 completedProceeds = RESERVE;
        assertEq(payoutA.balance - aBefore, (completedProceeds * 5800) / 10_000);
        assertEq(payoutB.balance - bBefore, completedProceeds - (completedProceeds * 5800) / 10_000);
        assertEq(address(auction).balance, auction.totalPendingReturns(), "no proceeds or escrow stranded");
    }

    function test_supplyMismatch_active_arbitraryCallerRecoversImmediately() public {
        _place(_actor(0), RESERVE);
        _place(_actor(1), RESERVE + TICK);
        nft.mintTo(_actor(999));

        assertEq(auction.expectedNftSupply(), 180);
        assertTrue(auction.supplyMismatched());
        assertLt(block.timestamp, auction.endTime(), "recovery is immediate, before auction end");

        vm.prank(_actor(777));
        auction.recoverFromSupplyMismatch(10);

        assertEq(uint256(auction.phase()), uint256(PanoramaSeason3Auction.Phase.Cancelled));
        assertTrue(auction.refundsComplete());
        assertFalse(auction.supplyMismatched(), "terminal phase must suppress stale mismatch alert");
        assertEq(_actor(0).balance, RESERVE);
        assertEq(_actor(1).balance, RESERVE + TICK);
        assertEq(address(auction).balance, 0);
    }

    function test_supplyMismatch_placeBidFailsClosedWithoutAcceptingETH() public {
        nft.mintTo(_actor(999));
        address bidder = _actor(777);
        vm.deal(bidder, RESERVE);

        vm.prank(bidder);
        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedSupply.selector, uint256(180), uint256(181))
        );
        auction.placeBid{ value: RESERVE }("");

        assertEq(bidder.balance, RESERVE, "reverted bid value must remain with bidder");
        assertEq(address(auction).balance, 0);
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.nextBidId(), 1, "rejected bid must not consume an id");
    }

    function test_supplyMismatch_increaseBidFailsClosedWithoutAcceptingETH() public {
        address bidder = _actor(0);
        uint32 bidId = _place(bidder, RESERVE);
        nft.mintTo(_actor(999));
        uint256 topUp = 0.01 ether;
        vm.deal(bidder, topUp);

        vm.prank(bidder);
        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedSupply.selector, uint256(180), uint256(181))
        );
        auction.increaseBid{ value: topUp }(bidId);

        (, uint96 amount) = auction.bids(bidId);
        assertEq(amount, RESERVE, "rejected increase must not mutate bid");
        assertEq(bidder.balance, topUp, "reverted top-up must remain with bidder");
        assertEq(address(auction).balance, RESERVE);
        assertEq(auction.totalEscrowed(), RESERVE);
        assertEq(auction.remainingBidCount(), 1);
    }

    function test_supplyMismatch_recoveryRequiresActualMismatch() public {
        assertEq(auction.expectedNftSupply(), 180);
        assertFalse(auction.supplyMismatched());

        vm.expectRevert(PanoramaSeason3Auction.SupplyNotMismatched.selector);
        auction.recoverFromSupplyMismatch(1);

        _place(_actor(0), RESERVE);
        _place(_actor(1), RESERVE + TICK);
        _endAuction();
        auction.finalize(1);
        assertEq(auction.expectedNftSupply(), 181);
        assertFalse(auction.supplyMismatched());

        vm.prank(_actor(777));
        vm.expectRevert(PanoramaSeason3Auction.SupplyNotMismatched.selector);
        auction.recoverFromSupplyMismatch(1);
    }

    function test_finalize_wrongReturnedTokenId_revertsAtomically() public {
        WrongIdPanorama wrong = new WrongIdPanorama();
        uint64 start = uint64(block.timestamp + 1 hours);
        PanoramaSeason3Auction guarded = new PanoramaSeason3Auction(
            address(wrong), RESERVE, INC_BPS, start, DURATION, payoutA, payoutB, address(signals)
        );
        wrong.setAuthorizedOperator(address(guarded), true);
        vm.warp(start);

        vm.deal(_actor(0), RESERVE);
        vm.prank(_actor(0));
        guarded.placeBid{ value: RESERVE }("");
        vm.warp(guarded.endTime() + 1);

        vm.expectRevert(
            abi.encodeWithSelector(PanoramaSeason3Auction.UnexpectedTokenId.selector, uint256(181), uint256(182))
        );
        guarded.finalize(1);

        assertEq(wrong.totalMinted(), 180, "mock mint must roll back with settlement");
        assertEq(uint256(guarded.phase()), uint256(PanoramaSeason3Auction.Phase.Active));
        assertEq(guarded.remainingBidCount(), 1);
        assertEq(guarded.totalEscrowed(), RESERVE);
    }

    function test_recovery_mixedEmergencyThenRefundAll_releasesPartialFinalizeProceeds() public {
        _fillAll();
        _endAuction();
        auction.finalize(10);
        uint256 expectedProceeds = 10 * uint256(RESERVE);
        assertEq(auction.unreleasedProceeds(), expectedProceeds);

        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE() + 1);
        vm.prank(_actor(10_000));
        auction.emergencyRefund(1);
        assertFalse(auction.refundsComplete());

        vm.prank(_actor(10_001)); // refundAll is deliberately permissionless after cancellation
        auction.refundAll(200);

        assertTrue(auction.refundsComplete());
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.unreleasedProceeds(), 0);
        assertEq(payoutA.balance, (expectedProceeds * 5800) / 10_000);
        assertEq(payoutB.balance, expectedProceeds - (expectedProceeds * 5800) / 10_000);
        assertEq(address(auction).balance, auction.totalPendingReturns(), "no proceeds stranded");
    }

    function test_emergencyRefund_usesImmutableAbsoluteDeadlineBoundary() public {
        _place(_actor(0), RESERVE);
        vm.warp(auction.absoluteEndTime() + auction.EMERGENCY_GRACE());
        vm.expectRevert(PanoramaSeason3Auction.NotYetEmergency.selector);
        auction.emergencyRefund(1);

        vm.warp(block.timestamp + 1);
        vm.prank(_actor(999));
        auction.emergencyRefund(1);
        assertTrue(auction.refundsComplete());
        assertEq(_actor(0).balance, RESERVE);
    }

    function test_cancel_refundAllIsImmediatelyPermissionless() public {
        _place(_actor(0), RESERVE);
        _place(_actor(1), RESERVE + TICK);
        auction.cancelAuction();

        vm.prank(_actor(999));
        auction.refundAll(10);

        assertTrue(auction.refundsComplete());
        assertEq(_actor(0).balance, RESERVE);
        assertEq(_actor(1).balance, RESERVE + TICK);
        assertEq(auction.remainingBidCount(), 0);
    }

    function test_cancel_withoutBids_completesRecoveryImmediately() public {
        auction.cancelAuction();
        assertTrue(auction.refundsComplete());
        assertEq(auction.remainingBidCount(), 0);
        assertEq(auction.totalLiabilities(), 0);
    }

    function test_refundAll_revertingAndReentrantRecipient_preservesSolvency() public {
        ReentrantBidder rb = new ReentrantBidder(auction);
        vm.deal(address(rb), RESERVE);
        rb.bid(RESERVE);
        rb.setMode(2); // nested withdraw attempt makes the push fail

        auction.cancelAuction();
        vm.prank(_actor(999));
        auction.refundAll(1);

        assertEq(auction.totalEscrowed(), 0);
        assertEq(auction.pendingReturns(address(rb)), RESERVE);
        assertEq(auction.totalPendingReturns(), RESERVE);
        assertEq(address(auction).balance, RESERVE);

        vm.prank(address(rb));
        auction.withdraw();
        assertEq(auction.totalPendingReturns(), 0);
        assertEq(address(auction).balance, 0);
        assertEq(address(rb).balance, RESERVE);
    }

    function test_terminalViews_areCompactAfterPartialAndFullFinalize() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        _endAuction();
        auction.finalize(1);

        assertEq(auction.activeBids(), 2);
        assertEq(auction.remainingBidCount(), 2);
        assertEq(auction.activeBidCount(_actor(2)), 0);
        (uint32[] memory ids, address[] memory bidders, uint96[] memory amounts) = auction.getBids();
        assertEq(ids.length, 2);
        assertEq(bidders.length, 2);
        assertEq(amounts.length, 2);
        for (uint256 i; i < ids.length; ++i) {
            assertTrue(ids[i] != 0 && bidders[i] != address(0) && amounts[i] != 0, "no deleted slots exposed");
        }
        (uint32[] memory wonIds,) = auction.bidsOf(_actor(2));
        assertEq(wonIds.length, 0);

        auction.finalize(10);
        assertEq(auction.activeBids(), 0);
        assertEq(auction.remainingBidCount(), 0);
        (ids, bidders, amounts) = auction.getBids();
        assertEq(ids.length, 0);
        assertEq(bidders.length, 0);
        assertEq(amounts.length, 0);
        assertFalse(auction.isFull());
    }

    function test_terminalViews_areCompactDuringCancellationRefunds() public {
        for (uint256 i; i < 3; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        auction.cancelAuction();
        auction.refundAll(1);

        assertEq(auction.activeBids(), 2);
        (uint32[] memory ids, address[] memory bidders, uint96[] memory amounts) = auction.getBids();
        assertEq(ids.length, 2);
        assertEq(bidders.length, 2);
        assertEq(amounts.length, 2);

        auction.refundAll(10);
        assertTrue(auction.refundsComplete());
        assertEq(auction.activeBids(), 0);
        (ids,,) = auction.getBids();
        assertEq(ids.length, 0);
    }

    function test_equalBids_earliestBidIdGetsEarliestReveal() public {
        _place(_actor(0), 1 ether); // id 1
        _place(_actor(1), 1 ether); // id 2
        _place(_actor(2), 1 ether); // id 3
        _endAuction();
        auction.finalize(3);

        assertEq(nft.ownerOf(181), _actor(0));
        assertEq(nft.ownerOf(182), _actor(1));
        assertEq(nft.ownerOf(183), _actor(2));
    }

    function test_equalFloorBids_displacementEvictsLatestNotEarliest() public {
        for (uint256 i; i < UNITS; ++i) {
            _place(_actor(i), RESERVE);
        }
        assertEq(auction.lowestActiveBid(), RESERVE);

        uint256 challengerAmount = auction.minimumBid();
        _place(_actor(999), challengerAmount);

        (address firstBidder,) = auction.bids(1);
        (address latestBidder,) = auction.bids(30);
        assertEq(firstBidder, _actor(0), "earliest equal floor bid must survive");
        assertEq(latestBidder, address(0), "latest equal floor bid must be displaced first");
        assertEq(_actor(29).balance, RESERVE, "latest tied bidder refunded");

        _endAuction();
        auction.finalize(30);
        assertEq(nft.ownerOf(181), _actor(999), "strictly higher challenger first");
        assertEq(nft.ownerOf(182), _actor(0), "earliest retained tie next");
        assertEq(nft.ownerOf(210), _actor(28), "latest retained tie last");
    }

    function test_equalizedByIncrease_earliestBidStillWinsTie() public {
        _place(_actor(0), 1 ether); // earlier id already at target
        uint32 later = _place(_actor(1), RESERVE);
        _increase(_actor(1), later, 0.9 ether); // equal amount reached by increase
        _endAuction();
        auction.finalize(2);

        assertEq(nft.ownerOf(181), _actor(0));
        assertEq(nft.ownerOf(182), _actor(1));
    }

    /// @dev Ceiling bps math, then rounded up to the tick: a floor of 0.111 ETH plus 5% is 0.11655,
    ///      so the minimum is 0.117; the 5% extension threshold 0.00555 rounds up to 0.006.
    function test_bpsMath_roundsUpToTickForMinimumBidAndExtensionThreshold() public {
        uint64 start = uint64(block.timestamp + 1 hours);
        uint96 reserve = 0.111 ether;
        PanoramaSeason3Auction a = new PanoramaSeason3Auction(
            address(nft), reserve, INC_BPS, start, DURATION, payoutA, payoutB, address(signals)
        );
        nft.setAuthorizedOperator(address(a), true);
        vm.warp(start);

        for (uint256 i; i < UNITS; ++i) {
            vm.deal(_actor(i), reserve);
            vm.prank(_actor(i));
            a.placeBid{ value: reserve }(""); // ties are allowed before the auction is full
        }

        assertEq(a.minimumBid(), 0.117 ether, "0.111 + 5% = 0.11655 rounds up to 0.117");
        assertEq(a.minIncreaseForExtension(), 0.006 ether, "0.00555 rounds up to 0.006");

        vm.deal(_actor(500), 0.117 ether);
        vm.prank(_actor(500));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidTooLow.selector, 0.117 ether));
        a.placeBid{ value: 0.116 ether }("");
        vm.prank(_actor(500));
        a.placeBid{ value: 0.117 ether }("");

        vm.warp(a.endTime() - 1 minutes);
        vm.deal(_actor(1), 0.005 ether);
        vm.prank(_actor(1));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.BidIncreaseTooLow.selector, 0.006 ether));
        a.increaseBid{ value: 0.005 ether }(2);
    }

    function test_surplusETH_cannotRescueUntilTerminal_andNeverTouchesLiabilities() public {
        _place(_actor(0), RESERVE);
        AuctionForceETH donor = new AuctionForceETH{ value: 1 ether }();
        donor.force(payable(address(auction)));

        assertEq(auction.totalLiabilities(), RESERVE);
        assertEq(auction.surplusETH(), 1 ether);
        vm.expectRevert(PanoramaSeason3Auction.RecoveryIncomplete.selector);
        auction.rescueSurplusETH(_actor(999));

        auction.cancelAuction();
        vm.prank(_actor(777));
        auction.refundAll(1);
        assertTrue(auction.refundsComplete());
        assertEq(auction.totalLiabilities(), 0);
        assertEq(address(auction).balance, 1 ether);

        vm.prank(_actor(999));
        vm.expectRevert(Ownable.Unauthorized.selector);
        auction.rescueSurplusETH(_actor(999));

        auction.rescueSurplusETH(_actor(999));
        assertEq(_actor(999).balance, 1 ether);
        assertEq(address(auction).balance, 0);
    }

    function test_surplusETH_rescueLeavesFailedRefundLedgerFullyBacked() public {
        RevertingReceiver rr = new RevertingReceiver(auction);
        vm.deal(address(rr), 1 ether);
        rr.bid(1 ether);
        AuctionForceETH donor = new AuctionForceETH{ value: 2 ether }();
        donor.force(payable(address(auction)));

        auction.cancelAuction();
        auction.refundAll(1); // refund push fails and becomes a pull-payment liability
        assertEq(auction.totalPendingReturns(), 1 ether);
        assertEq(auction.surplusETH(), 2 ether);

        auction.rescueSurplusETH(_actor(999));
        assertEq(_actor(999).balance, 2 ether);
        assertEq(address(auction).balance, 1 ether);
        assertEq(auction.totalLiabilities(), 1 ether);

        rr.withdraw();
        assertEq(address(rr).balance, 1 ether);
        assertEq(address(auction).balance, 0);
    }

    function test_payableOwnershipHandoverETH_isTrackedAsSurplusAndRecoverable() public {
        address pendingOwner = _actor(555);
        vm.deal(pendingOwner, 0.25 ether);
        vm.prank(pendingOwner);
        auction.requestOwnershipHandover{ value: 0.25 ether }();

        assertEq(address(auction).balance, 0.25 ether);
        assertEq(auction.totalLiabilities(), 0);
        assertEq(auction.surplusETH(), 0.25 ether);
        vm.expectRevert(PanoramaSeason3Auction.RecoveryIncomplete.selector);
        auction.rescueSurplusETH(_actor(999));

        auction.cancelAuction(); // zero bids completes recovery immediately
        auction.rescueSurplusETH(_actor(999));
        assertEq(_actor(999).balance, 0.25 ether);
        assertEq(address(auction).balance, 0);
    }

    function test_rescueAccidentalERC20AndERC721() public {
        AuctionTestERC20 token = new AuctionTestERC20();
        token.mint(address(auction), 123 ether);

        address recipient = _actor(999);
        auction.rescueERC20(address(token), recipient, 123 ether);
        assertEq(token.balanceOf(recipient), 123 ether);
        assertEq(token.balanceOf(address(auction)), 0);

        nft.transferFrom(owner, address(auction), 1);
        assertEq(nft.ownerOf(1), address(auction));
        auction.rescueERC721(address(nft), recipient, 1);
        assertEq(nft.ownerOf(1), recipient);
    }

    /*//////////////////////////////////////////////////////////////
                              BID SIGNALS
    //////////////////////////////////////////////////////////////*/

    function test_signal_emptyEmitsBidPlacedButNoBidSignalSet() public {
        address bidder = _actor(0);
        vm.deal(bidder, RESERVE);
        vm.recordLogs();
        vm.expectEmit(address(auction));
        emit PanoramaSeason3Auction.BidPlaced(1, bidder, RESERVE);
        vm.prank(bidder);
        auction.placeBid{ value: RESERVE }("");

        assertEq(_signalLogCount(vm.getRecordedLogs()), 0, "empty signal must not emit BidSignalSet");
        assertEq(bytes(signals.bidSignal(1)).length, 0, "nothing stored for an empty signal");
        (address stored, uint96 amount) = auction.bids(1);
        assertEq(stored, bidder);
        assertEq(amount, RESERVE);
    }

    function test_signal_nonEmptyEmitsBidSignalSetAfterBidPlaced() public {
        address bidder = _actor(7);
        string memory signal = "a city that forgets the river under it";
        _place(_actor(0), RESERVE); // id 1, so the signalled bid is id 2

        vm.deal(bidder, 0.2 ether);
        vm.expectEmit(address(auction));
        emit PanoramaSeason3Auction.BidPlaced(2, bidder, 0.2 ether);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.BidSignalSet(2, bidder, signal);
        vm.prank(bidder);
        auction.placeBid{ value: 0.2 ether }(signal);
        assertEq(signals.bidSignal(2), signal, "stored in the controller under the bid id");
        assertEq(bytes(signals.bidSignal(1)).length, 0);
    }

    function test_signal_logCarriesExactIdBidderAndText() public {
        address bidder = _actor(3);
        string memory signal = "the last payphone on the street";
        vm.deal(bidder, RESERVE);
        vm.recordLogs();
        vm.prank(bidder);
        auction.placeBid{ value: RESERVE }(signal);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_signalLogCount(logs), 1);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != PanoramaSeason3SignalController.BidSignalSet.selector) continue;
            assertEq(logs[i].topics.length, 3);
            assertEq(uint256(logs[i].topics[1]), 1, "bidId topic");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), bidder, "bidder topic");
            assertEq(abi.decode(logs[i].data, (string)), signal, "signal text");
        }
    }

    function test_signal_exactly280BytesAccepted() public {
        string memory signal = string(_repeat("x", 280));
        assertEq(bytes(signal).length, signals.MAX_SIGNAL_BYTES());
        vm.deal(_actor(0), RESERVE);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.BidSignalSet(1, _actor(0), signal);
        vm.prank(_actor(0));
        auction.placeBid{ value: RESERVE }(signal);
        assertEq(auction.activeBids(), 1);
        assertEq(signals.bidSignal(1), signal);
    }

    function test_signal_281BytesRevertsWithoutAcceptingETH() public {
        string memory signal = string(_repeat("x", 281));
        address bidder = _actor(0);
        vm.deal(bidder, RESERVE);
        vm.prank(bidder);
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        auction.placeBid{ value: RESERVE }(signal);

        assertEq(bidder.balance, RESERVE, "rejected bid value stays with the bidder");
        assertEq(address(auction).balance, 0);
        assertEq(auction.nextBidId(), 1, "rejected bid must not consume an id");
        assertEq(auction.activeBids(), 0);
        assertEq(bytes(signals.bidSignal(1)).length, 0);
    }

    /// @dev The limit counts UTF-8 bytes, not characters: 140 two-byte characters fit exactly,
    ///      141 (282 bytes) do not, and 70 four-byte characters fit while 71 do not.
    function test_signal_multibyteUtf8CountedInBytes() public {
        bytes memory twoByte = hex"c3a9"; // U+00E9
        bytes memory fourByte = hex"f09f8c8a"; // U+1F30A

        string memory fits2 = string(_repeat(twoByte, 140));
        string memory over2 = string(_repeat(twoByte, 141));
        string memory fits4 = string(_repeat(fourByte, 70));
        string memory over4 = string(_repeat(fourByte, 71));
        assertEq(bytes(fits2).length, 280);
        assertEq(bytes(over2).length, 282);
        assertEq(bytes(fits4).length, 280);
        assertEq(bytes(over4).length, 284);

        _placeWithSignal(_actor(0), RESERVE, fits2);
        _placeWithSignal(_actor(1), RESERVE, fits4);
        assertEq(auction.activeBids(), 2);

        vm.deal(_actor(2), 2 * RESERVE);
        vm.startPrank(_actor(2));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        auction.placeBid{ value: RESERVE }(over2);
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        auction.placeBid{ value: RESERVE }(over4);
        vm.stopPrank();
        assertEq(auction.activeBids(), 2);
    }

    function test_signal_displacingBidCarriesSignal() public {
        _fillAll();
        address lowest = _actor(0);
        address challenger = _actor(999);
        string memory signal = "the village keeps one lamp lit";
        uint256 amount = auction.minimumBid();
        uint32 newId = auction.nextBidId();
        vm.deal(challenger, amount);

        vm.expectEmit(address(auction));
        emit PanoramaSeason3Auction.BidDisplaced(1, lowest, RESERVE);
        vm.expectEmit(address(auction));
        emit PanoramaSeason3Auction.BidPlaced(newId, challenger, uint96(amount));
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.BidSignalSet(newId, challenger, signal);
        vm.expectEmit(address(auction));
        emit PanoramaSeason3Auction.Refunded(lowest, RESERVE);
        vm.prank(challenger);
        auction.placeBid{ value: amount }(signal);

        assertEq(lowest.balance, RESERVE, "displaced bidder refunded in full");
        assertEq(auction.activeBids(), 30);
        assertEq(auction.currentClearingPrice(), RESERVE + 0.001 ether);
        assertEq(signals.bidSignal(newId), signal);
    }

    function test_constructor_rejectsMissingSignalController() public {
        uint64 futureStart = uint64(block.timestamp + 1 hours);
        assertEq(address(auction.signalController()), address(signals));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), RESERVE, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(0));
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(address(nft), RESERVE, INC_BPS, futureStart, DURATION, payoutA, payoutB, _actor(5));
    }

    /// @dev If the controller was never pointed at this auction, a signalled bid reverts as a whole
    ///      (no ETH taken, no id used) while a bid without a signal still works.
    function test_signal_unwiredControllerRevertsSignalledBidOnly() public {
        uint64 start = uint64(block.timestamp + 1 hours);
        PanoramaSeason3SignalController unwired = new PanoramaSeason3SignalController(address(nft));
        PanoramaSeason3Auction a = new PanoramaSeason3Auction(
            address(nft), RESERVE, INC_BPS, start, DURATION, payoutA, payoutB, address(unwired)
        );
        vm.warp(start);
        vm.deal(_actor(0), 2 * RESERVE);
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3SignalController.NotAuction.selector);
        a.placeBid{ value: RESERVE }("hello");
        assertEq(a.nextBidId(), 1);
        assertEq(_actor(0).balance, 2 * RESERVE);
        vm.prank(_actor(0));
        a.placeBid{ value: RESERVE }("");
        assertEq(a.activeBids(), 1);
    }

    function test_signal_increaseBidNeverEmitsSignal() public {
        uint32 id = _placeWithSignal(_actor(0), RESERVE, "first words");
        vm.recordLogs();
        _increase(_actor(0), id, 0.5 ether);
        assertEq(_signalLogCount(vm.getRecordedLogs()), 0, "increaseBid takes no signal");
        (, uint96 amount) = auction.bids(id);
        assertEq(amount, uint256(RESERVE) + 0.5 ether);
    }

    /// @dev One full auction (ties, displacements, an increase, settlement) run twice from the
    ///      same state: once with no signals, once with every kind of signal. Rank, clearing
    ///      price, mint order, refunds and payouts must be identical.
    function test_signal_neverChangesOrderingClearingOrSettlement() public {
        uint256 snapshot = vm.snapshotState();
        bytes32 plain = _signalScenario(false);
        vm.revertToState(snapshot);
        bytes32 signalled = _signalScenario(true);
        assertEq(signalled, plain, "signals must not change any economic outcome");
    }

    function _scenarioSignal(bool withSignals, uint256 i) internal pure returns (string memory) {
        if (!withSignals) return "";
        if (i % 3 == 0) return "";
        if (i % 3 == 1) return "a quieter interface";
        return string(_repeat(hex"c3a9", 140)); // the longest allowed signal, multibyte
    }

    function _signalScenario(bool withSignals) internal returns (bytes32) {
        // 30 bids with heavy ties (seven price levels), filling every slot.
        for (uint256 i; i < UNITS; ++i) {
            _placeWithSignal(_actor(i), RESERVE + (i % 7) * 0.01 ether, _scenarioSignal(withSignals, i));
        }
        // Three displacing bids and one increase.
        for (uint256 j; j < 3; ++j) {
            _placeWithSignal(_actor(100 + j), auction.minimumBid(), _scenarioSignal(withSignals, j + 1));
        }
        _increase(_actor(5), 6, 0.02 ether);
        uint256 clearingBeforeEnd = auction.currentClearingPrice();
        (uint32[] memory ids,, uint96[] memory amounts) = auction.getBids();

        _endAuction();
        auction.finalize(30);

        bytes memory acc = abi.encode(clearingBeforeEnd, ids, amounts, auction.clearingPrice());
        for (uint256 t = FIRST_ID; t <= LAST_ID; ++t) {
            acc = bytes.concat(acc, abi.encode(nft.ownerOf(t)));
        }
        for (uint256 i; i < UNITS; ++i) {
            acc = bytes.concat(acc, abi.encode(_actor(i).balance, auction.pendingReturns(_actor(i))));
        }
        for (uint256 j; j < 3; ++j) {
            acc = bytes.concat(acc, abi.encode(_actor(100 + j).balance));
        }
        acc = bytes.concat(acc, abi.encode(payoutA.balance, payoutB.balance, address(auction).balance));
        return keccak256(acc);
    }

    function testFuzz_signal_lengthBoundary(uint16 lenSeed, bytes1 fill) public {
        uint256 len = bound(uint256(lenSeed), 0, 600);
        bytes memory raw = new bytes(len);
        for (uint256 i; i < len; ++i) {
            raw[i] = fill;
        }
        address bidder = _actor(1);
        vm.deal(bidder, RESERVE);

        if (len > 280) {
            vm.prank(bidder);
            vm.expectRevert(
                abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280))
            );
            auction.placeBid{ value: RESERVE }(string(raw));
            assertEq(auction.nextBidId(), 1);
            assertEq(bidder.balance, RESERVE);
            return;
        }

        vm.recordLogs();
        vm.prank(bidder);
        auction.placeBid{ value: RESERVE }(string(raw));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_signalLogCount(logs), len == 0 ? 0 : 1);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == PanoramaSeason3SignalController.BidSignalSet.selector) {
                assertEq(keccak256(bytes(abi.decode(logs[i].data, (string)))), keccak256(raw));
            }
        }
        (address stored, uint96 amount) = auction.bids(1);
        assertEq(stored, bidder);
        assertEq(amount, RESERVE, "signal never changes the bid amount");
        assertEq(auction.totalEscrowed(), RESERVE);
    }

    /// @dev The contract checks only the byte length. Content (including control characters and
    ///      invalid UTF-8) passes through verbatim, so every reader must sanitize before display.
    function testFuzz_signal_arbitraryBytesPassThroughVerbatim(bytes memory raw) public {
        address bidder = _actor(2);
        vm.deal(bidder, RESERVE);
        if (raw.length > 280) {
            vm.prank(bidder);
            vm.expectRevert(
                abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280))
            );
            auction.placeBid{ value: RESERVE }(string(raw));
            return;
        }
        vm.recordLogs();
        vm.prank(bidder);
        auction.placeBid{ value: RESERVE }(string(raw));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_signalLogCount(logs), raw.length == 0 ? 0 : 1);
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == PanoramaSeason3SignalController.BidSignalSet.selector) {
                assertEq(bytes(abi.decode(logs[i].data, (string))), raw);
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                    BID TICK AND UNIQUE AMOUNTS
    //////////////////////////////////////////////////////////////*/

    function test_constructor_rejectsOffTickReserve() public {
        uint64 futureStart = uint64(block.timestamp + 1 hours);
        assertEq(auction.BID_TICK(), 0.001 ether);
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), 0.1 ether + 1, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        vm.expectRevert(PanoramaSeason3Auction.InvalidConfig.selector);
        new PanoramaSeason3Auction(
            address(nft), 0.1005 ether, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );

        PanoramaSeason3Auction onTick = new PanoramaSeason3Auction(
            address(nft), 0.123 ether, INC_BPS, futureStart, DURATION, payoutA, payoutB, address(signals)
        );
        assertEq(onTick.reservePrice(), 0.123 ether);
    }

    function test_tick_offTickPlaceRevertsWithoutTakingETH() public {
        address bidder = _actor(0);
        uint256[3] memory bad = [uint256(RESERVE) + 1, uint256(0.1005 ether), uint256(1 ether + TICK - 1)];
        vm.deal(bidder, 2 ether);
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bidder);
            vm.expectRevert(PanoramaSeason3Auction.AmountNotOnTick.selector);
            auction.placeBid{ value: bad[i] }("");
        }
        assertEq(bidder.balance, 2 ether, "reverted bids keep their ETH");
        assertEq(address(auction).balance, 0);
        assertEq(auction.nextBidId(), 1, "no bid id consumed");
        assertEq(auction.activeBids(), 0);
    }

    function test_tick_offTickRaiseRevertsAndLeavesBid() public {
        uint32 id = _place(_actor(0), RESERVE);
        vm.deal(_actor(0), 1 ether);
        uint256[3] memory bad = [uint256(1), uint256(0.0005 ether), uint256(0.0011 ether)];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(_actor(0));
            vm.expectRevert(PanoramaSeason3Auction.AmountNotOnTick.selector);
            auction.increaseBid{ value: bad[i] }(id);
        }
        (, uint96 amount) = auction.bids(id);
        assertEq(amount, RESERVE, "rejected raise must not mutate the bid");
        assertEq(_actor(0).balance, 1 ether);
        assertEq(auction.totalEscrowed(), RESERVE);
        assertEq(auction.nextBidId(), 2);
    }

    function test_unique_duplicatesAllowedBeforeFull() public {
        _place(_actor(0), 0.2 ether);
        _place(_actor(1), 0.2 ether);
        uint32 third = _place(_actor(2), 0.15 ether);
        _increase(_actor(2), third, 0.05 ether); // a raise onto a held amount is fine too
        assertEq(auction.bidsAtAmount(0.2 ether), 3);
        assertEq(auction.bidsAtAmount(0.15 ether), 0);
        assertTrue(auction.isAmountAvailable(0.2 ether), "ties are allowed until the auction is full");
        assertEq(auction.activeBids(), 3);
    }

    function test_unique_onceFull_duplicateNewBidReverts() public {
        _fillAll(); // holds every tick from 0.100 to 0.129
        address challenger = _actor(999);
        vm.deal(challenger, 1 ether);
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.AmountTaken.selector, 0.12 ether));
        auction.placeBid{ value: 0.12 ether }("");
        assertEq(challenger.balance, 1 ether);
        assertEq(auction.nextBidId(), 31, "no bid id consumed");

        _place(challenger, 0.13 ether); // free: displaces the 0.100 floor
        address second = _actor(998);
        vm.deal(second, 0.13 ether);
        vm.prank(second);
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.AmountTaken.selector, 0.13 ether));
        auction.placeBid{ value: 0.13 ether }("");
    }

    function test_unique_onceFull_duplicateRaiseReverts() public {
        _fillAll();
        vm.deal(_actor(0), 1 ether);
        vm.prank(_actor(0));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.AmountTaken.selector, 0.129 ether));
        auction.increaseBid{ value: 0.029 ether }(1); // 0.100 -> 0.129, held by actor(29)
        (, uint96 amount) = auction.bids(1);
        assertEq(amount, RESERVE, "rejected raise must not mutate the bid");

        _increase(_actor(0), 1, 0.03 ether); // 0.130 is free
        vm.deal(_actor(1), 0.029 ether);
        vm.prank(_actor(1));
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3Auction.AmountTaken.selector, 0.13 ether));
        auction.increaseBid{ value: 0.029 ether }(2); // 0.101 -> 0.130, now held
        assertEq(auction.bidsAtAmount(0.13 ether), 1);
        assertEq(auction.bidsAtAmount(RESERVE), 0);
    }

    function test_minimumBid_stepsPastHeldAmounts() public {
        _place(_actor(0), RESERVE);
        _place(_actor(1), 0.105 ether);
        _place(_actor(2), 0.106 ether);
        for (uint256 i = 3; i < UNITS; ++i) {
            _place(_actor(i), 1 ether + i * TICK);
        }
        // 0.1 + 5% = 0.105 is held, so is 0.106; 0.107 is the first placeable amount.
        assertEq(auction.minimumBid(), 0.107 ether);
        assertFalse(auction.isAmountAvailable(0.105 ether));
        assertFalse(auction.isAmountAvailable(0.106 ether));
        assertTrue(auction.isAmountAvailable(0.107 ether));

        _place(_actor(100), 0.107 ether); // displaces the 0.100 floor
        // New floor 0.105: + 5% = 0.11025, rounded up to 0.111, which is free.
        assertEq(auction.minimumBid(), 0.111 ether);
    }

    function test_minimumBid_isAlwaysPlaceable() public {
        _fillAll();
        for (uint256 k; k < 60; ++k) {
            uint256 m = auction.minimumBid();
            assertTrue(auction.isAmountAvailable(m), "advertised minimum must be free");
            _place(_actor(1000 + k), m); // reverts the test if the minimum were not placeable
        }
        assertEq(auction.activeBids(), 30);
    }

    function test_isAmountAvailable_cases() public {
        uint256 overMax = (uint256(type(uint96).max) / TICK + 1) * TICK;
        assertFalse(auction.isAmountAvailable(RESERVE + 1), "off tick");
        assertFalse(auction.isAmountAvailable(overMax), "above uint96, even on the tick");
        assertTrue(auction.isAmountAvailable(RESERVE));

        _place(_actor(0), RESERVE);
        assertTrue(auction.isAmountAvailable(RESERVE), "held, but not full yet");
        for (uint256 i = 1; i < UNITS; ++i) {
            _place(_actor(i), RESERVE + i * TICK);
        }
        assertTrue(auction.isFull());
        assertFalse(auction.isAmountAvailable(RESERVE));
        assertFalse(auction.isAmountAvailable(0.115 ether));
        assertTrue(auction.isAmountAvailable(0.13 ether));
        // Only tick and uniqueness: the reserve and the minimum increment are checked elsewhere.
        assertTrue(auction.isAmountAvailable(0.05 ether));
    }

    /// @dev Pre-fill ties are allowed, but every bid placed or raised once the auction is full ends
    ///      up with an amount no other active bid holds, and bidsAtAmount matches the live counts.
    function testFuzz_unique_bidsTouchedAfterFillAreDistinct(uint256 seed) public {
        for (uint256 i; i < UNITS; ++i) {
            _place(_actor(i), RESERVE + (i % 5) * TICK); // heavy ties before full
        }
        uint32[] memory touched = new uint32[](40);
        uint256 n;
        for (uint256 k; k < 40; ++k) {
            uint256 r = uint256(keccak256(abi.encode(seed, k)));
            if (r % 3 != 0) {
                uint256 amount = auction.minimumBid() + ((r >> 8) % 8) * TICK;
                address who = _actor(2000 + k);
                uint32 id = auction.nextBidId();
                vm.deal(who, amount);
                vm.prank(who);
                try auction.placeBid{ value: amount }("") {
                    touched[n++] = id;
                } catch { }
            } else {
                (uint32[] memory ids, address[] memory bidders,) = auction.getBids();
                uint256 idx = (r >> 8) % ids.length;
                uint256 add = (1 + (r >> 16) % 40) * TICK;
                vm.deal(bidders[idx], add);
                vm.prank(bidders[idx]);
                try auction.increaseBid{ value: add }(ids[idx]) {
                    touched[n++] = ids[idx];
                } catch { }
            }
        }
        assertGt(n, 0, "the campaign must land some bids");

        (uint32[] memory live,, uint96[] memory amounts) = auction.getBids();
        for (uint256 j; j < live.length; ++j) {
            uint256 sameAmount;
            for (uint256 l; l < live.length; ++l) {
                if (amounts[l] == amounts[j]) ++sameAmount;
            }
            assertEq(auction.bidsAtAmount(amounts[j]), sameAmount, "bidsAtAmount must match live count");
            bool wasTouched;
            for (uint256 t; t < n; ++t) {
                if (touched[t] == live[j]) wasTouched = true;
            }
            if (wasTouched) assertEq(sameAmount, 1, "post-fill amount must be unique");
        }
    }
}
