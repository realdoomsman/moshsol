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
import { useMoshClient, useWindDownBlocker } from "@/lib/chain";
import { fmtLamports, fmtSolValue, fmtTokens } from "@/lib/format";
import { launchId, VENUE_LABEL, venueKindOf } from "@/lib/launch";
import { useVaultWithdrawals } from "@/lib/queries";
import { humanError, TX_STAGE_LABEL, useTx } from "@/lib/tx";
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
  const venue = l.venue === "pump" ? "venue" : "curve";
  switch (blocker) {
    case "notLive":
      return "Only a live launch can wind down.";
    case "tooYoung":
      return `${opens}: a launch must be live ${MIN_AGE_DAYS} days first.`;
    case "recentTrade":
      return `${opens}: it needs ${IDLE_HOURS} h without a trade.`;
    case "outsideHolders":
      return `Not now: wallets outside the ${venue} and vault still hold $${l.symbol}. Every token has to be back in the ${venue} or vault (or burned).`;
  }
}

/**
 * Wind-down (§4.5 rail). Live: the rules, when they open, and a "Wind down" button for any wallet
 * once `windDownBlocker` (status, age, idle time, real token balances) returns null. Wound down:
 * when it happened, the SOL credited to backers and the tokens returned to the curve (Holdfast) or
 * sold into the venue (pump).
 */
export function WindDownCard({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMoshClient();
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
            Trading on Holdfast has ended for good. The {pump ? "vault's tokens were sold into the venue and the proceeds plus the vault SOL" : "curve and vault SOL"} were
            credited to the backers; each backer collects their share with the claim button under Your position.
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
            <Row label="Vault agent profit to backers">{fmtSolValue(l.profitSharedSol)} SOL</Row>
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
  else if (chain.isError) status = <p className="small text-warn">Couldn&apos;t check the token balances. {humanError(chain.error)}</p>;
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
            successMessage: `$${l.symbol} wound down. ${pump ? "The vault was sold into the venue and the SOL is" : "The curve and vault SOL are"} credited to backers.`,
            build: async (payer) => [pump ? await client.windDownPumpIx(payer, pumpRefOf(l)) : await client.windDownIx(payer, seedKeyOf(l))],
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
          Once this launch is {MIN_AGE_DAYS} days old, has gone {IDLE_HOURS} h without a trade and nobody outside the{" "}
          {pump ? VENUE_LABEL[venueKindOf(l)] : "curve"} and vault holds ${l.symbol}, any wallet can wind it down:{" "}
          {pump
            ? "the vault's tokens are sold into the venue and the proceeds plus the vault SOL are credited to backers; the buyback pool stays for the crank."
            : "vault tokens go back to the curve, the curve and vault SOL are credited to backers, and trading stops for good."}
        </p>
        {status}
      </div>
    </Panel>
  );
}

/**
 * Admin withdrawals (§4.5 rail): every `admin_withdraw_vault` the platform multisig made from this
 * launch's vault — SOL, tokens, recipient and transaction — from the indexer's `vault_withdrawn` events.
 */
export function AdminWithdrawals({ launch: l, now, className }: { launch: LaunchSummary; now: number; className?: string }) {
  const q = useVaultWithdrawals(launchId(l));
  const rows = q.data?.events ?? [];
  const tokens = BigInt(l.vaultWithdrawnTokens);
  return (
    <Panel
      title="Admin withdrawals"
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
          The platform multisig can withdraw vault SOL and tokens with admin_withdraw_vault. It can&apos;t touch the curve&apos;s
          liquidity. Every withdrawal is on-chain and listed here.
        </p>
        {q.error && !q.data ? (
          <ErrorState onRetry={() => void q.refetch()} retrying={q.isFetching}>
            Couldn&apos;t load withdrawals. {q.error.message}
          </ErrorState>
        ) : q.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState>No admin withdrawals</EmptyState>
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
                  to <Address address={e.actor} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
