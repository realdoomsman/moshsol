import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { PROGRAM_ID, PUMP_PROGRAM_ID, spotPrice } from "@holdfast/sdk";
import { decodePumpTrades, invokesProgram } from "./pump-events";

type Fixture = { signature: string; slot: number; blockTime: number; logs: string[] };
const fixture = (name: string): Fixture =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;

// Mainnet: a public 0.05 SOL buy of $HFPAY (Gv2Ua42…) on its pump.fun bonding curve.
test("decodes pump.fun TradeEvent from a mainnet buy", () => {
  const fx = fixture("pump-buy");
  const trades = decodePumpTrades(fx.logs);
  assert.equal(trades.length, 1);
  const t = trades[0]!;
  assert.equal(t.mint, "Gv2Ua42upzCwZ3gboZvrkhwp8y21NdVmyJiUFcGyJP5J");
  assert.equal(t.pool, null);
  assert.equal(t.user, "EVN2gPRLh4Yymj7w6yh9u7yLf7CU8dBTfnTgBzNEYJ4G");
  assert.equal(t.isBuy, true);
  assert.equal(t.timestamp, fx.blockTime);
  assert.equal(t.solAmount, 49_382_715n);
  assert.equal(t.tokenAmount, 1_688_281_458_842n);
  // 0.05 SOL paid = 49382715 into the curve + 469136 protocol fee + 148149 creator fee.
  assert.equal(t.fee, 469_136n + 148_149n);
  assert.equal(t.solAmount + t.fee, 50_000_000n);
  assert.deepEqual(t.reserves, {
    virtualSol: 30_709_659_780n - 709_659_780n,
    realSol: 709_659_780n,
    tokenReserve: 1_048_204_383_659_835n,
  });
  // SOL per whole token after the trade (30.709… SOL / 1 048 204 383 tokens), rounded like every SDK price.
  assert.equal(spotPrice(t.reserves), 2.9297e-8);
});

test("decodes PumpSwap BuyEvent and SellEvent", () => {
  const [buy] = decodePumpTrades(fixture("pumpswap-trade").logs);
  assert.ok(buy);
  assert.equal(buy.mint, null);
  assert.equal(buy.pool, "BH7cxkSLYieJPA6KuNLdnuTbH91fj7LnNy6T5AHFNi7t");
  assert.equal(buy.user, "BeBRptiPDejdepyFUBSRLJZYVP7mpnZBtFUhbo3f5vvn");
  assert.equal(buy.isBuy, true);
  assert.equal(buy.timestamp, 1_790_850_105);
  assert.equal(buy.tokenAmount, 28_720_762n);
  // quote_amount_in 219981 = 217802 to the pool + LP 436 + protocol 109 + creator 1634.
  assert.equal(buy.solAmount, 217_802n);
  assert.equal(buy.fee, 436n + 109n + 1_634n);
  assert.deepEqual(buy.reserves, { virtualSol: 0n, realSol: 348_123_978_802n, tokenReserve: 48_224_906_148_361n });

  const [sell] = decodePumpTrades(fixture("pumpswap-sell").logs);
  assert.ok(sell);
  assert.equal(sell.pool, "8wUi9kvGYayQuiKWNjD9G43Tefae33yy7uWqNEMZ8vXq");
  assert.equal(sell.user, "EB7cKykuWbxauvtFaXwBxtdnoAhRT6B1Y1zZM2XJ6AgC");
  assert.equal(sell.isBuy, false);
  assert.equal(sell.tokenAmount, 47_218_120n);
  // quote_amount_out 2253658 = 2240135 to the user + LP 4508 + protocol 1127 + creator 7888.
  assert.equal(sell.solAmount, 2_253_658n);
  assert.equal(sell.fee, 4_508n + 1_127n + 7_888n);
  assert.deepEqual(sell.reserves, { virtualSol: 0n, realSol: 899_432_535_140n, tokenReserve: 19_213_081_205_297n });
});

test("only decodes events the venue programs themselves emitted", () => {
  const data = fixture("pump-buy").logs.find((l) => l.startsWith("Program data: "))!;
  const other = "Hold1111111111111111111111111111111111111111";
  // The same payload logged by another program (e.g. a different Anchor program's event) is not a pump trade.
  assert.deepEqual(decodePumpTrades([`Program ${other} invoke [1]`, data, `Program ${other} success`]), []);
  // Nested: a trade emitted by pump.fun under CPI is still attributed to pump.fun.
  const nested = [
    `Program ${other} invoke [1]`,
    `Program ${PUMP_PROGRAM_ID.toBase58()} invoke [2]`,
    data,
    `Program ${PUMP_PROGRAM_ID.toBase58()} success`,
    `Program ${other} success`,
  ];
  assert.equal(decodePumpTrades(nested).length, 1);
  assert.equal(invokesProgram(nested, other), true);
  assert.equal(invokesProgram(nested, PROGRAM_ID.toBase58()), false);
  assert.equal(invokesProgram(fixture("pump-buy").logs, PROGRAM_ID.toBase58()), false);
  // Garbage after the prefix is skipped, not thrown.
  assert.deepEqual(decodePumpTrades([`Program ${PUMP_PROGRAM_ID.toBase58()} invoke [1]`, "Program data: AAAA"]), []);
});
