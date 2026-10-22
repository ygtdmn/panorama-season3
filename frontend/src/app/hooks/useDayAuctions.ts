"use client";

import { useEffect, useState } from "react";
import type { DayAuction, DayAuctionsPayload } from "@/lib/dayAuctions";
import type { ChainTimeAnchor } from "@/app/auction/components/ui";

// One poll shared by every mounted reader (the console, the route, the ledger, /auctions).

interface State {
	data: DayAuctionsPayload | null;
	/** The snapshot's block time and when it arrived, for useChainNow. */
	anchor: ChainTimeAnchor | undefined;
	loading: boolean;
	error: Error | null;
	/** The server said there are none to read on this chain (anvil, Sepolia). */
	unavailable: boolean;
}

const POLL_MS = 15_000;

let cache: State = { data: null, anchor: undefined, loading: false, error: null, unavailable: false };
const subscribers = new Set<(s: State) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: State): void {
	cache = next;
	for (const cb of subscribers) cb(next);
}

async function refresh(): Promise<void> {
	if (cache.unavailable) return;
	publish({ ...cache, loading: true });
	try {
		const res = await fetch("/api/day-auctions", { cache: "no-store" });
		if (res.status === 501) {
			publish({ ...cache, loading: false, unavailable: true });
			return;
		}
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as { error?: string } | null;
			throw new Error(body?.error || `Auctions endpoint returned ${res.status}`);
		}
		const data = (await res.json()) as DayAuctionsPayload;
		publish({
			data,
			anchor: { timestamp: data.snapshot.timestamp, atMs: Date.now() },
			loading: false,
			error: null,
			unavailable: false,
		});
	} catch (err) {
		// Keep the last good read on screen: a stale bid beats an empty board.
		publish({ ...cache, loading: false, error: err as Error });
	}
}

export function useDayAuctions(): State {
	const [state, setState] = useState<State>(cache);

	useEffect(() => {
		subscribers.add(setState);
		if (subscribers.size === 1) {
			void refresh();
			timer = setInterval(() => {
				if (document.visibilityState === "visible") void refresh();
			}, POLL_MS);
		}
		return () => {
			subscribers.delete(setState);
			if (subscribers.size === 0 && timer) {
				clearInterval(timer);
				timer = null;
			}
		};
	}, []);

	return state;
}

export function retryDayAuctions(): Promise<void> {
	return refresh();
}

/** The open days by token, for the route board and the ledger. */
export function auctionsByToken(data: DayAuctionsPayload | null): Map<number, DayAuction> {
	return new Map((data?.auctions ?? []).map((a) => [a.tokenId, a]));
}
