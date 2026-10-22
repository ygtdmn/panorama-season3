"use client";

import Link from "next/link";
import { LuPlus } from "react-icons/lu";
import {
	getEvmNowUrl,
	GITHUB_URL,
	OPENSEA_COLLECTION_URL,
	PANORAMA_AUCTION_ADDRESS,
	SEASON_2_AUDIT_REPORT_URL,
	SITE_URL,
	X_KIRILL,
	X_YIGIT,
} from "@/lib/constants";
import { SEASON_3_ZONES } from "@/lib/season3Zones";
import { MAX_SIGNAL_BYTES } from "@/lib/signal";
import { STRIP } from "./HeroPanorama";

const TERMINAL_URL = `${SITE_URL}/terminal`;

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2 hover:opacity-60 transition-opacity">
			{children}
		</a>
	);
}

export function Yigit() {
	return <Ext href={X_YIGIT}>Yigit Duman</Ext>;
}
export function Kirill() {
	return <Ext href={X_KIRILL}>Pale Kirill</Ext>;
}

/** Section heading: a bold italic menu word, as on the title screen, with a zone-coloured mark. */
export function SectionHead({
	title,
	zone,
	aside,
}: {
	index?: string;
	title: string;
	zone: (typeof SEASON_3_ZONES)[number]["id"];
	aside?: React.ReactNode;
}) {
	return (
		<div className="flex items-end justify-between gap-4 pb-3 mb-6 border-b border-[var(--panel-edge)]">
			<div className="flex items-center gap-3">
				<span aria-hidden className="w-3 h-3 rotate-45" style={{ background: `var(--z-${zone})` }} />
				<h2 className="game-menu leading-none text-[clamp(1.6rem,1.2rem+1.2vw,2.4rem)]">{title}</h2>
			</div>
			{aside}
		</div>
	);
}

/** A framed game screen with one of the season's tiles behind its content. */
function Screen({ image, children }: { image: string; children: React.ReactNode }) {
	return (
		<div className="relative overflow-hidden border border-[var(--panel-edge)] shadow-[0_0_50px_rgba(43,43,255,0.14)]">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={image} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
			<div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,20,0.82),rgba(4,4,20,0.45)_55%,rgba(4,4,20,0.2))]" />
			<div className="relative p-5 md:p-8">{children}</div>
		</div>
	);
}

/** The signal, said once and plainly: the one new thing about this sale. */
function SignalsExplainer({ settled }: { settled: boolean }) {
	const points = settled ? [
		{ n: "01", t: "One per day", d: `A word, a wish, a place, a memory, or a signal to anyone at all. Up to ${MAX_SIGNAL_BYTES} characters. A day keeps the first signal written for it, as written.` },
		{ n: "02", t: "The holder writes it", d: "Whoever holds the day, or a wallet they delegate to, can add it at any time. Connect a wallet that holds a day to write one here." },
		{ n: "03", t: "The artists read it", d: "When that day is made, Yigit and Pale Kirill read its signal and decide whether to use it." },
	] : [
		{ n: "01", t: "Write it now or later", d: `A word, a wish, a place, a memory, or a signal to anyone at all. Up to ${MAX_SIGNAL_BYTES} characters, optional. Send it with your bid or add it any time later, even after the sale. Once written, it stays as written.` },
		{ n: "02", t: "It lands on your day", d: "Your bid's rank decides your day. The signal travels with the bid to the day it wins. If the winning bid carried none, whoever holds the day can add one." },
		{ n: "03", t: "The artists read it", d: "When that day is made, Yigit and Pale Kirill read its signal and decide whether to use it." },
	];
	return (
		<section id="signals" className="scroll-mt-4">
			<SectionHead title="signals" zone="city" />
			<Screen image={STRIP[10]}>
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-5">
					<p className="game-logo leading-[0.95] text-[clamp(2.2rem,1.4rem+2.4vw,3.8rem)] max-w-[24ch]">
						A frequency for a day not yet made.
					</p>
					<p className="font-sans text-[17px] text-foreground/90 leading-relaxed max-w-[56ch] [text-shadow:1px_1px_0_rgba(0,0,0,0.6)]">
						{settled ? (
							<>
								Every day can carry a signal from the person who holds it. The market still sets each
								day&apos;s mood. A signal adds one more input. It is public, and once written it is permanent.
							</>
						) : (
							<>
								Every bid can carry a signal. The market still sets each day&apos;s mood. A signal adds one more
								input, from the person who will own the day. It never changes price or rank. It is public, and
								once written it is permanent.
							</>
						)}
					</p>
				</div>
				<ol className="grid gap-3 sm:grid-cols-3">
					{points.map((p) => (
						<li key={p.n} className="game-panel p-5 flex flex-col gap-2">
							<span className="font-mono text-[11px] tabular-nums text-laser font-bold">{p.n}</span>
							<h3 className="font-sans font-semibold text-[17px] text-foreground leading-snug">{p.t}</h3>
							<p className="font-sans text-sm text-muted leading-relaxed">{p.d}</p>
						</li>
					))}
				</ol>
			</div>
			</Screen>
		</section>
	);
}

function SaleSteps({ incrementPct }: { incrementPct: number }) {
	const steps = [
		{ n: "01", t: "Bid your maximum", d: "Enter the most you would pay. Hold up to two bids and raise either at any time." },
		{ n: "02", t: "The top thirty stay", d: `A new bid must beat the lowest of the thirty by ${incrementPct}%, at an amount nobody else holds. The bid it pushes out is refunded in the same transaction.` },
		{ n: "03", t: "Everyone pays the floor", d: "At close, every winner pays the thirtieth-highest bid. Anything above it comes back at settlement." },
		{ n: "04", t: "Higher bids, earlier days", d: "The top bid takes #181, the first day of Interface. Each rank down takes the next day along the route." },
	];
	return (
		<section id="sale-rules" className="scroll-mt-4">
			<SectionHead title="the sale" zone="suburb" />
			<Screen image={STRIP[14]}>
			<ol className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
				{steps.map((s) => (
					<li key={s.n} className="game-panel p-5 md:p-6 flex flex-col gap-2.5">
						<span className="font-mono text-[11px] tabular-nums text-laser font-bold">{s.n}</span>
						<h3 className="font-sans font-semibold text-[17px] text-foreground leading-snug">{s.t}</h3>
						<p className="font-sans text-sm text-muted leading-relaxed">{s.d}</p>
					</li>
				))}
			</ol>
			</Screen>
		</section>
	);
}

export function SeasonDetails({
	durationHours,
	incrementPct,
	reserve,
	hardEndLabel,
	settled = false,
	soldCount = 0,
	openCount = 0,
}: {
	durationHours: number;
	incrementPct: number;
	reserve: string;
	hardEndLabel?: string;
	/** The sale is over: speak to visitors and holders, not bidders. */
	settled?: boolean;
	soldCount?: number;
	/** Days left open, each on its own Manifold auction (0 off mainnet). */
	openCount?: number;
}) {
	const settledFaqs: { q: string; a: React.ReactNode }[] = [
		{
			q: "What is Panorama?",
			a: (
				<>
					An autonomous art system by <Yigit />. It reads live market data and generates one tableau a day,
					each joined to the last, so the whole work reads as one continuous panorama. When the price of
					$PANO climbs the work brightens; when it falls the work darkens. The artists curate and approve
					every tableau.
				</>
			),
		},
		{
			q: "What came before?",
			a: "Season 1 was ninety tableaus of myth, #1 through #90. Season 2, Anthology of Mankind, was ninety technologies, #91 through #180, made with DeltaSauce.",
		},
		{
			q: "What is Season 3?",
			a: (
				<>
					Nothing Remains the Same is thirty tableaus, #181 through #210, made by <Yigit /> and <Kirill />.
					Each is one day of a journey through six zones, in whatever mood the market gives it. One is
					revealed each day from October 20.
				</>
			),
		},
		{
			q: "What are the zones?",
			a: `Six stretches of five days: ${SEASON_3_ZONES.map(
				(z) => `${z.name} (#${z.firstToken}-#${z.lastToken})`,
			).join(", ")}. The route starts in a city read as a system and ends on land still forming.`,
		},
		{
			q: "What are the daily themes?",
			a: "Pale Kirill's starting point for each day. Every zone holds five things, one a day: a figure, a place, an event, an object and a feeling, from creator on Day 1 to love on Day 30. The full table is on the route, above.",
		},
		{
			q: "How can I get a day?",
			a: (
				<>
					{soldCount} of the 30 days are sold; their holders can list them on{" "}
					<Ext href={OPENSEA_COLLECTION_URL}>OpenSea</Ext>.
					{openCount > 0 && (
						<>
							{" "}The other {openCount} are open for bids, each on its own auction on Manifold.{" "}
							<Link href="/auctions" className="text-foreground underline underline-offset-2 hover:opacity-60 transition-opacity">
								See them
							</Link>
							.
						</>
					)}
				</>
			),
		},
		{
			q: "What is a signal?",
			a: `An optional message for a day, or a signal to anyone at all, up to ${MAX_SIGNAL_BYTES} characters, written by whoever holds the day. Once written it never changes. The artists read it when that day is made, and may use it or leave it. It is public.`,
		},
		{
			q: "Can I add a signal later?",
			a: "Yes, any time, to a day you hold that has none, including a day you buy later. There is no deadline. A signal can never be changed or removed once written.",
		},
		{
			q: "What is $PANO?",
			a: (
				<>
					The ERC-20 whose price sets the work&apos;s mood, launched with SuperRare as part of its Liquid Editions program. <Ext href={TERMINAL_URL}>Trade it on the terminal</Ext>.
				</>
			),
		},
	];
	const biddingFaqs: { q: string; a: React.ReactNode }[] = [
		{
			q: "What is Panorama?",
			a: (
				<>
					An autonomous art system by <Yigit />. It reads live market data and generates one tableau a day,
					each joined to the last, so the whole work reads as one continuous panorama. When the price of
					$PANO climbs the work brightens; when it falls the work darkens. The artists curate and approve
					every tableau.
				</>
			),
		},
		{
			q: "What came before?",
			a: "Season 1 was ninety tableaus of myth, #1 through #90. Season 2, Anthology of Mankind, was ninety technologies, #91 through #180, made with DeltaSauce.",
		},
		{
			q: "What am I bidding on?",
			a: (
				<>
					A Season 3 tableau. Nothing Remains the Same is thirty tableaus, #181 through #210, made by{" "}
					<Yigit /> and <Kirill />. Each is one day of a journey through six zones, in whatever mood the
					market gives it. This auction sells all thirty at once.
				</>
			),
		},
		{
			q: "What are the zones?",
			a: `Six stretches of five days: ${SEASON_3_ZONES.map(
				(z) => `${z.name} (#${z.firstToken}-#${z.lastToken})`,
			).join(", ")}. The route starts in a city read as a system and ends on land still forming.`,
		},
		{
			q: "What are the daily themes?",
			a: "Pale Kirill's starting point for each day. Every zone holds five things, one a day: a figure, a place, an event, an object and a feeling, from creator on Day 1 to love on Day 30. The full table is under the themes, above.",
		},
		{
			q: "What is a signal?",
			a: `An optional message for the day your bid wins, or a signal to anyone at all, up to ${MAX_SIGNAL_BYTES} characters. Add it with your bid or later, even after the sale. Once written it never changes. The artists read it when that day is made, and may use it or leave it. A signal never changes price or rank, and it is public.`,
		},
		{
			q: "Can I add a signal later?",
			a: "Yes, any time. Add one to a bid while the bid is live, or, after the sale, to a day you hold that has none, including a day you bought later. There is no deadline. A signal can never be changed or removed once written.",
		},
		{
			q: "How are winners chosen?",
			a: "The thirty highest bids win. Every winner pays the same amount: the thirtieth-highest bid, the clearing price. Anything you bid above it is refunded when the sale settles.",
		},
		{
			q: "What if I get outbid?",
			a: "The moment a higher bid pushes you out of the top thirty, your bid returns to your wallet in full. Nothing to claim.",
		},
		{
			q: "Can I bid more than once?",
			a: "Yes. A wallet can hold up to two bids and win up to two tableaus. Each new bid can carry its own signal.",
		},
		{
			q: "Can two bids be the same amount?",
			a: "Until all thirty days are held, yes, and the earlier bid ranks ahead. From then on every new bid and every raise must land on an amount nobody holds, so if 0.11 is taken, bid 0.109 or 0.111. Amounts go in steps of 0.001 ETH: 0.111 works, 0.1111 does not.",
		},
		{
			q: "When does bidding end?",
			a: `The sale runs about ${durationHours} hours. A new bid in the last five minutes pushes the end out by ten minutes; a raise does too once it adds at least ${incrementPct}% of the current floor. Extensions add at most 24 hours past the scheduled close${hardEndLabel ? `, so the hard deadline is ${hardEndLabel}` : ""}.`,
		},
		{
			q: "What does it cost to enter?",
			a: `The reserve is ${reserve} ETH. Once all thirty days are held, a new bid has to beat the lowest of them by at least ${incrementPct}%, rounded up to the next 0.001 ETH.`,
		},
		{
			q: "How do I get my tableau?",
			a: "Winners are minted when the auction settles. Each tableau then reveals on its own day, in bid order.",
		},
		{
			q: "Is my ETH safe if something goes wrong?",
			a: (
				<>
					Every recovery path is enforced by the contract and open to any wallet. Anyone can settle seven
					days after close. If minting is unavailable then, anyone can switch the unminted bids to refunds,
					and a collection-supply mismatch allows that at once. Cancelled sales refund permissionlessly, and
					an emergency deadline backs it all.{" "}
					<Link href="/recovery" className="text-foreground underline underline-offset-2 hover:opacity-60 transition-opacity">
						Recovery tools
					</Link>
					.
				</>
			),
		},
		{
			q: "Has the contract been audited?",
			a: (
				<>
					Yes. It is built on the Season 2 auction contract, which was independently audited in July 2026
					and ran the Season 2 sale. Season 3 changes only a few rules: thirty tableaus from #181, two bids
					per wallet, amounts in steps of 0.001 ETH, unique amounts once all thirty days are held, and
					signals, kept in their own small contract. Because the changes are small, they were reviewed with
					LLM auditing tools and covered by the full test suite rather than a second formal audit.{" "}
					<Ext href={SEASON_2_AUDIT_REPORT_URL}>Read the Season 2 audit</Ext>.
				</>
			),
		},
		{
			q: "What is $PANO?",
			a: (
				<>
					The ERC-20 whose price sets the work&apos;s mood, launched with SuperRare as part of its Liquid Editions program. <Ext href={TERMINAL_URL}>Trade it on the terminal</Ext>.
				</>
			),
		},
	];
	const faqs = settled ? settledFaqs : biddingFaqs;

	return (
		<div className="flex flex-col gap-20 md:gap-24">
			<SignalsExplainer settled={settled} />
			{!settled && <SaleSteps incrementPct={incrementPct} />}

			<section id="questions" className="scroll-mt-4">
				<SectionHead title="questions" zone="village" />
				<div className="game-panel px-5 grid gap-x-10 xl:grid-cols-2">
					{[faqs.slice(0, Math.ceil(faqs.length / 2)), faqs.slice(Math.ceil(faqs.length / 2))].map((col, ci) => (
						<div key={ci} className="flex flex-col">
							{col.map((f) => (
								<details key={f.q} className="group border-b border-[var(--panel-edge)] last:border-b-0">
									<summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
										<span className="font-sans font-semibold text-[16px] text-foreground leading-snug group-open:text-sky-pink">{f.q}</span>
										<LuPlus
											size={14}
											aria-hidden
											className="shrink-0 text-laser transition-transform duration-200 group-open:rotate-45"
										/>
									</summary>
									<div className="pb-5 pr-8 font-sans text-sm text-muted leading-relaxed">{f.a}</div>
								</details>
							))}
						</div>
					))}
				</div>
			</section>

			<footer className="relative pt-10 pb-4">
				<div aria-hidden className="absolute top-0 left-0 right-0 h-[2px] flex">
					{SEASON_3_ZONES.map((z) => (
						<span key={z.id} className="flex-1" style={{ background: `var(--z-${z.id})` }} />
					))}
				</div>
				<div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
					<div className="flex flex-col gap-2">
						<span className="font-mono text-[12px] uppercase tracking-[0.2em] text-foreground">
							<span className="font-bold">Panorama</span> <span className="text-muted">Season 3</span>
						</span>
						<span className="game-logo text-2xl">Nothing Remains the Same</span>
						<span className="font-sans text-sm text-muted">
							<Yigit /> and <Kirill />
						</span>
					</div>
					<nav className="flex flex-wrap gap-x-5 gap-y-2 game-caption text-[12px]">
						<Ext href={`${SITE_URL}/about`}>The full story</Ext>
						<Ext href={TERMINAL_URL}>Trade $PANO</Ext>
						<Ext href={OPENSEA_COLLECTION_URL}>OpenSea</Ext>
						<Ext href={GITHUB_URL}>GitHub</Ext>
						{PANORAMA_AUCTION_ADDRESS && <Ext href={getEvmNowUrl(PANORAMA_AUCTION_ADDRESS)}>Contract code</Ext>}
						<Ext href={SEASON_2_AUDIT_REPORT_URL}>Audit</Ext>
					</nav>
				</div>
			</footer>
		</div>
	);
}
