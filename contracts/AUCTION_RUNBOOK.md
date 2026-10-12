# Season 3 Auction Operations Runbook

Operational procedures for deploying, running, settling, and recovering the
`PanoramaSeason3Auction` sale for Panorama Season 3, "Nothing Remains the Same" (Yigit Duman
and Pale Kirill): 30 tokens, #181-#210, in six zones of five days (Interface, City, Suburb,
Village, Nature, Abstract). Commands assume `contracts/` as cwd. The sources of truth are
`src/PanoramaSeason3Auction.sol` and `src/PanoramaSeason3SignalController.sol`.

The auction is the audited Season 2 auction with these changes: 30 units starting at #181,
the optional bid signal, signals moved to a separate controller contract
(`PanoramaSeason3SignalController`), a wallet limit of 2 bids (Season 2 allowed 4), a 0.001
ETH bid tick, and unique amounts once all 30 days are held. Those changes and the controller
were not re-audited. The 58/42 proceeds split is unchanged.

Signals are optional. A bid can carry one in the same transaction (`placeBid(signal)`,
forwarded to the controller), or its bidder adds one later with `setBidSignal` while the bid
is live. After the sale, a day's holder can add one with `setTokenSignal`. Every signal is
write-once (never changed or cleared) and there is no deadline: a signal can arrive after its
day is revealed. A day's signal is the winning bid's, or its holder's if that bid had none.
The artists may use or ignore any signal.

Bidding rules: at most 2 active bids per wallet; amounts and top-ups in steps of 0.001 ETH;
once all 30 are held, a new bid must beat the lowest winning bid by 5% (rounded up to the
tick) and every bid must be a different amount, raises included. `minimumBid()` always
returns a placeable amount, and `isAmountAvailable(amount)` checks tick and uniqueness.

Launch values: opens 2026-10-19 17:00 UTC (`1792429200`), 24h duration, at most 24h of
anti-snipe extension (absolute end 2026-10-21 17:00 UTC), reserve 0.1 ETH, minimum increment
500 bps (5%). Season 3's first tableau publishes 2026-10-20.

Every forge script here requires an explicit `PRIVATE_KEY` (there is no fallback key) and
refuses to run on any chain but mainnet (the `*Sepolia` variants exist for rehearsals).
Rehearse the full flow on a fork first (see §7).

---

## 1. Roles and keys

| Key | Controls | Used by |
|---|---|---|
| NFT + controller owner | `setAuthorizedOperator`, `setSeasonMintCap` | SettleAuctionAtomic |
| Auction owner (deployer) | `finalize` before grace, `cancelAuction`, `setPaused`, `setSchedule`, rescues | DeployAuction, CancelAuction, admin UI |
| Payout A / payout B | Receive 58% / 42% of proceeds at settlement (`SPLIT_A_BPS`) | fixed at deploy |
| Anyone | `refundAll` (after cancel), `emergencyRefund` (after grace), `recoverFromSupplyMismatch` (on mismatch), `recoverFromMintingUnavailable` (after 7-day grace), `finalize` (after 7-day grace), `withdraw` | /recovery page, Etherscan |

Recommended: move NFT, controller, and auction ownership to a Safe before the sale and
execute settlement as a single Safe batch (§5, `safeBatch`). If staying on an EOA, use a
hardware wallet and never reuse the key for anything else during the sale window.

## 2. Pre-deploy checklist

1. **Commit and tag.** The deployed source must be a committed tree; record the tag in the
   manifest. `git status` must be clean for `contracts/` and `frontend/`.
2. **Tests green.** This revision discovers **164 contract tests** (including invariants, the
   signal controller suite, and an end-to-end run of the deploy and settle scripts), plus the
   frontend's unit and browser suites. The command output is authoritative if counts change:
   ```bash
   FOUNDRY_PROFILE=ci forge test --match-path 'test/PanoramaSeason3*' -vv
   scripts/test-operations.sh
   cd ../frontend
   pnpm install --frozen-lockfile
   pnpm run ci
   pnpm run build
   pnpm run test:e2e
   pnpm run audit:prod
   ```
   (`pnpm audit --prod` no longer works: npm retired the quick-audit endpoint it calls, HTTP
   410 since mid-2026. `audit:prod` runs `scripts/audit-prod.mjs`, which audits the exact
   installed production closure against npm's replacement bulk advisory endpoint, the same
   step CI runs.)
3. **RPC capacity.** Verify the Alchemy (or equivalent) account is not rate-capped and has
   headroom for auction-week traffic. The frontend needs `NEXT_PUBLIC_RPC_URL` set to an
   authenticated endpoint; the deploy scripts need `foundry.toml`'s `mainnet` RPC working.
4. **Operator audit.** Reconstruct the full authorization history and confirm no stray
   operator is authorized:
   ```bash
   cast logs --rpc-url $RPC --from-block 24941545 --to-block latest \
     --address 0x435BD9CF72C278c9bAD9655732a6724469c6D9Ff \
     0x2b354ade00599743d1a975e67ff021962f1ea8b421f7683ebf5435303263c02f
   ```
   (topic0 = `AuthorizedOperatorUpdated(address,bool)`; NFT deploy block is 24,941,545.)
   Every operator ever authorized, including the settled Season 2 auction, must show a later
   revocation. Expected live state: `totalMinted == 180`, `mintCap == 180`.
5. **Baseline reads.**
   ```bash
   cast call $NFT 'totalMinted()(uint256)' --rpc-url $RPC     # 180
   cast call $NFT 'mintCap()(uint256)' --rpc-url $RPC          # 180
   cast call $NFT 'owner()(address)' --rpc-url $RPC
   cast call $NFT 'mintController()(address)' --rpc-url $RPC
   cast call $CTRL 'seasonCount()(uint8)' --rpc-url $RPC       # 2
   cast call $CTRL 'seasonMintCap(uint8)(uint256)' 1 --rpc-url $RPC   # 90
   cast call $CTRL 'seasonMintCap(uint8)(uint256)' 2 --rpc-url $RPC   # 90
   ```
   Settlement opens Season 3 as season 3 on the controller, so `seasonCount` must still be 2.
6. **Frontend env** (frontend/.env or platform): `NEXT_PUBLIC_CHAIN_ID=1`,
   `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
   `NEXT_PUBLIC_PANORAMA_AUCTION_ADDRESS` (after deploy),
   `NEXT_PUBLIC_AUCTION_DEPLOY_BLOCK` (after deploy), and `PANORAMA_PRODUCTION=1` so the
   build-time env assertions arm. A production build without RPC or WalletConnect id fails
   by design.
7. **Monitoring.** Install the monitor dependencies, run `scripts/test-operations.sh`, configure
   its private state path and Discord webhook, and pass the RPC + webhook healthcheck in §6
   before bidding opens. Alert on a nonzero cron/systemd exit; a failed RPC read or webhook
   delivery is a monitoring failure.

## 3. Deploy

```bash
export PRIVATE_KEY=...                       # auction deployer/owner
export PANORAMA_NFT=0x435BD9CF72C278c9bAD9655732a6724469c6D9Ff
export PANORAMA_AUCTION_RESERVE_PRICE=100000000000000000   # 0.1 ETH (contract floor MIN_RESERVE_PRICE)
export PANORAMA_AUCTION_MIN_INCREMENT_BPS=500                # 5%
export PANORAMA_AUCTION_START=1792429200                     # 2026-10-19 17:00 UTC; deploy hours before
export PANORAMA_AUCTION_DURATION=86400                       # 24h
export PANORAMA_PAYOUT_A=...                                 # 58%
export PANORAMA_PAYOUT_B=...                                 # 42%
forge script script/DeployAuction.s.sol:DeployAuction --rpc-url mainnet --broadcast --verify
```

The script validates the full config (every value is checked at full width before it is
narrowed, so an oversized reserve cannot truncate into a valid one; the reserve must be on the
0.001 ETH tick),
requires `totalMinted == 180`, `mintCap == 180` and `seasonCount == 2`, then sends three
transactions: the signal controller, the auction pointing at it, and
`controller.setAuction(auction)`. It verifies both directions (`auction.signalController()`
and `controller.auction()`), the controller's owner, NFT and constants,
and prints both addresses and the auction's **runtime code hash**. `setAuction` is once only:
if the controller ever pointed at the wrong auction, every bid that carries a signal would
revert, so redeploy both rather than continuing. Then:

1. Record the manifest (requires `RPC_URL` and `PANORAMA_AUCTION_ADDRESS`; run from a clean
   tree so `gitDirty` records false):
   ```bash
   RPC_URL=... PANORAMA_AUCTION_ADDRESS=... \
     scripts/auction-manifest.sh > deployments/auction-$(date -u +%Y%m%d).json
   ```
   and commit it. If the script fails, delete the empty file the redirect left behind.
2. Verify the source on Etherscan (the `--verify` flag, or `forge verify-contract`).
3. Obtain the codehash independently (`cast codehash $AUCTION --rpc-url $RPC`) and compare
   with the deploy output; this value gates every later script. Record the controller address
   as `PANORAMA_SIGNAL_CONTROLLER` (the manifest and `bid-alert.sh` cross-check it).
4. Set the frontend env (address + deploy block) and redeploy the site; confirm the
   countdown, reserve and increment render from chain data.
5. Between deployment and `startTime`: nothing else to do. Bidding opens by itself. The
   schedule can still be adjusted with `setSchedule` until the first bid. Signals have no
   schedule to adjust.

## 4. During the auction

- **No collection mutations.** Do not call `setSeasonMintCap`, `setAuthorizedOperator`, or
  any mint. The cap equals `totalMinted`, so mints revert anyway; the discipline is about
  not disturbing the baseline the auction fail-closes against.
- **Pause policy.** `setPaused(true)` stops bids but the clock keeps running.
  Treat pause as an emergency brake for a frontend exploit or an RPC incident, disclose it
  publicly the moment it happens, and either unpause with real time left or cancel.
- **Cancel policy.** `cancelAuction()` is owner-discretion while Active and it
  is visible to bidders that the owner holds it. Policy for this sale: cancel only for a
  security incident or a fundamentally broken sale, never in reaction to price discovery.
- Monitoring alerts on: phase change, pause flips, supply mismatch, extension bursts, and
  any balance-vs-liability drift (§6), and on a signal controller that does not point back at
  the auction. `bid-alert.sh` posts each new bid with its signal and every later signal change.
- **Signals.** A signal is public text, at most 280 bytes, stored in the signal controller.
  It never affects price, rank or settlement, and nothing operational depends on it. The
  contracts check only the length, so treat the text as untrusted input wherever it is
  displayed. Every new signal emits `BidSignalSet` or `TokenSignalSet`.
- **Reading a day's signal.** When making a day, read `controller.signalOf(tokenId,
  winningBidId)`, where the auction's `Won` event maps the token to its winning bid. It
  returns the winning bid's signal, or the holder's if that bid had none (empty when neither
  exists yet). Before settlement, read the bid ranked for that day (`bidSignal(bidId)`; for
  day 1 the top bid of `getBids()`, highest amount, earliest id on a tie). A signal never
  changes once written, but one may still be added later; the artists may use it or ignore it.

## 5. Settlement (after `endTime`)

**Hard deadline: settle within 7 days of the final `endTime`.** The auction is not authorized to
mint until the settlement sequence grants it, so before settlement `mintingUnavailable()` is
true. From `endTime + FINALIZE_GRACE` (7 days) anyone may call
`recoverFromMintingUnavailable`, which cancels the sale and refunds every bid (Season 2 audit
note C-M1). Settle well before then.

Preferred: **one closed sequence** with zero gaps between authorization, cap, minting, and
revocation.

```bash
export PRIVATE_KEY=...                        # must own NFT + controller (+ auction, before grace)
export PANORAMA_NFT=... PANORAMA_MINT_CONTROLLER=... PANORAMA_AUCTION_ADDRESS=...
export PANORAMA_AUCTION_RUNTIME_CODEHASH=...  # from §3 step 3, independently obtained
export PANORAMA_AUCTION_OWNER=...
export PANORAMA_AUCTION_RESERVE_PRICE=100000000000000000 PANORAMA_AUCTION_MIN_INCREMENT_BPS=500
export PANORAMA_AUCTION_START=1792429200 PANORAMA_AUCTION_DURATION=86400
export PANORAMA_PAYOUT_A=... PANORAMA_PAYOUT_B=...
export PANORAMA_FINALIZE_BATCH=30             # one batch settles all 30 winners

# EOA: broadcast authorize -> exact cap -> finalize... -> revoke back-to-back in one run
forge script script/SettleAuctionAtomic.s.sol:SettleAuctionAtomic --rpc-url mainnet --broadcast

# Safe: print a Transaction Builder JSON so the whole sequence is ONE atomic transaction
forge script script/SettleAuctionAtomic.s.sol:SettleAuctionAtomic --sig 'safeBatch()' --rpc-url mainnet
```

Notes:
- The cap is opened by the **exact winner count**, so even the owner cannot mint a stray
  token mid-settlement, and after completion `mintCap == totalMinted` again.
- The cap step is `controller.setSeasonMintCap(3, winners)`. It runs only while
  `seasonCount == 2`; a retry after a partial run accepts only the exact-winners season 3 cap.
- Gas: one `finalize(30)` settles everything for about 3.4M gas. If every winner is a contract
  that burns its full 100k refund stipend, the same call costs about 7.0M, still far under the
  block limit. Smaller batches are allowed (`PANORAMA_FINALIZE_BATCH`, max 30).
- The atomic script is the only settle path; the old split scripts (authorize, then
  finalize later) were removed because a gap between the two steps is exactly the mint
  window this sequence exists to close. If the script is ever unusable, the wallet-gated
  `/admin` console (or `/recovery` after the 7-day grace) drives the contract's `finalize`
  directly; grant `setAuthorizedOperator` + the exact-winner mint cap immediately before,
  and revoke immediately after, in the same sitting.
- Post-checks (the script asserts them; verify independently): phase Settled, escrow and
  unreleased proceeds zero, `totalMinted == 180 + winners`, `mintCap == totalMinted`,
  operator revoked, payout addresses received the 58/42 split.
- Check for `RefundFailed` events afterwards; affected bidders withdraw via `/recovery`
  (funds are ledgered, nothing to do operationally).

## 6. Incidents

| Scenario | Action |
|---|---|
| Must stop the sale (exploit, broken frontend) | `setPaused(true)`, disclose, fix, unpause or cancel |
| Sale must be voided while Active | `CancelAuction.s.sol`, then anyone: `RefundAllAuction.s.sol` (or /recovery) |
| A stray mint consumed a token id | Nothing to decide: bidding/settlement fail closed; anyone can `recoverFromSupplyMismatch` (also on /recovery) |
| Minting unavailable (authorization missing/revoked or cap insufficient) | Fix rights/cap during the normal settlement window. At `endTime + 7d`, anyone can call `recoverFromMintingUnavailable` to refund every unminted bid; already-minted winner proceeds release when recovery completes. |
| Owner keys lost after end | At `endTime + 7d`, anyone can `finalize` when minting is available, or `recoverFromMintingUnavailable` when it is not. `emergencyRefund` remains the catch-all after the hard grace. |
| ETH sent to the contract by mistake | After terminal state: `rescueSurplusETH` (only provable surplus; escrow is untouchable) |

### Monitoring and RPC health

The monitor requires Bash 4+, Foundry `cast`, `curl`, `timeout`, `flock`, and GNU coreutils. It
does **not** require `bc` or `jq`. By default, state is stored under
`$XDG_STATE_HOME/panorama-auction/` or `$HOME/.local/state/panorama-auction/`, in a mode-0700
directory, in a file named after the auction address (so state left by an earlier auction is
never read). If `STATE_FILE` is overridden, its directory must be owned by the monitor user and
must not be group/world writable. State is strictly parsed as data and replaced atomically; it
is never sourced as shell code.

Before installing the cron entry, test RPC reads and actual webhook delivery:

```bash
scripts/test-operations.sh

RPC_URL=... AUCTION=0x... DISCORD_WEBHOOK_URL=... \
  scripts/monitor-auction.sh --healthcheck
```

The command must exit zero and the healthcheck message must arrive in Discord. Webhook calls
have bounded connect/total timeouts. HTTP failures are written to stderr, return a nonzero
monitor exit, and leave the previous state unchanged so transition alerts retry on the next run.

Then run `scripts/monitor-auction.sh` from cron (e.g. every minute during the sale):

```bash
RPC_URL=... AUCTION=0x... DISCORD_WEBHOOK_URL=... \
  STATE_FILE=/var/lib/panorama-auction/monitor.state \
  scripts/monitor-auction.sh
```

It keeps a state file and posts to Discord on phase changes, pauses, extensions, supply
mismatch, and liability/balance drift. Route nonzero cron exits/stderr to a separate operator
alarm so a broken RPC or webhook cannot silently disable monitoring.

`scripts/bid-alert.sh` is the companion bid feed (also cron, every minute). Each run reads
the auction at one block, lists every new bid with its amount and bidder, and adds the bid's
signal from the signal controller's `BidSignalSet` logs. It also posts every signal added
later to an older bid and every signal a token holder adds to a day (`TokenSignalSet`).
Signals have no deadline, so keep the feed running after settlement. The
controller address comes from `auction.signalController()` unless `SIGNAL_CONTROLLER` or
`PANORAMA_SIGNAL_CONTROLLER` names it. Signal text is sanitized before it reaches Discord:
invalid UTF-8, control characters and bidi overrides are removed, Discord markdown is
escaped, mentions and link previews are disabled, and each signal is cut to
`SIGNAL_MAX_CHARS` characters (default 100). A failed log lookup prints a marker instead of
blocking the alert, and a run with nothing else to post keeps its window so the signals are
retried. `iconv` is optional; without it, signals are reduced to printable ASCII.

Capacity-test the exact authenticated production endpoint progressively. Before an auction is
deployed, synthetic mode sends the same 43-call (42 auction reads + `MAX_SIGNAL_BYTES` on the signal controller) and three-call Multicall3 payload shapes with
`allowFailure=true` against a non-contract placeholder. Synthetic results measure provider
transport/Multicall/ENS capacity only; they do not validate deployed auction behavior.

The script defaults to **30 independent ENS reverse resolutions per client** as a worst-case
upper-bound stress test (the whole board of 30). If the frontend resolves only rows entering
the viewport, roughly 12 concurrent lookups is the normal launch-page shape.
`RPC_LOAD_ENS_RESOLUTIONS=0` remains useful for isolating contract-read latency.

Start with one client and only increase after a clean result:

```bash
# Pre-deployment: one upper-bound synthetic client (43 global + 3 account + 30 ENS reads).
RPC_URL=... RPC_LOAD_SYNTHETIC=1 \
  RPC_LOAD_REQUESTS=1 RPC_LOAD_CONCURRENCY=1 \
  scripts/rpc-load-test.sh

# Then a small concurrent burst.
RPC_URL=... RPC_LOAD_SYNTHETIC=1 \
  RPC_LOAD_REQUESTS=5 RPC_LOAD_CONCURRENCY=2 \
  scripts/rpc-load-test.sh

# Only after both are clean, exercise the bounded launch burst.
RPC_URL=... RPC_LOAD_SYNTHETIC=1 \
  RPC_LOAD_REQUESTS=20 RPC_LOAD_CONCURRENCY=4 \
  RPC_LOAD_ENS_RESOLUTIONS=12 RPC_LOAD_ENS_CONCURRENCY=12 \
  scripts/rpc-load-test.sh

# Separately stress the full 30-name upper bound; this is intentionally harsher than first paint.
RPC_URL=... RPC_LOAD_SYNTHETIC=1 \
  RPC_LOAD_REQUESTS=20 RPC_LOAD_CONCURRENCY=4 \
  RPC_LOAD_ENS_RESOLUTIONS=30 RPC_LOAD_ENS_CONCURRENCY=10 \
  scripts/rpc-load-test.sh
```

After deployment, repeat the progression with real fail-closed contract reads, then include the
`Won` + `BidSignalSet` / `TokenSignalSet` log scan (one query over both contracts):

```bash
RPC_URL=... AUCTION=0x... RPC_LOAD_REQUESTS=1 RPC_LOAD_CONCURRENCY=1 \
  scripts/rpc-load-test.sh

RPC_URL=... AUCTION=0x... RPC_LOAD_REQUESTS=5 RPC_LOAD_CONCURRENCY=2 \
  scripts/rpc-load-test.sh

RPC_URL=... AUCTION=0x... RPC_LOAD_DEPLOY_BLOCK=... \
  RPC_LOAD_REQUESTS=20 RPC_LOAD_CONCURRENCY=4 \
  scripts/rpc-load-test.sh
```

Record successful-request average/p50/p95/p99/max latency and require zero transport, HTTP,
JSON-RPC, invalid-response, and rate-limit failures at every stage. Compare latency as concurrency
rises; stop if p95/p99 climbs sharply even before explicit 429s. The tool caps snapshots at 200,
client concurrency at 32, ENS lookups at 30 per client, and per-client ENS concurrency at 30.
Increase confidence through repeated bounded runs, not by removing those safety limits.

### Season 3 RPC results

Not run yet. Record each stage here (shape, result, aggregate latency, critical request
classes) with the endpoint redacted. The Season 2 runs on the same provider found the
block/global/account reads clean under a 20-client burst, and an all-at-once ENS shape less
reliable on repeat than lazy, cached lookups.

## 7. Fork rehearsal

Full dry-run against real mainnet state. This has not been run for Season 3 yet; do it
before launch:

```bash
anvil --fork-url $RPC --chain-id 1 --port 9545 &
# move NFT + controller ownership to the test key on the fork
cast rpc anvil_impersonateAccount $OWNER --rpc-url http://127.0.0.1:9545
cast send $NFT  'transferOwnership(address)' $TEST --from $OWNER --unlocked --rpc-url http://127.0.0.1:9545
cast send $CTRL 'transferOwnership(address)' $TEST --from $OWNER --unlocked --rpc-url http://127.0.0.1:9545
# then: DeployAuction -> place bids with cast -> warp past end -> SettleAuctionAtomic
```

Bid with `cast send $AUCTION 'placeBid(string)' '' --value ...` (or a signal string in place of
`''`; amounts on the 0.001 ETH tick). Add a signal later with
`cast send $SIGNALS 'setBidSignal(uint32,string)' $BID_ID '...'` from the bidder, and after
settlement with `cast send $SIGNALS 'setTokenSignal(uint256,string)' $TOKEN_ID '...'` from the
holder; check that a second write to the same bid or token reverts `SignalAlreadySet`. Also
rehearse the cancel path and an
`emergencyRefund` at least once before launch.

The deploy and settle scripts, `auction-manifest.sh`, `monitor-auction.sh --healthcheck` and
`bid-alert.sh` (bids and signals added later) were exercised against a local anvil chain with
chain id 1. That is not the fork rehearsal above.

A Sepolia rehearsal (`DeployAuctionSepolia`, `SettleAuctionAtomicSepolia`) needs a fresh NFT
and controller in the mainnet shape: seasons 1 and 2 set to 90 each and 180 tokens minted.
Each settled rehearsal consumes its stack, so redeploy the stack for every round.
