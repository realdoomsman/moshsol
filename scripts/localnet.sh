#!/usr/bin/env bash
# Local validator with the moshsol program preloaded as an upgradeable program.
# The upgrade authority is .localnet/admin.json (created if missing) because only the upgrade
# authority may run initialize_platform. Run inside WSL/Linux/macOS after `anchor build`
# (from Windows: `pnpm localnet`, which runs this through WSL).
#
#   bash scripts/localnet.sh           resume the existing ledger (created on first run)
#   bash scripts/localnet.sh --reset   start from a fresh ledger: new genesis, empty chain, freshly
#                                      built program (required after `anchor build`)
#
# Env: LEDGER (default ~/.moshsol-ledger), UPGRADE_AUTHORITY (default .localnet/admin.json),
#      LEDGER_LIMIT (shreds kept, default 1000000 ≈ hours of history so a restarted indexer can
#      backfill; the solana-test-validator default of 10000 keeps only ~3 minutes),
#      RPC_PORT (default 8899; websocket = RPC_PORT + 1), and, only when set, FAUCET_PORT,
#      GOSSIP_PORT and DYNAMIC_PORT_RANGE (e.g. 21000-21030). Give each concurrent validator its
#      own LEDGER and ports.
#      CLONE_PUMP=1 (with --reset) clones pump.fun, PumpSwap, the pump fee program, Metaplex token
#      metadata and the config accounts their instructions read (the same set as
#      scripts/dump-pump-fixtures.sh, plus the live fee recipients and their WSOL accounts) from
#      mainnet so pump launches work locally; CLONE_URL overrides the mainnet RPC it reads from
#      (default: Helius with the key in .secrets/helius-api-key — never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# `wsl bash scripts/localnet.sh` runs a non-login shell that may not have the Solana PATH yet.
if ! command -v solana-test-validator >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
LEDGER="${LEDGER:-$HOME/.moshsol-ledger}"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/moshsol-keypair.json")"
ADMIN="${UPGRADE_AUTHORITY:-$ROOT/.localnet/admin.json}"

RESET=""
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    *) echo "unknown argument: $arg (usage: localnet.sh [--reset])" >&2; exit 2 ;;
  esac
done

if [ ! -f "$ADMIN" ]; then
  mkdir -p "$(dirname "$ADMIN")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN" >/dev/null
fi

CLONE_ARGS=()
if [ -n "${CLONE_PUMP:-}" ]; then
  CLONE_URL="${CLONE_URL:-https://mainnet.helius-rpc.com/?api-key=$(tr -d '[:space:]' < "$ROOT/.secrets/helius-api-key")}"
  # Programs (upgradeable: program + ProgramData) and the static config PDAs.
  for p in 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA \
           pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s; do
    CLONE_ARGS+=(--clone-upgradeable-program "$p")
  done
  PUMP_GLOBAL=4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
  AMM_GLOBAL_CONFIG=ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw
  for a in "$PUMP_GLOBAL" Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt \
           5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx "$AMM_GLOBAL_CONFIG" C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw \
           39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg; do
    CLONE_ARGS+=(--clone "$a")
  done
  # Fee recipients are read live from Global / GlobalConfig (pump.fun can rotate them): they must
  # exist funded (a system transfer can't leave an account below rent exemption) and PumpSwap pays
  # into their WSOL token accounts.
  pubkey_at() { # <account> <byte offset>: base58 of the 32 bytes at <offset> of the account's data
    solana account -u "$CLONE_URL" "$1" --output json | python3 -c '
import base64, json, sys
data = base64.b64decode(json.load(sys.stdin)["account"]["data"][0])
off = int(sys.argv[1]); raw = data[off:off + 32]; n = int.from_bytes(raw, "big")
alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; out = ""
while n: n, r = divmod(n, 58); out = alphabet[r] + out
print("1" * (len(raw) - len(raw.lstrip(b"\0"))) + out)' "$2"
  }
  FEE_RECIPIENT="$(pubkey_at "$PUMP_GLOBAL" 41)"
  BUYBACK_FEE_RECIPIENT="$(pubkey_at "$PUMP_GLOBAL" 741)"
  PROTOCOL_FEE_RECIPIENT="$(pubkey_at "$AMM_GLOBAL_CONFIG" 57)"
  wsol_ata() {
    solana find-program-derived-address ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
      "pubkey:$1" pubkey:TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA pubkey:So11111111111111111111111111111111111111112
  }
  for a in "$FEE_RECIPIENT" "$BUYBACK_FEE_RECIPIENT" "$PROTOCOL_FEE_RECIPIENT" \
           "$(wsol_ata "$PROTOCOL_FEE_RECIPIENT")" "$(wsol_ata "$BUYBACK_FEE_RECIPIENT")"; do
    CLONE_ARGS+=(--clone "$a")
  done
  CLONE_ARGS+=(--url "$CLONE_URL")
  echo "cloning pump.fun, PumpSwap, the fee program, Metaplex and their config / fee accounts from mainnet" >&2
fi

# Genesis options (the preloaded program) only apply when the ledger is created.
exec solana-test-validator \
  ${RESET:+--reset} \
  --ledger "$LEDGER" \
  --limit-ledger-size "${LEDGER_LIMIT:-1000000}" \
  --upgradeable-program "$PROGRAM_ID" "$ROOT/target/deploy/moshsol.so" "$ADMIN" \
  --rpc-port "${RPC_PORT:-8899}" \
  ${FAUCET_PORT:+--faucet-port "$FAUCET_PORT"} \
  ${GOSSIP_PORT:+--gossip-port "$GOSSIP_PORT"} \
  ${DYNAMIC_PORT_RANGE:+--dynamic-port-range "$DYNAMIC_PORT_RANGE"} \
  ${CLONE_ARGS[@]+"${CLONE_ARGS[@]}"} \
  --quiet
