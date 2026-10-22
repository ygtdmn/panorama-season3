// Reads the eight day auctions from Manifold's marketplace: every listing in one multicall, the
// bid history from its BidEvent log (scanned once from the first listing's block, then only new
// blocks), block times for the bids and ENS names for the bidders, all kept for the process.
// Server only: imported by /api/day-auctions.

import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { manifoldMarketplaceAbi } from "./abis/manifoldMarketplace";
import {
	DAY_AUCTION_LISTINGS,
	DAY_AUCTIONS_FROM_BLOCK,
	MANIFOLD_MARKETPLACE_ADDRESS,
	type DayAuction,
	type DayAuctionBid,
	type DayAuctionsPayload,
} from "./dayAuctions";

/** eth_getLogs window. Providers that cap the range can shrink it without a code change. */
const LOG_CHUNK = BigInt(process.env.DAY_AUCTIONS_LOG_CHUNK || 40_000);
/** A burst of visitors shares one read; a new block is not worth more than this. */
const MIN_REFRESH_MS = 10_000;

export class DayAuctionsUnavailableError extends Error {}

const client = createPublicClient({
	chain: mainnet,
	transport: http(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || undefined),
});

const marketplace = { address: MANIFOLD_MARKETPLACE_ADDRESS as Address, abi: manifoldMarketplaceAbi } as const;
const bidEvent = manifoldMarketplaceAbi.find((entry) => entry.type === "event" && entry.name === "BidEvent")!;
const listingIds = DAY_AUCTION_LISTINGS.map((l) => l.listingId);

type RawBid = Omit<DayAuctionBid, "label" | "timestamp"> & { listingId: number; block: bigint; logIndex: number };

const cache: {
	lastBlock: bigint;
	bids: RawBid[];
	blockTimes: Map<bigint, number>;
	ens: Map<string, string | null>;
	payload: DayAuctionsPayload | null;
	at: number;
	inFlight: Promise<DayAuctionsPayload> | null;
} = {
	lastBlock: DAY_AUCTIONS_FROM_BLOCK - 1n,
	bids: [],
	blockTimes: new Map(),
	ens: new Map(),
	payload: null,
	at: 0,
	inFlight: null,
};

async function scanBids(head: bigint): Promise<void> {
	for (let start = cache.lastBlock + 1n; start <= head; start += LOG_CHUNK) {
		const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
		const logs = await client.getLogs({
			address: marketplace.address,
			event: bidEvent,
			args: { listingId: listingIds },
			fromBlock: start,
			toBlock: end,
		});
		for (const log of logs) {
			const { listingId, bidder, amount } = log.args;
			if (listingId === undefined || !bidder || amount === undefined) continue;
			cache.bids.push({
				listingId: Number(listingId),
				bidder,
				amount: amount.toString(),
				txHash: log.transactionHash,
				block: log.blockNumber,
				logIndex: log.logIndex,
			});
		}
		// Advance per chunk, so a failure part way resumes where it stopped.
		cache.lastBlock = end;
	}
}

async function fillBlockTimes(blocks: bigint[]): Promise<void> {
	const missing = [...new Set(blocks)].filter((b) => !cache.blockTimes.has(b));
	const read = await Promise.all(missing.map((blockNumber) => client.getBlock({ blockNumber })));
	read.forEach((block, i) => cache.blockTimes.set(missing[i], Number(block.timestamp)));
}

async function fillEns(addresses: string[]): Promise<void> {
	const missing = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !cache.ens.has(a));
	const names = await Promise.all(
		missing.map(async (address) => {
			try {
				return await client.getEnsName({ address: address as Address });
			} catch {
				// Unresolved this time; ask again on the next read.
				return undefined;
			}
		}),
	);
	names.forEach((name, i) => {
		if (name !== undefined) cache.ens.set(missing[i], name);
	});
}

async function read(): Promise<DayAuctionsPayload> {
	const head = await client.getBlock();
	const [listings] = await Promise.all([
		client.multicall({
			contracts: listingIds.map((id) => ({ ...marketplace, functionName: "getListing" as const, args: [id] as const })),
			allowFailure: false,
			blockNumber: head.number,
		}),
		scanBids(head.number),
	]);
	const bidders = listings.filter((l) => l.bid.amount > 0n).map((l) => l.bid.bidder);
	await Promise.all([
		fillBlockTimes(cache.bids.map((b) => b.block)),
		fillEns([...cache.bids.map((b) => b.bidder), ...bidders]),
	]);
	const label = (address: string) => cache.ens.get(address.toLowerCase()) ?? null;

	const auctions: DayAuction[] = DAY_AUCTION_LISTINGS.map((config, i) => {
		const { details, bid, finalized } = listings[i];
		const started = details.startTime !== 0;
		const bids = cache.bids
			.filter((b) => b.listingId === config.listingId)
			.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1))
			.map(
				(b): DayAuctionBid => ({
					amount: b.amount,
					bidder: b.bidder,
					label: label(b.bidder),
					timestamp: cache.blockTimes.get(b.block) ?? 0,
					txHash: b.txHash,
				}),
			);
		return {
			tokenId: config.tokenId,
			listingId: config.listingId,
			url: config.url,
			reserve: details.initialAmount.toString(),
			minIncrementBps: details.minIncrementBPS,
			extensionSeconds: details.extensionInterval,
			// Until the first bid, endTime holds the duration; the bid adds its own timestamp to it.
			durationSeconds: started ? Number(details.endTime) - Number(details.startTime) : Number(details.endTime),
			startTime: started ? Number(details.startTime) : 0,
			endTime: started ? Number(details.endTime) : 0,
			finalized,
			highBid: bid.amount > 0n ? { amount: bid.amount.toString(), bidder: bid.bidder, label: label(bid.bidder) } : null,
			bids,
		};
	});

	return { snapshot: { block: Number(head.number), timestamp: Number(head.timestamp) }, auctions };
}

/** The eight auctions as the chain has them now (at most a few seconds old). Mainnet only. */
export async function getDayAuctions(): Promise<DayAuctionsPayload> {
	if (process.env.NEXT_PUBLIC_CHAIN_ID !== "1") {
		throw new DayAuctionsUnavailableError("The open days are on mainnet only.");
	}
	if (cache.payload && Date.now() - cache.at < MIN_REFRESH_MS) return cache.payload;
	cache.inFlight ??= read()
		.then((payload) => {
			cache.payload = payload;
			cache.at = Date.now();
			return payload;
		})
		.finally(() => {
			cache.inFlight = null;
		});
	return cache.inFlight;
}
