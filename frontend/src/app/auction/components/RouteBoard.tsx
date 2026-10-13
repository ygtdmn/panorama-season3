"use client";

import { useEffect, useRef, useState } from "react";
import { LuMail } from "react-icons/lu";
import { useAddressLabel } from "@/app/hooks/useAddressLabel";
import { DAY_KINDS, DAYS_PER_ZONE, SEASON_3_ZONES, themeForToken, type Season3Zone } from "@/lib/season3Zones";
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

/**
 * The holder's ENS name, resolved once the cell comes near the viewport (as the ledger does),
 * so thirty cells never fire thirty lookups at load. Falls back to the short address.
 */
function Holder({ address, enableEns }: { address: string; enableEns: boolean }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [resolve, setResolve] = useState(false);
	useEffect(() => {
		if (!enableEns || resolve) return;
		const el = ref.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setResolve(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				setResolve(true);
				observer.disconnect();
			},
			{ rootMargin: "240px 0px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [enableEns, resolve]);
	const ens = useAddressLabel(enableEns && resolve ? address : null);
	return (
		<span ref={ref} title={address}>
			{ens || short(address)}
		</span>
	);
}

function DayCell({
	zone,
	day,
	token,
	slot,
	you,
	beam,
	over,
	signalFor,
	enableEns,
}: {
	zone: Season3Zone;
	day: number;
	token: number;
	slot: Slot;
	you?: string;
	beam: boolean;
	over: boolean;
	signalFor: (bidId: number, tokenId?: number) => string | undefined;
	enableEns: boolean;
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
			className={`game-slot relative flex flex-row items-center xl:flex-col xl:items-stretch xl:justify-between gap-3 xl:gap-2 min-h-[3.25rem] xl:min-h-[7.5rem] px-3 py-2.5 ${
				beam ? "beam-target" : ""
			}`}
			style={mine ? { background: `color-mix(in srgb, ${zoneColor} 26%, rgba(4,4,16,0.8))` } : undefined}
		>
			{/* the day: its number and token, then Kirill's theme as the headline */}
			<div className="flex flex-col gap-1 w-32 xl:w-auto shrink-0 min-w-0">
				<span className="flex items-baseline justify-between gap-2 font-mono text-[10px] tabular-nums text-faint">
					<span>
						<span className="text-muted">{day}</span>
						<span className="xl:hidden"> / {theme?.kind}</span>
					</span>
					<span className="hidden xl:inline">#{token}</span>
				</span>
				{theme && (
					<span className="font-sans font-semibold text-[15px] xl:text-[16px] leading-tight text-foreground break-words">
						{theme.theme}
					</span>
				)}
			</div>

			{/* what the auction adds: the bid holding the day, its holder and signal */}
			{row ? (
				<div className="flex flex-1 items-center xl:items-end justify-between gap-2 min-w-0">
					<div className="flex flex-row items-baseline gap-3 xl:flex-col xl:items-start xl:gap-0.5 min-w-0">
						<span className="font-sans font-bold text-[13px] tabular-nums leading-none text-foreground shrink-0">
							{eth(row.amount)}
							<span className="font-mono text-[10px] font-normal text-faint ml-1">ETH</span>
						</span>
						<span className={`font-mono text-[10px] truncate ${mine ? "text-sky-pink font-bold" : "text-muted"}`}>
							{mine ? "you" : <Holder address={row.bidder} enableEns={enableEns} />}
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
					{beam ? "your bid lands here" : over ? "unsold" : "open"}
				</span>
			)}
			{beam && row && <span className="sr-only">Your bid would take this day.</span>}
		</li>
	);
}

/**
 * The route and its themes in one board, as Pale Kirill drew the season: six zones down, his
 * five kinds of thing across (figure, place, event, object, feeling), one theme per day. Read a
 * row to walk a zone in five days, a column to watch one thing change along the route. Each day
 * also carries the auction: the bid holding it now (rank = day), its holder, its signal, and
 * the day a bid being typed in the console would take. Below xl each zone stacks as a block.
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
	enableEns = true,
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
	/** Resolve holders' ENS names (off in demo mode, whose addresses are fake). */
	enableEns?: boolean;
}) {
	const slots = routeSlots({ bids, won, phase, maxUnits, firstTokenId });
	const ROW = "xl:grid xl:grid-cols-[10.5rem_repeat(5,minmax(0,1fr))] xl:gap-1.5";
	return (
		<div data-route-board="" className="flex flex-col gap-3 xl:gap-1.5">
			{/* Kirill's five kinds, as column heads (wide screens only; below, each day says its kind) */}
			<div aria-hidden className={`hidden ${ROW} px-1.5`}>
				<span />
				{DAY_KINDS.map((kind) => (
					<span key={kind} className="px-3 pb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-sky-pink">
						{kind}
					</span>
				))}
			</div>

			<ol className="flex flex-col gap-3 xl:gap-1.5">
				{SEASON_3_ZONES.map((zone, zi) => (
					<li key={zone.id} className={`game-panel flex flex-col min-w-0 xl:p-1.5 ${ROW}`}>
						{/* the zone: its picture, name, tokens and what it looks like */}
						<div className="game-slot flex flex-col min-w-0 overflow-hidden">
							<div className="relative h-24 xl:h-16 overflow-hidden border-b border-[var(--panel-edge)] xl:border-b-0">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={ZONE_IMAGE[zone.id]}
									alt=""
									loading="lazy"
									className="absolute inset-0 w-full h-full object-cover"
								/>
								<div aria-hidden className="absolute inset-0 bg-[linear-gradient(transparent_20%,rgba(4,4,20,0.8))]" />
								<div className="absolute left-3 right-3 bottom-1.5 flex items-end justify-between gap-2">
									<h3 className="game-menu text-[21px] xl:text-[18px] leading-none" style={{ color: `var(--z-${zone.id})` }}>
										{zone.name.toLowerCase()}
									</h3>
									<span className="game-caption text-[10px] xl:hidden">
										#{zone.firstToken} to #{zone.lastToken}
									</span>
								</div>
							</div>
							<p className="px-3 pt-2 pb-2.5 font-sans text-[12.5px] leading-snug text-muted">{zone.description}</p>
						</div>

						<ol className="contents xl:contents [&>li]:mx-2 [&>li]:mb-1 xl:[&>li]:m-0">
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
										enableEns={enableEns}
									/>
								);
							})}
						</ol>
					</li>
				))}
			</ol>
		</div>
	);
}
