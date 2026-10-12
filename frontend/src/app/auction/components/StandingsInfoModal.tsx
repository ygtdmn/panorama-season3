"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LuX } from "react-icons/lu";
import { STRIP } from "./HeroPanorama";

const STEPS: { n: string; t: string; d: string }[] = [
	{
		n: "01",
		t: "The top thirty win",
		d: "Every bid is ranked from highest to lowest. The thirty highest are in; anything below the thirtieth is out. Once all thirty days are held, no two bids share an amount, so the order is always clear.",
	},
	{
		n: "02",
		t: "Everyone pays the same price",
		d: "At close, every winner pays the thirtieth-highest bid, called the clearing price, no matter what they bid. Anything above it is refunded when the sale settles.",
	},
	{
		n: "03",
		t: "Higher bids get earlier days",
		d: "Rank sets the day. The highest bid takes day #1, the first day of Interface (token #181); each rank down takes the next day, one tableau per day, through day #30 in Abstract (token #210).",
	},
	{
		n: "04",
		t: "Outbid means refunded at once",
		d: "The moment a higher bid pushes you below the top thirty, your ETH returns to your wallet. Nothing to claim, no waiting.",
	},
	{
		n: "05",
		t: "A marker means a signal",
		d: "A small envelope on a row means that bid carries a signal for its day. Hover, focus, or tap it to read. Signals never change rank.",
	},
];

/** Explains the board mechanics as a full page over the site. Escape or the close button dismiss it. */
export function StandingsInfoModal({ onClose }: { onClose: () => void }) {
	const panelRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const raf = window.requestAnimationFrame(() => closeRef.current?.focus());
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			window.cancelAnimationFrame(raf);
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onClose]);

	// Portalled to <body>: the standings sit inside a blurred panel, and a backdrop-filter
	// ancestor would otherwise trap this fixed full-page layer inside it.
	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="standings-info-heading"
			className="fixed inset-0 z-[200] bg-background overflow-y-auto overlay-scroll-content animate-[backdrop-fade-in_200ms_var(--ease-out)]"
		>
			{/* a darkened studio tile behind the page, as on the title screen */}
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={STRIP[15]} alt="" aria-hidden className="fixed inset-0 w-full h-full object-cover opacity-25 pointer-events-none" />
			<div aria-hidden className="fixed inset-0 bg-[linear-gradient(rgba(4,4,16,0.55),rgba(4,4,16,0.92))] pointer-events-none" />

			<div ref={panelRef} tabIndex={-1} className="relative mx-auto w-full max-w-[1180px] px-5 md:px-10 py-8 md:py-14 animate-modal-in outline-none">
				<div className="flex items-start justify-between gap-6 mb-10 md:mb-14">
					<div className="flex flex-col gap-3">
						<span className="font-mono text-[12px] uppercase tracking-[0.2em] text-foreground">
							<span className="font-bold">Panorama</span> <span className="text-muted">Season 3</span>
						</span>
						<h2 id="standings-info-heading" className="game-menu leading-none text-[clamp(2rem,1.4rem+2.4vw,3.6rem)]">
							how standings work
						</h2>
					</div>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="game-btn shrink-0 inline-flex items-center gap-2 text-[14px] px-4 py-2 cursor-pointer"
					>
						<LuX size={15} strokeWidth={2} aria-hidden /> close
					</button>
				</div>

				{/* five steps: three over two on wide screens, so both rows fill */}
				<ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
					{STEPS.map((s, i) => (
						<li
							key={s.n}
							className={`game-panel p-5 md:p-6 flex flex-col gap-2.5 ${
								i < 3 ? "lg:col-span-2" : "lg:col-span-3"
							} ${i === STEPS.length - 1 ? "sm:col-span-2" : ""}`}
						>
							<span className="font-mono text-[11px] tabular-nums text-laser font-bold">{s.n}</span>
							<h3 className="font-sans font-semibold text-lg text-foreground leading-snug">{s.t}</h3>
							<p className="font-sans text-[15px] text-muted leading-relaxed">{s.d}</p>
						</li>
					))}
				</ol>
			</div>
		</div>,
		document.body,
	);
}
