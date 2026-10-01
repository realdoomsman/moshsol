import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ActivityLog, type ActivityItem, type ActivityLaunch } from "../src/activity";
import { Narrator } from "../src/narrate";
import { startStatusServer, type StatusSnapshot } from "../src/status";

const LAUNCH: ActivityLaunch = { address: "Launch111", mint: "Mint111", symbol: "HF", venue: "pump" };
const OTHER: ActivityLaunch = { address: "Launch222", mint: "Mint222", venue: "native" };

const item = (ts: number, kind: ActivityItem["kind"], reason: string, detail: ActivityItem["detail"] = {}): Omit<ActivityItem, "narrative"> => ({
  ts,
  kind,
  reason,
  detail,
});

/** Resolves every narration with a canned sentence and remembers the prompts it was given. */
class StubNarrator extends Narrator {
  readonly prompts: string[] = [];
  private readonly pending: Promise<string | null>[] = [];
  constructor(private readonly text: string | null = "Sold a slice into strength.") {
    super({ url: "http://narrator.invalid", key: "unused", model: "stub" });
  }
  override narrate(_system: string, user: string): Promise<string | null> {
    this.prompts.push(user);
    const p = Promise.resolve(this.text);
    this.pending.push(p);
    return p;
  }
  /** Resolves after every narration so far was handed back to the log (its reactions run before ours). */
  flush(): Promise<unknown> {
    return Promise.all(this.pending);
  }
}

test("ring keeps the newest 200 per launch, newest first, by address or mint", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  for (let i = 0; i < 250; i++) logbook.record(LAUNCH, item(1_000 + i, i % 2 ? "sell" : "buyback", `r${i}`, { i, lamports: "1000", ok: true }));
  logbook.record(OTHER, item(5, "hold", "quiet"));
  const byAddress = logbook.items(LAUNCH.address);
  assert.ok(byAddress);
  assert.equal(byAddress.length, 200);
  assert.equal(byAddress[0].reason, "r249");
  assert.equal(byAddress[199].reason, "r50");
  assert.deepEqual(byAddress[0].detail, { i: 249, lamports: "1000", ok: true });
  assert.deepEqual(logbook.items(LAUNCH.mint), byAddress);
  assert.equal(logbook.items(OTHER.mint)?.length, 1);
  assert.equal(logbook.items("nope"), null);
  logbook.close();
});

test("the mint resolves to the launch's ring once it changes (pump launches get their mint late)", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  const before = { ...LAUNCH, mint: "11111111111111111111111111111111" };
  logbook.record(before, item(1, "hold", "pre-launch"));
  logbook.record(LAUNCH, item(2, "buy", "launch"));
  assert.equal(logbook.items(LAUNCH.mint)?.length, 2);
  assert.equal(logbook.items(before.mint)?.length, 2);
  logbook.close();
});

test("consecutive identical holds collapse into one item; anything else is recorded", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  const first = logbook.record(LAUNCH, item(1, "hold", "inside band"));
  assert.equal(logbook.record(LAUNCH, item(2, "hold", "inside band")), first);
  assert.equal(logbook.items(LAUNCH.address)?.length, 1);
  logbook.record(LAUNCH, item(3, "hold", "flow gate"));
  assert.equal(logbook.items(LAUNCH.address)?.length, 2);
  logbook.record(LAUNCH, item(4, "sell", "above band"));
  logbook.record(LAUNCH, item(5, "hold", "above band"));
  logbook.record(LAUNCH, item(6, "hold", "above band"));
  assert.deepEqual(
    logbook.items(LAUNCH.address)?.map((i) => i.ts),
    [5, 4, 3, 1],
  );
  // Holds of another launch do not interfere.
  logbook.record(OTHER, item(7, "hold", "above band"));
  assert.equal(logbook.items(OTHER.address)?.length, 1);
  logbook.close();
});

test("holds of the same kind with drifting numbers collapse for 10 minutes, then refresh; a different kind is recorded at once", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  const first = logbook.record(LAUNCH, item(1000, "hold", "dip −14.0% but above cost", { holdKind: "cost_basis" }));
  assert.equal(logbook.record(LAUNCH, item(1004, "hold", "dip −14.1% but above cost", { holdKind: "cost_basis" })), first);
  logbook.record(LAUNCH, item(1008, "hold", "dip −14.2%, acting from −2.3%", { holdKind: "entry" }));
  logbook.record(LAUNCH, item(1012, "hold", "dip −14.3% but above cost", { holdKind: "cost_basis" }));
  assert.equal(logbook.record(LAUNCH, item(1500, "hold", "dip −15.0% but above cost", { holdKind: "cost_basis" })).ts, 1012);
  assert.equal(logbook.record(LAUNCH, item(1612, "hold", "dip −15.1% but above cost", { holdKind: "cost_basis" })).ts, 1612);
  assert.deepEqual(
    logbook.items(LAUNCH.address)?.map((i) => i.ts),
    [1612, 1012, 1008, 1000],
  );
  logbook.close();
});

test("a dry-run plan repeating the newest dry-run plan's kind and amount collapses; a new amount or a landed trade does not", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  const first = logbook.record(LAUNCH, item(1, "sell", "dry run: rally +16.4%", { dryRun: true, amountTokens: 9.97e6 }));
  assert.equal(logbook.record(LAUNCH, item(2, "sell", "dry run: rally +16.3%", { dryRun: true, amountTokens: 9.97e6 })), first);
  logbook.record(LAUNCH, item(3, "sell", "dry run: rally +18%", { dryRun: true, amountTokens: 1.2e7 }));
  logbook.record(LAUNCH, item(4, "sell", "rally +18%", { amountTokens: 1.2e7 }));
  logbook.record(LAUNCH, item(5, "sell", "rally +18%", { amountTokens: 1.2e7 }));
  logbook.record(LAUNCH, item(6, "buy", "dry run: dip", { dryRun: true, amountSol: 0.1 }));
  assert.deepEqual(
    logbook.items(LAUNCH.address)?.map((i) => i.ts),
    [6, 5, 4, 3, 1],
  );
  logbook.close();
});

test("bigint detail is rejected with a clear error", () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  assert.throws(
    () => logbook.record(LAUNCH, item(1, "sell", "x", { lamports: 5n as unknown as string })),
    /detail\.lamports is a bigint/,
  );
  assert.equal(logbook.items(LAUNCH.address), null);
  logbook.close();
});

test("items survive a restart from the SQLite file, pruned to 200 per launch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holdfast-activity-"));
  const file = path.join(dir, "nested", "agent.db");
  const narrator = new StubNarrator();
  const logbook = new ActivityLog({ file, narrator });
  for (let i = 0; i < 230; i++) logbook.record(LAUNCH, item(100 + i, "sell", `s${i}`, { i }), { price: 1.5 });
  logbook.record(LAUNCH, item(400, "payout", "vault 5x", { lamports: "123" }));
  const signed = logbook.record(OTHER, { ...item(401, "buyback", "dip"), sig: "sig123" });
  await narrator.flush();
  assert.equal(signed.narrative, "Sold a slice into strength.");
  logbook.close();

  const reopened = new ActivityLog({ file, narrator: null });
  const items = reopened.items(LAUNCH.mint);
  assert.ok(items);
  assert.equal(items.length, 200);
  assert.deepEqual(items[0], { ts: 400, kind: "payout", reason: "vault 5x", detail: { lamports: "123" }, narrative: "Sold a slice into strength." });
  assert.equal(items[199].reason, "s31");
  assert.deepEqual(reopened.items(OTHER.address), [{ ...signed }]);
  assert.equal(reopened.items(OTHER.mint)?.[0].sig, "sig123");
  reopened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("narration is applied asynchronously; holds at most once per launch per 10 minutes", async () => {
  const narrator = new StubNarrator();
  const logbook = new ActivityLog({ file: ":memory:", narrator });
  const sold = logbook.record(LAUNCH, item(1, "sell", "above band", { lamports: "10" }), { ema: 0.5 });
  assert.equal(sold.narrative, undefined);
  await narrator.flush();
  assert.equal(sold.narrative, "Sold a slice into strength.");
  assert.equal(logbook.items(LAUNCH.address)?.[0].narrative, "Sold a slice into strength.");
  const prompt = JSON.parse(narrator.prompts[0]);
  assert.deepEqual(prompt.launch, { symbol: "HF", venue: "pump" });
  assert.equal(prompt.item.reason, "above band");
  assert.deepEqual(prompt.context, { ema: 0.5 });

  const hold1 = logbook.record(LAUNCH, item(2, "hold", "inside band"));
  const hold2 = logbook.record(LAUNCH, item(3, "hold", "flow gate"));
  const otherHold = logbook.record(OTHER, item(4, "hold", "inside band"));
  logbook.record(LAUNCH, item(5, "buy", "dip"));
  await narrator.flush();
  assert.equal(hold1.narrative, "Sold a slice into strength.");
  assert.equal(hold2.narrative, undefined);
  assert.equal(otherHold.narrative, "Sold a slice into strength.");
  assert.equal(narrator.prompts.length, 4);
  logbook.close();
});

test("a narrator that fails leaves the item without a narrative", async () => {
  const narrator = new StubNarrator(null);
  const logbook = new ActivityLog({ file: ":memory:", narrator });
  const sold = logbook.record(LAUNCH, item(1, "sell", "above band"));
  await narrator.flush();
  assert.equal(sold.narrative, undefined);
  logbook.close();
});

test("status server serves activity by mint or address and the research snapshot", async () => {
  const logbook = new ActivityLog({ file: ":memory:", narrator: null });
  logbook.record(LAUNCH, item(1, "sell", "above band", { lamports: "10" }));
  logbook.record(LAUNCH, item(2, "hold", "inside band"));
  const status = { agent: "A", dryRun: true, startedAt: 0, lastTickAt: null, tick: 0, balanceSol: null, lookupTable: null, decisions: [], cranks: [] } satisfies StatusSnapshot;
  const research = { items: [], updatedAt: null, running: false, nextAt: 42 };
  const server = await startStatusServer("127.0.0.1", 0, { status: () => status, activity: (key) => logbook.items(key), research: () => research });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const get = async (p: string) => {
    const res = await fetch(`http://127.0.0.1:${addr.port}${p}`);
    return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: await res.json() };
  };
  const byMint = await get(`/launches/${LAUNCH.mint}/activity`);
  const byAddress = await get(`/launches/${LAUNCH.address}/activity`);
  assert.equal(byMint.status, 200);
  assert.equal(byMint.cors, "*");
  assert.deepEqual(byMint.body, byAddress.body);
  assert.deepEqual(
    byMint.body.items.map((i: ActivityItem) => i.reason),
    ["inside band", "above band"],
  );
  assert.deepEqual(await get("/launches/unknown/activity"), { status: 404, cors: "*", body: { error: "unknown launch" } });
  assert.deepEqual((await get("/research")).body, research);
  assert.deepEqual((await get("/status")).body, status);
  assert.equal((await get("/launches/x/other")).status, 404);
  server.close();
  logbook.close();
});
