import { Connection } from "@solana/web3.js";
import { MoshClient } from "@holdfast/sdk";
import { Agent } from "./agent";
import { loadConfig, loadKeypair } from "./config";
import { log } from "./log";
import { startStatusServer } from "./status";

const cfg = loadConfig();
const signer = loadKeypair(cfg.keypairSource);
const client = new MoshClient(new Connection(cfg.rpcUrl, "confirmed"));
const agent = new Agent(cfg, client, signer);
const server = await startStatusServer(cfg.statusHost, cfg.statusPort, () => agent.snapshot());

log("started", {
  agent: signer.publicKey.toBase58(),
  // Origin only: keyed RPC URLs (Helius `?api-key=`) must not land in hosted logs.
  rpc: new URL(cfg.rpcUrl).origin,
  programId: client.programId.toBase58(),
  dryRun: cfg.dryRun,
  pollMs: cfg.pollMs,
  cooldownMs: cfg.cooldownMs,
  minTradeLamports: cfg.minTradeLamports,
  strategy: cfg.strategy,
  slippageBps: cfg.slippageBps,
  priorityFee: cfg.priorityFee,
  status: `http://${cfg.statusHost}:${cfg.statusPort}/status`,
});

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
// web3's idle keep-alive RPC sockets would otherwise hold the event loop open for a while.
process.exit(0);
