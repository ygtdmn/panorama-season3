"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LuInfo, LuMaximize2, LuMinimize2 } from "react-icons/lu";
import { applyRailMax, readRailMaxAttribute } from "@/lib/railMax";
import Link from "next/link";
import { WalletPill } from "@/app/components/WalletPill";
import { useToast } from "@/app/components/Toast";
import {
  getBlockExplorerTxUrl,
  PANORAMA_AUCTION_ADDRESS,
  SITE_URL,
} from "@/lib/constants";
import { describeAuctionError } from "@/lib/auctionErrors";
import type { WriteName } from "@/app/auction/hooks/useAuctionActions";
import { useAuctionSession } from "@/app/auction/hooks/useAuctionSession";
import { dayLabelForToken, SEASON_3_ZONES, themeForToken, zoneForToken } from "@/lib/season3Zones";
import { measureSignal, signalForBid } from "@/lib/signal";
import { SignalConfirm, SignalEditor, SignalText } from "@/app/auction/components/SignalEditor";
import { HeroScreen } from "@/app/auction/components/HeroPanorama";
import { DemoBar } from "@/app/auction/components/DemoBar";
import { Standings } from "@/app/auction/components/Standings";
import { landingRank, RouteBoard } from "@/app/auction/components/RouteBoard";
import { Kirill, SeasonDetails, SectionHead } from "@/app/auction/components/SeasonDetails";
import { WorkChapters } from "@/app/auction/components/WorkChapters";
import { ArtistStatement } from "@/app/auction/components/ArtistStatement";
import type { Season3Tableau } from "@/lib/season3Tableaus";
import { OpenDaysPanel } from "@/app/auction/components/OpenDays";
import { auctionsByToken, useDayAuctions } from "@/app/hooks/useDayAuctions";
import { dayAuctionStatus, isBiddable } from "@/lib/dayAuctions";
import {
  pendingActionLabel,
  TransactionStatus,
} from "@/app/components/TransactionStatus";
import {
  displayPhase,
  eth,
  ethCeil,
  ethExact,
  fmtDateUTC,
  Label,
  LiveDot,
  normalizeDecimalInput,
  onTick,
  parseEthInput,
  useChainNow,
  type DisplayPhase,
} from "@/app/auction/components/ui";

const PHASE_COPY: Record<DisplayPhase, string> = {
  upcoming: "Upcoming",
  active: "Live",
  closed: "Closed",
  finalizing: "Settling",
  settled: "Settled",
  cancelled: "Cancelled",
};

const SUCCESS_COPY: Partial<Record<WriteName, string>> = {
  placeBid: "Bid placed.",
  increaseBid: "Bid raised.",
  withdraw: "Refund withdrawn.",
  finalize: "Settlement batch confirmed.",
  refundAll: "Refund batch confirmed.",
  emergencyRefund: "Emergency refund batch confirmed.",
  recoverFromSupplyMismatch: "Recovery batch confirmed.",
  setBidSignal: "Signal saved.",
  setTokenSignal: "Day signal saved.",
  recoverFromMintingUnavailable: "Minting-capability recovery batch confirmed.",
};

// Bevelled game buttons (globals.css .game-btn); labels stay lowercase, as in the menus.
const PRIMARY =
  "relative w-full game-btn text-[15px] py-3.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-laser";
const GHOST =
  "game-btn text-[13px] px-4 py-2 cursor-pointer";
const CHIP =
  "game-btn text-[11px] px-2.5 py-1 cursor-pointer";
const PANEL = "relative game-panel p-5";

/** A rule one tap or hover away, instead of a paragraph under the field. */
function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={text}
      data-tooltip-wrap=""
      data-tooltip-tap=""
      className="inline-flex items-center justify-center w-7 h-7 text-faint hover:text-foreground transition-colors cursor-help"
    >
      <LuInfo size={14} aria-hidden />
    </button>
  );
}

const SIGNAL_INFO =
  "Sent to the day your bid wins. Public and permanent once written. Send it now or add it any time later, even after the sale. Yigit and Pale Kirill read it when your day is made, and may use it or leave it.";
const BID_INFO =
  "Enter the most you would pay; it is held while your bid stays in the top thirty. At the close every winner pays the same price, the thirtieth-highest bid, and the rest of your maximum is refunded at settlement. Higher bids take earlier days. If you are outbid, your bid is refunded at once.";

function Countdown({
  now,
  startTime,
  endTime,
  unconfirmed,
}: {
  now: number;
  startTime: number;
  endTime: number;
  /** The clock ran out on a snapshot that may predate an extension. */
  unconfirmed?: boolean;
}) {
  if (!now)
    return (
      <span className="font-sans font-semibold text-4xl tabular-nums text-faint leading-none">--:--:--</span>
    );
  // Before the sale opens, count down to the start; after, to the end.
  const preStart = now < startTime;
  const target = preStart ? startTime : endTime;
  const left = Math.max(0, target - now);
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  const text =
    left === 0
      ? unconfirmed
        ? "Checking…"
        : "Ended"
      : left >= 3600
        ? `${d > 0 ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(sec)}`
        : `${pad(m)}:${pad(sec)}`;
  return (
    <span className="font-sans font-semibold text-4xl tabular-nums tracking-[-0.01em] text-foreground leading-none">
      {text}
      {left > 0 && (
        <span className="font-mono text-micro font-normal tracking-normal text-faint ml-2">
          {preStart ? "to start" : "left"}
        </span>
      )}
    </span>
  );
}

// Announced open: 19 October 2026, 17:00 UTC. Only used by builds with no contract address to
// read a startTime from; with a configured contract the console follows the on-chain schedule.
const AUCTION_LAUNCH_MS: number | null = Date.UTC(2026, 9, 19, 17, 0, 0);
// Scheduled duration (24h), only used to give the calendar event an end time.
const DAY_MS = 24 * 60 * 60 * 1000;

const CAL_TITLE = "Panorama Season 3 auction opens";
const CAL_DETAILS =
  "The Panorama Season 3 auction, Nothing Remains the Same (tokens #181-#210), opens. " +
  "Place your bid at https://season3.panorama.garden";

// ICS/Google Calendar timestamp: YYYYMMDDTHHMMSSZ (UTC).
function calStamp(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function calUrl(startMs: number, endMs: number): string {
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(CAL_TITLE)}` +
    `&dates=${calStamp(startMs)}/${calStamp(endMs)}` +
    `&details=${encodeURIComponent(CAL_DETAILS)}`
  );
}

const GOOGLE_CAL_URL =
  AUCTION_LAUNCH_MS === null ? null : calUrl(AUCTION_LAUNCH_MS, AUCTION_LAUNCH_MS + DAY_MS);

// Countdown to the open. Runs off the device clock (pre-deploy there is no chain time, and
// pre-start the drift is cosmetic); starts null so the server and first client render match.
function LaunchCountdown({ targetMs }: { targetMs: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left =
    now === null ? null : Math.max(0, Math.floor((targetMs - now) / 1000));
  if (left === 0)
    return (
      <span className="font-sans font-semibold text-3xl tracking-[-0.02em] text-foreground leading-none">
        Opening now.
      </span>
    );
  const pad = (x: number) => String(x).padStart(2, "0");
  const segments: { value: number | null; label: string }[] = [
    { value: left === null ? null : Math.floor(left / 86400), label: "days" },
    { value: left === null ? null : Math.floor((left % 86400) / 3600), label: "hrs" },
    { value: left === null ? null : Math.floor((left % 3600) / 60), label: "min" },
    { value: left === null ? null : left % 60, label: "sec" },
  ];
  return (
    <div className="grid grid-cols-4 gap-[3px]">
      {segments.map((seg) => (
        <div key={seg.label} className="game-slot flex flex-col items-start gap-3 px-3 py-3">
          <span className="font-sans font-semibold text-4xl md:text-5xl tabular-nums tracking-[-0.02em] text-foreground leading-none">
            {seg.value === null ? (
              <span className="text-faint">--</span>
            ) : (
              pad(seg.value)
            )}
          </span>
          <span className="font-mono text-micro uppercase tracking-[0.18em] text-faint">
            {seg.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// The announced open, rendered in the visitor's own locale and timezone. Client-only (starts
// null) so the server render and hydration agree instead of formatting in the server's zone.
function LaunchDate({ targetMs }: { targetMs: number }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(
      new Date(targetMs).toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    );
  }, [targetMs]);
  return (
    <span className="font-mono text-micro uppercase tracking-[0.14em] text-faint">
      {label ?? "\u00a0"}
    </span>
  );
}

export default function AuctionPage({
  heroTableaus = null,
}: {
  /** The published Season 3 tableaus, read on the server so the title screen paints with them. */
  heroTableaus?: Season3Tableau[] | null;
}) {
  const toast = useToast();
  const {
    demo,
    isConnected,
    address,
    state: s,
    actions,
    controls,
  } = useAuctionSession();
  // Chain-anchored clock: block timestamp + elapsed. The device clock only supplies the
  // seconds since the last block, so local clock skew cannot flip live/ended incorrectly.
  const now = useChainNow(s.chainTime);
  // The contract stays "active" from deploy until finalize; only startTime→endTime
  // is live. Everything status-shaped (label, dot) reads this, not the raw phase.
  const phaseView = displayPhase(s.phase, now, s.startTime, s.endTime);
  // After the sale: the page speaks to visitors and holders. The days it left open are each on
  // their own Manifold auction (mainnet only), read through /api/day-auctions.
  const afterSale = s.phase === "settled";
  const dayAuctions = useDayAuctions();
  const dayNow = useChainNow(dayAuctions.anchor);
  const openDays = useMemo(
    () => (afterSale ? auctionsByToken(dayAuctions.data) : undefined),
    [afterSale, dayAuctions.data],
  );
  const openAuctions = afterSale ? dayAuctions.data?.auctions ?? [] : [];
  // A day sold on Manifold counts as sold; the rest are still open for bids.
  const manifoldSold = openAuctions.filter((a) => !isBiddable(dayAuctionStatus(a, dayNow)));
  const openCount = openAuctions.length - manifoldSold.length;
  const soldCount = s.winnerCount + manifoldSold.length;
  const manifoldSoldTokens = new Set(manifoldSold.map((a) => a.tokenId));
  // A late bid extends endTime in the block it lands. Until a fresh snapshot confirms the end
  // really stood, "Closed" would be a guess made from data that may predate an extension, which
  // is exactly what sends people to the reload button. Say "Closing" and keep resyncing instead.
  const endUnconfirmed = phaseView === "closed" && s.snapshotAgeMs > 12_000;

  const [bidInput, setBidInput] = useState("");
  const [signalInput, setSignalInput] = useState("");
  // The confirm step for a bid WITH a signal (signals are write-once). It holds the exact inputs
  // it was opened for, so editing either the amount or the signal drops back to the form.
  const [bidConfirm, setBidConfirm] = useState<{ bid: string; signal: string } | null>(null);
  const [raiseInputs, setRaiseInputs] = useState<Record<number, string>>({});
  // Desktop full-width bid panel. The LAYOUT is driven by html[data-rail-max] + CSS, stamped
  // before first paint, so a remembered choice never jumps in after hydration; this state only
  // mirrors it for the button's label.
  const [railMax, setRailMax] = useState(false);
  useEffect(() => {
    setRailMax(readRailMaxAttribute());
  }, []);
  const updateRailMax = (next: boolean) => {
    setRailMax(next);
    applyRailMax(next);
  };
  // The one open signal editor: "bid:<id>" or "day:<token>".
  const [editing, setEditing] = useState<string | null>(null);
  // The last submitted tx survives reset() so the explorer link stays after confirmation.
  const [lastTx, setLastTx] = useState<`0x${string}`>();

  useEffect(() => {
    if (actions.txHash) setLastTx(actions.txHash);
  }, [actions.txHash]);

  useEffect(() => {
    if (actions.status === "error" && actions.error) {
      const msg = describeAuctionError(actions.error);
      if (msg) toast.error(msg);
      actions.reset();
    }
    if (actions.status === "success") {
      toast.success(
        (actions.lastAction && SUCCESS_COPY[actions.lastAction]) ||
          "Transaction confirmed.",
      );
      setBidInput("");
      setBidConfirm(null);
      if (actions.lastAction === "placeBid") setSignalInput("");
      setRaiseInputs({});
      setEditing(null);
      actions.reset();
    }
	if (actions.status === "cancelled") {
	  toast.info("Transaction cancelled in your wallet. The auction action was not submitted.");
	  actions.reset();
	}
	if (actions.status === "replaced") {
	  toast.info(
		actions.replacementReason
		  ? "A different replacement transaction confirmed. The auction action was not submitted."
		  : "Another transaction from your wallet took that one's place. Check Your bids before submitting again.",
	  );
	  actions.reset();
	}
	if (actions.status === "dropped") {
	  toast.info(
		actions.lockReleasedManually
		  ? "Tracking released. If that transaction still confirms, it counts as a bid."
		  : "That transaction left the network without confirming. Nothing was submitted, so you can bid again.",
	  );
	  actions.reset();
	}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.status]);

  // Displacement is silent on-chain from this wallet's perspective: the bid simply leaves
  // the top 30 and the ETH is force-returned. Detect the shrink between snapshots and say so.
  const prevBidsRef = useRef<{ address?: string; ids: Set<number> }>({
    ids: new Set(),
  });
  useEffect(() => {
    const prev = prevBidsRef.current;
    const ids = new Set(s.yourBids.map((b) => b.id));
    if (prev.address === address && s.phase === "active" && prev.ids.size > 0) {
      for (const id of prev.ids) {
        if (!ids.has(id)) {
          toast.info(
            "You were outbid. Your ETH was returned to your wallet in full.",
          );
          break;
        }
      }
    }
    prevBidsRef.current = { address, ids };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, s.phase, s.yourBids]);

  // No contract wired up yet (pre-deploy): keep the full page and the details article,
  // but the rail advertises the auction instead of trying to read state that isn't there.
  const comingSoon = !PANORAMA_AUCTION_ADDRESS && !demo;
  const loading = !comingSoon && !demo && !s.ready && !s.readFailed;
  // Contract configured but bidding not open yet: same advertisement rail, except the
  // countdown and calendar follow the on-chain schedule (setSchedule can move it until
  // the first bid). Live stats appear only once bidding opens.
  const preOpen =
    !comingSoon && !demo && s.ready && now !== 0 && now < s.startTime;
  const launchMs = preOpen ? s.startTime * 1000 : AUCTION_LAUNCH_MS;
  const launchCalUrl = preOpen
    ? calUrl(
        s.startTime * 1000,
        s.scheduledEndTime > s.startTime
          ? s.scheduledEndTime * 1000
          : s.startTime * 1000 + DAY_MS,
      )
    : GOOGLE_CAL_URL;
  const biddable =
    s.phase === "active" &&
    !s.paused &&
    !s.supplyMismatched &&
    now !== 0 &&
    now >= s.startTime &&
    now < s.endTime;
  const heroClearing =
    s.phase === "settled" ? s.clearingPrice : s.currentClearingPrice;
  const durationHours =
    s.scheduledEndTime > s.startTime
      ? Math.round((s.scheduledEndTime - s.startTime) / 3600)
      : 24;

	const bidNormalized = useMemo(() => normalizeDecimalInput(bidInput), [bidInput]);
  const bidWei = useMemo(() => parseEthInput(bidInput), [bidInput]);
	const bidInvalid =
		bidInput.trim() !== "" &&
		bidNormalized !== "." &&
		bidWei === null;
	const bidTooLow = bidWei !== null && bidWei > 0n && bidWei < s.minimumBid;
	// Contract rules: whole 0.001 ETH steps always; once all thirty days are held, no amount an
	// active bid already holds.
	const bidOffTick = bidWei !== null && bidWei > 0n && !onTick(bidWei, s.bidTick);
	const bidTaken =
		bidWei !== null && s.isFull && s.allBids.some((row) => row.amount === bidWei);
	const signalDraft = useMemo(
		() => measureSignal(signalInput, s.maxSignalBytes),
		[signalInput, s.maxSignalBytes],
	);
	const signalBlocked = signalDraft.over;
	const confirmingBidSignal =
		bidConfirm !== null &&
		bidConfirm.bid === bidInput &&
		bidConfirm.signal === signalInput &&
		signalDraft.clean !== "";
	const busy = actions.unresolved;
	// Fail closed like /admin and /recovery: a bid must never ride a stale or degraded
	// snapshot, where minimumBid, endTime, or phase could all be wrong.
	const unsafeSnapshot = s.degraded || s.stale;
	const writeBlocked = busy || unsafeSnapshot;
  const recoveryAvailable = s.phase === "cancelled" && !s.refundsComplete;
  const emergencyAvailable =
    now !== 0 &&
    now > s.emergencyEligibleAt &&
    (s.phase === "active" || s.phase === "finalizing");
  const supplyRecoveryAvailable =
    s.supplyMismatched && (s.phase === "active" || s.phase === "finalizing");
	const mintingRecoveryAvailable =
	  !supplyRecoveryAvailable &&
	  s.mintingUnavailable &&
	  now !== 0 &&
	  now >= s.finalizeEligibleAt &&
	  (s.phase === "active" || s.phase === "finalizing");
  const finalizeOpenToAll =
    now !== 0 &&
    s.finalizeEligibleAt > 0 &&
    now >= s.finalizeEligibleAt &&
    (s.phase === "active" || s.phase === "finalizing") &&
		now >= s.endTime &&
		!s.supplyMismatched &&
		!s.mintingUnavailable;

  // Tokens can exist once finalize has started: from then on "Your days" and per-day signals apply.
  const settlementStarted =
    s.phase === "finalizing" || s.phase === "settled" || s.finalizeCursor > 0;
  // Board markers: a minted day shows its effective signal, a live bid its own.
  const markerSignal = (bidId: number, tokenId?: number): string | undefined =>
    tokenId !== undefined
      ? s.effectiveSignalForDay(tokenId)?.signal || undefined
      : s.signals.get(bidId)?.signal || undefined;

  // After finalize starts, active bids drain to zero as winners mint; the frozen
  // winner count is the real "slots filled" from then on.
  const slotsFilled =
    s.phase === "finalizing" || s.phase === "settled"
      ? s.winnerCount
      : s.activeBids;

  const statusNote = (() => {
    if (s.phase === "settled")
      return `Auction settled. ${s.winnerCount} winner${
        s.winnerCount === 1 ? "" : "s"
      } each paid the ${eth(s.clearingPrice)} ETH clearing price; all excess has been refunded.`;
    if (s.phase === "cancelled")
      return s.refundsComplete
        ? "Cancelled. All remaining bids have been refunded."
        : s.activeBids > 0
          ? `Cancelled. ${s.activeBids} refund${s.activeBids === 1 ? "" : "s"} remaining; anyone can process them.`
          : "Cancelled. One final call completes the recovery; anyone can send it.";
    if (s.phase === "finalizing")
      return "Settling now. Winners are being minted, highest bid first.";
    if (s.supplyMismatched)
      return "Collection supply changed unexpectedly. Bidding is closed; recovery is available below.";
    if (s.paused) return "Bidding is paused.";
    if (now !== 0 && now < s.startTime) return "Bidding opens soon.";
    if (now !== 0 && now >= s.endTime)
      return endUnconfirmed
        ? "The clock ran out. Checking whether a late bid extended the auction."
        : "Bidding closed. Awaiting settlement.";
    return "";
  })();

  // The day a bid being typed would take right now: the route lights it, the console names it.
  const beamRank = useMemo(() => {
    if (!biddable || bidWei === null || bidWei === 0n || bidWei < s.minimumBid || bidOffTick || bidTaken)
      return null;
    const rank = landingRank(bidWei, s.allBids, s.wonBids.length);
    return rank <= s.maxUnits ? rank : null;
  }, [biddable, bidWei, s.minimumBid, bidOffTick, bidTaken, s.allBids, s.wonBids.length, s.maxUnits]);
  // Desktop: while someone types a bid, bring the day it would take into view on the route, so
  // the highlight is seen as it moves. The bid panel is sticky, so it stays put beside the
  // route. Waits for a pause in typing, scrolls only when the day is off screen, and only for
  // the user's own typing (a new block re-ranking the board never moves the page).
  const beamRankRef = useRef(beamRank);
  useEffect(() => {
    beamRankRef.current = beamRank;
  }, [beamRank]);
  const lastBidInputRef = useRef(bidInput);
  useEffect(() => {
    if (lastBidInputRef.current === bidInput) return;
    lastBidInputRef.current = bidInput;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const timer = window.setTimeout(() => {
      const rank = beamRankRef.current;
      if (rank === null) return;
      const cell = document.querySelector<HTMLElement>(`[data-route-board] [data-day="${rank}"]`);
      if (!cell) return;
      const r = cell.getBoundingClientRect();
      const margin = 24;
      if (r.top >= margin && r.bottom <= window.innerHeight - margin) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cell.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [bidInput]);
  const beamToken = beamRank === null ? null : s.firstTokenId + beamRank - 1;
  const beamZone = beamToken === null ? undefined : zoneForToken(beamToken);
  const beamLabel = beamToken === null ? undefined : dayLabelForToken(beamToken);

  /**
   * Thirty ticks in zone colours, one per day in route order: a held day is solid, an open one
   * faint, and the day a bid being typed would take is lifted and outlined, so the strip answers
   * "where would I land" before any text does.
   */
  const heldTicks = (
    <div className="flex items-end gap-[2px] h-3.5" aria-hidden>
      {Array.from({ length: s.maxUnits || 30 }, (_, i) => {
        const zone = SEASON_3_ZONES[Math.min(SEASON_3_ZONES.length - 1, Math.floor(i / 5))];
        const held = i < slotsFilled || manifoldSoldTokens.has(s.firstTokenId + i);
        const beam = beamRank === i + 1;
        return (
          <span
            key={i}
            className={`flex-1 transition-[opacity,height] duration-300 ${beam ? "h-3.5 outline outline-1 outline-white" : "h-2"}`}
            style={{
              background: `var(--z-${zone.id})`,
              opacity: held || beam ? 1 : 0.18,
            }}
          />
        );
      })}
    </div>
  );

  const consoleBody = comingSoon || preOpen ? (
    <div className="flex flex-col gap-[3px]">
      <div className={`${PANEL} flex flex-col gap-5 py-7`}>
        <Label>Bidding opens in</Label>
        {launchMs === null ? (
          <span className="font-sans font-semibold text-3xl tracking-[-0.02em] text-foreground leading-none">
            Date to be announced.
          </span>
        ) : (
          <>
            <LaunchCountdown targetMs={launchMs} />
            <LaunchDate targetMs={launchMs} />
          </>
        )}
        {launchMs !== null && launchCalUrl && (
          <a
            href={launchCalUrl}
            target="_blank"
            rel="noreferrer"
            className="self-start font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
          >
            Add to Google Calendar ↗
          </a>
        )}
      </div>
      <div className={`${PANEL} flex flex-col gap-4`}>
        <p className="font-sans text-sm text-muted leading-relaxed">
          Thirty days are for sale in one auction. When it opens, bid here and
          write a signal for the day you win. Until then, the route below shows
          every day you could hold.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a
            href={SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
          >
            Enter Panorama ↗
          </a>
          <a
            href={`${SITE_URL}/terminal`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
          >
            Terminal ↗
          </a>
        </div>
      </div>
    </div>
  ) : loading ? (
    <div className={`${PANEL} flex flex-col gap-3 py-10 items-center text-center`}>
      <Label>Loading</Label>
      <p className="font-sans text-sm text-muted">Reading the auction state…</p>
    </div>
  ) : s.readFailed && !demo ? (
    <div
      className={`${PANEL} flex flex-col gap-3 py-10 items-center text-center`}
      role="alert"
    >
      <Label className="text-signal">Connection problem</Label>
      <p className="font-sans text-sm text-muted max-w-[32ch]">
        The auction state could not be loaded. Check your connection; retrying
        automatically.
      </p>
      <button className={GHOST} onClick={() => s.refetch()}>
        retry now
      </button>
    </div>
  ) : (
    <div className="flex flex-col gap-[3px]">
      {demo && controls && (
        <div className="mb-3">
          <DemoBar controls={controls} />
        </div>
      )}

      {/* Status: phase, clock, and the thirty days filling up */}
      <div className={`${PANEL} flex flex-col gap-5`}>
        <div className="flex items-start justify-between gap-3">
          {afterSale ? (
            <span className="font-sans font-semibold text-[32px] whitespace-nowrap tracking-[-0.02em] text-foreground leading-none pt-1">
              {soldCount} of {s.maxUnits} sold
            </span>
          ) : (
          <div className="flex flex-col gap-3">
            <span className="inline-flex items-center gap-2">
              <LiveDot phase={phaseView} />
              <span className="font-mono text-micro uppercase tracking-[0.2em] text-muted">
                {endUnconfirmed ? "Closing" : PHASE_COPY[phaseView]}
              </span>
            </span>
            <Countdown
              now={now}
              startTime={s.startTime}
              endTime={s.endTime}
              unconfirmed={endUnconfirmed}
            />
            {now !== 0 && now >= s.endTime ? (
              <span className="font-mono text-micro uppercase tracking-[0.12em] text-faint">
                {endUnconfirmed
                  ? "confirming whether a late bid extended it"
                  : `ended ${fmtDateUTC(s.endTime)}`}
              </span>
            ) : (
              s.extensionCount > 0 && (
                <span className="font-mono text-micro uppercase tracking-[0.12em] text-faint">
                  extended {s.extensionCount}× / hard end{" "}
                  {fmtDateUTC(s.absoluteEndTime)}
                </span>
              )
            )}
          </div>
          )}
          {!demo && (
            <div className="shrink-0">
              <WalletPill />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {heldTicks}
          <div className="flex items-baseline justify-between gap-3">
            {afterSale && openCount > 0 ? (
              <Link
                href="/auctions"
                className="font-mono text-micro uppercase tracking-[0.2em] text-sky-pink hover:text-foreground transition-colors"
              >
                {openCount} open for bids →
              </Link>
            ) : (
            <span
              tabIndex={0}
              data-tooltip={
                s.phase === "settled"
                  ? "Days sold at settlement, one token each, in route order."
                  : "Days held by a bid right now. The top thirty bids hold days 1 to 30, highest first."
              }
              data-tooltip-wrap=""
              className="inline-flex items-baseline gap-2 cursor-help outline-none"
            >
              <span className="font-mono text-sm tabular-nums text-foreground">
                {slotsFilled}
                <span className="text-faint">/{s.maxUnits}</span>
              </span>
              <Label>{s.phase === "settled" ? "Days sold" : "Days with a bid"}</Label>
            </span>
            )}
            <span
              tabIndex={0}
              data-tooltip={
                s.phase === "settled"
                  ? "What every winner paid: the thirtieth-highest bid."
                  : "What every winner pays if bidding ended now: the thirtieth-highest bid, or the reserve while days are open."
              }
              data-tooltip-wrap=""
              className="inline-flex items-baseline gap-2 cursor-help outline-none"
            >
              <Label>{s.phase === "settled" ? "Final price" : "Clearing now"}</Label>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {eth(heroClearing)} ETH
              </span>
            </span>
          </div>
        </div>
      </div>

      {s.degradedPersistent && (
        <div
          className="game-panel border-laser/60 px-4 py-3 flex items-center justify-between gap-4"
          role="alert"
        >
          <p className="font-sans text-sm text-muted">
            Live auction data is stale or degraded. Bidding stays locked until a
            refresh succeeds.
          </p>
          <button className={GHOST} onClick={() => s.refetch()}>
            retry
          </button>
        </div>
      )}

      <TransactionStatus actions={actions} />

      {/* Bid: amount (with the day it would take), then the signal */}
      {afterSale ? (
        <OpenDaysPanel auctions={openAuctions} now={dayNow} />
      ) : (
      <section aria-label="Place a bid" className={PANEL}>
        {statusNote && !biddable ? (
          <p className="font-sans text-sm text-muted leading-relaxed">
            {statusNote}
            {finalizeOpenToAll && (
              <>
                {" "}
                <Link
                  href="/recovery"
                  className="text-foreground underline hover:opacity-60"
                >
                  Anyone can settle it now.
                </Link>
              </>
            )}
          </p>
        ) : !isConnected ? (
          <div className="flex flex-col gap-3">
            <Label>Place a bid</Label>
            <p className="font-sans text-sm text-muted">
              Connect a wallet to bid and send a signal.
            </p>
            <WalletPill connectLabel="connect wallet" />
          </div>
        ) : s.yourBidCount >= s.maxBidsPerWallet ? (
          <div className="flex flex-col gap-2">
            <Label>Place a bid</Label>
            <p className="font-sans text-sm text-muted leading-relaxed">
              You&apos;re holding all {s.maxBidsPerWallet} bids. Raise one
              below to move to an earlier day.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Bid: the most you would pay, the minimum one tap away, and underneath, inside the
                same field, the day it would take right now (or why it can't land). The day is a
                standing, not a claim: it pulses "now", and its tooltip says how higher bids move it. The strip
                above and the route board light the same day. */}
            {(() => {
              const problem = bidInvalid
                ? "Enter one plain decimal amount, for example 0.15 or 0,15."
                : bidOffTick
                  ? "Bids go in steps of 0.001 ETH"
                  : bidTooLow
                    ? `Below the minimum of ${ethCeil(s.minimumBid)} ETH`
                    : bidTaken
                      ? "Someone holds this amount. Try 0.001 more or less"
                      : null;
              const theme = beamToken !== null ? themeForToken(beamToken) : undefined;
              const lit = !problem && beamZone && theme && beamToken !== null && beamRank !== null;
              // Nothing typed yet: the day a bid at the minimum would take now.
              const minRank =
                biddable && bidInput.trim() === "" && s.minimumBid > 0n
                  ? Math.min(landingRank(s.minimumBid, s.allBids, s.wonBids.length), s.maxUnits)
                  : null;
              const minTheme = minRank !== null ? themeForToken(s.firstTokenId + minRank - 1) : undefined;
              return (
                <div className="flex flex-col gap-1.5">
                  <span className="inline-flex items-center gap-1">
                    <label htmlFor="bid-amount" className="font-mono text-micro uppercase tracking-[0.14em] text-muted">
                      {s.yourBidCount > 0 ? "Second bid" : "Bid"}
                    </label>
                    <InfoTip label="How bidding works" text={BID_INFO} />
                  </span>
                  <div
                    className={`game-slot flex flex-col gap-1 px-3.5 pt-2.5 pb-2.5 focus-within:border-sky-pink transition-colors duration-200 ${
                      problem ? "!border-laser/70" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-micro uppercase tracking-[0.14em] text-faint">Your maximum</span>
                      <button
                        type="button"
                        onClick={() => setBidInput(ethExact(s.minimumBid))}
                        className={CHIP}
                      >
                        min {ethCeil(s.minimumBid)} ETH
                      </button>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <input
                        id="bid-amount"
                        value={bidInput}
                        onChange={(e) => setBidInput(e.target.value)}
                        inputMode="decimal"
                        placeholder={ethCeil(s.minimumBid)}
                        aria-label="Bid amount in ETH"
                        aria-invalid={bidInvalid}
                        aria-describedby="bid-landing"
                        className="bg-transparent outline-none font-sans font-semibold text-4xl tabular-nums tracking-[-0.01em] w-full text-foreground placeholder:text-faint placeholder:font-normal"
                      />
                      <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">ETH</span>
                    </div>
                    <p
                      id="bid-landing"
                      aria-live="polite"
                      role={problem ? "alert" : undefined}
                      tabIndex={lit ? 0 : undefined}
                      data-tooltip={
                        lit
                          ? "Where your bid stands right now. Each higher bid pushes it one day later; out of the top thirty, it is refunded. Raise it any time to move earlier."
                          : undefined
                      }
                      data-tooltip-wrap=""
                      className={`flex items-center gap-2 min-h-[1.4em] font-mono text-micro outline-none ${lit ? "cursor-help" : ""}`}
                    >
                      {problem ? (
                        <span className="text-signal">{problem}</span>
                      ) : lit ? (
                        <>
                          <span className="sr-only">{`Lands on #${beamToken} / ${beamLabel} at today's ranking. Higher bids push it to later days.`}</span>
                          <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: `var(--z-${beamZone.id})` }} />
                          <span aria-hidden className="text-muted truncate">
                            now on <span className="text-foreground">day {beamRank}</span>
                            {" / "}
                            <span style={{ color: `var(--z-${beamZone.id})` }}>{theme.theme}</span>
                          </span>
                        </>
                      ) : minRank !== null && minTheme ? (
                        <span className="text-faint">
                          at the minimum, day {minRank} / {minTheme.theme}
                        </span>
                      ) : (
                        <span className="text-faint">Type an amount to see which day it takes</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Signal: optional, always in view. Sent with the bid in the same transaction, or
                added later from Your bids (and Your days after the sale). Write-once: never
                changed or cleared. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1">
                  <label
                    htmlFor="bid-signal"
                    className="font-mono text-micro uppercase tracking-[0.14em] text-muted"
                  >
                    Signal
                  </label>
                  <InfoTip label="About signals" text={SIGNAL_INFO} />
                </span>
                <span className="font-mono text-micro uppercase tracking-[0.12em] text-faint">optional</span>
              </div>
              <div className="relative">
                <textarea
                  id="bid-signal"
                  aria-label="Signal"
                  value={signalInput}
                  onChange={(e) => setSignalInput(e.target.value)}
                  rows={3}
                  placeholder="A word, a wish, a place, a memory."
                  aria-describedby="bid-signal-count"
                  aria-invalid={signalDraft.over}
                  className="game-slot relative w-full resize-y outline-none font-sans text-[16px] leading-relaxed text-foreground placeholder:text-faint px-3.5 pt-3 pb-7 focus:border-sky-pink transition-colors"
                />
                <span
                  id="bid-signal-count"
                  aria-live="polite"
                  aria-label={`${signalDraft.bytes} of ${signalDraft.max} characters`}
                  className={`pointer-events-none absolute right-3 bottom-2.5 font-mono text-micro tabular-nums ${
                    signalDraft.over ? "text-signal" : "text-faint"
                  }`}
                >
                  {signalDraft.bytes} / {signalDraft.max}
                </span>
              </div>
              {signalDraft.over && (
                <p className="font-sans text-xs text-signal" role="alert">
                  Over the limit by {signalDraft.bytes - signalDraft.max} characters. Shorten it to send.
                </p>
              )}
            </div>

            {actions.wrongChain ? (
              <button
                className={GHOST}
                onClick={actions.switchToTargetChain}
                disabled={actions.switching}
              >
                {actions.switching ? "switching…" : "switch network"}
              </button>
            ) : confirmingBidSignal ? (
              <SignalConfirm
                text={signalDraft.clean}
                confirmLabel={pendingActionLabel(actions, "confirm and place bid", unsafeSnapshot)}
                disabled={
                  writeBlocked ||
                  !biddable ||
                  bidWei === null ||
                  bidWei < s.minimumBid ||
                  bidOffTick ||
                  bidTaken ||
                  signalBlocked
                }
                onConfirm={() => {
                  if (bidWei !== null && biddable && !signalBlocked) {
                    actions.placeBid(bidWei, signalDraft.clean);
                  }
                }}
                onEdit={() => {
                  setBidConfirm(null);
                  document.getElementById("bid-signal")?.focus();
                }}
              />
            ) : (
              <button
                className={PRIMARY}
                disabled={
                  writeBlocked ||
                  !biddable ||
                  bidInvalid ||
                  bidWei === null ||
                  bidWei < s.minimumBid ||
                  bidOffTick ||
                  bidTaken ||
                  signalBlocked
                }
                onClick={() => {
                  if (bidWei === null || !biddable || signalBlocked) return;
                  // A signal is permanent: show it back first. A plain bid goes straight out.
                  if (signalDraft.clean !== "") {
                    setBidConfirm({ bid: bidInput, signal: signalInput });
                    return;
                  }
                  actions.placeBid(bidWei, "");
                }}
              >
                {pendingActionLabel(
                  actions,
                  signalBlocked
                    ? "signal too long"
                    : bidTaken
                      ? "amount taken"
                      : s.yourBidCount === 0
                        ? "place bid"
                        : "place 2nd bid",
                  unsafeSnapshot,
                )}
              </button>
            )}
          </div>
        )}
      </section>
      )}

      {/* Your bids */}
      {isConnected && s.yourBids.length > 0 && (
        <div className={`${PANEL} flex flex-col gap-3`}>
          <Label>Your bids / {s.yourBids.length}</Label>
          <ul className="flex flex-col gap-[3px]">
            {[...s.yourBids]
              .sort((x, y) =>
                y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : x.id - y.id,
              )
              .map((b) => {
                const raiseRaw = raiseInputs[b.id] || "";
                const raiseWei = parseEthInput(raiseRaw);
                const raiseNormalized = normalizeDecimalInput(raiseRaw);
                const raiseInvalid =
                  raiseRaw.trim() !== "" && raiseNormalized !== "." && raiseWei === null;
                const inExtensionWindow = now !== 0 && now + 5 * 60 >= s.endTime;
                const raiseTooLow =
                  inExtensionWindow &&
                  raiseWei !== null &&
                  raiseWei > 0n &&
                  raiseWei < s.minIncreaseForExtension;
                const raiseOffTick = raiseWei !== null && raiseWei > 0n && !onTick(raiseWei, s.bidTick);
                // Once full, the raised total may not equal any other active bid.
                const raiseTaken =
                  raiseWei !== null &&
                  raiseWei > 0n &&
                  s.isFull &&
                  s.allBids.some((row) => row.id !== b.id && row.amount === b.amount + raiseWei);
                // Live board position: same ordering the route uses (minted winners first,
                // then active bids high -> low). Held bids are always in the top 30.
                const boardIndex = s.allBids.findIndex((row) => row.id === b.id);
                const rank =
                  s.phase === "active" && boardIndex !== -1
                    ? s.wonBids.length + boardIndex + 1
                    : null;
                const token = rank === null ? null : s.firstTokenId + rank - 1;
                const zone = token === null ? undefined : zoneForToken(token);
                const rankDay = token === null ? undefined : dayLabelForToken(token);
                const bidSignal = address ? signalForBid(s.signals, b.id, address) : undefined;
                const editKey = `bid:${b.id}`;
                // setBidSignal works while the bid is live: until it mints or is refunded.
                // Write-once: a live bid without a signal can get one, at any time; never replaced.
                const canAddSignal =
                  !bidSignal && (s.phase === "active" || s.phase === "finalizing");
                return (
                  <li
                    key={b.id}
                    className="game-slot relative flex flex-wrap items-center gap-x-3 gap-y-2 pl-4 pr-3 py-3"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: zone ? `var(--z-${zone.id})` : "var(--foreground)" }}
                    />
                    <span className="font-sans font-semibold text-lg tabular-nums text-foreground">
                      {eth(b.amount)}
                      <span className="font-mono text-micro font-normal text-faint ml-1">ETH</span>
                    </span>
                    {token !== null && rankDay && (
                      <span className="font-mono text-micro uppercase tracking-[0.12em] text-muted">
                        #{token} / {rankDay}
                      </span>
                    )}
                    {s.phase === "active" && (
                      <span className="font-mono text-micro uppercase tracking-[0.14em] text-up ml-auto">
                        holding
                      </span>
                    )}
                    {biddable && (
                      <div className="basis-full flex flex-wrap items-center gap-2">
                        <input
                          value={raiseInputs[b.id] ?? ""}
                          onChange={(e) =>
                            setRaiseInputs((p) => ({ ...p, [b.id]: e.target.value }))
                          }
                          inputMode="decimal"
                          placeholder={
                            inExtensionWindow
                              ? `add ${ethCeil(s.minIncreaseForExtension)}`
                              : "add eth"
                          }
                          aria-label="Raise amount in ETH"
                          aria-invalid={raiseInvalid}
                          className="game-slot flex-1 min-w-0 outline-none font-mono text-sm tabular-nums text-foreground placeholder:text-faint px-2 py-1.5 transition-colors"
                        />
                        <button
                          type="button"
                          disabled={
                            writeBlocked ||
                            !biddable ||
                            raiseInvalid ||
                            raiseWei === null ||
                            raiseWei === 0n ||
                            raiseTooLow ||
                            raiseOffTick ||
                            raiseTaken
                          }
                          onClick={() => {
                            if (raiseWei !== null && biddable) {
                              actions.increaseBid(b.id, raiseWei);
                            }
                          }}
                          className="game-btn text-[12px] px-3 py-1.5 cursor-pointer"
                        >
                          {raiseInvalid
                            ? "invalid amount"
                            : raiseOffTick
                              ? "0.001 steps"
                              : raiseTaken
                                ? "amount taken"
                                : raiseTooLow
                                  ? "min too low"
                                  : pendingActionLabel(
                                  actions,
                                  raiseWei !== null && raiseWei > 0n
                                    ? `raise to ${eth(b.amount + raiseWei)}`
                                    : "raise",
                                  unsafeSnapshot,
                                )}
                        </button>
                        {raiseInvalid && (
                          <span className="basis-full font-mono text-micro text-signal text-right" role="alert">
                            Use one decimal number; comma is accepted.
                          </span>
                        )}
                      </div>
                    )}
                    <div className="basis-full flex flex-col gap-1.5 pt-1">
                      {(editing !== editKey || !canAddSignal) && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-micro uppercase tracking-[0.14em] text-faint">
                          Your signal
                        </span>
                        {canAddSignal && (
                          <button
                            type="button"
                            className={CHIP}
                            disabled={writeBlocked || !s.signalsReady}
                            onClick={() => setEditing(editKey)}
                          >
                            add a signal
                          </button>
                        )}
                      </div>
                      )}
                      {editing === editKey && canAddSignal ? (
                        <SignalEditor
                          maxBytes={s.maxSignalBytes}
                          disabled={writeBlocked || !s.signalsReady}
                          saveLabel={pendingActionLabel(actions, "save signal", unsafeSnapshot)}
                          onSave={(clean) => actions.setBidSignal(b.id, clean)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <SignalText signal={bidSignal} />
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {/* Your days: Season 3 tokens this wallet holds, each with its signal. A day with none
          (neither from the winning bid nor its holder) can get one, at any time, once. */}
      {isConnected && settlementStarted && s.yourTokens.length > 0 && (
        <div className={`${PANEL} flex flex-col gap-3`}>
          <Label>Your days / {s.yourTokens.length}</Label>
          <ul className="flex flex-col gap-[3px]">
            {s.yourTokens.map((token) => {
              const zone = zoneForToken(token);
              const label = dayLabelForToken(token);
              const eff = s.effectiveSignalForDay(token);
              const editKey = `day:${token}`;
              const text = eff?.signal || undefined;
              return (
                <li
                  key={token}
                  className="game-slot relative flex flex-col gap-2 pl-4 pr-3 py-3"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: zone ? `var(--z-${zone.id})` : "var(--foreground)" }}
                  />
                  <span className="font-sans font-semibold text-[15px] text-foreground">
                    #{token}
                    <span className="font-mono text-micro font-normal uppercase tracking-[0.12em] text-muted ml-2">
                      {label}
                    </span>
                  </span>
                  {editing === editKey && !text ? (
                    <SignalEditor
                      maxBytes={s.maxSignalBytes}
                      disabled={writeBlocked || !s.signalsReady}
                      saveLabel={pendingActionLabel(actions, "save signal", unsafeSnapshot)}
                      onSave={(clean) => actions.setTokenSignal(token, clean)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <SignalText signal={text} />
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-micro uppercase tracking-[0.12em] text-faint">
                          {eff?.source === "holder"
                            ? "added by the holder"
                            : text
                              ? "from the winning bid"
                              : ""}
                        </span>
                        {!text && (
                          <button
                            type="button"
                            className={CHIP}
                            disabled={writeBlocked || !s.signalsReady}
                            onClick={() => setEditing(editKey)}
                          >
                            add a signal
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pending refund */}
      {isConnected && s.yourPending > 0n && (
        <div className={`${PANEL} flex items-center justify-between`}>
          <div className="flex flex-col gap-1">
            <Label>Refund available</Label>
            <span className="font-sans font-semibold text-lg tabular-nums text-foreground">
              {eth(s.yourPending)}{" "}
              <span className="font-mono text-xs font-normal text-muted">ETH</span>
            </span>
          </div>
          <button
            className={GHOST}
            disabled={writeBlocked}
            onClick={() => {
              if (!writeBlocked) actions.withdraw();
            }}
          >
            {busy ? "…" : "withdraw"}
          </button>
        </div>
      )}

      {/* Permissionless recovery */}
      {(recoveryAvailable ||
        emergencyAvailable ||
        supplyRecoveryAvailable ||
        mintingRecoveryAvailable) && (
        <div className="game-panel border-laser/60 p-5 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Permissionless recovery</Label>
            <p className="font-sans text-sm text-muted leading-relaxed">
              {supplyRecoveryAvailable
                ? `Panorama supply no longer matches the required ${s.expectedNftSupply}. Settlement cannot safely continue; remaining bids can be refunded.`
                : mintingRecoveryAvailable
                  ? `Settlement minting is unavailable after the grace period. The auction needs a mint cap of ${s.requiredMintCapForSettlement}; any wallet can move the unminted bids into recovery.`
                  : recoveryAvailable
                    ? s.activeBids > 0
                      ? `${s.activeBids} bids still need refunds. Any wallet can process the next batch.`
                      : "All bids are refunded. One final call releases the remaining accounting; any wallet can send it."
                    : "The hard emergency deadline has passed. Any wallet can stop settlement and refund every unminted bid."}
            </p>
          </div>
          {!isConnected ? (
            <WalletPill connectLabel="connect to recover" />
          ) : actions.wrongChain ? (
            <button
              className={GHOST}
              onClick={actions.switchToTargetChain}
              disabled={actions.switching}
            >
              {actions.switching ? "switching…" : "switch network"}
            </button>
          ) : (
            <button
              className={GHOST}
              disabled={writeBlocked}
              onClick={() =>
                !writeBlocked && supplyRecoveryAvailable
                  ? actions.recoverFromSupplyMismatch(30)
                  : !writeBlocked && mintingRecoveryAvailable
                    ? actions.recoverFromMintingUnavailable(30)
                    : !writeBlocked && recoveryAvailable
                      ? actions.refundAll(30)
                      : !writeBlocked
                        ? actions.emergencyRefund(30)
                        : undefined
              }
            >
              {busy
                ? "confirming…"
                : supplyRecoveryAvailable
                  ? "recover from supply mismatch"
                  : mintingRecoveryAvailable
                    ? "recover unavailable minting"
                    : recoveryAvailable
                      ? s.activeBids > 0
                        ? "refund next 30"
                        : "finish recovery"
                      : "start emergency refund"}
            </button>
          )}
          <Link
            href="/recovery"
            className="font-mono text-micro uppercase tracking-[0.14em] text-muted hover:text-foreground transition-colors"
          >
            all recovery tools →
          </Link>
        </div>
      )}

      {/* Standings: every live bid (and minted winner) with its address, the panel's
          continuation as on the Season 2 site. Hidden before the sale opens. */}
      {phaseView !== "upcoming" && (
        <div className={PANEL}>
          <Standings
            bids={s.allBids}
            won={s.wonBids}
            over={(now !== 0 && now >= s.endTime) || s.phase !== "active"}
            firstTokenId={s.firstTokenId}
            you={address}
            activeBids={s.activeBids}
            maxUnits={s.maxUnits}
            isFull={s.isFull}
            clearing={heroClearing}
            phase={s.phase}
            enableEns={!demo}
            wonStatus={s.wonStatus}
            wonExpectedCount={s.wonExpectedCount}
            wonIntegrityIssue={s.wonIntegrityIssue}
            onRetryWon={s.refetchWon}
            signalFor={markerSignal}
            openDays={openDays}
            now={dayNow}
          />
        </div>
      )}

      {lastTx && (
        <a
          href={getBlockExplorerTxUrl(lastTx)}
          target="_blank"
          rel="noreferrer"
          className="pt-2 font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          view transaction ↗
        </a>
      )}
    </div>
  );

  const showBoardData = !comingSoon && !loading && !(s.readFailed && !demo);
  const routeOver = (now !== 0 && now >= s.endTime) || s.phase !== "active";

  return (
    <div className="min-h-svh flex flex-col bg-background text-foreground">

      {/* TITLE SCREEN: a framed game screen with the route drifting behind the title and menu. */}
      <section className="px-3 md:px-8 xl:px-12 pt-3 md:pt-5">
        <div className="mx-auto w-full max-w-[1480px] h-[calc(100svh-2.5rem)] min-h-[540px] max-h-[880px] border border-[var(--panel-edge)] shadow-[0_0_60px_rgba(43,43,255,0.18)]">
          <HeroScreen
            initialTableaus={heroTableaus}
            primary={afterSale && openCount > 0 ? { label: "bid", href: "/auctions" } : undefined}
            topRight={
              <a
                href={SITE_URL}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto game-btn inline-block text-[13px] px-4 py-1.5 [text-transform:none] [letter-spacing:normal]"
              >
                Enter Panorama ↗
              </a>
            }
          />
        </div>
      </section>

      {/* SALE: the route board (the auction board itself) beside the bid console. */}
      <div
        id="sale"
        className="sale-grid scroll-mt-4 px-5 md:px-8 xl:px-12 pt-12 md:pt-16 pb-16 grid gap-x-10 xl:gap-x-14 gap-y-14 lg:grid-cols-[minmax(0,1fr)_25rem] xl:grid-cols-[minmax(0,1fr)_27rem] 3xl:grid-cols-[minmax(0,1fr)_32rem]"
      >
        <aside className="sale-console order-first lg:order-last lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto overlay-scroll-content">
          <div className="game-titlebar px-3 py-1.5 text-[14px] flex items-center justify-between gap-3">
            <span>{afterSale ? "the days" : "bid"}</span>
            <button
              type="button"
              onClick={() => updateRailMax(!railMax)}
              title={railMax ? "Exit full width" : "Full width"}
              aria-label={railMax ? "Exit full-width bid panel" : "Expand bid panel to full width"}
              aria-pressed={railMax}
              className="hidden lg:inline-flex items-center justify-center w-6 h-6 -mr-1 text-white/80 hover:text-white cursor-pointer"
            >
              {/* Both icons render; CSS keyed on html[data-rail-max] shows the right one, so a
                  remembered choice never swaps icons after hydration. */}
              <span className="rail-icon-max inline-flex">
                <LuMaximize2 size={14} />
              </span>
              <span className="rail-icon-restore inline-flex">
                <LuMinimize2 size={14} />
              </span>
            </button>
          </div>
          {consoleBody}
        </aside>

        <main className="sale-main min-w-0 flex flex-col gap-20 md:gap-24">
          {afterSale && (
            <section aria-label="About Panorama" className="flex flex-col gap-4 max-w-[60ch]">
              <p className="font-sans text-[clamp(1.05rem,1rem+0.3vw,1.25rem)] leading-relaxed text-foreground">
                Panorama is one artwork that grows by a tableau a day, each joined to the one before.
                The price of $PANO over the day sets its mood. Season 3 is thirty days by Yigit Duman
                and Pale Kirill, revealed one a day from October 20.
              </p>
              <p className="font-mono text-micro uppercase tracking-[0.2em] text-muted">
                {soldCount} of {s.maxUnits} sold
                {openCount > 0 && (
                  <>
                    {" / "}
                    <Link href="/auctions" className="text-sky-pink hover:text-foreground transition-colors">
                      {openCount} open for bids →
                    </Link>
                  </>
                )}
              </p>
            </section>
          )}

          <ArtistStatement />

          <WorkChapters />


          <section id="route" className="scroll-mt-4">
            <SectionHead title="the route" zone="interface" />
            <div className="flex flex-col gap-4 font-sans text-[16px] text-muted leading-relaxed max-w-[64ch] mb-8">
              <p>
                Thirty days through six zones, from a city read as a system to land
                that has not formed yet. In every zone <Kirill /> tells the home through
                five things, one a day: a figure, a place, an event, an object and a
                feeling. Read a row to walk a zone. Read a column to watch one thing
                change: the creator of the interface becomes an architect, a knight, a
                lamb, an angel, and a soul.
              </p>
              {afterSale ? (
                <p>
                  {soldCount} of the {s.maxUnits} days are sold.
                  {openCount > 0 && ` The other ${openCount} are open for bids: pick one below to bid on it.`}{" "}
                  The market sets each day&apos;s mood, and its holder&apos;s signal can add one more voice.
                </p>
              ) : (
                <p>
                  Each day goes to one bid. The highest bid holds day 1, the next holds
                  day 2, and so on down the route. Hold a day when bidding closes and it
                  is yours. The market sets its mood, and a signal can add one more voice.
                </p>
              )}
            </div>
            <RouteBoard
              bids={showBoardData ? s.allBids : []}
              won={showBoardData ? s.wonBids : []}
              phase={showBoardData ? s.phase : "active"}
              maxUnits={s.maxUnits || 30}
              firstTokenId={s.firstTokenId || 181}
              you={address}
              signalFor={markerSignal}
              beamRank={beamRank}
              over={showBoardData && routeOver}
              enableEns={!demo}
              openDays={openDays}
              now={dayNow}
            />

          </section>

          <SeasonDetails
            durationHours={durationHours}
            incrementPct={s.minIncrementBps ? s.minIncrementBps / 100 : 5}
            reserve={s.reservePrice > 0n ? eth(s.reservePrice) : "0.1"}
            hardEndLabel={
              s.absoluteEndTime > 0 ? fmtDateUTC(s.absoluteEndTime) : undefined
            }
            settled={afterSale}
            soldCount={soldCount}
            openCount={openCount}
          />
        </main>
      </div>
    </div>
  );
}
