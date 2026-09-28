"use client";

import {
  curveOf,
  fmtPrice,
  minOut,
  quoteBuy,
  quoteSell,
  solForTokens,
  solToLamports,
  tokensToUi,
  uiToTokens,
} from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { Settings2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useMoshClient, useSolBalance, useTokenBalance } from "@/lib/chain";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { usePlatform } from "@/lib/queries";
import { IMPACT_DANGER_PCT, IMPACT_WARN_PCT } from "@/lib/thresholds";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { AmountInput, type AmountPreset } from "../ui/input";
import { Segmented } from "../ui/tabs";
import { RuleTooltip } from "../ui/tooltip";
import { TradeSettings, useTradeSettings } from "./trade-settings";

export type Side = "buy" | "sell";
/** Kept aside on buys for the network fee and the first-time token account rent. */
const BUY_HEADROOM = 5_000_000n;
const SELL_PRESETS = [25, 50, 100];
const TOKEN_PRESETS = ["1000000", "10000000", "25000000"];

function parseAmount(v: string, decimals: 6 | 9): bigint | null {
  if (!v.trim()) return null;
  try {
    return decimals === 9 ? solToLamports(v) : uiToTokens(v);
  } catch {
    return null;
  }
}

/** Base units → the exact decimal string the amount input accepts. */
const tokenInput = (v: bigint) => tokensToUi(v).toFixed(6).replace(/\.?0+$/, "");
const solInput = (v: bigint) => (Number(v) / 1e9).toFixed(9).replace(/\.?0+$/, "");

function QuoteRow({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={cn("num text-right", tone ?? "text-ink")}>{children}</dd>
    </div>
  );
}

/**
 * Trade panel (§4.5): Buy/Sell (the active side fills up/down and the CTA follows it), amount in SOL
 * or tokens with presets, settings modal, live quote rows from the curve maths. Logged out it stays
 * fully interactive; only the CTA becomes "Connect wallet".
 */
export function TradePanel({
  launch: l,
  side,
  onSideChange,
  className,
  bare,
}: {
  launch: LaunchSummary;
  side: Side;
  onSideChange: (s: Side) => void;
  className?: string;
  /** Inside a sheet: no panel frame. */
  bare?: boolean;
}) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const platform = usePlatform();
  const sol = useSolBalance(publicKey);
  const tokens = useTokenBalance(l.mint, publicKey);
  const tx = useTx();
  const settings = useTradeSettings();
  const { slippageBps } = settings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buyIn, setBuyIn] = useState<"sol" | "token">("sol");
  const [amount, setAmount] = useState("");

  const feeBps = l.terms.tradeFeeBps;
  const curve = useMemo(() => curveOf(l), [l]);
  const inputIsSol = side === "buy" && buyIn === "sol";
  const raw = parseAmount(amount, inputIsSol ? 9 : 6);

  const quote = useMemo(() => {
    if (!raw || raw <= 0n) return null;
    try {
      if (side === "buy") {
        const solIn = buyIn === "sol" ? raw : solForTokens(curve, raw, feeBps);
        const q = quoteBuy(curve, solIn, feeBps);
        return { kind: "buy" as const, solIn, q, min: minOut(q.tokensOut, slippageBps) };
      }
      const q = quoteSell(curve, raw, feeBps);
      return { kind: "sell" as const, q, min: minOut(q.solOut, slippageBps) };
    } catch {
      return null;
    }
  }, [raw, side, buyIn, curve, feeBps, slippageBps]);

  const impactPct = quote ? quote.q.impactBps / 100 : 0;
  const impactTone = impactPct > IMPACT_DANGER_PCT ? "text-down" : impactPct > IMPACT_WARN_PCT ? "text-warn" : undefined;

  let reason: string | null = null;
  if (platform.data?.params.paused) reason = "Trading is paused";
  else if (!raw || raw <= 0n) reason = "Enter an amount";
  else if (!quote) reason = side === "buy" ? "Exceeds curve liquidity" : "Invalid amount";
  else if (quote.kind === "buy" && quote.q.tokensOut === 0n) reason = "Amount too small";
  else if (quote.kind === "sell" && quote.q.solOut <= 0n) reason = "Amount too small";
  else if (quote.kind === "sell" && quote.q.gross >= curve.realSol) reason = "Exceeds curve SOL";
  else if (publicKey && quote.kind === "buy" && sol.data !== undefined && quote.solIn + BUY_HEADROOM > sol.data) {
    reason = "Not enough SOL";
  } else if (publicKey && quote.kind === "sell" && tokens.data !== undefined && raw > tokens.data) {
    reason = `Not enough $${l.symbol}`;
  }

  const maxBuy = sol.data !== undefined && sol.data > BUY_HEADROOM ? sol.data - BUY_HEADROOM : 0n;
  const presets: AmountPreset[] =
    side === "sell"
      ? SELL_PRESETS.map((pct) => {
          const base = tokens.data ?? 0n;
          // Whole tokens for partial presets; 100% keeps the exact balance.
          let v = (base * BigInt(pct)) / 100n;
          if (pct < 100 && v >= 1_000_000_000n) v -= v % 1_000_000n;
          const value = tokenInput(v);
          return { label: `${pct}%`, active: !!publicKey && amount === value && v > 0n, onSelect: () => setAmount(value) };
        })
      : buyIn === "sol"
        ? [
            ...settings.quickBuy.map((v) => ({ label: v, active: amount === v, onSelect: () => setAmount(v) })),
            ...(publicKey ? [{ label: "Max", active: amount === solInput(maxBuy) && maxBuy > 0n, onSelect: () => setAmount(solInput(maxBuy)) }] : []),
          ]
        : TOKEN_PRESETS.map((v) => ({
            label: fmtTokens(uiToTokens(v)),
            active: amount === v,
            onSelect: () => setAmount(v),
          }));

  const submit = async () => {
    if (!quote) return;
    const mint = new PublicKey(l.mint);
    const sig = await tx.run(
      quote.kind === "buy"
        ? {
            label: `Buy $${l.symbol}`,
            successMessage: `Bought ${fmtTokens(quote.q.tokensOut)} $${l.symbol}`,
            build: async (payer) => [await client.buyIx(payer, mint, quote.solIn, quote.min)],
            invalidate: [["token-balance", l.mint]],
          }
        : {
            label: `Sell $${l.symbol}`,
            successMessage: `Sold for ${fmtLamports(quote.q.solOut)} SOL`,
            build: async (payer) => [await client.sellIx(payer, mint, quote.q.tokensIn, quote.min)],
            invalidate: [["token-balance", l.mint]],
          },
    );
    if (sig) setAmount("");
  };

  const balance = !publicKey
    ? undefined
    : side === "buy"
      ? sol.data !== undefined
        ? `${fmtLamports(sol.data)} SOL`
        : "…"
      : tokens.data !== undefined
        ? `${fmtTokens(tokens.data)} $${l.symbol}`
        : "…";
  const backerPct = (l.terms.backerFeeShareBps / 100).toString();
  const cta = side === "buy" ? `Buy $${l.symbol}` : `Sell $${l.symbol}`;

  return (
    <section
      id="trade"
      aria-label={`Trade $${l.symbol}`}
      className={cn(!bare && "rounded-md border border-line bg-surface", "grid gap-4 p-4", className)}
    >
      <div className="flex items-center gap-2">
        <Segmented<Side>
          label="Side"
          stretch
          value={side}
          onChange={(s) => {
            onSideChange(s);
            setAmount("");
          }}
          items={[
            { value: "buy", label: "Buy", tone: "up" },
            { value: "sell", label: "Sell", tone: "down" },
          ]}
        />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Trade settings, max slippage ${slippageBps / 100}%`}
          className="small num inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-ink-2 transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-10"
        >
          <Settings2 className="size-4" strokeWidth={1.5} aria-hidden />
          {slippageBps / 100}%
        </button>
      </div>

      <AmountInput
        id={bare ? "trade-amount-sheet" : "trade-amount"}
        label={side === "buy" ? "You pay" : "You sell"}
        value={amount}
        onChange={setAmount}
        decimals={inputIsSol ? 9 : 6}
        unit={side === "sell" || buyIn === "token" ? `$${l.symbol}` : "SOL"}
        onToggleUnit={
          side === "buy"
            ? () => {
                setBuyIn((u) => (u === "sol" ? "token" : "sol"));
                setAmount("");
              }
            : undefined
        }
        balance={balance}
        presets={presets}
      />

      <dl className="small grid gap-2">
        <QuoteRow label="You receive">
          {quote
            ? quote.kind === "buy"
              ? `${fmtTokens(quote.q.tokensOut)} $${l.symbol}`
              : `${fmtLamports(quote.q.solOut)} SOL`
            : "—"}
        </QuoteRow>
        {quote?.kind === "buy" && buyIn === "token" ? <QuoteRow label="You pay">{fmtLamports(quote.solIn)} SOL</QuoteRow> : null}
        <QuoteRow
          label={<RuleTooltip rule="How far this trade moves the curve price from where it is now.">Price impact</RuleTooltip>}
          tone={impactTone}
        >
          {quote ? `${impactPct.toFixed(2)}%` : "—"}
        </QuoteRow>
        <QuoteRow label={`Fee (${feeBps / 100}%)`}>{quote ? `${fmtLamports(quote.q.fee)} SOL` : "—"}</QuoteRow>
        <QuoteRow label={`Min received (${slippageBps / 100}% slippage)`}>
          {quote ? (quote.kind === "buy" ? `${fmtTokens(quote.min)} $${l.symbol}` : `${fmtLamports(quote.min)} SOL`) : "—"}
        </QuoteRow>
        <QuoteRow label="Avg price">{quote ? `${fmtPrice(quote.q.avgPrice)} SOL` : "—"}</QuoteRow>
      </dl>

      <div className="grid gap-2">
        {publicKey ? (
          <Button
            variant={side}
            size="lg"
            className="w-full"
            disabled={!!reason}
            busy={!!tx.pending}
            onClick={() => void submit()}
          >
            {tx.stage ? TX_STAGE_LABEL[tx.stage] : (reason ?? cta)}
          </Button>
        ) : (
          <Button variant={side} size="lg" className="w-full" onClick={() => setVisible(true)}>
            Connect wallet
          </Button>
        )}
        <p className="micro text-center text-ink-3">{backerPct}% of this fee goes to the launch&apos;s backers.</p>
      </div>

      <TradeSettings open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
    </section>
  );
}
