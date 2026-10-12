// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Ownable } from "solady/auth/Ownable.sol";
import { IPanoramaSeason3SignalController } from "./interfaces/IPanoramaSeason3SignalController.sol";

interface IERC721OwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IPanoramaSeason3AuctionBids {
    function bids(uint32 bidId) external view returns (address bidder, uint96 amount);
}

/// @title PanoramaSeason3SignalController
/// @author Yigit Duman (@yigitduman)
/// @notice Holds the signals of Panorama Season 3, "Nothing Remains the Same" (tokens #181-#210):
///         a short message for the day a bid wins, or a signal sent anywhere at all. The artists
///         may read a day's signal when they make it and use it or leave it. A signal never affects
///         price, rank or settlement.
///
///         Signals are write-once: they can be added later but never changed or removed.
///         - A bid carries one from the start (the auction forwards it, `recordBidSignal`), or its
///           bidder adds one later while the bid is live (`setBidSignal`).
///         - Once a day's token is minted, its holder can add one (`setTokenSignal`).
///         A day's signal is the winning bid's signal; if that bid carried none, it is the signal
///         the token's holder adds. Either way, once a day has a signal it stays. There is no
///         deadline: a signal can still be added after its day is revealed.
contract PanoramaSeason3SignalController is IPanoramaSeason3SignalController, Ownable {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant FIRST_TOKEN_ID = 181;
    uint256 public constant LAST_TOKEN_ID = 210;
    /// @dev Longest signal, in bytes (UTF-8, so fewer characters for non-ASCII text).
    uint256 public constant MAX_SIGNAL_BYTES = 280;

    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    IERC721OwnerOf public immutable nft;
    /// @dev The Season 3 auction, set once by the owner after it is deployed.
    address public auction;

    /// @dev Write-once signal per bid id.
    mapping(uint32 bidId => string) public bidSignal;
    /// @dev Write-once signal per token, added by its holder.
    mapping(uint256 tokenId => string) public tokenSignal;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event AuctionSet(address indexed auction);
    event BidSignalSet(uint32 indexed bidId, address indexed bidder, string signal);
    event TokenSignalSet(uint256 indexed tokenId, address indexed holder, string signal);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidConfig();
    error AuctionAlreadySet();
    error AuctionNotSet();
    error NotAuction();
    error NotBidder();
    error NotTokenHolder();
    error TokenOutOfRange();
    error EmptySignal();
    error SignalAlreadySet();
    error SignalTooLong(uint256 maxBytes);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param nft_ The Panorama ERC721 whose #181-#210 holders can add day signals.
    constructor(address nft_) {
        if (nft_ == address(0) || nft_.code.length == 0) revert InvalidConfig();
        _initializeOwner(msg.sender);
        nft = IERC721OwnerOf(nft_);
    }

    /// @notice Points the controller at the Season 3 auction. Once only.
    function setAuction(address auction_) external onlyOwner {
        if (auction != address(0)) revert AuctionAlreadySet();
        if (auction_ == address(0) || auction_.code.length == 0) revert InvalidConfig();
        auction = auction_;
        emit AuctionSet(auction_);
    }

    /*//////////////////////////////////////////////////////////////
                                SIGNALS
    //////////////////////////////////////////////////////////////*/

    /// @notice Called by the auction inside `placeBid` when the new bid carries a signal.
    function recordBidSignal(uint32 bidId, address bidder, string calldata signal) external {
        if (msg.sender != auction) revert NotAuction();
        _checkNew(bidSignal[bidId], signal);
        bidSignal[bidId] = signal;
        emit BidSignalSet(bidId, bidder, signal);
    }

    /// @notice Adds a signal to one of your live bids that has none yet. It cannot be changed.
    function setBidSignal(uint32 bidId, string calldata signal) external {
        address auction_ = auction;
        if (auction_ == address(0)) revert AuctionNotSet();
        (address bidder,) = IPanoramaSeason3AuctionBids(auction_).bids(bidId);
        // Minted, refunded and displaced bids are deleted from the auction, so only live bids pass.
        if (bidder == address(0) || bidder != msg.sender) revert NotBidder();
        _checkNew(bidSignal[bidId], signal);
        bidSignal[bidId] = signal;
        emit BidSignalSet(bidId, msg.sender, signal);
    }

    /// @notice Adds a signal to a Season 3 day you hold that has no holder signal yet. It cannot be
    ///         changed. A day whose winning bid already carried a signal keeps that one.
    function setTokenSignal(uint256 tokenId, string calldata signal) external {
        if (tokenId < FIRST_TOKEN_ID || tokenId > LAST_TOKEN_ID) revert TokenOutOfRange();
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenHolder();
        _checkNew(tokenSignal[tokenId], signal);
        tokenSignal[tokenId] = signal;
        emit TokenSignalSet(tokenId, msg.sender, signal);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice A day's signal: the winning bid's, or, if that bid carried none, its holder's.
    /// @param winningBidId The bid id from the auction's `Won` event for this token.
    function signalOf(uint256 tokenId, uint32 winningBidId) external view returns (string memory) {
        if (tokenId < FIRST_TOKEN_ID || tokenId > LAST_TOKEN_ID) revert TokenOutOfRange();
        string memory fromBid = bidSignal[winningBidId];
        return bytes(fromBid).length != 0 ? fromBid : tokenSignal[tokenId];
    }

    /// @dev Write-once: non-empty, within the limit, and only into an empty slot.
    function _checkNew(string storage existing, string calldata signal) private view {
        uint256 length = bytes(signal).length;
        if (length == 0) revert EmptySignal();
        if (length > MAX_SIGNAL_BYTES) revert SignalTooLong(MAX_SIGNAL_BYTES);
        if (bytes(existing).length != 0) revert SignalAlreadySet();
    }
}
