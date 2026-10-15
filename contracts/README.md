# Contracts

Foundry project for `PanoramaSeason3Auction` and everything needed to test and operate it.

Panorama Season 3, "Nothing Remains the Same", is a collaboration between Yigit Duman and Pale Kirill: 30 tokens, #181-#210, in six zones of five days (Interface, City, Suburb, Village, Nature, Abstract). This auction sells all 30 in one sale.

## Audit status

`PanoramaSeason3Auction` is the Season 2 auction contract (`PanoramaSeason2Auction`, audited in July 2026) with these changes:

1. `MAX_UNITS = 30` and `FIRST_TOKEN_ID = 181` (tokens #181-#210; the NFT must stand at `totalMinted() == 180`).
2. The optional bid signal: `placeBid(string signal)` passes a signal of up to 280 bytes to `PanoramaSeason3SignalController` in the same transaction. Signals moved to that separate controller contract, where they are write-once and can be added later by the bidder or the token holder, with no deadline (see Signals). The auction holds only an immutable `signalController` (an eighth constructor argument). `increaseBid` takes no signal.
3. `MAX_BIDS_PER_WALLET = 2` (Season 2 allowed 4).
4. `BID_TICK = 0.001 ether`: every bid and every top-up is a whole number of ticks (`AmountNotOnTick` otherwise), and the reserve must be one too. The minimum new bid and the anti-snipe raise threshold are rounded up to the tick.
5. Unique amounts once full: when all 30 days are held, a new bid or a raise may not land on an amount another active bid holds (`AmountTaken`). Ties placed before the auction filled stay allowed. `bidsAtAmount` counts active bids per amount, `minimumBid()` steps past held amounts so it is always placeable, and `isAmountAvailable(amount)` answers the tick and uniqueness question for a frontend.

These changes, and `PanoramaSeason3SignalController` as a whole, were not re-audited. Everything else is the audited Season 2 code unchanged, including the heap, settlement, anti-snipe rules, recovery paths and the fixed 58/42 proceeds split (`SPLIT_A_BPS = 5800`). Apart from names and comments, `diff` against the Season 2 source shows only the changes above.

## Bidding rules

- Bid the most you would pay. The top 30 bids win and all pay the 30th-highest bid; the excess is refunded at settlement.
- No bid below 0.1 ETH. Amounts and top-ups go in steps of 0.001 ETH (0.123 ETH, never 0.1234).
- At most 2 active bids per wallet. Each can win its own day.
- Once all 30 days are held, a new bid must beat the lowest winning bid by 5% (rounded up to the next 0.001 ETH), and every bid must be a different amount, raises included.
- A bid may carry a signal of up to 280 bytes for the day it wins, with the bid or added later. A signal is never changed and has no deadline.

## Signals

Signals live in `PanoramaSeason3SignalController`, a separate contract the auction forwards to. A signal is optional: up to 280 bytes of text (UTF-8 bytes, so fewer characters for non-ASCII text) for the day a bid wins, or simply a signal to the universe. It never affects price, rank or settlement, and every signal is public. The artists may use or ignore any signal.

- **With the bid, in one transaction.** `placeBid(signal)` takes the signal with the bid; the auction passes it to the controller in the same transaction (`recordBidSignal`, emitting `BidSignalSet`). An oversized signal reverts the whole bid with the controller's `SignalTooLong`.
- **Or later.** A bid placed without one can get one later from its bidder with `setBidSignal(bidId, signal)`, at any time while the bid is live (until it is minted, displaced or refunded). After the sale, the holder of a day's token can add one with `setTokenSignal(tokenId, signal)` (emitting `TokenSignalSet` with the holder's address), or a wallet the holder delegated to on [delegate.xyz](https://delegate.xyz) (the whole wallet, the Panorama contract or that token; v2 with full rights, or the older v1 registry), so a collector whose token sits in a vault can sign from a hot wallet. On a chain without the registries, or if a registry call fails, only the holder can.
- **Never changed.** Every signal is write-once: it cannot be replaced or cleared (`SignalAlreadySet`), and an empty one is refused (`EmptySignal`). A transferred token passes the right to the next holder only while its token signal is still empty.
- **No deadline.** A signal can be added at any time, even after its day is revealed; the artists may simply ignore one that arrives too late for the day.
- **A day's signal.** `signalOf(tokenId, winningBidId)` returns the winning bid's signal, or, if that bid had none, the signal its holder added. The auction's `Won` event names the winning bid. A holder can still store a token signal on a day whose winning bid had one, but the day's signal stays the bid's.

The contracts check only a signal's byte length. Content (including control characters and invalid UTF-8) is stored and emitted verbatim, so every reader must sanitize it before display. `bid-alert.sh` does.

## Layout

```
src/
  PanoramaSeason3Auction.sol   The auction (the subject of this project)
  PanoramaSeason3SignalController.sol  Stores write-once bid and day signals
  Panorama.sol                 The live ERC-721 the auction mints from (Solady ERC721)
  PanoramaMintController.sol   Season mint caps
  interfaces/                  IPanorama, IPanoramaMintController, IPanoramaRenderer,
                               IPanoramaSeason3SignalController (what the auction calls)
test/
  PanoramaSeason3Auction.t.sol                    126 unit + fuzz tests (incl. signals,
                                                  bid tick, unique amounts, gas benchmarks)
  PanoramaSeason3SignalController.t.sol           20 controller tests (setup, bid and token
                                                  signals, write-once, no deadline,
                                                  transfers, signalOf, a full flow, gas)
  PanoramaSeason3Auction.invariants.t.sol         13 invariant campaigns (heap property,
                                                  heapPos bijection, exact solvency,
                                                  no-overmint, per-wallet cap, signal limit,
                                                  bidsAtAmount sync, unique amounts after fill,
                                                  bid signals only written by their bidder,
                                                  bid signals write-once)
  PanoramaSeason3AuctionAtomicSettlement.t.sol    5 tests: batch math plus a local
                                                  end-to-end run of DeployAuction (controller
                                                  + auction + wiring) and SettleAuctionAtomic
script/
  Base.s.sol                         Broadcaster base; requires explicit PRIVATE_KEY, no fallback
  DeployAuction.s.sol                Validated deploy: signal controller, auction, setAuction,
                                     then checks both directions and the live NFT state
  SettleAuctionAtomic.s.sol          authorize -> exact cap -> finalize -> revoke,
                                     as one EOA run or one Safe Transaction Builder batch
  DeployAuctionSepolia.s.sol         Sepolia rehearsal deploy (same validation, testnet chain gate)
  SettleAuctionAtomicSepolia.s.sol   Sepolia rehearsal settlement (same checks, testnet chain gate)
  CancelAuction.s.sol                Owner cancel while Active
  RefundAllAuction.s.sol             Permissionless batched refunds after cancel
scripts/
  auction-manifest.sh          JSON deployment manifest (addresses, codehash, immutables)
  monitor-auction.sh           Cron monitor with Discord alerts
  bid-alert.sh                 Cron Discord alert per new bid and per signal change (bid or day)
  rpc-load-test.sh             Progressive RPC capacity testing
  test-operations.sh           Network-free regression tests for the three scripts above
AUCTION_RUNBOOK.md             Deploy, settle and incident procedures
```

## Mainnet deployment

Not deployed yet.

| | |
|---|---|
| Auction | not deployed yet |
| Signal controller | not deployed yet |
| Runtime codehash | not deployed yet |
| Schedule | opens 2026-10-19 17:00 UTC (`1792429200`), runs 24h, extensions add at most 24h (absolute end 2026-10-21 17:00 UTC) |
| Reserve / increment | 0.1 ETH / 5% (500 bps), same as Season 2 |
| Proceeds | 58% payout A, 42% payout B (`SPLIT_A_BPS`, same as Season 2) |
| Manifest | create with `scripts/auction-manifest.sh` after deployment |

Season 3's first tableau publishes 2026-10-20.

The NFT is the existing Panorama collection at `0x435BD9CF72C278c9bAD9655732a6724469c6D9Ff`. Its mint controller holds seasons 1 and 2 at 90 each, so `totalMinted() == 180` and `mintCap() == 180`: exactly the state this auction requires at deploy and while bidding.

## Build and test

Requires [Foundry](https://getfoundry.sh) and [Bun](https://bun.sh) (dependencies install to `node_modules`, see `remappings.txt`).

```bash
bun install
forge build
forge build --sizes                       # runtime: auction 22,605 bytes, signal controller 4,844
forge test                                # all 164 tests
FOUNDRY_PROFILE=ci forge test \
  --match-path 'test/PanoramaSeason3*' -vv          # CI profile: 10k fuzz runs,
                                                    # 512 invariant campaigns x 128 calls
forge fmt --check
scripts/test-operations.sh                # ops script regression tests, no network
```

## Deploy and operate

Read [AUCTION_RUNBOOK.md](AUCTION_RUNBOOK.md) first. Short version:

```bash
export PRIVATE_KEY=...
export PANORAMA_NFT=0x435BD9CF72C278c9bAD9655732a6724469c6D9Ff
export PANORAMA_AUCTION_RESERVE_PRICE=100000000000000000   # 0.1 ETH (the contract floor)
export PANORAMA_AUCTION_MIN_INCREMENT_BPS=500                # 5%
export PANORAMA_AUCTION_START=1792429200                     # 2026-10-19 17:00 UTC
export PANORAMA_AUCTION_DURATION=86400                       # 24h
export PANORAMA_PAYOUT_A=... PANORAMA_PAYOUT_B=...           # 58% / 42%
forge script script/DeployAuction.s.sol:DeployAuction --rpc-url mainnet --broadcast --verify
```

`DeployAuction` sends three transactions: the signal controller, the auction (pointing at it), and `controller.setAuction(auction)`. It then verifies the wiring in both directions. Record the controller address as `PANORAMA_SIGNAL_CONTROLLER`.

All lifecycle scripts refuse to run on any chain but mainnet (the two Sepolia variants exist for rehearsals), and every post-deploy script additionally pins `PANORAMA_AUCTION_RUNTIME_CODEHASH` (obtain it independently with `cast codehash`). RPC endpoints in `foundry.toml` read `API_KEY_ALCHEMY`; Etherscan verification reads `API_KEY_ETHERSCAN`.

## Key parameters

| Constant | Value |
|---|---|
| `MAX_UNITS` | 30 (tokens #181-#210) |
| `MIN_RESERVE_PRICE` | 0.1 ETH |
| `MAX_BIDS_PER_WALLET` | 2 |
| `BID_TICK` | 0.001 ETH (bids, top-ups and the reserve are whole multiples) |
| `MAX_SIGNAL_BYTES` (controller) | 280 (UTF-8 bytes, so fewer characters for non-ASCII text) |
| `EXT_WINDOW` / `EXT_LEN` | 5 min / 10 min (anti-snipe) |
| `MAX_TOTAL_EXTENSION` | 24 h past scheduled end |
| `FINALIZE_GRACE` | 7 days (then finalize is permissionless) |
| `EMERGENCY_GRACE` | 30 days past `absoluteEndTime` |
| `SPLIT_A_BPS` | 5800 (58/42 proceeds split, immutable recipients) |

Gas, measured with `forge test --isolate --gas-report`: one `finalize(30)` settles all 30 winners for about 3.4M gas. When every winner is a contract that burns its whole 100k refund stipend, the same call costs about 7.0M. As isolated transactions (21k base included), a first bid costs about 221k gas, and a bid that displaces the floor about 224k. Signals are stored, so they cost about 22k gas per 32 bytes: a first bid with a full 280-byte signal costs about 458k, `setBidSignal` with 280 bytes about 261k and `setTokenSignal` with 280 bytes about 259k (a short signal costs far less).
