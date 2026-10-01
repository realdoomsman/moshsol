#!/usr/bin/env node
/**
 * Cross-platform front end for scripts/localnet.sh (through WSL on Windows, bash elsewhere).
 *
 *   pnpm localnet              validator in the foreground, resuming its ledger
 *   pnpm localnet --reset      same, from a fresh ledger (new genesis; needed after `anchor build`)
 *   pnpm stop:localnet         stop a running validator
 *   pnpm reset:localnet        stop → restart fresh in the background (log: .localnet/validator.log)
 *                              → wipe the indexer DB → setup:localnet → seed:localnet
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const INDEXER_URL = (process.env.INDEXER_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || "apps/indexer/data/indexer.db");
const VALIDATOR_LOG = path.join(ROOT, ".localnet", "validator.log");

/** [command, args] running `args` in the validator's environment: WSL on Windows. */
const inShell = (...args) => (WIN ? ["wsl", args] : [args[0], args.slice(1)]);
// `wsl` only forwards the variables WSLENV names: pass localnet.sh's options through.
if (WIN) {
  const forwarded = ["CLONE_PUMP", "CLONE_URL", "RPC_PORT", "FAUCET_PORT", "GOSSIP_PORT", "DYNAMIC_PORT_RANGE", "LEDGER", "LEDGER_LIMIT"];
  process.env.WSLENV = [process.env.WSLENV, ...forwarded].filter(Boolean).join(":");
}

async function rpcHealthy() {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok && (await res.json()).result === "ok";
  } catch {
    return false;
  }
}

async function indexerUp() {
  return fetch(`${INDEXER_URL}/api/health`, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  );
}

async function waitFor(what, want, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while ((await rpcHealthy()) !== want) {
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
    await sleep(1_000);
  }
}

/** Runs a root package script (pnpm is a .cmd shim on Windows, hence the shell). */
function pnpm(script) {
  console.log(`\n$ pnpm ${script}`);
  const r = spawnSync(`pnpm ${script}`, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error(`pnpm ${script} failed (exit ${r.status})`);
}

async function stop() {
  if (!(await rpcHealthy())) return console.log(`no validator answering on ${RPC_URL}`);
  const [cmd, args] = inShell("pkill", "-INT", "-f", "solana-test-validator");
  spawnSync(cmd, args, { stdio: "inherit" });
  await waitFor("the validator to stop", false, 30_000);
  console.log("validator stopped");
}

async function reset() {
  await stop();
  fs.mkdirSync(path.dirname(VALIDATOR_LOG), { recursive: true });
  const log = fs.openSync(VALIDATOR_LOG, "w");
  const [cmd, args] = inShell("bash", "scripts/localnet.sh", "--reset");
  spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ["ignore", log, log], windowsHide: true }).unref();
  console.log(`starting a fresh validator in the background (log: ${path.relative(ROOT, VALIDATOR_LOG)})…`);
  await waitFor("the validator to start", true, 120_000);
  console.log(`validator up on ${RPC_URL}`);

  const indexerRunning = await indexerUp();
  if (indexerRunning) {
    console.log("indexer is running: it detects the new genesis and re-indexes by itself");
  } else {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true });
    console.log(`wiped indexer DB ${path.relative(ROOT, DB_PATH)}`);
  }
  pnpm("setup:localnet");
  if (indexerRunning) pnpm("seed:localnet");
  else console.log("\nseed skipped (uploads need the indexer): start `pnpm dev`, then run `pnpm seed:localnet`");
  console.log(`\nfresh localnet ready. Stop the background validator with: pnpm stop:localnet`);
}

function foreground(extra) {
  const [cmd, args] = inShell("bash", "scripts/localnet.sh", ...extra);
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
  // Ctrl+C reaches the validator directly; exit with it.
  process.on("SIGINT", () => undefined);
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 130 : 1)));
}

const [sub, ...rest] = process.argv.slice(2);
try {
  if (sub === "stop") await stop();
  else if (sub === "reset") await reset();
  else foreground([sub, ...rest].filter(Boolean));
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
