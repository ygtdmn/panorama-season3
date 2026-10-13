// In-memory demo engine that mirrors PanoramaSeason3Auction so the UI can be exercised
// end-to-end without a deployed contract. Client-side only; state is module-level and
// resets on a hard page reload (survives client-side nav).
//
// Parity rules (kept in lockstep with the Solidity):
// - every bid and top-up is a whole number of BID_TICK (0.001 ETH)
// - minimum bid when full = floor + CEIL(floor * bps / 10000), rounded up to the tick
// - once full, a new bid or a raised total may not equal any active bid (AmountTaken);
//   the advertised minimum steps past held amounts
// - at most 2 bids per wallet
// - inside the last 5 minutes, a raise below the (tick-rounded) extension threshold REVERTS
// - extensions move the end to now + 10m, capped at scheduledEnd + 24h (absoluteEndTime)
// - displacement and settlement excess are pushed straight back to the wallet (the pull
//   ledger only holds failed pushes, which cannot happen in the demo, so withdraw stays empty)
// - equal bids: the earlier bid id wins the earlier reveal slot
// - clearing price = floor when 30/30, reserve otherwise; every winner pays it
//
// Signals mirror PanoramaSeason3SignalController:
// - placeBid(signal) forwards a non-empty signal after every auction check; over
//   MAX_SIGNAL_BYTES UTF-8 bytes the whole bid reverts (SignalTooLong)
// - write-once, added later with no deadline: every new signal goes through _checkNew, in order
//   EmptySignal, SignalTooLong, SignalAlreadySet; nothing is ever changed or cleared
// - setBidSignal: only the bidder of a LIVE bid (NotBidder), then _checkNew
// - setTokenSignal: TokenOutOfRange, then the holder (NotTokenHolder), then _checkNew
// - a day's signal = the winning bid's if non-empty, else the holder's token signal

import { MAX_SIGNAL_BYTES, signalByteLength } from "@/lib/signal";

export type DemoPhaseNum = 0 | 1 | 2 | 3; // Active, Finalizing, Settled, Cancelled

// Every reviewable UI state, reachable in one click from the demo bar.
export type DemoScenario =
	| "upcoming"
	| "empty"
	| "bidding"
	| "full"
	| "paused"
	| "ended"
	| "settling"
	| "settled"
	| "cancelled"
	| "emergency";

export const DEMO_SCENARIOS: { key: DemoScenario; label: string }[] = [
	{ key: "upcoming", label: "upcoming" },
	{ key: "empty", label: "empty" },
	{ key: "bidding", label: "bidding" },
	{ key: "full", label: "full 30/30" },
	{ key: "paused", label: "paused" },
	{ key: "ended", label: "ended" },
	{ key: "settling", label: "settling" },
	{ key: "settled", label: "settled" },
	{ key: "cancelled", label: "cancelled" },
	{ key: "emergency", label: "emergency" },
];

export interface DemoBid {
	id: number;
	bidder: string;
	amount: bigint;
}

export interface DemoWon {
	id: number;
	bidder: string;
	amount: bigint;
	tokenId: number;
	pricePaid: bigint;
}

export interface DemoSnapshot {
	started: boolean;
	phase: DemoPhaseNum;
	paused: boolean;
	startTime: number;
	endTime: number;
	scheduledEndTime: number;
	absoluteEndTime: number;
	extensionCount: number;
	bids: DemoBid[];
	won: DemoWon[]; // minted winners, in mint order (mirrors Won events)
	bidSignals: Record<number, string>; // controller bidSignal (kept after a bid leaves, as on-chain)
	tokenSignals: Record<number, string>; // controller tokenSignal
	holders: Record<number, string>; // NFT ownerOf for minted days
	clearingPrice: bigint;
	proceeds: bigint;
	winnerCount: number;
	finalizeCursor: number;
	refundsComplete: boolean;
	pending: Record<string, bigint>; // pull ledger: failed pushes only (empty in demo)
	you: string;
	log: string[];
	actionStatus: "idle" | "success" | "error";
	/** The write the latest status belongs to (mirrors AuctionActions.lastAction). */
	lastAction?: string;
	actionError: string | null;
}

export const DEMO_MAX_UNITS = 30;
export const DEMO_MAX_BIDS_PER_WALLET = 2;
// Mirrors BID_TICK: every bid and top-up is a whole number of 0.001 ETH.
export const DEMO_BID_TICK = 1_000_000_000_000_000n;
// 0.1 ETH: equals the contract's MIN_RESERVE_PRICE floor (bids below it are rejected).
export const DEMO_RESERVE = 100_000_000_000_000_000n;
export const DEMO_INC_BPS = 500; // 5%
export const DEMO_DURATION = 24 * 3600;
export const DEMO_EXT_WINDOW = 5 * 60;
export const DEMO_EXT_LEN = 10 * 60;
export const DEMO_MAX_TOTAL_EXTENSION = 24 * 3600;
export const DEMO_FINALIZE_GRACE = 7 * 24 * 3600;
export const DEMO_EMERGENCY_GRACE = 30 * 24 * 3600;
// Mirrors SPLIT_A_BPS: payout A takes 58%, payout B the rest.
export const DEMO_SPLIT_A_BPS = 5_800;
export const DEMO_MAX_SIGNAL_BYTES = MAX_SIGNAL_BYTES;
export const DEMO_FIRST_TOKEN_ID = 181;
const BPS = 10_000n;
const FIRST_TOKEN_ID = DEMO_FIRST_TOKEN_ID;

export const DEMO_PAYOUT_A = "0x" + "a".repeat(40);
export const DEMO_PAYOUT_B = "0x" + "b".repeat(40);
export const DEMO_IDENTITIES = [
	"0x" + "d0".repeat(20),
	"0x" + "d1".repeat(20),
	"0x" + "d2".repeat(20),
];

const now = () => Math.floor(Date.now() / 1000);

// A few signals for seeded bids, so the board markers and the admin list have something to show.
const SEED_SIGNALS = [
	"the bridge my grandfather crossed every morning",
	"rain on a bus shelter at 6am",
	"keep one window lit",
	"a field where the road ends",
	"мой двор, тополиный пух",
	"the sound of trams at night\nand nothing after",
];
let seedSignalIndex = 0;

/** Push a seeded bid; every third one carries a signal (mirrors placeBid forwarding it). */
function pushSeedBid(bidder: string, amount: bigint) {
	const id = nextId++;
	state.bids.push({ id, bidder, amount });
	if (id % 3 === 1) state.bidSignals[id] = SEED_SIGNALS[seedSignalIndex++ % SEED_SIGNALS.length];
}

const DEMO_LAST_TOKEN_ID = 181 + 30 - 1;

const SIGNAL_TOO_LONG = `A signal holds at most ${MAX_SIGNAL_BYTES} characters. Shorten it and send again.`;

/** Mirrors the controller's `_checkNew`: the error sentence, or null when the signal may be written. */
function checkNew(existing: string | undefined, signal: string): string | null {
	if (signal.length === 0) return "Write something first.";
	if (signalByteLength(signal) > DEMO_MAX_SIGNAL_BYTES) return SIGNAL_TOO_LONG;
	if (existing) return "This already has a signal. Signals can't be changed.";
	return null;
}
const padAddr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const rand = (max: number) => Math.floor(Math.random() * max);

/** Ceiling basis-point increment, identical to the contract's `_bpsIncrement`. */
export function bpsIncrement(amount: bigint, bps: number = DEMO_INC_BPS): bigint {
	return (amount * BigInt(bps) + BPS - 1n) / BPS;
}

function initial(): DemoSnapshot {
	return {
		started: false,
		phase: 0,
		paused: false,
		startTime: 0,
		endTime: 0,
		scheduledEndTime: 0,
		absoluteEndTime: 0,
		extensionCount: 0,
		bids: [],
		won: [],
		bidSignals: {},
		tokenSignals: {},
		holders: {},
		clearingPrice: 0n,
		proceeds: 0n,
		winnerCount: 0,
		finalizeCursor: 0,
		refundsComplete: false,
		pending: {},
		you: DEMO_IDENTITIES[0],
		log: [],
		actionStatus: "idle",
		actionError: null,
	};
}

let state: DemoSnapshot = initial();
let nextId = 1;
let seedCounter = 0x51d000;
const listeners = new Set<() => void>();

const serverSnapshot: DemoSnapshot = initial();

function emit() {
	// New reference so useSyncExternalStore detects the change.
	state = { ...state };
	for (const l of listeners) l();
}

function log(msg: string) {
	state.log = [`${new Date().toLocaleTimeString()}  ${msg}`, ...state.log].slice(0, 40);
}

function fmt(wei: bigint) {
	return `${Number(wei) / 1e18} ETH`;
}

// --- derived helpers -------------------------------------------------------

export function isFull() {
	return state.bids.length >= DEMO_MAX_UNITS;
}

export function lowestBid(): DemoBid | null {
	if (state.bids.length === 0) return null;
	// Equal amounts: the LATER bid id is the worse one (it sits at the heap root), matching
	// the contract's displacement order.
	return state.bids.reduce(
		(lo, b) => (b.amount < lo.amount || (b.amount === lo.amount && b.id > lo.id) ? b : lo),
		state.bids[0],
	);
}

/** Rounds up to a whole number of ticks, identical to the contract's `_roundUpToTick`. */
export function roundUpToTick(amount: bigint): bigint {
	return ((amount + DEMO_BID_TICK - 1n) / DEMO_BID_TICK) * DEMO_BID_TICK;
}

/** Whether an active bid already holds this amount (the contract's `bidsAtAmount != 0`). */
function amountHeld(amount: bigint): boolean {
	return state.bids.some((b) => b.amount === amount);
}

/** First amount at or above `amount`, on the tick, that no active bid holds. */
function nextFreeAmount(amount: bigint): bigint {
	let x = roundUpToTick(amount);
	while (amountHeld(x)) x += DEMO_BID_TICK;
	return x;
}

/** Mirrors the contract's `minimumBid()`: rounded to the tick, stepped past held amounts. */
export function minimumBid(): bigint {
	if (!isFull()) return DEMO_RESERVE;
	const floor = lowestBid()!.amount;
	return nextFreeAmount(floor + bpsIncrement(floor));
}

/** Mirrors `_extendThreshold`: the floor-based raise threshold, rounded up to the tick. */
export function extendThreshold(floor: bigint): bigint {
	return roundUpToTick(bpsIncrement(floor));
}

export function currentClearing(): bigint {
	return isFull() ? lowestBid()!.amount : DEMO_RESERVE;
}

function biddable(): { ok: boolean; reason?: string } {
	if (state.phase !== 0) return { ok: false, reason: "The auction is not accepting bids." };
	if (state.paused) return { ok: false, reason: "Bidding is paused." };
	const t = now();
	if (t < state.startTime) return { ok: false, reason: "Bidding has not opened yet." };
	if (t >= state.endTime) return { ok: false, reason: "Bidding has ended." };
	return { ok: true };
}

function inExtensionWindow(): boolean {
	return now() + DEMO_EXT_WINDOW >= state.endTime;
}

function maybeExtend() {
	// Anti-snipe: extend to now + 10m, never past absoluteEndTime (scheduled end + 24h).
	if (inExtensionWindow()) {
		let newEnd = now() + DEMO_EXT_LEN;
		if (newEnd > state.absoluteEndTime) newEnd = state.absoluteEndTime;
		if (newEnd > state.endTime) {
			state.endTime = newEnd;
			state.extensionCount += 1;
			log(`Anti-snipe: extended to +${Math.round((newEnd - now()) / 60)}m (extension ${state.extensionCount})`);
		}
	}
}

function releaseProceedsIfDone() {
	if (state.proceeds > 0n) {
		const a = (state.proceeds * BigInt(DEMO_SPLIT_A_BPS)) / BPS;
		const bShare = state.proceeds - a;
		log(`Proceeds released: ${fmt(state.proceeds)} → A ${fmt(a)} / B ${fmt(bShare)}`);
	}
}

// --- store api -------------------------------------------------------------

export const demoStore = {
	subscribe(l: () => void) {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	getSnapshot() {
		return state;
	},
	getServerSnapshot() {
		return serverSnapshot;
	},

	start(seed = true) {
		if (state.started) return;
		state.started = true;
		state.startTime = now();
		state.endTime = now() + DEMO_DURATION;
		state.scheduledEndTime = state.endTime;
		state.absoluteEndTime = state.endTime + DEMO_MAX_TOTAL_EXTENSION;
		if (seed) {
			// Seed competing bids with a wide spread so the ladder reads well.
			for (let i = 0; i < 11; i++) {
				pushSeedBid(
					padAddr(seedCounter++),
					DEMO_RESERVE + BigInt(rand(600)) * 1_000_000_000_000_000n,
				);
			}
			log("Demo auction started with 11 seed bids.");
		} else {
			log("Demo reset to an empty auction.");
		}
		emit();
	},

	// Reset clears to a clean, empty board so the flow can be tested from zero bids.
	reset() {
		state = initial();
		nextId = 1;
		seedCounter = 0x51d000;
		seedSignalIndex = 0;
		this.start(false);
	},

	// Put the auction into the pre-open "upcoming" state: it opens in one day, so the
	// header counts down to the start with an empty board.
	setUpcoming() {
		this.jumpTo("upcoming");
	},

	// Jump straight to any UI state so every branch can be reviewed with one click.
	jumpTo(scenario: DemoScenario) {
		state = initial();
		nextId = 1;
		seedCounter = 0x51d000;
		seedSignalIndex = 0;
		const t = now();

		// Open the auction with a start/end schedule. `openedAgo` seconds in the past
		// (or negative to schedule a future open for the "upcoming" state).
		const open = (openedAgo: number) => {
			state.started = true;
			state.startTime = t - openedAgo;
			state.endTime = state.startTime + DEMO_DURATION;
			state.scheduledEndTime = state.endTime;
			state.absoluteEndTime = state.endTime + DEMO_MAX_TOTAL_EXTENSION;
		};
		const seed = (n: number, includeYou = false) => {
			for (let i = 0; i < n; i++) {
				pushSeedBid(
					padAddr(seedCounter++),
					DEMO_RESERVE + BigInt(50 + rand(600)) * 1_000_000_000_000_000n,
				);
			}
			if (includeYou) {
				const id = nextId++;
				state.bids.push({
					id,
					bidder: state.you,
					amount: DEMO_RESERVE + 320_000_000_000_000_000n,
				});
				state.bidSignals[id] = "the street I grew up on";
			}
		};
		// Mint winners highest-first, exactly like finalize(), without touching action status.
		const settle = (mintAll: boolean) => {
			state.clearingPrice = currentClearing();
			state.bids.sort((a, b) =>
				a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : a.id - b.id,
			);
			state.winnerCount = state.bids.length;
			const target = mintAll ? state.bids.length : Math.ceil(state.bids.length / 2);
			const cp = state.clearingPrice;
			for (let i = 0; i < target; i++) {
				const bid = state.bids.shift()!;
				const tokenId = FIRST_TOKEN_ID + state.finalizeCursor;
				state.won.push({
					id: bid.id,
					bidder: bid.bidder,
					amount: bid.amount,
					tokenId,
					pricePaid: cp,
				});
				state.holders[tokenId] = bid.bidder;
				state.finalizeCursor += 1;
				state.proceeds += cp;
			}
			state.phase = state.bids.length === 0 ? 2 : 1;
		};

		switch (scenario) {
			case "upcoming":
				open(-24 * 3600); // opens in 1 day
				break;
			case "empty":
				open(3600);
				break;
			case "bidding":
				open(3600);
				seed(10, true);
				break;
			case "full":
				open(3600);
				seed(DEMO_MAX_UNITS);
				break;
			case "paused":
				open(3600);
				seed(10, true);
				state.paused = true;
				break;
			case "ended":
				open(DEMO_DURATION + 120);
				seed(20, true);
				state.endTime = t - 30; // closed, awaiting settlement
				break;
			case "settling":
				open(DEMO_DURATION + 120);
				seed(20, true);
				state.endTime = t - 30;
				settle(false); // phase 1, minted partway
				break;
			case "settled":
				open(DEMO_DURATION + 120);
				seed(20, true);
				state.endTime = t - 30;
				// A second bid of yours without a signal, so "Your days" can show "Add a signal".
				state.bids.push({ id: nextId++, bidder: state.you, amount: DEMO_RESERVE + 210_000_000_000_000_000n });
				settle(true); // phase 2, all minted
				// One holder already added a signal to a day whose winning bid carried none.
				{
					const quiet = state.won.find((w) => !state.bidSignals[w.id] && w.bidder !== state.you);
					if (quiet) state.tokenSignals[quiet.tokenId] = "a lit kiosk at the last tram stop";
				}
				// A failed excess push would land in the pull ledger; seed one so the
				// "Refund available / withdraw" panel is visible too.
				state.pending[state.you] = 120_000_000_000_000_000n;
				break;
			case "cancelled":
				open(3600);
				seed(20, true);
				state.phase = 3; // cancelled with bids still owed refunds
				break;
			case "emergency":
				open(DEMO_DURATION + DEMO_EMERGENCY_GRACE + 300);
				seed(20, true);
				// endTime and absoluteEndTime far enough back that the emergency window is open.
				state.endTime = t - DEMO_EMERGENCY_GRACE - 200;
				state.absoluteEndTime = t - DEMO_EMERGENCY_GRACE - 100;
				break;
		}
		log(`Jumped to "${scenario}".`);
		emit();
	},

	/** Names the write about to run, so the page can pick its success copy and reset its form. */
	setLastAction(name: string) {
		state.lastAction = name;
	},

	setStatus(s: DemoSnapshot["actionStatus"], err: string | null = null) {
		state.actionStatus = s;
		state.actionError = err;
		emit();
	},

	setYou(addr: string) {
		state.you = addr;
		emit();
	},

	setPaused(p: boolean) {
		state.paused = p;
		log(p ? "Bidding paused." : "Bidding unpaused.");
		emit();
	},

	endNow() {
		state.endTime = now();
		if (state.absoluteEndTime < state.endTime) state.absoluteEndTime = state.endTime;
		log("Auction time ended (demo control).");
		emit();
	},

	placeBid(from: string, amount: bigint, signal = "") {
		const b = biddable();
		if (!b.ok) return this.setStatus("error", b.reason);
		const count = state.bids.filter((x) => x.bidder === from).length;
		if (count >= DEMO_MAX_BIDS_PER_WALLET)
			return this.setStatus("error", "This wallet already holds the maximum of 2 bids.");
		if (amount < DEMO_RESERVE)
			return this.setStatus("error", `Bid is below the reserve (${fmt(DEMO_RESERVE)}).`);
		if (amount % DEMO_BID_TICK !== 0n)
			return this.setStatus("error", "Bids go in steps of 0.001 ETH.");

		let displaced: DemoBid | null = null;
		if (isFull()) {
			const floor = lowestBid()!.amount;
			const min = roundUpToTick(floor + bpsIncrement(floor));
			if (amount < min)
				return this.setStatus("error", `Bid too low. The minimum right now is ${fmt(minimumBid())}.`);
			if (amountHeld(amount))
				return this.setStatus("error", "Someone already holds that amount. Try 0.001 more or less.");
			displaced = lowestBid()!;
		}
		// The auction forwards the signal to the controller last; an oversized one reverts the
		// whole bid, so nothing below has happened yet.
		if (signal.length > 0) {
			const problem = checkNew(undefined, signal);
			if (problem) return this.setStatus("error", problem);
		}

		if (displaced) {
			const low = displaced;
			state.bids = state.bids.filter((x) => x.id !== low.id);
			// The contract force-sends the refund to the wallet; nothing lands in the pull ledger.
			log(`Displaced #${low.id} (${fmt(low.amount)}) → refunded straight to ${short(low.bidder)}`);
		}

		const id = nextId++;
		state.bids.push({ id, bidder: from, amount });
		// A new accepted bid always qualifies for the anti-snipe extension.
		maybeExtend();
		log(`Bid ${fmt(amount)} from ${short(from)}`);
		if (signal.length > 0) {
			state.bidSignals = { ...state.bidSignals, [id]: signal };
			log(`Signal stored for bid #${id}`);
		}
		this.setStatus("success");
	},

	/** Mirrors the controller's setBidSignal: the live bid's own bidder, once, no deadline. */
	setBidSignal(from: string, bidId: number, signal: string) {
		const bid = state.bids.find((x) => x.id === bidId);
		if (!bid || bid.bidder !== from)
			return this.setStatus(
				"error",
				"Only the bidder can add a signal to this bid, and only while the bid is live.",
			);
		const problem = checkNew(state.bidSignals[bidId], signal);
		if (problem) return this.setStatus("error", problem);
		state.bidSignals = { ...state.bidSignals, [bidId]: signal };
		log(`Signal added to bid #${bidId}`);
		this.setStatus("success");
	},

	/** Mirrors the controller's setTokenSignal: the day's holder, once, no deadline. */
	setTokenSignal(from: string, tokenId: number, signal: string) {
		if (tokenId < FIRST_TOKEN_ID || tokenId > DEMO_LAST_TOKEN_ID)
			return this.setStatus("error", "That token is not a Season 3 day.");
		if (state.holders[tokenId] !== from)
			return this.setStatus("error", "Only the wallet holding this day can add its signal.");
		const problem = checkNew(state.tokenSignals[tokenId], signal);
		if (problem) return this.setStatus("error", problem);
		state.tokenSignals = { ...state.tokenSignals, [tokenId]: signal };
		log(`Day signal added to #${tokenId}`);
		this.setStatus("success");
	},

	increaseBid(from: string, id: number, add: bigint) {
		const b = biddable();
		if (!b.ok) return this.setStatus("error", b.reason);
		const bid = state.bids.find((x) => x.id === id && x.bidder === from);
		if (!bid) return this.setStatus("error", "That bid belongs to a different wallet.");
		if (add <= 0n) return this.setStatus("error", "Enter an amount to raise by.");
		if (add % DEMO_BID_TICK !== 0n)
			return this.setStatus("error", "Bids go in steps of 0.001 ETH.");

		// Contract rule: inside the extension window, raises below the floor-based threshold
		// revert so a competitive raise cannot be split into dust to dodge the anti-snipe.
		const threshold = extendThreshold(lowestBid()!.amount);
		if (inExtensionWindow() && add < threshold) {
			return this.setStatus(
				"error",
				`Raises in the final five minutes must add at least ${fmt(threshold)}.`,
			);
		}

		// Once all days are held, the new total must differ from every active bid.
		if (isFull() && amountHeld(bid.amount + add))
			return this.setStatus("error", "Someone already holds that amount. Try 0.001 more or less.");

		bid.amount += add;
		if (add >= threshold) maybeExtend();
		log(`Raised #${id} by ${fmt(add)} → ${fmt(bid.amount)}`);
		this.setStatus("success");
	},

	withdraw(from: string) {
		const amt = state.pending[from] ?? 0n;
		if (amt === 0n) return this.setStatus("error", "Nothing to withdraw for this wallet.");
		state.pending[from] = 0n;
		log(`Withdrew ${fmt(amt)} to ${short(from)}`);
		this.setStatus("success");
	},

	finalize(batch: number) {
		if (state.phase !== 0 && state.phase !== 1)
			return this.setStatus("error", "Settlement is not available in this phase.");
		if (now() < state.endTime) return this.setStatus("error", "The auction has not ended yet.");
		if (batch < 1) return this.setStatus("error", "Batch size must be at least 1.");

		if (state.phase === 0) {
			state.clearingPrice = currentClearing();
			// Mint highest bid first; equal amounts go to the earlier bid id (earlier reveal).
			state.bids.sort((a, b) =>
				a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : a.id - b.id,
			);
			state.winnerCount = state.bids.length;
			state.finalizeCursor = 0;
			state.phase = 1;
			log(
				`Finalizing. Clearing price = ${fmt(state.clearingPrice)}, winners = ${state.winnerCount}`,
			);
		}

		const cp = state.clearingPrice;
		let processed = 0;
		while (state.bids.length > 0 && processed < batch) {
			const bid = state.bids.shift()!;
			const tokenId = FIRST_TOKEN_ID + state.finalizeCursor;
			state.won.push({ id: bid.id, bidder: bid.bidder, amount: bid.amount, tokenId, pricePaid: cp });
			state.holders = { ...state.holders, [tokenId]: bid.bidder };
			state.finalizeCursor += 1;
			state.proceeds += cp;
			const excess = bid.amount - cp;
			// Excess is pushed straight back to the winner's wallet (pull ledger only on failure).
			if (excess > 0n) log(`Excess ${fmt(excess)} refunded straight to ${short(bid.bidder)}`);
			processed += 1;
		}
		log(`Finalized batch of ${processed}. Remaining: ${state.bids.length}`);

		if (state.bids.length === 0) {
			state.phase = 2;
			releaseProceedsIfDone();
			log(`Settled. ${state.winnerCount} winners at ${fmt(cp)} each.`);
		}
		this.setStatus("success");
	},

	cancel() {
		if (state.phase !== 0)
			return this.setStatus("error", "The auction can only be cancelled while active.");
		state.phase = 3;
		if (state.bids.length === 0) {
			state.refundsComplete = true;
			releaseProceedsIfDone();
			log("Auction cancelled with no bids. Recovery complete.");
		} else {
			log("Auction cancelled. Run refundAll to return bids.");
		}
		this.setStatus("success");
	},

	refundAll(batch: number) {
		if (state.phase !== 3) return this.setStatus("error", "Refund-all needs a cancelled auction.");
		if (state.refundsComplete) return this.setStatus("error", "Refunds are already complete.");
		if (batch < 1) return this.setStatus("error", "Batch size must be at least 1.");
		let processed = 0;
		while (state.bids.length > 0 && processed < batch) {
			const bid = state.bids.shift()!;
			log(`Refunded ${fmt(bid.amount)} straight to ${short(bid.bidder)}`);
			processed += 1;
		}
		log(`Refunded batch of ${processed}. Remaining: ${state.bids.length}`);
		if (state.bids.length === 0) {
			state.refundsComplete = true;
			releaseProceedsIfDone();
			log("Recovery complete.");
		}
		this.setStatus("success");
	},

	emergencyRefund(batch: number) {
		if (now() <= state.absoluteEndTime + DEMO_EMERGENCY_GRACE)
			return this.setStatus("error", "The emergency window has not opened yet.");
		if (state.phase === 2) return this.setStatus("error", "The auction is already settled.");
		if (state.phase !== 3) {
			state.phase = 3;
			log("Emergency refund started. Settlement is locked out.");
		}
		this.refundAll(batch);
	},

	recoverSupplyMismatch() {
		// The demo has no external minter, so supply always matches (contract: SupplyNotMismatched).
		this.setStatus("error", "Supply matches. Mismatch recovery is not needed.");
	},

	// demo-only controls
	seedBid() {
		if (state.phase !== 0) return;
		const amount = isFull()
			? nextFreeAmount(minimumBid() + BigInt(rand(50)) * DEMO_BID_TICK)
			: DEMO_RESERVE + BigInt(rand(50)) * DEMO_BID_TICK;
		if (isFull()) {
			const low = lowestBid()!;
			state.bids = state.bids.filter((x) => x.id !== low.id);
			log(`Displaced #${low.id} (${fmt(low.amount)}) → refunded straight to ${short(low.bidder)}`);
		}
		pushSeedBid(padAddr(seedCounter++), amount);
		maybeExtend();
		log(`Seeded competing bid ${fmt(amount)}`);
		emit();
	},

	fillToCapacity() {
		let guard = 0;
		while (state.bids.length < DEMO_MAX_UNITS && guard < 200) {
			const amount = DEMO_RESERVE + BigInt(rand(200)) * 1_000_000_000_000_000n;
			pushSeedBid(padAddr(seedCounter++), amount);
			guard++;
		}
		log(`Filled to ${state.bids.length}/${DEMO_MAX_UNITS}`);
		emit();
	},
};

function short(a: string) {
	return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
