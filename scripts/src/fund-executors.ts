/**
 * Tops up the agent wallets (`platform.agentExecutors`, the 15 shared wallets that execute the vault agent's
 * pump trades) from the agent key: every wallet under `EXECUTOR_MIN_SOL` (default 0.02) gets exactly what
 * brings it back to that, in one transaction the agent key signs and pays. The wallets only need SOL for
 * their own fees and the transient token-account rent they get back inside each trade; the agent tops them
 * up on its own too (`EXECUTOR_MIN_SOL` / `EXECUTOR_TOPUP_SOL` in apps/agent).
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet pnpm fund-executors --dry-run
 *
 * AGENT_KEYPAIR: the agent key file, relative to the repo root (default `$KEYS_DIR/agent.json`).
 * AGENT_WALLETS_DIR: the wallets' keypair files (default `$KEYS_DIR/agent-wallets`; `pnpm agent-wallets`
 * creates the missing ones). Wallets not registered on the platform are listed and skipped. `--dry-run`
 * prints the plan and simulates the transaction; nothing is sent.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { DEFAULT_PRIORITY_FEE, agentExecutorsOf, describeError, platformPda, prepareTx } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, ROOT, RPC_URL, agentWallets, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readKeypair, todo } from "./squads";

/** What the agent key keeps for its own fees. */
const AGENT_RESERVE = 0.01 * LAMPORTS_PER_SOL;
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const agent = readKeypair(process.env.AGENT_KEYPAIR ? path.resolve(ROOT, process.env.AGENT_KEYPAIR) : path.join(LOCALNET_DIR, "agent.json"));
  const client = clientFor(connection, agent);
  const minSol = Number(process.env.EXECUTOR_MIN_SOL ?? "0.02");
  if (!Number.isFinite(minSol) || minSol <= 0 || minSol > 1) fail(`EXECUTOR_MIN_SOL=${process.env.EXECUTOR_MIN_SOL} must be in (0, 1]`);
  const target = Math.round(minSol * LAMPORTS_PER_SOL);
  const dir = process.env.AGENT_WALLETS_DIR ?? path.join(path.relative(ROOT, LOCALNET_DIR), "agent-wallets");
  const wallets = agentWallets(dir).map((k) => k.publicKey);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, agent ${agent.publicKey.toBase58()}, wallets ${dir} (${wallets.length})`);

  // Before the migration (or before the wallets are registered) every wallet in the directory is funded:
  // the migration registers exactly those.
  const platform = await client.fetchPlatform().catch(() => null);
  const registered = platform ? agentExecutorsOf(platform) : [];
  if (!platform) console.log(`platform ${platformPda().toBase58()} not in the current layout yet (before the migration): funding every wallet in ${dir}`);
  else if (registered.length === 0) console.log("the platform has no agent wallets yet (`AGENT_EXECUTORS=<dir> pnpm migrate:launches` registers them): funding every wallet in the directory");
  const isRegistered = (k: PublicKey) => registered.length === 0 || registered.some((r) => r.equals(k));
  const [agentInfo, ...infos] = await connection.getMultipleAccountsInfo([agent.publicKey, ...wallets], "confirmed");
  const agentLamports = agentInfo?.lamports ?? 0;
  const plan: { key: PublicKey; lamports: number }[] = [];
  for (const [i, key] of wallets.entries()) {
    const have = infos[i]?.lamports ?? 0;
    const registeredNote = isRegistered(key) ? "" : "  (not registered on the platform: skipped)";
    const need = isRegistered(key) && have < target ? target - have : 0;
    console.log(`  ${String(i + 1).padStart(2)} ${key.toBase58().padEnd(44)} ${sol(have).padStart(12)} SOL${need ? `  → +${sol(need)}` : ""}${registeredNote}`);
    if (need) plan.push({ key, lamports: need });
  }
  for (const r of registered) if (!wallets.some((w) => w.equals(r))) console.log(`  registered on the platform but not in ${dir}: ${r.toBase58()}`);

  const total = plan.reduce((s, p) => s + p.lamports, 0);
  console.log(`agent key ${sol(agentLamports)} SOL; top-up ${sol(total)} SOL to ${plan.length} wallet(s), target ${minSol} SOL each`);
  if (plan.length === 0) return done("fund-executors", "every registered agent wallet holds at least the target");
  if (agentLamports - total < AGENT_RESERVE) fail(`the agent key needs ${sol(total + AGENT_RESERVE)} SOL (top-up + 0.01 reserve)`);

  const ixs = plan.map((p) => SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: p.key, lamports: p.lamports }));
  if (DRY_RUN) {
    try {
      const prepared = await prepareTx(connection, agent.publicKey, ixs, DEFAULT_PRIORITY_FEE);
      return todo("fund-executors", `simulation OK (${prepared.unitsConsumed} CU): send ${plan.length} transfer(s) from the agent key`);
    } catch (err) {
      fail(`simulation failed: ${describeError(err)}`);
    }
  }
  console.log(`   tx ${await send(client, agent, ixs)}`);
  done("fund-executors", `${plan.length} agent wallet(s) topped up to ${minSol} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
