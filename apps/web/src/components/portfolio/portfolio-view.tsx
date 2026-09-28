"use client";

import { lamportsToSol } from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useMoshClient, useSolBalance } from "@/lib/chain";
import { fmtLamports, fmtSolValue } from "@/lib/format";
import { useMounted, useNow } from "@/lib/hooks";
import { usePortfolio } from "@/lib/queries";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import type { PortfolioBacked, PortfolioCreated } from "@/lib/types";
import { userActivityQuery, userQuery } from "@/lib/users";
import { Address } from "../ui/address";
import { Button, ButtonLink } from "../ui/button";
import { Chip } from "../ui/chip";
import { ErrorState } from "../ui/empty-state";
import { Identicon } from "../ui/identicon";
import { Skeleton } from "../ui/skeleton";
import { Stat, StatRow } from "../ui/stat";
import { Tabs } from "../ui/tabs";
import { displayName } from "../wallet-peek/wallet-peek";
import { WalletLookup } from "./lookup";
import {
  ActivityPanel,
  BackedPanel,
  claimBackerLabel,
  claimCreatorLabel,
  CreatedPanel,
  HoldingsPanel,
  RefundsPanel,
  refundLabel,
  type PositionActions,
} from "./positions";

/** Claim instructions per transaction; each claim is small, this keeps well inside size/CU limits. */
const CLAIMS_PER_TX = 6;
const CLAIM_ALL = "Claim all";

type Tab = "backed" | "created" | "refunds" | "holdings" | "activity";

/** Zeros are real values, but they shouldn't read as loudly as the numbers this wallet has (§5.3). */
function quiet(nonZero: boolean, text: string): ReactNode {
  return nonZero ? text : <span className="text-ink-3">{text}</span>;
}

/**
 * Disconnected with no lookup (§4.7): one sentence, Connect, and "or look up any wallet". Also the
 * landing for a `?wallet=` that isn't an address.
 */
function Disconnected({ badLookup, connected }: { badLookup: boolean; connected: boolean }) {
  const { setVisible } = useWalletModal();
  return (
    <div className="mx-auto grid w-full max-w-[480px] justify-items-center gap-5 py-16 text-center md:py-24">
      <h1 className="display-m text-ink">Portfolio</h1>
      {badLookup ? (
        <p className="body-l text-ink-2">That isn&apos;t a Solana wallet address. Check it and look it up again.</p>
      ) : (
        <p className="body-l text-ink-2">Connect a wallet to see your positions.</p>
      )}
      {connected ? (
        <ButtonLink href="/portfolio" variant="primary" size="lg">
          Your portfolio
        </ButtonLink>
      ) : (
        <Button variant="primary" size="lg" onClick={() => setVisible(true)}>
          Connect wallet
        </Button>
      )}
      <div className="mt-6 w-full border-t border-line pt-6 text-left">
        <WalletLookup label={badLookup ? "Look up a wallet" : "Or look up any wallet"} />
      </div>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="grid gap-6" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="grid gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}

/**
 * Portfolio (§4.7): header, 4-cell summary with Claim all, and Backed · Created · Refunds ·
 * Holdings · Activity. `lookup` shows any wallet read-only (`/portfolio?wallet=`); without it the
 * connected wallet's positions are shown with their claim/refund actions.
 */
export function PortfolioView({ lookup, badLookup }: { lookup: string | null; badLookup: boolean }) {
  const mounted = useMounted();
  const { publicKey, connecting } = useWallet();
  const connected = mounted ? (publicKey?.toBase58() ?? null) : null;
  const wallet = badLookup ? null : (lookup ?? connected);
  const own = !!wallet && wallet === connected;

  if (!wallet) {
    return (mounted && !connecting) || badLookup ? (
      <Disconnected badLookup={badLookup} connected={!!connected} />
    ) : (
      <PortfolioSkeleton />
    );
  }
  return <WalletPortfolio key={wallet} wallet={wallet} own={own} lookup={!!lookup} connected={!!connected} />;
}

function WalletPortfolio({ wallet, own, lookup, connected }: { wallet: string; own: boolean; lookup: boolean; connected: boolean }) {
  const portfolio = usePortfolio(wallet);
  const user = useQuery(userQuery(wallet));
  const activity = useQuery(userActivityQuery(wallet));
  const owner = useMemo(() => new PublicKey(wallet), [wallet]);
  const balance = useSolBalance(owner);
  const client = useMoshClient();
  const tx = useTx();
  const now = useNow(10_000);
  const [tab, setTab] = useState<Tab | null>(null);
  const [claimProgress, setClaimProgress] = useState<{ done: number; total: number } | null>(null);

  const data = portfolio.data;
  const split = useMemo(() => {
    if (!data) return null;
    const backed = data.backed.filter((b) => !b.refundable);
    const refundable = data.backed.filter((b) => b.refundable && BigInt(b.deposited) > 0n);
    const claimableBacker = data.backed.filter((b) => BigInt(b.claimable) > 0n);
    const claimableCreator = data.created.filter((c) => BigInt(c.creatorFeesUnclaimed) > 0n);
    const backerClaimable = claimableBacker.reduce((a, b) => a + BigInt(b.claimable), 0n);
    const creatorClaimable = claimableCreator.reduce((a, c) => a + BigInt(c.creatorFeesUnclaimed), 0n);
    return {
      backed,
      refundable,
      claimableBacker,
      claimableCreator,
      creatorClaimable,
      totalClaimable: backerClaimable + creatorClaimable,
      deposited: backed.reduce((a, b) => a + BigInt(b.deposited), 0n),
      holdingsValue: data.holdings.reduce((a, h) => a + h.valueSol, 0),
    };
  }, [data]);
  const refunded = (activity.data?.events ?? []).filter((e) => e.type === "refund");

  const invalidate = (mint?: string) => [["backer", ...(mint ? [mint] : [])], ["portfolio", wallet], ["user", wallet]];

  const actions: PositionActions = {
    own,
    pending: tx.pending,
    stage: tx.stage,
    claimBacker: (b: PortfolioBacked) =>
      void tx.run({
        label: claimBackerLabel(b.launch),
        successMessage: `Claimed ${fmtLamports(b.claimable)} SOL`,
        build: async (payer) => [await client.claimBackerFeesIx(payer, new PublicKey(b.launch.mint))],
        invalidate: invalidate(b.launch.mint),
      }),
    claimCreator: (c: PortfolioCreated) =>
      void tx.run({
        label: claimCreatorLabel(c.launch),
        successMessage: `Claimed ${fmtLamports(c.creatorFeesUnclaimed)} SOL`,
        build: async (payer) => [await client.claimCreatorFeesIx(payer, new PublicKey(c.launch.mint))],
        invalidate: invalidate(),
      }),
    refund: (b: PortfolioBacked) =>
      void tx.run({
        label: refundLabel(b.launch),
        successMessage: `Refunded ${fmtLamports(b.deposited)} SOL`,
        build: async (payer) => [await client.refundIx(payer, new PublicKey(b.launch.mint))],
        invalidate: invalidate(b.launch.mint),
      }),
  };

  const claimAll = async () => {
    if (!split) return;
    const jobs: ((payer: PublicKey) => Promise<TransactionInstruction>)[] = [
      ...split.claimableBacker.map((b) => (payer: PublicKey) => client.claimBackerFeesIx(payer, new PublicKey(b.launch.mint))),
      ...split.claimableCreator.map((c) => (payer: PublicKey) => client.claimCreatorFeesIx(payer, new PublicKey(c.launch.mint))),
    ];
    const batches = Math.ceil(jobs.length / CLAIMS_PER_TX);
    const total = split.totalClaimable;
    try {
      for (let i = 0; i < batches; i++) {
        const chunk = jobs.slice(i * CLAIMS_PER_TX, (i + 1) * CLAIMS_PER_TX);
        setClaimProgress({ done: i, total: batches });
        const sig = await tx.run({
          label: batches > 1 ? `${CLAIM_ALL} (${i + 1}/${batches})` : CLAIM_ALL,
          successMessage: batches > 1 ? `Claimed batch ${i + 1} of ${batches}` : `Claimed ${fmtLamports(total)} SOL in fees`,
          computeUnits: 400_000,
          build: async (payer) => Promise.all(chunk.map((make) => make(payer))),
          invalidate: invalidate(),
        });
        if (!sig) break;
      }
    } finally {
      setClaimProgress(null);
    }
  };

  if (portfolio.isLoading) return <PortfolioSkeleton />;

  const u = user.data;
  const name = displayName(wallet, u?.name);
  const claimCount = split ? split.claimableBacker.length + split.claimableCreator.length : 0;
  const claimBusy = claimProgress !== null;
  const claimLabel = claimProgress
    ? claimProgress.total > 1
      ? `Claiming ${claimProgress.done + 1} of ${claimProgress.total}…`
      : tx.stage
        ? TX_STAGE_LABEL[tx.stage]
        : "Claiming…"
    : `Claim all · ${fmtLamports(split?.totalClaimable ?? 0n)} SOL`;
  // Nothing claimable: the quiet "0 SOL" says it; no dead button next to it.
  const claimButton =
    own && (claimCount > 0 || claimBusy) ? (
      <Button
        variant="accent"
        busy={claimBusy}
        disabled={tx.pending !== null && !claimBusy}
        onClick={() => void claimAll()}
        className="w-full md:w-auto"
      >
        {claimLabel}
      </Button>
    ) : null;

  const counts = split && data
    ? {
        backed: split.backed.length,
        created: data.created.length,
        refunds: split.refundable.length + refunded.length,
        holdings: data.holdings.length,
      }
    : null;
  const firstFilled: Tab =
    counts === null
      ? "backed"
      : counts.backed
        ? "backed"
        : counts.holdings
          ? "holdings"
          : counts.created
            ? "created"
            : counts.refunds
              ? "refunds"
              : (activity.data?.events.length ?? 0) > 0
                ? "activity"
                : "backed";
  const current = tab ?? firstFilled;

  return (
    // `minmax(0, 1fr)`: the tab bar scrolls instead of widening the page on phones.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 items-center gap-4">
          <Identicon address={wallet} src={u?.avatar} size={48} />
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="h1 min-w-0 truncate text-ink">{name}</h1>
              {lookup && !own ? <Chip tone="muted">Read-only</Chip> : null}
            </div>
            <div className="small flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-3">
              <Address address={wallet} />
              <span className="num">
                {balance.data !== undefined ? `${fmtSolValue(lamportsToSol(balance.data))} SOL` : "— SOL"}
              </span>
              {own ? (
                <ButtonLink href={`/u/${wallet}?edit=1`} size="sm" variant="ghost">
                  Edit profile
                </ButtonLink>
              ) : (
                <ButtonLink href={`/u/${wallet}`} size="sm" variant="ghost" arrow>
                  View profile
                </ButtonLink>
              )}
              {lookup && !own && connected ? (
                <ButtonLink href="/portfolio" size="sm" variant="ghost">
                  Your portfolio
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </div>
        <WalletLookup className="w-full md:w-[400px]" />
      </header>

      {portfolio.isError || !data || !split ? (
        <ErrorState onRetry={() => void portfolio.refetch()} retrying={portfolio.isFetching}>
          Couldn&apos;t load positions. Indexer unreachable.
        </ErrorState>
      ) : (
        <>
          <section aria-label="Summary" className="grid gap-3">
            {/* One value size across the strip so the baselines line up; zeros step back to `ink-3`. */}
            <StatRow className="rounded-md border-x bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Stat
                  label="Claimable"
                  rule="Backer fees plus creator fees you can claim right now."
                  tone={split.totalClaimable > 0n ? "accent" : undefined}
                  value={quiet(split.totalClaimable > 0n, `${fmtLamports(split.totalClaimable)} SOL`)}
                  sub={claimCount > 0 ? `${claimCount} ${claimCount === 1 ? "position" : "positions"}` : undefined}
                />
                <div className="hidden self-center md:block">{claimButton}</div>
              </div>
              <Stat
                label="Holdings value"
                rule="Tokens you hold, valued at the live curve price."
                value={quiet(split.holdingsValue > 0, `${fmtSolValue(split.holdingsValue)} SOL`)}
                sub={`${data.holdings.length} ${data.holdings.length === 1 ? "token" : "tokens"}`}
              />
              <Stat
                label="Deposited as backer"
                rule="SOL deposited into raises that launched or are still open (refundable deposits excluded)."
                value={quiet(split.deposited > 0n, `${fmtLamports(split.deposited)} SOL`)}
                sub={`${split.backed.length} ${split.backed.length === 1 ? "launch" : "launches"}`}
              />
              <Stat
                label="Creator fees claimable"
                rule="Your creator share of trade fees on the launches you created, not yet claimed."
                value={quiet(split.creatorClaimable > 0n, `${fmtLamports(split.creatorClaimable)} SOL`)}
                sub={`${data.created.length} created`}
              />
            </StatRow>
            {claimButton ? <div className="md:hidden">{claimButton}</div> : null}
          </section>
          <section className="rounded-md border border-line bg-surface">
            <Tabs
              label="Positions"
              value={current}
              onChange={setTab}
              className="px-4"
              items={[
                { value: "backed", label: "Backed", count: counts!.backed },
                { value: "created", label: "Created", count: counts!.created },
                { value: "refunds", label: "Refunds", count: counts!.refunds },
                { value: "holdings", label: "Holdings", count: counts!.holdings },
                { value: "activity", label: "Activity" },
              ]}
            />
            <div role="tabpanel" aria-label={current}>
              {current === "backed" ? (
                <BackedPanel rows={split.backed} actions={actions} now={now} />
              ) : current === "created" ? (
                <CreatedPanel rows={data.created} actions={actions} now={now} />
              ) : current === "refunds" ? (
                <RefundsPanel rows={split.refundable} refunded={refunded} actions={actions} now={now} />
              ) : current === "holdings" ? (
                <HoldingsPanel rows={data.holdings} />
              ) : (
                <ActivityPanel wallet={wallet} now={now} />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
