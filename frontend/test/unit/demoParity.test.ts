import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	bpsIncrement,
	demoStore,
	DEMO_FIRST_TOKEN_ID,
	DEMO_MAX_SIGNAL_BYTES,
	DEMO_BID_TICK,
	DEMO_MAX_BIDS_PER_WALLET,
	DEMO_MAX_UNITS,
	DEMO_RESERVE,
	minimumBid,
} from "@/app/auction/demo/demoStore";

/** Reference implementation of the contract's `_bpsIncrement` (ceiling division). */
function solidityBpsIncrement(amount: bigint, bps: bigint): bigint {
	return (amount * bps + 10_000n - 1n) / 10_000n;
}

// The sibling Foundry project, when this app sits in the monorepo or the release repo.
const CONTRACT_SOURCE = [
	"../../../contracts/src/PanoramaSeason3Auction.sol",
	"../../../../panorama-season3/contracts/src/PanoramaSeason3Auction.sol",
]
	.map((rel) => path.resolve(__dirname, rel))
	.find((p) => fs.existsSync(p));
const CONTROLLER_SOURCE = CONTRACT_SOURCE?.replace(
	"PanoramaSeason3Auction.sol",
	"PanoramaSeason3SignalController.sol",
);

function solidityConstant(name: string, file = CONTRACT_SOURCE): bigint | null {
	if (!file || !fs.existsSync(file)) return null;
	const src = fs.readFileSync(file, "utf8");
	const m = src.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)\\s*;`));
	return m ? BigInt(m[1].replace(/_/g, "")) : null;
}

describe("demo store parity with PanoramaSeason3Auction", () => {
	it("bpsIncrement matches the contract's ceiling math exactly", () => {
		const samples: bigint[] = [
			1n,
			2n,
			1_999n,
			10_000n,
			100_000_000_000_000_000n, // 0.1 ETH
			100_000_000_000_000_001n,
			333_333_333_333_333_333n,
			1_000_000_000_000_000_000n,
		];
		for (const amount of samples) {
			expect(bpsIncrement(amount, 500)).toBe(solidityBpsIncrement(amount, 500n));
		}
	});

	it("rounds UP where floor division would understate the advertised percentage", () => {
		// 1999 * 500 / 10000 = 99.95 -> ceil 100, floor 99. The contract requires 100.
		expect(bpsIncrement(1_999n, 500)).toBe(100n);
	});

	it("demo reserve equals the contract's MIN_RESERVE_PRICE floor (0.1 ETH)", () => {
		expect(DEMO_RESERVE).toBe(100_000_000_000_000_000n);
	});

	it("sells thirty units starting at #181 with a 280-byte signal limit", () => {
		expect(DEMO_MAX_UNITS).toBe(30);
		expect(DEMO_FIRST_TOKEN_ID).toBe(181);
		expect(DEMO_MAX_SIGNAL_BYTES).toBe(280);
	});

	it.skipIf(!CONTRACT_SOURCE)("constants match the Solidity source", () => {
		expect(solidityConstant("MAX_UNITS")).toBe(BigInt(DEMO_MAX_UNITS));
		expect(solidityConstant("FIRST_TOKEN_ID")).toBe(BigInt(DEMO_FIRST_TOKEN_ID));
		expect(solidityConstant("MAX_SIGNAL_BYTES", CONTROLLER_SOURCE)).toBe(BigInt(DEMO_MAX_SIGNAL_BYTES));
		const controller = fs.readFileSync(CONTROLLER_SOURCE!, "utf8");
		// Write-once, no deadline: no lock or freeze left in the controller.
		expect(controller).not.toMatch(/LOCK_LEAD|lockTime|SignalLocked/);
		expect(controller).toMatch(/error SignalAlreadySet\(\);/);
		expect(controller).toMatch(/error EmptySignal\(\);/);
		expect(solidityConstant("MAX_BIDS_PER_WALLET")).toBe(BigInt(DEMO_MAX_BIDS_PER_WALLET));
		const src = fs.readFileSync(CONTRACT_SOURCE!, "utf8");
		expect(src).toMatch(/\bBID_TICK\s*=\s*0\.001 ether\s*;/);
		expect(DEMO_BID_TICK).toBe(1_000_000_000_000_000n);
	});
});

const milli = (n: number) => BigInt(n) * DEMO_BID_TICK; // n thousandths of an ETH
const wallet = (i: number) => "0x" + i.toString(16).padStart(40, "0");

/** Fills all thirty days with one bid each from distinct wallets. */
function fillWith(amount: (i: number) => bigint) {
	for (let i = 0; i < DEMO_MAX_UNITS; i++) demoStore.placeBid(wallet(1000 + i), amount(i), "");
}

describe("demo bid rules mirror the contract (2 per wallet, 0.001 steps, unique once full)", () => {
	const you = () => demoStore.getSnapshot().you;
	beforeEach(() => {
		demoStore.jumpTo("empty");
	});

	it("holds at most two bids per wallet", () => {
		demoStore.placeBid(you(), milli(100), "");
		demoStore.placeBid(you(), milli(101), "");
		expect(demoStore.getSnapshot().actionStatus).toBe("success");
		demoStore.placeBid(you(), milli(102), "");
		const snap = demoStore.getSnapshot();
		expect(snap.actionError).toBe("This wallet already holds the maximum of 2 bids.");
		expect(snap.bids).toHaveLength(2);
	});

	it("rejects amounts off the 0.001 ETH tick, for bids and raises", () => {
		demoStore.placeBid(you(), milli(113) + DEMO_BID_TICK / 10n, ""); // 0.1131
		expect(demoStore.getSnapshot().actionError).toBe("Bids go in steps of 0.001 ETH.");
		demoStore.placeBid(you(), milli(113), "");
		const id = demoStore.getSnapshot().bids[0].id;
		demoStore.increaseBid(you(), id, DEMO_BID_TICK / 2n);
		expect(demoStore.getSnapshot().actionError).toBe("Bids go in steps of 0.001 ETH.");
		expect(demoStore.getSnapshot().bids[0].amount).toBe(milli(113));
	});

	it("allows equal amounts until all thirty days are held", () => {
		fillWith(() => milli(100));
		const snap = demoStore.getSnapshot();
		expect(snap.actionStatus).toBe("success");
		expect(snap.bids).toHaveLength(DEMO_MAX_UNITS);
	});

	it("once full, a new bid may not equal a held amount (the 0.11 example)", () => {
		fillWith(() => milli(100));
		demoStore.placeBid(wallet(1), milli(110), "");
		expect(demoStore.getSnapshot().actionStatus).toBe("success");

		demoStore.placeBid(wallet(2), milli(110), "");
		expect(demoStore.getSnapshot().actionError).toBe(
			"Someone already holds that amount. Try 0.001 more or less.",
		);
		demoStore.placeBid(wallet(2), milli(109), "");
		expect(demoStore.getSnapshot().actionStatus).toBe("success");
		demoStore.placeBid(wallet(3), milli(111), "");
		expect(demoStore.getSnapshot().actionStatus).toBe("success");
	});

	it("once full, a raise may not land on a held amount", () => {
		fillWith(() => milli(100));
		demoStore.placeBid(wallet(1), milli(110), "");
		demoStore.placeBid(wallet(2), milli(105), "");
		const mine = demoStore.getSnapshot().bids.find((b) => b.bidder === wallet(2))!;
		demoStore.increaseBid(wallet(2), mine.id, milli(5)); // 0.105 + 0.005 = 0.110, held
		expect(demoStore.getSnapshot().actionError).toBe(
			"Someone already holds that amount. Try 0.001 more or less.",
		);
		demoStore.increaseBid(wallet(2), mine.id, milli(6));
		expect(demoStore.getSnapshot().bids.find((b) => b.id === mine.id)!.amount).toBe(milli(111));
	});

	it("rounds the minimum up to the tick (floor 0.111 -> 0.117)", () => {
		fillWith(() => milli(111));
		// 0.111 * 1.05 = 0.11655 -> 0.117
		expect(minimumBid()).toBe(milli(117));
	});

	it("the advertised minimum steps past held amounts and is always placeable", () => {
		fillWith(() => milli(100));
		demoStore.placeBid(wallet(1), milli(105), ""); // floor stays 0.1, so 0.105 is now held
		expect(minimumBid()).toBe(milli(106));
		demoStore.placeBid(wallet(2), minimumBid(), "");
		expect(demoStore.getSnapshot().actionStatus).toBe("success");
	});
});

describe("demo signals mirror PanoramaSeason3SignalController (write-once, add later)", () => {
	const you = () => demoStore.getSnapshot().you;
	const other = "0x" + "e1".repeat(20);
	const ALREADY = "This already has a signal. Signals can't be changed.";
	beforeEach(() => {
		demoStore.jumpTo("empty");
	});

	it("placeBid stores a non-empty signal for the new bid, and nothing for an empty one", () => {
		demoStore.placeBid(you(), DEMO_RESERVE, "");
		demoStore.placeBid(you(), DEMO_RESERVE, "a field where the road ends");
		const snap = demoStore.getSnapshot();
		expect(snap.actionStatus).toBe("success");
		expect(snap.bids).toHaveLength(2);
		expect(snap.bidSignals).toEqual({ [snap.bids[1].id]: "a field where the road ends" });
	});

	it("an oversized signal reverts the whole bid (280 bytes ok, 281 not)", () => {
		// "é" is two bytes: 140 of them is exactly 280 bytes in 140 characters.
		demoStore.placeBid(you(), DEMO_RESERVE, "é".repeat(140));
		expect(demoStore.getSnapshot().actionStatus).toBe("success");

		demoStore.placeBid(you(), DEMO_RESERVE, "é".repeat(140) + "x");
		const snap = demoStore.getSnapshot();
		expect(snap.actionError).toBe("A signal holds at most 280 characters. Shorten it and send again.");
		expect(snap.bids).toHaveLength(1); // the rejected bid was never placed
	});

	it("setBidSignal adds once to a live bid without one; never replaces; checks run in order", () => {
		demoStore.placeBid(you(), DEMO_RESERVE, "");
		const id = demoStore.getSnapshot().bids[0].id;
		demoStore.setBidSignal(other, id, "not mine");
		expect(demoStore.getSnapshot().actionError).toBe(
			"Only the bidder can add a signal to this bid, and only while the bid is live.",
		);
		demoStore.setBidSignal(you(), id, "");
		expect(demoStore.getSnapshot().actionError).toBe("Write something first.");
		demoStore.setBidSignal(you(), id, "a".repeat(281));
		expect(demoStore.getSnapshot().actionError).toContain("at most 280 characters");
		demoStore.setBidSignal(you(), id, "keep one window lit");
		expect(demoStore.getSnapshot().bidSignals[id]).toBe("keep one window lit");
		demoStore.setBidSignal(you(), id, "a second thought");
		expect(demoStore.getSnapshot().actionError).toBe(ALREADY);
		expect(demoStore.getSnapshot().bidSignals[id]).toBe("keep one window lit");
	});

	it("a bid placed with a signal can never take another", () => {
		demoStore.placeBid(you(), DEMO_RESERVE, "first");
		const id = demoStore.getSnapshot().bids[0].id;
		demoStore.setBidSignal(you(), id, "second");
		expect(demoStore.getSnapshot().actionError).toBe(ALREADY);
	});

	it("a raise keeps the bid's signal", () => {
		demoStore.placeBid(you(), DEMO_RESERVE, "keep one window lit");
		const id = demoStore.getSnapshot().bids[0].id;
		demoStore.increaseBid(you(), id, DEMO_RESERVE);
		expect(demoStore.getSnapshot().bidSignals[id]).toBe("keep one window lit");
	});

	it("after minting, only the holder adds a day signal, once, with no deadline", () => {
		demoStore.placeBid(you(), DEMO_RESERVE * 3n, "");
		const id = demoStore.getSnapshot().bids[0].id;
		demoStore.endNow();
		demoStore.finalize(30);
		const snap = demoStore.getSnapshot();
		expect(snap.won[0]).toMatchObject({ tokenId: 181, id });
		expect(snap.holders[181]).toBe(you());

		demoStore.setBidSignal(you(), id, "too late for the bid");
		expect(demoStore.getSnapshot().actionError).toContain("only while the bid is live");

		demoStore.setTokenSignal(other, 181, "not the holder");
		expect(demoStore.getSnapshot().actionError).toBe("Only the wallet holding this day can add its signal.");
		demoStore.setTokenSignal(you(), 211, "x");
		expect(demoStore.getSnapshot().actionError).toBe("That token is not a Season 3 day.");
		demoStore.setTokenSignal(you(), 181, "");
		expect(demoStore.getSnapshot().actionError).toBe("Write something first.");
		demoStore.setTokenSignal(you(), 181, "the lamp in the stairwell");
		expect(demoStore.getSnapshot().tokenSignals[181]).toBe("the lamp in the stairwell");
		demoStore.setTokenSignal(you(), 181, "again");
		expect(demoStore.getSnapshot().actionError).toBe(ALREADY);
	});

	it("the settled scenario has a day with a holder-added signal and a day of yours without one", () => {
		demoStore.jumpTo("settled");
		const snap = demoStore.getSnapshot();
		const holderDays = Object.keys(snap.tokenSignals).map(Number);
		expect(holderDays).toHaveLength(1);
		const winner = snap.won.find((w) => w.tokenId === holderDays[0])!;
		expect(snap.bidSignals[winner.id]).toBeUndefined();
		const yoursWithout = snap.won.filter((w) => w.bidder === snap.you && !snap.bidSignals[w.id]);
		expect(yoursWithout.length).toBeGreaterThan(0);
	});
});
