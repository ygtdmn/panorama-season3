// A signal: a short message for the day a bid wins, or to anyone at all.
// PanoramaSeason3SignalController stores it, rejects anything over MAX_SIGNAL_BYTES UTF-8 bytes
// (SignalTooLong), and keeps it write-once: it can be added later with no deadline (by the live
// bid's bidder, or by a day's holder), but never changed or cleared. It never affects price or rank.

/** Mirrors the controller's MAX_SIGNAL_BYTES. The live value is read from the contract. */
export const MAX_SIGNAL_BYTES = 280;

const encoder = new TextEncoder();

// C0 controls except \n (U+000A), DEL, and C1 controls. Bidi embedding/override/isolate
// characters go too: they can make public text render as something other than what was sent.
const STRIP = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * What gets sent on-chain: line endings normalised to \n, control characters other than the
 * newline removed, then trimmed. Idempotent.
 */
export function sanitizeSignal(raw: string): string {
	return raw.replace(/\r\n?/g, "\n").replace(STRIP, "").trim();
}

/** UTF-8 byte length, the unit the contract counts in. */
export function signalByteLength(text: string): number {
	return encoder.encode(text).length;
}

export interface SignalDraft {
	/** The sanitized text that would be sent. */
	clean: string;
	/** UTF-8 bytes of `clean`. */
	bytes: number;
	max: number;
	/** True when `clean` is longer than the contract accepts. */
	over: boolean;
}

/** Sanitize a draft and measure it against the byte limit. */
export function measureSignal(raw: string, max: number = MAX_SIGNAL_BYTES): SignalDraft {
	const clean = sanitizeSignal(raw);
	const bytes = signalByteLength(clean);
	return { clean, bytes, max, over: bytes > max };
}

/** A bid's stored signal (controller `bidSignal`), with the bidder taken from the bid row. */
export interface SignalRow {
	bidId: number;
	bidder: `0x${string}`;
	signal: string;
}

/**
 * The signal stored for a bid, when the row's bidder matches. The rows are built from the bid
 * board, so this is mostly a guard against pairing a stale map with a newer board.
 */
export function signalForBid(
	signals: ReadonlyMap<number, SignalRow>,
	bidId: number,
	bidder: string,
): string | undefined {
	const row = signals.get(bidId);
	if (!row) return undefined;
	return row.bidder.toLowerCase() === bidder.toLowerCase() ? row.signal : undefined;
}

// ---- a day's signal ------------------------------------------------------------------------

export interface EffectiveSignal {
	signal: string;
	/** Whose signal it is: the winning bid's, or added by the day's holder. */
	source: "bid" | "holder";
}

/**
 * A day's signal, as the controller's `signalOf(tokenId, winningBidId)` defines it: the winning
 * bid's signal if it has one, else the holder's token signal. Undefined when neither exists.
 */
export function effectiveSignal(
	tokenSignal: string | undefined,
	winningBidSignal: string | undefined,
): EffectiveSignal | undefined {
	if (winningBidSignal) return { signal: winningBidSignal, source: "bid" };
	if (tokenSignal) return { signal: tokenSignal, source: "holder" };
	return undefined;
}
