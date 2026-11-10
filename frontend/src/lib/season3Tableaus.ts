// The Season 3 tableaus published so far, from the CDN's metadata index. Read on the server for
// the first paint (so the title screen's images are in the HTML) and again in the browser.

import { CDN_BASE_URL } from "./constants";
import { SEASON_3_FIRST_TOKEN, SEASON_3_LAST_TOKEN } from "./season3Zones";

/** One published Season 3 tableau, as the title screen draws it. */
export interface Season3Tableau {
	tokenId: number;
	date: string;
	src: string;
}

interface IndexEntry {
	date: string;
	timestamp: number;
}

export const METADATA_INDEX_URL = `${CDN_BASE_URL}/metadata.json`;

/**
 * Token = position in time order, as on the main site. Every day but the newest is the copy the
 * next day joined on its right ("optimized_updated"), so the days read as one panorama; the
 * newest is as revealed.
 */
export function season3TableausFromIndex(index: { images?: IndexEntry[] }): Season3Tableau[] {
	const entries = [...(index.images ?? [])].sort((a, b) => a.timestamp - b.timestamp);
	const season = entries
		.slice(SEASON_3_FIRST_TOKEN - 1, SEASON_3_LAST_TOKEN)
		.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
	const joinedOnRight = (i: number) => SEASON_3_FIRST_TOKEN + i < entries.length;
	return season.map((e, i) => ({
		tokenId: SEASON_3_FIRST_TOKEN + i,
		date: e.date,
		src: `${CDN_BASE_URL}/optimized_${joinedOnRight(i) ? "updated_" : ""}${e.date}.webp`,
	}));
}

/** Server read for the first paint; null when the index cannot be read in time. */
export async function readSeason3Tableaus(): Promise<Season3Tableau[] | null> {
	try {
		const res = await fetch(METADATA_INDEX_URL, {
			next: { revalidate: 300 },
			signal: AbortSignal.timeout(4_000),
		});
		if (!res.ok) return null;
		return season3TableausFromIndex(await res.json());
	} catch {
		return null;
	}
}
