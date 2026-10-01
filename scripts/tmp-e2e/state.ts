import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { launchPda, vaultPda, curvePda, platformPda } from "@holdfast/sdk";
import { RPC_URL, clientFor, loadOrCreateKeypair } from "../src/common";

const connection = new Connection(RPC_URL, "confirmed");
const admin = loadOrCreateKeypair("admin");
const client = clientFor(connection, admin);
const GOOGLE = new PublicKey("2ZbiVRNFkZJZSz7E6opygmFn9FS6BmEJtg4ftqv4jkQt");
const VAULT = new PublicKey("6vUgXnEMbho2pVTEnwwGRj9xjcnb2btKGoWGqoMuzBWF");
const sol = (l: number | bigint) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);

const platform = await client.fetchPlatform();
console.log("platform", JSON.stringify(platform, (_, v) => (typeof v === "object" && v?.toBase58 ? v.toBase58() : typeof v === "object" && v?.toString && v?.words ? v.toString() : v), 1));
const names = ["deployer", "google", "multisigVault", "treasury", "feeRecipient"] as const;
const keys = [admin.publicKey, GOOGLE, VAULT, new PublicKey("AuAX3tXYKNyZYXueyGudKtRLiz1MSicptArWPq7B8uY9"), platform!.feeRecipient as PublicKey];
const infos = await connection.getMultipleAccountsInfo(keys);
infos.forEach((i, n) => console.log(names[n], keys[n].toBase58(), sol(i?.lamports ?? 0)));
const mintArg = process.argv[2];
if (mintArg) {
  const mint = new PublicKey(mintArg);
  const launch = launchPda(mint);
  const l = await client.fetchLaunch(mint);
  console.log("launch", launch.toBase58(), JSON.stringify(l, (_, v) => (v?.toBase58 ? v.toBase58() : v?.words ? v.toString() : v), 1));
  const [li, vi, ci] = await connection.getMultipleAccountsInfo([launch, vaultPda(launch), curvePda(launch)]);
  console.log("launch lamports", sol(li?.lamports ?? 0), "vault ata lamports", vi?.lamports, "curve ata lamports", ci?.lamports);
  const vb = await connection.getTokenAccountBalance(vaultPda(launch)).catch(() => null);
  const cb = await connection.getTokenAccountBalance(curvePda(launch)).catch(() => null);
  console.log("vault tokens", vb?.value.uiAmountString, "curve tokens", cb?.value.uiAmountString);
}
