#!/usr/bin/env bash
# Local, network-free regression tests for monitor-auction.sh, bid-alert.sh and rpc-load-test.sh.
set -euo pipefail
LC_ALL=C
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MONITOR="$SCRIPT_DIR/monitor-auction.sh"
LOAD_TEST="$SCRIPT_DIR/rpc-load-test.sh"
BID_ALERT="$SCRIPT_DIR/bid-alert.sh"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/panorama-operations-test.XXXXXX")
cleanup() {
  if [[ "${KEEP_TEST_TMP:-0}" == "1" ]]; then
    printf 'test artifacts kept at %s\n' "$TEMP_DIR" >&2
  else
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file=$1 expected=$2
  grep -Fq -- "$expected" "$file" || fail "$file did not contain: $expected"
}

assert_not_contains() {
  local file=$1 unexpected=$2
  if grep -Fq -- "$unexpected" "$file"; then
    fail "$file unexpectedly contained: $unexpected"
  fi
}

bash -n "$MONITOR" "$LOAD_TEST" "$BID_ALERT"

MONITOR_MOCK_BIN="$TEMP_DIR/monitor-bin"
mkdir -m 700 "$MONITOR_MOCK_BIN"

cat > "$MONITOR_MOCK_BIN/cast" <<'MOCK_CAST'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  call)
    case "${3:-}" in
      'phase()(uint8)') printf '%s\n' "${MOCK_PHASE:-0}" ;;
      'paused()(bool)') printf '%s\n' "${MOCK_PAUSED:-false}" ;;
      'endTime()(uint64)') printf '%s\n' "${MOCK_END:-2000000000}" ;;
      'activeBids()(uint256)') printf '%s\n' "${MOCK_BIDS:-5}" ;;
      'currentClearingPrice()(uint256)') printf '%s\n' "${MOCK_FLOOR:-100000000000000000}" ;;
      'supplyMismatched()(bool)') printf '%s\n' "${MOCK_MISMATCH:-false}" ;;
      'mintingUnavailable()(bool)') printf '%s\n' "${MOCK_MINTING_UNAVAILABLE:-false}" ;;
      'totalLiabilities()(uint256)') printf '%s\n' "${MOCK_LIAB:-100000000000000000}" ;;
      'signalController()(address)') printf '0x3333333333333333333333333333333333333333\n' ;;
      'auction()(address)') printf '%s\n' "${MOCK_CONTROLLER_AUCTION:-$AUCTION}" ;;
      *) exit 64 ;;
    esac
    ;;
  balance)
    printf '%s\n' "${MOCK_BAL:-100000000000000000}"
    ;;
  from-wei)
    printf '0.1\n'
    ;;
  *)
    exit 64
    ;;
esac
MOCK_CAST

cat > "$MONITOR_MOCK_BIN/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${MOCK_CURL_LOG:-}" ]]; then
  printf 'called\n' >> "$MOCK_CURL_LOG"
fi
printf '%s' "${MOCK_CURL_HTTP:-204}"
exit "${MOCK_CURL_EXIT:-0}"
MOCK_CURL
chmod 700 "$MONITOR_MOCK_BIN/cast" "$MONITOR_MOCK_BIN/curl"

AUCTION=0x1111111111111111111111111111111111111111
RPC_WITH_SECRET=https://rpc.example.invalid/SECRET_SENTINEL
STATE_FILE="$TEMP_DIR/monitor.state"

run_monitor() {
  env PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
    AUCTION="$AUCTION" STATE_FILE="$STATE_FILE" "$MONITOR" "$@"
}

run_monitor --healthcheck > "$TEMP_DIR/health.out" 2> "$TEMP_DIR/health.err"
assert_contains "$TEMP_DIR/health.out" "healthcheck OK"
[[ ! -e "$STATE_FILE" ]] || fail "healthcheck changed monitor state"
assert_not_contains "$TEMP_DIR/health.out" SECRET_SENTINEL
assert_not_contains "$TEMP_DIR/health.err" SECRET_SENTINEL

run_monitor > "$TEMP_DIR/initial.out" 2> "$TEMP_DIR/initial.err"
assert_contains "$STATE_FILE" "PREV_PHASE=0"
[[ "$(stat -c '%a' "$STATE_FILE")" == "600" ]] || fail "monitor state is not mode 0600"

MOCK_CURL_LOG="$TEMP_DIR/webhook.calls"
if env MOCK_PHASE=1 MOCK_CURL_EXIT=22 MOCK_CURL_HTTP=500 MOCK_CURL_LOG="$MOCK_CURL_LOG" \
    DISCORD_WEBHOOK_URL=https://discord.example.invalid/SECRET_WEBHOOK \
    PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
    AUCTION="$AUCTION" STATE_FILE="$STATE_FILE" "$MONITOR" \
    > "$TEMP_DIR/webhook-fail.out" 2> "$TEMP_DIR/webhook-fail.err"; then
  fail "monitor succeeded despite webhook failure"
fi
assert_contains "$TEMP_DIR/webhook-fail.err" "webhook delivery failed"
assert_contains "$TEMP_DIR/webhook-fail.err" "state was not advanced"
assert_contains "$STATE_FILE" "PREV_PHASE=0"
assert_not_contains "$TEMP_DIR/webhook-fail.err" SECRET_WEBHOOK
assert_not_contains "$TEMP_DIR/webhook-fail.err" SECRET_SENTINEL

env MOCK_PHASE=1 MOCK_CURL_LOG="$MOCK_CURL_LOG" \
  DISCORD_WEBHOOK_URL=https://discord.example.invalid/SECRET_WEBHOOK \
  PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
  AUCTION="$AUCTION" STATE_FILE="$STATE_FILE" "$MONITOR" \
  > "$TEMP_DIR/webhook-ok.out" 2> "$TEMP_DIR/webhook-ok.err"
assert_contains "$STATE_FILE" "PREV_PHASE=1"
assert_contains "$MOCK_CURL_LOG" "called"

BIG_STATE="$TEMP_DIR/big.state"
env MOCK_BAL=999999999999999999999999999999999999999999999999999 \
  MOCK_LIAB=1000000000000000000000000000000000000000000000000000 \
  PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
  AUCTION="$AUCTION" STATE_FILE="$BIG_STATE" "$MONITOR" \
  > "$TEMP_DIR/big.out" 2> "$TEMP_DIR/big.err"
assert_contains "$TEMP_DIR/big.out" "CRITICAL: balance"

MINTING_STATE="$TEMP_DIR/minting.state"
env MOCK_END=1 MOCK_MINTING_UNAVAILABLE=true \
  PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
  AUCTION="$AUCTION" STATE_FILE="$MINTING_STATE" "$MONITOR" \
  > "$TEMP_DIR/minting.out" 2> "$TEMP_DIR/minting.err"
assert_contains "$TEMP_DIR/minting.out" "auction ended but minting is unavailable"

WIRING_STATE="$TEMP_DIR/wiring.state"
env MOCK_CONTROLLER_AUCTION=0x0000000000000000000000000000000000000000 \
  PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
  AUCTION="$AUCTION" STATE_FILE="$WIRING_STATE" "$MONITOR" \
  > "$TEMP_DIR/wiring.out" 2> "$TEMP_DIR/wiring.err"
assert_contains "$TEMP_DIR/wiring.out" "CRITICAL: signal controller"
assert_not_contains "$TEMP_DIR/minting.out" "CRITICAL: signal controller"

MALICIOUS_STATE="$TEMP_DIR/malicious.state"
MARKER="$TEMP_DIR/state-was-executed"
printf 'PREV_PHASE=$(touch %s)\n' "$MARKER" > "$MALICIOUS_STATE"
chmod 600 "$MALICIOUS_STATE"
if env PATH="$MONITOR_MOCK_BIN:$PATH" HOME="$TEMP_DIR" RPC_URL="$RPC_WITH_SECRET" \
    AUCTION="$AUCTION" STATE_FILE="$MALICIOUS_STATE" "$MONITOR" \
    > "$TEMP_DIR/malicious.out" 2> "$TEMP_DIR/malicious.err"; then
  fail "monitor accepted executable state content"
fi
assert_contains "$TEMP_DIR/malicious.err" "STATE_FILE contains an invalid PREV_PHASE"
[[ ! -e "$MARKER" ]] || fail "monitor executed state-file content"

LOAD_MOCK_BIN="$TEMP_DIR/load-bin"
mkdir -m 700 "$LOAD_MOCK_BIN"
cat > "$LOAD_MOCK_BIN/curl" <<'LOAD_CURL'
#!/usr/bin/env bash
set -euo pipefail
output=""
while (($#)); do
  if [[ "$1" == "-o" ]]; then
    output=$2
    shift 2
  else
    shift
  fi
done
[[ -n "$output" ]] || exit 65
if [[ "${LOAD_CURL_MODE:-ok}" == "rate" ]]; then
  printf '{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limit"}}' > "$output"
  printf '429\t0.010'
  exit 22
fi
printf '{"jsonrpc":"2.0","id":1,"result":"0x1"}' > "$output"
printf '200\t0.012'
LOAD_CURL
chmod 700 "$LOAD_MOCK_BIN/curl"

env PATH="$LOAD_MOCK_BIN:$PATH" RPC_URL="$RPC_WITH_SECRET" AUCTION="$AUCTION" \
  RPC_LOAD_SIGNAL_CONTROLLER=0x3333333333333333333333333333333333333333 RPC_LOAD_REQUESTS=3 RPC_LOAD_CONCURRENCY=2 \
  RPC_LOAD_ENS_RESOLUTIONS=2 RPC_LOAD_ENS_CONCURRENCY=2 "$LOAD_TEST" \
  > "$TEMP_DIR/load-ok.out" 2> "$TEMP_DIR/load-ok.err"
assert_contains "$TEMP_DIR/load-ok.out" "Global snapshot: 43 contract reads"
assert_contains "$TEMP_DIR/load-ok.out" "ENS reverse lookups per snapshot: 2"
assert_contains "$TEMP_DIR/load-ok.out" "total: 15"
assert_contains "$TEMP_DIR/load-ok.out" "successful: 15"
assert_contains "$TEMP_DIR/load-ok.out" "p95: 12"
assert_not_contains "$TEMP_DIR/load-ok.out" SECRET_SENTINEL
assert_not_contains "$TEMP_DIR/load-ok.err" SECRET_SENTINEL

if env LOAD_CURL_MODE=rate PATH="$LOAD_MOCK_BIN:$PATH" RPC_URL="$RPC_WITH_SECRET" AUCTION="$AUCTION" \
    RPC_LOAD_SIGNAL_CONTROLLER=0x3333333333333333333333333333333333333333 \
    RPC_LOAD_REQUESTS=2 RPC_LOAD_CONCURRENCY=1 \
    RPC_LOAD_ENS_RESOLUTIONS=2 RPC_LOAD_ENS_CONCURRENCY=2 "$LOAD_TEST" \
    > "$TEMP_DIR/load-rate.out" 2> "$TEMP_DIR/load-rate.err"; then
  fail "load test succeeded despite rate limiting"
fi
assert_contains "$TEMP_DIR/load-rate.out" "rate-limited: 10"
assert_not_contains "$TEMP_DIR/load-rate.out" SECRET_SENTINEL
assert_not_contains "$TEMP_DIR/load-rate.err" SECRET_SENTINEL

env PATH="$LOAD_MOCK_BIN:$PATH" RPC_URL="$RPC_WITH_SECRET" RPC_LOAD_SYNTHETIC=1 \
  RPC_LOAD_ENS_RESOLUTIONS=0 "$LOAD_TEST" \
  > "$TEMP_DIR/load-synthetic.out" 2> "$TEMP_DIR/load-synthetic.err"
assert_contains "$TEMP_DIR/load-synthetic.out" "MODE: SYNTHETIC"
assert_contains "$TEMP_DIR/load-synthetic.out" "total: 3"
assert_contains "$TEMP_DIR/load-synthetic.out" "successful: 3"
assert_not_contains "$TEMP_DIR/load-synthetic.out" SECRET_SENTINEL
assert_not_contains "$TEMP_DIR/load-synthetic.err" SECRET_SENTINEL

# bid-alert.sh: new bids are listed with their signals (read from the signal controller's
# BidSignalSet / TokenSignalSet logs), sanitized for Discord; signals added later (to older
# bids, or by token holders to their days) are posted too.
BID_MOCK_BIN="$TEMP_DIR/bid-bin"
mkdir -m 700 "$BID_MOCK_BIN"

# abi.encode(string) for raw hex bytes, the exact shape of the signal events' data field.
abi_string_hex() {
  local hex=$1 len padded
  len=$(( ${#hex} / 2 ))
  padded=$hex
  while (( ${#padded} % 64 != 0 )); do padded+="0"; done
  printf '0x%064x%064x%s' 32 "$len" "$padded"
}
ascii_hex() { printf '%s' "$1" | od -v -An -tx1 | tr -d ' \n'; }

# One log entry as cast logs --json prints it: topic0, the indexed id, the indexed account, data.
log_entry() {
  printf '{"address":"0x3333333333333333333333333333333333333333","topics":["%s","0x%064x","0x%064x"],"data":"%s","blockNumber":"0x3e9","logIndex":"0x%x","removed":false}' \
    "$1" "$2" 34 "$3" "$2"
}
BID_TOPIC=$(printf '0x%064x' 177)
TOKEN_TOPIC=$(printf '0x%064x' 193)

# Bid 2: ESC sequence, markdown, a mention, a right-to-left override, an invalid byte, a newline.
SIGNAL_2_HEX="$(ascii_hex 'hi ')1b5b33316d$(ascii_hex ' *bold* @everyone ')e280ae$(ascii_hex ' evil ')ff0a$(ascii_hex 'end')"
# Bid 3: 280 bytes of "a" (the maximum), cut to 100 characters in the alert.
SIGNAL_3_HEX=$(ascii_hex "$(printf 'a%.0s' $(seq 1 280))")
export MOCK_BID_LOGS_1 MOCK_BID_LOGS_2 MOCK_TOKEN_LOGS_2
MOCK_BID_LOGS_1="[$(log_entry "$BID_TOPIC" 2 "$(abi_string_hex "$SIGNAL_2_HEX")"),$(log_entry "$BID_TOPIC" 3 "$(abi_string_hex "$SIGNAL_3_HEX")")]"
MOCK_BID_LOGS_2="[$(log_entry "$BID_TOPIC" 1 "$(abi_string_hex "$(ascii_hex 'added later')")")]"
MOCK_TOKEN_LOGS_2="[$(log_entry "$TOKEN_TOPIC" 181 "$(abi_string_hex "$(ascii_hex 'the holder speaks')")"),$(log_entry "$TOKEN_TOPIC" 182 "$(abi_string_hex "$(ascii_hex 'to the universe')")")]"

cat > "$BID_MOCK_BIN/cast" <<'MOCK_CAST'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  block-number) printf '%s\n' "${MOCK_BLOCK:-1000}" ;;
  keccak)
    case "${2:-}" in
      'BidSignalSet(uint32,address,string)') printf '0x%064x\n' 177 ;;
      'TokenSignalSet(uint256,address,string)') printf '0x%064x\n' 193 ;;
      *) printf '0x%064x\n' 7 ;;
    esac
    ;;
  to-unit) awk -v w="$2" 'BEGIN { printf "%.18f\n", w / 1e18 }' ;;
  lookup-address) exit 1 ;;
  call)
    case "${3:-}" in
      'nextBidId()(uint32)') printf '%s\n' "${MOCK_NEXT:-1}" ;;
      'totalEscrowed()(uint256)') printf '%s\n' "${MOCK_ESCROW:-0}" ;;
      'activeBids()(uint256)') printf '%s\n' "${MOCK_ACTIVE:-0}" ;;
      'MAX_UNITS()(uint256)') printf '30\n' ;;
      'currentClearingPrice()(uint256)') printf '100000000000000000\n' ;;
      'signalController()(address)') printf '0x3333333333333333333333333333333333333333\n' ;;
      'bids(uint32)(address,uint96)') printf '0x2222222222222222222222222222222222222222\n100000000000000000\n' ;;
      *) exit 64 ;;
    esac
    ;;
  logs)
    [[ "${MOCK_LOGS_FAIL:-0}" == "0" ]] || exit 1
    [[ " $* " == *" --address 0x3333333333333333333333333333333333333333 "* ]] || exit 65
    set_id=${MOCK_LOG_SET:-0}
    if [[ " $* " == *" $(printf '0x%064x' 177) "* ]]; then
      case "$set_id" in
        1) printf '%s\n' "$MOCK_BID_LOGS_1" ;;
        2) printf '%s\n' "$MOCK_BID_LOGS_2" ;;
        *) printf '[]\n' ;;
      esac
    else
      case "$set_id" in
        2) printf '%s\n' "$MOCK_TOKEN_LOGS_2" ;;
        *) printf '[]\n' ;;
      esac
    fi
    ;;
  *) exit 64 ;;
esac
MOCK_CAST

cat > "$BID_MOCK_BIN/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  if [[ "$1" == "-d" ]]; then printf '%s' "$2" > "$MOCK_PAYLOAD"; shift 2; else shift; fi
done
printf '204'
MOCK_CURL
chmod 700 "$BID_MOCK_BIN/cast" "$BID_MOCK_BIN/curl"

run_bid_alert() {
  env PATH="$BID_MOCK_BIN:$PATH" XDG_STATE_HOME="$TEMP_DIR/xdg" RPC_URL="$RPC_WITH_SECRET" \
    AUCTION="$AUCTION" DISCORD_WEBHOOK_URL=https://discord.example.invalid/SECRET_WEBHOOK \
    MOCK_PAYLOAD="$TEMP_DIR/bid-payload.json" "$@" "$BID_ALERT"
}
BID_STATE="$TEMP_DIR/xdg/panorama-auction/bid-alert-${AUCTION,,}.state"
PAYLOAD="$TEMP_DIR/bid-payload.json"

run_bid_alert MOCK_NEXT=1 > "$TEMP_DIR/bid-baseline.out" 2>&1
[[ ! -e "$PAYLOAD" ]] || fail "bid-alert posted on its baseline run"
assert_contains "$BID_STATE" "PREV_BLOCK=1000"

run_bid_alert MOCK_NEXT=4 MOCK_ACTIVE=3 MOCK_ESCROW=300000000000000000 MOCK_BLOCK=1005 MOCK_LOG_SET=1 \
  > "$TEMP_DIR/bid-alert.out" 2> "$TEMP_DIR/bid-alert.err"
assert_contains "$PAYLOAD" '3 new bids'
assert_contains "$PAYLOAD" 'Active 3/30'
assert_contains "$PAYLOAD" '"allowed_mentions": {"parse": []}'
assert_contains "$PAYLOAD" '"flags": 4'
assert_contains "$PAYLOAD" 'signal: \"hi \\[31m \\*bold\\* @everyone  evil end\"'
assert_contains "$PAYLOAD" "signal: \\\"$(printf 'a%.0s' $(seq 1 100))...\\\""
assert_not_contains "$PAYLOAD" "$(printf 'a%.0s' $(seq 1 101))"
assert_not_contains "$PAYLOAD" $'\x1b'
assert_not_contains "$PAYLOAD" $'\xe2\x80\xae'
assert_not_contains "$PAYLOAD" $'\xff'
[[ "$(grep -o 'signal:' "$PAYLOAD" | wc -l)" == "2" ]] || fail "expected exactly two signal lines (bid 1 had none)"
assert_contains "$BID_STATE" "PREV_BLOCK=1005"
assert_not_contains "$TEMP_DIR/bid-alert.out" SECRET_SENTINEL
assert_not_contains "$TEMP_DIR/bid-alert.err" SECRET_SENTINEL

# No new bids, but signals were added: one to an older bid, and two by holders to their days.
rm -f "$PAYLOAD"
run_bid_alert MOCK_NEXT=4 MOCK_ACTIVE=3 MOCK_ESCROW=300000000000000000 MOCK_BLOCK=1010 MOCK_LOG_SET=2 \
  > "$TEMP_DIR/bid-signals.out" 2> "$TEMP_DIR/bid-signals.err"
assert_contains "$PAYLOAD" 'New signals'
assert_contains "$PAYLOAD" 'Signal added to bid #1: \"added later\"'
assert_contains "$PAYLOAD" 'Holder signal added to day #181: \"the holder speaks\"'
assert_contains "$PAYLOAD" 'Holder signal added to day #182: \"to the universe\"'
assert_contains "$BID_STATE" "PREV_BLOCK=1010"

# Nothing changed: no post, and the window advances.
rm -f "$PAYLOAD"
run_bid_alert MOCK_NEXT=4 MOCK_ESCROW=300000000000000000 MOCK_BLOCK=1015 > "$TEMP_DIR/bid-quiet.out" 2>&1
[[ ! -e "$PAYLOAD" ]] || fail "bid-alert posted without any change"
assert_contains "$BID_STATE" "PREV_BLOCK=1015"

# A failed log lookup with nothing else to report keeps the window, so those signals are retried.
run_bid_alert MOCK_NEXT=4 MOCK_ESCROW=300000000000000000 MOCK_BLOCK=1020 MOCK_LOGS_FAIL=1 \
  > "$TEMP_DIR/bid-fail.out" 2>&1
[[ ! -e "$PAYLOAD" ]] || fail "bid-alert posted on a failed lookup without changes"
assert_contains "$BID_STATE" "PREV_BLOCK=1015"

printf 'operations script tests: PASS\n'
