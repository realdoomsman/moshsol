import assert from "node:assert/strict";
import { test } from "node:test";
import { BN } from "@coral-xyz/anchor";
import { MoshClient, type LaunchJson } from "@holdfast/sdk";
import { Connection, Keypair } from "@solana/web3.js";
import type { FastifyBaseLogger } from "fastify";
import { DEFAULT_PUBKEY, Store } from "./db";
import { HiddenLaunches } from "./hidden";
import type { Holders } from "./holders";
import type { Hub } from "./hub";
import type { SolPrice } from "./price";
import { LaunchSummaries } from "./summaries";
import { ChainSync } from "./sync";

const LAUNCH = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent } as unknown as FastifyBaseLogger;

/** The program's logs for one emitted event, encoded with the IDL's layout. */
function eventLogs(client: MoshClient, name: string, data: Record<string, unknown>): string[] {
  const disc = client.program.idl.events?.find((e) => e.name === name)?.discriminator;
  assert.ok(disc, `IDL event ${name}`);
  const body = client.program.coder.types.encode(name, data);
  const program = client.programId.toBase58();
  return [
    `Program ${program} invoke [1]`,
    `Program data: ${Buffer.concat([Buffer.from(disc), body]).toString("base64")}`,
    `Program ${program} success`,
  ];
}

test("admin and dev-key vault withdrawals both index as vault_withdrawn and both count in the launch's sums", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const base = { address: LAUNCH.toBase58(), mint: MINT.toBase58(), venue: "pump" as const, status: "live" };
  store.insertLaunch({ ...base, creator: DEFAULT_PUBKEY, idx: 1, created_at: 1, name: "T", symbol: "T", uri: "", meta_status: "ok" });
  const terms = { burnShareBps: 1500, creatorFeeVaultBps: 7500, payoutMultBps: 50_000 } as LaunchJson["terms"];
  const snap = { ...base, priceSol: 1e-7, marketCapSol: 1, tradeCount: 0, volumeSol: "0", vaultSol: "0", creatorFeesCollected: "0", terms };
  store.setSnapshot({ ...base, snapshot: JSON.stringify(snap), slot: 1, pumpMeta: null });

  const client = new MoshClient(new Connection("http://127.0.0.1:1"));
  // The post-event account refresh: no chain here.
  client.program.account.launch.fetchNullableAndContext = (async () => ({ data: null, context: { slot: 0 } })) as never;
  const hub = { broadcast() {} } as unknown as Hub;
  const sync = new ChainSync(store, client, hub, {} as Holders, {} as SolPrice, silent, {
    pollMs: 0,
    fullRefreshMs: 0,
    chainCheckMs: 0,
    holdersTtlMs: 0,
    publicUrl: "",
    filesDir: "",
    wsUrl: "ws://127.0.0.1:1",
  });
  const processTx = (sync as unknown as { processTx(sig: string, slot: number, logs: string[]): Promise<void> }).processTx.bind(sync);

  const recipient = Keypair.generate().publicKey;
  const dev = Keypair.generate().publicKey;
  const accounts = { launch: LAUNCH, mint: MINT, recipientTokens: Keypair.generate().publicKey };
  const admin = { ...accounts, sol: new BN(1_000_000_000), tokens: new BN(5), recipient, timestamp: new BN(100) };
  await processTx("sigAdmin", 10, eventLogs(client, "vaultWithdrawn", admin));
  await processTx("sigDev", 11, eventLogs(client, "vaultWithdrawnByDev", { ...accounts, sol: new BN(250_000_000), tokens: new BN(7), by: dev, timestamp: new BN(200) }));

  const rows = store.launchActivity(LAUNCH.toBase58(), "vault_withdrawn", Number.MAX_SAFE_INTEGER, 10);
  const devRow = rows.find((r) => r.actor === dev.toBase58());
  assert.equal(rows.length, 2);
  assert.equal(devRow?.ref, "dev");
  assert.equal(devRow?.sol_amount, "250000000");
  assert.equal(rows.find((r) => r.actor === recipient.toBase58())?.ref, null, "the admin's withdrawal is untagged");

  const summary = new LaunchSummaries(store, {} as SolPrice, new HiddenLaunches(), 0, () => 1_800_000_000_000).byId(LAUNCH.toBase58());
  assert.equal(summary?.vaultWithdrawnSol, 1.25);
  assert.equal(summary?.vaultWithdrawnTokens, "12");
});
