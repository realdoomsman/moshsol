import { Connection } from "@solana/web3.js";
import { MoshClient } from "@holdfast/sdk";
import { ActivityLog } from "./activity";
import { Agent } from "./agent";
import { REPO_ROOT, loadConfig, loadKeypair } from "./config";
import { log } from "./log";
import { Narrator } from "./narrate";
import { ResearchLoop } from "./research";
import { startStatusServer } from "./status";

const cfg = loadConfig();
const signer = loadKeypair(cfg.keypairSource);
const client = new MoshClient(new Connection(cfg.rpcUrl, "confirmed"));
const narrator = cfg.narrator ? new Narrator(cfg.narrator) : null;
const activity = new ActivityLog({ file: cfg.dbFile, narrator });
const agent = new Agent(cfg, client, signer, activity);
const research = cfg.research
  ? new ResearchLoop({
      cfg: cfg.research,
      file: cfg.dbFile,
      narrator,
      current: () => agent.currentStrategy(),
      adopt: (params) => agent.setStrategy(params),
      repoRoot: REPO_ROOT,
    })
  : null;
const server = await startStatusServer(cfg.statusHost, cfg.statusPort, {
  status: () => agent.snapshot(),
  activity: (key) => activity.items(key),
  research: () => research?.snapshot() ?? { items: [], updatedAt: null, running: false, nextAt: null },
});

log("started", {
  agent: signer.publicKey.toBase58(),
  // Origin only: keyed RPC URLs (Helius `?api-key=`) must not land in hosted logs.
  rpc: new URL(cfg.rpcUrl).origin,
  programId: client.programId.toBase58(),
  dryRun: cfg.dryRun,
  pollMs: cfg.pollMs,
  // Origins only, like `rpc`.
  stream: cfg.subscribe ? new URL(cfg.wsUrl).origin : "off",
  debounceMs: cfg.debounceMs,
  sender: cfg.sender ? { url: new URL(cfg.sender.url).origin, tipLamports: cfg.sender.tipLamports } : "off",
  cooldownMs: cfg.cooldownMs,
  minTradeLamports: cfg.minTradeLamports,
  strategy: cfg.strategy,
  slippageBps: cfg.slippageBps,
  priorityFee: cfg.priorityFee,
  crankMs: cfg.crankMs,
  lookupTable: cfg.alt?.toBase58() ?? `(${cfg.altFile})`,
  db: cfg.dbFile,
  // The model name only: the endpoint and key stay out of the logs.
  narration: cfg.narrator ? cfg.narrator.model : "off",
  research: cfg.research ? `every ${cfg.research.intervalMin} min` : "off",
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

research?.start(controller.signal);
await agent.run(controller.signal);
server.closeAllConnections();
server.close();
research?.close();
activity.close();
log("stopped");
// web3's idle keep-alive RPC sockets would otherwise hold the event loop open for a while.
process.exit(0);
