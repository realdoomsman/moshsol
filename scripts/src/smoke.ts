import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OPEN_WHITELIST_ROOT, launchToJson, launchPda, quoteBuy, curveOf } from "@moshsol/sdk";
import { RPC_URL, airdrop, clientFor, send, loadOrCreateKeypair } from "./common";

const connection = new Connection(RPC_URL, "confirmed");
const creator = Keypair.generate();
await airdrop(connection, creator.publicKey, 50);
const client = clientFor(connection, creator);
const platform = (await client.fetchPlatform())!;
const mint = Keypair.generate();
const createIx = await client.createLaunchIx({
  creator: creator.publicKey, mint: mint.publicKey, feeRecipient: platform.feeRecipient,
  name: "Smoke", symbol: "SMK", uri: "http://localhost/x.json",
  raiseMin: 2n * 1_000_000_000n, raiseMax: 10n * 1_000_000_000n, maxPerWallet: 0n, durationSecs: 600,
  whitelistRoot: OPEN_WHITELIST_ROOT, bundleSupplyBps: 2000, reserveBps: 3000,
});
console.log("create", await send(client, creator, [createIx], [mint], 400_000));
console.log("meta", await client.fetchTokenMeta(mint.publicKey));
await send(client, creator, [await client.depositIx(creator.publicKey, mint.publicKey, 5n * 1_000_000_000n)]);
const sig = await send(client, creator, [await client.launchIx(creator.publicKey, mint.publicKey)]);
const l = (await client.fetchLaunch(mint.publicKey))!;
const q = quoteBuy(curveOf(l), 1_000_000_000n, platform.params.tradeFeeBps);
const buySig = await send(client, creator, [await client.buyIx(creator.publicKey, mint.publicKey, 1_000_000_000n, q.tokensOut)]);
const tx = await connection.getTransaction(buySig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
console.log(JSON.stringify(client.parseEvents(tx!.meta!.logMessages!), (_, v) => (typeof v === "object" && v?.constructor?.name === "BN" ? v.toString() : v), 1).slice(0, 800));
const tx2 = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
console.log(client.parseEvents(tx2!.meta!.logMessages!).map((e) => e.name));
const j = launchToJson(launchPda(mint.publicKey), (await client.fetchLaunch(mint.publicKey))!);
console.log(j.status, j.priceSol, j.marketCapSol, j.vaultSol, j.emaSol);
console.log(LAMPORTS_PER_SOL, loadOrCreateKeypair("agent").publicKey.toBase58());
