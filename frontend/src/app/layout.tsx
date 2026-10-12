import type { Metadata } from "next";
import { Hanken_Grotesk, Jacquard_24, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeInitScript } from "@/lib/themeScript";
import { AUCTION_SITE_URL, OG_IMAGE_URL } from "@/lib/constants";

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

const jacquard = Jacquard_24({
	subsets: ["latin"],
	weight: "400",
	display: "swap",
	variable: "--font-jacquard",
});

const TITLE = "Panorama Season 3: Nothing Remains the Same";
const description =
	"Bid on Season 3 of Panorama, an autonomous generative artwork: thirty days through six zones, from interface to abstract. A collaboration between Yigit Duman and Pale Kirill.";

export const metadata: Metadata = {
	metadataBase: new URL(AUCTION_SITE_URL),
	title: TITLE,
	description,
	icons: {
		icon: [{ url: "/favicon.png" }],
		shortcut: "/favicon.png",
		apple: "/favicon.png",
	},
	authors: [{ name: "Yigit Duman" }, { name: "Pale Kirill" }],
	robots: "index, follow",
	openGraph: {
		title: TITLE,
		description,
		type: "website",
		url: AUCTION_SITE_URL,
		siteName: "Panorama",
		locale: "en_US",
		images: [{ url: OG_IMAGE_URL, width: 1920, height: 1080, alt: "Panorama Season 3", type: "image/webp" }],
	},
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description,
		creator: "@yigitduman",
		images: [OG_IMAGE_URL],
	},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${hanken.variable} ${jetbrainsMono.variable} ${jacquard.variable} dark h-full`} suppressHydrationWarning>
			<body className="antialiased h-full font-sans bg-background text-foreground">
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
