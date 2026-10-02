import {
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
  type AddressLookupTableAccount,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
  ammEventAuthorityPda,
  ammGlobalConfigPda,
  ammGlobalVolumeAccumulatorPda,
  feeConfigPda,
  fetchPumpFeeRecipients,
  platformPda,
  prepareTx,
  sendAndConfirm,
  splAta,
  type PriorityFeeBounds,
} from "@holdfast/sdk";
import { log } from "./log";

/** Addresses per `extendLookupTable` (32 bytes each; 20 fit next to the create instruction in one transaction). */
const EXTEND_BATCH = 20;

/**
 * The agent's address lookup table: the accounts every PumpSwap trade (`agent_*_pump` after graduation,
 * `buyback_burn` on a graduated Holdfast token, `wind_down_pump`) carries regardless of the launch —
 * `poolVenueAccounts` minus the pool's own accounts plus the agent instruction's fixed accounts, with every fee
 * recipient pump.fun lists since each instruction picks one at random — so a v0 transaction fits where the legacy
 * one (≈30 keys) does not. Created once per cluster with the agent as authority and remembered in `altFile` under
 * the cluster's genesis hash (a localnet reset gets a fresh table instead of a vanished one); `AGENT_ALT` pins an
 * existing table instead. A table the agent owns is extended with whatever it lacks when it is loaded.
 */
export class LookupTable {
  private account: AddressLookupTableAccount | null = null;
  private pending: Promise<AddressLookupTableAccount> | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly authority: Keypair,
    private readonly fee: PriorityFeeBounds,
    private readonly file: string,
    private readonly pinned: PublicKey | null,
    private readonly programId: PublicKey,
  ) {}

  /** The table's address once known (pinned, remembered or created); null before first use. */
  get address(): PublicKey | null {
    return this.account?.key ?? this.pinned;
  }

  /** The table, created/extended on first use; concurrent callers share one creation. */
  get(): Promise<AddressLookupTableAccount> {
    if (this.account) return Promise.resolve(this.account);
    this.pending ??= this.load().then(
      (account) => {
        this.account = account;
        this.pending = null;
        return account;
      },
      (err: unknown) => {
        this.pending = null;
        throw err;
      },
    );
    return this.pending;
  }

  private async load(): Promise<AddressLookupTableAccount> {
    const genesis = await this.connection.getGenesisHash();
    const remembered = this.pinned ?? this.remembered(genesis);
    if (remembered) {
      const { value } = await this.connection.getAddressLookupTable(remembered, { commitment: "confirmed" });
      if (value) return this.complete(value);
      if (this.pinned) throw new Error(`AGENT_ALT ${remembered.toBase58()} does not exist on this cluster`);
      log("alt_stale", { lookupTable: remembered.toBase58(), file: this.file });
    }
    return this.create(genesis);
  }

  /** `table` with the addresses it lacks appended (pump.fun's recipient lists change); a table another key owns is used as is. */
  private async complete(table: AddressLookupTableAccount): Promise<AddressLookupTableAccount> {
    const have = new Set(table.state.addresses.map((k) => k.toBase58()));
    const missing = (await this.addresses()).filter((k) => !have.has(k.toBase58()));
    if (missing.length === 0) return table;
    if (!table.state.authority?.equals(this.authority.publicKey)) {
      log("alt_incomplete", { lookupTable: table.key.toBase58(), missing: missing.length });
      return table;
    }
    await this.extend(table.key, missing);
    const value = await this.activated(table.key, table.state.addresses.length + missing.length);
    log("alt_extended", { lookupTable: table.key.toBase58(), added: missing.length, addresses: value.state.addresses.length });
    return value;
  }

  private remembered(genesis: string): PublicKey | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      return null;
    }
    const entry = (JSON.parse(raw) as Record<string, unknown>)[genesis];
    return typeof entry === "string" ? new PublicKey(entry) : null;
  }

  private remember(genesis: string, address: PublicKey): void {
    let table: Record<string, unknown> = {};
    try {
      table = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, unknown>;
    } catch {
      // first table on this machine
    }
    table[genesis] = address.toBase58();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(table, null, 2)}\n`);
  }

  private async create(genesis: string): Promise<AddressLookupTableAccount> {
    const authority = this.authority.publicKey;
    const addresses = await this.addresses();
    const recentSlot = await this.connection.getSlot("finalized");
    const [createIx, lookupTable] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot });
    // Up to ~20 addresses fit next to the create instruction; the rest go in further transactions.
    await this.send([createIx, AddressLookupTableProgram.extendLookupTable({ payer: authority, authority, lookupTable, addresses: addresses.slice(0, EXTEND_BATCH) })]);
    await this.extend(lookupTable, addresses.slice(EXTEND_BATCH));
    this.remember(genesis, lookupTable);
    const value = await this.activated(lookupTable, addresses.length);
    log("alt_created", { lookupTable: lookupTable.toBase58(), addresses: addresses.length, file: this.file });
    return value;
  }

  private async extend(lookupTable: PublicKey, addresses: PublicKey[]): Promise<void> {
    const authority = this.authority.publicKey;
    for (let i = 0; i < addresses.length; i += EXTEND_BATCH) {
      await this.send([AddressLookupTableProgram.extendLookupTable({ payer: authority, authority, lookupTable, addresses: addresses.slice(i, i + EXTEND_BATCH) })]);
    }
  }

  /** The table once it holds `count` addresses and they are usable (from the slot after the one that extended it). */
  private async activated(lookupTable: PublicKey, count: number): Promise<AddressLookupTableAccount> {
    for (;;) {
      const { value } = await this.connection.getAddressLookupTable(lookupTable, { commitment: "confirmed" });
      if (value && value.state.addresses.length === count && (await this.connection.getSlot("confirmed")) > value.state.lastExtendedSlot) return value;
      await sleep(400);
    }
  }

  private async send(ixs: TransactionInstruction[]): Promise<string> {
    const prepared = await prepareTx(this.connection, this.authority.publicKey, ixs, this.fee);
    prepared.tx.sign(this.authority);
    return sendAndConfirm(this.connection, prepared.tx.serialize(), prepared.lastValidBlockHeight);
  }

  /**
   * The launch-independent accounts of a PumpSwap trade through this program (`poolVenueAccounts` +
   * `pumpAgentAccounts`), with every fee recipient the venues accept (each instruction picks one at random) and
   * the WSOL accounts of the PumpSwap ones. The invoked programs (compute budget, this program) and the signer stay
   * static keys by protocol rule, so they are not listed.
   */
  private async addresses(): Promise<PublicKey[]> {
    const r = await fetchPumpFeeRecipients(this.connection);
    const all = [
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      platformPda(this.programId),
      WSOL_MINT,
      PUMP_PROGRAM_ID,
      PUMP_AMM_PROGRAM_ID,
      PUMP_FEE_PROGRAM_ID,
      ammGlobalConfigPda(),
      ammEventAuthorityPda(),
      ammGlobalVolumeAccumulatorPda(),
      feeConfigPda(PUMP_AMM_PROGRAM_ID),
      ...[...r.protocolFeeRecipients, ...r.buybackFeeRecipients].flatMap((k) => [k, splAta(k, WSOL_MINT)]),
      ...r.feeRecipients,
    ];
    return [...new Map(all.map((k) => [k.toBase58(), k])).values()];
  }
}
