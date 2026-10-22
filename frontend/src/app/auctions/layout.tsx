import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Open for bids / Panorama Season 3",
	description:
		"Eight days of Panorama Season 3, Nothing Remains the Same by Yigit Duman and Pale Kirill, each on its own auction on Manifold.",
	alternates: { canonical: "/auctions" },
};

export default function AuctionsLayout({ children }: { children: React.ReactNode }) {
	return children;
}
