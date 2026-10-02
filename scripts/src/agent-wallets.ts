/**
 * Creates the 15 agent wallets (`platform.agentExecutors`) that are still missing as keypair files
 * `01.json … 15.json` in `AGENT_WALLETS_DIR` (default `$KEYS_DIR/agent-wallets`) and prints every wallet's
 * public key. Existing files are never touched and no secret is printed.
 *
 *   KEYS_DIR=.mainnet pnpm agent-wallets
 *
 * Next: `AGENT_EXECUTORS=.mainnet/agent-wallets pnpm migrate:launches` registers them on the platform,
 * `pnpm fund-executors` gives them SOL for fees, and the agent loads them (README "Developer access").
 */
import { AGENT_EXECUTOR_SLOTS } from "@holdfast/sdk";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, ROOT, agentWallets } from "./common";

const dir = process.env.AGENT_WALLETS_DIR ?? path.join(path.relative(ROOT, LOCALNET_DIR), "agent-wallets");
const before = fs.existsSync(path.resolve(ROOT, dir)) ? fs.readdirSync(path.resolve(ROOT, dir)).filter((f) => f.endsWith(".json")).length : 0;
const wallets = agentWallets(dir, { count: AGENT_EXECUTOR_SLOTS });
console.log(`${dir}: ${wallets.length} agent wallets (${wallets.length - before} created)`);
for (const [i, w] of wallets.entries()) console.log(`  ${String(i + 1).padStart(2, "0")} ${w.publicKey.toBase58()}`);
