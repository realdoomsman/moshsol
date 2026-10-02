import { IDL, WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "@holdfast/sdk";
import { DEFAULT_PUMP_SPLIT, fmtInterval, fmtMult, type PumpSplit } from "@/lib/pump-terms";

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

/** When a launch counts as dead (`wind_down_pump` / `wind_down` callable), from the program's constants and the launch terms. */
export const windDownRule = (s: PumpSplit = DEFAULT_PUMP_SPLIT) =>
  `at least ${WIND_DOWN_MIN_AGE_SECS / 86_400} days old, no vault trade for ${WIND_DOWN_IDLE_SECS / 3_600} hours, and wallets outside the vault and the venue hold ${s.deadHoldersPct}% of the supply or less`;

type Known = { group: InstructionGroup; caller: string; moves: string; description: string };

function known(s: PumpSplit): Record<string, Known> {
  const deadRule = windDownRule(s);
  return {
    create_launch_pump: {
      group: "Launch lifecycle",
      caller: "Creator",
      moves: "Create fee → fee recipient; opens the raise",
      description:
        "Opens the raise for a token that launch_pump will create on pump.fun, pays the flat create fee, and freezes the creator-fee split, payback rule, agent limits and launch fee into the launch account.",
    },
    create_launch: {
      group: "Launch lifecycle",
      caller: "Creator",
      moves: "Create fee → fee recipient; mints 1B tokens to the curve",
      description:
        "Legacy Holdfast-curve launches: mints the fixed 1,000,000,000 supply to the curve, revokes the mint authority in the same instruction, and freezes the fee split and agent limits into the launch.",
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
      description:
        "Returns the full deposit when the raise missed its minimum by the deadline, was cancelled, or met it but wasn't launched within 3 days of the deadline.",
    },
    launch_pump: {
      group: "Launch lifecycle",
      caller: "Creator once the minimum is met; anyone once the deadline passed or the raise is full",
      moves: `Raise → ${s.launchFeePct}% launch fee; create rent; bundle buy on pump.fun + SOL reserve → vault`,
      description:
        "Creates the token on pump.fun and makes the bundle buy in the same instruction, before any public trade can exist. The tokens and the SOL reserve go into the vault; bundle + reserve is recorded as what went in at launch, the base of the payback rule.",
    },
    launch: {
      group: "Launch lifecycle",
      caller: "Anyone, once the raise is ready",
      moves: "Raise → bundle buy → vault; launch fee",
      description:
        "Legacy Holdfast-curve launches: opens trading. The bundle buy runs first, before any public trade can exist; the tokens and the SOL reserve go into the vault.",
    },
    graduate_pump: {
      group: "Launch lifecycle",
      caller: "Anyone",
      moves: "Nothing — records the PumpSwap pool",
      description: "Once the pump.fun curve completes, records the PumpSwap pool on the launch so the vault agent trades there from then on.",
    },
    wind_down_pump: {
      group: "Launch lifecycle",
      caller: "Anyone, once eligible",
      moves: "Vault tokens → sold on pump.fun; all vault SOL → backers",
      description: `Ends a dead launch (${deadRule}). The vault sells what it holds and all of its SOL is credited to backers pro-rata (claim_backer_fees). That can be less than what they put in.`,
    },
    wind_down: {
      group: "Launch lifecycle",
      caller: "Anyone, once eligible",
      moves: "Vault tokens → curve; curve + vault SOL → backers",
      description: `Legacy Holdfast-curve launches: ends a launch that is ${deadRule}. Returns the vault's tokens to the curve, credits the curve's and vault's SOL to backers pro-rata (claim_backer_fees) and stops trading for good.`,
    },
    buy: {
      group: "Trading",
      caller: "Anyone",
      moves: "Your SOL → curve; tokens → you; trade fee",
      description:
        "Buys on the Holdfast constant-product curve (legacy launches only; pump.fun launches trade on pump.fun). The trade fee is split between backers, the creator and the platform.",
    },
    sell: {
      group: "Trading",
      caller: "Anyone",
      moves: "Your tokens → curve; SOL → you; trade fee",
      description:
        "Sells back into the Holdfast curve (legacy launches only; pump.fun launches trade on pump.fun). The curve's liquidity never migrates, so it is always there to sell into.",
    },
    agent_buy_pump: {
      group: "Vault agent",
      caller: "Agent authority + an agent wallet",
      moves: "Vault SOL → agent wallet → pump.fun; tokens → vault",
      description: `Buys back dips on pump.fun with the vault's SOL: only at least the band under the EMA, at or below the vault's average cost (or a buy-back below the average sell), within the window budget and impact limit, and never below the vault's ${s.minVaultSol} SOL floor. One of the platform's agent wallets executes it and must end the instruction with exactly what it started with.`,
    },
    agent_sell_pump: {
      group: "Vault agent",
      caller: "Agent authority + an agent wallet",
      moves: "Vault tokens → agent wallet → pump.fun; all SOL → vault",
      description:
        "Sells slowly into strength on pump.fun: only at least the band over the EMA, at a fill of at least the vault's average cost plus the band, within the window budget and impact limit. Every lamport it receives stays in the vault as liquid SOL; the agent wallet that executes it must end the instruction with exactly what it started with.",
    },
    agent_buy: {
      group: "Vault agent",
      caller: "Agent authority",
      moves: "Vault SOL → curve; tokens → vault",
      description:
        "Legacy Holdfast-curve launches: only on dips at least the band under the EMA, at or below the vault's average cost (or a buy-back below the average sell), within the window budget and impact limit.",
    },
    agent_sell: {
      group: "Vault agent",
      caller: "Agent authority",
      moves: "Vault tokens → curve; all SOL → vault",
      description:
        "Legacy Holdfast-curve launches: only into rallies at least the band over the EMA, at a fill of at least the vault's average cost plus the band, within the window budget and impact limit. The proceeds stay in the vault.",
    },
    payout_backers: {
      group: "Vault agent",
      caller: "Agent authority",
      moves: "Vault SOL → backers' claimable balance",
      description: `Pays backers back when the vault's liquid SOL is at least ${fmtMult(s.payoutMult)} what went in at launch: their principal first, then ${s.payoutSharePct}% of the vault per payout, at most one payout every ${fmtInterval(s.payoutIntervalHours)} (the principal payout starts the clock too), never below the ${s.minVaultSol} SOL floor. The agent only calls it when the chart is strong; buying back dips comes first.`,
    },
    collect_pump_fees: {
      group: "Fees",
      caller: "Anyone",
      moves: `pump.fun creator fees → ${s.vaultPct}% vault, ${s.burnPct}% buyback pool, ${s.backerPct}% backers`,
      description: `Sweeps the creator fees pump.fun has paid the launch: ${s.vaultPct}% becomes vault SOL (agent capital), ${s.burnPct}% goes to the Holdfast buyback-and-burn pool and ${s.backerPct}% is credited to backers pro-rata. The creator gets 0%.`,
    },
    buyback_burn: {
      group: "Fees",
      caller: "Agent authority",
      moves: "Buyback pool SOL → Holdfast token, burned",
      description:
        "Spends the launch's buyback pool on the Holdfast token (on its pump.fun curve, or its PumpSwap pool after graduation) and burns what it bought, rate-limited and capped per call on-chain.",
    },
    claim_backer_fees: {
      group: "Fees",
      caller: "Backer",
      moves: "Your claimable SOL → you",
      description: `Pays the backer's pro-rata share of everything credited so far: ${s.backerPct}% of creator fees, payback from payout_backers, a wind-down payout and, on legacy launches, trade fees. Claim any time; it never expires.`,
    },
    claim_creator_fees: {
      group: "Fees",
      caller: "Creator",
      moves: "Creator fees → creator",
      description: "Legacy Holdfast-curve launches only: pays the creator's share of trade fees. pump.fun launches pay the creator nothing.",
    },
    sweep_platform_fees: {
      group: "Fees",
      caller: "Anyone",
      moves: "Platform fees → the fixed fee recipient",
      description: "Permissionless: it can only ever pay the platform's configured fee recipient.",
    },
    admin_withdraw_vault: {
      group: "Platform admin",
      caller: "Admin (a 2-of-3 Squads multisig on mainnet)",
      moves: "Vault SOL and tokens → fee recipient",
      description:
        "Withdraws any amount of a launch's vault SOL and tokens to the platform fee recipient; it can't touch the token's liquidity, backers' accruals or the buyback pool. Every withdrawal emits VaultWithdrawn and is listed on the launch page.",
    },
    dev_withdraw_vault: {
      group: "Platform admin",
      caller: "Dev key (a single key the admin sets)",
      moves: "Vault SOL and tokens → the dev key's own wallet",
      description:
        "The same withdrawal as admin_withdraw_vault, signed by the platform's single dev key instead of the multisig: SOL goes to the dev key's own wallet, tokens to its own token account. Works while the platform is paused. Every withdrawal emits VaultWithdrawnByDev and is listed on the launch page.",
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
    migrate_platform: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — upgrades the platform account layout",
      description: "Rewrites the platform config into the current account layout after a program upgrade; params are carried over.",
    },
    migrate_launch: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — upgrades a launch account layout",
      description: "Rewrites one launch into the current account layout after a program upgrade; its frozen terms and balances are carried over.",
    },
    set_fee_recipient: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — where platform fees and admin vault withdrawals go",
      description: "Points platform fee sweeps and admin vault withdrawals at a new recipient (dev-key withdrawals always go to the dev key).",
    },
    set_agent_authority: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — which key may call the agent instructions",
      description: "Rotates the vault agent's key. Whoever holds it can still only call the agent buy and sell instructions, payout_backers and buyback_burn.",
    },
    set_agent_executors: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — which wallets execute the agent's pump trades",
      description: "Sets, replaces or (with default pubkeys) unsets the 15 shared agent wallets. Unset, each vault's pump authority trades directly.",
    },
    set_dev_authority: {
      group: "Platform admin",
      caller: "Admin",
      moves: "Nothing — which key may call dev_withdraw_vault",
      description: "Sets, rotates or (with the default pubkey) disables the dev key, the one key besides the admin that can withdraw a vault.",
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
}

type IdlType = string | { option?: IdlType; vec?: IdlType; array?: [IdlType, number]; defined?: { name: string } };

function typeName(t: IdlType): string {
  if (typeof t === "string") return t;
  if (t.option) return `Option<${typeName(t.option)}>`;
  if (t.vec) return `Vec<${typeName(t.vec)}>`;
  if (t.array) return `[${typeName(t.array[0])}; ${t.array[1]}]`;
  if (t.defined) return t.defined.name;
  return "unknown";
}

/** Every instruction in the deployed IDL, described with the given terms (the platform's current params, or mainnet defaults). */
export function instructionRows(s: PumpSplit = DEFAULT_PUMP_SPLIT): InstructionRow[] {
  const KNOWN = known(s);
  const order = Object.keys(KNOWN);
  const rows = (IDL.instructions as unknown as {
    name: string;
    args: { name: string; type: IdlType }[];
    accounts: { name: string; signer?: boolean; writable?: boolean }[];
  }[]).map((ix): InstructionRow => {
    const k = KNOWN[ix.name];
    const accounts = ix.accounts.map((a) => ({ name: a.name, signer: !!a.signer, writable: !!a.writable }));
    const signer = accounts.find((a) => a.signer)?.name;
    return {
      name: ix.name,
      group: k?.group ?? "Other",
      caller: k?.caller ?? (signer ? signer.replace(/_/g, " ") : "Anyone"),
      moves: k?.moves ?? `Writes ${accounts.filter((a) => a.writable).map((a) => a.name).join(", ") || "nothing"}`,
      description: k?.description ?? `Signed by ${signer ?? "anyone"}.`,
      args: ix.args.map((a) => ({ name: a.name, type: typeName(a.type) })),
      accounts,
    };
  });
  const rank = (r: InstructionRow) => {
    const i = order.indexOf(r.name);
    return GROUPS.indexOf(r.group) * 1000 + (i < 0 ? 999 : i);
  };
  return rows.sort((a, b) => rank(a) - rank(b));
}
