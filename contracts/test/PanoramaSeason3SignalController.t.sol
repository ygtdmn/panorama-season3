// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { Panorama } from "../src/Panorama.sol";
import { PanoramaMintController } from "../src/PanoramaMintController.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";

contract PanoramaSeason3SignalControllerTest is Test {
    Panorama nft;
    PanoramaMintController mintController;
    PanoramaSeason3Auction auction;
    PanoramaSeason3SignalController signals;

    address payoutA = address(0xA);
    address payoutB = address(0xB);
    uint96 constant RESERVE = 0.1 ether;
    uint64 start;

    function setUp() public {
        vm.warp(1_700_000_000);
        nft = new Panorama();
        mintController = new PanoramaMintController();
        nft.setMintController(address(mintController));
        mintController.setSeasonMintCap(1, 90);
        mintController.setSeasonMintCap(2, 90);
        nft.mintTo(address(this), 180);
        mintController.setSeasonMintCap(3, 30);

        start = uint64(block.timestamp + 1 hours);
        signals = new PanoramaSeason3SignalController(address(nft));
        auction =
            new PanoramaSeason3Auction(address(nft), RESERVE, 500, start, 24 hours, payoutA, payoutB, address(signals));
        signals.setAuction(address(auction));
        nft.setAuthorizedOperator(address(auction), true);
        vm.warp(start);
    }

    /*//////////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////////*/

    function _actor(uint256 i) internal pure returns (address) {
        return address(uint160(0x300000 + i));
    }

    function _bid(address who, uint256 amount, string memory signal) internal returns (uint32 id) {
        id = auction.nextBidId();
        vm.deal(who, amount);
        vm.prank(who);
        auction.placeBid{ value: amount }(signal);
    }

    function _repeat(bytes memory unit, uint256 n) internal pure returns (bytes memory out) {
        for (uint256 i; i < n; ++i) {
            out = bytes.concat(out, unit);
        }
    }

    function _expectAlreadySet() internal {
        vm.expectRevert(PanoramaSeason3SignalController.SignalAlreadySet.selector);
    }

    /// @dev Three bids, settled. Bid 1 actor(0) 0.1 "zero" -> #183; bid 2 actor(1) 0.2 "" -> #182;
    ///      bid 3 actor(2) 0.3 "two" -> #181.
    function _settleThree() internal {
        _bid(_actor(0), 0.1 ether, "zero");
        _bid(_actor(1), 0.2 ether, "");
        _bid(_actor(2), 0.3 ether, "two");
        vm.warp(auction.endTime() + 1);
        auction.finalize(30);
    }

    /*//////////////////////////////////////////////////////////////
                              SETUP
    //////////////////////////////////////////////////////////////*/

    function test_constructor_setsConfig() public view {
        assertEq(address(signals.nft()), address(nft));
        assertEq(signals.auction(), address(auction));
        assertEq(signals.owner(), address(this));
        assertEq(signals.FIRST_TOKEN_ID(), 181);
        assertEq(signals.LAST_TOKEN_ID(), 210);
        assertEq(signals.MAX_SIGNAL_BYTES(), 280);
    }

    function test_constructor_validation() public {
        vm.expectRevert(PanoramaSeason3SignalController.InvalidConfig.selector);
        new PanoramaSeason3SignalController(address(0));
        vm.expectRevert(PanoramaSeason3SignalController.InvalidConfig.selector);
        new PanoramaSeason3SignalController(_actor(1)); // no code

        PanoramaSeason3SignalController c = new PanoramaSeason3SignalController(address(nft));
        assertEq(c.auction(), address(0));
        assertEq(c.owner(), address(this));
    }

    function test_setAuction_onceOnlyOwnerNeedsCode() public {
        PanoramaSeason3SignalController c = new PanoramaSeason3SignalController(address(nft));

        vm.prank(_actor(1));
        vm.expectRevert(Ownable.Unauthorized.selector);
        c.setAuction(address(auction));

        vm.expectRevert(PanoramaSeason3SignalController.InvalidConfig.selector);
        c.setAuction(address(0));
        vm.expectRevert(PanoramaSeason3SignalController.InvalidConfig.selector);
        c.setAuction(_actor(2));

        vm.expectEmit(address(c));
        emit PanoramaSeason3SignalController.AuctionSet(address(auction));
        c.setAuction(address(auction));
        assertEq(c.auction(), address(auction));

        vm.expectRevert(PanoramaSeason3SignalController.AuctionAlreadySet.selector);
        c.setAuction(address(nft));
    }

    /*//////////////////////////////////////////////////////////////
                              BID SIGNALS
    //////////////////////////////////////////////////////////////*/

    function test_recordBidSignal_onlyAuction() public {
        vm.prank(_actor(1));
        vm.expectRevert(PanoramaSeason3SignalController.NotAuction.selector);
        signals.recordBidSignal(1, _actor(1), "forged");

        vm.expectRevert(PanoramaSeason3SignalController.NotAuction.selector);
        signals.recordBidSignal(1, _actor(1), "the owner cannot either");

        vm.prank(address(auction));
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.BidSignalSet(7, _actor(1), "from the auction");
        signals.recordBidSignal(7, _actor(1), "from the auction");
        assertEq(signals.bidSignal(7), "from the auction");
    }

    /// @dev The auction's forward goes through the same write-once checks.
    function test_recordBidSignal_writeOnceChecks() public {
        vm.startPrank(address(auction));
        vm.expectRevert(PanoramaSeason3SignalController.EmptySignal.selector);
        signals.recordBidSignal(8, _actor(1), "");
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        signals.recordBidSignal(8, _actor(1), string(_repeat("x", 281)));
        signals.recordBidSignal(8, _actor(1), "first");
        _expectAlreadySet();
        signals.recordBidSignal(8, _actor(1), "second");
        vm.stopPrank();
        assertEq(signals.bidSignal(8), "first");
    }

    function test_setBidSignal_requiresAuctionSet() public {
        PanoramaSeason3SignalController c = new PanoramaSeason3SignalController(address(nft));
        vm.expectRevert(PanoramaSeason3SignalController.AuctionNotSet.selector);
        c.setBidSignal(1, "early");
    }

    /// @dev A bid placed without a signal can get one later, once. It can never be changed or cleared.
    function test_setBidSignal_addLaterThenWriteOnce() public {
        address bidder = _actor(1);
        uint32 id = _bid(bidder, RESERVE, "");
        assertEq(bytes(signals.bidSignal(id)).length, 0);

        vm.warp(block.timestamp + 20 hours); // later during bidding
        vm.prank(bidder);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.BidSignalSet(id, bidder, "added later");
        signals.setBidSignal(id, "added later");
        assertEq(signals.bidSignal(id), "added later");

        vm.prank(bidder);
        _expectAlreadySet();
        signals.setBidSignal(id, "changed my mind");
        vm.prank(bidder);
        vm.expectRevert(PanoramaSeason3SignalController.EmptySignal.selector); // clearing is not possible
        signals.setBidSignal(id, "");
        assertEq(signals.bidSignal(id), "added later");
    }

    function test_setBidSignal_bidPlacedWithSignalCannotChange() public {
        uint32 id = _bid(_actor(1), RESERVE, "with the bid");
        vm.prank(_actor(1));
        _expectAlreadySet();
        signals.setBidSignal(id, "replacement");
        assertEq(signals.bidSignal(id), "with the bid");
    }

    function test_setBidSignal_lengthAndEmpty() public {
        uint32 a = _bid(_actor(1), RESERVE, "");
        uint32 b = _bid(_actor(1), 0.2 ether, "");
        vm.startPrank(_actor(1));
        vm.expectRevert(PanoramaSeason3SignalController.EmptySignal.selector);
        signals.setBidSignal(a, "");
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        signals.setBidSignal(a, string(_repeat("y", 281)));
        string memory max = string(_repeat("y", 280));
        signals.setBidSignal(a, max);
        signals.setBidSignal(b, string(_repeat(hex"c3a9", 140))); // 140 two-byte characters = 280 bytes
        vm.stopPrank();
        assertEq(signals.bidSignal(a), max);
    }

    /// @dev Adding a signal later is allowed at any time while the bid is live, even after bidding ended.
    function test_setBidSignal_noDeadlineWhileBidIsLive() public {
        uint32 id = _bid(_actor(1), RESERVE, "");
        vm.warp(auction.endTime() + 3 days); // ended, not yet settled: the bid is still live
        vm.prank(_actor(1));
        signals.setBidSignal(id, "after bidding ended");
        assertEq(signals.bidSignal(id), "after bidding ended");
    }

    function test_setBidSignal_rejectsOthersAndUnknownIds() public {
        uint32 id = _bid(_actor(1), RESERVE, "");
        vm.prank(_actor(2));
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(id, "not yours");
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(id, "the owner neither");
        vm.prank(_actor(1));
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(99, "no such bid");
        assertEq(bytes(signals.bidSignal(id)).length, 0);
    }

    function test_setBidSignal_rejectsDisplacedBid() public {
        for (uint256 i; i < 30; ++i) {
            _bid(_actor(i), RESERVE + i * 0.001 ether, "");
        }
        _bid(_actor(100), auction.minimumBid(), ""); // displaces bid 1 (actor 0)
        vm.prank(_actor(0));
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(1, "too late");
    }

    function test_setBidSignal_rejectsMintedBid() public {
        _settleThree();
        vm.prank(_actor(1)); // bid 2 won #182 without a signal; the bid is gone, the token is the way
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(2, "after minting");
    }

    function test_setBidSignal_rejectsRefundedBid() public {
        uint32 id = _bid(_actor(1), RESERVE, "");
        auction.cancelAuction();
        auction.refundAll(10);
        vm.prank(_actor(1));
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(id, "after refund");
    }

    /*//////////////////////////////////////////////////////////////
                             TOKEN SIGNALS
    //////////////////////////////////////////////////////////////*/

    function test_setTokenSignal_outOfRangeAndUnminted() public {
        vm.expectRevert(PanoramaSeason3SignalController.TokenOutOfRange.selector);
        signals.setTokenSignal(180, "season 2");
        vm.expectRevert(PanoramaSeason3SignalController.TokenOutOfRange.selector);
        signals.setTokenSignal(211, "beyond");

        vm.prank(_actor(1));
        vm.expectRevert(); // Solady ERC721 TokenDoesNotExist: #195 is not minted
        signals.setTokenSignal(195, "nobody holds this yet");
    }

    /// @dev The holder adds a signal once, with no deadline, even long after the day.
    function test_setTokenSignal_holderOnceNoDeadline() public {
        _settleThree();
        address holder = nft.ownerOf(182);
        assertEq(holder, _actor(1));

        vm.prank(_actor(2));
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "not mine");

        vm.startPrank(holder);
        vm.expectRevert(PanoramaSeason3SignalController.EmptySignal.selector);
        signals.setTokenSignal(182, "");
        vm.expectRevert(abi.encodeWithSelector(PanoramaSeason3SignalController.SignalTooLong.selector, uint256(280)));
        signals.setTokenSignal(182, string(_repeat("z", 281)));
        vm.stopPrank();

        vm.warp(block.timestamp + 400 days); // the day was revealed long ago
        vm.prank(holder);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.TokenSignalSet(182, holder, "a signal to the universe");
        signals.setTokenSignal(182, "a signal to the universe");
        assertEq(signals.tokenSignal(182), "a signal to the universe");

        vm.prank(holder);
        _expectAlreadySet();
        signals.setTokenSignal(182, "changed");
        assertEq(signals.tokenSignal(182), "a signal to the universe");
    }

    /// @dev The right passes with the token only while the token signal is still empty.
    function test_setTokenSignal_transfer() public {
        _settleThree();
        // #183: seller transfers before writing; the buyer can write, the seller can't.
        address seller = _actor(0);
        address buyer = _actor(50);
        vm.prank(seller);
        nft.transferFrom(seller, buyer, 183);
        vm.prank(seller);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "sold it");
        vm.prank(buyer);
        signals.setTokenSignal(183, "new holder");
        assertEq(signals.tokenSignal(183), "new holder");

        // #183 again: the next holder finds it already written.
        address third = _actor(51);
        vm.prank(buyer);
        nft.transferFrom(buyer, third, 183);
        vm.prank(third);
        _expectAlreadySet();
        signals.setTokenSignal(183, "third holder");
        assertEq(signals.tokenSignal(183), "new holder");
    }

    /*//////////////////////////////////////////////////////////////
                              SIGNAL OF
    //////////////////////////////////////////////////////////////*/

    function test_signalOf_precedence() public {
        _settleThree();
        // #181 won by bid 3 ("two"): the bid's signal is the day's, whatever the holder writes.
        assertEq(signals.signalOf(181, 3), "two");
        vm.prank(_actor(2));
        signals.setTokenSignal(181, "stored but not the day's");
        assertEq(signals.tokenSignal(181), "stored but not the day's");
        assertEq(signals.signalOf(181, 3), "two", "a day with a bid signal keeps it");

        // #182 won by bid 2 (no signal): empty until the holder adds one, then that.
        assertEq(bytes(signals.signalOf(182, 2)).length, 0);
        vm.prank(_actor(1));
        signals.setTokenSignal(182, "the holder's");
        assertEq(signals.signalOf(182, 2), "the holder's");

        vm.expectRevert(PanoramaSeason3SignalController.TokenOutOfRange.selector);
        signals.signalOf(211, 1);
        vm.expectRevert(PanoramaSeason3SignalController.TokenOutOfRange.selector);
        signals.signalOf(180, 1);
    }

    /// @dev Bid without a signal, add one during bidding, settle; another winner adds one as holder
    ///      long after; neither can change afterwards.
    function test_fullFlow() public {
        address a = _actor(7);
        address b = _actor(8);
        uint32 idA = _bid(a, 1 ether, "");
        uint32 idB = _bid(b, 0.5 ether, "");
        vm.warp(block.timestamp + 6 hours);
        vm.prank(a);
        signals.setBidSignal(idA, "an interface that remembers");

        vm.warp(auction.endTime() + 1);
        auction.finalize(30);
        assertEq(nft.ownerOf(181), a);
        assertEq(nft.ownerOf(182), b);
        assertEq(signals.signalOf(181, idA), "an interface that remembers");
        assertEq(bytes(signals.signalOf(182, idB)).length, 0);

        vm.warp(block.timestamp + 90 days);
        vm.prank(b);
        signals.setTokenSignal(182, "a city, much later");
        assertEq(signals.signalOf(182, idB), "a city, much later");

        vm.prank(b);
        _expectAlreadySet();
        signals.setTokenSignal(182, "again");
        vm.prank(a);
        vm.expectRevert(PanoramaSeason3SignalController.NotBidder.selector);
        signals.setBidSignal(idA, "again");
    }

    /*//////////////////////////////////////////////////////////////
                                GAS
    //////////////////////////////////////////////////////////////*/

    function test_gas_setSignals_280Bytes() public {
        string memory max = string(_repeat("a", 280));
        uint32 id = _bid(_actor(1), RESERVE, "");
        vm.cool(address(signals));
        vm.prank(_actor(1));
        uint256 g = gasleft();
        signals.setBidSignal(id, max);
        emit log_named_uint("gas setBidSignal (280 bytes, fresh)", g - gasleft());

        _settleThree();
        vm.cool(address(signals));
        vm.prank(nft.ownerOf(182));
        g = gasleft();
        signals.setTokenSignal(182, max);
        emit log_named_uint("gas setTokenSignal (280 bytes, fresh)", g - gasleft());
    }
}
