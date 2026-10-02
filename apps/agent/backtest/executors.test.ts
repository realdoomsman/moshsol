import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import { MoshClient } from "@holdfast/sdk";
import { ExecutorPool, type WalletPick } from "../src/executors";

const SOL = 1_000_000_000;

function pool(n: number, opts = { minLamports: 0.01 * SOL, spacingMs: 3_000 }) {
  const wallets = Array.from({ length: n }, () => Keypair.generate());
  const p = new ExecutorPool(wallets, opts);
  p.setRegistered(wallets.map((w) => w.publicKey));
  p.noteBalances(new Map(wallets.map((w) => [w.publicKey.toBase58(), 0.02 * SOL])));
  return { p, wallets };
}

function picked(r: WalletPick): Keypair {
  assert.ok("wallet" in r, `expected a wallet, got: ${"reason" in r ? r.reason : ""}`);
  return r.wallet;
}

test("hands out the least recently used wallet, never one that is trading", () => {
  const { p, wallets } = pool(3);
  const a = picked(p.pick("L1", "buy", 1_000));
  const b = picked(p.pick("L2", "sell", 1_001));
  const c = picked(p.pick("L3", "buy", 1_002));
  assert.deepEqual([a, b, c].map((w) => w.publicKey.toBase58()), wallets.map((w) => w.publicKey.toBase58()));
  // All three are trading: nobody is left.
  assert.ok("reason" in p.pick("L4", "buy", 1_003));
  p.release(b.publicKey, "L2", 15_000);
  p.release(a.publicKey, "L1", 15_000);
  // Released in any order, a was handed out first: it is the least recently used.
  assert.equal(picked(p.pick("L4", "buy", 1_004)).publicKey.toBase58(), a.publicKey.toBase58());
});

test("one trade per launch at a time, and no opposite side within the spacing", () => {
  const { p } = pool(3);
  const a = picked(p.pick("L1", "buy", 10_000));
  const second = p.pick("L1", "buy", 10_001);
  assert.ok("reason" in second && /already trading/.test(second.reason), "a second trade on a launch waits for the first");
  p.release(a.publicKey, "L1", 0);
  const sell = p.pick("L1", "sell", 12_000);
  assert.ok("reason" in sell && /spacing/.test(sell.reason), "a sell 2 s after a buy on the same launch is refused");
  // The same side may follow (the strategy's own cooldown decides that), and the other side once spaced.
  const again = picked(p.pick("L1", "buy", 12_000));
  p.release(again.publicKey, "L1", 0);
  picked(p.pick("L1", "sell", 15_001));
});

test("low wallets are skipped and reported for top-up; unregistered or unloaded ones are never used", () => {
  const { p, wallets } = pool(3);
  p.noteBalances(new Map([[wallets[0]!.publicKey.toBase58(), 0.005 * SOL]]));
  const stranger = Keypair.generate().publicKey;
  p.setRegistered([wallets[0]!.publicKey, stranger, wallets[2]!.publicKey]);
  assert.deepEqual(p.coverage().missing.map(String), [stranger.toBase58()]);
  assert.deepEqual(p.lowWallets().map((w) => w.key.toBase58()), [wallets[0]!.publicKey.toBase58()]);
  // wallets[1] is loaded but no longer registered; wallets[0] is low: only wallets[2] trades.
  assert.equal(picked(p.pick("L1", "buy", 1)).publicKey.toBase58(), wallets[2]!.publicKey.toBase58());
  assert.ok("reason" in p.pick("L2", "buy", 2));
  // A trade's cost comes off the wallet's balance until the next heartbeat read.
  p.release(wallets[2]!.publicKey, "L1", 0.015 * SOL);
  assert.deepEqual(p.lowWallets().map((w) => w.key.toBase58()).sort(), [wallets[0]!.publicKey.toBase58(), wallets[2]!.publicKey.toBase58()].sort());
  p.setRegistered([]);
  assert.equal(p.required, false);
});

test("retarget turns the SDK instruction for one wallet into the SDK instruction for another", async () => {
  // fetchPumpConfig reads pump.fun's Global and PumpSwap's GlobalConfig (recipient lists up to byte 997); any bytes do
  // for the account layout, and identical bytes make every random recipient pick the same key.
  const connection = new Connection("http://127.0.0.1:1");
  const fake = { data: Buffer.alloc(1100, 7) };
  Object.assign(connection, { getMultipleAccountsInfo: async () => [fake, fake] });
  const client = new MoshClient(connection);
  const agent = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const { p, wallets } = pool(2);
  const [a, b] = [wallets[0]!.publicKey, wallets[1]!.publicKey];
  for (const graduated of [false, true]) {
    const ref = { address: Keypair.generate().publicKey, mint, graduated };
    const forA = await client.agentSellPumpIx(agent, ref, 1n, 0n, a);
    const forB = await client.agentSellPumpIx(agent, ref, 1n, 0n, b);
    assert.deepEqual(p.retarget(forA, a, b, mint).keys, forB.keys, graduated ? "PumpSwap" : "bonding curve");
    assert.ok(forB.keys.some((k) => k.pubkey.equals(b) && k.isSigner), "the wallet signs");
  }
});
