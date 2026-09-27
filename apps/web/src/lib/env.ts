export type Cluster = "localnet" | "devnet" | "mainnet-beta";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8900";
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
export const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL || "http://127.0.0.1:8788").replace(/\/+$/, "");
/** Public origin of this site; used for absolute share/OG URLs rendered on the server. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

const rawCluster = process.env.NEXT_PUBLIC_CLUSTER;
export const CLUSTER: Cluster = rawCluster === "devnet" || rawCluster === "mainnet-beta" ? rawCluster : "localnet";

/** Burner wallet + faucet are only offered on throwaway clusters. */
export const IS_TEST_CLUSTER = CLUSTER === "localnet" || CLUSTER === "devnet";

export const CLUSTER_LABEL: Record<Cluster, string> = {
  localnet: "Localnet",
  devnet: "Devnet",
  "mainnet-beta": "Mainnet",
};

/** The cluster in running copy: "Live from localnet", "Recorded on devnet". */
export const CLUSTER_NAME = CLUSTER_LABEL[CLUSTER].toLowerCase();

export const INDEXER_WS_URL = `${INDEXER_URL.replace(/^http/, "ws")}/ws`;
