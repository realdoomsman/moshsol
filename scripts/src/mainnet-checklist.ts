/**
 * Mainnet readiness checklist (`pnpm mainnet:check`). Read-only: prints a pass/fail table and exits 1
 * if any check fails.
 *
 *   RPC_URL=https://<keyed-mainnet-rpc> pnpm mainnet:check
 *
 * Checks: RPC reachable and not devnet/testnet genesis, program deployed as upgradeable with an
 * upgrade authority, platform initialized with beta caps set, agent authority funded ≥ 0.1 SOL,
 * fee recipient (treasury) rent-exempt.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, MoshClient, PROGRAM_ID, lamportsToSol } from "@holdfast/sdk";
import { RPC_URL } from "./common";

const GENESIS: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};
const MIN_AGENT_LAMPORTS = 0.1 * LAMPORTS_PER_SOL;

type Row = { check: string; ok: boolean; detail: string };
const rows: Row[] = [];
const row = (check: string, ok: boolean, detail: string) => rows.push({ check, ok, detail });
const sol = (lamports: number | bigint | { toString(): string }) => `${lamportsToSol(lamports.toString())} SOL`;

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  // The URL may embed an API key; show only the host.
  const host = new URL(RPC_URL).host;

  const version = await connection.getVersion().catch((e: unknown) => e as Error);
  if (version instanceof Error) {
    row("RPC reachable", false, `${host}: ${version.message}`);
    return;
  }
  row("RPC reachable", true, `${host} (solana-core ${version["solana-core"]}, slot ${await connection.getSlot()})`);

  const genesis = await connection.getGenesisHash();
  const cluster = GENESIS[genesis] ?? "localnet/unknown";
  row("Cluster is not devnet/testnet", cluster !== "devnet" && cluster !== "testnet", `${cluster} (genesis ${genesis.slice(0, 8)}…)`);

  const program = await connection.getAccountInfo(PROGRAM_ID);
  const programData = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];
  const data = program?.executable ? await connection.getAccountInfo(programData) : null;
  if (!program?.executable || !program.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || !data) {
    row("Program deployed (upgradeable)", false, `${PROGRAM_ID.toBase58()} not found as an upgradeable program`);
  } else {
    // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority: Option<Pubkey> } after a u32 tag.
    const slot = data.data.readBigUInt64LE(4);
    const authority = data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)).toBase58() : null;
    row("Program deployed (upgradeable)", true, `${PROGRAM_ID.toBase58()}, ${data.data.length - 45} B, deployed slot ${slot}`);
    row("Upgrade authority set", authority !== null, authority ?? "none — program is immutable, fixes impossible");
  }

  const platform = await new MoshClient(connection).fetchPlatform().catch((e: unknown) => e as Error);
  if (platform === null || platform instanceof Error) {
    row(
      "Platform initialized",
      false,
      platform ? `account doesn't decode with this build (old layout?): ${platform.message}` : "not initialized — run setup",
    );
    return;
  }
  const p = platform.params;
  row("Platform initialized", true, `admin ${platform.admin.toBase58()}, ${platform.launchCount.toString()} launches`);
  const raiseCap = BigInt(p.maxRaiseLamports.toString());
  const walletCap = BigInt(p.maxWalletDepositLamports.toString());
  row(
    "Beta caps set",
    raiseCap > 0n && walletCap > 0n,
    `max raise ${raiseCap > 0n ? sol(raiseCap) : "uncapped"}, per wallet ${walletCap > 0n ? sol(walletCap) : "uncapped"}`,
  );
  row("Platform not paused", !p.paused && !p.agentsPaused, `paused=${p.paused}, agentsPaused=${p.agentsPaused}`);

  const agentLamports = await connection.getBalance(platform.agentAuthority);
  row(
    "Agent key funded ≥ 0.1 SOL",
    agentLamports >= MIN_AGENT_LAMPORTS,
    `${platform.agentAuthority.toBase58()}: ${sol(agentLamports)}`,
  );

  const treasury = await connection.getAccountInfo(platform.feeRecipient);
  const treasuryRent = await connection.getMinimumBalanceForRentExemption(treasury?.data.length ?? 0);
  const treasuryLamports = treasury?.lamports ?? 0;
  row(
    "Treasury rent-exempt",
    treasuryLamports >= treasuryRent,
    `${platform.feeRecipient.toBase58()}: ${sol(treasuryLamports)} (needs ${sol(treasuryRent)})`,
  );
}

function print(): void {
  const w = Math.max(...rows.map((r) => r.check.length));
  console.log(`\nHoldfast mainnet checklist — ${new URL(RPC_URL).host}\n`);
  for (const r of rows) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(w)}  ${r.detail}`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n  ${rows.length - failed}/${rows.length} passed${failed ? ` — ${failed} failing` : ""}\n`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err: unknown) => row("Checklist ran", false, err instanceof Error ? err.message : String(err)))
  .finally(print);
