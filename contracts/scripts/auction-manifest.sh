#!/usr/bin/env bash
# Emits a deployment manifest for the Season 3 auction and its signal controller as JSON on
# stdout. Captures everything needed to re-verify the deployment later: addresses, codehashes,
# every immutable, live NFT/mint controller state, git commit, and chain
# context. Fails (no output) when the signal controller does not point back at the auction, or
# when PANORAMA_SIGNAL_CONTROLLER is set and differs from the auction's signalController().
#
# Usage:
#   RPC_URL=https://... PANORAMA_AUCTION_ADDRESS=0x... scripts/auction-manifest.sh \
#     > deployments/auction-$(date -u +%Y%m%d).json
#
# Both settings fall back to the project .env (read as data, never sourced): the
# auction address from PANORAMA_AUCTION_ADDRESS, and RPC_URL formed from
# API_KEY_ALCHEMY exactly like foundry.toml's rpc_endpoints (RPC_CHAIN=mainnet|sepolia
# picks the network, default mainnet).
#
# Requires: cast (foundry), git, jq (optional; output is valid JSON without it).
set -euo pipefail

# Read one value from the project .env as plain data (never sourced/executed).
dotenv_lookup() {
  local file line
  file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/.env"
  [[ -f "$file" ]] || return 0
  line=$(grep -E "^${1}=" "$file" | tail -n 1) || return 0
  line=${line#*=}
  line=${line%$'\r'}
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  line=${line%\"}; line=${line#\"}
  line=${line%\'}; line=${line#\'}
  printf '%s' "$line"
}

# Alchemy endpoint from API_KEY_ALCHEMY (env or .env), same shape as foundry.toml.
rpc_url_default() {
  local key chain
  key=${API_KEY_ALCHEMY:-$(dotenv_lookup API_KEY_ALCHEMY)}
  [[ -n "$key" ]] || return 0
  chain=${RPC_CHAIN:-mainnet}
  case "$chain" in
    mainnet | sepolia) printf 'https://eth-%s.g.alchemy.com/v2/%s' "$chain" "$key" ;;
    *)
      printf 'RPC_CHAIN must be mainnet or sepolia, got: %s\n' "$chain" >&2
      return 1
      ;;
  esac
}

RPC_URL=${RPC_URL:-$(rpc_url_default)}
PANORAMA_AUCTION_ADDRESS=${PANORAMA_AUCTION_ADDRESS:-$(dotenv_lookup PANORAMA_AUCTION_ADDRESS)}

: "${RPC_URL:?RPC_URL is required (set it, or provide API_KEY_ALCHEMY in the environment or .env)}"
: "${PANORAMA_AUCTION_ADDRESS:?PANORAMA_AUCTION_ADDRESS is required (set it in the environment or .env)}"

[[ "$PANORAMA_AUCTION_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || { printf 'PANORAMA_AUCTION_ADDRESS is not a 20-byte hex address: %s\n' "$PANORAMA_AUCTION_ADDRESS" >&2; exit 1; }

A="$PANORAMA_AUCTION_ADDRESS"
call() { cast call "$A" "$1" --rpc-url "$RPC_URL" | awk '{print $1}'; }

NFT=$(call 'nft()(address)')
CONTROLLER=$(cast call "$NFT" 'mintController()(address)' --rpc-url "$RPC_URL" | awk '{print $1}')
SIGNALS=$(call 'signalController()(address)')
scall() { cast call "$SIGNALS" "$1" --rpc-url "$RPC_URL" | awk '{print $1}'; }

EXPECTED_SIGNALS=${PANORAMA_SIGNAL_CONTROLLER:-$(dotenv_lookup PANORAMA_SIGNAL_CONTROLLER)}
if [[ -n "$EXPECTED_SIGNALS" && "${EXPECTED_SIGNALS,,}" != "${SIGNALS,,}" ]]; then
  printf 'auction.signalController() is %s, expected PANORAMA_SIGNAL_CONTROLLER %s\n' "$SIGNALS" "$EXPECTED_SIGNALS" >&2
  exit 1
fi
SIGNALS_AUCTION=$(scall 'auction()(address)')
if [[ "${SIGNALS_AUCTION,,}" != "${A,,}" ]]; then
  printf 'signal controller %s points at %s, not at the auction %s\n' "$SIGNALS" "$SIGNALS_AUCTION" "$A" >&2
  exit 1
fi

cat <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "chainId": $(cast chain-id --rpc-url "$RPC_URL"),
  "block": $(cast block-number --rpc-url "$RPC_URL"),
  "gitCommit": "$(git rev-parse --verify -q HEAD 2>/dev/null || echo unknown)",
  "gitDirty": $(test -z "$(git status --porcelain 2>/dev/null)" && echo false || echo true),
  "auction": {
    "address": "$A",
    "runtimeCodehash": "$(cast codehash "$A" --rpc-url "$RPC_URL")",
    "owner": "$(call 'owner()(address)')",
    "nft": "$NFT",
    "payoutA": "$(call 'payoutA()(address)')",
    "payoutB": "$(call 'payoutB()(address)')",
    "reservePriceWei": "$(call 'reservePrice()(uint96)')",
    "minIncrementBps": $(call 'minIncrementBps()(uint16)'),
    "startTime": $(call 'startTime()(uint64)'),
    "endTime": $(call 'endTime()(uint64)'),
    "absoluteEndTime": $(call 'absoluteEndTime()(uint64)'),
    "phase": $(call 'phase()(uint8)'),
    "paused": $(call 'paused()(bool)'),
    "firstTokenId": $(call 'FIRST_TOKEN_ID()(uint256)'),
    "lastTokenId": $(call 'LAST_TOKEN_ID()(uint256)'),
    "maxUnits": $(call 'MAX_UNITS()(uint256)'),
    "maxBidsPerWallet": $(call 'MAX_BIDS_PER_WALLET()(uint8)'),
    "bidTickWei": "$(call 'BID_TICK()(uint96)')",
    "signalController": "$SIGNALS"
  },
  "signalController": {
    "address": "$SIGNALS",
    "runtimeCodehash": "$(cast codehash "$SIGNALS" --rpc-url "$RPC_URL")",
    "owner": "$(scall 'owner()(address)')",
    "auction": "$SIGNALS_AUCTION",
    "auctionMatches": true,
    "nft": "$(scall 'nft()(address)')",
    "maxSignalBytes": $(scall 'MAX_SIGNAL_BYTES()(uint256)'),
    "firstTokenId": $(scall 'FIRST_TOKEN_ID()(uint256)'),
    "lastTokenId": $(scall 'LAST_TOKEN_ID()(uint256)')
  },
  "nft": {
    "address": "$NFT",
    "owner": "$(cast call "$NFT" 'owner()(address)' --rpc-url "$RPC_URL" | awk '{print $1}')",
    "totalMinted": $(cast call "$NFT" 'totalMinted()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}'),
    "mintCap": $(cast call "$NFT" 'mintCap()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}'),
    "auctionAuthorized": $(cast call "$NFT" 'authorizedOperators(address)(bool)' "$A" --rpc-url "$RPC_URL")
  },
  "mintController": {
    "address": "$CONTROLLER",
    "owner": "$(cast call "$CONTROLLER" 'owner()(address)' --rpc-url "$RPC_URL" | awk '{print $1}')",
    "seasonCount": $(cast call "$CONTROLLER" 'seasonCount()(uint8)' --rpc-url "$RPC_URL" | awk '{print $1}'),
    "season1Cap": $(cast call "$CONTROLLER" 'seasonMintCap(uint8)(uint256)' 1 --rpc-url "$RPC_URL" | awk '{print $1}'),
    "season2Cap": $(cast call "$CONTROLLER" 'seasonMintCap(uint8)(uint256)' 2 --rpc-url "$RPC_URL" | awk '{print $1}'),
    "season3Cap": $(cast call "$CONTROLLER" 'seasonMintCap(uint8)(uint256)' 3 --rpc-url "$RPC_URL" | awk '{print $1}')
  }
}
EOF
