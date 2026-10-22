import AuctionPage from "./AuctionPage";
import { readSeason3Tableaus } from "@/lib/season3Tableaus";

// The title screen's tableaus come from the CDN index, read here so their images are in the
// first HTML instead of waiting on a browser fetch. Re-read at most every five minutes.
export const revalidate = 300;

export default async function Page() {
	const heroTableaus = await readSeason3Tableaus();
	return <AuctionPage heroTableaus={heroTableaus} />;
}
