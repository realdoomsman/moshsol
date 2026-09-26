"use client";

import { countdown, fmtPrice, lamportsToSol, timeAgo, tokensToUi } from "@moshsol/sdk";
import { Bot, ShieldCheck } from "lucide-react";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useAgentStatus } from "@/lib/queries";
import type { AgentZones } from "@moshsol/sdk";
import type { LaunchSummary } from "@/lib/types";
import { cn } from "../ui/cn";
import { Hint } from "../ui/interactive";
import { Card, CardHeader, Meter, Row } from "../ui/primitives";

/** Price track showing where spot sits relative to the agent buy/sell thresholds. */
function BandTrack({ price, zones }: { price: number; zones: AgentZones }) {
  const lo = Math.min(zones.buyBelow, price) * 0.97;
  const hi = Math.max(zones.sellAbove, price) * 1.03;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const zone = price <= zones.buyBelow ? "buy" : price >= zones.sellAbove ? "sell" : "hold";
  return (
    <div>
      <div className="relative mt-7 h-2.5 rounded-full bg-white/[0.06]">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-lime/30" style={{ width: at(zones.buyBelow) }} />
        <div
          className="absolute inset-y-0 right-0 rounded-r-full bg-pink/35"
          style={{ left: at(zones.sellAbove) }}
        />
        <div className="absolute -top-1 h-4.5 w-0.5 rounded-full bg-violet" style={{ left: at(zones.ema) }} title="EMA" />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-white shadow-[0_0_12px_rgb(255_255_255/0.55)] transition-[left] duration-700"
          style={{ left: at(price) }}
        >
          <span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-black">
            now
          </span>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px]">
        <span className="text-lime">buy ≤ {fmtPrice(zones.buyBelow)}</span>
        <span className="text-dim">EMA {fmtPrice(zones.ema)}</span>
        <span className="text-pink">sell ≥ {fmtPrice(zones.sellAbove)}</span>
      </div>
      <p className="mt-2.5 text-xs text-muted">
        {zone === "hold"
          ? "Price is inside the band — agents hold."
          : zone === "buy"
            ? "Price is in the buy zone — agents may buy the dip with vault SOL."
            : "Price is in the sell zone — agents may sell into the rally."}
      </p>
    </div>
  );
}

export function VaultCard({ launch: l, zones }: { launch: LaunchSummary; zones: AgentZones }) {
  const now = useNow();
  const status = useAgentStatus();
  const decision = status.data?.decisions.find((d) => d.mint === l.mint);
  const vaultSol = lamportsToSol(l.vaultSol);
  const vaultTokensUi = tokensToUi(l.vaultTokens);
  const value = vaultSol + vaultTokensUi * l.priceSol;
  const entry = BigInt(l.bundleTokens) > 0n ? lamportsToSol(l.bundleSol) / tokensToUi(l.bundleTokens) : 0;
  const vsEntry = entry > 0 ? (l.priceSol / entry - 1) * 100 : null;
  const vsCost = zones.avgCost > 0 ? (l.priceSol / zones.avgCost - 1) * 100 : null;
  const resetAt = l.windowStart + l.terms.agentWindowSecs;
  const rolled = now >= resetAt;
  const buyUsed = rolled ? 0 : pctOf(l.windowSolSpent, l.windowBuyCap);
  const sellUsed = rolled ? 0 : pctOf(l.windowTokensSold, l.windowSellCap);

  return (
    <Card className="overflow-hidden">
      <div className="pointer-events-none absolute -top-20 -right-16 size-48 rounded-full bg-lime/10 blur-3xl" />
      <CardHeader
        title="Locked vault"
        icon={<ShieldCheck className="size-3.5 text-lime" aria-hidden />}
        right={<span className="text-[11px] font-medium text-dim">no withdraw instruction</span>}
      />
      <div className="relative px-5 pb-5">
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {fmtSolValue(value)} <span className="text-base font-medium text-dim">SOL value</span>
        </div>
        <div className="mt-1 text-sm text-muted tabular-nums">
          {fmtLamports(l.vaultSol)} SOL + {fmtTokens(l.vaultTokens)} ${l.symbol}{" "}
          <span className="text-dim">({pctOf(l.vaultTokens, "1000000000000000").toFixed(2)}% of supply)</span>
        </div>

        <div className="mt-4 grid gap-2">
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                Vault avg cost{" "}
                <Hint>
                  Average-cost basis of the vault&apos;s tokens. Agents never buy above it (except buy-backs below their
                  average sell) and never sell below it plus the band.
                </Hint>
              </span>
            }
          >
            {fmtPrice(zones.avgCost)}{" "}
            {vsCost !== null ? (
              <span className={cn("ml-1", vsCost >= 0 ? "text-up" : "text-down")}>
                ({vsCost >= 0 ? "+" : ""}
                {vsCost.toFixed(1)}%)
              </span>
            ) : null}
          </Row>
          <Row label="Bundle entry price">
            {fmtPrice(entry)}{" "}
            {vsEntry !== null ? (
              <span className={cn("ml-1", vsEntry >= 0 ? "text-up" : "text-down")}>
                ({vsEntry >= 0 ? "+" : ""}
                {vsEntry.toFixed(1)}%)
              </span>
            ) : null}
          </Row>
          {BigInt(l.buybackSol) > 0n ? <Row label="Buy-back SOL">{fmtLamports(l.buybackSol)} SOL</Row> : null}
          <Row label="Agent trades">
            {l.agentBuys} buys · {l.agentSells} sells
          </Row>
        </div>

        <div className="mt-5 rounded-xl border border-line bg-black/25 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted">Agent window</span>
            <span className="text-dim tabular-nums">
              {rolled ? "fresh window on next agent trade" : `resets in ${countdown(resetAt, now)}`}
            </span>
          </div>
          <div className="mt-3 grid gap-3">
            <div>
              <div className="mb-1.5 flex justify-between text-xs tabular-nums">
                <span className="text-lime">Buy {l.terms.agentBuyBpsPerWindow / 100}% of vault SOL</span>
                <span className="text-dim">
                  {rolled ? "0" : fmtLamports(l.windowSolSpent)} / {fmtLamports(l.windowBuyCap)} SOL
                </span>
              </div>
              <Meter value={buyUsed} tone="lime" label="Agent buy budget used" />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs tabular-nums">
                <span className="text-pink">Sell {l.terms.agentSellBpsPerWindow / 100}% of vault tokens</span>
                <span className="text-dim">
                  {rolled ? "0" : fmtTokens(l.windowTokensSold)} / {fmtTokens(l.windowSellCap)}
                </span>
              </div>
              <Meter value={sellUsed} tone="pink" label="Agent sell budget used" />
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-semibold text-muted">
            Agents buy below <span className="text-lime">{fmtPrice(zones.buyBelow)}</span> · sell above{" "}
            <span className="text-pink">{fmtPrice(zones.sellAbove)}</span>
          </div>
          <BandTrack price={l.priceSol} zones={zones} />
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-black/25 p-3 text-xs">
          <Bot className={cn("mt-0.5 size-4 shrink-0", decision ? "text-cyan" : "text-dim")} aria-hidden />
          {decision ? (
            <div className="min-w-0">
              <span className="font-semibold text-ink capitalize">{decision.action}</span>
              <span className="text-dim"> · {timeAgo(decision.at, now)}</span>
              <div className="mt-0.5 text-muted">{decision.reason}</div>
            </div>
          ) : (
            <div className="text-dim">
              {status.isError ? "Agent status offline — on-chain limits still apply." : "Waiting for the agent's next tick…"}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
