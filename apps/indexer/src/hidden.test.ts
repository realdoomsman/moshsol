import assert from "node:assert/strict";
import { test } from "node:test";
import { HiddenLaunches } from "./hidden";

const D = "11111111111111111111111111111111";
test("brand impersonators are hidden unless official", () => {
  const h = new HiddenLaunches([], ["OfficialMint1111111111111111111111111111111"]);
  for (const [name, symbol] of [["HoldFast", "HOLD"], ["Hold Fast", "HF"], ["holdfast cat", "HCAT"], ["Something", "hold"], ["X", "HOLDFAST"]]) {
    assert.ok(h.has({ address: "A", mint: D, meta_name: name, meta_symbol: symbol }), `${name}/${symbol}`);
  }
  for (const [name, symbol] of [["Test Cat", "TEST"], ["Hold Cat", "HOLDCAT"], ["Holder", "HLDR"]]) {
    assert.ok(!h.has({ address: "A", mint: D, meta_name: name, meta_symbol: symbol }), `${name}/${symbol}`);
  }
  assert.ok(!h.has({ address: "A", mint: "OfficialMint1111111111111111111111111111111", meta_name: "HoldFast", meta_symbol: "HOLD" }));
  assert.ok(h.has({ address: "A", mint: D, name: "HoldFast", symbol: "HOLD" }), "summary-shaped objects too");
});
