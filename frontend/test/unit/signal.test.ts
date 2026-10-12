import { describe, expect, it } from "vitest";
import {
	MAX_SIGNAL_BYTES,
	measureSignal,
	sanitizeSignal,
	signalByteLength,
	signalForBid,
	type SignalRow,
} from "@/lib/signal";

describe("signalByteLength", () => {
	it("counts UTF-8 bytes, the unit the contract measures", () => {
		expect(signalByteLength("")).toBe(0);
		expect(signalByteLength("abc")).toBe(3);
		expect(signalByteLength("é")).toBe(2);
		expect(signalByteLength("двор")).toBe(8);
		expect(signalByteLength("日本")).toBe(6);
		expect(signalByteLength("🌊")).toBe(4); // one astral code point, two UTF-16 units
		expect(signalByteLength("a\nb")).toBe(3);
	});
});

describe("sanitizeSignal", () => {
	it("trims surrounding whitespace", () => {
		expect(sanitizeSignal("   rain on a bus shelter \n\n")).toBe("rain on a bus shelter");
	});

	it("keeps newlines and normalises CRLF / CR to LF", () => {
		expect(sanitizeSignal("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
	});

	it("strips control characters other than the newline", () => {
		expect(sanitizeSignal("a\u0000b\u0007c\td\u001Be\u007Ff\u0085g")).toBe("abcdefg");
	});

	it("strips bidi overrides and isolates", () => {
		expect(sanitizeSignal("x‮evil‬y⁦z⁩")).toBe("xevilyz");
	});

	it("leaves ordinary text, accents, and emoji alone", () => {
		const text = "мой двор, тополиный пух. café 🌊";
		expect(sanitizeSignal(text)).toBe(text);
	});

	it("is idempotent", () => {
		const once = sanitizeSignal(" \u0001a\r\nb‮ ");
		expect(sanitizeSignal(once)).toBe(once);
	});
});

describe("measureSignal", () => {
	it("measures the sanitized text against the limit", () => {
		const draft = measureSignal("  hi\u0000  ");
		expect(draft).toEqual({ clean: "hi", bytes: 2, max: MAX_SIGNAL_BYTES, over: false });
	});

	it("allows exactly the limit and flags one byte over", () => {
		expect(measureSignal("a".repeat(280)).over).toBe(false);
		expect(measureSignal("a".repeat(281)).over).toBe(true);
		// 140 two-byte characters = 280 bytes; one more character tips it over.
		expect(measureSignal("é".repeat(140)).over).toBe(false);
		expect(measureSignal("é".repeat(140) + "a")).toMatchObject({ bytes: 281, over: true });
	});

	it("does not count stripped characters or trimmed whitespace", () => {
		expect(measureSignal(" ".repeat(500) + "ok" + "\u0000".repeat(500)).bytes).toBe(2);
	});

	it("honours a different on-chain limit", () => {
		expect(measureSignal("abcd", 3).over).toBe(true);
	});
});

describe("signalForBid", () => {
	const rows = new Map<number, SignalRow>([
		[7, { bidId: 7, bidder: "0x00000000000000000000000000000000000000Aa", signal: "hello" }],
	]);

	it("returns the signal when the bidder matches (case-insensitive)", () => {
		expect(signalForBid(rows, 7, "0x00000000000000000000000000000000000000aA")).toBe("hello");
	});

	it("ignores a log whose bidder does not own the bid", () => {
		expect(signalForBid(rows, 7, "0x00000000000000000000000000000000000000bb")).toBeUndefined();
		expect(signalForBid(rows, 8, "0x00000000000000000000000000000000000000aa")).toBeUndefined();
	});
});

describe("effectiveSignal", () => {
	it("is the winning bid's signal if it has one, else the holder's token signal", async () => {
		const { effectiveSignal } = await import("@/lib/signal");
		expect(effectiveSignal(undefined, undefined)).toBeUndefined();
		expect(effectiveSignal("", "")).toBeUndefined();
		expect(effectiveSignal("held", "bid")).toEqual({ signal: "bid", source: "bid" });
		expect(effectiveSignal("held", "")).toEqual({ signal: "held", source: "holder" });
		expect(effectiveSignal("held", undefined)).toEqual({ signal: "held", source: "holder" });
	});
});
