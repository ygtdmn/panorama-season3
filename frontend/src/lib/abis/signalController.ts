import { parseAbi } from "viem";

// PanoramaSeason3SignalController: stores every Season 3 signal. Signals are WRITE-ONCE and can be
// added later with no deadline. A bid's signal comes with placeBid (the auction forwards it) or
// later through setBidSignal, by the live bid's bidder, only while the bid has none. A day's holder
// can add a token signal through setTokenSignal, only while the token has none. Nothing is ever
// changed or cleared. A day's signal = the winning bid's signal if non-empty, else the token's.
export const signalControllerAbi = parseAbi([
	// config
	"function FIRST_TOKEN_ID() view returns (uint256)",
	"function LAST_TOKEN_ID() view returns (uint256)",
	"function MAX_SIGNAL_BYTES() view returns (uint256)",
	"function nft() view returns (address)",
	"function auction() view returns (address)",
	"function owner() view returns (address)",
	// storage
	"function bidSignal(uint32 bidId) view returns (string)",
	"function tokenSignal(uint256 tokenId) view returns (string)",
	// views
	"function signalOf(uint256 tokenId, uint32 winningBidId) view returns (string)",
	// writes
	"function setBidSignal(uint32 bidId, string signal)",
	"function setTokenSignal(uint256 tokenId, string signal)",
	// events
	"event AuctionSet(address indexed auction)",
	"event BidSignalSet(uint32 indexed bidId, address indexed bidder, string signal)",
	"event TokenSignalSet(uint256 indexed tokenId, address indexed holder, string signal)",
	// errors
	"error InvalidConfig()",
	"error AuctionAlreadySet()",
	"error AuctionNotSet()",
	"error NotAuction()",
	"error NotBidder()",
	"error NotTokenHolder()",
	"error TokenOutOfRange()",
	"error EmptySignal()",
	"error SignalAlreadySet()",
	"error SignalTooLong(uint256 maxBytes)",
]);

/** ownerOf on the Panorama ERC721, for "your days" and the admin holder column. */
export const erc721OwnerOfAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
