// Throwaway: reads the fenced blocks under each "### PINNED / P1… / V1… / Bio" heading of brand/x/README.md and
// counts them the way X does: any *.fun / *.so URL counts 23, everything else by code point.
import { readFileSync } from "node:fs";
const md = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const re = /^### (PINNED|P\d|V\d|Bio)[^\n]*\n(?:[^\n]*\n)*?```\n([\s\S]*?)```/gm;
const xlen = (s) => [...s.replace(/https?:\/\/\S+|\b[\w.-]+\.(?:fun|so)(?:\/\S*)?/g, "x".repeat(23))].length;
let bad = 0;
for (const m of md.matchAll(re)) {
  const [, id, body] = m;
  const text = body.replace(/\n$/, "");
  const n = xlen(text);
  const max = id === "Bio" ? 160 : id === "PINNED" || id.startsWith("V") ? 280 : 260;
  const ok = n <= max;
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "BAD"} ${id.padEnd(6)} ${String(n).padStart(3)} / ${max}`);
}
process.exit(bad ? 1 : 0);
