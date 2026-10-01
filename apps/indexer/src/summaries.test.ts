import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchJson } from "@holdfast/sdk";
import { vaultModelOf } from "./summaries";

const TERMS = {
  tradeFeeBps: 0,
  backerFeeShareBps: 0,
  creatorFeeShareBps: 0,
  launchFeeBps: 100,
  agentBuyBpsPerWindow: 1000,
  agentSellBpsPerWindow: 500,
  agentMaxImpactBps: 300,
  agentBandBps: 200,
  agentWindowSecs: 3600,
  emaPeriodSecs: 1800,
  burnShareBps: 1500,
  creatorFeeVaultBps: 7500,
  payoutMultBps: 50_000,
  payoutShareBps: 1500,
  payoutIntervalSecs: 14_400,
  deadHoldersBps: 500,
  minVaultSol: "100000000",
} as LaunchJson["terms"];

test("payback target, multiple and the creator-fee split follow the frozen terms", () => {
  const m = vaultModelOf({
    terms: TERMS,
    initialVaultSol: "1000000000",
    vaultSol: "2500000000",
    backersRepaid: "1000000000",
    backerPayouts: "375000000",
    creatorFeesCollected: "1000000001",
  });
  assert.equal(m.payoutTargetSol, 5);
  assert.equal(m.payoutMultiple, 2.5);
  assert.equal(m.backersRepaidSol, 1);
  assert.equal(m.backerPayoutsSol, 0.375);
  assert.equal(m.backerCreatorFeeBps, 1000);
  assert.equal(m.minVaultSol, "100000000");
  // 75% / 15% rounded down in lamports, the backers get the remainder (so the three sum to the total).
  assert.deepEqual(m.creatorFeeSplit, { vaultSol: 0.75, burnSol: 0.15, backersSol: 0.100000001 });
});

test("a snapshot from before the vault model reads as zero instead of throwing", () => {
  const legacy = { ...TERMS } as Record<string, unknown>;
  for (const k of ["creatorFeeVaultBps", "payoutMultBps", "payoutShareBps", "payoutIntervalSecs", "deadHoldersBps", "minVaultSol"]) delete legacy[k];
  const m = vaultModelOf({ terms: legacy as LaunchJson["terms"], vaultSol: "5000", creatorFeesCollected: "1000" });
  assert.equal(m.payoutTargetSol, 0);
  assert.equal(m.payoutMultiple, 0);
  assert.equal(m.backersRepaidSol, 0);
  assert.equal(m.creatorFeeVaultBps, 0);
  assert.equal(m.backerCreatorFeeBps, 8500);
  assert.equal(m.minVaultSol, "0");
  assert.deepEqual(m.creatorFeeSplit, { vaultSol: 0, burnSol: 0.00000015, backersSol: 0.00000085 });
});
