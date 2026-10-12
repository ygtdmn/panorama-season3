"use client";

import { useEffect, useRef } from "react";

// The season's own strip, travelling through the title screen from Interface to Abstract.
// These are studio generations kept with the app (public/season3/strip); swap in the final
// header images when the season starts.
export const STRIP = Array.from({ length: 17 }, (_, i) => `/season3/strip/${String(i).padStart(2, "0")}.webp`);

const LINKS: { label: string; href: string }[] = [
	{ label: "The work", href: "#work" },
	{ label: "The route", href: "#route" },
	{ label: "Signals", href: "#signals" },
	{ label: "Questions", href: "#questions" },
];

/** Drift speed when nobody is steering, in px per second. */
const AUTO_SPEED = 22;
/** How long the strip waits after a drag, wheel or key before it drifts again. */
const RESUME_AFTER_MS = 2600;

function go(href: string) {
	const el = document.querySelector(href);
	if (!el) return;
	window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: "smooth" });
}

/**
 * The strip's motion: it drifts on its own, and a drag (mouse or touch), a sideways wheel or
 * trackpad swipe, or the arrow keys take over. A release keeps its momentum, then the drift
 * eases back in. The strip is rendered twice so the travel loops without a seam.
 */
function useSteerableDrift(
	viewportRef: React.RefObject<HTMLDivElement | null>,
	trackRef: React.RefObject<HTMLDivElement | null>,
) {
	useEffect(() => {
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) return;

		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let offset = 0;
		let velocity = reduced ? 0 : AUTO_SPEED; // px/s; positive travels on along the route
		let resumeAt = 0;
		let loopWidth = track.scrollWidth / 2;
		let last = performance.now();
		let raf = 0;

		const drag = { active: false, intent: false, startX: 0, startY: 0, startOffset: 0, lastX: 0, lastT: 0, v: 0, id: -1 };

		const wrap = (x: number) => (loopWidth > 0 ? ((x % loopWidth) + loopWidth) % loopWidth : x);
		const paint = () => {
			track.style.transform = `translate3d(${-offset}px,0,0)`;
		};
		const measure = () => {
			loopWidth = track.scrollWidth / 2;
			offset = wrap(offset);
		};

		const tick = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			if (!drag.active) {
				if (now < resumeAt || reduced) {
					velocity *= Math.pow(0.04, dt); // momentum after a release, fading out
				} else {
					velocity += (AUTO_SPEED - velocity) * Math.min(1, dt * 1.5);
				}
				offset = wrap(offset + velocity * dt);
				paint();
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		const ro = new ResizeObserver(measure);
		ro.observe(track);
		const imgs = Array.from(track.querySelectorAll("img"));
		imgs.forEach((img) => img.addEventListener("load", measure));

		const onDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement).closest("a,button")) return;
			if (e.pointerType === "mouse" && e.button !== 0) return;
			drag.active = true;
			drag.intent = false;
			drag.startX = drag.lastX = e.clientX;
			drag.startY = e.clientY;
			drag.startOffset = offset;
			drag.lastT = performance.now();
			drag.v = 0;
			drag.id = e.pointerId;
		};
		const onMove = (e: PointerEvent) => {
			if (!drag.active || e.pointerId !== drag.id) return;
			const dx = e.clientX - drag.startX;
			const dy = e.clientY - drag.startY;
			if (!drag.intent) {
				if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
					drag.active = false; // vertical intent: the page scrolls
					return;
				}
				if (Math.abs(dx) < 6) return;
				drag.intent = true;
				viewport.setPointerCapture?.(e.pointerId);
				viewport.dataset.dragging = "1";
			}
			const now = performance.now();
			const ddt = Math.max(1, now - drag.lastT) / 1000;
			drag.v = 0.8 * (-(e.clientX - drag.lastX) / ddt) + 0.2 * drag.v;
			drag.lastX = e.clientX;
			drag.lastT = now;
			offset = wrap(drag.startOffset - dx);
			paint();
		};
		const onUp = (e: PointerEvent) => {
			if (!drag.active || e.pointerId !== drag.id) return;
			drag.active = false;
			delete viewport.dataset.dragging;
			if (drag.intent) {
				viewport.releasePointerCapture?.(e.pointerId);
				velocity = Math.max(-2400, Math.min(2400, drag.v));
				resumeAt = performance.now() + RESUME_AFTER_MS;
			}
		};
		const onWheel = (e: WheelEvent) => {
			// Only sideways gestures steer the strip; vertical scrolling stays with the page.
			if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
			e.preventDefault();
			offset = wrap(offset + e.deltaX);
			velocity = 0;
			resumeAt = performance.now() + RESUME_AFTER_MS;
			paint();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.target !== viewport || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
			e.preventDefault();
			velocity = e.key === "ArrowRight" ? 900 : -900;
			resumeAt = performance.now() + RESUME_AFTER_MS;
		};

		viewport.addEventListener("pointerdown", onDown);
		viewport.addEventListener("pointermove", onMove);
		viewport.addEventListener("pointerup", onUp);
		viewport.addEventListener("pointercancel", onUp);
		viewport.addEventListener("wheel", onWheel, { passive: false });
		viewport.addEventListener("keydown", onKey);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			imgs.forEach((img) => img.removeEventListener("load", measure));
			viewport.removeEventListener("pointerdown", onDown);
			viewport.removeEventListener("pointermove", onMove);
			viewport.removeEventListener("pointerup", onUp);
			viewport.removeEventListener("pointercancel", onUp);
			viewport.removeEventListener("wheel", onWheel);
			viewport.removeEventListener("keydown", onKey);
		};
	}, [viewportRef, trackRef]);
}

/**
 * The title screen: a framed screen with the season's strip travelling behind Panorama's
 * wordmark and the season title. The strip drifts on its own and can be steered.
 */
export function HeroScreen({
	topRight,
}: {
	/** Pinned to the screen's top-right corner (the Enter Panorama button). */
	topRight?: React.ReactNode;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	useSteerableDrift(viewportRef, trackRef);

	return (
		<div
			ref={viewportRef}
			tabIndex={0}
			aria-label="Season 3 panorama. Drag, swipe sideways or use the arrow keys to travel along it."
			className="relative w-full h-full overflow-hidden bg-screen-blue select-none touch-pan-y cursor-grab data-[dragging]:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-sky-pink"
		>
			<div aria-hidden className="absolute inset-0">
				<div ref={trackRef} className="flex h-full w-max will-change-transform">
					{[...STRIP, ...STRIP].map((src, i) => (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							key={i}
							src={src}
							alt=""
							draggable={false}
							loading={i < 3 ? "eager" : "lazy"}
							className="h-full w-auto max-w-none block pointer-events-none"
						/>
					))}
				</div>
			</div>
			{/* darken the left side so the title reads on any picture */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,20,0.72),rgba(4,4,20,0.25)_45%,transparent_72%)]"
			/>

			<div className="relative h-full flex flex-col justify-between p-4 md:p-5 pointer-events-none">
				<div className="flex justify-end">{topRight}</div>

				<div className="flex flex-col gap-7 md:gap-9 px-2 md:px-6">
					<div className="flex flex-col gap-4 md:gap-5">
						{/* Panorama's wordmark over the season title: the series, then the season */}
						<div className="flex items-baseline gap-3 font-mono uppercase text-white [text-shadow:1px_1px_0_rgba(0,0,0,0.7)]">
							<span className="font-bold tracking-[0.32em] text-[clamp(1rem,0.8rem+0.8vw,1.5rem)]">Panorama</span>
							<span className="tracking-[0.24em] text-[clamp(0.7rem,0.6rem+0.3vw,0.9rem)] text-white/80">Season 3</span>
						</div>
						<h1 className="game-logo leading-[0.88] text-[clamp(3rem,1.2rem+5.6vw,7rem)]">
							<span className="sr-only">Panorama Season 3: </span>
							Nothing Remains
							<br />
							the Same
						</h1>
						<p className="max-w-[46ch] font-sans text-[clamp(0.95rem,0.9rem+0.25vw,1.1rem)] leading-relaxed text-white/90 [text-shadow:1px_1px_0_rgba(0,0,0,0.7)]">
							Panorama is one continuous artwork, a tableau a day, its mood set by the price
							of $PANO. Season 3 is thirty days with Pale Kirill, out of the city and into land
							still forming.
						</p>
					</div>

					<nav aria-label="Sections" className="pointer-events-auto self-start flex flex-wrap items-center gap-x-5 gap-y-3">
						<a
							href="#sale"
							onClick={(e) => {
								e.preventDefault();
								go("#sale");
							}}
							className="game-btn text-[15px] px-7 py-2.5"
						>
							bid
						</a>
						{LINKS.map((m) => (
							<a
								key={m.href}
								href={m.href}
								onClick={(e) => {
									e.preventDefault();
									go(m.href);
								}}
								className="bracket-link game-caption !text-[11px] hover:!opacity-100 hover:!text-sky-pink"
							>
								{m.label}
							</a>
						))}
					</nav>
				</div>

				{/* balances the top row so the title block sits just below centre */}
				<div aria-hidden className="h-8" />
			</div>
		</div>
	);
}
