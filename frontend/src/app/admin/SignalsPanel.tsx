"use client";

import { useMemo } from "react";
import { useToast } from "@/app/components/Toast";
import { Label, short } from "@/app/auction/components/ui";
import type { AuctionState } from "@/app/auction/hooks/useAuctionState";
import { buildSignalEntries, signalEntriesJson, signalEntriesText } from "@/lib/signalBoard";
import { getBlockExplorerAddressUrl } from "@/lib/constants";

const GHOST_SM =
	"font-mono text-micro uppercase tracking-[0.14em] border border-line px-3 py-2 text-foreground hover:border-foreground active:translate-y-px disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer";

/**
 * The thirty days with their signals, as the artists read them when they make each day. Signals
 * are public on-chain, so this panel shows for any visitor of the console; only the owner
 * actions above it are gated.
 */
export function SignalsPanel({ s }: { s: AuctionState }) {
	const toast = useToast();
	const entries = useMemo(
		() =>
			buildSignalEntries({
				firstTokenId: s.firstTokenId,
				maxUnits: s.maxUnits,
				phase: s.phase,
				liveBids: s.allBids,
				wonBids: s.wonBids,
				bidSignals: s.signals,
				tokenSignals: s.tokenSignals,
				holders: s.tokenHolders,
			}),
		[s.firstTokenId, s.maxUnits, s.phase, s.allBids, s.wonBids, s.signals, s.tokenSignals, s.tokenHolders],
	);
	const withSignal = entries.filter((e) => e.signal !== null).length;

	const copyAll = async () => {
		try {
			await navigator.clipboard.writeText(signalEntriesText(entries));
			toast.success(`Copied ${entries.length} days.`);
		} catch {
			toast.error("The clipboard is unavailable here. Use the JSON download.");
		}
	};

	const download = () => {
		const blob = new Blob([signalEntriesJson(entries)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `panorama-s3-signals-${new Date().toISOString().slice(0, 10)}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	};

	return (
		<section className="border border-line bg-surface p-6 md:p-7" aria-labelledby="signals-heading">
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<h2 id="signals-heading">
					<Label>Signals / {withSignal} of {entries.length} days</Label>
				</h2>
				<div className="flex flex-wrap items-center gap-2">
					<button type="button" className={GHOST_SM} onClick={copyAll}>
						copy all
					</button>
					<button type="button" className={GHOST_SM} onClick={download}>
						download json
					</button>
				</div>
			</div>
			<p className="font-sans text-sm text-muted mt-3 leading-relaxed max-w-[62ch]">
				One row per day. While bidding, a day shows the bidder holding its rank and that bid&apos;s
				signal. Once minted, a day carries its winning bid&apos;s signal, or the one its holder added
				when the bid had none. Signals are write-once and can be added at any time.
			</p>

			{s.signalStatus === "loading" && (
				<p className="font-sans text-sm text-muted mt-5" role="status">
					Reading signals…
				</p>
			)}
			{s.signalStatus === "error" && (
				<div className="mt-5 flex items-center gap-3" role="alert">
					<p className="font-sans text-sm text-signal">Signals could not be read from the chain.</p>
					<button type="button" className={GHOST_SM} onClick={s.refetchSignals}>
						retry
					</button>
				</div>
			)}
			{(s.wonStatus === "loading" || s.wonStatus === "degraded" || s.wonStatus === "error") && (
				<p className="font-sans text-xs text-muted mt-3">
					Winner history is still being verified. Minted days may show without their bid signal until it is.
				</p>
			)}

			<ol className="mt-5 flex flex-col">
				{entries.map((e) => (
					<li key={e.token} className="border-t border-line py-4 flex flex-col gap-2">
						<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
							<span className="font-mono text-xs tabular-nums text-foreground">#{e.token}</span>
							<span className="font-mono text-micro uppercase tracking-[0.12em] text-muted">
								Day {e.day}, {e.zone}
							</span>
							{e.holder ? (
								<a
									href={getBlockExplorerAddressUrl(e.holder)}
									target="_blank"
									rel="noopener noreferrer"
									className="font-mono text-micro text-faint hover:text-foreground underline-offset-2 hover:underline"
								>
									{e.holderKind} {short(e.holder)}
									{e.provisional ? " / provisional" : ""}
								</a>
							) : (
								<span className="font-mono text-micro text-faint">no holder</span>
							)}
							{e.source && (
								<span className="font-mono text-micro uppercase tracking-[0.12em] text-faint">
									from the {e.source}
								</span>
							)}
						</div>
						{e.signal ? (
							<p
								dir="auto"
								className="font-sans text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
							>
								{e.signal}
							</p>
						) : (
							<p className="font-sans text-sm text-faint">No signal</p>
						)}
					</li>
				))}
			</ol>
		</section>
	);
}
