#!/usr/bin/env bash
# Discord alert on new/increased bids for the Season 3 auction. Companion to
# monitor-auction.sh (which alerts on phase/pause/extension/mismatch only).
# Cron (every minute):
#   * * * * * /path/to/bid-alert.sh >> ~/.local/state/panorama-auction/bid-alert.log 2>&1
#
# Posts one message per run when nextBidId or totalEscrowed changed, or a signal was added,
# listing each new bid's amount and bidder (ENS name when one resolves, short address
# otherwise) with its signal, plus every signal added later to an older bid and every signal
# a token holder added to a day. Signals are write-once and have no deadline, so the feed is
# worth keeping after settlement. Signals come from the signal controller
# (PanoramaSeason3SignalController: BidSignalSet / TokenSignalSet logs), whose address is
# read from the auction's signalController() unless SIGNAL_CONTROLLER (or
# PANORAMA_SIGNAL_CONTROLLER in ../.env) names it. Signals are bidder-controlled text:
# control characters, invalid UTF-8 and bidi overrides are stripped, Discord markdown is
# escaped, mentions and link embeds are disabled, and each signal is cut to
# SIGNAL_MAX_CHARS characters (default 100).
# Config mirrors monitor-auction.sh: AUCTION / DISCORD_WEBHOOK_URL / RPC_URL from
# the environment, falling back to values parsed (never sourced) from ../.env.
# State is kept per auction address, so an older auction's state never leaks in.
set -euo pipefail
LC_ALL=C
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

dotenv_lookup() {
  local file line
  file="$SCRIPT_DIR/../.env"
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

AUCTION=${AUCTION:-$(dotenv_lookup PANORAMA_AUCTION_ADDRESS)}
DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-$(dotenv_lookup DISCORD_WEBHOOK_URL)}
if [[ -z "${RPC_URL:-}" ]]; then
  key=${API_KEY_ALCHEMY:-$(dotenv_lookup API_KEY_ALCHEMY)}
  [[ -n "$key" ]] && RPC_URL="https://eth-mainnet.g.alchemy.com/v2/${key}"
fi
[[ -n "${AUCTION:-}" ]] || { echo "bid-alert: AUCTION not set" >&2; exit 1; }
[[ -n "${RPC_URL:-}" ]] || { echo "bid-alert: RPC_URL not set" >&2; exit 1; }
[[ -n "${DISCORD_WEBHOOK_URL:-}" ]] || { echo "bid-alert: DISCORD_WEBHOOK_URL not set" >&2; exit 1; }

[[ "$AUCTION" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "bid-alert: AUCTION must be a 20-byte hex address" >&2; exit 1; }
SIGNAL_MAX_CHARS=${SIGNAL_MAX_CHARS:-100}
[[ "$SIGNAL_MAX_CHARS" =~ ^[0-9]{1,3}$ ]] && (( 10#$SIGNAL_MAX_CHARS >= 1 && 10#$SIGNAL_MAX_CHARS <= 280 )) \
  || { echo "bid-alert: SIGNAL_MAX_CHARS must be 1..280" >&2; exit 1; }

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/panorama-auction"
STATE_FILE="$STATE_DIR/bid-alert-${AUCTION,,}.state"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

exec 9>"$STATE_FILE.lock"
flock -n 9 || exit 0

# Every read is pinned to one block so the bid ids and the log scan below agree.
BLOCK=$(cast block-number --rpc-url "$RPC_URL")
[[ "$BLOCK" =~ ^[0-9]+$ ]] || { echo "bid-alert: bad block number" >&2; exit 1; }

read_uint() {
  # cast prints "2641000000000000000 [2.641e18]" for big uints; keep field 1.
  cast call "$AUCTION" "$1" --block "$BLOCK" --rpc-url "$RPC_URL" | awk '{print $1}'
}

# Wei -> ETH with up to 4 decimals, trailing zeros trimmed ("6.1970" -> "6.197").
eth() {
  local wei=$1 sign=""
  if [[ "$wei" == -* ]]; then sign="-"; wei=${wei#-}; fi
  printf '%s%s' "$sign" "$(cast to-unit "$wei" ether | awk '{printf "%.4f", $1}' | sed -E 's/0+$//; s/\.$//')"
}

short_addr() { printf '%s..%s' "${1:0:6}" "${1: -4}"; }

# ENS reverse lookup with a hard timeout; falls back to the short address.
bidder_label() {
  local addr=$1 name
  if name=$(timeout 10 cast lookup-address "$addr" --rpc-url "$RPC_URL" 2>/dev/null) \
      && [[ -n "$name" && "$name" != *" "* ]]; then
    printf '%s' "$name"
  else
    short_addr "$addr"
  fi
}

# Drop invalid UTF-8 sequences (iconv -c exits 1 when it dropped something, which is expected).
# Without iconv, keep printable ASCII only.
utf8_clean() {
  if command -v iconv >/dev/null 2>&1; then
    iconv -f UTF-8 -t UTF-8 -c 2>/dev/null || true
  else
    tr -cd '\040-\176'
  fi
}

# Signal text from a log's data field (abi.encode(string)), sanitized for Discord. Prints
# nothing for an empty or malformed signal.
decode_signal() {
  local data=$1 len_hex len hex text
  # abi.encode(string): 32-byte offset, 32-byte length, then the bytes.
  (( ${#data} >= 130 )) || return 0
  len_hex=${data:66:64}
  [[ "${len_hex:0:56}" =~ ^0+$ ]] || return 0
  len=$(( 16#${len_hex:56:8} ))
  (( len >= 1 && len <= 280 && ${#data} >= 130 + 2 * len )) || return 0
  hex=${data:130:$(( 2 * len ))}
  # Decode bytes, drop invalid UTF-8 (iconv) or everything non-ASCII (no iconv), then strip C0/DEL,
  # C1 controls, and bidi overrides/isolates.
  text=$(printf '%b' "$(sed 's/../\\x&/g' <<<"$hex")" \
    | utf8_clean \
    | LC_ALL=C tr -d '\000-\037\177' \
    | LC_ALL=C sed -e $'s/\xc2[\x80-\x9f]//g' -e $'s/\xe2\x80[\xaa-\xae]//g' -e $'s/\xe2\x81[\xa6-\xa9]//g') || return 0
  # Cut to SIGNAL_MAX_CHARS characters (not bytes), then escape Discord markdown.
  if (( $(LC_ALL=C.UTF-8 awk '{ print length($0) }' <<<"$text" 2>/dev/null || echo 0) > 10#$SIGNAL_MAX_CHARS )); then
    text="$(LC_ALL=C.UTF-8 awk -v n="$SIGNAL_MAX_CHARS" '{ print substr($0, 1, n) }' <<<"$text")..."
    text=$(printf '%s' "$text" | utf8_clean)
  fi
  text=$(sed -e 's/[][\\`*_~|<>()#]/\\&/g' <<<"$text")
  printf '%s' "$text"
}

# The controller's logs in (FROM_BLOCK, BLOCK] into SIGNAL_LINES, one line per log:
# "<topic1 as decimal> <data>". Later lines are later changes. Sets SIGNAL_LOOKUP_FAILED on an
# RPC failure. Runs in the current shell so both globals survive.
SIGNAL_LOOKUP_FAILED=0
SIGNAL_LINES=""
signal_logs() {
  local topic=$1 json
  SIGNAL_LINES=""
  (( NEW_BLOCKS )) || return 0
  if ! json=$(timeout 20 cast logs --address "$CONTROLLER" --from-block "$FROM_BLOCK" --to-block "$BLOCK" \
      "$topic" --json --rpc-url "$RPC_URL" 2>/dev/null); then
    SIGNAL_LOOKUP_FAILED=1
    return 0
  fi
  SIGNAL_LINES=$(grep -oE '"topics": *\[ *"0x[0-9a-fA-F]{64}", *"0x[0-9a-fA-F]{64}"( *, *"0x[0-9a-fA-F]{64}")* *\], *"data": *"0x[0-9a-fA-F]*"' <<<"$json" \
    | while IFS= read -r entry; do
        local key data
        key=$(grep -oE '0x[0-9a-fA-F]{64}' <<<"$entry" | sed -n 2p)
        data=$(grep -oE '"data": *"0x[0-9a-fA-F]*"' <<<"$entry" | grep -oE '0x[0-9a-fA-F]*')
        [[ "${key:2:56}" =~ ^0+$ ]] || continue
        printf '%d %s\n' "$(( 16#${key:58:8} ))" "$data"
      done) || true
}

NEXT_BID_ID=$(read_uint 'nextBidId()(uint32)')
ESCROWED=$(read_uint 'totalEscrowed()(uint256)')
ACTIVE=$(read_uint 'activeBids()(uint256)')
UNITS=$(read_uint 'MAX_UNITS()(uint256)')
FLOOR=$(read_uint 'currentClearingPrice()(uint256)')
[[ "$NEXT_BID_ID" =~ ^[0-9]+$ && "$ESCROWED" =~ ^[0-9]+$ && "$UNITS" =~ ^[0-9]+$ ]] \
  || { echo "bid-alert: bad RPC read" >&2; exit 1; }

PREV_NEXT_BID_ID=""
PREV_ESCROWED=""
PREV_BLOCK=""
if [[ -f "$STATE_FILE" ]]; then
  PREV_NEXT_BID_ID=$(grep -E '^PREV_NEXT_BID_ID=[0-9]+$' "$STATE_FILE" | tail -n 1 | cut -d= -f2 || true)
  PREV_ESCROWED=$(grep -E '^PREV_ESCROWED=[0-9]+$' "$STATE_FILE" | tail -n 1 | cut -d= -f2 || true)
  PREV_BLOCK=$(grep -E '^PREV_BLOCK=[0-9]+$' "$STATE_FILE" | tail -n 1 | cut -d= -f2 || true)
fi
# New bids and signals landed after the previous snapshot block. Without one, look back about a
# day. With no new block since the last run there is nothing new to scan.
NEW_BLOCKS=1
if [[ -n "$PREV_BLOCK" ]] && (( PREV_BLOCK >= BLOCK )); then
  NEW_BLOCKS=0
  FROM_BLOCK=$BLOCK
elif [[ -n "$PREV_BLOCK" ]]; then
  FROM_BLOCK=$(( PREV_BLOCK + 1 ))
else
  FROM_BLOCK=$(( BLOCK > 7200 ? BLOCK - 7200 : 0 ))
fi

CONTROLLER=${SIGNAL_CONTROLLER:-$(dotenv_lookup PANORAMA_SIGNAL_CONTROLLER)}
if [[ -z "$CONTROLLER" ]]; then
  CONTROLLER=$(cast call "$AUCTION" 'signalController()(address)' --block "$BLOCK" --rpc-url "$RPC_URL" | awk '{print $1}')
fi
[[ "$CONTROLLER" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "bid-alert: bad signal controller address" >&2; exit 1; }

save_state() {
  local tmp
  tmp=$(mktemp "$STATE_FILE.XXXXXX")
  printf 'PREV_NEXT_BID_ID=%s\nPREV_ESCROWED=%s\nPREV_BLOCK=%s\n' "$NEXT_BID_ID" "$ESCROWED" "$BLOCK" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$STATE_FILE"
}

# First run: record a baseline, no alert.
if [[ -z "$PREV_NEXT_BID_ID" || -z "$PREV_ESCROWED" ]]; then
  save_state
  exit 0
fi

NEW_BIDS=$(( NEXT_BID_ID - PREV_NEXT_BID_ID ))
ESCROW_DELTA=$(( ESCROWED - PREV_ESCROWED ))

# Latest signal per bid id and per token id in this window (later logs overwrite earlier ones).
declare -A BID_SIGNAL=() TOKEN_SIGNAL=()
BID_ORDER=() TOKEN_ORDER=()
signal_logs "$(cast keccak 'BidSignalSet(uint32,address,string)')"
while read -r key data; do
  [[ -n "$key" ]] || continue
  [[ -n "${BID_SIGNAL[$key]+x}" ]] || BID_ORDER+=("$key")
  BID_SIGNAL[$key]=$(decode_signal "$data")
done <<<"$SIGNAL_LINES"
signal_logs "$(cast keccak 'TokenSignalSet(uint256,address,string)')"
while read -r key data; do
  [[ -n "$key" ]] || continue
  [[ -n "${TOKEN_SIGNAL[$key]+x}" ]] || TOKEN_ORDER+=("$key")
  TOKEN_SIGNAL[$key]=$(decode_signal "$data")
done <<<"$SIGNAL_LINES"

OLD_BID_CHANGES=()
for key in "${BID_ORDER[@]}"; do
  if (( key < PREV_NEXT_BID_ID )); then OLD_BID_CHANGES+=("$key"); fi
done
if (( NEW_BIDS == 0 && ESCROW_DELTA == 0 && ${#OLD_BID_CHANGES[@]} == 0 && ${#TOKEN_ORDER[@]} == 0 )); then
  # A failed lookup must not advance the window, or its signals would never be posted.
  if (( SIGNAL_LOOKUP_FAILED == 0 )); then save_state; fi
  exit 0
fi

# Appends one signal line while staying well under Discord's 2,000-character limit
# (bytes overcount characters).
add_line() {
  local line=$1
  if (( ${#MSG} + ${#line} < 1700 )); then
    MSG="$MSG${NL}$line"
  elif [[ "$MSG" != *"(more omitted, message full)" ]]; then
    MSG="$MSG${NL}(more omitted, message full)"
  fi
}

DETAIL_CAP=10
NL=$'\n'
MSG=""
if (( NEW_BIDS > 0 )); then
  if (( NEW_BIDS == 1 )); then MSG="New bid"; else MSG="${NEW_BIDS} new bids"; fi
  count=0
  for (( id = PREV_NEXT_BID_ID; id < NEXT_BID_ID; id++ )); do
    if (( count >= DETAIL_CAP )); then
      MSG="$MSG${NL}and $(( NEXT_BID_ID - id )) more"
      break
    fi
    line=$(cast call "$AUCTION" 'bids(uint32)(address,uint96)' "$id" --block "$BLOCK" --rpc-url "$RPC_URL" 2>/dev/null | paste -sd' ' -) || line=""
    bidder=$(awk '{print $1}' <<<"$line")
    amount=$(awk '{print $2}' <<<"$line")
    if [[ "$bidder" =~ ^0x[0-9a-fA-F]{40}$ && "$bidder" != 0x0000000000000000000000000000000000000000 && "$amount" =~ ^[0-9]+$ ]]; then
      MSG="$MSG${NL}$(eth "$amount") ETH from $(bidder_label "$bidder")"
    else
      MSG="$MSG${NL}bid #$id (already displaced or refunded)"
    fi
    if [[ -n "${BID_SIGNAL[$id]:-}" ]]; then
      add_line "  signal: \"${BID_SIGNAL[$id]}\""
    fi
    (( ++count ))
  done
elif (( ESCROW_DELTA > 0 )); then
  MSG="Bid increased by $(eth "$ESCROW_DELTA") ETH"
elif (( ESCROW_DELTA < 0 )); then
  MSG="Escrow changed by $(eth "$ESCROW_DELTA") ETH"
else
  MSG="New signals"
fi
# Signals are write-once and never empty on-chain; a blank line here means the text was
# entirely removed by sanitizing.
for key in "${OLD_BID_CHANGES[@]}"; do
  add_line "Signal added to bid #$key: \"${BID_SIGNAL[$key]}\""
done
for key in "${TOKEN_ORDER[@]}"; do
  add_line "Holder signal added to day #$key: \"${TOKEN_SIGNAL[$key]}\""
done
(( SIGNAL_LOOKUP_FAILED == 0 )) || add_line "(signal lookup failed; signals in this window may be missing)"
MSG="$MSG${NL}Active ${ACTIVE}/${UNITS}, escrow $(eth "$ESCROWED") ETH, clearing floor $(eth "$FLOOR") ETH"

# JSON-escape backslashes, quotes, newlines.
esc=${MSG//\\/\\\\}
esc=${esc//\"/\\\"}
esc=${esc//$NL/\\n}

http_code=$(curl -sS -o /dev/null -w '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  -H 'Content-Type: application/json' \
  -d "{\"content\": \"$esc\", \"allowed_mentions\": {\"parse\": []}, \"flags\": 4}" \
  "$DISCORD_WEBHOOK_URL") || { echo "bid-alert: webhook request failed" >&2; exit 1; }
if [[ "$http_code" != 2* ]]; then
  # State is NOT saved on webhook failure so the alert retries next run.
  echo "bid-alert: webhook HTTP $http_code" >&2
  exit 1
fi

save_state
printf 'posted:\n%s\n' "$MSG"
