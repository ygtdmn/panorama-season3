// Centralized constants — single source of truth for URLs and config

import { ENV } from "./env";

export const CDN_BASE_URL =
	process.env.NEXT_PUBLIC_CDN_BASE_URL ||
	"https://cdn.panorama.garden";

// Validated against the configured chain in env.ts; the default follows the chain too, so
// a sepolia build never links bidders to mainnet Etherscan pages that cannot show their txs.
export const BLOCK_EXPLORER_URL =
	ENV.blockExplorerUrl ||
	(ENV.chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io");

export const OPENSEA_COLLECTION_SLUG = "panorama-by-ygtdmn";
export const OPENSEA_COLLECTION_URL = `https://opensea.io/collection/${OPENSEA_COLLECTION_SLUG}`;

// The main Panorama site (links out to the canvas, terminal, about pages).
export const SITE_URL = "https://panorama.garden";

// This app's own public origin. Used wherever the site identifies itself: WalletConnect
// metadata, Open Graph canonical URLs. Must match the deployed host, or wallets show a
// mismatched origin during connection prompts.
export const AUCTION_SITE_URL = "https://season3.panorama.garden";

// Public source + on-chain code links, so anyone can read the contract before bidding.
export const GITHUB_URL =
	process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/ygtdmn/panorama-season3";

// Season 3 has no audit of its own. The contract is the audited Season 2 auction contract with
// unaudited changes (30 units from #181, the signal, 2 bids per wallet, 0.001 ETH steps, unique
// amounts once full); this is the Season 2 report, and every place that links it says so.
export const SEASON_2_AUDIT_REPORT_URL =
	"https://github.com/ygtdmn/panorama-season-2-auction/blob/main/Audit.pdf";

// The artists.
export const X_YIGIT = "https://x.com/YigitDuman";
export const X_KIRILL = "https://x.com/palekirill";

/** evm.now shows a contract's verified/decompiled source by address. */
export function getEvmNowUrl(address: string): string {
	return `https://evm.now/address/${address}/code`;
}

export const OG_IMAGE_URL = `${CDN_BASE_URL}/season3/season3-og-preview.webp`;

export function getBlockExplorerAddressUrl(address: string): string {
	return `${BLOCK_EXPLORER_URL}/address/${address}`;
}

export function getBlockExplorerTxUrl(hash: string): string {
	return `${BLOCK_EXPLORER_URL}/tx/${hash}`;
}

export const PANORAMA_AUCTION_ADDRESS = (process.env
	.NEXT_PUBLIC_PANORAMA_AUCTION_ADDRESS || "") as `0x${string}`;

// Block the auction contract was deployed at. Bounds the Won log scan that powers the
// settlement standings; 0 means "from genesis" (works, but slow on some RPC providers).
export const AUCTION_DEPLOY_BLOCK = BigInt(
	process.env.NEXT_PUBLIC_AUCTION_DEPLOY_BLOCK || "0",
);

