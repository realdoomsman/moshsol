import fs from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { MoshClient } from "@holdfast/sdk";
import { RPC_URL } from "./common";

const LAUNCH = new PublicKey("EGy86QhJtC58hPzCxR9gY4rqNoGFzkNj8M42sQqcuvqR");
const MINT = new PublicKey("B77MYakpiRLtL6P8Mqa1DKnuk4nHKQ13Rpk4D8F7MVqi");
const kp = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));

async function main() {
  const c = new Connection(RPC_URL, "confirmed");
  const agent = kp("../.mainnet/agent.json");
  const exec = kp("../.mainnet/agent-wallets/01.json");
  const client = new MoshClient(c, { publicKey: agent.publicKey, signTransaction: async (t: never) => t, signAllTransactions: async (t: never) => t } as never);
  const j = await (await fetch("https://api.holdfast.fun/api/launches/" + LAUNCH.toBase58())).json() as { pump?: { graduated?: boolean }; graduated?: boolean };
  const l = { pump: { graduated: Boolean(j.pump?.graduated ?? j.graduated) } };
  const ref = { address: LAUNCH, mint: MINT, graduated: l.pump.graduated };
  console.log("graduated", ref.graduated);
  const alt = (await c.getAddressLookupTable(new PublicKey("6gmDsoEPFfQf4Np6rzDosLJYjXpYZVNrMAEP5qjE8VSq"))).value!;
  const alts = [alt];
  console.log("alt entries", alt.state.addresses.length);
  for (const side of ["buy", "sell"] as const) {
    const ix = side === "buy"
      ? await client.agentBuyPumpIx(agent.publicKey, ref, 10_000_000n, 0n, exec.publicKey)
      : await client.agentSellPumpIx(agent.publicKey, ref, 100_000_000_000n, 0n, exec.publicKey);
    const { blockhash } = await c.getLatestBlockhash();
    const msg = new TransactionMessage({ payerKey: agent.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix] }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    const sim = await c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    console.log(`== ${side}: err ${JSON.stringify(sim.value.err)}`);
    for (const line of sim.value.logs ?? []) console.log("  ", line.slice(0, 220));
    console.log("accounts", ix.keys.length, "data", ix.data.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
