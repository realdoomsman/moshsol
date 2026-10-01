import type { IdlAccounts, IdlEvents, IdlTypes } from "@coral-xyz/anchor";
import idlJson from "./idl/moshsol.json";
import type { Moshsol } from "./idl/moshsol";

/**
 * The program's Anchor IDL and what is read from it without Anchor: account/event types and program
 * error messages. Kept apart from `client.ts` so error text costs the JSON, not the Anchor runtime.
 */
export const IDL = idlJson as unknown as Moshsol;
export type { Moshsol };

export type LaunchAccount = IdlAccounts<Moshsol>["launch"];
export type PlatformAccount = IdlAccounts<Moshsol>["platform"];
export type BackerAccount = IdlAccounts<Moshsol>["backer"];
export type PlatformParams = IdlTypes<Moshsol>["platformParams"];
export type CreateLaunchArgs = IdlTypes<Moshsol>["createLaunchArgs"];
export type CreateLaunchPumpArgs = IdlTypes<Moshsol>["createLaunchPumpArgs"];
/** On-chain `LaunchTerms`: u16/u32 as numbers, `minVaultSol` (u64) as BN. */
export type LaunchTermsAccount = IdlTypes<Moshsol>["launchTerms"];
export type MoshEvents = IdlEvents<Moshsol>;
export type MoshEventName = keyof MoshEvents;
export type MoshEvent = { [K in MoshEventName]: { name: K; data: MoshEvents[K] } }[MoshEventName];

/**
 * `describeError` text of `SameSlotTrade`: a public trade and a vault-agent trade collided in one slot
 * (anti-sandwich rule). Transient — the same transaction succeeds a slot later.
 * (The JSON IDL spells error names in PascalCase, its generated type in camelCase.)
 */
export const SAME_SLOT_TRADE_MESSAGE = IDL.errors.find((e) => e.name.toLowerCase() === "sameslottrade")!.msg;

/** Human-readable message for program errors thrown by Anchor/web3 during send/simulate. */
export function describeError(err: unknown): string {
  const anyErr = err as { error?: { errorMessage?: string }; logs?: string[]; message?: string };
  if (anyErr?.error?.errorMessage) return anyErr.error.errorMessage;
  const logs: string[] = anyErr?.logs ?? [];
  const msg = String(anyErr?.message ?? err);
  const all = [msg, ...logs].join("\n");
  const m = all.match(/Error Message: ([^.\n]+)/);
  if (m) return m[1]!;
  // Log form ("custom program error: 0x1783") or TransactionError JSON ({"Custom":6019}).
  const hex = all.match(/custom program error: 0x([0-9a-f]+)/i);
  const dec = all.match(/"Custom":\s*(\d+)/);
  const n = hex ? parseInt(hex[1]!, 16) : dec ? Number(dec[1]) : null;
  if (n !== null) {
    const e = IDL.errors.find((x) => x.code === n);
    if (e) return e.msg;
  }
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet";
  if (/insufficient (funds|lamports)|AccountNotFound|InsufficientFundsForFee/i.test(all)) {
    return "Insufficient SOL balance";
  }
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}
