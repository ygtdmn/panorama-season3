"use client";

import { CDN_BASE_URL, SITE_URL } from "@/lib/constants";
import { SectionHead } from "./SeasonDetails";
import { STRIP } from "./HeroPanorama";

/** Panorama's seasons as a game's chapter select: two played, this one open. */
const CHAPTERS = [
	{
		season: "Season 1",
		range: "#1 to #90",
		title: "Myth",
		by: "Yigit Duman",
		status: "complete",
		image: `${CDN_BASE_URL}/optimized_updated_2026-07-01.webp`,
		href: `${SITE_URL}/canvas?id=70`,
	},
	{
		season: "Season 2",
		range: "#91 to #180",
		title: "Anthology of Mankind",
		by: "with DeltaSauce",
		status: "ends Oct 19",
		image: `${CDN_BASE_URL}/season2/header/1.webp`,
		href: `${SITE_URL}/canvas`,
	},
] as const;

/** The seven moods, from the price change over each day's 24 hours. */
const MOODS: { name: string; key: string; range: string }[] = [
	{ name: "Extreme Bliss", key: "extreme-bliss", range: "over +10%" },
	{ name: "High Bliss", key: "high-bliss", range: "+3 to +10%" },
	{ name: "Mild Joy", key: "mild-joy", range: "+1 to +3%" },
	{ name: "Equilibrium", key: "equilibrium", range: "within 1%" },
	{ name: "Mild Suffering", key: "mild-suffering", range: "-1 to -3%" },
	{ name: "Deep Suffering", key: "deep-suffering", range: "-3 to -10%" },
	{ name: "Extreme Anguish", key: "extreme-anguish", range: "under -10%" },
];

function ChapterImage({ src }: { src: string }) {
	return (
		<div className="relative aspect-[16/9] overflow-hidden border-b border-[var(--panel-edge)]">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
		</div>
	);
}

export function WorkChapters() {
	return (
		<section id="work" className="scroll-mt-4">
			<SectionHead title="the work" zone="interface" />
			<p className="font-sans text-[16px] text-muted leading-relaxed max-w-[64ch] mb-8">
				Panorama generates one tableau a day for 365 days, each joined to the one before it, so
				the year reads as a single panorama. The price of $PANO over the day sets its mood. Season 3
				picks up where Season 2 ends: day 181 joins the right edge of day 180.
			</p>

			<ol className="grid gap-3 grid-cols-2 lg:grid-cols-3">
				{CHAPTERS.map((c) => (
					<li key={c.season}>
						<a
							href={c.href}
							target="_blank"
							rel="noreferrer"
							className="game-panel flex flex-col h-full hover:border-[var(--sky-pink)] transition-colors"
						>
							<ChapterImage src={c.image} />
							<div className="flex flex-col gap-1 p-3">
								<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
									{c.season} / {c.range}
								</span>
								<span className="font-sans font-semibold text-[15px] text-foreground leading-snug">{c.title}</span>
								<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
									{c.by} / {c.status}
								</span>
							</div>
						</a>
					</li>
				))}
				<li className="col-span-2 lg:col-span-1">
					<a
						href="#route"
						onClick={(e) => {
							e.preventDefault();
							const el = document.getElementById("route");
							if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: "smooth" });
						}}
						className="game-panel flex flex-col h-full border-laser/70 shadow-[0_0_24px_rgba(255,31,31,0.25)]"
					>
						<ChapterImage src={STRIP[2]} />
						<div className="flex flex-col gap-1 p-3">
							<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-laser">
								Season 3 / #181 to #210
							</span>
							<span className="game-logo text-[19px] leading-[1.05]">Nothing Remains the Same</span>
							<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-foreground">
								with Pale Kirill / bidding
							</span>
						</div>
					</a>
				</li>
			</ol>

			<div className="mt-8 game-panel p-4 md:p-5">
				<div className="flex flex-col gap-1.5 mb-4">
					<span className="game-menu text-[19px] leading-tight">the market sets the mood</span>
					<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
						Set by the $PANO price change in the 24 hours before each day
					</span>
				</div>
				<ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
					{MOODS.map((m, i) => (
						<li
							key={m.key}
							// the seventh closes the row: full width on two columns, double on four
							className={`game-slot px-2.5 py-2 flex flex-col gap-1.5 ${i === MOODS.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
						>
							<span aria-hidden className="h-1.5 w-full" style={{ background: `var(--mood-${m.key})` }} />
							<span className="font-sans font-semibold text-[12px] text-foreground leading-tight">{m.name}</span>
							<span className="font-mono text-[10px] tabular-nums text-faint">{m.range}</span>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
