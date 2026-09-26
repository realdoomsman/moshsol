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
#      backfill; the solana-test-validator default of 10000 keeps only ~3 minutes).
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

# Genesis options (the preloaded program) only apply when the ledger is created.
exec solana-test-validator \
  ${RESET:+--reset} \
  --ledger "$LEDGER" \
  --limit-ledger-size "${LEDGER_LIMIT:-1000000}" \
  --upgradeable-program "$PROGRAM_ID" "$ROOT/target/deploy/moshsol.so" "$ADMIN" \
  --rpc-port 8899 \
  --quiet
