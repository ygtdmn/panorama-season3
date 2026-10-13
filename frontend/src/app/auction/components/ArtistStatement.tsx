"use client";

import { X_KIRILL } from "@/lib/constants";
import { SectionHead } from "./SeasonDetails";
import { STRIP } from "./HeroPanorama";

/**
 * Pale Kirill's statement for the season, set as printed wall text: a book serif (Newsreader)
 * with an italic closing line, signed in small caps. Over the izba in black flowers (frame 20), under a calm veil.
 */
export function ArtistStatement() {
	return (
		<section id="statement" className="scroll-mt-4">
			<SectionHead title="the statement" zone="city" />
			<div className="relative overflow-hidden border border-[var(--panel-edge)] shadow-[0_0_50px_rgba(43,43,255,0.14)]">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src={STRIP[20]}
					alt=""
					loading="lazy"
					className="absolute inset-0 w-full h-full object-cover object-right"
				/>
				<div
					aria-hidden
					className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,16,0.96),rgba(4,4,16,0.92)_50%,rgba(4,4,16,0.55)_82%,rgba(4,4,16,0.3))]"
				/>
				{/* phones put the text over the flowers, so they get a darker veil */}
				<div aria-hidden className="absolute inset-0 bg-[rgba(4,4,16,0.7)] md:hidden" />

				<article className="relative px-6 py-10 md:px-14 md:py-16 max-w-[44rem] font-statement text-foreground/90 [font-optical-sizing:auto]">
					<div className="flex flex-col gap-6 text-[clamp(1.05rem,0.98rem+0.35vw,1.28rem)] leading-[1.65]">
						<p>
							From series to series I return to the idea of home. Not only a house with walls and
							windows (though that is there too), but a meta-home: an ever-changing emotional system
							above all real places. A collection of rooms, streets, memories and feelings. The events
							that happen to us every day and reshape our lives.
						</p>
						<p>
							In this season that home becomes a panorama. One continuous canvas, 32,400 px wide. A
							home that goes beyond the walls and turns into a whole city. And into what lies beyond
							it.
						</p>
						<p>
							The panorama moves through six zones: Interface → City → Suburb → Village → Nature →
							Abstract. From outer control visuals to the depths and the core. Across 30 days, each
							work follows one simple theme: a figure, a place, an event, an object, or a feeling.
							Every day the home changes and grows a little more.
						</p>
					</div>

					<p className="mt-10 md:mt-12 italic text-foreground text-[clamp(1.3rem,1.1rem+0.8vw,1.75rem)] leading-snug">
						Nothing remains the same. And still, it feels like home.
					</p>

					<a
						href={X_KIRILL}
						target="_blank"
						rel="noreferrer"
						className="mt-8 inline-block font-statement text-[1.05rem] tracking-[0.14em] [font-variant-caps:all-small-caps] text-foreground/70 hover:text-foreground transition-colors"
					>
						Pale Kirill
					</a>
				</article>
			</div>
		</section>
	);
}
