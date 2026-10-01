#!/usr/bin/env bash
# Refreshes tests/program/fixtures from mainnet: the pump.fun, PumpSwap, pump fee and Metaplex
# token-metadata programs plus the config accounts their trade instructions read. The litesvm
# suite loads these so pump launches are exercised against the real programs.
#
#   RPC_URL=<mainnet rpc> bash scripts/dump-pump-fixtures.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RPC_URL="${RPC_URL:-https://mainnet.helius-rpc.com/?api-key=$(tr -d '[:space:]' < .secrets/helius-api-key)}"
OUT=tests/program/fixtures
mkdir -p "$OUT"

declare -A PROGRAMS=(
  [pump]=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
  [pump_amm]=pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA
  [pump_fee]=pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
  [mpl_token_metadata]=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
)
for name in "${!PROGRAMS[@]}"; do
  solana program dump -u "$RPC_URL" "${PROGRAMS[$name]}" "$OUT/$name.so" >/dev/null
  # ProgramData is padded with zeros up to its allocated length; keep only the ELF (its
  # section header table, which ends the file, may legitimately end in zero bytes).
  python3 - "$OUT/$name.so" <<'PY'
import struct, sys
p = sys.argv[1]
data = open(p, "rb").read()
assert data[:4] == b"\x7fELF"
e_shoff, = struct.unpack_from("<Q", data, 0x28)
e_shentsize, e_shnum = struct.unpack_from("<HH", data, 0x3A)
e_phoff, = struct.unpack_from("<Q", data, 0x20)
e_phentsize, e_phnum = struct.unpack_from("<HH", data, 0x36)
end = e_shoff + e_shentsize * e_shnum
for i in range(e_phnum):
    p_offset, p_filesz = struct.unpack_from("<QQ", data, e_phoff + i * e_phentsize + 8)[0], struct.unpack_from("<Q", data, e_phoff + i * e_phentsize + 32)[0]
    end = max(end, p_offset + p_filesz)
open(p, "wb").write(data[:end])
PY
  echo "program $name $(stat -c %s "$OUT/$name.so") bytes"
done

# Config accounts (PDAs derived as in packages/sdk/src/pump.ts). Each is stored as the JSON
# `solana account` prints: lamports, base64 data, owner.
declare -A ACCOUNTS=(
  [pump_global]=4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
  [pump_global_volume_accumulator]=Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y
  [pump_fee_config]=8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt
  [amm_fee_config]=5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx
  [amm_global_config]=ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw
  [amm_global_volume_accumulator]=C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw
  [wsol_mint]=So11111111111111111111111111111111111111112
)
for name in "${!ACCOUNTS[@]}"; do
  solana account -u "$RPC_URL" "${ACCOUNTS[$name]}" --output json > "$OUT/$name.json"
  echo "account $name"
done
