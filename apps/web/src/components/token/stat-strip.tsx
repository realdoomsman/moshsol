"use client";

import { fmtPrice, lamportsToSol } from "@holdfast/sdk";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import type { LaunchSummary } from "@/lib/types";
import { NumberTicker } from "../ui/number-ticker";
import { Stat, StatRow } from "../ui/stat";

const sol = (v: number) => `${fmtSolValue(v)} SOL`;

/**
 * Token stat row (§4.5): seven 1px-ruled cells, `label` over `num-l`, values flash on change. The
 * last cell is "Backer fees paid" — what trading has earned the backers so far. Detail page: real
 * small values always show (§5.3 thresholds only gate headline slots).
 */
export function StatStrip({ launch: l, className }: { launch: LaunchSummary; className?: string }) {
  const backerPct = l.terms.backerFeeShareBps / 100;
  return (
    <StatRow className={className}>
      <Stat label="Price" value={<NumberTicker value={l.priceSol} format={(v) => `${fmtPrice(v)} SOL`} />} />
      <Stat label="Vol 24h" value={<NumberTicker value={l.volume24hSol} format={sol} />} />
      <Stat
        label="Liquidity"
        rule="SOL in the bonding curve. It never migrates and no instruction can withdraw it."
        value={<NumberTicker value={lamportsToSol(l.realSol)} format={sol} />}
        sub="locked in the curve"
      />
      <Stat
        label="Vault"
        rule="Bought at launch with the raise and locked forever. Only the vault agent trades it, within on-chain limits."
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
        label="Backer fees paid"
        className="max-md:col-span-2"
        rule={`${backerPct}% of every trading fee goes to the launch's backers, pro rata to what they deposited.`}
        value={<NumberTicker value={lamportsToSol(l.backerFeesAccrued)} format={sol} />}
      />
    </StatRow>
  );
}
