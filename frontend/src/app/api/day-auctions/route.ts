// The eight open days on their Manifold auctions: each listing's state and every bid, read from
// Manifold's marketplace contract.

import { NextResponse } from "next/server";
import { DayAuctionsUnavailableError, getDayAuctions } from "@/lib/dayAuctions.server";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		return NextResponse.json(await getDayAuctions(), {
			headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" },
		});
	} catch (err) {
		const unavailable = err instanceof DayAuctionsUnavailableError;
		if (!unavailable) console.error("[day-auctions] read failed", err);
		return NextResponse.json(
			{ error: unavailable ? err.message : "Could not read the auctions right now." },
			{ status: unavailable ? 501 : 503, headers: { "cache-control": "no-store" } },
		);
	}
}
