// The eight days the season's auction left open (#203-#210), each now on its own reserve auction
// on Manifold's marketplace. The site reads every listing from the marketplace contract (through
// /api/day-auctions) and sends bidders to Manifold's own pages, where all bidding happens.

/** Manifold Marketplace (TransparentUpgradeableProxy) on Ethereum mainnet. */
export const MANIFOLD_MARKETPLACE_ADDRESS = "0x3a3548e060be10c2614d0a4cb0c03cc9093fd799" as const;

/** Block of the first of these listings; the bid log is read from here. */
export const DAY_AUCTIONS_FROM_BLOCK = 26_243_600n;

export interface DayAuctionListing {
	tokenId: number;
	/** The marketplace's on-chain listing id. */
	listingId: number;
	/** The Manifold page that takes the bids. */
	url: string;
}

/** Mainnet only. #209's first listing (21190) was cancelled and listed again as 21192. */
export const DAY_AUCTION_LISTINGS: readonly DayAuctionListing[] = [
	{ tokenId: 203, listingId: 21182, url: "https://manifold.xyz/@yeet/id/3486497008" },
	{ tokenId: 204, listingId: 21185, url: "https://manifold.xyz/@yeet/id/3486509296" },
	{ tokenId: 205, listingId: 21186, url: "https://manifold.xyz/@yeet/id/3486505200" },
	{ tokenId: 206, listingId: 21187, url: "https://manifold.xyz/@yeet/id/3486499056" },
	{ tokenId: 207, listingId: 21188, url: "https://manifold.xyz/@yeet/id/3486501104" },
	{ tokenId: 208, listingId: 21189, url: "https://manifold.xyz/@yeet/id/3486462192" },
	{ tokenId: 209, listingId: 21192, url: "https://manifold.xyz/@yeet/id/3486460144" },
	{ tokenId: 210, listingId: 21191, url: "https://manifold.xyz/@yeet/id/3486458096" },
];

/** The payload /api/day-auctions serves. Wei travels as decimal strings. */
export interface DayAuctionBid {
	amount: string;
	bidder: `0x${string}`;
	/** ENS name, when the bidder has a primary one. */
	label: string | null;
	/** Unix seconds of the bid's block. */
	timestamp: number;
	txHash: `0x${string}`;
}

export interface DayAuction {
	tokenId: number;
	listingId: number;
	url: string;
	/** Opening bid. */
	reserve: string;
	minIncrementBps: number;
	/** A bid this close to the end pushes the end to this many seconds after it. */
	extensionSeconds: number;
	/** How long the auction runs once the first bid starts it. */
	durationSeconds: number;
	/** Unix seconds; 0 until the first bid starts the clock. */
	startTime: number;
	/** Unix seconds; 0 until the first bid starts the clock. */
	endTime: number;
	/** Settled or cancelled on the marketplace. */
	finalized: boolean;
	highBid: { amount: string; bidder: `0x${string}`; label: string | null } | null;
	/** Every bid, newest first. */
	bids: DayAuctionBid[];
}

export interface DayAuctionsPayload {
	/** The block the listings were read at, for a chain-anchored clock. */
	snapshot: { block: number; timestamp: number };
	auctions: DayAuction[];
}

export type DayAuctionStatus = "open" | "live" | "ended" | "sold" | "withdrawn";

/** Where an auction stands at `now` (unix seconds). */
export function dayAuctionStatus(auction: DayAuction, now: number): DayAuctionStatus {
	if (auction.finalized) return auction.highBid ? "sold" : "withdrawn";
	if (!auction.highBid || auction.startTime === 0) return "open";
	return now > 0 && now >= auction.endTime ? "ended" : "live";
}

/** Still taking bids: no bid yet, or the clock is running. */
export function isBiddable(status: DayAuctionStatus): boolean {
	return status === "open" || status === "live";
}
