"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReadContracts } from "wagmi";
import { erc721OwnerOfAbi, signalControllerAbi } from "@/lib/abis/signalController";
import { MAX_SIGNAL_BYTES, type SignalRow } from "@/lib/signal";

export type SignalReadStatus = "not-needed" | "loading" | "ready" | "error";

/** Token signals and holders change slowly after the sale; poll them on this interval. */
const POST_SALE_REFRESH_MS = 30_000;

interface BidRef {
	id: number;
	bidder: `0x${string}`;
}

/**
 * Signals are read from PanoramaSeason3SignalController STORAGE (no log scans):
 * - config: MAX_SIGNAL_BYTES
 * - bidSignal(id) for every live and every won bid
 * - tokenSignal for #181-#210, and ownerOf on the NFT (allowFailure, unminted
 *   tokens revert), once settlement has started
 * While bidding, everything re-reads on each new block; after it, every 30s. `refetch` is wired
 * into the post-write refresh.
 */
export function useSignalController({
	enabled,
	controller,
	nft,
	liveBids,
	wonBids,
	firstTokenId,
	lastTokenId,
	settlementStarted,
	live,
	blockNumber,
}: {
	enabled: boolean;
	controller?: `0x${string}`;
	nft?: `0x${string}`;
	liveBids: readonly BidRef[];
	wonBids: readonly BidRef[];
	firstTokenId: number;
	lastTokenId: number;
	/** Any token can exist: finalize has started (or the auction is past active). */
	settlementStarted: boolean;
	/** Bidding is open: follow every block. */
	live: boolean;
	blockNumber?: bigint;
}) {
	const on = enabled && !!controller;
	const base = { address: controller, abi: signalControllerAbi } as const;
	const poll = live ? false : POST_SALE_REFRESH_MS;

	const config = useReadContracts({
		allowFailure: false,
		contracts: [{ ...base, functionName: "MAX_SIGNAL_BYTES" }],
		query: { enabled: on, refetchInterval: poll },
	});

	// Every bid whose signal can matter: live ones (the board) and won ones (a day's fallback).
	const bidRefs = useMemo(() => {
		const byId = new Map<number, BidRef>();
		for (const b of [...wonBids, ...liveBids]) byId.set(b.id, b);
		return [...byId.values()].sort((x, y) => x.id - y.id);
	}, [liveBids, wonBids]);
	const bidReads = useReadContracts({
		allowFailure: false,
		contracts: bidRefs.map((b) => ({ ...base, functionName: "bidSignal" as const, args: [b.id] as const })),
		query: { enabled: on && bidRefs.length > 0, refetchInterval: poll, placeholderData: (prev) => prev },
	});

	const tokens = useMemo(
		() =>
			lastTokenId >= firstTokenId
				? Array.from({ length: lastTokenId - firstTokenId + 1 }, (_, i) => BigInt(firstTokenId + i))
				: [],
		[firstTokenId, lastTokenId],
	);
	const tokenReads = useReadContracts({
		allowFailure: false,
		contracts: tokens.map((t) => ({ ...base, functionName: "tokenSignal" as const, args: [t] as const })),
		query: { enabled: on && settlementStarted, refetchInterval: POST_SALE_REFRESH_MS },
	});
	// ownerOf reverts for an unminted token, so this one multicall tolerates failures.
	const holderReads = useReadContracts({
		allowFailure: true,
		contracts: tokens.map((t) => ({
			address: nft,
			abi: erc721OwnerOfAbi,
			functionName: "ownerOf" as const,
			args: [t] as const,
		})),
		query: { enabled: enabled && !!nft && settlementStarted, refetchInterval: POST_SALE_REFRESH_MS },
	});

	const refetchRef = useRef<() => void>(() => {});
	useEffect(() => {
		refetchRef.current = () => {
			if (!on) return;
			void config.refetch();
			if (bidRefs.length > 0) void bidReads.refetch();
			if (settlementStarted) {
				void tokenReads.refetch();
				if (nft) void holderReads.refetch();
			}
		};
	});
	// While bidding, a bidder can replace a signal in any block: follow the chain.
	const lastBlockRef = useRef<bigint | undefined>(undefined);
	useEffect(() => {
		if (!live || blockNumber === undefined) return;
		const previous = lastBlockRef.current;
		lastBlockRef.current = blockNumber;
		if (previous !== undefined && previous !== blockNumber) refetchRef.current();
	}, [live, blockNumber]);

	const cfg = config.data as readonly unknown[] | undefined;
	const bidData = bidReads.data as readonly unknown[] | undefined;
	const tokenData = tokenReads.data as readonly unknown[] | undefined;
	const holderData = holderReads.data as
		| readonly { status: "success" | "failure"; result?: unknown }[]
		| undefined;

	const bidSignals = useMemo(() => {
		const map = new Map<number, SignalRow>();
		if (!bidData) return map;
		bidRefs.forEach((b, i) => {
			const signal = bidData[i];
			if (typeof signal === "string" && signal !== "")
				map.set(b.id, { bidId: b.id, bidder: b.bidder, signal });
		});
		return map;
	}, [bidData, bidRefs]);

	const tokenSignals = useMemo(() => {
		const map = new Map<number, string>();
		if (!tokenData) return map;
		tokens.forEach((t, i) => {
			const signal = tokenData[i];
			if (typeof signal === "string" && signal !== "") map.set(Number(t), signal);
		});
		return map;
	}, [tokenData, tokens]);

	const holders = useMemo(() => {
		const map = new Map<number, `0x${string}`>();
		if (!holderData) return map;
		tokens.forEach((t, i) => {
			const r = holderData[i];
			if (r?.status === "success" && typeof r.result === "string")
				map.set(Number(t), r.result as `0x${string}`);
		});
		return map;
	}, [holderData, tokens]);

	const pending =
		config.isPending ||
		(bidRefs.length > 0 && bidReads.isPending) ||
		(settlementStarted && tokenReads.isPending);
	const failed =
		config.isError ||
		(bidRefs.length > 0 && bidReads.isError) ||
		(settlementStarted && tokenReads.isError);
	const status: SignalReadStatus = !on ? "not-needed" : failed ? "error" : pending ? "loading" : "ready";

	return {
		status,
		/** Config and every signal read needed right now are in. Signal writes key off this. */
		ready: status === "ready",
		maxSignalBytes: cfg ? Number(cfg[0] as bigint) : MAX_SIGNAL_BYTES,
		bidSignals: bidSignals as ReadonlyMap<number, SignalRow>,
		tokenSignals: tokenSignals as ReadonlyMap<number, string>,
		holders: holders as ReadonlyMap<number, `0x${string}`>,
		refetch: () => refetchRef.current(),
	};
}
