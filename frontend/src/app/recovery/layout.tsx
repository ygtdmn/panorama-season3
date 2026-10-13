import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Recovery / Panorama Season 3 auction",
	description:
		"Every path to your ETH works without the team. Self-serve settlement and refunds for the Panorama Season 3 auction.",
	alternates: { canonical: "/recovery" },
};

export default function RecoveryLayout({ children }: { children: React.ReactNode }) {
	return children;
}
