/**
 * BPF upgradeable loader (loader v3) accounts and instructions for the moshsol program, built by hand
 * (web3.js has no builders for them and the CLI would need WSL on Windows).
 */
import {
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PROGRAM_ID } from "@holdfast/sdk";

export const PROGRAM_DATA = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];
/** `UpgradeableLoaderState::Buffer { authority_address: Option<Pubkey> }`: code starts after it. */
export const BUFFER_METADATA_SIZE = 37;
/** `UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }`. */
export const PROGRAM_DATA_METADATA_SIZE = 45;
/** SIMD-0431: `ExtendProgram` must add at least 10 KiB. */
export const MIN_EXTEND_BYTES = 10_240;

const BUFFER = 1;
const PROGRAM_DATA_STATE = 3;

export interface LoaderAccount {
  /** None: immutable program / buffer that can no longer be written. */
  authority: PublicKey | null;
  /** Everything after the metadata: the ELF, zero-padded to the account size. */
  code: Buffer;
  lamports: number;
}

/** `Option<Pubkey>` at `offset` (bincode: 1-byte tag, then the key). */
const optionalKey = (data: Buffer, offset: number) =>
  data[offset] === 1 ? new PublicKey(data.subarray(offset + 1, offset + 33)) : null;

/** The program's ProgramData account; null when the program isn't deployed upgradeable on this cluster. */
export async function fetchProgramData(connection: Connection): Promise<LoaderAccount | null> {
  const info = await connection.getAccountInfo(PROGRAM_DATA);
  if (!info || !info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || info.data.readUInt32LE(0) !== PROGRAM_DATA_STATE) {
    return null;
  }
  return { authority: optionalKey(info.data, 12), code: info.data.subarray(PROGRAM_DATA_METADATA_SIZE), lamports: info.lamports };
}

/** A loader buffer account; null when `address` doesn't exist. Throws when it exists but isn't a buffer. */
export async function fetchBuffer(connection: Connection, address: PublicKey): Promise<LoaderAccount | null> {
  const info = await connection.getAccountInfo(address);
  if (!info) return null;
  if (!info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || info.data.readUInt32LE(0) !== BUFFER) {
    throw new Error(`${address.toBase58()} exists but is not an upgradeable loader buffer`);
  }
  return { authority: optionalKey(info.data, 4), code: info.data.subarray(BUFFER_METADATA_SIZE), lamports: info.lamports };
}

/** `code` holds exactly `elf` followed only by zero padding (ProgramData may be larger than the ELF). */
export function holdsExactly(code: Buffer, elf: Buffer): boolean {
  return code.length >= elf.length && code.subarray(0, elf.length).equals(elf) && code.subarray(elf.length).every((b) => b === 0);
}

function loaderIx(keys: TransactionInstruction["keys"], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, keys, data });
}

function tag(instruction: number, extra = 0): Buffer {
  const data = Buffer.alloc(4 + extra);
  data.writeUInt32LE(instruction, 0);
  return data;
}

/** `InitializeBuffer` (0): the buffer account must already be allocated and owned by the loader. */
export function initializeBufferIx(buffer: PublicKey, authority: PublicKey): TransactionInstruction {
  return loaderIx(
    [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    tag(0),
  );
}

/** `Write` (1) of `bytes` at `offset` into the buffer's code. */
export function writeIx(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Buffer): TransactionInstruction {
  const data = tag(1, 4 + 8 + bytes.length);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  bytes.copy(data, 16);
  return loaderIx(
    [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  );
}

/** `Upgrade` (3): the program's code becomes the buffer's; the buffer closes into `spill`. */
export function upgradeIx(buffer: PublicKey, spill: PublicKey, authority: PublicKey): TransactionInstruction {
  return loaderIx(
    [
      { pubkey: PROGRAM_DATA, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: spill, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    tag(3),
  );
}

/** `SetAuthority` (4) of a buffer or ProgramData account; the new authority does not sign. */
export function setAuthorityIx(account: PublicKey, current: PublicKey, next: PublicKey): TransactionInstruction {
  return loaderIx(
    [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: current, isSigner: true, isWritable: false },
      { pubkey: next, isSigner: false, isWritable: false },
    ],
    tag(4),
  );
}

/** `ExtendProgram` (6): permissionless, `payer` funds the rent of `additionalBytes` more ProgramData. */
export function extendProgramIx(payer: PublicKey, additionalBytes: number): TransactionInstruction {
  const data = tag(6, 4);
  data.writeUInt32LE(additionalBytes, 4);
  return loaderIx(
    [
      { pubkey: PROGRAM_DATA, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
    ],
    data,
  );
}
