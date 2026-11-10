import type { Metadata } from "next";
// Self-hosted faces: vinext would load next/font/google from Google's CDN at runtime, which the
// CSP's font-src 'self' blocks. The --font-* variables they feed are set in globals.css.
// Two layers of type. Panorama's own: Hanken Grotesk for text and JetBrains Mono for labels,
// as on every Panorama site. Kirill's game layer: Jacquard 24, a pixel blackletter, for the
// season title, and bold italic Arial (a system font) for menu words. IBM Plex Mono is the bid
// console's labels and figures (globals.css re-points --font-mono inside .sale-console), and
// Newsreader is a book serif for Pale Kirill's statement only, so it reads as printed wall text.
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/jacquard-24/latin-400.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./globals.css";
import { Providers } from "./providers";
import { themeInitScript } from "@/lib/themeScript";
import { railMaxInitScript } from "@/lib/railMax";
import { AUCTION_SITE_URL, OG_IMAGE_ALT, OG_IMAGE_URL } from "@/lib/constants";

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
		<html lang="en" className="dark h-full" suppressHydrationWarning>
			<body className="antialiased h-full font-sans bg-background text-foreground">
				<script dangerouslySetInnerHTML={{ __html: themeInitScript + railMaxInitScript }} />
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
