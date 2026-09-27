/**
 * Checks the dev stack before `pnpm dev` / `pnpm start` launch the services, and fails fast (exit 1)
 * with the command that fixes it: validator unreachable, program missing, platform not initialized,
 * agent key missing, or a service port (indexer, agent status, web 3000) already taken.
 *
 * Env: RPC_URL (default http://127.0.0.1:8899), AGENT_KEYPAIR (default .localnet/agent.json),
 *      PORT (indexer, 8787), STATUS_PORT (agent, 8788).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { MoshClient, PROGRAM_ID } from "@holdfast/sdk";
import { ROOT, RPC_URL } from "./common";

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(RPC_URL);

function fail(problem: string, fix: string): never {
  console.error(`\n✗ preflight: ${problem}\n  → ${fix}\n`);
  process.exit(1);
}

/** Something already accepts connections on localhost:port (IPv4 or IPv6, e.g. Next binds `::`). */
async function portInUse(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::1"]) {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const sock = net.connect({ port, host });
    sock.setTimeout(1_000);
    sock.once("connect", () => resolve(true));
    sock.once("timeout", () => resolve(false));
    sock.once("error", () => resolve(false));
    const used = await promise;
    sock.destroy();
    if (used) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const version = await connection.getVersion().catch(() => null);
  if (!version) {
    fail(
      `validator not reachable at ${RPC_URL}`,
      isLocal ? "start it in another terminal: pnpm localnet   (fresh chain: pnpm reset:localnet)" : "check RPC_URL",
    );
  }
  const program = await connection.getAccountInfo(PROGRAM_ID);
  if (!program?.executable) {
    fail(
      `program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC_URL}`,
      isLocal ? "anchor build, then restart the validator from a fresh ledger: pnpm reset:localnet" : "deploy it: bash scripts/deploy.sh",
    );
  }
  const platform = await new MoshClient(connection).fetchPlatform();
  if (!platform) fail("platform not initialized on this chain", "pnpm setup:localnet");

  const agentPath = path.resolve(ROOT, process.env.AGENT_KEYPAIR?.trim() || ".localnet/agent.json");
  if (!fs.existsSync(agentPath)) fail(`agent keypair ${agentPath} not found`, "pnpm setup:localnet (or set AGENT_KEYPAIR)");
  const agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(agentPath, "utf8")) as number[]));
  if (!agent.publicKey.equals(platform.agentAuthority)) {
    console.warn(
      `! preflight: ${agentPath} (${agent.publicKey.toBase58()}) is not the platform agent authority ` +
        `(${platform.agentAuthority.toBase58()}); the agent will only report decisions`,
    );
  }

  const ports: [string, number][] = [
    ["indexer (PORT)", Number(process.env.PORT || 8787)],
    ["agent status (STATUS_PORT)", Number(process.env.STATUS_PORT || 8788)],
    ["web", 3000],
  ];
  for (const [what, port] of ports) {
    if (await portInUse(port)) fail(`port ${port} for the ${what} is already in use`, "stop the process holding it (another `pnpm dev`?)");
  }
  console.log(`✓ preflight: ${RPC_URL} (solana-core ${version["solana-core"]}), program + platform ready, ports free`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err), "see the error above"));
