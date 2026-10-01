import { describeError, MoshClient } from "@holdfast/sdk";
import type { Connection } from "@solana/web3.js";

/**
 * Everything that needs Anchor or the program IDL: the program client and program-error messages.
 * Pages load it on demand (`import("@/lib/program")` from `useLoadMoshClient`, `useTx`, error paths)
 * so the IDL and Anchor stay out of every route's entry JavaScript.
 */

export { confirmSignature, DEFAULT_PRIORITY_FEE, prepareTx, sendAndConfirm } from "@holdfast/sdk";

/** One read-only client per connection: building one compiles the IDL coders (~20ms each at 4× CPU), and many panels ask. */
const clients = new WeakMap<Connection, MoshClient>();

/** Read-only program client (instruction builders need no wallet), shared by every caller on the same connection. */
export function moshClient(connection: Connection): MoshClient {
  let client = clients.get(connection);
  if (!client) {
    client = new MoshClient(connection);
    clients.set(connection, client);
  }
  return client;
}

/** Collects program logs from web3 / wallet-adapter / simulation errors and maps them to a program error message. */
export function humanError(err: unknown): string {
  const e = err as { message?: string; logs?: string[]; error?: { logs?: string[]; message?: string } };
  const logs = e?.logs ?? e?.error?.logs ?? [];
  // Wallet-adapter errors wrap the wallet's own error and copy its message: keep one ("User rejected the request.", not twice).
  const message = [...new Set([e?.message, e?.error?.message].filter(Boolean))].join("\n") || String(err);
  if (/AccountNotFound|InsufficientFundsForFee/.test(message)) return "Not enough SOL to pay network fees";
  return describeError({ message, logs });
}
