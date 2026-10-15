// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/src/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { Panorama } from "../src/Panorama.sol";
import { PanoramaMintController } from "../src/PanoramaMintController.sol";
import { PanoramaSeason3Auction } from "../src/PanoramaSeason3Auction.sol";
import { PanoramaSeason3SignalController } from "../src/PanoramaSeason3SignalController.sol";

/// @dev The delegate.xyz v2 semantics `setTokenSignal` relies on, for full-rights delegations:
///      a wallet, contract or single-token delegation from `from` to `to`.
contract MockDelegateRegistry {
    mapping(bytes32 => bool) internal _delegated;

    function delegateAll(address to, bytes32 rights, bool enable) external {
        _delegated[keccak256(abi.encode(1, msg.sender, to, address(0), uint256(0), rights))] = enable;
    }

    function delegateContract(address to, address contract_, bytes32 rights, bool enable) external {
        _delegated[keccak256(abi.encode(2, msg.sender, to, contract_, uint256(0), rights))] = enable;
    }

    function delegateERC721(address to, address contract_, uint256 tokenId, bytes32 rights, bool enable) external {
        _delegated[keccak256(abi.encode(3, msg.sender, to, contract_, tokenId, rights))] = enable;
    }

    function checkDelegateForERC721(
        address to,
        address from,
        address contract_,
        uint256 tokenId,
        bytes32 rights
    ) external view returns (bool) {
        return _has(to, from, contract_, tokenId, bytes32(0))
            || (rights != 0 && _has(to, from, contract_, tokenId, rights));
    }

    function _has(
        address to,
        address from,
        address contract_,
        uint256 tokenId,
        bytes32 rights
    ) internal view returns (bool) {
        return _delegated[keccak256(abi.encode(1, from, to, address(0), uint256(0), rights))]
            || _delegated[keccak256(abi.encode(2, from, to, contract_, uint256(0), rights))]
            || _delegated[keccak256(abi.encode(3, from, to, contract_, tokenId, rights))];
    }
}

/// @dev delegate.xyz v1 semantics: checkDelegateForToken falls back to contract, then wallet.
contract MockDelegationRegistryV1 {
    mapping(bytes32 => bool) internal _delegated;

    function delegateForAll(address delegate, bool value) external {
        _delegated[keccak256(abi.encode(1, msg.sender, delegate, address(0), uint256(0)))] = value;
    }

    function delegateForContract(address delegate, address contract_, bool value) external {
        _delegated[keccak256(abi.encode(2, msg.sender, delegate, contract_, uint256(0)))] = value;
    }

    function delegateForToken(address delegate, address contract_, uint256 tokenId, bool value) external {
        _delegated[keccak256(abi.encode(3, msg.sender, delegate, contract_, tokenId))] = value;
    }

    function checkDelegateForToken(
        address delegate,
        address vault,
        address contract_,
        uint256 tokenId
    ) external view returns (bool) {
        return _delegated[keccak256(abi.encode(3, vault, delegate, contract_, tokenId))]
            || _delegated[keccak256(abi.encode(2, vault, delegate, contract_, uint256(0)))]
            || _delegated[keccak256(abi.encode(1, vault, delegate, address(0), uint256(0)))];
    }
}

/// @dev Answers every delegation check with garbage (not a bool), to prove a broken registry
///      reads as no delegation instead of reverting.
contract GarbageDelegateRegistry {
    fallback() external {
        assembly {
            mstore(0, 7)
            return(0, 32)
        }
    }
}

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
                         DELEGATE.XYZ DELEGATES
    //////////////////////////////////////////////////////////////*/

    function _mockRegistry() internal returns (MockDelegateRegistry registry) {
        vm.etch(signals.DELEGATE_REGISTRY(), address(new MockDelegateRegistry()).code);
        registry = MockDelegateRegistry(signals.DELEGATE_REGISTRY());
    }

    /// @dev A wallet-wide delegation lets the hot wallet sign; the event names the holder.
    function test_setTokenSignal_delegateAll() public {
        _settleThree();
        MockDelegateRegistry registry = _mockRegistry();
        address vault = nft.ownerOf(182);
        address hot = _actor(60);

        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "before the delegation");

        vm.prank(vault);
        registry.delegateAll(hot, bytes32(0), true);
        vm.prank(hot);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.TokenSignalSet(182, vault, "from the hot wallet");
        signals.setTokenSignal(182, "from the hot wallet");
        assertEq(signals.tokenSignal(182), "from the hot wallet");

        // Write-once holds for the vault too.
        vm.prank(vault);
        _expectAlreadySet();
        signals.setTokenSignal(182, "the vault tries again");
    }

    function test_setTokenSignal_delegateContractAndToken() public {
        _settleThree();
        MockDelegateRegistry registry = _mockRegistry();
        address vault = _actor(0); // holds #183
        address hot = _actor(61);

        // A delegation for another contract does not count.
        vm.prank(vault);
        registry.delegateContract(hot, address(0xBEEF), bytes32(0), true);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "wrong contract");

        vm.prank(vault);
        registry.delegateContract(hot, address(nft), bytes32(0), true);
        vm.prank(hot);
        signals.setTokenSignal(183, "contract delegation");
        assertEq(signals.tokenSignal(183), "contract delegation");

        // A single-token delegation covers that token only.
        address vault2 = _actor(1); // holds #182
        address hot2 = _actor(62);
        vm.prank(vault2);
        registry.delegateERC721(hot2, address(nft), 181, bytes32(0), true);
        vm.prank(hot2);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "other token");
        vm.prank(vault2);
        registry.delegateERC721(hot2, address(nft), 182, bytes32(0), true);
        vm.prank(hot2);
        signals.setTokenSignal(182, "token delegation");
        assertEq(signals.tokenSignal(182), "token delegation");
    }

    /// @dev Only full-rights delegations count; a revoked one stops counting; the delegation
    ///      follows the holder, not the token.
    function test_setTokenSignal_delegateRightsRevokeAndTransfer() public {
        _settleThree();
        MockDelegateRegistry registry = _mockRegistry();
        address vault = _actor(0); // holds #183
        address hot = _actor(63);

        vm.prank(vault);
        registry.delegateAll(hot, bytes32("airdrops"), true);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "limited rights");

        vm.prank(vault);
        registry.delegateAll(hot, bytes32(0), true);
        vm.prank(vault);
        registry.delegateAll(hot, bytes32(0), false);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "revoked");

        vm.prank(vault);
        registry.delegateAll(hot, bytes32(0), true);
        address buyer = _actor(64);
        vm.prank(vault);
        nft.transferFrom(vault, buyer, 183);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "sold");
        vm.prank(buyer);
        signals.setTokenSignal(183, "the buyer");
        assertEq(signals.tokenSignal(183), "the buyer");
    }

    function _mockRegistryV1() internal returns (MockDelegationRegistryV1 registry) {
        vm.etch(signals.DELEGATE_REGISTRY_V1(), address(new MockDelegationRegistryV1()).code);
        registry = MockDelegationRegistryV1(signals.DELEGATE_REGISTRY_V1());
    }

    /// @dev delegate.xyz v1: wallet, contract and token delegations all count, without v2.
    function test_setTokenSignal_delegateV1() public {
        _settleThree();
        MockDelegationRegistryV1 v1 = _mockRegistryV1();
        assertEq(signals.DELEGATE_REGISTRY().code.length, 0);

        // #183 (actor 0): wallet delegation.
        address hot = _actor(70);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(183, "x");
        vm.prank(_actor(0));
        v1.delegateForAll(hot, true);
        vm.prank(hot);
        vm.expectEmit(address(signals));
        emit PanoramaSeason3SignalController.TokenSignalSet(183, _actor(0), "v1 wallet");
        signals.setTokenSignal(183, "v1 wallet");

        // #182 (actor 1): a delegation for another token or contract does not count; this token does.
        address hot2 = _actor(71);
        vm.startPrank(_actor(1));
        v1.delegateForToken(hot2, address(nft), 181, true);
        v1.delegateForContract(hot2, address(0xBEEF), true);
        vm.stopPrank();
        vm.prank(hot2);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "x");
        vm.prank(_actor(1));
        v1.delegateForToken(hot2, address(nft), 182, true);
        vm.prank(hot2);
        signals.setTokenSignal(182, "v1 token");

        // #181 (actor 2): contract delegation; revoked before use, it stops counting.
        address hot3 = _actor(72);
        vm.prank(_actor(2));
        v1.delegateForContract(hot3, address(nft), true);
        vm.prank(_actor(2));
        v1.delegateForContract(hot3, address(nft), false);
        vm.prank(hot3);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(181, "revoked");
        vm.prank(_actor(2));
        v1.delegateForContract(hot3, address(nft), true);
        vm.prank(hot3);
        signals.setTokenSignal(181, "v1 contract");
        assertEq(signals.tokenSignal(181), "v1 contract");
    }

    /// @dev A broken v2 registry does not hide a valid v1 delegation, and the other way round.
    function test_setTokenSignal_oneBrokenRegistryDoesNotBlockTheOther() public {
        _settleThree();
        vm.etch(signals.DELEGATE_REGISTRY(), address(new GarbageDelegateRegistry()).code);
        MockDelegationRegistryV1 v1 = _mockRegistryV1();
        address hot = _actor(73);
        vm.prank(_actor(1));
        v1.delegateForAll(hot, true);
        vm.prank(hot);
        signals.setTokenSignal(182, "through v1");
        assertEq(signals.tokenSignal(182), "through v1");

        vm.etch(signals.DELEGATE_REGISTRY_V1(), address(new GarbageDelegateRegistry()).code);
        MockDelegateRegistry v2 = _mockRegistry();
        vm.prank(_actor(0));
        v2.delegateAll(hot, bytes32(0), true);
        vm.prank(hot);
        signals.setTokenSignal(183, "through v2");
        assertEq(signals.tokenSignal(183), "through v2");
    }

    /// @dev Without the registry (a local chain) or with a broken one, only the holder can sign.
    function test_setTokenSignal_noOrBrokenRegistry() public {
        _settleThree();
        address hot = _actor(65);
        assertEq(signals.DELEGATE_REGISTRY().code.length, 0);
        assertEq(signals.DELEGATE_REGISTRY_V1().code.length, 0);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "no registry");

        vm.etch(signals.DELEGATE_REGISTRY(), address(new GarbageDelegateRegistry()).code);
        vm.etch(signals.DELEGATE_REGISTRY_V1(), address(new GarbageDelegateRegistry()).code);
        vm.prank(hot);
        vm.expectRevert(PanoramaSeason3SignalController.NotTokenHolder.selector);
        signals.setTokenSignal(182, "broken registry");

        vm.prank(_actor(1));
        signals.setTokenSignal(182, "the holder");
        assertEq(signals.tokenSignal(182), "the holder");
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
