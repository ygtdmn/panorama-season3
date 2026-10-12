"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { useAuctionState, type AuctionState } from "./useAuctionState";
import { useAuctionActions, type AuctionActions } from "./useAuctionActions";
import { sanitizeSignal, type SignalRow } from "@/lib/signal";
import { effectiveSignalForDay, type DayInputs } from "@/lib/signalBoard";
import {
  bpsIncrement,
  demoStore,
  DEMO_EMERGENCY_GRACE,
  DEMO_FINALIZE_GRACE,
  DEMO_FIRST_TOKEN_ID,
  DEMO_MAX_SIGNAL_BYTES,
  DEMO_SPLIT_A_BPS,
  DEMO_IDENTITIES,
  DEMO_INC_BPS,
  DEMO_MAX_BIDS_PER_WALLET,
  DEMO_BID_TICK,
  extendThreshold,
  roundUpToTick,
  DEMO_MAX_UNITS,
  DEMO_PAYOUT_A,
  DEMO_PAYOUT_B,
  DEMO_RESERVE,
  type DemoScenario,
  type DemoSnapshot,
} from "../demo/demoStore";

const PHASES = ["active", "finalizing", "settled", "cancelled"] as const;

export interface DemoControls {
  you: string;
  identities: string[];
  won: number;
  log: string[];
  switchIdentity: () => void;
  seedBid: () => void;
  fillToCapacity: () => void;
  endNow: () => void;
  setUpcoming: () => void;
  jumpTo: (scenario: DemoScenario) => void;
  reset: () => void;
}

export interface AuctionSession {
  demo: boolean;
  isConnected: boolean;
  address?: string;
  state: AuctionState;
  actions: AuctionActions;
  controls: DemoControls | null;
}

const noopSubscribe = () => () => {};
function readUrlDemo(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

/**
 * Demo is on when NEXT_PUBLIC_AUCTION_DEMO=1, or when the URL has ?demo=1 in
 * dev or on a non-mainnet build. Mainnet production builds ignore the URL param:
 * a shared ?demo=1 link must never swap the real auction for the simulation.
 */
export function useIsDemo(): boolean {
  const envDemo = process.env.NEXT_PUBLIC_AUCTION_DEMO === "1";
  // Unset chain id defaults to mainnet, mirroring src/lib/env.ts.
  const urlDemoAllowed =
    process.env.NODE_ENV !== "production" ||
    (process.env.NEXT_PUBLIC_CHAIN_ID ?? "1") !== "1";
  // useSyncExternalStore reads the client URL without a hydration mismatch:
  // server snapshot is false, client snapshot reflects the real query string.
  const urlDemo = useSyncExternalStore(noopSubscribe, readUrlDemo, () => false);
  return envDemo || (urlDemoAllowed && urlDemo);
}

function deriveState(s: DemoSnapshot): AuctionState {
  const full = s.bids.length >= DEMO_MAX_UNITS;
  const low = s.bids.length
    ? s.bids.reduce(
        (lo, b) =>
          b.amount < lo.amount || (b.amount === lo.amount && b.id > lo.id)
            ? b
            : lo,
        s.bids[0],
      )
    : null;
  const floor = low ? low.amount : 0n;
  // Same rules as the contract's minimumBid(): round up to the tick, then step past held amounts.
  let minBid = DEMO_RESERVE;
  if (full) {
    minBid = roundUpToTick(floor + bpsIncrement(floor));
    while (s.bids.some((b) => b.amount === minBid)) minBid += DEMO_BID_TICK;
  }
  const yourBids = s.bids
    .filter((b) => b.bidder === s.you)
    .map((b) => ({ id: b.id, amount: b.amount }));
  const allBids = [...s.bids]
    .sort((x, y) =>
      x.amount < y.amount ? 1 : x.amount > y.amount ? -1 : x.id - y.id,
    )
    .map((b) => ({
      id: b.id,
      bidder: b.bidder as `0x${string}`,
      amount: b.amount,
    }));
  const wonBids = s.won.map((w) => ({
    id: w.id,
    bidder: w.bidder as `0x${string}`,
    amount: w.amount,
    tokenId: w.tokenId,
    pricePaid: w.pricePaid,
  }));
  const nowSec = Math.floor(Date.now() / 1000);
  // Controller storage as the live reads present it: bid signals for live and won bids only,
  // bidder from the bid row, empty ones left out.
  const signals = new Map<number, SignalRow>();
  for (const b of [...s.won, ...s.bids]) {
    const text = s.bidSignals[b.id];
    if (text) signals.set(b.id, { bidId: b.id, bidder: b.bidder as `0x${string}`, signal: text });
  }
  const tokenSignals = new Map<number, string>(
    Object.entries(s.tokenSignals)
      .filter(([, v]) => v !== "")
      .map(([t, v]) => [Number(t), v]),
  );
  const tokenHolders = new Map<number, `0x${string}`>(
    Object.entries(s.holders).map(([t, h]) => [Number(t), h as `0x${string}`]),
  );
  const dayInputs: DayInputs = {
    firstTokenId: DEMO_FIRST_TOKEN_ID,
    maxUnits: DEMO_MAX_UNITS,
    phase: PHASES[s.phase],
    liveBids: allBids,
    wonBids,
    bidSignals: signals,
    tokenSignals,
    holders: tokenHolders,
  };
  const yourTokens = [...tokenHolders]
    .filter(([, h]) => h.toLowerCase() === s.you.toLowerCase())
    .map(([t]) => t)
    .sort((x, y) => x - y);

  return {
    ready: true,
    isLoading: false,
		readFailed: false,
		degraded: false,
		stale: false,
		degradedPersistent: false,
		accountReady: true,
		accountReadFailed: false,
		snapshotAgeMs: 0,
		refetch: () => {},
    chainTime: { timestamp: nowSec, atMs: Date.now() },
    phase: PHASES[s.phase],
    paused: s.paused,
    startTime: s.startTime,
    endTime: s.endTime,
    absoluteEndTime: s.absoluteEndTime,
    scheduledEndTime: s.scheduledEndTime,
    reservePrice: DEMO_RESERVE,
    minIncrementBps: DEMO_INC_BPS,
    extensionCount: s.extensionCount,
    maxUnits: DEMO_MAX_UNITS,
    maxBidsPerWallet: DEMO_MAX_BIDS_PER_WALLET,
    activeBids: s.bids.length,
    isFull: full,
    currentClearingPrice: full ? floor : DEMO_RESERVE,
    lowestActiveBid: low ? floor : 0n,
    minimumBid: minBid,
    minIncreaseForExtension: floor > 0n ? extendThreshold(floor) : 0n,
    clearingPrice: s.clearingPrice,
    proceeds: s.proceeds,
    finalizeCursor: s.finalizeCursor,
    refundCursor: 0,
    winnerCount: s.winnerCount,
    refundsComplete: s.refundsComplete,
    totalEscrowed: s.bids.reduce((sum, bid) => sum + bid.amount, 0n),
    totalPendingReturns: Object.values(s.pending).reduce(
      (sum, amount) => sum + amount,
      0n,
    ),
    unreleasedProceeds: s.phase === 1 ? s.proceeds : 0n,
    totalLiabilities:
      s.bids.reduce((sum, bid) => sum + bid.amount, 0n) +
      Object.values(s.pending).reduce((sum, amount) => sum + amount, 0n) +
      (s.phase === 1 ? s.proceeds : 0n),
    surplusEth: 0n,
    finalizeEligibleAt: s.endTime > 0 ? s.endTime + DEMO_FINALIZE_GRACE : 0,
    emergencyEligibleAt:
      s.absoluteEndTime > 0 ? s.absoluteEndTime + DEMO_EMERGENCY_GRACE : 0,
		expectedNftSupply: DEMO_FIRST_TOKEN_ID - 1 + s.finalizeCursor,
		supplyMismatched: false,
		requiredMintCapForSettlement:
			s.phase === 0
				? BigInt(DEMO_FIRST_TOKEN_ID - 1 + s.bids.length)
				: s.phase === 1
					? BigInt(DEMO_FIRST_TOKEN_ID - 1 + s.winnerCount)
					: 0n,
		mintingUnavailable: false,
    firstTokenId: DEMO_FIRST_TOKEN_ID,
    lastTokenId: DEMO_FIRST_TOKEN_ID + DEMO_MAX_UNITS - 1,
    owner: s.you as `0x${string}`,
    payoutA: DEMO_PAYOUT_A as `0x${string}`,
    payoutB: DEMO_PAYOUT_B as `0x${string}`,
    splitABps: DEMO_SPLIT_A_BPS,
    maxSignalBytes: DEMO_MAX_SIGNAL_BYTES,
    signalController: ("0x" + "5c".repeat(20)) as `0x${string}`,
    nftAddress: ("0x" + "4f".repeat(20)) as `0x${string}`,
    bidTick: DEMO_BID_TICK,
		allBids,
		wonBids,
		wonStatus: "ready",
		wonExpectedCount: s.finalizeCursor,
		wonIntegrityIssue: undefined,
		refetchWon: () => {},
		signals,
		tokenSignals,
		tokenHolders,
		yourTokens,
		effectiveSignalForDay: (token) => effectiveSignalForDay(dayInputs, token),
		signalStatus: "ready",
		signalsReady: true,
		refetchSignals: () => {},
    isOwner: true,
    yourBidCount: yourBids.length,
    yourBids,
    yourPending: s.pending[s.you] ?? 0n,
  };
}

/** Records which write ran, then runs it (the demo resolves synchronously). */
function run(name: NonNullable<AuctionActions["lastAction"]>, fn: () => void) {
  demoStore.setLastAction(name);
  fn();
}

function deriveActions(s: DemoSnapshot): AuctionActions {
  return {
		status: s.actionStatus,
		lastAction: s.lastAction as AuctionActions["lastAction"],
		txHash: undefined,
		originalTxHash: undefined,
		replacementHash: undefined,
		replacementReason: undefined,
		error: s.actionError ? new Error(s.actionError) : null,
		unresolved: false,
		trackerReady: true,
		submittedAt: undefined,
		// The simulation resolves every action synchronously, so nothing can ever be indeterminate.
		forceUnlock: () => {},
		lockReleasedManually: false,
    wrongChain: false,
    switching: false,
    switchToTargetChain: () => {},
    reset: () => demoStore.setStatus("idle"),
    placeBid: (v, signal) => run("placeBid", () => demoStore.placeBid(s.you, v, sanitizeSignal(signal))),
    increaseBid: (id, add) => run("increaseBid", () => demoStore.increaseBid(s.you, id, add)),
    withdraw: () => run("withdraw", () => demoStore.withdraw(s.you)),
    finalize: (b) => run("finalize", () => demoStore.finalize(b)),
    cancelAuction: () => demoStore.cancel(),
    refundAll: (b) => run("refundAll", () => demoStore.refundAll(b)),
    emergencyRefund: (b) => run("emergencyRefund", () => demoStore.emergencyRefund(b)),
		recoverFromSupplyMismatch: () => demoStore.recoverSupplyMismatch(),
		recoverFromMintingUnavailable: () => demoStore.setStatus("error", "Minting is still available."),
    setPaused: (p) => demoStore.setPaused(p),
    setBidSignal: (id, signal) =>
      run("setBidSignal", () => demoStore.setBidSignal(s.you, id, sanitizeSignal(signal))),
    setTokenSignal: (token, signal) =>
      run("setTokenSignal", () => demoStore.setTokenSignal(s.you, token, sanitizeSignal(signal))),
  };
}

function useAuctionDemo(active: boolean) {
  const snap = useSyncExternalStore(
    demoStore.subscribe,
    demoStore.getSnapshot,
    demoStore.getServerSnapshot,
  );
  useEffect(() => {
    if (active) demoStore.start();
  }, [active]);

  const state = useMemo(() => deriveState(snap), [snap]);
  const actions = useMemo(() => deriveActions(snap), [snap]);
  const controls = useMemo<DemoControls>(
    () => ({
      you: snap.you,
      identities: DEMO_IDENTITIES,
      won: snap.won.filter((w) => w.bidder === snap.you).length,
      log: snap.log,
      switchIdentity: () => {
        const i = DEMO_IDENTITIES.indexOf(snap.you);
        demoStore.setYou(DEMO_IDENTITIES[(i + 1) % DEMO_IDENTITIES.length]);
      },
      seedBid: () => demoStore.seedBid(),
      fillToCapacity: () => demoStore.fillToCapacity(),
      endNow: () => demoStore.endNow(),
      setUpcoming: () => demoStore.setUpcoming(),
      jumpTo: (scenario) => demoStore.jumpTo(scenario),
      reset: () => demoStore.reset(),
    }),
    [snap],
  );

  return { state, actions, controls, you: snap.you };
}

/**
 * Single entry point for the auction pages. Always calls the same hooks (stable
 * order) and returns either the live-contract bundle or the in-memory demo one.
 */
export function useAuctionSession(): AuctionSession {
  const demo = useIsDemo();
  const realState = useAuctionState();
  const realActions = useAuctionActions(() => realState.refetch(), realState.signalController);
  const { address, isConnected } = useAccount();
  const demoBundle = useAuctionDemo(demo);

  if (demo) {
    return {
      demo: true,
      isConnected: true,
      address: demoBundle.you,
      state: demoBundle.state,
      actions: demoBundle.actions,
      controls: demoBundle.controls,
    };
  }
  return {
    demo: false,
    isConnected,
    address,
    state: realState,
    actions: realActions,
    controls: null,
  };
}
