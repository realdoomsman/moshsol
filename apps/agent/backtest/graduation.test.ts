import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { poolKeys } from "../src/venue";

// From the update that shows the pump.fun curve complete, the agent watches the pool it derives from the mint alone,
// before any launch account or indexer names it. TEST on mainnet: pump.fun migrated mint B77MY… into pool FLuf7…
// (which `graduate_pump` recorded on the launch) with the token accounts 6SPGj… / HiE2V… (`Pool.pool_base_token_account`
// / `pool_quote_token_account`). A wrong derivation (another pool index, a Token-2022 vault) would leave the agent
// watching empty accounts and back to "venue account missing" after graduation.
test("the pool and vaults watched from curve completion are the ones pump.fun migrated TEST into", () => {
  assert.deepEqual(poolKeys(new PublicKey("B77MYakpiRLtL6P8Mqa1DKnuk4nHKQ13Rpk4D8F7MVqi")).map(String), [
    "6SPGjZWaagXdTYDjbruZZDk1CkDY1o9xpPQznjSNWqcV",
    "HiE2VPupZiDX3Jfy3on8KaGULAtbToSaYTctKubiYYM2",
    "FLuf7FUPgKYw6BNFnjYCy7SPuXmG2pJ6p4AmAjV5Fr9k",
  ]);
});
