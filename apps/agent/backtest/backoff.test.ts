import assert from "node:assert/strict";
import { test } from "node:test";
import { SAME_SLOT_TRADE_MESSAGE, TransactionExpiredError, TransactionFailedError } from "@holdfast/sdk";
import { MAX_TRANSPORT_BACKOFF_MS, PROGRAM_RETRY_MS, TradeBackoff } from "../src/backoff";

// TEST launch, t=520–1059: eight PumpSwap buys failed in simulation (InvalidArgument) and the one launch-wide back-off
// grew 15 → 29 → 60 → 112 → 233 s, so rally sells waited behind failing buys. Per side, program rejections no longer grow.
const invalidArgument = () => new TransactionFailedError({ InstructionError: [1, "InvalidArgument"] }, []);
const notDip = () => new TransactionFailedError({ InstructionError: [1, { Custom: 6000 }] }, ["Program log: AnchorError occurred. Error Code: AgentBuyNotDip. Error Number: 6000. Error Message: Agents may only buy below the EMA band."]);
const http429 = () => new Error("429 Too Many Requests: Too Many Requests");

test("a failing buy never holds a sell back", () => {
  const b = new TradeBackoff();
  for (let i = 0; i < 8; i++) b.failed("buy", invalidArgument(), 100, 1_000 * i);
  assert.equal(b.wait("sell", 100, 8_000).ms, 0);
  assert.ok(b.wait("buy", 100, 8_000).ms > 0);
});

test("program rejections wait at most PROGRAM_RETRY_MS however often they repeat, and end with the next state change", () => {
  const b = new TradeBackoff();
  let now = 0;
  for (let i = 0; i < 20; i++) {
    const { kind, retryInMs } = b.failed("buy", i % 2 ? notDip() : invalidArgument(), 500, now);
    assert.equal(kind, "program");
    assert.equal(retryInMs, PROGRAM_RETRY_MS);
    now += PROGRAM_RETRY_MS;
  }
  const last = now - PROGRAM_RETRY_MS;
  assert.equal(b.wait("buy", 500, last + 1_000).ms, PROGRAM_RETRY_MS - 1_000, "same state: wait out the cap");
  assert.equal(b.wait("buy", 501, last + 1_000).ms, 0, "a later slot re-plans at once");
  assert.equal(b.wait("buy", 500, last + PROGRAM_RETRY_MS).ms, 0);
  assert.equal(b.wait("buy", 500, last).error, "Agents may only buy below the EMA band");
});

test("transport failures back off exponentially up to 30 s, and a landed send of the side clears it", () => {
  const b = new TradeBackoff();
  const waits = [http429(), http429(), new TransactionExpiredError("sig", 1), http429(), http429(), http429()].map((err) => b.failed("sell", err, 7, 0).retryInMs);
  assert.deepEqual(waits, [2_000, 4_000, 8_000, 16_000, MAX_TRANSPORT_BACKOFF_MS, MAX_TRANSPORT_BACKOFF_MS]);
  assert.equal(b.wait("sell", 99, 1_000).ms, MAX_TRANSPORT_BACKOFF_MS - 1_000, "a transport wait does not end with a state change");
  b.landed("sell");
  assert.equal(b.wait("sell", 7, 0).ms, 0);
  assert.equal(b.failed("sell", http429(), 7, 0).retryInMs, 2_000);
});

test("a same-slot collision with a public trade is retried without waiting", () => {
  const b = new TradeBackoff();
  const sameSlot = new TransactionFailedError({ InstructionError: [0, { Custom: 1 }] }, [`Program log: Error Message: ${SAME_SLOT_TRADE_MESSAGE}.`]);
  const { kind, retryInMs } = b.failed("buy", sameSlot, 3, 0);
  assert.equal(kind, "same_slot");
  assert.equal(retryInMs, 0);
  assert.equal(b.wait("buy", 3, 0).ms, 0);
});
