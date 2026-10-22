"use client";

import { useEffect, useState } from "react";
import { METADATA_INDEX_URL, season3TableausFromIndex, type Season3Tableau } from "@/lib/season3Tableaus";

export type { Season3Tableau };

/** A new day publishes at 16:00 UTC; reading the index this often picks it up the same hour. */
const REFRESH_MS = 10 * 60_000;

/**
 * The Season 3 tableaus published so far. Starts from the server's read (so the first paint
 * already has them), then re-reads the CDN index every few minutes. null until the first read
 * when the server had none, [] when that read failed.
 */
export function useSeason3Tableaus(initial: Season3Tableau[] | null = null): Season3Tableau[] | null {
	const [tableaus, setTableaus] = useState<Season3Tableau[] | null>(initial);

	useEffect(() => {
		let cancelled = false;
		const read = async () => {
			try {
				const res = await fetch(`${METADATA_INDEX_URL}?t=${Math.floor(Date.now() / REFRESH_MS)}`);
				if (!res.ok) throw new Error(`index ${res.status}`);
				const next = season3TableausFromIndex(await res.json());
				if (!cancelled) {
					setTableaus((prev) =>
						prev && prev.length === next.length && prev.every((p, i) => p.src === next[i].src) ? prev : next,
					);
				}
			} catch {
				// Keep what is on screen; with nothing yet, the studio strip stands in.
				if (!cancelled) setTableaus((prev) => prev ?? []);
			}
		};
		if (!initial) void read();
		const id = setInterval(read, REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [initial]);

	return tableaus;
}
