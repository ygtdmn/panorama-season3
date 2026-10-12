import { describe, expect, it } from "vitest";
import type { SignalRow } from "@/lib/signal";
import {
	buildSignalEntries,
	effectiveSignalForDay,
	signalEntriesJson,
	signalEntriesText,
	type DayInputs,
} from "@/lib/signalBoard";

const A = "0x000000000000000000000000000000000000000a" as const;
const B = "0x000000000000000000000000000000000000000b" as const;
const C = "0x000000000000000000000000000000000000000c" as const;

const bidSig = (bidId: number, bidder: `0x${string}`, signal: string): [number, SignalRow] => [
	bidId,
	{ bidId, bidder, signal },
];

function inputs(over: Partial<DayInputs>): DayInputs {
	return {
		firstTokenId: 181,
		maxUnits: 30,
		phase: "active",
		liveBids: [],
		wonBids: [],
		bidSignals: new Map(),
		tokenSignals: new Map(),
		holders: new Map(),
		...over,
	};
}

describe("effectiveSignalForDay", () => {
	it("while bidding, a day carries the signal of the bid holding its rank", () => {
		const input = inputs({
			liveBids: [
				{ id: 2, bidder: B },
				{ id: 1, bidder: A },
			],
			bidSignals: new Map([bidSig(1, A, "second place")]),
		});
		expect(effectiveSignalForDay(input, 181)).toBeUndefined();
		expect(effectiveSignalForDay(input, 182)).toEqual({ signal: "second place", source: "bid" });
		expect(effectiveSignalForDay(input, 183)).toBeUndefined();
	});

	it("once minted: the winning bid's signal if it has one, else the holder's token signal", () => {
		const input = inputs({
			phase: "settled",
			wonBids: [
				{ id: 1, bidder: A, tokenId: 181 },
				{ id: 2, bidder: B, tokenId: 182 },
				{ id: 3, bidder: C, tokenId: 183 },
			],
			bidSignals: new Map([bidSig(1, A, "bid one"), bidSig(2, B, "bid two")]),
			// A holder signal on a day whose bid has one never shows (signalOf prefers the bid).
			tokenSignals: new Map([
				[182, "the holder wrote this too"],
				[183, "added by the holder"],
			]),
		});
		expect(effectiveSignalForDay(input, 181)).toEqual({ signal: "bid one", source: "bid" });
		expect(effectiveSignalForDay(input, 182)).toEqual({ signal: "bid two", source: "bid" });
		expect(effectiveSignalForDay(input, 183)).toEqual({ signal: "added by the holder", source: "holder" });
		expect(effectiveSignalForDay(input, 184)).toBeUndefined();
	});

	it("a cancelled sale gives no day a signal", () => {
		const input = inputs({
			phase: "cancelled",
			liveBids: [{ id: 1, bidder: A }],
			bidSignals: new Map([bidSig(1, A, "x")]),
		});
		expect(effectiveSignalForDay(input, 181)).toBeUndefined();
	});
});

describe("buildSignalEntries", () => {
	it("one row per day with holder or bidder and source", () => {
		const entries = buildSignalEntries(
			inputs({
				phase: "finalizing",
				wonBids: [{ id: 5, bidder: A, tokenId: 181 }],
				liveBids: [{ id: 6, bidder: B }],
				bidSignals: new Map([bidSig(6, B, "still minting")]),
				tokenSignals: new Map([[181, "the holder's"]]),
				holders: new Map([[181, C]]), // sold on after minting
			}),
		);
		expect(entries).toHaveLength(30);
		expect(entries[0]).toEqual({
			token: 181,
			day: 1,
			zone: "Interface",
			holder: C,
			holderKind: "holder",
			bidId: 5,
			signal: "the holder's",
			source: "holder",
			provisional: false,
		});
		expect(entries[1]).toMatchObject({
			token: 182,
			holder: B,
			holderKind: "bidder",
			signal: "still minting",
			source: "bid",
			provisional: false,
		});
		expect(entries[2]).toMatchObject({ token: 183, holder: null, signal: null, source: null });
	});

	it("live rows are provisional, and exports carry token, day, zone, holder, bidId, signal", () => {
		const entries = buildSignalEntries(
			inputs({
				liveBids: [{ id: 1, bidder: A }],
				bidSignals: new Map([bidSig(1, A, "line one\nline two")]),
			}),
		).slice(0, 1);
		expect(entries[0].provisional).toBe(true);
		expect(signalEntriesText(entries)).toBe(
			`#181 / Day 1, Interface / bidder (provisional) ${A} / from the bid\nline one\nline two`,
		);
		expect(JSON.parse(signalEntriesJson(entries))).toEqual([
			{
				token: 181,
				day: 1,
				zone: "Interface",
				holder: A,
				holderKind: "bidder",
				bidId: 1,
				signal: "line one\nline two",
				source: "bid",
				provisional: true,
			},
		]);
	});
});
