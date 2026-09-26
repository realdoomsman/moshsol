#!/usr/bin/env bash
# Builds and deploys the program to a cluster (run in WSL/Linux/macOS).
#   CLUSTER=devnet bash scripts/deploy.sh
# The deployer/upgrade authority is $KEYS_DIR/admin.json (default .<cluster>/admin.json, created if
# missing) because only the upgrade authority may initialize the platform. Fund it first
# (~4 SOL for a ~550 KB program). Later: hand both admin and upgrade authority to a multisig.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${CLUSTER:-devnet}"
case "$CLUSTER" in
  devnet) RPC="https://api.devnet.solana.com" ;;
  mainnet-beta) RPC="https://api.mainnet-beta.solana.com" ;;
  *) RPC="$CLUSTER" ;;
esac
RPC="${RPC_URL:-$RPC}"
KEYS_DIR="${KEYS_DIR:-.$CLUSTER}"
ADMIN="$ROOT/$KEYS_DIR/admin.json"

cd "$ROOT"
if [ ! -f "$ADMIN" ]; then
  mkdir -p "$KEYS_DIR"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN" >/dev/null
  echo "created admin $(solana-keygen pubkey "$ADMIN") — fund it with ~4 SOL and re-run"
  exit 1
fi
anchor build
PROGRAM_ID="$(solana-keygen pubkey target/deploy/moshsol-keypair.json)"
echo "deploying $PROGRAM_ID to $RPC (upgrade authority $(solana-keygen pubkey "$ADMIN"))"
solana program deploy --url "$RPC" --keypair "$ADMIN" \
  --program-id target/deploy/moshsol-keypair.json target/deploy/moshsol.so

echo "deployed. Initialize the platform from the JS workspace (any OS):"
echo "  RPC_URL=$RPC KEYS_DIR=$KEYS_DIR PROFILE=production pnpm setup:localnet"
