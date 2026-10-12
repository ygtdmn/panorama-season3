"use client";

import { LuMail } from "react-icons/lu";
import { DAYS_PER_ZONE, SEASON_3_ZONES, themeForToken, type Season3Zone } from "@/lib/season3Zones";
import type { AuctionBidRow, AuctionPhase, WonRow } from "../hooks/useAuctionState";
import { eth, short } from "./ui";
import { STRIP } from "./HeroPanorama";

/** What holds one day of the route right now. */
type Slot =
	| { kind: "won"; row: WonRow }
	| { kind: "bid"; row: AuctionBidRow }
	| { kind: "open" };

/**
 * Rank r holds day r: minted winners first (by token), then live bids high to low, the same
 * order the contract mints in. A cancelled sale holds nothing.
 */
export function routeSlots({
	bids,
	won,
	phase,
	maxUnits,
	firstTokenId,
}: {
	bids: AuctionBidRow[];
	won: WonRow[];
	phase: AuctionPhase;
	maxUnits: number;
	firstTokenId: number;
}): Slot[] {
	const slots: Slot[] = Array.from({ length: maxUnits }, () => ({ kind: "open" }));
	if (phase === "cancelled") return slots;
	for (const w of won) {
		const i = w.tokenId - firstTokenId;
		if (i >= 0 && i < maxUnits) slots[i] = { kind: "won", row: w };
	}
	let next = won.length;
	for (const b of bids) {
		if (next >= maxUnits) break;
		slots[next++] = { kind: "bid", row: b };
	}
	return slots;
}

/** The rank a new bid of `amount` would take right now: ties stay behind the earlier bid. */
export function landingRank(amount: bigint, bids: AuctionBidRow[], wonCount: number): number {
	let ahead = 0;
	for (const b of bids) if (b.amount >= amount) ahead++;
	return wonCount + ahead + 1;
}

/** Each zone's picture: the first six studio tiles are the six zones, in order. */
const ZONE_IMAGE: Record<Season3Zone["id"], string> = {
	interface: STRIP[0],
	city: STRIP[1],
	suburb: STRIP[2],
	village: STRIP[3],
	nature: STRIP[4],
	abstract: STRIP[5],
};

function DayCell({
	zone,
	day,
	token,
	slot,
	you,
	beam,
	over,
	signalFor,
}: {
	zone: Season3Zone;
	day: number;
	token: number;
	slot: Slot;
	you?: string;
	beam: boolean;
	over: boolean;
	signalFor: (bidId: number, tokenId?: number) => string | undefined;
}) {
	const row = slot.kind !== "open" ? slot.row : undefined;
	const mine = !!row && !!you && row.bidder.toLowerCase() === you.toLowerCase();
	// A minted day shows its effective signal (the holder's once set); a live bid its own.
	const signal =
		slot.kind === "won" ? signalFor(slot.row.id, slot.row.tokenId) : row ? signalFor(row.id) : undefined;
	const zoneColor = `var(--z-${zone.id})`;
	const theme = themeForToken(token);

	return (
		<li
			data-day={day}
			className={`game-slot relative flex flex-row items-center sm:flex-col sm:items-stretch sm:justify-between gap-3 sm:gap-1.5 min-h-[3rem] sm:min-h-[4.6rem] px-2.5 py-2 ${
				beam ? "beam-target" : ""
			}`}
			style={mine ? { background: `color-mix(in srgb, ${zoneColor} 26%, rgba(4,4,16,0.8))` } : undefined}
		>
			<div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2 w-24 sm:w-auto shrink-0 min-w-0">
				<span className="flex items-baseline gap-1.5 min-w-0">
					<span className="font-sans font-semibold text-[13px] leading-none text-foreground">{day}</span>
					{theme && (
						<span className="font-sans text-[12px] leading-none text-muted truncate" title={`${theme.kind}: ${theme.theme}`}>
							{theme.theme}
						</span>
					)}
				</span>
				<span className="font-mono text-[10px] tabular-nums text-faint shrink-0">#{token}</span>
			</div>

			{row ? (
				<div className="flex flex-1 items-center sm:items-end justify-between gap-2 min-w-0">
					<div className="flex flex-row items-baseline gap-3 sm:flex-col sm:items-start sm:gap-0.5 min-w-0">
						<span className="font-sans font-bold text-[14px] tabular-nums leading-none text-foreground shrink-0">
							{eth(row.amount)}
							<span className="font-mono text-[10px] font-normal text-faint ml-1">ETH</span>
						</span>
						<span className={`font-mono text-[10px] truncate ${mine ? "text-sky-pink font-bold" : "text-muted"}`}>
							{mine ? "you" : short(row.bidder)}
							{slot.kind === "won" && (
								<>
									<span className="text-faint"> / </span>
									<span className="text-faint">minted</span>
								</>
							)}
						</span>
					</div>
					{signal && (
						<button
							type="button"
							aria-label={`Signal on bid ${row.id}: ${signal}`}
							data-tooltip={signal}
							data-tooltip-tap=""
							data-tooltip-signal=""
							className="shrink-0 inline-flex items-center justify-center w-6 h-6 cursor-help text-laser hover:text-sky-pink transition-colors"
						>
							<LuMail size={14} aria-hidden />
						</button>
					)}
				</div>
			) : (
				<span className={`flex-1 font-mono text-[10px] ${beam ? "text-laser font-bold" : "text-faint"}`}>
					{beam ? "your bid lands here" : over ? "unsold" : "empty"}
				</span>
			)}
			{beam && row && <span className="sr-only">Your bid would take this day.</span>}
		</li>
	);
}

/**
 * The thirty days as the board itself: six zones of five, in order, each zone under its own
 * picture like an inventory page. Each day shows the bid holding it now (rank = day), its
 * signal if it carries one, and the day a bid being typed in the console would take.
 */
export function RouteBoard({
	bids,
	won,
	phase,
	maxUnits,
	firstTokenId,
	you,
	signalFor,
	beamRank,
	over,
}: {
	bids: AuctionBidRow[];
	won: WonRow[];
	phase: AuctionPhase;
	maxUnits: number;
	firstTokenId: number;
	you?: string;
	/** The signal to mark on a row: by bid id while live, by token once minted. */
	signalFor: (bidId: number, tokenId?: number) => string | undefined;
	/** Rank (1-based) the bid being typed would take, or null. */
	beamRank: number | null;
	/** Bidding is over: an empty day reads as unsold. */
	over: boolean;
}) {
	const slots = routeSlots({ bids, won, phase, maxUnits, firstTokenId });
	return (
		<ol data-route-board="" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{SEASON_3_ZONES.map((zone, zi) => (
				<li key={zone.id} className="game-panel flex flex-col min-w-0">
					<div className="relative h-28 overflow-hidden border-b border-[var(--panel-edge)]">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={ZONE_IMAGE[zone.id]}
							alt=""
							loading="lazy"
							className="absolute inset-0 w-full h-full object-cover"
						/>
						<div aria-hidden className="absolute inset-0 bg-[linear-gradient(transparent_30%,rgba(4,4,20,0.75))]" />
						<div className="absolute left-3 right-3 bottom-2 flex items-end justify-between gap-2">
							<h3 className="game-menu text-[22px] leading-none">{zone.name.toLowerCase()}</h3>
							<span className="game-caption text-[10px]">
								#{zone.firstToken} to #{zone.lastToken}
							</span>
						</div>
					</div>
					<p className="px-3 pt-2.5 pb-2 font-sans text-[13px] leading-snug text-muted">{zone.description}</p>
					<ol className="flex flex-col gap-1 p-2 pt-0">
						{Array.from({ length: DAYS_PER_ZONE }, (_, di) => {
							const index = zi * DAYS_PER_ZONE + di;
							if (index >= maxUnits) return null;
							return (
								<DayCell
									key={index}
									zone={zone}
									day={index + 1}
									token={firstTokenId + index}
									slot={slots[index]}
									you={you}
									beam={beamRank === index + 1}
									over={over}
									signalFor={signalFor}
								/>
							);
						})}
					</ol>
				</li>
			))}
		</ol>
	);
}
