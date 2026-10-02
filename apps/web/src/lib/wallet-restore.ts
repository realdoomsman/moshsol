"use client";

import { WalletConnectionError, type Adapter } from "@solana/wallet-adapter-base";

/** How long the wallet remembered from the last visit gets to reconnect on page load before the header shows "Connect". */
export const RESTORE_TIMEOUT_MS = 3_000;

/** wallet-adapter-react's `localStorageKey` (its default): the selected wallet's name, JSON-encoded. */
const WALLET_NAME_KEY = "walletName";

/** The wallet name wallet-adapter-react remembers in this browser, if any. */
export function rememberedWallet(): string | null {
  try {
    const raw = window.localStorage.getItem(WALLET_NAME_KEY);
    const name: unknown = raw ? JSON.parse(raw) : null;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** Page-load reconnects still pending in each wallet, however late (React may run the provider's effect twice). */
const inFlight = new WeakMap<Adapter, number>();

/** True while `adapter` is still answering a `restoreWallet` call; errors it reports meanwhile aren't the user's doing. */
export function restoreInFlight(adapter: Adapter): boolean {
  return (inFlight.get(adapter) ?? 0) > 0;
}

/**
 * Page-load reconnect of the remembered wallet (`adapter.autoConnect()`: silent, never a popup), bounded by
 * `timeoutMs`. A locked Phantom or Backpack never answers a silent connect and wallet-adapter-react keeps `connecting`
 * set until it does, so unbounded the header would spin on "Connecting" for good. Rejects on timeout (the provider then
 * forgets the selection). If the wallet connects later anyway (unlocked after all) while no longer selected, that
 * connection is handed back, so a later pick starts from a clean adapter instead of one that is connected unseen.
 */
export async function restoreWallet(adapter: Adapter, timeoutMs = RESTORE_TIMEOUT_MS): Promise<void> {
  inFlight.set(adapter, (inFlight.get(adapter) ?? 0) + 1);
  const attempt = adapter.autoConnect().finally(() => inFlight.set(adapter, (inFlight.get(adapter) ?? 1) - 1));
  let timer: number | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new WalletConnectionError(`${adapter.name} did not reconnect within ${timeoutMs / 1000}s`)), timeoutMs);
  });
  try {
    await Promise.race([attempt, expired]);
  } catch (err) {
    attempt.then(
      () => {
        if (adapter.connected && rememberedWallet() !== adapter.name) void adapter.disconnect();
      },
      () => undefined,
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
