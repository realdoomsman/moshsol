import { CLUSTER, RPC_URL } from "./env";

function clusterQuery(): string {
  if (CLUSTER === "mainnet-beta") return "";
  if (CLUSTER === "devnet") return "?cluster=devnet";
  return `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery()}`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery()}`;
}
