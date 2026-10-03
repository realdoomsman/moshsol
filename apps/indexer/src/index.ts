import { MoshClient } from "@holdfast/sdk";
import { Connection } from "@solana/web3.js";
import { ArweaveStore } from "./arweave";
import { config } from "./config";
import { Store } from "./db";
import { Holders } from "./holders";
import { HiddenLaunches } from "./hidden";
import { Hub } from "./hub";
import { SolPrice } from "./price";
import { registerRpcProxy } from "./rpc-proxy";
import { createServer, registerApi } from "./server";
import { LaunchSummaries, READ_CACHE_TTL_MS, SUMMARIES_MIN_FRESH_MS } from "./summaries";
import { ChainSync } from "./sync";

/** Hard stop if a hung RPC call keeps the sync queue from draining. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

// Live logs use the sync's own reconnecting websocket; this connection only makes HTTP calls.
const connection = new Connection(config.rpcUrl, { commitment: "confirmed" });
const client = new MoshClient(connection);
const store = new Store(config.dbPath);
const hidden = new HiddenLaunches(config.hiddenLaunches);
const hub = new Hub(hidden);
const holders = new Holders(connection, client.programId, config.holdersTtlMs, store);
const files = { filesDir: config.filesDir, publicUrl: config.publicUrl };

const app = await createServer({
  ...files,
  rateLimitPerMin: config.rateLimitPerMin,
  uploadLimitPerMin: config.uploadLimitPerMin,
  internalToken: config.internalToken,
  trustProxy: config.trustProxy,
});
if (config.trustProxy === true) {
  app.log.info("TRUST_PROXY=true: every hop trusted; correct only behind a proxy that rewrites X-Forwarded-For (Railway's edge does)");
}
const price = new SolPrice(store, app.log.child({ module: "price" }), { refreshMs: config.priceRefreshMs });
const sync = new ChainSync(store, client, hub, holders, price, app.log.child({ module: "sync" }), {
  pollMs: config.pollMs,
  fullRefreshMs: config.fullRefreshMs,
  chainCheckMs: config.chainCheckMs,
  holdersTtlMs: config.holdersTtlMs,
  wsUrl: config.wsUrl,
  ...files,
});
const arweave = config.arweave ? new ArweaveStore(config.arweave, store, app.log.child({ module: "arweave" })) : null;
const summaries = new LaunchSummaries(store, price, hidden, READ_CACHE_TTL_MS, Date.now, SUMMARIES_MIN_FRESH_MS);
registerApi(app, { store, client, sync, hub, holders, price, summaries }, {
  ...files,
  siteUrl: config.siteUrl,
  adminToken: config.adminToken,
  commentLimitPerMin: config.commentLimitPerMin,
  socialIpLimitPerMin: config.socialIpLimitPerMin,
  arweave,
});
if (config.rpcProxy) registerRpcProxy(app, { rpcUrl: config.rpcUrl, wsUrl: config.wsUrl, perMin: config.rpcProxyLimitPerMin });

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
  price.stop();
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
    rpc: new URL(config.rpcUrl).origin,
    ws: new URL(config.wsUrl).origin,
    db: config.dbPath,
    files: config.filesDir,
    publicUrl: config.publicUrl,
    rateLimitPerMin: config.rateLimitPerMin,
    uploadLimitPerMin: config.uploadLimitPerMin,
    commentLimitPerMin: config.commentLimitPerMin,
    socialIpLimitPerMin: config.socialIpLimitPerMin,
    moderation: config.adminToken !== null,
    internalToken: config.internalToken !== null,
    hiddenLaunches: hidden.size,
    storage: config.arweave
      ? { network: config.arweave.network, payer: arweave?.address, dailyBudgetLamports: config.arweave.dailyBudgetLamports }
      : "local",
    rpcProxy: config.rpcProxy ? { perMin: config.rpcProxyLimitPerMin } : false,
  },
  "indexer listening",
);
price.start();
sync.start();
