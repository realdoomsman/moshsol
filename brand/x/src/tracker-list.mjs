// Wallet-tracker import list for the vault agent's 15 wallets (platform.agent_executors), named and numbered, as the
// JSON array that Axiom, Padre and GMGN all import: [{"address","name","emoji"}] (Axiom also reads
// `trackedWalletAddress`, Padre `address ?? trackedWalletAddress`, GMGN documents exactly these three keys).
//   node brand/x/src/tracker-list.mjs
// Output: brand/x/stats/<unix time>/{agent-wallets.json,posts.json}
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { get, outDir, render } from "./stat-card.mjs";

const EMOJI = "🟠";
const wallets = (await get("/api/platform")).agentExecutors;
if (wallets.length !== 15) throw new Error(`expected 15 agent wallets, platform lists ${wallets.length}`);

const entries = wallets.map((address, i) => ({ address, name: `Holdfast Agent ${String(i + 1).padStart(2, "0")}`, emoji: EMOJI }));
// One wallet per line: readable in the post, still one JSON array when pasted.
const json = `[\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]`;
if (JSON.parse(json).length !== 15) throw new Error("list does not round-trip");

const now = Math.floor(Date.now() / 1000);
writeFileSync(join(outDir(now), "agent-wallets.json"), `${json}\n`);

const text = `Track the Holdfast vault agent yourself.

All 15 agent wallets, named and ready to import into Axiom, Padre or GMGN: Wallet Tracker → Import → paste the list below.

Every vault trade goes through these wallets.

${json}`;

render(now, [], [{ images: [], alt: [], text }], { wallets });
