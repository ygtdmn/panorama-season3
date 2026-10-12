// Resolves each of the thirty days to its signal and its owner, from controller storage and the
// board. Pure, so the bid console, the route, the admin view and its exports (and the demo) share
// one tested source.

import { seasonDayForToken, zoneForToken } from "./season3Zones";
import { effectiveSignal, type EffectiveSignal, type SignalRow } from "./signal";

interface BoardBid {
	id: number;
	bidder: string;
}
interface BoardWon extends BoardBid {
	tokenId: number;
}

export interface DayInputs {
	firstTokenId: number;
	maxUnits: number;
	phase: "active" | "finalizing" | "settled" | "cancelled";
	/** Board order: high to low, ties to the earlier id (the order the contract mints in). */
	liveBids: readonly BoardBid[];
	/** Minted winners (from Won events). */
	wonBids: readonly BoardWon[];
	/** Controller bidSignal for live and won bids (empty ones left out). */
	bidSignals: ReadonlyMap<number, SignalRow>;
	/** Controller tokenSignal for minted days (empty ones left out). */
	tokenSignals: ReadonlyMap<number, string>;
	/** NFT ownerOf for minted days. */
	holders: ReadonlyMap<number, string>;
}

/** Who stands behind a day right now: its minted winner, or the live bid at that rank. */
function dayHolding(input: DayInputs, token: number) {
	const won = input.wonBids.find((w) => w.tokenId === token);
	if (won) return { kind: "won" as const, bid: won };
	if (input.phase === "cancelled") return undefined;
	const index = token - input.firstTokenId - input.wonBids.length;
	const live = index >= 0 ? input.liveBids[index] : undefined;
	return live ? { kind: "live" as const, bid: live } : undefined;
}

const bidText = (input: DayInputs, bid: BoardBid) => {
	const row = input.bidSignals.get(bid.id);
	return row && row.bidder.toLowerCase() === bid.bidder.toLowerCase() ? row.signal : undefined;
};

/**
 * A day's signal right now. Minted: the winning bid's signal if it has one, else the holder's
 * token signal. While bidding: the signal of the bid holding that rank.
 */
export function effectiveSignalForDay(input: DayInputs, token: number): EffectiveSignal | undefined {
	const holding = dayHolding(input, token);
	if (holding?.kind === "won")
		return effectiveSignal(input.tokenSignals.get(token), bidText(input, holding.bid));
	if (holding?.kind === "live") return effectiveSignal(undefined, bidText(input, holding.bid));
	return undefined;
}

export interface SignalEntry {
	token: number;
	day: number;
	zone: string;
	/** The minted holder, or the bidder holding the day's rank while bidding. */
	holder: `0x${string}` | null;
	holderKind: "holder" | "bidder" | null;
	/** The winning or rank-holding bid. */
	bidId: number | null;
	/** Effective signal; null when the day has none. */
	signal: string | null;
	source: "bid" | "holder" | null;
	/** True while the day can still change hands through bidding. */
	provisional: boolean;
}

/** One entry per day, #181 first. */
export function buildSignalEntries(input: DayInputs): SignalEntry[] {
	return Array.from({ length: input.maxUnits }, (_, i) => {
		const token = input.firstTokenId + i;
		const holding = dayHolding(input, token);
		const eff = effectiveSignalForDay(input, token);
		const holder =
			holding?.kind === "won"
				? ((input.holders.get(token) ?? holding.bid.bidder) as `0x${string}`)
				: holding?.kind === "live"
					? (holding.bid.bidder as `0x${string}`)
					: null;
		return {
			token,
			day: seasonDayForToken(token) ?? i + 1,
			zone: zoneForToken(token)?.name ?? "",
			holder,
			holderKind: holding?.kind === "won" ? "holder" : holding ? "bidder" : null,
			bidId: holding?.bid.id ?? null,
			signal: eff?.signal ?? null,
			source: eff?.source ?? null,
			provisional: holding?.kind === "live" && input.phase === "active",
		};
	});
}

/** Plain text for copy-all: one block per day, a header line then the signal. */
export function signalEntriesText(entries: readonly SignalEntry[]): string {
	return entries
		.map((e) => {
			const who = e.holder
				? `${e.holderKind}${e.provisional ? " (provisional)" : ""} ${e.holder}`
				: "no holder";
			const src = e.source ? ` / from the ${e.source}` : "";
			return `#${e.token} / Day ${e.day}, ${e.zone} / ${who}${src}\n${e.signal ?? "(no signal)"}`;
		})
		.join("\n\n");
}

/** JSON export for the artists. */
export function signalEntriesJson(entries: readonly SignalEntry[]): string {
	return JSON.stringify(
		entries.map((e) => ({
			token: e.token,
			day: e.day,
			zone: e.zone,
			holder: e.holder,
			holderKind: e.holderKind,
			bidId: e.bidId,
			signal: e.signal,
			source: e.source,
			provisional: e.provisional,
		})),
		null,
		2,
	);
}
