import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RPC_URL, clientFor, loadOrCreateKeypair, send } from "../src/common";

const connection = new Connection(RPC_URL, "confirmed");
const admin = loadOrCreateKeypair("admin");
const client = clientFor(connection, admin);
const to = new PublicKey(process.argv[2]!);
const lamports = Math.round(Number(process.argv[3]!) * LAMPORTS_PER_SOL);
const sig = await send(client, admin, [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: to, lamports })]);
console.log(`sent ${lamports} lamports to ${to.toBase58()}: ${sig}`);
