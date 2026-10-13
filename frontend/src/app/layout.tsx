import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono, Jacquard_24, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeInitScript } from "@/lib/themeScript";
import { railMaxInitScript } from "@/lib/railMax";
import { AUCTION_SITE_URL, OG_IMAGE_ALT, OG_IMAGE_URL } from "@/lib/constants";

// Two layers of type. Panorama's own: Hanken Grotesk for text and JetBrains Mono for labels,
// as on every Panorama site. Kirill's game layer: Jacquard 24, a pixel blackletter, for the
// season title, and bold italic Arial (a system font) for menu words.
const hanken = Hanken_Grotesk({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-hanken",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "700"],
	display: "swap",
	variable: "--font-jetbrains-mono",
});

// The bid console's labels and figures (globals.css re-points --font-mono inside .sale-console).
const plexMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	display: "swap",
	variable: "--font-plex-mono",
});

const jacquard = Jacquard_24({
	subsets: ["latin"],
	weight: "400",
	display: "swap",
	variable: "--font-jacquard",
});

// A book serif for Pale Kirill's statement only, so it reads as printed wall text.
const newsreader = Newsreader({
	subsets: ["latin"],
	style: ["normal", "italic"],
	axes: ["opsz"],
	display: "swap",
	variable: "--font-newsreader",
});

const TITLE = "Panorama Season 3: Nothing Remains the Same";
const description =
	"Thirty days through six zones, from interface to abstract. Panorama Season 3 by Yigit Duman and Pale Kirill. Auction opens Oct 19, 17:00 UTC.";

export const metadata: Metadata = {
	metadataBase: new URL(AUCTION_SITE_URL),
	title: TITLE,
	description,
	icons: {
		icon: [{ url: "/favicon.png" }],
		shortcut: "/favicon.png",
		apple: "/favicon.png",
	},
	alternates: { canonical: "/" },
	authors: [{ name: "Yigit Duman" }, { name: "Pale Kirill" }],
	robots: "index, follow",
	openGraph: {
		title: TITLE,
		description,
		type: "website",
		url: AUCTION_SITE_URL,
		siteName: "Panorama",
		locale: "en_US",
		images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: OG_IMAGE_ALT, type: "image/jpeg" }],
	},
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description,
		creator: "@yigitduman",
		images: [{ url: OG_IMAGE_URL, alt: OG_IMAGE_ALT }],
	},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${hanken.variable} ${jetbrainsMono.variable} ${plexMono.variable} ${jacquard.variable} ${newsreader.variable} dark h-full`} suppressHydrationWarning>
			<body className="antialiased h-full font-sans bg-background text-foreground">
				<script dangerouslySetInnerHTML={{ __html: themeInitScript + railMaxInitScript }} />
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
