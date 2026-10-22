"use client";

import Link from "next/link";
import { LuArrowUpRight } from "react-icons/lu";
import { SITE_URL } from "@/lib/constants";
import type { DayAuction } from "@/lib/dayAuctions";
import { SEASON_3_DAYS, seasonDayForToken, themeForToken, zoneForToken } from "@/lib/season3Zones";
import { STRIP } from "@/app/auction/components/HeroPanorama";
import { fmtLeft, OPEN_DAY_STATUS, openDayView } from "@/app/auction/components/OpenDays";
import { eth, short, useChainNow } from "@/app/auction/components/ui";
import { retryDayAuctions, useDayAuctions } from "@/app/hooks/useDayAuctions";

/** Each zone's picture: the first six studio tiles are the six zones, in order. */
const ZONE_TILE: Record<string, string> = {
	interface: STRIP[0],
	city: STRIP[1],
	suburb: STRIP[2],
	village: STRIP[3],
	nature: STRIP[4],
	abstract: STRIP[5],
};

/**
 * The days the season's auction left open, as cards on one screen (desktop): each card is a link
 * to its own auction on Manifold, where the bidding happens.
 */
export default function OpenForBidsPage() {
	const { data, anchor, loading, error, unavailable } = useDayAuctions();
	const now = useChainNow(anchor);
	const auctions = data?.auctions ?? [];
	const open = auctions.filter((a) => openDayView(a, now).biddable).length;

	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh lg:overflow-hidden">
			<main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-5 md:px-8 xl:px-12 pb-8 lg:pb-6 lg:min-h-0">
				<div className="flex items-center justify-between gap-4 pt-5 md:pt-6">
					<Link href="/" className="font-mono text-micro uppercase tracking-[0.14em] text-muted hover:text-foreground transition-colors">
						← Panorama Season 3
					</Link>
					<a
						href={SITE_URL}
						target="_blank"
						rel="noreferrer"
						className="game-btn inline-block text-[13px] px-4 py-1.5 [text-transform:none] [letter-spacing:normal]"
					>
						Enter Panorama ↗
					</a>
				</div>

				<header className="flex flex-wrap items-end justify-between gap-x-12 gap-y-4 pt-6 pb-6 md:pt-8">
					<h1 className="game-logo leading-[0.9] text-[clamp(2.6rem,1.6rem+3vw,4.6rem)]">Open for bids.</h1>
					<p className="max-w-[52ch] font-sans text-[15px] leading-relaxed text-muted">
						Panorama is one artwork that grows by a tableau a day; the market sets each day&apos;s mood.
						Season 3 is thirty days by Yigit Duman and Pale Kirill.
						{data && (
							<span className="text-foreground">
								{" "}
								{SEASON_3_DAYS - open} of {SEASON_3_DAYS} are sold. These {open} are open.
							</span>
						)}
					</p>
				</header>

				{unavailable ? (
					<p className="font-sans text-sm text-muted">The open days are listed on mainnet only.</p>
				) : !data && error && !loading ? (
					<p className="font-mono text-micro uppercase tracking-[0.14em] text-muted" role="alert">
						{error.message}{" "}
						<button type="button" onClick={() => void retryDayAuctions()} className="text-foreground underline">
							retry
						</button>
					</p>
				) : (
					<ol className="grid gap-3 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-2">
						{data
							? auctions.map((a) => <DayCard key={a.listingId} auction={a} now={now} />)
							: Array.from({ length: 8 }, (_, i) => (
									<li key={i} className="game-panel min-h-[260px] lg:min-h-0" aria-hidden />
								))}
					</ol>
				)}
			</main>
		</div>
	);
}

function DayCard({ auction, now }: { auction: DayAuction; now: number }) {
	const view = openDayView(auction, now);
	const day = seasonDayForToken(auction.tokenId);
	const theme = themeForToken(auction.tokenId)?.theme;
	const zone = zoneForToken(auction.tokenId);
	const color = `var(--z-${zone?.id})`;
	const earlier = auction.bids.slice(1);

	return (
		<li className="min-h-[260px] lg:min-h-0">
			<a
				href={auction.url}
				target="_blank"
				rel="noreferrer"
				aria-label={`Day ${day}, ${theme}: ${view.biddable ? "bid" : "view"} on Manifold`}
				className="group game-panel relative flex h-full flex-col overflow-hidden hover:border-[var(--sky-pink)] transition-colors"
				style={{ borderTop: `2px solid ${color}` }}
			>
				{zone && (
					<>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={ZONE_TILE[zone.id]}
							alt=""
							loading="lazy"
							className="absolute inset-x-0 top-0 h-[62%] w-full object-cover opacity-60 transition-opacity duration-300 group-hover:opacity-80"
						/>
						<div aria-hidden className="absolute inset-x-0 top-0 h-[62%] bg-[linear-gradient(rgba(4,4,20,0.25),rgba(4,4,20,0.7)_55%,rgb(4,4,20))]" />
					</>
				)}

				<div className="relative flex min-h-0 flex-1 flex-col p-4 xl:p-5">
					<div className="flex shrink-0 items-center justify-between gap-3">
						<span className="game-caption text-[10px]">
							Day {day} / <span style={{ color }}>{zone?.name}</span>
						</span>
						{view.left !== null ? (
							<span className={`inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums ${view.closing ? "text-sky-pink" : "text-foreground"}`}>
								<span aria-hidden className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--up)] animate-pulse" />
								{fmtLeft(view.left)}
							</span>
						) : (
							view.status !== "open" && (
								<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground">{OPEN_DAY_STATUS[view.status]}</span>
							)
						)}
					</div>

					<h2 className="game-menu mt-2 shrink-0 truncate text-[clamp(1.6rem,1.2rem+0.9vw,2.2rem)] leading-tight">{theme}</h2>

					<div aria-hidden className="min-h-0 flex-1" />

					<div className="shrink-0 pt-3">
						<div className="flex items-baseline gap-1.5">
							<span className="font-sans font-bold text-[26px] leading-none tabular-nums text-foreground">{view.price}</span>
							<span className="font-mono text-[10px] text-muted">ETH</span>
						</div>
						<div className="mt-1.5 truncate font-sans text-sm text-muted">{view.who ?? "No bids yet"}</div>
					</div>

					{earlier.length > 0 && (
						<ol className="mt-3 max-h-24 min-h-0 overflow-y-auto border-t border-[var(--panel-edge)]">
							{earlier.map((bid) => (
								<li key={`${bid.txHash}-${bid.amount}`} className="flex justify-between gap-3 py-1 font-sans text-xs text-muted">
									<span className="min-w-0 truncate">{bid.label ?? short(bid.bidder)}</span>
									<span className="shrink-0 tabular-nums">{eth(BigInt(bid.amount))}</span>
								</li>
							))}
						</ol>
					)}

					<span className="game-btn mt-4 flex shrink-0 items-center justify-center gap-1.5 text-[14px] py-2">
						{view.biddable ? "bid on manifold" : "view on manifold"}
						<LuArrowUpRight size={13} aria-hidden />
					</span>
				</div>
			</a>
		</li>
	);
}
