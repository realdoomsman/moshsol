"use client";

import type { Adapter } from "@solana/wallet-adapter-base";
import { UnsafeBurnerWalletAdapter, UnsafeBurnerWalletName } from "@solana/wallet-adapter-unsafe-burner";
import { Keypair } from "@solana/web3.js";

export const BURNER_WALLET_NAME = UnsafeBurnerWalletName;

export const BURNER_STORAGE_KEY = "holdfast:burner-secret";
/** Pre-rebrand key; read once when the new key is missing, then copied forward. */
const LEGACY_BURNER_STORAGE_KEY = "moshsol:burner-secret";

function parseSecret(raw: string | null): Keypair | null {
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    return null;
  }
}

/**
 * The test wallet's keypair, kept in this browser's localStorage. Migrates a keypair stored under
 * the pre-rebrand key so existing test sessions keep their address (and devnet SOL).
 */
export function loadBurnerKeypair(storage: Storage): Keypair {
  const current = parseSecret(storage.getItem(BURNER_STORAGE_KEY));
  if (current) return current;
  const keypair = parseSecret(storage.getItem(LEGACY_BURNER_STORAGE_KEY)) ?? Keypair.generate();
  storage.setItem(BURNER_STORAGE_KEY, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

/**
 * The stock burner forgets its keypair on every reload, which makes a test session useless.
 * This keeps the same keypair in localStorage (test clusters only — see `IS_TEST_CLUSTER`).
 */
class PersistentBurnerWalletAdapter extends UnsafeBurnerWalletAdapter {
  override async connect(): Promise<void> {
    const keypair = loadBurnerKeypair(window.localStorage);
    // The base class keeps its signer in a TS-private field; set it so signTransaction/signMessage work.
    (this as unknown as { _keypair: Keypair | null })._keypair = keypair;
    this.emit("connect", keypair.publicKey);
  }
}

/**
 * The burner adapter warns in its constructor that it is unsafe. That is the point of a test wallet,
 * and it is only ever created on devnet/localnet (`IS_TEST_CLUSTER`), so the warning is muted.
 */
export function createBurner(): Adapter {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return new PersistentBurnerWalletAdapter();
  } finally {
    console.warn = warn;
  }
}
