"use client";

import { buildWhitelist, fmtPrice, lamportsToSol, previewBundle, solToLamports } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, CheckCircle2, Clock, Coins, Lock, Rocket, ShieldCheck, Undo2, Users, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useBackerAccount, useChainWhitelistRoot, useMoshClient, useSolBalance } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Phase } from "@/lib/launch";
import { usePlatform } from "@/lib/queries";
import { useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { AnimatedNumber } from "../ui/interactive";
import { Card, CardHeader, Row } from "../ui/primitives";
import { RaiseBar } from "./raise-bar";

/** Rent for a new backer account is paid on first deposit; keep headroom for it and the fee. */
const DEPOSIT_HEADROOM = 5_000_000n;

/** Days/hours/minutes/seconds as tiles; the seconds tile ticks. */
function CountdownTiles({ to }: { to: number }) {
  const now = useNow();
  const left = Math.max(0, to - now);
  const parts = [
    { k: "d", v: Math.floor(left / 86_400) },
    { k: "h", v: Math.floor((left % 86_400) / 3_600) },
    { k: "m", v: Math.floor((left % 3_600) / 60) },
    { k: "s", v: left % 60 },
  ];
  // Drop leading zero units (but always keep minutes and seconds).
  const shown = parts.slice(Math.min(parts.findIndex((p) => p.v > 0 || p.k === "m"), 2));
  return (
    <div className="flex items-end gap-1.5" suppressHydrationWarning>
      {shown.map((p) => (
        <span
          key={p.k}
          className="grid min-w-11 place-items-center rounded-xl border border-line bg-black/35 px-2 py-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] sm:min-w-12"
        >
          <span className="text-xl leading-none font-semibold tabular-nums sm:text-2xl" suppressHydrationWarning>
            {String(p.v).padStart(2, "0")}
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-wider text-dim uppercase">{p.k}</span>
        </span>
      ))}
    </div>
  );
}

export function RaiseHero({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const raised = lamportsToSol(l.raised);
  const minPct = pctOf(l.raiseMin, l.raiseMax);
  const funded = pctOf(l.raised, l.raiseMax);
  const failed = phase === "failed" || phase === "refunding";
  const minMet = BigInt(l.raised) >= BigInt(l.raiseMin);
  return (
    <Card className="overflow-hidden p-5 sm:p-7">
      <div
        className={cn(
          "pointer-events-none absolute -top-28 left-1/4 size-80 rounded-full blur-3xl",
          failed ? "bg-down/10" : minMet ? "bg-lime/15" : "bg-violet/20",
        )}
      />
      <div className="pointer-events-none absolute -right-24 -bottom-32 size-72 rounded-full bg-cyan/[0.07] blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="type-eyebrow text-dim">{failed ? "Raised before it closed" : "Raised so far"}</div>
          <div className="type-display mt-2 text-5xl sm:text-6xl">
            <AnimatedNumber value={raised} format={fmtSolValue} />
            <span className="ml-2 text-lg font-medium tracking-normal text-dim sm:text-xl">/ {fmtLamports(l.raiseMax)} SOL</span>
          </div>
          <div className="mt-3 inline-flex h-7 items-center gap-2 rounded-full border border-line bg-black/30 px-3 text-xs text-muted tabular-nums">
            <span className="font-semibold text-ink">{funded > 0 && funded < 1 ? "<1" : Math.floor(funded)}% funded</span>
            {!failed && !minMet ? (
              <>
                <span className="text-dim">·</span>
                {fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} SOL to the minimum
              </>
            ) : null}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="type-eyebrow mb-2 text-dim">{phase === "raising" ? "Closes in" : "Status"}</div>
          {phase === "raising" ? (
            <CountdownTiles to={l.raiseDeadline} />
          ) : (
            <div className="text-2xl font-semibold sm:text-3xl">
              {phase === "ready" ? (
                <span className="text-lime">Ready to launch</span>
              ) : phase === "refunding" ? (
                <span className="text-warn">Refunding</span>
              ) : (
                <span className="text-down">Failed</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="relative mt-8">
        <RaiseBar raised={l.raised} raiseMin={l.raiseMin} raiseMax={l.raiseMax} size="lg" failed={failed} />
        <div className="relative mt-3 h-9 text-xs tabular-nums">
          <span className="absolute left-0">
            <span className="block font-semibold text-muted">0</span>
          </span>
          {minPct > 12 && minPct < 84 ? (
            <span className="absolute -translate-x-1/2 text-center" style={{ left: `${minPct}%` }}>
              <span className={cn("block font-semibold", minMet ? "text-lime" : "text-ink")}>
                {minMet ? "✓ " : ""}min {fmtLamports(l.raiseMin)}
              </span>
              <span className="block text-dim">launchable</span>
            </span>
          ) : null}
          <span className="absolute right-0 text-right">
            <span className="block font-semibold text-ink">max {fmtLamports(l.raiseMax)}</span>
            <span className="block text-dim">auto-closes</span>
          </span>
        </div>
      </div>
      <div className="relative mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
        <div>
          <div className="text-xs text-dim">Backers</div>
          <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold tabular-nums">
            <Users className="size-4 text-dim" aria-hidden /> {l.backerCount}
          </div>
        </div>
        <div>
          <div className="text-xs text-dim">Minimum</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {minMet ? (
              <span className="inline-flex items-center gap-1.5 text-lime">
                <CheckCircle2 className="size-4" aria-hidden /> met
              </span>
            ) : failed ? (
              <span className="inline-flex items-center gap-1.5 text-dim">
                <XCircle className="size-4" aria-hidden /> {fmtLamports(l.raiseMin)} SOL · not met
              </span>
            ) : (
              `${fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} SOL to go`
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-dim">Per-wallet cap</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {BigInt(l.maxPerWallet) > 0n ? `${fmtLamports(l.maxPerWallet)} SOL` : "None"}
          </div>
        </div>
        <div>
          <div className="text-xs text-dim">Access</div>
          <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold">
            {l.whitelisted ? (
              <>
                <Lock className="size-4 text-warn" aria-hidden /> Whitelist
              </>
            ) : (
              "Open"
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** What the `launch` instruction would do with the current raise. */
export function BundleNowCard({ launch: l }: { launch: LaunchSummary }) {
  const raised = BigInt(l.raised);
  const b = useMemo(
    () =>
      raised > 0n
        ? previewBundle({
            raised,
            virtualSol: BigInt(l.virtualSol),
            launchFeeBps: l.terms.launchFeeBps,
            reserveBps: l.reserveBps,
            bundleSupplyBps: l.bundleSupplyBps,
          })
        : null,
    [raised, l.virtualSol, l.terms.launchFeeBps, l.reserveBps, l.bundleSupplyBps],
  );
  return (
    <Card>
      <CardHeader
        title="If it launched now"
        icon={<ShieldCheck className="size-3.5 text-lime" aria-hidden />}
        right={
          <span className="hidden text-[11px] text-dim sm:inline">
            bundle ≤ {l.bundleSupplyBps / 100}% · reserve {l.reserveBps / 100}%
          </span>
        }
      />
      <div className="px-5 pb-5">
        {b ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              { k: "Bundle buys", v: `${b.supplyPct.toFixed(2)}% supply`, accent: true },
              { k: "Bundle tokens", v: fmtTokens(b.bundleTokens) },
              { k: "SOL into curve", v: `${fmtLamports(b.bundleSol)} SOL` },
              { k: "Vault SOL (agents)", v: `${fmtLamports(b.vaultSol)} SOL` },
              { k: "Start price", v: fmtPrice(b.priceAfter) },
              { k: "Start mcap", v: `${fmtSolValue(b.marketCapAfter)} SOL` },
            ].map((x) => (
              <div key={x.k}>
                <div className="text-xs text-dim">{x.k}</div>
                <div className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", x.accent && "text-lime")}>{x.v}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-dim">The bundle preview appears once the first deposit lands.</p>
        )}
        <p className="mt-4 text-xs leading-relaxed text-dim">
          <span className="sm:hidden">
            Bundle ≤ {l.bundleSupplyBps / 100}% of supply · reserve {l.reserveBps / 100}% of the raise.{" "}
          </span>
          Launch fee {l.terms.launchFeeBps / 100}% · the bundle is bought before any public trade, then locked in the
          vault forever. Trading fee {l.terms.tradeFeeBps / 100}%, of which {l.terms.backerFeeShareBps / 100}% goes to
          backers.
        </p>
      </div>
    </Card>
  );
}

/** Example deposit used for the explainer before an amount is typed. */
const EXAMPLE_DEPOSIT = 100_000_000n;

/**
 * What a deposit buys: its share of the backer fee pool (and so of every trade), and the slice of
 * the vault it funds at launch — recomputed live from the typed amount (or a 0.1 SOL example).
 */
function WhatYouGet({
  launch: l,
  deposited,
  add,
  room,
  walletRoom,
}: {
  launch: LaunchSummary;
  deposited: bigint;
  add: bigint | null;
  room: bigint;
  walletRoom: bigint | null;
}) {
  const example = [EXAMPLE_DEPOSIT, room > 0n ? room : 0n, walletRoom ?? EXAMPLE_DEPOSIT].reduce((a, b) => (b < a ? b : a));
  const extra = add ?? (deposited > 0n ? 0n : example);
  const mine = deposited + extra;
  const total = BigInt(l.raised) + extra;
  const bundle = useMemo(
    () =>
      total > 0n
        ? previewBundle({
            raised: total,
            virtualSol: BigInt(l.virtualSol),
            launchFeeBps: l.terms.launchFeeBps,
            reserveBps: l.reserveBps,
            bundleSupplyBps: l.bundleSupplyBps,
          })
        : null,
    [total, l.virtualSol, l.terms.launchFeeBps, l.reserveBps, l.bundleSupplyBps],
  );
  if (mine === 0n || total === 0n) return null;
  const share = pctOf(mine, total);
  const poolPct = (l.terms.tradeFeeBps * l.terms.backerFeeShareBps) / 1_000_000;
  const perTrade = (poolPct * share) / 100;
  const basis = add ? `for ${fmtLamports(mine)} SOL` : deposited > 0n ? "your position" : `e.g. ${fmtLamports(extra)} SOL`;
  return (
    <div className="relative mt-4 overflow-hidden rounded-xl border border-lime/20 bg-lime/[0.04] p-3.5">
      <div className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-lime/15 blur-2xl" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="type-eyebrow text-lime">What you get</span>
        <span className="text-[11px] text-dim tabular-nums">{basis}</span>
      </div>
      <ul className="relative mt-3 grid gap-3 text-[13px]">
        <li className="flex gap-2.5">
          <Coins className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted">Fee share</span>
              <span className="font-semibold text-ink tabular-nums">{share.toFixed(share >= 10 ? 1 : 2)}% of backer fees</span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-dim">
              ≈ {+perTrade.toPrecision(2)}% of every trade — {+perTrade.toPrecision(2)} SOL per 100 SOL traded, forever. Shrinks
              as others back it.
            </p>
          </div>
        </li>
        {bundle ? (
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted">Vault slice at launch</span>
                <span className="text-right font-semibold text-ink tabular-nums">
                  {fmtTokens((bundle.bundleTokens * mine) / total)} ${l.symbol}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-dim">
                + {fmtLamports((bundle.vaultSol * mine) / total)} SOL reserve — locked forever, traded only by agents.
              </p>
            </div>
          </li>
        ) : null}
        <li className="flex gap-2.5">
          <Undo2 className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
          <p className="text-xs leading-relaxed text-dim">
            <span className="text-muted">100% refundable</span> if the {fmtLamports(l.raiseMin)} SOL minimum isn&apos;t met or the
            creator cancels.
          </p>
        </li>
      </ul>
    </div>
  );
}

export function DepositPanel({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const platform = usePlatform();
  const sol = useSolBalance(publicKey);
  const backer = useBackerAccount(l.mint, publicKey);
  const chainRoot = useChainWhitelistRoot(l.mint, l.whitelisted);
  const tx = useTx();
  const [amount, setAmount] = useState("");

  const wl = useMemo(() => {
    if (!l.whitelisted) return null;
    if (!l.whitelist?.length) return { tree: null, error: "Member list unavailable from metadata" };
    try {
      const tree = buildWhitelist(l.whitelist.map((a) => new PublicKey(a)));
      return { tree, error: null };
    } catch {
      return { tree: null, error: "Member list is malformed" };
    }
  }, [l.whitelisted, l.whitelist]);
  const treeRoot = wl?.tree ? Buffer.from(wl.tree.root).toString("hex") : null;
  const rootMatches = treeRoot !== null && chainRoot.data !== undefined ? treeRoot === chainRoot.data : null;
  const proof = publicKey && wl?.tree ? wl.tree.proof(publicKey) : null;

  let raw: bigint | null = null;
  try {
    raw = amount.trim() ? solToLamports(amount) : null;
  } catch {
    raw = null;
  }
  const room = BigInt(l.raiseMax) - BigInt(l.raised);
  const deposited = backer.data?.deposited ?? 0n;
  const cap = BigInt(l.maxPerWallet);
  const walletRoom = cap > 0n ? (cap > deposited ? cap - deposited : 0n) : null;
  const effective = raw === null ? null : [raw, room, walletRoom ?? raw].reduce((a, b) => (b < a ? b : a));
  const clipped = raw !== null && effective !== null && effective < raw;

  let reason: string | null = null;
  if (!publicKey) reason = null;
  else if (platform.data?.params.paused) reason = "Platform is paused";
  else if (phase !== "raising") reason = phase === "ready" ? "Raise is closed — launch it" : "Raise is closed";
  else if (room <= 0n) reason = "Raise is full";
  else if (walletRoom === 0n) reason = "Wallet cap reached";
  else if (l.whitelisted && wl?.error) reason = wl.error;
  else if (l.whitelisted && rootMatches === false) reason = "Whitelist doesn't match on-chain root";
  else if (l.whitelisted && !proof) reason = "Your wallet isn't whitelisted";
  else if (!raw || raw <= 0n) reason = "Enter an amount";
  else if (sol.data !== undefined && (effective ?? 0n) + DEPOSIT_HEADROOM > sol.data) reason = "Insufficient SOL";

  const maxAffordable = sol.data !== undefined && sol.data > DEPOSIT_HEADROOM ? sol.data - DEPOSIT_HEADROOM : 0n;

  const deposit = async () => {
    if (!effective) return;
    const sig = await tx.run({
      label: `Back $${l.symbol}`,
      successMessage: `Deposited ${fmtLamports(effective)} SOL into the $${l.symbol} raise`,
      build: async (payer) => [await client.depositIx(payer, new PublicKey(l.mint), effective, proof ?? [])],
      invalidate: [["backer", l.mint]],
    });
    if (sig) setAmount("");
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Back this launch</h2>
        {sol.data !== undefined ? (
          <span className="text-xs text-dim tabular-nums">Balance {fmtLamports(sol.data)} SOL</span>
        ) : null}
      </div>

      {l.whitelisted ? (
        <div
          className={cn(
            "mt-3 flex items-start gap-2.5 rounded-xl border p-3 text-xs",
            !publicKey
              ? "border-line bg-black/20 text-muted"
              : proof && rootMatches !== false
                ? "border-up/25 bg-up/[0.06] text-up"
                : "border-warn/30 bg-warn/[0.06] text-warn",
          )}
        >
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">
              {!publicKey
                ? `Whitelist raise · ${l.whitelist?.length ?? 0} wallets`
                : proof
                  ? "You're on the whitelist"
                  : "Not on the whitelist"}
            </div>
            <div className="mt-0.5 text-muted">
              {rootMatches === null
                ? "Checking the member list against the on-chain merkle root…"
                : rootMatches
                  ? "Member list verified against the on-chain merkle root."
                  : "Member list does not match the on-chain root."}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-line bg-black/30 p-3 focus-within:border-lime/40">
        <div className="flex items-center gap-2">
          <input
            aria-label="Deposit amount in SOL"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d{0,9}$/.test(v)) setAmount(v);
            }}
            className="w-0 min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums outline-none placeholder:text-white/20"
          />
          <span className="rounded-lg border border-line bg-white/[0.05] px-2.5 py-1.5 text-xs font-semibold">SOL</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              disabled={!publicKey || maxAffordable === 0n}
              onClick={() => {
                let v = (maxAffordable * BigInt(pct)) / 100n;
                if (v > room) v = room;
                if (walletRoom !== null && v > walletRoom) v = walletRoom;
                setAmount((Number(v) / 1e9).toFixed(4).replace(/\.?0+$/, ""));
              }}
              className="h-10 rounded-lg border border-line bg-white/[0.03] text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40 sm:h-8"
            >
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>
      </div>

      {clipped && effective !== null ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Only {fmtLamports(effective)} SOL will be deposited —{" "}
          {walletRoom !== null && effective === walletRoom ? "per-wallet cap" : "the raise cap"} is reached after that.
        </div>
      ) : null}

      {phase === "raising" ? (
        <WhatYouGet launch={l} deposited={deposited} add={effective && effective > 0n ? effective : null} room={room} walletRoom={walletRoom} />
      ) : null}

      <div className="mt-4 grid gap-1.5">
        <Row label="Your deposit">{fmtLamports(deposited)} SOL</Row>
        {walletRoom !== null ? <Row label="Wallet cap left">{fmtLamports(walletRoom)} SOL</Row> : null}
        <Row label="Room in raise">{fmtLamports(room > 0n ? room : 0n)} SOL</Row>
      </div>

      <Button
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        disabled={!!reason}
        loading={!!tx.pending}
        onClick={() => (publicKey ? void deposit() : setVisible(true))}
      >
        {!publicKey ? "Connect wallet to back" : (reason ?? `Deposit ${fmtLamports(effective ?? 0n)} SOL`)}
      </Button>
      {phase !== "raising" ? (
        <p className="mt-2.5 text-center text-[11.5px] leading-relaxed text-dim">
          Full refund if the minimum isn&apos;t met by the deadline or the creator cancels.
        </p>
      ) : null}
    </Card>
  );
}

export function RaiseActions({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const { publicKey } = useWallet();
  const client = useMoshClient();
  const tx = useTx();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const isCreator = publicKey?.toBase58() === l.creator;
  const minMet = BigInt(l.raised) >= BigInt(l.raiseMin);
  const mint = new PublicKey(l.mint);

  if (phase !== "raising" && phase !== "ready") return null;
  if (!isCreator && phase !== "ready") return null;

  const launch = () =>
    void tx.run({
      label: `Launch $${l.symbol}`,
      successMessage: `$${l.symbol} is live — bundle locked in the vault`,
      computeUnits: 400_000,
      build: async (payer) => [await client.launchIx(payer, mint)],
    });

  const launchReason = !minMet
    ? `Needs ${fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} SOL more`
    : null;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Rocket className="size-4 text-lime" aria-hidden />
        <h2 className="text-[15px] font-semibold">{isCreator ? "Creator controls" : "Launch is ready"}</h2>
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {isCreator
          ? "You can launch any time the minimum is met. Launching buys the bundle and opens trading in one transaction."
          : "The raise closed with its minimum met. Anyone can trigger the launch."}
      </p>
      <Button
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        icon={<Rocket className="size-4" aria-hidden />}
        disabled={!!launchReason}
        loading={tx.pending === `Launch $${l.symbol}`}
        onClick={launch}
      >
        {launchReason ?? (isCreator && phase === "raising" ? "Launch now" : "Launch")}
      </Button>
      {isCreator && phase === "raising" ? (
        confirmCancel ? (
          <div className="mt-3 rounded-xl border border-down/30 bg-down/[0.06] p-3">
            <p className="text-xs text-down">
              Cancelling is permanent. Every backer can then refund their full deposit.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(false)}>
                Keep raising
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={tx.pending === `Cancel $${l.symbol} raise`}
                onClick={() =>
                  void tx
                    .run({
                      label: `Cancel $${l.symbol} raise`,
                      successMessage: "Raise cancelled — refunds are open",
                      build: async (payer) => [await client.cancelLaunchIx(payer, mint)],
                    })
                    .then(() => setConfirmCancel(false))
                }
              >
                Confirm cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="mt-2 w-full text-down/80 hover:text-down"
            icon={<XCircle className="size-4" aria-hidden />}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel raise
          </Button>
        )
      ) : null}
    </Card>
  );
}

export function RefundPanel({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const backer = useBackerAccount(l.mint, publicKey);
  const tx = useTx();
  const now = useNow();
  const deposited = backer.data?.deposited ?? 0n;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Undo2 className="size-4 text-warn" aria-hidden />
        <h2 className="text-[15px] font-semibold">Refunds open</h2>
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {phase === "refunding" && (l.raiseDeadline > now || BigInt(l.raised) >= BigInt(l.raiseMin))
          ? "The creator cancelled this raise."
          : `The raise missed its ${fmtLamports(l.raiseMin)} SOL minimum by the deadline.`}{" "}
        Every backer can withdraw their full deposit — nothing is deducted.
      </p>
      <div className="mt-4 grid gap-1.5">
        <Row label="Refunded so far">
          {fmtLamports(l.refunded)} / {fmtLamports(l.raised)} SOL
        </Row>
        <Row label="Your deposit">
          {!publicKey ? "—" : backer.isLoading ? "…" : `${fmtLamports(deposited)} SOL`}
        </Row>
      </div>
      <Button
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        icon={<Undo2 className="size-4" aria-hidden />}
        disabled={!!publicKey && deposited === 0n}
        loading={!!tx.pending}
        onClick={() =>
          publicKey
            ? void tx.run({
                label: `Refund $${l.symbol}`,
                successMessage: `Refunded ${fmtLamports(deposited)} SOL`,
                build: async (payer) => [await client.refundIx(payer, new PublicKey(l.mint))],
                invalidate: [["backer", l.mint]],
              })
            : setVisible(true)
        }
      >
        {!publicKey ? "Connect wallet" : deposited === 0n ? "No deposit to refund" : `Refund ${fmtLamports(deposited)} SOL`}
      </Button>
      {phase === "failed" ? (
        <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-dim">
          <Clock className="size-3" aria-hidden /> The first refund marks the raise as failed on-chain.
        </p>
      ) : null}
    </Card>
  );
}
