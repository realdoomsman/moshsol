#!/usr/bin/env bash
# Builds and deploys the program to a cluster (run in WSL/Linux/macOS).
#   CLUSTER=devnet bash scripts/deploy.sh
#   CLUSTER=mainnet-beta RPC_URL=https://<keyed-provider> bash scripts/deploy.sh
#   DRY_RUN=1 CLUSTER=mainnet-beta bash scripts/deploy.sh   # build + print the funding needed, no deploy
# The deployer/upgrade authority is $KEYS_DIR/admin.json (default .<cluster>/admin.json, e.g.
# .mainnet-beta/admin.json; created if missing) because only the upgrade authority may initialize
# the platform. The script computes the exact SOL the key needs from the built .so size via
# `solana rent` and refuses to deploy if the balance is short. Later: hand both admin and
# upgrade authority to a multisig.
set -euo pipefail
# Non-login shells (e.g. `wsl bash …`) don't source the Solana installer's PATH entry.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
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
# Priority fee for every deploy transaction (micro-lamports per compute unit).
CU_PRICE="${CU_PRICE:-10000}"

cd "$ROOT"
DRY_RUN="${DRY_RUN:-0}"
created=0
if [ ! -f "$ADMIN" ] && [ "$DRY_RUN" != 1 ]; then
  mkdir -p "$KEYS_DIR"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN" >/dev/null
  created=1
fi
ADMIN_PK="$([ -f "$ADMIN" ] && solana-keygen pubkey "$ADMIN" || echo "<admin pubkey: run without DRY_RUN to create $KEYS_DIR/admin.json>")"

anchor build
SO=target/deploy/moshsol.so
PROGRAM_ID="$(solana-keygen pubkey target/deploy/moshsol-keypair.json)"
SO_LEN="$(stat -c %s "$SO")"

rent() { solana rent "$1" --lamports --url "$RPC" | awk '{print $3}'; }
sol() { awk -v l="$1" 'BEGIN { printf "%.9f", l / 1e9 }'; }

# Write transactions carry ~1 KB of program bytes each (900 B is a conservative chunk); each pays
# the 5000-lamport signature fee plus at most 200k CU * CU_PRICE of priority fee. +10 for the
# buffer-create / deploy / close transactions.
TXS=$(((SO_LEN + 899) / 900 + 10))
FEES=$((TXS * (5000 + 200000 * CU_PRICE / 1000000)))

# Upgradeable loader layouts: Program = 36 bytes, ProgramData = 45 + code, Buffer = 37 + code.
if solana program show "$PROGRAM_ID" --url "$RPC" >/dev/null 2>&1; then
  MODE=upgrade
  OLD_LEN="$(solana program show "$PROGRAM_ID" --url "$RPC" | awk '/Data Length/ {print $3}')"
  BUFFER_RENT="$(rent $((SO_LEN + 37)))"
  EXTEND=0
  if [ "$SO_LEN" -gt "$OLD_LEN" ]; then
    EXTEND=$(($(rent $((SO_LEN + 45))) - $(rent $((OLD_LEN + 45)))))
  fi
  # The buffer is closed after the upgrade and its rent returns to the admin.
  REQUIRED=$((BUFFER_RENT + EXTEND + FEES))
  BREAKDOWN="buffer rent $(sol "$BUFFER_RENT") (refunded) + programdata extension $(sol "$EXTEND") + tx fees ≤$(sol "$FEES")"
else
  MODE=deploy
  PROGRAMDATA_RENT="$(rent $((SO_LEN + 45)))"
  PROGRAM_RENT="$(rent 36)"
  # initialize_platform: Platform account rent + fees, with headroom for later admin txs.
  SETUP=10000000
  REQUIRED=$((PROGRAMDATA_RENT + PROGRAM_RENT + FEES + SETUP))
  BREAKDOWN="programdata rent $(sol "$PROGRAMDATA_RENT") + program account $(sol "$PROGRAM_RENT") + tx fees ≤$(sol "$FEES") + platform setup $(sol "$SETUP")"
fi

if [ -f "$ADMIN" ]; then
  BALANCE="$(solana balance "$ADMIN_PK" --lamports --url "$RPC" | awk '{print $1}')"
else
  BALANCE=0
fi
echo "cluster:            $CLUSTER ($RPC)"
echo "program:            $PROGRAM_ID ($MODE, .so $SO_LEN bytes)"
echo "upgrade authority:  $ADMIN_PK"
echo "required:           $(sol "$REQUIRED") SOL = $BREAKDOWN"
echo "balance:            $(sol "$BALANCE") SOL"
if [ "$BALANCE" -lt "$REQUIRED" ]; then
  SHORT=$((REQUIRED - BALANCE))
  [ "$created" = 1 ] && echo "created a new admin key at $ADMIN — back it up before funding."
  echo "short by $(sol "$SHORT") SOL. Fund it from any wallet, e.g.:"
  echo "  solana transfer --url $CLUSTER --allow-unfunded-recipient $ADMIN_PK $(sol "$SHORT")"
  exit 1
fi
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY_RUN=1: balance sufficient, not deploying."
  exit 0
fi

echo "deploying…"
solana program deploy --url "$RPC" --keypair "$ADMIN" --with-compute-unit-price "$CU_PRICE" \
  --program-id target/deploy/moshsol-keypair.json "$SO"

echo "deployed. Initialize the platform from the JS workspace (any OS):"
echo "  RPC_URL=$RPC KEYS_DIR=$KEYS_DIR PROFILE=production pnpm setup:localnet"
echo "then verify:"
echo "  RPC_URL=$RPC KEYS_DIR=$KEYS_DIR pnpm mainnet:check"
