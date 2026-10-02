/** What `vault-withdraw` (admin) and `dev-withdraw` (dev key) share: resolving the launch and the amounts. */
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, launchToJson, solToLamports, uiToTokens, type LaunchAccount, type LaunchJson, type MoshClient } from "@holdfast/sdk";
import { fail } from "./squads";

/** Borsh offset of `Launch.mint` (after the discriminator, `index` and `creator`). */
const LAUNCH_MINT_OFFSET = 8 + 8 + 32;

/**
 * `LAUNCH`: a launch account address, or the mint of a launched one (pump launches are keyed by their
 * create key, so a mint is looked up through `Launch.mint`). Fails unless it decodes in the current layout.
 */
export async function loadLaunch(connection: Connection, client: MoshClient): Promise<LaunchJson> {
  const raw = process.env.LAUNCH?.trim();
  if (!raw) fail("set LAUNCH=<launch address or mint>");
  let key: PublicKey;
  try {
    key = new PublicKey(raw);
  } catch {
    fail(`LAUNCH=${raw} is not an address`);
  }
  let info = await connection.getAccountInfo(key);
  if (!info?.owner.equals(PROGRAM_ID)) {
    const byMint = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: client.program.coder.accounts.memcmp("launch").bytes as string } },
        { memcmp: { offset: LAUNCH_MINT_OFFSET, bytes: key.toBase58() } },
      ],
    });
    if (byMint.length !== 1) fail(`${key.toBase58()} is neither a launch of ${PROGRAM_ID.toBase58()} nor the mint of exactly one`);
    key = byMint[0]!.pubkey;
    info = byMint[0]!.account;
  }
  try {
    return launchToJson(key, client.program.coder.accounts.decode<LaunchAccount>("launch", info.data));
  } catch {
    fail(`${key.toBase58()} is not in the current layout; run \`pnpm migrate:launches\` first`);
  }
}

/** `SOL` / `TOKENS`: a decimal amount or `all` (= everything the vault holds); 0 when unset. */
export function withdrawAmounts(launch: LaunchJson): { vaultSol: bigint; vaultTokens: bigint; sol: bigint; tokens: bigint } {
  const vaultSol = BigInt(launch.vaultSol);
  const vaultTokens = BigInt(launch.vaultTokens);
  const amount = (name: string, all: bigint, parse: (s: string) => bigint): bigint => {
    const value = process.env[name]?.trim();
    if (!value) return 0n;
    if (value === "all") return all;
    const v = parse(value);
    if (v > all) fail(`${name}=${value} exceeds what the vault holds (${all} base units)`);
    return v;
  };
  const sol = amount("SOL", vaultSol, solToLamports);
  const tokens = amount("TOKENS", vaultTokens, uiToTokens);
  if (sol === 0n && tokens === 0n) fail("nothing to withdraw: set SOL and/or TOKENS (a decimal amount or `all`)");
  return { vaultSol, vaultTokens, sol, tokens };
}
