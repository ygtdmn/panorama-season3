// Season 3, "Nothing Remains the Same" (tokens #181-#210): thirty days in six zones of five
// days each. The panorama travels from a city read as a system back to land that has not
// formed yet. Zone wording follows Pale Kirill's day generator
// (panorama-s3-demo-studio/src/lib/generator/engine.js, ZONES); the thirty daily themes are his.

export const SEASON_3_FIRST_TOKEN = 181;
export const SEASON_3_LAST_TOKEN = 210;
export const SEASON_3_DAYS = SEASON_3_LAST_TOKEN - SEASON_3_FIRST_TOKEN + 1; // 30
export const DAYS_PER_ZONE = 5;

/** Pale Kirill broke the ever-changing home into five things per zone, one per day, always in
 *  this order: day 1 of a zone is its figure, day 5 its feeling. */
export const DAY_KINDS = ["figure", "place", "event", "object", "feeling"] as const;
export type DayKind = (typeof DAY_KINDS)[number];

export interface Season3Zone {
	id: "interface" | "city" | "suburb" | "village" | "nature" | "abstract";
	name: string;
	/** First on-chain token id in the zone. */
	firstToken: number;
	/** Last on-chain token id in the zone. */
	lastToken: number;
	/** One line on what the zone looks like. */
	description: string;
	/** The zone's five daily themes, in DAY_KINDS order (Pale Kirill). */
	themes: readonly [string, string, string, string, string];
}

const ZONE_DEFS: Omit<Season3Zone, "firstToken" | "lastToken">[] = [
	{
		id: "interface",
		themes: ["creator", "home", "internal error", "blueprint", "passion"],
		name: "Interface",
		description: "The city read as a system. Interface laid over solid architecture.",
	},
	{
		id: "city",
		themes: ["architect", "river", "loading", "hoop", "nostalgia"],
		name: "City",
		description: "Continuous city fabric. Streets and blocks.",
	},
	{
		id: "suburb",
		themes: ["knight", "castle", "strategy", "sword", "hope"],
		name: "Suburb",
		description: "The low edge of the city. Loose low-rise buildings and a lot of sky.",
	},
	{
		id: "village",
		themes: ["lamb", "garden", "childhood", "flowers", "silence"],
		name: "Village",
		description: "Sparse rural settlement. Wooden architecture and open land.",
	},
	{
		id: "nature",
		themes: ["angel", "hut", "searching", "monument", "faith"],
		name: "Nature",
		description: "Wild landscape before the city. Almost no buildings.",
	},
	{
		id: "abstract",
		themes: ["soul", "basketball court", "death", "family tree", "love"],
		name: "Abstract",
		description: "Land still forming. Heavy unnamed masses, the world dissolving like a scene unloading.",
	},
];

export const SEASON_3_ZONES: Season3Zone[] = ZONE_DEFS.map((zone, i) => ({
	...zone,
	firstToken: SEASON_3_FIRST_TOKEN + i * DAYS_PER_ZONE,
	lastToken: SEASON_3_FIRST_TOKEN + (i + 1) * DAYS_PER_ZONE - 1,
}));

/** Day of the season (1-30) for a token id, or null outside #181-#210. */
export function seasonDayForToken(token: number): number | null {
	if (!Number.isInteger(token) || token < SEASON_3_FIRST_TOKEN || token > SEASON_3_LAST_TOKEN) {
		return null;
	}
	return token - SEASON_3_FIRST_TOKEN + 1;
}

/** Token id for a day of the season (1-30), or null outside it. */
export function tokenForSeasonDay(day: number): number | null {
	if (!Number.isInteger(day) || day < 1 || day > SEASON_3_DAYS) return null;
	return SEASON_3_FIRST_TOKEN + day - 1;
}

/** The zone a token belongs to, or undefined outside #181-#210. */
export function zoneForToken(token: number): Season3Zone | undefined {
	const day = seasonDayForToken(token);
	if (day === null) return undefined;
	return SEASON_3_ZONES[Math.floor((day - 1) / DAYS_PER_ZONE)];
}

/** The day's theme ("creator" for #181) and what kind of thing it is ("figure"). */
export function themeForToken(token: number): { theme: string; kind: DayKind } | undefined {
	const day = seasonDayForToken(token);
	const zone = zoneForToken(token);
	if (day === null || !zone) return undefined;
	const i = (day - 1) % DAYS_PER_ZONE;
	return { theme: zone.themes[i], kind: DAY_KINDS[i] };
}

/** "Day 1, creator" for #181; undefined outside the season. */
export function dayLabelForToken(token: number): string | undefined {
	const day = seasonDayForToken(token);
	const t = themeForToken(token);
	if (day === null || !t) return undefined;
	return `Day ${day}, ${t.theme}`;
}
