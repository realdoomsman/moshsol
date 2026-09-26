import { MoshClient } from "@moshsol/sdk";
import { Connection } from "@solana/web3.js";
import { config } from "./config";
import { Store } from "./db";
import { Holders } from "./holders";
import { Hub } from "./hub";
import { createServer, registerApi } from "./server";
import { ChainSync } from "./sync";

/** Hard stop if a hung RPC call keeps the sync queue from draining. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

// Live logs use the sync's own reconnecting websocket; this connection only makes HTTP calls.
const connection = new Connection(config.rpcUrl, { commitment: "confirmed" });
const client = new MoshClient(connection);
const store = new Store(config.dbPath);
const hub = new Hub();
const holders = new Holders(connection, client.programId, config.holdersTtlMs);
const files = { filesDir: config.filesDir, publicUrl: config.publicUrl };

const app = await createServer({
  ...files,
  rateLimitPerMin: config.rateLimitPerMin,
  uploadLimitPerMin: config.uploadLimitPerMin,
  trustProxy: config.trustProxy,
});
const sync = new ChainSync(store, client, hub, holders, app.log.child({ module: "sync" }), {
  pollMs: config.pollMs,
  fullRefreshMs: config.fullRefreshMs,
  chainCheckMs: config.chainCheckMs,
  holdersTtlMs: config.holdersTtlMs,
  wsUrl: config.wsUrl,
  ...files,
});
registerApi(app, { store, client, sync, hub }, files);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  setTimeout(() => {
    app.log.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  await sync.stop();
  hub.close();
  await app.close();
  store.close();
  app.log.info("stopped cleanly");
  process.exit(0);
}
// SIGBREAK: Ctrl+Break on Windows consoles.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, () => void shutdown(signal));

// Listen before syncing: metadata for our own uploads is served from this process.
await app.listen({ port: config.port, host: config.host });
app.log.info(
  {
    rpc: config.rpcUrl,
    ws: config.wsUrl,
    db: config.dbPath,
    files: config.filesDir,
    publicUrl: config.publicUrl,
    rateLimitPerMin: config.rateLimitPerMin,
    uploadLimitPerMin: config.uploadLimitPerMin,
  },
  "indexer listening",
);
sync.start();
