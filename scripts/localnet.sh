#!/usr/bin/env bash
# Starts a fresh local validator with the moshsol program preloaded as an upgradeable program.
# Run inside WSL/Linux/macOS after `anchor build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="${LEDGER:-$HOME/.moshsol-ledger}"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/moshsol-keypair.json")"
UPGRADE_AUTHORITY="${UPGRADE_AUTHORITY:-$HOME/.config/solana/id.json}"

exec solana-test-validator \
  --reset \
  --ledger "$LEDGER" \
  --upgradeable-program "$PROGRAM_ID" "$ROOT/target/deploy/moshsol.so" "$UPGRADE_AUTHORITY" \
  --rpc-port 8899 \
  --quiet
