import { IDL, WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "@holdfast/sdk";

/**
 * The program's instruction surface, generated from the SDK's IDL (§4.2 §6): every instruction the
 * deployed program exposes, who can sign it and what it can move. Descriptions are keyed by
 * instruction name; an instruction without one still lists, with its signer and writable accounts
 * straight from the IDL.
 */

export interface InstructionRow {
  name: string;
  group: InstructionGroup;
  caller: string;
  moves: string;
  description: string;
  args: { name: string; type: string }[];
  accounts: { name: string; signer: boolean; writable: boolean }[];
}

export type InstructionGroup = "Launch lifecycle" | "Trading" | "Vault agent" | "Fees" | "Platform admin" | "Other";

const GROUPS: InstructionGroup[] = ["Launch lifecycle", "Trading", "Vault agent", "Fees", "Platform admin", "Other"];

/** When `wind_down` becomes callable, from the program's constants (read by the FAQ and docs too). */
export const WIND_DOWN_RULE = `at least ${WIND_DOWN_MIN_AGE_SECS / 86_400} days old, no trade for ${WIND_DOWN_IDLE_SECS / 3_600} hours, and no tokens held outside the curve and vault`;

const KNOWN: Record<string, { group: InstructionGroup; caller: string; moves: string; description: string }> = {
  create_launch: {
    group: "Launch lifecycle",
    caller: "Anyone",
    moves: "Create fee → fee recipient; mints 1B tokens to the curve",
    description:
      "Creates the launch, mints the fixed 1,000,000,000 supply to the curve, revokes the mint authority in the same instruction, and freezes the fee split and agent limits into the launch.",
  },
  deposit: {
    group: "Launch lifecycle",
    caller: "Anyone",
    moves: "Your SOL → the launch (raise)",
    description: "Joins the raise as a backer. Deposits are clipped to the room left under the max raise and the per-wallet cap.",
  },
  cancel_launch: {
    group: "Launch lifecycle",
    caller: "Creator",
    moves: "Nothing — opens full refunds",
    description: "The creator can abort a raise before it launches. Every backer can then refund 100%.",
  },
  refund: {
    group: "Launch lifecycle",
    caller: "Backer",
    moves: "Your deposit → you",
    description: "Returns the full deposit when the raise missed its minimum by the deadline or was cancelled.",
  },
  launch: {
    group: "Launch lifecycle",
    caller: "Creator, or anyone once ready",
    moves: "Raise → bundle buy → vault; launch fee",
    description:
      "Opens trading. The bundle buy runs first, before any public trade can exist; the tokens and the SOL reserve go into the vault.",
  },
  wind_down: {
    group: "Launch lifecycle",
    caller: "Anyone, once eligible",
    moves: "Vault tokens → curve; curve + vault SOL → backers",
    description:
      `Ends a live launch that is ${WIND_DOWN_RULE}. Returns the vault's tokens to the curve, credits the curve's and vault's SOL to backers pro-rata (claim_backer_fees) and stops trading for good.`,
  },
  buy: {
    group: "Trading",
    caller: "Anyone",
    moves: "Your SOL → curve; tokens → you; trade fee",
    description: "Buys on the constant-product curve. The trade fee is split between backers, the creator and the platform.",
  },
  sell: {
    group: "Trading",
    caller: "Anyone",
    moves: "Your tokens → curve; SOL → you; trade fee",
    description: "Sells back into the Holdfast curve (legacy launches only; pump.fun launches trade on pump.fun). The curve's liquidity never migrates, so it is always there to sell into.",
  },
  agent_buy: {
    group: "Vault agent",
    caller: "Agent authority",
    moves: "Vault SOL → curve; tokens → vault",
    description:
      "Only on dips at least the band under the EMA, at or below the vault's average cost (or a buy-back below the average sell), within the window budget and impact limit.",
  },
  agent_sell: {
    group: "Vault agent",
    caller: "Agent authority",
    moves: "Vault tokens → curve; cost → vault; profit → backers",
    description:
      "Only into rallies at least the band over the EMA, at a fill of at least the vault's average cost plus the band, within the window budget and impact limit. The realized profit over average cost goes 100% to backers.",
  },
  claim_backer_fees: {
    group: "Fees",
    caller: "Backer",
    moves: "Your accrued fees and profit share → you",
    description: "Pays the backer's pro-rata share of trade fees, vault-agent profit and any wind-down payout accrued so far. Claim any time.",
  },
  claim_creator_fees: {
    group: "Fees",
    caller: "Creator",
    moves: "Creator fees → creator",
    description: "Pays the creator's share of trade fees on their launch.",
  },
  sweep_platform_fees: {
    group: "Fees",
    caller: "Anyone",
    moves: "Platform fees → the fixed fee recipient",
    description: "Permissionless: it can only ever pay the platform's configured fee recipient.",
  },
  admin_withdraw_vault: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Vault SOL and tokens → fee recipient",
    description:
      "Withdraws any amount of a launch's vault SOL and tokens to the platform fee recipient. It can't touch the curve's liquidity. Every withdrawal emits VaultWithdrawn and is shown on the launch page.",
  },
  initialize_platform: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Nothing — creates the platform config",
    description: "One-time setup by the program's upgrade authority: fee recipient, agent authority and default params.",
  },
  update_platform: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Nothing — params for future launches",
    description: "Changes defaults for launches created afterwards. Existing launches keep the terms frozen at their creation.",
  },
  set_fee_recipient: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Nothing — where platform fees and vault withdrawals go",
    description: "Points platform fee sweeps and vault withdrawals at a new recipient.",
  },
  set_agent_authority: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Nothing — which key may call the agent instructions",
    description: "Rotates the vault agent's key. Whoever holds it can still only call agent_buy and agent_sell.",
  },
  propose_admin: {
    group: "Platform admin",
    caller: "Admin",
    moves: "Nothing",
    description: "Starts a two-step admin handover.",
  },
  accept_admin: {
    group: "Platform admin",
    caller: "Proposed admin",
    moves: "Nothing",
    description: "Completes the handover; the new key must sign.",
  },
};

const ORDER = Object.keys(KNOWN);

type IdlType = string | { option?: IdlType; vec?: IdlType; array?: [IdlType, number]; defined?: { name: string } };

function typeName(t: IdlType): string {
  if (typeof t === "string") return t;
  if (t.option) return `Option<${typeName(t.option)}>`;
  if (t.vec) return `Vec<${typeName(t.vec)}>`;
  if (t.array) return `[${typeName(t.array[0])}; ${t.array[1]}]`;
  if (t.defined) return t.defined.name;
  return "unknown";
}

export function instructionRows(): InstructionRow[] {
  const rows = (IDL.instructions as unknown as {
    name: string;
    args: { name: string; type: IdlType }[];
    accounts: { name: string; signer?: boolean; writable?: boolean }[];
  }[]).map((ix): InstructionRow => {
    const known = KNOWN[ix.name];
    const accounts = ix.accounts.map((a) => ({ name: a.name, signer: !!a.signer, writable: !!a.writable }));
    const signer = accounts.find((a) => a.signer)?.name;
    return {
      name: ix.name,
      group: known?.group ?? "Other",
      caller: known?.caller ?? (signer ? signer.replace(/_/g, " ") : "Anyone"),
      moves: known?.moves ?? `Writes ${accounts.filter((a) => a.writable).map((a) => a.name).join(", ") || "nothing"}`,
      description: known?.description ?? `Signed by ${signer ?? "anyone"}.`,
      args: ix.args.map((a) => ({ name: a.name, type: typeName(a.type) })),
      accounts,
    };
  });
  const rank = (r: InstructionRow) => {
    const i = ORDER.indexOf(r.name);
    return GROUPS.indexOf(r.group) * 1000 + (i < 0 ? 999 : i);
  };
  return rows.sort((a, b) => rank(a) - rank(b));
}
