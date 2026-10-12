import { describe, expect, it } from "vitest";
import {
	BaseError,
	ContractFunctionRevertedError,
	UserRejectedRequestError,
	encodeErrorResult,
	parseEther,
} from "viem";
import { panoramaAuctionAbi, panoramaAuctionWriteAbi } from "@/lib/abis/panoramaAuction";
import { signalControllerAbi } from "@/lib/abis/signalController";
import { describeAuctionError } from "@/lib/auctionErrors";

function revertError(errorName: string, args: readonly unknown[] = []): BaseError {
	const data = encodeErrorResult({
		abi: panoramaAuctionAbi,
		errorName,
		args,
		// Dynamic error name for test brevity; runtime-validated by encodeErrorResult.
	} as Parameters<typeof encodeErrorResult>[0]);
	const revert = new ContractFunctionRevertedError({
		abi: panoramaAuctionAbi,
		functionName: "placeBid",
		data,
	});
	return new BaseError("Execution reverted.", { cause: revert });
}

/** A revert the way viem reports it when the call was decoded with the controller errors in the ABI. */
function controllerError(
	errorName: string,
	args: readonly unknown[] = [],
	functionName: "placeBid" | "setTokenSignal" = "setTokenSignal",
): BaseError {
	const abi = functionName === "placeBid" ? panoramaAuctionWriteAbi : signalControllerAbi;
	const data = encodeErrorResult({ abi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
	const revert = new ContractFunctionRevertedError({ abi, functionName, data });
	return new BaseError("Execution reverted.", { cause: revert });
}

describe("describeAuctionError", () => {
	it("decodes BidTooLow with a ceil-formatted minimum", () => {
		const msg = describeAuctionError(revertError("BidTooLow", [parseEther("0.11025")]));
		expect(msg).toBe("Bid too low. The minimum right now is 0.11025 ETH.");
	});

	it("never understates the decoded minimum", () => {
		// 0.110250000000000001 must NOT display as 0.11025 (typing that would revert again).
		const min = parseEther("0.11025") + 1n;
		const msg = describeAuctionError(revertError("BidTooLow", [min]));
		expect(msg).toContain("0.110251");
	});

	it("decodes BidIncreaseTooLow", () => {
		const msg = describeAuctionError(revertError("BidIncreaseTooLow", [parseEther("0.005")]));
		expect(msg).toBe("Raises in the final five minutes must add at least 0.005 ETH.");
	});

	it("covers the common bidding reverts with human copy", () => {
		expect(describeAuctionError(revertError("AuctionEnded"))).toBe("Bidding has ended.");
		expect(describeAuctionError(revertError("BelowReserve"))).toBe(
			"Bid is below the reserve price.",
		);
		expect(describeAuctionError(revertError("TooManyBids"))).toBe(
			"This wallet already holds the maximum of 2 bids.",
		);
		expect(describeAuctionError(revertError("AmountNotOnTick"))).toBe("Bids go in steps of 0.001 ETH.");
		expect(describeAuctionError(revertError("AmountTaken", [110_000_000_000_000_000n]))).toBe(
			"Someone already holds that amount. Try 0.001 more or less.",
		);
		expect(describeAuctionError(revertError("IsPaused"))).toBe("Bidding is paused.");
		expect(describeAuctionError(revertError("UnexpectedSupply", [180n, 181n]))).toContain(
			"halted",
		);
	});

	it("decodes the signal controller's errors, including through placeBid", () => {
		expect(describeAuctionError(controllerError("SignalTooLong", [280n], "placeBid"))).toBe(
			"A signal holds at most 280 bytes. Shorten it and send again.",
		);
		expect(describeAuctionError(controllerError("SignalAlreadySet"))).toBe(
			"This already has a signal. Signals can't be changed.",
		);
		expect(describeAuctionError(controllerError("EmptySignal"))).toBe("Write something first.");
		expect(describeAuctionError(controllerError("NotTokenHolder"))).toBe(
			"Only the wallet holding this day can add its signal.",
		);
		expect(describeAuctionError(controllerError("NotBidder"))).toBe(
			"Only the bidder can add a signal to this bid, and only while the bid is live.",
		);
	});

	it("the auction write ABI carries the controller errors placeBid can bubble up", () => {
		const names = panoramaAuctionWriteAbi.filter((x) => x.type === "error").map((x) => x.name);
		expect(names).toContain("SignalTooLong");
		expect(panoramaAuctionAbi.some((x) => x.type === "error" && (x.name as string) === "SignalTooLong")).toBe(false);
	});

	it("returns null for user rejections (nothing to toast)", () => {
		const rejection = new BaseError("User rejected the request.", {
			cause: new UserRejectedRequestError(new Error("User rejected the request.")),
		});
		expect(describeAuctionError(rejection)).toBeNull();
		expect(describeAuctionError({ code: 4001, message: "User rejected" })).toBeNull();
	});

	it("falls back to the first line of unknown errors", () => {
		const msg = describeAuctionError(new Error("boom\nsecond line"));
		expect(msg).toBe("boom");
	});

	it("returns null for nullish input", () => {
		expect(describeAuctionError(null)).toBeNull();
		expect(describeAuctionError(undefined)).toBeNull();
	});
});

describe("wallet-side send failures", () => {
	// viem wraps anything the wallet refuses in one generic sentence; the reason lives in details.
	function walletError(details: string): BaseError {
		const err = new BaseError("Transaction creation failed.", { details });
		return err;
	}

	it("explains a lost race instead of the generic wrapper", () => {
		expect(describeAuctionError(walletError("execution reverted"))).toBe(
			"The minimum moved before your wallet sent this. Re-check the minimum and bid again.",
		);
		expect(describeAuctionError(walletError("cannot estimate gas; transaction may fail"))).toBe(
			"The minimum moved before your wallet sent this. Re-check the minimum and bid again.",
		);
	});

	it("names the common wallet refusals", () => {
		expect(describeAuctionError(walletError("insufficient funds for gas * price + value"))).toBe(
			"Not enough ETH for the bid plus gas in this wallet.",
		);
		expect(describeAuctionError(walletError("nonce too low"))).toContain("earlier transaction");
		expect(describeAuctionError(walletError("Failed to fetch"))).toContain("could not reach the network");
	});

	it("falls back to the wallet's own words, never to the bare wrapper", () => {
		const msg = describeAuctionError(walletError("Provider disconnected while signing"));
		expect(msg).toBe("Your wallet refused the transaction: Provider disconnected while signing");
	});

	it("still returns null for a user rejection", () => {
		expect(describeAuctionError(new UserRejectedRequestError(new Error("denied")))).toBeNull();
	});
});
