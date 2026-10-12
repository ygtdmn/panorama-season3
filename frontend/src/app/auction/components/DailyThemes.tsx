"use client";

import { DAY_KINDS, DAYS_PER_ZONE, SEASON_3_FIRST_TOKEN, SEASON_3_ZONES } from "@/lib/season3Zones";
import { Kirill, SectionHead } from "./SeasonDetails";

/**
 * Pale Kirill's table of the season: six zones down, five kinds of thing across, one theme per
 * day. Read across a row for a zone's five days; read down a column to watch one thing change
 * along the route.
 */
export function DailyThemes() {
	return (
		<section id="themes" className="scroll-mt-4">
			<SectionHead title="the themes" zone="city" />
			<div className="flex flex-col gap-4 font-sans text-[16px] text-muted leading-relaxed max-w-[64ch] mb-8">
				<p>
					<Kirill /> built the season around one idea: a home that never stays the same. In every zone
					that home is told through five things, one a day: a figure who lives in it, a place, an event,
					an object, and a feeling.
				</p>
				<p>
					Read a row to walk through one zone in five days. Read a column to watch one thing change along
					the route: the creator of the interface becomes an architect in the city, a knight in the suburb,
					a lamb in the village, an angel in nature, and a soul where the land is still forming.
				</p>
				<p>
					Each theme is where a day starts. The market still sets its mood, and a signal from whoever holds
					the day can add one more voice.
				</p>
			</div>

			{/* Wide screens: the table as Kirill drew it */}
			<div className="hidden md:block game-panel overflow-hidden">
				<table className="w-full table-fixed border-collapse">
					<thead>
						<tr>
							<th className="w-[16%]" />
							{DAY_KINDS.map((kind, k) => (
								<th
									key={kind}
									scope="col"
									className={`px-4 pt-5 pb-3 text-left font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-sky-pink ${
										k % 2 === 0 ? "bg-white/[0.035]" : ""
									}`}
								>
									{kind}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{SEASON_3_ZONES.map((zone, z) => (
							<tr key={zone.id} className="border-t border-dotted border-[var(--panel-edge)]">
								<th scope="row" className="px-4 py-3.5 text-left align-baseline">
									<span className="game-menu text-[17px]" style={{ color: `var(--z-${zone.id})` }}>
										{zone.name.toLowerCase()}
									</span>
								</th>
								{zone.themes.map((theme, k) => {
									const day = z * DAYS_PER_ZONE + k + 1;
									return (
										<td
											key={theme}
											className={`px-4 py-3.5 align-baseline ${k % 2 === 0 ? "bg-white/[0.035]" : ""}`}
											title={`Day ${day}, token #${SEASON_3_FIRST_TOKEN + day - 1}`}
										>
											<span className="font-mono text-[11px] tabular-nums text-faint mr-2">{day}</span>
											<span className="font-sans text-[15px] text-foreground">{theme}</span>
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Phones: one block per zone, its five days in order */}
			<ol className="md:hidden flex flex-col gap-3">
				{SEASON_3_ZONES.map((zone, z) => (
					<li key={zone.id} className="game-panel px-4 py-3.5">
						<span className="game-menu text-[17px]" style={{ color: `var(--z-${zone.id})` }}>
							{zone.name.toLowerCase()}
						</span>
						<dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
							{zone.themes.map((theme, k) => (
								<div key={theme} className="contents">
									<dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-pink self-baseline">
										{DAY_KINDS[k]}
									</dt>
									<dd className="font-sans text-[15px] text-foreground">
										<span className="font-mono text-[11px] tabular-nums text-faint mr-2">
											{z * DAYS_PER_ZONE + k + 1}
										</span>
										{theme}
									</dd>
								</div>
							))}
						</dl>
					</li>
				))}
			</ol>
		</section>
	);
}
