# Frontend

Next.js 16 App Router app for the Panorama Season 3 auction, built with [vinext](https://github.com/cloudflare/vinext) (Cloudflare's Vite reimplementation of Next) and served as the Cloudflare Worker `panorama-season3`,, *Nothing Remains the Same* (tokens #181-#210). Three routes:

- **`/`**: public bidding page (`/auction` redirects here), styled after Pale Kirill's old-PC-game look. A title screen (the season's studio strip drifting behind a red blackletter title and a bold italic menu), then the **route board** (`RouteBoard.tsx`: six zone panels, each headed by its studio tile, five inventory slots per zone showing the bid that holds each day, its signal, and the day a bid being typed would take) beside a sticky **console** (clock, the thirty days filling up, the bid form with the optional signal and a live "Lands on #N / Day N, Zone" readout, your bids, refunds, recovery). A collapsible ledger keeps the full standings with addresses; signals, sale steps and the FAQ follow (`SeasonDetails.tsx`). Post-settlement results come from `Won` event logs. The hero's images come from the CDN (`cdn.panorama.garden`), served as-is.
- **`/admin`**: owner console, gated on the connected wallet matching `owner()`. Batched finalize, cancel, refundAll, pause, the payout split read from `SPLIT_A_BPS()` (58/42). Noindexed. Below it, the **Signals** reader: one row per day 1-30 with token, zone, holder (or the bidder holding the rank), the effective signal and its source (bid or holder), plus copy-all and a JSON download. Signals are public on-chain, so the reader shows for any visitor; only owner actions are gated. The wallet check is client-side convenience only; the security boundary is the contract's `onlyOwner` modifiers, which revert any write from a non-owner regardless of what the page renders.
- **`/recovery`**: public self-serve settlement and refund tools: `withdraw`, permissionless `finalize` after the 7-day grace, cancelled-auction refunds, supply-mismatch recovery, and `emergencyRefund`, each with live availability, a countdown to eligibility, and an Etherscan `#writeContract` fallback.

Stack: React 19, TypeScript, Tailwind CSS 4, wagmi 3 + viem 2, TanStack Query.

## Develop

```bash
pnpm install
pnpm dev        # vite dev (the app runs in workerd) on port 5476
pnpm build      # vite build (Worker output in .cloudflare/output)
pnpm start      # run the built Worker locally (vite preview)
pnpm deploy     # PANORAMA_PRODUCTION=1 build + deploy to Cloudflare (needs `npx cf auth login`)
```

The server-only `RPC_URL` (for `/api/day-auctions`) is a Worker secret: locally it goes in the git-ignored `.dev.vars` (`RPC_URL=...`, read by `vite dev` and `vite preview`), in production `npx cf workers secrets update RPC_URL --worker panorama-season3 --type secret_text`. Production's public build values are committed in `.env.production`. A local `.env.local` outranks `.env.production` in a local build, so a local deploy loads `.env.production` into the environment first: `set -a; . ./.env.production; set +a; pnpm deploy`.

Open [http://localhost:5476/?demo=1](http://localhost:5476/?demo=1) to run without a deployed contract. The `?demo=1` URL param works in dev and on non-mainnet builds only; mainnet production builds ignore it, so a shared link can never show the simulation as the real auction. A production-platform build fails outright if `NEXT_PUBLIC_AUCTION_DEMO=1` is set; run dedicated demo deployments on a preview (non-production) environment. Demo mode (`src/app/auction/demo/demoStore.ts`) mirrors the Solidity logic exactly: ceiling basis-point math, the 24h extension cap, in-window sub-threshold raise rejection, id tie-breaks, time-gated emergency refunds, and the signal controller (`placeBid(signal)` forwarding, write-once `setBidSignal` and `setTokenSignal` with no deadline, the 280-byte limit, holders after demo settlement). Unit tests assert this parity, including the constants against the Solidity source when `../contracts` is present.

Against a real chain, copy `.env.example` to `.env.local` and fill in the values. `src/lib/env.ts` validates the configuration at build time (`next.config.ts` calls it); a production mainnet build (`PANORAMA_PRODUCTION=1`, which `pnpm deploy` sets) fails without an authenticated `NEXT_PUBLIC_RPC_URL`, a WalletConnect project id, and the deploy block, by design.

## Signals

Signals live in `PanoramaSeason3SignalController` (its address comes from the auction's `signalController()`; no env var). A signal is optional, up to 280 UTF-8 bytes, and WRITE-ONCE: it can be added later with no deadline, but never changed or cleared.

- **Bid form**: the optional textarea rides along with `placeBid(signal)` in one transaction; the auction forwards it to the controller, so an oversized one reverts the bid with the controller's `SignalTooLong` (the auction write ABI carries the controller errors so it decodes). `src/lib/signal.ts` normalises line endings, strips control characters other than the newline (and bidi overrides), trims, and counts bytes with `TextEncoder`.
- **Your bids**: a live bid without a signal offers "add a signal" (inline editor, same counter) calling `setBidSignal`; a bid with one shows it read-only.
- **Your days**: once settlement starts, every #181-#210 token the wallet holds (by `ownerOf`), with its day, zone and signal. A day with none (neither from the winning bid nor its holder) offers "add a signal" via `setTokenSignal`; otherwise it is read-only with its source.
- **Reading**: controller storage via multicall, never logs: `MAX_SIGNAL_BYTES`; `bidSignal` for every live and won bid; `tokenSignal` for #181-#210 and `ownerOf` (allowFailure) once settlement starts. Re-read per block while bidding, every 30s after, and after every write. A day's signal is the winning bid's if non-empty, else the holder's token signal (`src/lib/signalBoard.ts`, mirroring `signalOf`).
- **Writes**: both signal writes go through the same simulate-before-write, pending tracking, error decoding (`SignalAlreadySet`, `EmptySignal`, `NotBidder`, `NotTokenHolder`) and stale/degraded write lock as the auction writes, and stay locked until the signal reads are in.
- **Display**: always React text, never HTML. Route and ledger rows with a signal get a marker that reveals it on hover, focus, or tap.

## Design decisions

- **No device clock.** Live/ended state derives from the latest block timestamp plus elapsed time (`useChainNow`), so a skewed local clock cannot show a closed auction as open.
- **Fail closed.** Contract reads use `allowFailure: false` with no zero-value defaults. A failed multicall renders an error surface, and stale data disables actions instead of guessing.
- **Simulate before signing.** Every write runs `simulateContract` first, so a doomed transaction surfaces a decoded custom error (the auction's and the signal controller's) before the wallet opens.
- **One formatter.** `src/lib/format.ts` owns all number handling: exact values in inputs, ceiling display for minimums (type what you see, it never reverts), and comma/dot normalization that can never silently change magnitude.

## Test

```bash
pnpm test       # vitest: formatting, error decoding, env validation, Won-log integrity,
                # signal byte counting + sanitising, zones, the signal reader,
                # demo/Solidity parity
pnpm lint
pnpm typecheck
```

End-to-end (needs Foundry; run `forge build` in `../contracts` first so the artifacts exist, or point `PANORAMA_FORGE_OUT` at an artifacts directory built elsewhere):

```bash
pnpm test:e2e   # Playwright boots anvil on 8547, deploys the real Panorama NFT and mint
                # controller (minted to 180, like mainnet before the sale), the signal
                # controller and the auction from the
                # forge artifacts, starts vite dev on 5477, injects an EIP-6963 wallet shim,
                # and drives: bidding, a bid with a signal, adding a signal later from
                # Your bids (a second add is refused), displacement,
                # front-run revert recovery, anti-snipe extension, wallet rejection,
                # tx replacement, batched admin settlement, cancel + refunds,
                # permissionless finalize via /recovery, and mobile layout.
```

Tests snapshot and revert anvil state between scenarios, so they run serially and deterministically.
