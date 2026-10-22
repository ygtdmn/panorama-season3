"use client";

import Link from "next/link";
import { LuArrowUpRight } from "react-icons/lu";
import { dayAuctionStatus, isBiddable, type DayAuction, type DayAuctionStatus } from "@/lib/dayAuctions";
import { seasonDayForToken, themeForToken, zoneForToken } from "@/lib/season3Zones";
import { eth, short } from "./ui";

export const OPEN_DAY_STATUS: Record<DayAuctionStatus, string> = {
	open: "No bids yet",
	live: "Live",
	ended: "Ended",
	sold: "Sold",
	withdrawn: "Withdrawn",
};

/** Clock face for a live auction: "4:12:07" or "12:07". */
export function fmtLeft(seconds: number): string {
	const left = Math.max(0, Math.floor(seconds));
	const h = Math.floor(left / 3600);
	const m = Math.floor((left % 3600) / 60);
	const s = left % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** What one open day says at a glance: its price, who holds the bid, and how it stands. */
export function openDayView(auction: DayAuction, now: number) {
	const status = dayAuctionStatus(auction, now);
	const high = auction.highBid;
	return {
		status,
		biddable: isBiddable(status),
		price: eth(BigInt(high?.amount ?? auction.reserve)),
		who: high ? high.label ?? short(high.bidder) : null,
		left: status === "live" && now > 0 ? auction.endTime - now : null,
		closing: status === "live" && now > 0 && auction.endTime - now <= auction.extensionSeconds,
	};
}

function LiveClock({ seconds, closing }: { seconds: number; closing: boolean }) {
	return (
		<span className={`inline-flex items-center gap-1.5 ${closing ? "text-sky-pink" : "text-foreground"}`}>
			<span aria-hidden className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--up)] animate-pulse" />
			{fmtLeft(seconds)}
		</span>
	);
}

/** One open day as a line in the console: day, theme, price, standing, and a way to Manifold. */
function OpenDayRow({ auction, now }: { auction: DayAuction; now: number }) {
	const view = openDayView(auction, now);
	const day = seasonDayForToken(auction.tokenId);
	const theme = themeForToken(auction.tokenId)?.theme;
	const zone = zoneForToken(auction.tokenId);
	return (
		<li>
			<a
				href={auction.url}
				target="_blank"
				rel="noreferrer"
				aria-label={`Day ${day}, ${theme}: ${view.biddable ? "bid" : "view"} on Manifold`}
				className="group game-slot relative flex items-center gap-3 h-11 pl-3 pr-2.5 hover:bg-white/[0.04] transition-colors"
			>
				<span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: `var(--z-${zone?.id})` }} />
				<span className="w-6 shrink-0 font-mono text-[10px] tabular-nums text-faint">{day}</span>
				<span className="flex-1 min-w-0 truncate font-sans font-semibold text-[14px] text-foreground">{theme}</span>
				<span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
					{view.left !== null ? (
						<LiveClock seconds={view.left} closing={view.closing} />
					) : view.status === "open" ? (
						view.who ?? "no bids"
					) : (
						OPEN_DAY_STATUS[view.status]
					)}
				</span>
				<span className="w-16 shrink-0 text-right font-sans font-bold text-[13px] tabular-nums text-foreground">
					{view.price}
					<span className="ml-1 font-mono text-[9px] font-normal text-faint">ETH</span>
				</span>
				<LuArrowUpRight size={13} aria-hidden className="shrink-0 text-faint group-hover:text-foreground transition-colors" />
			</a>
		</li>
	);
}

/** The console's list of the days still open for bids, each a link to its Manifold auction. */
export function OpenDaysPanel({ auctions, now }: { auctions: DayAuction[]; now: number }) {
	if (auctions.length === 0) return null;
	return (
		<section aria-label="Open for bids" className="relative game-panel p-5 flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-mono text-micro uppercase tracking-[0.2em] text-muted">Open for bids</span>
				<Link
					href="/auctions"
					className="font-mono text-micro uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
				>
					all {auctions.length} →
				</Link>
			</div>
			<ol className="flex flex-col gap-1">
				{auctions.map((a) => (
					<OpenDayRow key={a.listingId} auction={a} now={now} />
				))}
			</ol>
		</section>
	);
}
