// Reads the eight day auctions from Manifold's marketplace: every listing in one multicall, the
// bid history from its BidEvent log (scanned from the first listing's block), block times for the
// bids and ENS names for the bidders. The finished payload is kept in the Workers Cache API, keyed
// by chain + marketplace address, so a burst of visitors shares one read without any state shared
// between requests in module scope (a Worker may not await I/O another request started).
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
/** While any day still takes bids, a new block is not worth more than this. */
const LIVE_TTL_SECONDS = 10;
/** Once every listing is finalized nothing changes, so a complete read can be kept much longer. */
const FINAL_TTL_SECONDS = 3_600;
/** Bumped when the payload's shape changes, so an old cached copy is never served. */
const CACHE_VERSION = 1;

export class DayAuctionsUnavailableError extends Error {}

// Server-only RPC, never a public node: the bid history is an eth_getLogs over thousands of
// blocks, which public nodes refuse or rate-limit. Unset = the route answers 503 and says why.
// Concurrent calls go out as one JSON-RPC batch, so a cold read stays a handful of requests.
const RPC_URL = process.env.RPC_URL;
const client = RPC_URL
	? createPublicClient({ chain: mainnet, transport: http(RPC_URL, { batch: { batchSize: 200, wait: 10 } }) })
	: null;

const marketplace = { address: MANIFOLD_MARKETPLACE_ADDRESS as Address, abi: manifoldMarketplaceAbi } as const;
const bidEvent = manifoldMarketplaceAbi.find((entry) => entry.type === "event" && entry.name === "BidEvent")!;
const listingIds = DAY_AUCTION_LISTINGS.map((l) => l.listingId);

type RawBid = Omit<DayAuctionBid, "label" | "timestamp"> & { listingId: number; block: bigint; logIndex: number };

/** What one read gathers; lives only for that read. */
interface Scratch {
	bids: RawBid[];
	blockTimes: Map<bigint, number>;
	ens: Map<string, string | null>;
}

async function scanBids(scratch: Scratch, head: bigint): Promise<void> {
	const windows: { start: bigint; end: bigint }[] = [];
	for (let start = DAY_AUCTIONS_FROM_BLOCK; start <= head; start += LOG_CHUNK) {
		windows.push({ start, end: start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n });
	}
	// Every window at once: the batching transport sends them as one HTTP request.
	const chunks = await Promise.all(
		windows.map(({ start, end }) =>
			client!.getLogs({
				address: marketplace.address,
				event: bidEvent,
				args: { listingId: listingIds },
				fromBlock: start,
				toBlock: end,
			}),
		),
	);
	for (const log of chunks.flat()) {
		const { listingId, bidder, amount } = log.args;
		if (listingId === undefined || !bidder || amount === undefined) continue;
		scratch.bids.push({
			listingId: Number(listingId),
			bidder,
			amount: amount.toString(),
			txHash: log.transactionHash,
			block: log.blockNumber,
			logIndex: log.logIndex,
		});
	}
}

async function fillBlockTimes(scratch: Scratch, blocks: bigint[]): Promise<void> {
	const missing = [...new Set(blocks)];
	const read = await Promise.all(missing.map((blockNumber) => client!.getBlock({ blockNumber })));
	read.forEach((block, i) => scratch.blockTimes.set(missing[i], Number(block.timestamp)));
}

async function fillEns(scratch: Scratch, addresses: string[]): Promise<void> {
	const missing = [...new Set(addresses.map((a) => a.toLowerCase()))];
	const names = await Promise.all(
		missing.map(async (address) => {
			try {
				return await client!.getEnsName({ address: address as Address });
			} catch {
				// Unresolved this time; the next read asks again.
				return undefined;
			}
		}),
	);
	names.forEach((name, i) => {
		if (name !== undefined) scratch.ens.set(missing[i], name);
	});
}

/** Best effort: the listings carry the sale; history, block times and names only add to it.
 *  Resolves false when the part failed, so a partial read is never cached for long. */
async function quietly(what: string, work: Promise<unknown>): Promise<boolean> {
	try {
		await work;
		return true;
	} catch (err) {
		console.warn(`[day-auctions] ${what} failed; serving without it this time`, err);
		return false;
	}
}

async function read(): Promise<{ payload: DayAuctionsPayload; complete: boolean }> {
	const scratch: Scratch = { bids: [], blockTimes: new Map(), ens: new Map() };
	const head = await client!.getBlock();
	const [listings, historyOk] = await Promise.all([
		client!.multicall({
			contracts: listingIds.map((id) => ({ ...marketplace, functionName: "getListing" as const, args: [id] as const })),
			allowFailure: false,
			blockNumber: head.number,
		}),
		quietly("bid history", scanBids(scratch, head.number)),
	]);
	const bidders = listings.filter((l) => l.bid.amount > 0n).map((l) => l.bid.bidder);
	const extrasOk = await Promise.all([
		quietly("block times", fillBlockTimes(scratch, scratch.bids.map((b) => b.block))),
		quietly("ENS names", fillEns(scratch, [...scratch.bids.map((b) => b.bidder), ...bidders])),
	]);
	const label = (address: string) => scratch.ens.get(address.toLowerCase()) ?? null;

	const auctions: DayAuction[] = DAY_AUCTION_LISTINGS.map((config, i) => {
		const { details, bid, finalized } = listings[i];
		const started = details.startTime !== 0;
		const bids = scratch.bids
			.filter((b) => b.listingId === config.listingId)
			.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1))
			.map(
				(b): DayAuctionBid => ({
					amount: b.amount,
					bidder: b.bidder,
					label: label(b.bidder),
					timestamp: scratch.blockTimes.get(b.block) ?? 0,
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

	return {
		payload: { snapshot: { block: Number(head.number), timestamp: Number(head.timestamp) }, auctions },
		complete: historyOk && extrasOk.every(Boolean),
	};
}

/** The Workers Cache API's default cache; absent outside workerd (unit tests, plain Node). */
function edgeCache(): Cache | null {
	const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
	return storage?.default ?? null;
}

/** A synthetic URL naming this payload: chain + marketplace, never served to anyone. */
const CACHE_KEY = `https://day-auctions.cache/v${CACHE_VERSION}/${mainnet.id}/${MANIFOLD_MARKETPLACE_ADDRESS.toLowerCase()}`;

/** The eight auctions as the chain has them now (at most a few seconds old while any is live). Mainnet only. */
export async function getDayAuctions(): Promise<DayAuctionsPayload> {
	if (process.env.NEXT_PUBLIC_CHAIN_ID !== "1") {
		throw new DayAuctionsUnavailableError("The open days are on mainnet only.");
	}
	if (!client) throw new Error("RPC_URL is not set on the server; the open days cannot be read.");

	const cache = edgeCache();
	if (cache) {
		try {
			const hit = await cache.match(CACHE_KEY);
			if (hit) return (await hit.json()) as DayAuctionsPayload;
		} catch (err) {
			console.warn("[day-auctions] cache read failed; reading the chain", err);
		}
	}

	const { payload, complete } = await read();
	if (cache) {
		const final = complete && payload.auctions.every((a) => a.finalized);
		const ttl = final ? FINAL_TTL_SECONDS : LIVE_TTL_SECONDS;
		try {
			await cache.put(
				CACHE_KEY,
				new Response(JSON.stringify(payload), {
					headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
				}),
			);
		} catch (err) {
			console.warn("[day-auctions] cache write failed", err);
		}
	}
	return payload;
}
