"use client";

import {
  curveOf,
  fmtPrice,
  minOut,
  quoteBuy,
  quoteSell,
  solToLamports,
  tokensToUi,
  uiToTokens,
} from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { ArrowDownUp, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useMoshClient, useSolBalance, useTokenBalance } from "@/lib/chain";
import { fmtLamports, fmtTokens } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { usePlatform } from "@/lib/queries";
import { solForTokens } from "@holdfast/sdk";
import { useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Segmented } from "../ui/interactive";
import { Card, Row } from "../ui/primitives";

export type Side = "buy" | "sell";
const SLIPPAGE_PRESETS = [50, 100, 200, 500];
/** Kept aside on buys for the network fee and the first-time token account rent. */
const BUY_HEADROOM = 5_000_000n;

function parseAmount(v: string, decimals: 6 | 9): bigint | null {
  if (!v.trim()) return null;
  try {
    return decimals === 9 ? solToLamports(v) : uiToTokens(v);
  } catch {
    return null;
  }
}

export function TradePanel({
  launch: l,
  side,
  onSideChange,
}: {
  launch: LaunchSummary;
  side: Side;
  onSideChange: (s: Side) => void;
}) {
  const { publicKey } = useWallet();
  const client = useMoshClient();
  const platform = usePlatform();
  const sol = useSolBalance(publicKey);
  const tokens = useTokenBalance(l.mint, publicKey);
  const tx = useTx();
  const { setVisible } = useWalletModal();

  const [buyIn, setBuyIn] = useState<"sol" | "token">("sol");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useLocalStorage("holdfast:slippage-bps", 100);
  const [showSettings, setShowSettings] = useState(false);
  const [customSlip, setCustomSlip] = useState("");

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

  const impactBps = quote ? quote.q.impactBps : 0;
  const impactTone = impactBps >= 1_000 ? "text-down" : impactBps >= 300 ? "text-warn" : "text-up";

  let reason: string | null = null;
  if (!publicKey) reason = null;
  else if (platform.data?.params.paused) reason = "Trading is paused";
  else if (!raw || raw <= 0n) reason = "Enter an amount";
  else if (!quote) reason = side === "buy" ? "Exceeds curve liquidity" : "Invalid amount";
  else if (quote.kind === "buy" && sol.data !== undefined && quote.solIn + BUY_HEADROOM > sol.data) reason = "Insufficient SOL";
  else if (quote.kind === "buy" && quote.q.tokensOut === 0n) reason = "Amount too small";
  else if (quote.kind === "sell" && tokens.data !== undefined && raw > tokens.data) reason = `Insufficient $${l.symbol}`;
  else if (quote.kind === "sell" && quote.q.solOut <= 0n) reason = "Amount too small";
  else if (quote.kind === "sell" && quote.q.gross >= curve.realSol) reason = "Exceeds curve SOL";

  const quick =
    side === "buy"
      ? buyIn === "sol"
        ? [
            { label: "0.1", v: "0.1" },
            { label: "0.5", v: "0.5" },
            { label: "1", v: "1" },
            { label: "5", v: "5" },
          ]
        : [
            { label: "1M", v: "1000000" },
            { label: "5M", v: "5000000" },
            { label: "10M", v: "10000000" },
            { label: "25M", v: "25000000" },
          ]
      : [25, 50, 75, 100].map((pct) => ({
          label: pct === 100 ? "Max" : `${pct}%`,
          v: (() => {
            if (!tokens.data) return "0";
            let base = (tokens.data * BigInt(pct)) / 100n;
            // Whole tokens for partial presets; Max keeps the exact balance.
            if (pct < 100 && base >= 1_000_000_000n) base -= base % 1_000_000n;
            return tokensToUi(base).toFixed(6).replace(/\.?0+$/, "");
          })(),
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

  const balanceLine =
    side === "buy"
      ? sol.data !== undefined
        ? `${fmtLamports(sol.data)} SOL`
        : "—"
      : tokens.data !== undefined
        ? `${fmtTokens(tokens.data)} $${l.symbol}`
        : "—";

  return (
    <Card id="trade" className="p-4 sm:p-5">
      <div className="flex items-stretch gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl border border-line bg-black/30 p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onSideChange(s);
                setAmount("");
              }}
              aria-pressed={side === s}
              className={cn(
                "h-10 rounded-lg text-sm font-semibold capitalize transition",
                side === s
                  ? s === "buy"
                    ? "bg-up text-black shadow-[0_6px_24px_-8px_rgb(47_230_167/0.6)]"
                    : "bg-down text-black shadow-[0_6px_24px_-8px_rgb(255_92_124/0.6)]"
                  : "text-dim hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          aria-label="Slippage settings"
          className={cn(
            "flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition",
            showSettings ? "border-lime/40 text-lime" : "border-line text-muted hover:text-ink",
          )}
        >
          <Settings2 className="size-4" aria-hidden />
          {slippageBps / 100}%
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showSettings ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl border border-line bg-black/25 p-3">
              <div className="text-xs font-medium text-muted">Max slippage</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SLIPPAGE_PRESETS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => {
                      setSlippageBps(bps);
                      setCustomSlip("");
                    }}
                    className={cn(
                      "h-10 rounded-lg border px-3 text-xs font-semibold transition sm:h-8",
                      slippageBps === bps ? "border-lime/50 bg-lime/10 text-lime" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {bps / 100}%
                  </button>
                ))}
                <div className="relative">
                  <input
                    aria-label="Custom slippage percent"
                    inputMode="decimal"
                    placeholder="Custom"
                    value={customSlip}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d*\.?\d{0,2}$/.test(v)) return;
                      setCustomSlip(v);
                      const n = Number(v);
                      if (v && n > 0 && n <= 50) setSlippageBps(Math.round(n * 100));
                    }}
                    className="h-10 w-24 rounded-lg border border-line bg-transparent px-2.5 pr-6 text-xs text-ink outline-none focus:border-lime/50 sm:h-8"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-dim">%</span>
                </div>
              </div>
              {slippageBps > 500 ? <p className="mt-2 text-xs text-warn">High slippage — you may get a worse fill.</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mt-4 rounded-xl border border-line bg-black/30 p-3 transition-colors focus-within:border-lime/40">
        <div className="flex items-center justify-between text-xs text-dim">
          <label htmlFor="trade-amount">{side === "buy" ? "You pay" : "You sell"}</label>
          <span>Balance {balanceLine}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="trade-amount"
            aria-label={`Amount in ${inputIsSol ? "SOL" : l.symbol}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d{0,9}$/.test(v)) setAmount(v);
            }}
            className="w-0 min-w-0 flex-1 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-white/40"
          />
          {side === "buy" ? (
            <button
              type="button"
              onClick={() => {
                setBuyIn((u) => (u === "sol" ? "token" : "sol"));
                setAmount("");
              }}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white/[0.05] px-2.5 text-xs font-semibold transition hover:border-line-strong sm:h-8"
              title="Switch input between SOL and tokens"
            >
              {buyIn === "sol" ? "SOL" : `$${l.symbol}`}
              <ArrowDownUp className="size-3 text-dim" aria-hidden />
            </button>
          ) : (
            <span className="inline-flex h-10 shrink-0 items-center rounded-lg border border-line bg-white/[0.05] px-2.5 text-xs font-semibold sm:h-8">
              ${l.symbol}
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setAmount(q.v)}
              className="h-10 rounded-lg border border-line bg-white/[0.03] text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink sm:h-8"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-xl border border-line bg-black/20 p-3">
        <Row label="You receive">
          {quote ? (
            quote.kind === "buy" ? (
              <span className="text-[14px] font-semibold text-up">
                {fmtTokens(quote.q.tokensOut)} ${l.symbol}
              </span>
            ) : (
              <span className="text-[14px] font-semibold text-up">{fmtLamports(quote.q.solOut)} SOL</span>
            )
          ) : (
            "—"
          )}
        </Row>
        {quote?.kind === "buy" && buyIn === "token" ? <Row label="You pay">{fmtLamports(quote.solIn)} SOL</Row> : null}
        <Row label={`Fee (${feeBps / 100}%)`}>{quote ? `${fmtLamports(quote.q.fee)} SOL` : "—"}</Row>
        <Row label="Price impact">
          <span className={quote ? impactTone : undefined}>{quote ? `${(impactBps / 100).toFixed(2)}%` : "—"}</span>
        </Row>
        <Row label={`Min received (${slippageBps / 100}% slip)`}>
          {quote ? (quote.kind === "buy" ? `${fmtTokens(quote.min)}` : `${fmtLamports(quote.min)} SOL`) : "—"}
        </Row>
        <Row label="Avg price">{quote ? `${fmtPrice(quote.q.avgPrice)} SOL` : "—"}</Row>
      </div>

      <Button
        variant={side === "buy" ? "up" : "down"}
        size="lg"
        className="mt-4 w-full"
        disabled={!!reason}
        loading={!!tx.pending}
        onClick={() => (publicKey ? void submit() : setVisible(true))}
      >
        {!publicKey ? "Connect wallet to trade" : (reason ?? `${side === "buy" ? "Buy" : "Sell"} $${l.symbol}`)}
      </Button>
      <p className="mt-2.5 text-center text-[11.5px] text-dim">
        {(feeBps * l.terms.backerFeeShareBps) / 1_000_000}% of every trade goes to backers ·{" "}
        {(feeBps * l.terms.creatorFeeShareBps) / 1_000_000}% to the creator
      </p>
    </Card>
  );
}
