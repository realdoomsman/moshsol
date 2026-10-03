/**
 * Upgrades the moshsol program through the Squads v4 multisig whose vault (index 0) holds the upgrade
 * authority after `pnpm handoff`. Idempotent: every step reads chain state first and is skipped when
 * already done, so re-run it after an interruption or an approval round.
 *
 *   RPC_URL=<rpc> KEYS_DIR=.mainnet APPROVER_KEYPAIRS=.mainnet/member-1.json,.mainnet/member-2.json pnpm upgrade --dry-run
 *
 * Env: RPC_URL, KEYS_DIR (admin.json pays every fee and rent; config.json names the multisig),
 *      PROGRAM_SO (default target/deploy/moshsol.so), MULTISIG (optional: overrides config.json's
 *      `multisig`), PROPOSER_KEYPAIR / APPROVER_KEYPAIRS (member keypair files relative to the repo
 *      root, as in `handoff`: create, approve and execute the step-4 proposal in the same run).
 * `--dry-run` prints the plan and the current PASS/FAIL table without writing or sending anything.
 *
 * Refuses to start unless the .so embeds the program id (`declare_id!`) and the program's upgrade
 * authority is the multisig vault. When the program already runs exactly this .so, steps 1–4 are skipped.
 *   1. Buffer at $KEYS_DIR/upgrade-buffer-<sha256 prefix>.json (keyed by the build, so a new build gets
 *      a new buffer): created with the admin as authority (its rent returns to the admin when the
 *      upgrade closes it), then written in transaction-sized chunks — only chunks that differ from the
 *      buffer on chain, so an interrupted upload resumes. Its content must equal the .so afterwards.
 *   2. Buffer authority → vault (`SetAuthority`): the upgrade requires both to be the same key.
 *   3. `ExtendProgram` (permissionless, admin pays the rent) when the .so outgrows the ProgramData
 *      account; at least 10 KiB (SIMD-0431).
 *   4. One vault transaction [Upgrade(programdata, program, buffer, spill = admin, rent, clock, vault)]
 *      plus a proposal, approved by APPROVER_KEYPAIRS and executed by the first of them; without keys
 *      members approve and execute it in the Squads app.
 *   5. Verification: dumps the ProgramData code and compares its sha256 with the local .so. Exits 1
 *      while anything is FAIL (e.g. proposal not executed yet).
 */
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PROGRAM_ID } from "@holdfast/sdk";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LOCALNET_DIR, ROOT, RPC_URL, clientFor, send } from "./common";
import {
  BUFFER_METADATA_SIZE,
  MIN_EXTEND_BYTES,
  PROGRAM_DATA,
  PROGRAM_DATA_METADATA_SIZE,
  extendProgramIx,
  fetchBuffer,
  fetchProgramData,
  holdsExactly,
  initializeBufferIx,
  setAuthorityIx,
  upgradeIx,
  writeIx,
} from "./loader";
import { DRY_RUN, done, fail, readConfig, readKeypair, readVaultSigners, runVaultTransaction, squadsUrl, todo } from "./squads";

const PROGRAM_SO = path.resolve(ROOT, process.env.PROGRAM_SO ?? "target/deploy/moshsol.so");
/** Solana's packet size: the most a serialized transaction may take. */
const PACKET_DATA_SIZE = 1232;
/** Buffer writes in flight at once (each is ~4 RPC calls; more trips free-tier RPC rate limits). `WRITE_CONCURRENCY` overrides. */
const WRITE_CONCURRENCY = Math.max(1, Number(process.env.WRITE_CONCURRENCY ?? 2));

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const sol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`;

/** Largest chunk one `Write` transaction (admin pays and signs, compute limit + price) can carry. */
function writeChunkSize(admin: PublicKey, buffer: PublicKey): number {
  const probe = new Transaction({ feePayer: admin, recentBlockhash: PublicKey.default.toBase58() }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    writeIx(buffer, admin, 0, Buffer.alloc(0)),
  );
  // One signature (compact length + 64 bytes) + the message; the data length prefix grows by a byte past 127.
  return PACKET_DATA_SIZE - (1 + 64 + probe.serializeMessage().length) - 1;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = readKeypair(path.join(LOCALNET_DIR, "admin.json"));
  const client = clientFor(connection, admin);

  if (!fs.existsSync(PROGRAM_SO)) fail(`missing ${PROGRAM_SO} (build it with \`anchor build\`)`);
  const elf = fs.readFileSync(PROGRAM_SO);
  const hash = sha256(elf);
  if (!elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) fail(`${PROGRAM_SO} is not an ELF file`);
  // declare_id! compiles the program id into the binary as its 32 raw bytes.
  if (elf.indexOf(PROGRAM_ID.toBuffer()) < 0) {
    fail(`${PROGRAM_SO} does not declare program ${PROGRAM_ID.toBase58()} (built for another program id?)`);
  }

  // RPC URLs can carry API keys (Helius): only show the host.
  console.log(`${DRY_RUN ? "DRY RUN — nothing is sent or written\n" : ""}rpc ${new URL(RPC_URL).host}`);
  console.log(`program ${PROGRAM_ID.toBase58()}, admin ${admin.publicKey.toBase58()} (${sol(await connection.getBalance(admin.publicKey))})`);
  console.log(`local build ${PROGRAM_SO}: ${elf.length} bytes, sha256 ${hash}`);

  const config = readConfig();
  const multisigAddress = process.env.MULTISIG ?? (config.multisig as string | undefined);
  if (!multisigAddress) fail(`no multisig: set MULTISIG or run \`pnpm handoff\` (records it in ${LOCALNET_DIR}/config.json)`);
  const multisigPda = new PublicKey(multisigAddress);
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda).catch(() => null);
  if (!ms) fail(`${multisigPda.toBase58()} is not a Squads v4 multisig on this cluster`);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  if (config.multisigVault && config.multisigVault !== vault.toBase58()) {
    fail(`config.json records vault ${config.multisigVault as string}, but multisig ${multisigPda.toBase58()} has vault ${vault.toBase58()}`);
  }
  console.log(`multisig ${multisigPda.toBase58()} (${ms.threshold}-of-${ms.members.length}), vault ${vault.toBase58()}\n`);

  const programData = await fetchProgramData(connection);
  if (!programData) fail(`program ${PROGRAM_ID.toBase58()} has no ProgramData account on this cluster`);
  if (!programData.authority) fail(`program ${PROGRAM_ID.toBase58()} is immutable (no upgrade authority)`);
  if (!programData.authority.equals(vault)) {
    fail(`upgrade authority is ${programData.authority.toBase58()}, not the multisig vault ${vault.toBase58()} (run \`pnpm handoff\` first)`);
  }

  const bufferFile = path.join(LOCALNET_DIR, `upgrade-buffer-${hash.slice(0, 16)}.json`);
  const buffer = fs.existsSync(bufferFile) ? readKeypair(bufferFile) : Keypair.generate();

  if (holdsExactly(programData.code, elf)) {
    done("1-4 upgrade", "the program already runs this build");
  } else {
    // ---- 1. buffer ----
    if (!DRY_RUN && !fs.existsSync(bufferFile)) fs.writeFileSync(bufferFile, JSON.stringify(Array.from(buffer.secretKey))); // before any rent goes in
    const bufferLabel = `${buffer.publicKey.toBase58()} (${path.basename(bufferFile)})`;
    let onChain = await fetchBuffer(connection, buffer.publicKey);
    const bufferRent = await connection.getMinimumBalanceForRentExemption(BUFFER_METADATA_SIZE + elf.length);
    if (!onChain) {
      if (DRY_RUN) {
        todo("1 buffer", `create buffer ${buffer.publicKey.toBase58()} (${sol(bufferRent)} rent, returned to the admin by the upgrade)`);
      } else {
        todo("1 buffer", `creating ${bufferLabel}, rent ${sol(bufferRent)}`);
        const create = SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: buffer.publicKey,
          lamports: bufferRent,
          space: BUFFER_METADATA_SIZE + elf.length,
          programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        });
        console.log(`   tx ${await send(client, admin, [create, initializeBufferIx(buffer.publicKey, admin.publicKey)], [buffer])}`);
        onChain = await fetchBuffer(connection, buffer.publicKey);
      }
    } else if (onChain.code.length !== elf.length) {
      fail(`buffer ${bufferLabel} holds ${onChain.code.length} bytes, the build ${elf.length}`);
    }

    const chunkSize = writeChunkSize(admin.publicKey, buffer.publicKey);
    const chunkCount = Math.ceil(elf.length / chunkSize);
    const pendingOffsets: number[] = [];
    for (let offset = 0; offset < elf.length; offset += chunkSize) {
      const chunk = elf.subarray(offset, offset + chunkSize);
      if (!onChain?.code.subarray(offset, offset + chunk.length).equals(chunk)) pendingOffsets.push(offset);
    }
    if (pendingOffsets.length === 0) {
      done("1 buffer", `${bufferLabel} holds the build`);
    } else if (onChain && !onChain.authority?.equals(admin.publicKey)) {
      fail(`buffer ${bufferLabel} differs from the build but its authority is ${onChain.authority?.toBase58() ?? "none"}, not the admin`);
    } else if (DRY_RUN || !onChain) {
      todo("1 buffer", `write ${pendingOffsets.length} of ${chunkCount} chunks (${chunkSize} bytes each)`);
    } else {
      todo("1 buffer", `writing ${pendingOffsets.length} of ${chunkCount} chunks (${chunkSize} bytes each, ${WRITE_CONCURRENCY} in flight)`);
      let written = 0;
      const queue = [...pendingOffsets];
      await Promise.all(
        Array.from({ length: WRITE_CONCURRENCY }, async () => {
          for (let offset = queue.shift(); offset !== undefined; offset = queue.shift()) {
            await send(client, admin, [writeIx(buffer.publicKey, admin.publicKey, offset, elf.subarray(offset, offset + chunkSize))]);
            written++;
            if (written % 50 === 0 || written === pendingOffsets.length) console.log(`   ${written}/${pendingOffsets.length} chunks`);
          }
        }),
      );
      onChain = await fetchBuffer(connection, buffer.publicKey);
      if (!onChain || !onChain.code.equals(elf)) fail(`buffer ${bufferLabel} still differs from the build after writing; re-run`);
      done("1 buffer", `${bufferLabel} holds the build`);
    }

    // ---- 2. buffer authority ----
    if (onChain?.authority?.equals(vault)) {
      done("2 buffer authority", "already the vault");
    } else if (DRY_RUN || !onChain) {
      todo("2 buffer authority", `SetAuthority ${buffer.publicKey.toBase58()}: admin → vault ${vault.toBase58()}`);
    } else {
      todo("2 buffer authority", `SetAuthority → vault ${vault.toBase58()}`);
      console.log(`   tx ${await send(client, admin, [setAuthorityIx(buffer.publicKey, admin.publicKey, vault)])}`);
    }

    // ---- 3. extend ProgramData ----
    const missing = elf.length - programData.code.length;
    if (missing <= 0) {
      done("3 extend", `ProgramData fits the build (${programData.code.length} ≥ ${elf.length} bytes)`);
    } else {
      const additional = Math.max(missing, MIN_EXTEND_BYTES);
      const size = PROGRAM_DATA_METADATA_SIZE + programData.code.length + additional;
      const rent = Math.max(0, (await connection.getMinimumBalanceForRentExemption(size)) - programData.lamports);
      if (DRY_RUN) {
        todo("3 extend", `ExtendProgram ${PROGRAM_DATA.toBase58()} by ${additional} bytes (admin pays ${sol(rent)} rent, kept by the program)`);
      } else {
        todo("3 extend", `ExtendProgram by ${additional} bytes, rent ${sol(rent)}`);
        console.log(`   tx ${await send(client, admin, [extendProgramIx(admin.publicKey, additional)])}`);
      }
    }

    // ---- 4. vault transaction [Upgrade] ----
    const hint = (await squadsUrl(connection, multisigPda)) ?? multisigPda.toBase58();
    await runVaultTransaction(
      { connection, client, admin, multisigPda, ms, vault, signers: readVaultSigners(ms), squadsHint: hint },
      "4 upgrade",
      `Upgrade(buffer ${buffer.publicKey.toBase58()}, spill ${admin.publicKey.toBase58()})`,
      [upgradeIx(buffer.publicKey, admin.publicKey, vault)],
    );
  }

  // ---- 5. verification ----
  const now = (await fetchProgramData(connection))!;
  const deployed = now.code.subarray(0, elf.length);
  const upgraded = holdsExactly(now.code, elf);
  // The dump is the ProgramData code: the ELF plus zero padding up to the account size.
  const note = upgraded
    ? ""
    : deployed.equals(elf)
      ? " (followed by non-zero bytes)"
      : ` (first ${deployed.length} of ${now.code.length} ProgramData code bytes: another build)`;
  const rows: [string, string, boolean][] = [
    ["upgrade authority", now.authority?.toBase58() ?? "none (immutable)", !!now.authority?.equals(vault)],
    ["on-chain sha256", `${sha256(deployed)}${note}`, upgraded],
  ];
  console.log(`\n5 verification (expected: vault ${vault.toBase58()}, sha256 ${hash})`);
  for (const [label, value, ok] of rows) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(20)} ${value}`);
  if (rows.some(([, , ok]) => !ok)) process.exit(1);
  // The upgrade closed the buffer into the admin: its key has nothing left to control.
  if (!DRY_RUN && fs.existsSync(bufferFile) && !(await connection.getAccountInfo(buffer.publicKey))) fs.rmSync(bufferFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
