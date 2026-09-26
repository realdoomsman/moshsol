import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MoshClient, describeError } from "@moshsol/sdk";
import { Agent } from "./agent";
import { loadConfig, loadKeypair } from "./config";
import { log } from "./log";
import { startStatusServer } from "./status";

/** Below this the agent cannot keep paying transaction fees for long. */
const LOW_BALANCE_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;

const cfg = loadConfig();
const signer = loadKeypair(cfg.keypairPath);
const client = new MoshClient(new Connection(cfg.rpcUrl, "confirmed"));
const agent = new Agent(cfg, client, signer);
const server = await startStatusServer(cfg.statusHost, cfg.statusPort, () => agent.snapshot());

log("started", {
  agent: signer.publicKey.toBase58(),
  rpcUrl: cfg.rpcUrl,
  programId: client.programId.toBase58(),
  dryRun: cfg.dryRun,
  pollMs: cfg.pollMs,
  cooldownMs: cfg.cooldownMs,
  minTradeLamports: cfg.minTradeLamports,
  maxFractionBps: cfg.maxFractionBps,
  slippageBps: cfg.slippageBps,
  priorityMicroLamports: cfg.priorityMicroLamports ?? 0,
  status: `http://${cfg.statusHost}:${cfg.statusPort}/status`,
});
try {
  const balance = await client.connection.getBalance(signer.publicKey, "confirmed");
  if (balance < LOW_BALANCE_LAMPORTS && !cfg.dryRun) {
    log("low_balance", { agent: signer.publicKey.toBase58(), sol: balance / LAMPORTS_PER_SOL });
  }
} catch (err) {
  log("rpc_unreachable", { error: describeError(err) });
}

const controller = new AbortController();
let signals = 0;
const shutdown = (signal: NodeJS.Signals) => {
  signals += 1;
  if (signals > 1) process.exit(130);
  log("stopping", { signal });
  controller.abort();
};
// SIGBREAK: Ctrl+Break on Windows consoles.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, shutdown);

await agent.run(controller.signal);
server.closeAllConnections();
server.close();
log("stopped");
// The web3 websocket used for confirmations would otherwise keep the event loop alive.
process.exit(0);
