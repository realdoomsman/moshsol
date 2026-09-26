"use client";

import { buildWhitelist, fmtPrice, lamportsToSol, previewBundle, solToLamports } from "@moshsol/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, CheckCircle2, Clock, Lock, Rocket, ShieldCheck, Undo2, Users, XCircle } from "lucide-react";
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
import { AnimatedNumber, Countdown } from "../ui/interactive";
import { Card, CardHeader, Row } from "../ui/primitives";
import { RaiseBar } from "./raise-bar";

/** Rent for a new backer account is paid on first deposit; keep headroom for it and the fee. */
const DEPOSIT_HEADROOM = 5_000_000n;

export function RaiseHero({ launch: l, phase }: { launch: LaunchSummary; phase: Phase }) {
  const raised = lamportsToSol(l.raised);
  const minPct = pctOf(l.raiseMin, l.raiseMax);
  const failed = phase === "failed" || phase === "refunding";
  return (
    <Card className="overflow-hidden p-5 sm:p-7">
      <div className="pointer-events-none absolute -top-24 left-1/3 size-72 rounded-full bg-violet/15 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">Raised</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
            <AnimatedNumber value={raised} format={fmtSolValue} />
            <span className="ml-2 text-lg font-medium text-dim sm:text-xl">/ {fmtLamports(l.raiseMax)} SOL</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
            {phase === "raising" ? "Closes in" : "Status"}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {phase === "raising" ? (
              <Countdown to={l.raiseDeadline} />
            ) : phase === "ready" ? (
              <span className="text-lime">Ready</span>
            ) : phase === "refunding" ? (
              <span className="text-warn">Refunding</span>
            ) : (
              <span className="text-down">Failed</span>
            )}
          </div>
        </div>
      </div>
      <div className="relative mt-6">
        <RaiseBar raised={l.raised} raiseMin={l.raiseMin} raiseMax={l.raiseMax} size="lg" failed={failed} />
        <div className="relative mt-2 h-8 text-xs tabular-nums">
          <span className="absolute left-0 text-dim">0</span>
          {minPct > 8 && minPct < 88 ? (
            <span className="absolute -translate-x-1/2 text-center" style={{ left: `${minPct}%` }}>
              <span className="block font-semibold text-muted">min {fmtLamports(l.raiseMin)}</span>
              <span className="block text-dim">launchable</span>
            </span>
          ) : null}
          <span className="absolute right-0 text-right">
            <span className="block font-semibold text-muted">max {fmtLamports(l.raiseMax)}</span>
            <span className="block text-dim">auto-closes</span>
          </span>
        </div>
      </div>
      <div className="relative mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
        <div>
          <div className="text-xs text-dim">Backers</div>
          <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold tabular-nums">
            <Users className="size-4 text-dim" aria-hidden /> {l.backerCount}
          </div>
        </div>
        <div>
          <div className="text-xs text-dim">Minimum</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {BigInt(l.raised) >= BigInt(l.raiseMin) ? (
              <span className="inline-flex items-center gap-1.5 text-lime">
                <CheckCircle2 className="size-4" aria-hidden /> met
              </span>
            ) : (
              `${fmtLamports(BigInt(l.raiseMin) - BigInt(l.raised))} to go`
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
              className="h-7 rounded-lg border border-line bg-white/[0.03] text-xs font-semibold text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40"
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

      <div className="mt-3 grid gap-1.5">
        <Row label="Your deposit">{fmtLamports(deposited)} SOL</Row>
        <Row label="Share after deposit">
          {(() => {
            const add = effective ?? 0n;
            const total = BigInt(l.raised) + add;
            return total > 0n ? `${pctOf(deposited + add, total).toFixed(2)}%` : "—";
          })()}
        </Row>
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
      <p className="mt-2.5 text-center text-[11.5px] leading-relaxed text-dim">
        Full refund if the minimum isn&apos;t met by the deadline or the creator cancels.
      </p>
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
