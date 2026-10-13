# Panorama Season 3: Nothing Remains the Same

The smart contract, tests, operations tooling, and web frontend for the [Panorama](https://panorama.garden) Season 3 sale: a multi-unit English auction with a uniform clearing price, selling tokens #181-#210 of the Panorama ERC-721 collection on Ethereum mainnet.

Panorama is an autonomous generative art system that generates one segment of a continuously expanding panorama every day, driven by on-chain price data. Season 1 (#1-#90) was myth. Season 2 (#91-#180) was ninety technologies, with DeltaSauce. Season 3 is thirty days, a collaboration between Yigit Duman and Pale Kirill, and this repository sells all thirty tokens in a single auction.

## The season

Thirty days in six zones of five days. The panorama travels from a city read as a system back to land that has not formed yet:

| Zone | Tokens | |
|---|---|---|
| Interface | #181-#185 | the city read as a system, interface over solid architecture |
| City | #186-#190 | continuous city fabric, streets and blocks |
| Suburb | #191-#195 | the low edge of the city, loose low-rise buildings, a lot of sky |
| Village | #196-#200 | sparse rural settlement, wooden architecture, open land |
| Nature | #201-#205 | wild landscape before the city, almost no buildings |
| Abstract | #206-#210 | land still forming, heavy unnamed masses, the scene unloading |

The zones come from Pale Kirill's day generator. The market still sets each day's mood.

## Signals

A signal is optional: up to 280 characters of text for the day a bid wins, or simply a signal to the universe. The artists may use or ignore any signal. A signal never affects price, rank, or settlement. Signals are public.

Signals live in a separate contract, `PanoramaSeason3SignalController`.

- **With the bid or later.** Bid with your signal in a single transaction (the auction passes it to the controller), or add one later to a bid that has none while the bid is live.
- **After the sale, the holder.** The holder of a day's token can add a signal to that day.
- **Never changed.** A signal cannot be replaced or cleared once written. A token passes the right to add one to its next holder only while none has been added yet.
- **No deadline.** A signal can be added at any time, even after its day is revealed; the artists may simply ignore one that arrives too late.
- **A day's signal** is the winning bid's signal, or its holder's if that bid had none.

## Mainnet deployment

Not deployed yet. Bidding opens 2026-10-19 17:00 UTC and runs 24 hours, with at most 24 further hours of anti-snipe extension. Reserve 0.1 ETH, minimum increment 5%, proceeds split 58/42. Day 1 of the season publishes on 2026-10-20. Mainnet Panorama stands at `totalMinted() == 180` after the Season 2 settlement, which is exactly the supply this auction requires to open.

## How the auction works

- **Bid the maximum you are willing to pay.** The top 30 bids win. Every winner pays the same price: the 30th-highest bid (the clearing price). The excess over the clearing price is refunded at settlement.
- **Reserve.** No bid below 0.1 ETH is ever accepted (`MIN_RESERVE_PRICE`).
- **Steps of 0.001 ETH.** Every bid and every top-up is a whole number of 0.001 ETH (`BID_TICK`).
- **Once 30 bids are in**, a new bid must beat the current lowest winning bid by 5% (`minIncrementBps`), rounded up to the next 0.001 ETH. The displaced bidder is refunded in the same transaction.
- **Unique amounts once full.** When all 30 days are held, every bid must be a different amount, raises included. `minimumBid()` always returns an amount that is free.
- **Up to 2 bids per wallet.** Each bid is independent and can win its own token.
- **Anti-snipe.** A qualifying bid inside the final 5 minutes extends the auction by 10 minutes, capped at 24 hours past the scheduled end.
- **Ties** (possible only before the auction fills) go to the earlier bid.
- **Settlement.** `finalize` mints winners highest-bid-first (the top bid receives #181, the first day of Interface), refunds the excess, and splits proceeds 58/42 between two fixed payout addresses.

The trust model and every permissionless recovery path (`finalize` after 7 days, `refundAll`, `recoverFromSupplyMismatch`, `recoverFromMintingUnavailable`, `emergencyRefund`, `withdraw`) are unchanged from Season 2, and the frontend's public `/recovery` page drives each of them.

## Relationship to Season 2

`PanoramaSeason3Auction` is the [Season 2 auction](https://github.com/ygtdmn/panorama-season-2-auction) contract, audited in July 2026, with these changes:

1. 30 units from #181 (`MAX_UNITS = 30`, `FIRST_TOKEN_ID = 181`).
2. The optional signal: `placeBid(string signal)` takes a signal of up to 280 bytes.
3. Signals moved to a separate controller contract, `PanoramaSeason3SignalController`, where they are write-once and can be added later by the bidder or the token holder, with no deadline.
4. A wallet limit of 2 bids (Season 2 allowed 4).
5. A 0.001 ETH bid tick for bids, top-ups and the reserve.
6. Unique amounts once all 30 days are held, for new bids and raises.

Everything else, the 58/42 split included, is the Season 2 code unchanged. These changes and the signal controller were not re-audited.

## Repository layout

```
contracts/   Foundry project: the auction contract, the signal controller,
             the Panorama NFT + mint controller it mints from, tests (unit, fuzz, invariant,
             atomic-settlement), lifecycle forge scripts, shell tooling.
frontend/    Standalone Next.js app: public bidding page (/) built around the
             route board (the thirty days as the auction board),
             wallet-gated owner console with the signal reader (/admin),
             and public recovery tools (/recovery).
```

- [contracts/README.md](contracts/README.md)
- [frontend/README.md](frontend/README.md)

## Quick start

```bash
cd contracts
bun install
forge test
```

```bash
cd frontend
pnpm install
pnpm dev        # http://localhost:5476/auction?demo=1 for an in-memory simulation
```

## License

[MIT](LICENSE.md)
