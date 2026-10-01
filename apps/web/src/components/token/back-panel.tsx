"use client";

import { buildWhitelist, previewBundle, previewPumpBundle, seedKeyOf, solToLamports } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useMemo, useState, type ReactNode } from "react";
import { useBackerAccount, useChainWhitelistRoot, useMoshClient, useSolBalance } from "@/lib/chain";
import { fmtLamports, fmtTokens, pctOf } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { launchId, type Phase } from "@/lib/launch";
import { usePlatform } from "@/lib/queries";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { RefundGlyph } from "../brand/glyphs";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { AmountInput } from "../ui/input";
import { fmtPct, Panel } from "./shared";

/** Rent for a new backer account is paid on first deposit; keep headroom for it and the fee. */
const DEPOSIT_HEADROOM = 5_000_000n;
/** Example deposit for "What you get" before an amount is typed. */
const EXAMPLE_DEPOSIT = 100_000_000n;

const minBig = (...v: bigint[]) => v.reduce((a, b) => (b < a ? b : a));
const solInput = (v: bigint) => (Number(v) / 1e9).toFixed(9).replace(/\.?0+$/, "");

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * "What you get" (§4.5): the deposit's share of the backer pool (fee share of every trade plus the
 * backers' share of the vault agent's realized profit and any wind-down payout), the vault slice it
 * funds at launch, and the refund guarantee — recomputed live from the typed amount.
 */
function WhatYouGet({ launch: l, deposited, add, example }: { launch: LaunchSummary; deposited: bigint; add: bigint | null; example: bigint }) {
  const extra = add ?? (deposited > 0n ? 0n : example);
  const mine = deposited + extra;
  const total = BigInt(l.raised) + extra;
  const pump = l.venue === "pump";
  const bundle = useMemo(() => {
    if (total <= 0n) return null;
    const terms = { raised: total, launchFeeBps: l.terms.launchFeeBps, reserveBps: l.reserveBps, bundleSupplyBps: l.bundleSupplyBps };
    return pump ? previewPumpBundle(terms) : previewBundle({ ...terms, virtualSol: BigInt(l.virtualSol) });
  }, [total, pump, l.virtualSol, l.terms.launchFeeBps, l.reserveBps, l.bundleSupplyBps]);
  if (mine === 0n || total === 0n) return null;
  const share = pctOf(mine, total);
  const feePctOfTrade = ((l.terms.tradeFeeBps * l.terms.backerFeeShareBps) / 1_000_000) * (share / 100);
  const profitPct = 100 - l.terms.burnShareBps / 100;
  const basis = add ? `for ${fmtLamports(mine)} SOL` : deposited > 0n ? "your deposit" : `e.g. ${fmtLamports(extra)} SOL`;
  return (
    <div className="grid gap-3 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-ink-3">What you get</span>
        <span className="small num text-ink-3">{basis}</span>
      </div>
      <dl className="small grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
          <dt className="text-ink-2">Backer share</dt>
          <dd className="num text-right text-ink">{fmtPct(share)} of backer payouts</dd>
          <dd className="col-span-2 mt-0.5 text-ink-3">
            {pump
              ? `Trades happen on pump.fun; ${profitPct}% of the vault agent's realized profit goes to backers (the rest buys and burns the Holdfast token), plus your share of any wind-down payout.`
              : `≈ ${+feePctOfTrade.toPrecision(2)}% of every trade while it trades, plus your share of 100% of the vault agent's profit and of any wind-down payout.`}{" "}
            One claim button. Shrinks as others back it.
          </dd>
        </div>
        {bundle ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
            <dt className="text-ink-2">Vault slice</dt>
            <dd className="num text-right text-ink">
              {fmtTokens((bundle.bundleTokens * mine) / total)} ${l.symbol}
            </dd>
            <dd className="col-span-2 mt-0.5 text-ink-3">
              + {fmtLamports((bundle.vaultSol * mine) / total)} SOL, held in the vault. Only the vault agent trades it; the platform
              multisig can withdraw it (every withdrawal is shown on the launch page).
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="small text-ink-2">
        100% refundable if the {fmtLamports(l.raiseMin)} SOL minimum isn&apos;t met by the deadline or the creator cancels.
      </p>
    </div>
  );
}

/**
 * Back this launch (§4.5 rail, raising): amount with 25/50/75/Max of what you can still put in,
 * "What you get", and the accent CTA. Whitelisted raises check your proof against the on-chain root.
 */
export function BackPanel({ launch: l, phase, bare, className }: { launch: LaunchSummary; phase: Phase; bare?: boolean; className?: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const platform = usePlatform();
  const sol = useSolBalance(publicKey);
  const backer = useBackerAccount(l, publicKey);
  const chainRoot = useChainWhitelistRoot(l, l.whitelisted);
  const tx = useTx();
  const [amount, setAmount] = useState("");

  const wl = useMemo(() => {
    if (!l.whitelisted) return null;
    if (!l.whitelist?.length) return { tree: null, error: "The member list isn't in the metadata" };
    try {
      return { tree: buildWhitelist(l.whitelist.map((a) => new PublicKey(a))), error: null };
    } catch {
      return { tree: null, error: "The member list is malformed" };
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
  // Same rule as the program: the stricter of the creator's cap and the platform beta cap (0 = none).
  const caps = [BigInt(l.maxPerWallet), BigInt(platform.data?.params.maxWalletDepositLamports ?? "0")].filter((c) => c > 0n);
  const cap = caps.length ? minBig(...caps) : 0n;
  const walletRoom = cap > 0n ? (cap > deposited ? cap - deposited : 0n) : null;
  const affordable = sol.data === undefined ? null : sol.data > DEPOSIT_HEADROOM ? sol.data - DEPOSIT_HEADROOM : 0n;
  /** The most this wallet can deposit now (raise room, wallet cap, balance). */
  const capLeft = minBig(room > 0n ? room : 0n, walletRoom ?? room, affordable ?? room);
  const effective = raw === null ? null : minBig(raw, room > 0n ? room : 0n, walletRoom ?? raw);
  const clipped = raw !== null && effective !== null && effective < raw;

  let reason: string | null = null;
  if (platform.data?.params.paused) reason = "The platform is paused";
  else if (phase !== "raising") reason = phase === "ready" ? "The raise is closed" : "The raise has ended";
  else if (room <= 0n) reason = "The raise is full";
  else if (publicKey && walletRoom === 0n) reason = "Wallet cap reached";
  else if (l.whitelisted && wl?.error) reason = wl.error;
  else if (l.whitelisted && rootMatches === false) reason = "Member list doesn't match the on-chain root";
  else if (publicKey && l.whitelisted && !proof) reason = "This wallet isn't on the whitelist";
  else if (!raw || raw <= 0n) reason = "Enter an amount";
  else if (publicKey && sol.data !== undefined && (effective ?? 0n) + DEPOSIT_HEADROOM > sol.data) reason = "Not enough SOL";

  const deposit = async () => {
    if (!effective) return;
    const sig = await tx.run({
      label: `Back $${l.symbol}`,
      successMessage: `Deposited ${fmtLamports(effective)} SOL into the $${l.symbol} raise`,
      build: async (payer) => [await client.depositIx(payer, seedKeyOf(l), effective, proof ?? [])],
      invalidate: [["backer", launchId(l)]],
    });
    if (sig) setAmount("");
  };

  const example = minBig(EXAMPLE_DEPOSIT, room > 0n ? room : EXAMPLE_DEPOSIT, walletRoom ?? EXAMPLE_DEPOSIT);

  return (
    <section
      id="back"
      aria-label="Back this launch"
      className={cn(!bare && "rounded-md border border-line bg-surface", "grid gap-4 p-4", className)}
    >
      <h2 className="h3 text-ink">Back this launch</h2>

      {l.whitelisted ? (
        <p className={cn("small", publicKey && (!proof || rootMatches === false) ? "text-warn" : "text-ink-2")}>
          {!publicKey
            ? `Whitelist raise: ${l.whitelist?.length ?? 0} wallets can back it.`
            : proof
              ? "This wallet is on the whitelist."
              : "This wallet isn't on the whitelist."}{" "}
          {rootMatches === null
            ? "Checking the member list against the on-chain root…"
            : rootMatches
              ? "Member list verified against the on-chain root."
              : "The member list doesn't match the on-chain root."}
        </p>
      ) : null}

      <AmountInput
        id={bare ? "back-amount-sheet" : "back-amount"}
        label="You deposit"
        value={amount}
        onChange={setAmount}
        unit="SOL"
        balance={publicKey && sol.data !== undefined ? `${fmtLamports(sol.data)} SOL` : undefined}
        disabled={phase !== "raising"}
        presets={
          publicKey && capLeft > 0n
            ? [25, 50, 75, 100].map((pct) => {
                const v = solInput((capLeft * BigInt(pct)) / 100n);
                return { label: pct === 100 ? "Max" : `${pct}%`, active: amount === v, onSelect: () => setAmount(v) };
              })
            : undefined
        }
      />

      {clipped && effective !== null ? (
        <p className="small text-warn">
          Only {fmtLamports(effective)} SOL will go in: the {walletRoom !== null && effective === walletRoom ? "per-wallet cap" : "raise max"} is
          reached after that.
        </p>
      ) : null}

      {phase === "raising" ? (
        <WhatYouGet launch={l} deposited={deposited} add={effective && effective > 0n ? effective : null} example={example} />
      ) : null}

      {publicKey && (deposited > 0n || walletRoom !== null) ? (
        <dl className="small grid gap-2">
          {deposited > 0n ? <Row label="Your deposit">{fmtLamports(deposited)} SOL</Row> : null}
          {walletRoom !== null ? <Row label="Wallet cap left">{fmtLamports(walletRoom)} SOL</Row> : null}
        </dl>
      ) : null}

      {publicKey ? (
        <Button variant="accent" size="lg" className="w-full" disabled={!!reason} busy={!!tx.pending} onClick={() => void deposit()}>
          {tx.stage ? TX_STAGE_LABEL[tx.stage] : (reason ?? `Back with ${fmtLamports(effective ?? 0n)} SOL`)}
        </Button>
      ) : (
        <Button variant="accent" size="lg" className="w-full" onClick={() => setVisible(true)}>
          Connect wallet
        </Button>
      )}
    </section>
  );
}

/**
 * Launch controls (§4.5 min reached / launchable): "Launch now" for the creator once the minimum is
 * met, and for any wallet once the deadline passed or the raise is full; the creator can also cancel.
 * Pump launches create their token on pump.fun in the same transaction, signed by a fresh mint
 * keypair generated per click (pump.fun needs the mint to sign; it has no authority afterwards).
 */
export function LaunchPanel({ launch: l, phase, className }: { launch: LaunchSummary; phase: Phase; className?: string }) {
  const { publicKey } = useWallet();
  const client = useMoshClient();
  const tx = useTx();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const isCreator = publicKey?.toBase58() === l.creator;
  const minMet = BigInt(l.raised) >= BigInt(l.raiseMin);
  if (phase !== "raising" && phase !== "ready") return null;
  const canLaunch = minMet && (phase === "ready" || isCreator);
  if (!canLaunch && !isCreator) return null;
  const pump = l.venue === "pump";
  const launchLabel = `Launch $${l.symbol}`;
  const cancelLabel = `Cancel $${l.symbol} raise`;

  return (
    <Panel title={isCreator ? "Creator controls" : "Ready to launch"} className={className}>
      <div className="grid gap-3 px-4 pb-4">
        <p className="small text-ink-2">
          Launching {pump ? "creates the token on pump.fun and " : ""}buys the bundle before anyone can trade. Any wallet can trigger it.
        </p>
        {canLaunch ? (
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            busy={tx.pending === launchLabel}
            disabled={!!tx.pending && tx.pending !== launchLabel}
            onClick={() => {
              const mint = pump ? Keypair.generate() : null;
              void tx.run({
                label: launchLabel,
                successMessage: `$${l.symbol} is live. The bundle is in the vault.`,
                signers: mint ? [mint] : undefined,
                build: async (payer) => [
                  mint
                    ? await client.launchPumpIx({ cranker: payer, launch: new PublicKey(l.address), mint: mint.publicKey })
                    : await client.launchIx(payer, seedKeyOf(l)),
                ],
              });
            }}
          >
            {tx.pending === launchLabel && tx.stage ? TX_STAGE_LABEL[tx.stage] : "Launch now"}
          </Button>
        ) : (
          <p className="small text-ink-3">You can launch once the {fmtLamports(l.raiseMin)} SOL minimum is met.</p>
        )}
        {isCreator && phase === "raising" ? (
          confirmCancel ? (
            <div className="grid gap-3 rounded-sm border border-line p-3">
              <p className="small text-ink">Cancelling is permanent. Every backer can then refund their full deposit.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(false)}>
                  Keep raising
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  busy={tx.pending === cancelLabel}
                  onClick={() =>
                    void tx
                      .run({
                        label: cancelLabel,
                        successMessage: "Raise cancelled. Refunds are open.",
                        build: async (payer) => [await client.cancelLaunchIx(payer, seedKeyOf(l))],
                      })
                      .then(() => setConfirmCancel(false))
                  }
                >
                  Cancel raise
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setConfirmCancel(true)}>
              Cancel raise…
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}

/** Refunds (§4.5 refunding): the connected backer's "Refund 0.5 SOL", everything else read-only. */
export function RefundPanel({ launch: l, phase, className }: { launch: LaunchSummary; phase: Phase; className?: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
  const backer = useBackerAccount(l, publicKey);
  const tx = useTx();
  const deposited = backer.data?.deposited ?? 0n;
  const allRefunded = BigInt(l.raised) > 0n && BigInt(l.refunded) >= BigInt(l.raised);
  return (
    <Panel title="Refunds" className={className}>
      <div className="grid gap-4 px-4 pb-4">
        <dl className="small grid gap-2">
          <Row label="Refunded so far">
            {fmtLamports(l.refunded)} / {fmtLamports(l.raised)} SOL
          </Row>
          {publicKey ? <Row label="Your deposit">{backer.isLoading ? "…" : `${fmtLamports(deposited)} SOL`}</Row> : null}
        </dl>
        {allRefunded && deposited === 0n ? (
          <p className="small text-ink-2">Every deposit has been refunded.</p>
        ) : publicKey ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            icon={<RefundGlyph />}
            disabled={deposited === 0n}
            busy={!!tx.pending}
            onClick={() =>
              void tx.run({
                label: `Refund $${l.symbol}`,
                successMessage: `Refunded ${fmtLamports(deposited)} SOL`,
                build: async (payer) => [await client.refundIx(payer, seedKeyOf(l))],
                invalidate: [["backer", launchId(l)]],
              })
            }
          >
            {tx.stage ? TX_STAGE_LABEL[tx.stage] : deposited === 0n ? "Nothing to refund" : `Refund ${fmtLamports(deposited)} SOL`}
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={() => setVisible(true)}>
            Connect wallet to refund
          </Button>
        )}
        {phase === "failed" ? <p className="micro text-ink-3">The first refund marks the raise as failed on-chain.</p> : null}
      </div>
    </Panel>
  );
}

/** Why the raise ended, for the refunding banner. */
export function useRefundReason(l: LaunchSummary): string {
  const now = useNow(60_000);
  const cancelled = l.status === "refunding" && (l.raiseDeadline > now || BigInt(l.raised) >= BigInt(l.raiseMin));
  return cancelled
    ? "The creator cancelled this raise. Every backer can refund 100%."
    : "This raise missed its minimum. Every backer can refund 100%.";
}
