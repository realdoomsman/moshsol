"use client";

import { fmtPrice, lamportsToSol } from "@holdfast/sdk";
import { useVenueCurve } from "@/lib/chain";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { VENUE_LABEL, venueKindOf } from "@/lib/launch";
import type { LaunchSummary } from "@/lib/types";
import { NumberTicker } from "../ui/number-ticker";
import { Stat, StatRow } from "../ui/stat";

const sol = (v: number) => `${fmtSolValue(v)} SOL`;

/**
 * Token stat row (§4.5): seven 1px-ruled cells, `label` over `num-l`, values flash on change. The
 * last cell is "Paid to backers" — fee share, vault agent profit and any wind-down payout so far.
 * Pump launches show the venue's liquidity (the indexer prices them from pump.fun's reserves) in
 * place of the Holdfast curve's real SOL. Detail page: real small values always show (§5.3
 * thresholds only gate headline slots).
 */
export function StatStrip({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  const pump = l.venue === "pump";
  const venue = useVenueCurve(l);
  const venueLabel = VENUE_LABEL[venueKindOf(l)];
  const backerPct = l.terms.backerFeeShareBps / 100;
  const profitPct = 100 - l.terms.burnShareBps / 100;
  return (
    <StatRow className={className}>
      <Stat label="Price" value={<NumberTicker value={l.priceSol} format={(v) => `${fmtPrice(v)} SOL`} />} />
      <Stat label="Vol 24h" value={<NumberTicker value={l.volume24hSol} format={sol} />} />
      {pump ? (
        <Stat
          label="Liquidity"
          rule={`SOL in the ${venueLabel} reserves, read from chain; sellers are paid from it there. Trades happen on pump.fun, not here; this site only reads the venue.`}
          value={venue ? <NumberTicker value={lamportsToSol(venue.realSol)} format={sol} /> : "—"}
          sub={`on ${venueLabel}`}
        />
      ) : (
        <Stat
          label="Liquidity"
          rule="SOL in the Holdfast bonding curve; sellers are paid from it. It never migrates and admin_withdraw_vault can't touch it. A wind-down (no tokens left outside the curve and vault) credits what's left to backers."
          value={<NumberTicker value={lamportsToSol(l.realSol)} format={sol} />}
          sub="in the curve"
        />
      )}
      <Stat
        label="Vault"
        rule="Bought at launch with the raise. Only the vault agent trades it, within on-chain limits. The platform multisig can withdraw it with admin_withdraw_vault; every withdrawal is listed on this page."
        value={<NumberTicker value={lamportsToSol(l.vaultSol)} format={sol} />}
        sub={`+ ${fmtTokens(l.vaultTokens)} $${l.symbol}`}
      />
      <Stat label="Backers" value={<NumberTicker value={l.backerCount} format={(v) => v.toLocaleString("en-US")} />} />
      <Stat
        label="Holders"
        rule="Wallets holding any amount. The curve and vault are excluded."
        value={<NumberTicker value={l.holders} format={(v) => v.toLocaleString("en-US")} />}
      />
      <Stat
        label="Paid to backers"
        className="max-md:col-span-2"
        rule={
          pump
            ? `${profitPct}% of the vault agent's realized profit (the other ${100 - profitPct}% buys and burns the Holdfast token) and any wind-down payout, pro rata to what backers deposited. Public trades happen on pump.fun; the creator fees pump.fun pays go to the vault and the buyback pool.`
            : `${backerPct}% of every trading fee, 100% of the vault agent's realized profit and any wind-down payout, pro rata to what backers deposited.`
        }
        value={<NumberTicker value={lamportsToSol(l.backerFeesAccrued)} format={sol} />}
        sub={l.profitSharedSol > 0 ? `${fmtSolValue(l.profitSharedSol)} SOL from vault profit` : undefined}
      />
    </StatRow>
  );
}
