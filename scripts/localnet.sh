#!/usr/bin/env bash
# Starts a fresh local validator with the moshsol program preloaded as an upgradeable program.
# The upgrade authority is .localnet/admin.json (created if missing) because only the upgrade
# authority may run initialize_platform. Run inside WSL/Linux/macOS after `anchor build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="${LEDGER:-$HOME/.moshsol-ledger}"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/moshsol-keypair.json")"
ADMIN="${UPGRADE_AUTHORITY:-$ROOT/.localnet/admin.json}"

if [ ! -f "$ADMIN" ]; then
  mkdir -p "$(dirname "$ADMIN")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN" >/dev/null
fi

exec solana-test-validator \
  --reset \
  --ledger "$LEDGER" \
  --upgradeable-program "$PROGRAM_ID" "$ROOT/target/deploy/moshsol.so" "$ADMIN" \
  --rpc-port 8899 \
  --quiet
