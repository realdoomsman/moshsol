import { MoshClient } from "@moshsol/sdk";
import { setTimeout as sleep } from "node:timers/promises";
import { Connection } from "@solana/web3.js";
import { config } from "./config";
import { Store } from "./db";
import { Holders } from "./holders";
import { Hub } from "./hub";
import { createServer, registerApi } from "./server";
import { ChainSync } from "./sync";

const connection = new Connection(config.rpcUrl, { commitment: "confirmed", wsEndpoint: config.wsUrl });
const client = new MoshClient(connection);
const store = new Store(config.dbPath);
const hub = new Hub();
const holders = new Holders(connection, client.programId, config.holdersTtlMs);
const files = { filesDir: config.filesDir, publicUrl: config.publicUrl };

const app = await createServer(files);
const sync = new ChainSync(store, client, hub, holders, app.log.child({ module: "sync" }), {
  pollMs: config.pollMs,
  fullRefreshMs: config.fullRefreshMs,
  holdersTtlMs: config.holdersTtlMs,
  ...files,
});
registerApi(app, { store, client, sync, hub }, files);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await sync.stop();
  hub.close();
  await app.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Listen before syncing: metadata for our own uploads is served from this process.
await app.listen({ port: config.port, host: config.host });
app.log.info(
  { rpc: config.rpcUrl, ws: config.wsUrl, db: config.dbPath, files: config.filesDir, publicUrl: config.publicUrl },
  "indexer listening",
);
// Only the initial cluster check can fail here (RPC unreachable); later failures are logged and retried.
for (;;) {
  try {
    await sync.start();
    break;
  } catch (err) {
    app.log.error({ err }, "sync start failed; retrying in 5s");
    await sleep(5_000);
  }
}
