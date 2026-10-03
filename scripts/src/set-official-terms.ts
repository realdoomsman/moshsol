/**
 * `set_official_agent_terms` through the platform admin: retunes the vault agent's terms on the official Holdfast
 * token's launch only (the launch whose mint is the platform's `buyback_mint`; every other launch keeps the terms
 * frozen at its creation). Unnamed terms keep their current value. On mainnet the admin is the Squads vault (a vault
 * transaction proposed, approved and executed like an upgrade); with a local admin key it is sent directly.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json \
 *     pnpm --filter @holdfast/scripts exec tsx src/set-official-terms.ts emaPeriodSecs=300 --dry-run
 *
 * Terms: agentBuyBpsPerWindow, agentSellBpsPerWindow, agentMaxImpactBps, agentBandBps, agentWindowSecs, emaPeriodSecs.
 * Env otherwise as `pnpm upgrade`. Needs a program at or after the build that added the instruction.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PROGRAM_ID } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

const KEYS = ["agentBuyBpsPerWindow", "agentSellBpsPerWindow", "agentMaxImpactBps", "agentBandBps", "agentWindowSecs", "emaPeriodSecs"] as const;
type Terms = Record<(typeof KEYS)[number], number>;

async function main() {
  const assignments = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!assignments.length) fail(`name at least one term, e.g. emaPeriodSecs=300 (terms: ${KEYS.join(", ")})`);

  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  const platform = await client.fetchPlatform();
  if (!platform) fail("the platform is not initialized on this cluster");
  const mint = platform.params.buybackMint;
  if (mint.equals(PublicKey.default)) fail("no official token: set buyback_mint first (set-buyback-mint)");
  const official = (await client.fetchAllLaunches()).find((l) => l.account.mint.equals(mint));
  if (!official) fail(`no launch has the official mint ${mint.toBase58()}`);
  const current = official.account.terms as unknown as Terms;

  const next: Terms = Object.fromEntries(KEYS.map((k) => [k, Number(current[k])])) as Terms;
  const changes: string[] = [];
  for (const a of assignments) {
    const [key, value] = a.split("=");
    if (!(KEYS as readonly string[]).includes(key)) fail(`unknown term "${key}" (terms: ${KEYS.join(", ")})`);
    if (!/^\d+$/.test(value ?? "")) fail(`${key} must be a non-negative integer`);
    const k = key as (typeof KEYS)[number];
    next[k] = Number(value);
    changes.push(`${k} ${current[k]} → ${next[k]}`);
  }
  console.log(`official launch ${official.publicKey.toBase58()} (mint ${mint.toBase58()})`);
  for (const c of changes) console.log(`  ${c}`);
  if (KEYS.every((k) => Number(current[k]) === next[k])) return done("terms", "already set");

  const ixs = [await client.setOfficialAgentTermsIx(platform.admin, official.publicKey, next)];
  const label = `set_official_agent_terms(${changes.join(", ")})`;

  if (platform.admin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("terms", `send [${label}] as the admin`);
    todo("terms", `sending [${label}] as the admin`);
    console.log(`   tx ${await send(client, admin, ixs)}`);
  } else {
    const config = readConfig();
    const multisigAddress = process.env.MULTISIG ?? (config.multisig as string | undefined);
    if (!multisigAddress) fail(`platform admin ${platform.admin.toBase58()} is not the local admin and no multisig is known (set MULTISIG)`);
    const multisigPda = new PublicKey(multisigAddress);
    const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda).catch(() => null);
    if (!ms) fail(`${multisigPda.toBase58()} is not a Squads v4 multisig on this cluster`);
    const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
    if (!vault.equals(platform.admin)) fail(`platform admin is ${platform.admin.toBase58()}, not the multisig vault ${vault.toBase58()}`);
    console.log(`multisig ${multisigPda.toBase58()} (${ms.threshold}-of-${ms.members.length}), vault ${vault.toBase58()}\n`);
    const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
    await runVaultTransaction({ connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint }, "terms", label, ixs);
    if (DRY_RUN) return;
  }
  const after = (await client.program.account.launch.fetch(official.publicKey)).terms as unknown as Terms;
  const bad = KEYS.filter((k) => Number(after[k]) !== next[k]);
  console.log(`\n${bad.length ? "FAIL" : "PASS"}  ${bad.length ? `not applied yet: ${bad.join(", ")}` : KEYS.map((k) => `${k} ${after[k]}`).join(", ")}`);
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
