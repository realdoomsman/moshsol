/**
 * Layout migrations and the platform settings that ride with them (README "Layout migration"), all in
 * one Squads vault transaction signed by the platform admin (the multisig vault):
 * - `migrate_platform` when the platform is in an older layout: 248 bytes (pre-payback, `PlatformV2`) or
 *   270 bytes (before `dev_authority`, `PlatformV3`); the current layout is 302 bytes.
 * - one `migrate_launch(initial_vault_sol)` per launch still in the pre-payback layout (863 bytes).
 * - `set_dev_authority(DEV_AUTHORITY)` when `DEV_AUTHORITY=<pubkey>` is set and differs from the
 *   platform's (`DEV_AUTHORITY=11111111111111111111111111111111` disables the dev key).
 * - `update_platform` raising `max_bundle_supply_bps` to `MAX_BUNDLE_BPS` (default the program's hard cap,
 *   7500 = 75%; `MAX_BUNDLE_BPS=keep` leaves it) when it differs; every other param is kept as is.
 * Idempotent: already-migrated accounts and settings already in place are skipped (the program's own
 * `AlreadyMigrated` check is mirrored on the account size), a pending vault transaction with exactly
 * the remaining instructions is reused, and nothing is sent once everything is done. From the 248-byte
 * layout the settings wait for a re-run after the migration executed.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet DEV_AUTHORITY=<pubkey> \
 *     APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json pnpm migrate:launches --dry-run
 *
 * `initial_vault_sol` (what the vault held at launch: bundle + reserve) is backfilled per launch:
 * - Holdfast launches: the program derives it (raise − launch fee); the argument is ignored.
 * - unlaunched (raising / refunding) launches: 0; set at launch.
 * - launched pump launches: `bundle_sol + vault_sol` of the launch's `Launched` event, which this script
 *   reads from the launch's transaction history (pump.fun's create rent is not stored on chain), or
 *   `INITIAL_VAULT_SOL=<launch>:<lamports>[,…]` to pin it by hand. The program bounds it to
 *   `[bundle_sol, raise − launch fee]`. The plan prints every value and its source.
 *
 * Env: as `pnpm upgrade` (RPC_URL, KEYS_DIR — admin.json pays rent and fees, config.json names the
 * multisig — MULTISIG, PROPOSER_KEYPAIR / APPROVER_KEYPAIRS). `--dry-run` only prints the plan.
 * When the platform admin is not a multisig (localnet), the admin keypair signs and sends directly.
 */
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { LIMITS, PROGRAM_ID, platformPda, type MoshClient, type PlatformAccount } from "@holdfast/sdk";
import path from "node:path";
import { LOCALNET_DIR, RPC_URL, clientFor, send } from "./common";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

/** Platform sizes (with discriminator): `8 + PlatformV2 / PlatformV3 / Platform::INIT_SPACE`. */
const PLATFORM_V2_LEN = 248;
const PLATFORM_V3_LEN = 270;
const PLATFORM_LEN = 302;
/** Launch size before the payback upgrade: `8 + LaunchV2::INIT_SPACE`. */
const OLD_LAUNCH_LEN = 863;

/**
 * The platform as it will read once migrated: the current layout as is, the 270-byte layout with the
 * appended dev key at its migrated value (disabled); null for the 248-byte layout (params change too).
 */
function decodePlatform(client: MoshClient, data: Buffer): PlatformAccount | null {
  if (data.length === PLATFORM_V2_LEN) return null;
  const full = data.length === PLATFORM_V3_LEN ? Buffer.concat([data, Buffer.alloc(PLATFORM_LEN - PLATFORM_V3_LEN)]) : data;
  return client.program.coder.accounts.decode<PlatformAccount>("platform", full);
}

function devAuthorityArg(): PublicKey | null {
  const raw = process.env.DEV_AUTHORITY?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    fail(`DEV_AUTHORITY=${raw} is not a public key`);
  }
}

function maxBundleArg(): number | null {
  const raw = process.env.MAX_BUNDLE_BPS?.trim();
  if (raw === "keep") return null;
  const bps = raw ? Number(raw) : LIMITS.maxBundleSupplyBps;
  if (!Number.isInteger(bps) || bps < LIMITS.minBundleSupplyBps || bps > LIMITS.maxBundleSupplyBps) {
    fail(`MAX_BUNDLE_BPS=${raw} must be an integer in [${LIMITS.minBundleSupplyBps}, ${LIMITS.maxBundleSupplyBps}] or \`keep\``);
  }
  return bps;
}

/** The `LaunchV2` fields the plan needs, at their borsh offsets (programs/moshsol/src/state.rs, `LaunchV2`). */
function decodeOldLaunch(data: Buffer) {
  const d = data.subarray(8);
  const nameLen = d.readUInt32LE(601);
  const symbolAt = 601 + 4 + nameLen;
  return {
    status: (["raising", "live", "refunding", "woundDown"] as const)[d[72]!] ?? "unknown",
    venue: d[462] === 1 ? ("pump" as const) : ("holdfast" as const),
    raised: d.readBigUInt64LE(150),
    launchFeeBps: d.readUInt16LE(98),
    bundleSol: d.readBigUInt64LE(246),
    symbol: d.subarray(symbolAt + 4, symbolAt + 4 + d.readUInt32LE(symbolAt)).toString(),
  };
}

/** `bundle_sol + vault_sol` of the launch's `Launched` event, from its transaction history. */
async function initialVaultSolFromHistory(connection: Connection, client: MoshClient, launch: PublicKey): Promise<bigint | null> {
  let before: string | undefined;
  for (;;) {
    const sigs = await connection.getSignaturesForAddress(launch, { before, limit: 1000 }, "confirmed");
    if (sigs.length === 0) return null;
    // Oldest first within the page: the launch transaction is near the start of the history.
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const tx = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      if (!logs.some((l) => l.includes("Instruction: LaunchPump") || l.includes("Instruction: Launch"))) continue;
      for (const e of client.parseEvents(logs)) {
        if (e.name === "launched" && e.data.launch.equals(launch)) {
          return BigInt(e.data.bundleSol.toString()) + BigInt(e.data.vaultSol.toString());
        }
      }
    }
    if (sigs.length < 1000) return null;
    before = sigs[sigs.length - 1]!.signature;
  }
}

function pinnedInitialVaultSol(): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const entry of (process.env.INITIAL_VAULT_SOL ?? "").split(",").filter(Boolean)) {
    const [launch, lamports] = entry.split(":");
    if (!launch || !lamports || !/^\d+$/.test(lamports)) fail(`INITIAL_VAULT_SOL entry "${entry}" is not <launch>:<lamports>`);
    out.set(new PublicKey(launch).toBase58(), BigInt(lamports));
  }
  return out;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent\n" : ""}rpc ${new URL(RPC_URL).host}, program ${PROGRAM_ID.toBase58()}`);

  const platform = platformPda();
  const platformInfo = await connection.getAccountInfo(platform);
  if (!platformInfo) fail("the platform is not initialized on this cluster");
  // The admin that signs the migration (`platform.admin` sits right after the discriminator in both layouts).
  const platformAdmin = new PublicKey(platformInfo.data.subarray(8, 40));
  const launchDiscriminator = client.program.coder.accounts.memcmp("launch").bytes as string;
  const launches = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: launchDiscriminator } }],
  });
  const oldLaunches = launches.filter((l) => l.account.data.length === OLD_LAUNCH_LEN);
  const platformLen = platformInfo.data.length;
  if (![PLATFORM_V2_LEN, PLATFORM_V3_LEN, PLATFORM_LEN].includes(platformLen)) fail(`platform is ${platformLen} bytes: not a layout this script knows`);
  const platformOld = platformLen !== PLATFORM_LEN;
  const current = decodePlatform(client, platformInfo.data);
  const devAuthority = devAuthorityArg();
  const maxBundle = maxBundleArg();

  console.log(`platform ${platform.toBase58()}: ${platformOld ? `old layout (${platformLen} bytes)` : "current layout"}, admin ${platformAdmin.toBase58()}`);
  if (current) {
    const dev = current.devAuthority.equals(PublicKey.default) ? "disabled" : current.devAuthority.toBase58();
    console.log(`dev authority: ${dev}${platformOld ? " (after migration)" : ""}; max_bundle_supply_bps ${current.params.maxBundleSupplyBps}`);
  }
  console.log(`launches: ${launches.length}, in the old layout: ${oldLaunches.length}`);

  const settings: { label: string; ix: TransactionInstruction }[] = [];
  if (!current) {
    if (devAuthority || maxBundle !== null) todo("settings", "set the dev key / bundle cap on a re-run once this migration executed (pre-payback layout)");
  } else {
    if (devAuthority && !devAuthority.equals(current.devAuthority)) {
      settings.push({ label: `set_dev_authority(${devAuthority.toBase58()})`, ix: await client.setDevAuthorityIx(platformAdmin, devAuthority) });
    }
    if (maxBundle !== null && maxBundle !== current.params.maxBundleSupplyBps) {
      settings.push({
        label: `update_platform(max_bundle_supply_bps ${current.params.maxBundleSupplyBps} → ${maxBundle}, other params unchanged)`,
        ix: await client.updatePlatformIx(platformAdmin, { ...current.params, maxBundleSupplyBps: maxBundle }),
      });
    }
  }
  if (!platformOld && oldLaunches.length === 0 && settings.length === 0) return done("migrate", "nothing left to migrate or set");

  const pinned = pinnedInitialVaultSol();
  const plan: { launch: PublicKey; initialVaultSol: bigint }[] = [];
  for (const { pubkey, account } of oldLaunches) {
    const old = decodeOldLaunch(account.data);
    const net = old.raised - (old.raised * BigInt(old.launchFeeBps)) / 10_000n;
    let initial = 0n;
    let source = "unlaunched → 0";
    if (old.status === "live" || old.status === "woundDown") {
      if (old.venue === "holdfast") {
        initial = net;
        source = `raise − launch fee (derived on chain)`;
      } else if (pinned.has(pubkey.toBase58())) {
        initial = pinned.get(pubkey.toBase58())!;
        source = "INITIAL_VAULT_SOL";
      } else {
        const found = await initialVaultSolFromHistory(connection, client, pubkey);
        if (found === null) fail(`${pubkey.toBase58()} (${old.symbol}): no Launched event in its history; pass INITIAL_VAULT_SOL=${pubkey.toBase58()}:<bundle_sol + vault_sol at launch>`);
        initial = found;
        source = "Launched event (bundle_sol + vault_sol)";
      }
      if (initial < old.bundleSol || initial > net) {
        fail(`${pubkey.toBase58()} (${old.symbol}): initial_vault_sol ${initial} outside [bundle_sol ${old.bundleSol}, raise − fee ${net}]`);
      }
    }
    console.log(`  ${pubkey.toBase58()} ${old.symbol || "(Holdfast launch)"} ${old.status} ${old.venue}: initial_vault_sol ${initial} ← ${source}`);
    plan.push({ launch: pubkey, initialVaultSol: initial });
  }

  const ixs = [
    ...(platformOld ? [await client.migratePlatformIx(platformAdmin)] : []),
    ...(await Promise.all(plan.map((p) => client.migrateLaunchIx(platformAdmin, p.launch, p.initialVaultSol)))),
    ...settings.map((s) => s.ix),
  ];
  const label = [
    ...(platformOld ? ["migrate_platform"] : []),
    ...(plan.length ? [`migrate_launch × ${plan.length}`] : []),
    ...settings.map((s) => s.label),
  ].join(" + ");

  if (platformAdmin.equals(admin.publicKey)) {
    if (DRY_RUN) return todo("migrate", `send [${label}] as the admin`);
    todo("migrate", `sending [${label}] as the admin`);
    console.log(`   tx ${await send(client, admin, ixs)}`);
    return done("migrate", "all accounts are in the current layout and the settings applied");
  }

  const config = readConfig();
  const multisigAddress = process.env.MULTISIG ?? (config.multisig as string | undefined);
  if (!multisigAddress) fail(`platform admin ${platformAdmin.toBase58()} is not the local admin and no multisig is known (set MULTISIG or run \`pnpm handoff\`)`);
  const multisigPda = new PublicKey(multisigAddress);
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda).catch(() => null);
  if (!ms) fail(`${multisigPda.toBase58()} is not a Squads v4 multisig on this cluster`);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  if (!vault.equals(platformAdmin)) fail(`platform admin is ${platformAdmin.toBase58()}, not the multisig vault ${vault.toBase58()}`);
  console.log(`multisig ${multisigPda.toBase58()} (${ms.threshold}-of-${ms.members.length}), vault ${vault.toBase58()}\n`);

  const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
  await runVaultTransaction(
    { connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint },
    "migrate",
    label,
    ixs,
  );
  if (DRY_RUN) return;
  const after = await connection.getAccountInfo(platform);
  const now = after && after.data.length === PLATFORM_LEN ? decodePlatform(client, after.data) : null;
  const rows: [string, boolean][] = [[`platform layout ${now ? "current" : "still old"}`, !!now]];
  if (devAuthority) rows.push([`dev authority ${now?.devAuthority.toBase58() ?? "?"}`, !!now?.devAuthority.equals(devAuthority)]);
  if (maxBundle !== null) rows.push([`max_bundle_supply_bps ${now?.params.maxBundleSupplyBps ?? "?"}`, now?.params.maxBundleSupplyBps === maxBundle]);
  console.log("");
  for (const [what, ok] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (rows.some(([, ok]) => !ok)) {
    console.log("(proposal not executed yet?)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
