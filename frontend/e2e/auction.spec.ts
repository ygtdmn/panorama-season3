import { expect, test } from "@playwright/test";
import {
	BIDDER,
	OWNER,
	STRANGER,
	bot,
	chainNow,
	connectWallet,
	finalizeRaw,
	fillBids,
	installWallet,
	mine,
	ownerOf,
	placeBidRaw,
	readAuction,
	readBidSignals,
	bidSignalCallReverts,
	readState,
	RPC_URL,
	rpc,
	setAuctionOperator,
	warpTo,
} from "./helpers";

const S = readState();
const ETH = 10n ** 18n;
const eth = (n: number) => (BigInt(Math.round(n * 1e6)) * ETH) / 1_000_000n;

// Every test mutates chain state and time; snapshot/revert keeps them independent.
let snapshotId: string;
test.beforeEach(async () => {
	snapshotId = await rpc<string>("evm_snapshot");
});
test.afterEach(async () => {
	// A failed assertion must not leak a paused miner into the next test.
	await rpc("evm_setAutomine", [true]);
	await mine();
	await rpc("evm_revert", [snapshotId]);
});

test.describe("bidding", () => {
	test("places a bid at the exact advertised minimum", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await expect(page.getByText("Place a bid")).toBeVisible();

		await connectWallet(page);

		// The quick-fill writes the EXACT contract minimum into the input (dot decimal).
		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await expect(page.getByLabel("Bid amount in ETH")).toHaveValue("0.1");

		await page.getByRole("button", { name: "place bid" }).click();
		await expect(page.getByText("Bid placed.")).toBeVisible();
		await expect(page.getByText(/Your bids \/ 1/)).toBeVisible();
		await expect(
			page.locator("[data-route-board]").getByText("you", { exact: true }),
		).toBeVisible();
	});

	test("a reverted bid surfaces an error toast and the form recovers", async ({ page }) => {
		// Full auction: floor 0.1 (one bot), the other 29 at 0.3. Minimum = 0.105.
		await placeBidRaw(S.auction, bot(0), eth(0.1));
		await fillBids(S.auction, 29, eth(0.3));

		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		await page.getByRole("button", { name: /^min 0\.105 eth$/i }).click();

		// Freeze mining, let the UI submit against the current state, then front-run it:
		// the bot displaces the 0.1 floor with 0.105, so the user's identical 0.105 lands
		// below the new minimum and reverts on-chain (BidTooLow at execution time).
		await rpc("evm_setAutomine", [false]);
		await page.getByRole("button", { name: "place bid" }).click();
		await placeBidRaw(S.auction, bot(99), eth(0.105), { gasPriceGwei: 100 });
		await rpc("evm_setAutomine", [true]);
		await mine();

		// Scope to toast alerts (the status region) so a transient stale-data banner never
		// satisfies or pollutes the assertion.
		await expect(page.locator('div[role="status"] [role="alert"]').first()).toBeVisible({
			timeout: 30_000,
		});
		// The form recovers to idle. The stale 0.105 in the input is now held by the bot and
		// below the new minimum, so the button says why it is disabled ("amount taken").
		await expect(page.getByRole("button", { name: "amount taken" })).toBeDisabled({
			timeout: 30_000,
		});
	});

	test("a displaced bid shows the outbid notice", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await page.getByRole("button", { name: "place bid" }).click();
		await expect(page.getByText(/Your bids \/ 1/)).toBeVisible();

		// 29 bids at 0.2 fill the board; the 30th pushes the user's 0.1 out. Once all 30 days are
		// held, amounts must be unique, so it bids 0.21 instead of another 0.2.
		await fillBids(S.auction, 29, eth(0.2));
		await placeBidRaw(S.auction, bot(29), eth(0.21));

		await expect(page.getByText(/You were outbid/)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/Your bids \/ 1/)).not.toBeVisible();
	});

	test("a qualifying late bid extends the auction on screen", async ({ page }) => {
		await fillBids(S.auction, 3, eth(0.15));
		const end = Number(await readAuction<bigint>(S.auction, "endTime"));

		await installWallet(page, BIDDER);
		await page.goto("/");
		await expect(page.getByText("Place a bid")).toBeVisible();

		await warpTo(end - 120);
		await placeBidRaw(S.auction, bot(50), eth(0.25));

		await expect(page.getByText(/extended 1×/)).toBeVisible({ timeout: 30_000 });
		const newEnd = Number(await readAuction<bigint>(S.auction, "endTime"));
		expect(newEnd).toBeGreaterThan(end);
	});

	test("a wallet rejection returns the form to idle without an error toast", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await page.evaluate(() => {
			(window as unknown as { __rejectNextTx?: boolean }).__rejectNextTx = true;
		});
		await page.getByRole("button", { name: "place bid" }).click();

		// Rejection is not an error: no toast appears, the button simply returns.
		await expect(page.getByRole("button", { name: "place bid" })).toBeEnabled({
			timeout: 15_000,
		});
		await expect(page.locator('div[role="status"] [role="alert"]')).toHaveCount(0);
	});

	test("malformed bid text is rejected without changing its magnitude", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		const input = page.getByLabel("Bid amount in ETH");
		await input.fill("1e5");
		await expect(input).toHaveValue("1e5");
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByText(/Enter one plain decimal amount/)).toBeVisible();
		await expect(page.getByRole("button", { name: "place bid" })).toBeDisabled();
		expect(Number(await readAuction<bigint>(S.auction, "activeBids"))).toBe(0);
	});

	test("a replaced transaction does not wedge the UI", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();

		await rpc("evm_setAutomine", [false]);
		await page.getByRole("button", { name: "place bid" }).click();
		await expect(page.getByRole("button", { name: /transaction pending…/ })).toBeVisible();

		// Replace the pending tx: same account, same nonce, higher gas price, no calldata
		// (the shape a wallet's own "cancel" button produces).
		const nonce = await rpc<string>("eth_getTransactionCount", [BIDDER, "latest"]);
		await rpc("anvil_impersonateAccount", [BIDDER]);
		await rpc("eth_sendTransaction", [
			{ from: BIDDER, to: BIDDER, value: "0x0", nonce, gasPrice: "0x2e90edd000", gas: "0x5208" },
		]);
		await rpc("evm_setAutomine", [true]);
		await mine();

		// Only a proven terminal replacement unlocks the form. A polling timeout alone would
		// remain in the locked "status unknown" state to prevent a duplicate bid.
		await expect(page.getByRole("button", { name: "place bid" })).toBeEnabled({
			timeout: 90_000,
		});
		expect(Number(await readAuction<bigint>(S.auction, "activeBids"))).toBe(0);
	});
});

test.describe("signals", () => {
	test("a bid carries its signal, shown on the bid and on the board", async ({ page }) => {
		// A bot bid with a signal is already on the board (bid 1).
		await placeBidRaw(S.auction, bot(1), eth(0.2), { signal: "rain on a bus shelter" });

		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);
		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();

		const field = page.getByLabel("Signal", { exact: true });
		await field.fill("a".repeat(281));
		await expect(page.getByText("281 / 280 bytes")).toBeVisible();
		await expect(page.getByRole("button", { name: "signal too long" })).toBeDisabled();

		// Trimmed before counting and sending; the newline stays.
		await field.fill("  the street I grew up on\nat dusk  ");
		await expect(page.getByText("31 / 280 bytes")).toBeVisible();
		await page.getByRole("button", { name: /^place bid$/ }).click();
		// Write-once: the sanitized text comes back for a confirm before anything is sent.
		const confirm = page.getByRole("group", { name: "Confirm signal" });
		await expect(confirm.getByText("This is permanent. Send it as written?")).toBeVisible();
		await expect(confirm.getByText(/the street I grew up on\s+at dusk/)).toBeVisible();
		expect(Number(await readAuction<bigint>(S.auction, "activeBids"))).toBe(1); // only the bot's
		await confirm.getByRole("button", { name: "confirm and place bid" }).click();
		await expect(page.getByText("Bid placed.")).toBeVisible();
		await expect(field).toHaveValue("");

		// Stored on the signal controller in the same transaction: exactly the sanitized text.
		expect(await readBidSignals(S.signals, [1, 2])).toEqual([
			"rain on a bus shelter",
			"the street I grew up on\nat dusk",
		]);

		// On the bidder's own bid.
		await expect(page.getByText("Your signal", { exact: true })).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/the street I grew up on\s+at dusk/).first()).toBeVisible();

		// On the route: a marker that reveals the text on focus, for both bids.
		const route = page.locator("[data-route-board]");
		const theirs = route.getByRole("button", { name: /^Signal on bid 1:/ });
		await expect(theirs).toBeVisible();
		await theirs.focus();
		await expect(page.getByRole("tooltip")).toHaveText("rain on a bus shelter");
		await expect(route.getByRole("button", { name: /^Signal on bid 2:/ })).toBeVisible();
	});

	test("a signal can be added later from Your bids, once; a second add is refused", async ({ page }) => {
		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		// Bid without a signal.
		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await page.getByRole("button", { name: /^place bid$/ }).click();
		await expect(page.getByText("Bid placed.")).toBeVisible();
		await expect(page.getByText("No signal yet")).toBeVisible({ timeout: 30_000 });

		// Add one, later, from Your bids (trimmed before it is stored).
		await page.getByRole("button", { name: "add a signal", exact: true }).click();
		await page.getByLabel("Add a signal").fill("  a field where the road ends ");
		await page.getByRole("button", { name: "save signal" }).click();
		// Confirm step: "edit" goes back to the text, then confirm sends it.
		const confirm = page.getByRole("group", { name: "Confirm signal" });
		await expect(confirm.getByText("a field where the road ends")).toBeVisible();
		await confirm.getByRole("button", { name: "edit" }).click();
		await expect(page.getByLabel("Add a signal")).toHaveValue("  a field where the road ends ");
		await page.getByRole("button", { name: "save signal" }).click();
		await confirm.getByRole("button", { name: "confirm" }).click();
		await expect(page.getByText("Signal saved.")).toBeVisible();
		await expect(page.getByText("a field where the road ends").first()).toBeVisible({
			timeout: 30_000,
		});
		expect(await readBidSignals(S.signals, [1])).toEqual(["a field where the road ends"]);

		// Write-once: the console no longer offers an add, and the contract refuses a second one.
		await expect(page.getByRole("button", { name: "add a signal", exact: true })).toHaveCount(0);
		expect(await bidSignalCallReverts(S.signals, BIDDER, 1, "a second thought")).toBe(true);
		expect(await readBidSignals(S.signals, [1])).toEqual(["a field where the road ends"]);

		// The route marker shows the stored signal.
		const marker = page.locator("[data-route-board]").getByRole("button", { name: /^Signal on bid 1:/ });
		await marker.focus();
		await expect(page.getByRole("tooltip")).toHaveText("a field where the road ends");
	});
});

test.describe("wallet dialog accessibility", () => {
	test("places and traps focus, closes on Escape, and restores the trigger", async ({ page }) => {
		await page.goto("/");

		const trigger = page.getByRole("button", { name: "connect wallet" }).first();
		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "connect wallet" });
		await expect(dialog).toBeVisible();
		const close = dialog.getByRole("button", { name: "Close" });
		await expect(close).toBeFocused();

		await page.keyboard.press("Tab");
		const forwardFocus = await page.evaluate(() => ({
			tag: document.activeElement?.tagName,
			label: document.activeElement?.getAttribute("aria-label"),
			inside: !!document.activeElement?.closest('[role="dialog"]'),
		}));
		expect(forwardFocus.inside).toBe(true);
		expect(forwardFocus.tag).toBe("BUTTON");
		expect(forwardFocus.label).not.toBe("Close");
		await page.keyboard.press("Tab");
		await expect(close).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		expect(
			await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
		).toBe(true);

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});
});

test.describe("bid rules", () => {
	test("off-tick and held amounts are refused before sending", async ({ page }) => {
		// Thirty days held at 0.2, then a bot takes 0.25 (displacing one 0.2).
		await fillBids(S.auction, 30, eth(0.2));
		await placeBidRaw(S.auction, bot(99), eth(0.25));

		await installWallet(page, BIDDER);
		await page.goto("/");
		await connectWallet(page);

		const input = page.getByLabel("Bid amount in ETH");
		await input.fill("0.2505");
		await expect(page.getByText("Bids go in steps of 0.001 ETH")).toBeVisible();
		await expect(page.getByRole("button", { name: "place bid" })).toBeDisabled();

		await input.fill("0.25");
		await expect(page.getByRole("button", { name: "amount taken" })).toBeDisabled();

		await input.fill("0.251");
		await page.getByRole("button", { name: "place bid" }).click();
		await expect(page.getByText("Bid placed.")).toBeVisible();
	});
});

test.describe("settlement and recovery", () => {
	test("owner settles in batches from the console and results persist on the board", async ({
		page,
	}) => {
		// Five bids, strictly descending expectations: bot(4)=0.5 ... bot(0)=0.1.
		for (let i = 0; i < 5; i++) {
			await placeBidRaw(S.auction, bot(i), eth(0.1 + 0.1 * i));
		}
		const end = Number(await readAuction<bigint>(S.auction, "endTime"));
		await warpTo(end + 5);

		await installWallet(page, OWNER);
		await page.goto("/admin");
		await connectWallet(page);
		await expect(page.getByText("Settlement", { exact: true })).toBeVisible();

		await page.getByLabel("Finalize batch size").fill("3");
		await page.getByRole("button", { name: /finalize 3/ }).click();
		await expect(page.getByText(/settling 3\/5/)).toBeVisible({ timeout: 30_000 });

		await page.getByRole("button", { name: /finalize 3/ }).click();
		await expect(page.getByText(/settled \//)).toBeVisible({ timeout: 30_000 });

		// Highest bid gets the earliest token (#181, Day 1 of Interface).
		expect(await ownerOf(S.nft, 181)).toBe(bot(4).toLowerCase());
		expect(await ownerOf(S.nft, 185)).toBe(bot(0).toLowerCase());

		// The public board persists after settlement, fed by Won events.
		// exact: true so the FAQ copy ("Winners are minted after…") doesn't match.
		await page.goto("/");
		const board = page.locator("[data-route-board]");
		await expect(board.getByText("minted", { exact: true }).first()).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText("Final price")).toBeVisible();
		expect(await board.getByText("minted", { exact: true }).count()).toBe(5);
	});

	test("cancel then batched refunds complete recovery", async ({ page }) => {
		await fillBids(S.auction, 5, eth(0.15));

		await installWallet(page, OWNER);
		await page.goto("/admin");
		await connectWallet(page);

		page.on("dialog", (d) => d.accept());
		await page.getByRole("button", { name: "cancel auction" }).click();
		await expect(page.getByText(/5 bids remaining/)).toBeVisible({ timeout: 30_000 });

		await page.getByLabel("Finalize batch size").fill("3");
		await page.getByRole("button", { name: /refund all 3/ }).click();
		await expect(page.getByText(/2 bids remaining/)).toBeVisible({ timeout: 30_000 });

		await page.getByRole("button", { name: /refund all 3/ }).click();
		await expect(page.getByText(/refunds complete/)).toBeVisible({ timeout: 30_000 });
	});

	test("anyone can settle from /recovery after the grace period", async ({ page }) => {
		await fillBids(S.auction, 4, eth(0.12));
		const end = Number(await readAuction<bigint>(S.auction, "endTime"));
		await warpTo(end + 7 * 24 * 3600 + 120);

		await installWallet(page, STRANGER);
		await page.goto("/recovery");
		await expect(page.getByText("Settle the auction yourself")).toBeVisible();
		await expect(page.getByText("open to anyone")).toBeVisible({ timeout: 30_000 });

		await connectWallet(page);
		await page.getByRole("button", { name: /settle next 30/ }).click();
		await expect(page.getByText("Transaction confirmed.")).toBeVisible({ timeout: 30_000 });

		expect(Number(await readAuction<bigint>(S.auction, "phase"))).toBe(2); // Settled
	});

	test("anyone can recover after grace when minting is objectively unavailable", async ({
		page,
	}) => {
		await fillBids(S.auction, 4, eth(0.12));
		await setAuctionOperator(S.nft, S.auction, false);
		const end = Number(await readAuction<bigint>(S.auction, "endTime"));
		await warpTo(end + 7 * 24 * 3600 + 1);

		await installWallet(page, STRANGER);
		await page.goto("/recovery");
		const settleTool = page
			.getByRole("heading", { name: "Settle the auction yourself" })
			.locator("xpath=ancestor::li");
		const recoveryTool = page
			.getByRole("heading", { name: "Minting capability recovery" })
			.locator("xpath=ancestor::li");
		await expect(settleTool.getByText("minting recovery required")).toBeVisible();
		await expect(recoveryTool.getByText("open to anyone")).toBeVisible();

		await connectWallet(page);
		await recoveryTool.getByRole("button", { name: "start recovery" }).click();
		await expect(page.getByText("Transaction confirmed.")).toBeVisible({ timeout: 30_000 });
		expect(Number(await readAuction<bigint>(S.auction, "phase"))).toBe(3); // Cancelled
		expect(Number(await readAuction<bigint>(S.auction, "activeBids"))).toBe(0);
	});

	test("a failed winner-log read never reports a false empty final board", async ({ page }) => {
		await fillBids(S.auction, 2, eth(0.12));
		const end = Number(await readAuction<bigint>(S.auction, "endTime"));
		await warpTo(end + 1);
		await finalizeRaw(S.auction, 45n);

		await page.route(RPC_URL, async (route) => {
			const payload = route.request().postDataJSON() as {
				id?: number;
				method?: string;
			};
			if (payload.method !== "eth_getLogs") return route.continue();
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: payload.id ?? 1,
					error: { code: -32000, message: "forced winner-log failure" },
				}),
			});
		});
		await page.goto("/");
		await expect(page.getByText(/Final standings are not being reported as complete/)).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText("Winner history is not complete yet.")).toBeVisible();
		await expect(page.getByText("Closed with no bids.")).toHaveCount(0);
	});
});

test.describe("demo", () => {
	test("demo mode runs the bidding flow fully in memory", async ({ page }) => {
		await page.goto("/?demo=1");
		await expect(page.getByText(/demo/i).first()).toBeVisible();

		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await page.getByLabel("Signal", { exact: true }).fill("demo signal");
		await page.getByRole("button", { name: "place bid" }).click();
		await page.getByRole("button", { name: "confirm and place bid" }).click();
		await expect(page.getByText(/Your bids \/ 1/)).toBeVisible();
		await expect(page.getByText("Your signal", { exact: true })).toBeVisible();
		await expect(page.getByText("demo signal").first()).toBeVisible();
	});
});

test.describe("mobile", () => {
	test("the bid form sits above the details essay and a bid goes through @mobile", async ({
		page,
	}) => {
		await installWallet(page, BIDDER);
		await page.goto("/");

		// The hero primer is first, but the bid form must come before the long details
		// essay so nobody has to scroll past an essay to bid in the final minutes.
		const bidBox = await page.getByText("Place a bid").boundingBox();
		const detailsBox = await page.getByRole("heading", { name: "The sale" }).boundingBox();
		expect(bidBox && detailsBox && bidBox.y < detailsBox.y).toBe(true);

		await connectWallet(page);
		await page.getByRole("button", { name: /^min 0\.1 eth$/i }).click();
		await page.getByRole("button", { name: "place bid" }).click();
		await expect(page.getByText("Bid placed.")).toBeVisible();
	});
});
