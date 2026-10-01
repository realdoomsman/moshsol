import { buildApp } from "./app";
import { loadConfig } from "./config";
import { WalletCipher } from "./crypto";
import { Store } from "./db";
import { googleProvider } from "./oidc";

const config = loadConfig();
const cipher = new WalletCipher(config.walletMasterKey);
const store = new Store(config.dbPath);
// A different WALLET_MASTER_KEY would leave existing wallets undecryptable while new sign-ups keep working.
const foreign = store.foreignKeyCount(cipher.keyId);
if (foreign > 0) {
  store.close();
  throw new Error(`WALLET_MASTER_KEY (key id ${cipher.keyId}) is not the key that sealed ${foreign} existing wallet(s) in ${config.dbPath}; refusing to start`);
}

const app = await buildApp(config, { store, cipher, provider: googleProvider() });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await app.close();
  store.close();
  process.exit(0);
}
// SIGBREAK: Ctrl+Break on Windows consoles.
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, () => void shutdown(signal));

await app.listen({ port: config.port, host: config.host });
app.log.info(
  {
    site: config.siteOrigin,
    redirectUri: `${config.siteOrigin}/api/auth/google/callback`,
    db: config.dbPath,
    keyId: cipher.keyId,
    rateLimitPerMin: config.rateLimitPerMin,
    signLimitPerMin: config.signLimitPerMin,
  },
  "accounts listening",
);
