"use client";

import {
  pumpRefOf,
  seedKeyOf,
  WIND_DOWN_IDLE_SECS,
  WIND_DOWN_MIN_AGE_SECS,
  windDownOpensAt,
  windDownTimingBlocker,
  type WindDownBlocker,
} from "@holdfast/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";
import { useLoadMoshClient, useWindDownBlocker } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { launchId, VENUE_LABEL, venueKindOf } from "@/lib/launch";
import { pumpSplit } from "@/lib/pump-terms";
import { useVaultWithdrawals } from "@/lib/queries";
import { TX_STAGE_LABEL, useTx } from "@/lib/tx";
import type { LaunchSummary } from "@/lib/types";
import { Address } from "../ui/address";
import { Button } from "../ui/button";
import { StatusChip } from "../ui/chip";
import { formatCountdown } from "../ui/countdown";
import { EmptyState, ErrorState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { Panel, RelativeTime, TxLink } from "./shared";

const MIN_AGE_DAYS = WIND_DOWN_MIN_AGE_SECS / 86_400;
const IDLE_HOURS = WIND_DOWN_IDLE_SECS / 3_600;

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num text-right text-ink">{children}</dd>
    </div>
  );
}

function blockerText(blocker: WindDownBlocker, l: LaunchSummary, now: number): string {
  const opens = `Opens in ${formatCountdown(windDownOpensAt(l) - now)}`;
  const venue = l.venue === "pump" ? "pump.fun" : "the curve";
  switch (blocker) {
    case "notLive":
      return "Only a live launch can wind down.";
    case "tooYoung":
      return `${opens}: a launch must be live ${MIN_AGE_DAYS} days first.`;
    case "recentTrade":
      return `${opens}: it needs ${IDLE_HOURS} h without a vault trade.`;
    case "outsideHolders":
      return `Not now: wallets outside the vault and ${venue} still hold more than ${pumpSplit(l.terms).deadHoldersPct}% of $${l.symbol}. It opens once they hold ${pumpSplit(l.terms).deadHoldersPct}% of supply or less.`;
  }
}

/**
 * Wind-down (§4.5 rail). Live: the rules, when they open, and a "Wind down" button for any wallet
 * once `windDownBlocker` (status, age, idle time, real token balances) returns null. Wound down:
 * when it happened, the SOL credited to backers and the tokens sold into the venue (pump) or
 * returned to the curve (Holdfast).
 */
export function WindDownCard({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const loadClient = useLoadMoshClient();
  const tx = useTx();
  const timing = windDownTimingBlocker(l, now);
  // Balances are only worth reading once the clock rules pass (the SDK checks those first anyway).
  const chain = useWindDownBlocker(l, l.status === "live" && timing === null);
  const pump = l.venue === "pump";

  if (l.status === "woundDown") {
    const w = l.woundDown;
    return (
      <Panel title="Wind-down" aside={<StatusChip status="woundDown" />} className={className}>
        <div className="grid gap-4 px-4 pb-4">
          <p className="small text-ink-2">
            {pump
              ? `The vault sold what it held; all vault SOL${w ? ` (${fmtSolValue(w.solToBackers)} SOL)` : ""} was credited to backers, pro-rata to their deposits.`
              : `Trading on Holdfast has ended for good. The curve and vault SOL${w ? ` (${fmtSolValue(w.solToBackers)} SOL)` : ""} were credited to backers, pro-rata to their deposits.`}{" "}
            Each backer collects their share with the claim button under Your position.
          </p>
          <dl className="small grid gap-2">
            {w ? (
              <>
                <Row label="Wound down">
                  <span className="inline-flex items-center gap-2">
                    <span>
                      <RelativeTime ts={w.timestamp} now={now} /> ago
                    </span>
                    <TxLink signature={w.signature} />
                  </span>
                </Row>
                <Row label="Credited to backers">{fmtSolValue(w.solToBackers)} SOL</Row>
                <Row label={pump ? "Sold into the venue" : "Returned to the curve"}>
                  {fmtTokens(w.tokensReturned)} ${l.symbol}
                </Row>
              </>
            ) : null}
          </dl>
        </div>
      </Panel>
    );
  }
  if (l.status !== "live") return null;

  const blocker = timing ?? chain.data;
  const label = `Wind down $${l.symbol}`;
  let status: ReactNode;
  if (blocker) status = <p className="small text-ink-3">{blockerText(blocker, l, now)}</p>;
  else if (chain.isError) status = <p className="small text-warn">Couldn&apos;t check the token balances. {chain.error.message}</p>;
  else if (blocker === undefined) status = <p className="small text-ink-3">Checking token balances…</p>;
  else if (!publicKey) {
    status = (
      <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setVisible(true)}>
        Connect wallet to wind down
      </Button>
    );
  } else {
    status = (
      <Button
        variant="secondary"
        size="sm"
        className="justify-self-start"
        busy={tx.pending === label}
        disabled={!!tx.pending && tx.pending !== label}
        onClick={() =>
          void tx.run({
            label,
            successMessage: `$${l.symbol} wound down. ${pump ? "The vault sold what it held and all vault SOL is" : "The curve and vault SOL are"} credited to backers.`,
            build: async (payer) => {
              const client = await loadClient();
              return [pump ? await client.windDownPumpIx(payer, pumpRefOf(l)) : await client.windDownIx(payer, seedKeyOf(l))];
            },
            invalidate: [["backer", launchId(l)], ["wind-down", launchId(l)]],
          })
        }
      >
        {tx.pending === label && tx.stage ? TX_STAGE_LABEL[tx.stage] : "Wind down"}
      </Button>
    );
  }

  return (
    <Panel title="Wind-down" className={className}>
      <div className="grid gap-3 px-4 pb-4">
        <p className="small text-ink-2">
          Once this launch is {MIN_AGE_DAYS}&nbsp;days old, the vault has gone {IDLE_HOURS}&nbsp;h without a trade and wallets outside the vault and{" "}
          {pump ? VENUE_LABEL[venueKindOf(l)] : "the curve"} hold {pumpSplit(l.terms).deadHoldersPct}% of ${l.symbol} or less, any wallet can wind it down:{" "}
          {pump
            ? "the vault sells what it holds and all vault SOL goes to backers, pro-rata. That can be less than they put in; it's the worst case."
            : "vault tokens go back to the curve, the curve and vault SOL go to backers, pro-rata, and trading stops for good."}
        </p>
        {status}
      </div>
    </Panel>
  );
}

/**
 * Vault withdrawals (§4.5 rail): every `admin_withdraw_vault` the platform multisig and every `dev_withdraw_vault`
 * the dev key made from this launch's vault — SOL, tokens, who, recipient and transaction — from the indexer's
 * `vault_withdrawn` events (`ref` "dev" on the dev key's).
 */
export function VaultWithdrawals({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const q = useVaultWithdrawals(launchId(l));
  const rows = q.data?.events ?? [];
  const tokens = BigInt(l.vaultWithdrawnTokens);
  return (
    <Panel
      title="Vault withdrawals"
      aside={
        l.vaultWithdrawnSol > 0 || tokens > 0n ? (
          <span className="small num text-ink-3">
            {fmtSolValue(l.vaultWithdrawnSol)} SOL{tokens > 0n ? ` + ${fmtTokens(tokens)} $${l.symbol}` : ""} total
          </span>
        ) : null
      }
      className={className}
    >
      <div className="grid gap-3 px-4 pb-4">
        <p className="small text-ink-3">
          The admin (a 2-of-3 Squads multisig, admin_withdraw_vault) and a single dev key (dev_withdraw_vault, to its own wallet)
          can withdraw vault SOL and tokens. Neither can touch{" "}
          {l.venue === "pump" ? "the token's liquidity on pump.fun" : "the curve's liquidity"}. Every withdrawal is on-chain and listed here.
        </p>
        {q.error && !q.data ? (
          <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching}>
            Couldn&apos;t load withdrawals. {q.error.message}
          </ErrorState>
        ) : q.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState>No vault withdrawals</EmptyState>
        ) : (
          <ul className="small grid gap-2">
            {rows.map((e) => (
              <li key={e.id} className="grid gap-0.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num text-ink">
                    {fmtLamports(e.solAmount ?? "0")} SOL
                    {e.tokenAmount && BigInt(e.tokenAmount) > 0n ? ` + ${fmtTokens(e.tokenAmount)} $${l.symbol}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-2 text-ink-3">
                    <RelativeTime ts={e.timestamp} now={now} />
                    <TxLink signature={e.signature} />
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-ink-3">
                  {e.ref === "dev" ? "Withdrawn by the dev key" : "Withdrawn by the admin"}, to <Address address={e.actor} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
