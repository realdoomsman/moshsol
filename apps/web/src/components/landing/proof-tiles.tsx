import { PROGRAM_ID, shortAddr, vaultPda } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { explorerAddress } from "@/lib/explorer";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { LaunchSummary, PlatformInfo } from "@/lib/types";
import { VerifyGlyph } from "../brand/glyphs";
import { pctFromBps } from "../band/model";
import type { ChainFacts } from "./chain-facts";

interface Tile {
  title: string;
  detail: ReactNode;
  address: string | null;
}

/**
 * Six proof tiles under the instruction list (§4.2 §6, Stripe's compliance tiles but flat): each is
 * a fact read from chain or the indexer with an explorer link to the account that proves it.
 */
export function ProofTiles({
  facts,
  platform,
  example,
}: {
  facts: ChainFacts;
  platform: PlatformInfo | null;
  example: LaunchSummary | null;
}) {
  const program = PROGRAM_ID.toBase58();
  const upgrade = facts.upgradeAuthority;
  const mint = facts.mint;
  const vault = example ? vaultPda(new PublicKey(example.address)).toBase58() : null;
  const t = example?.terms;
  const s = t ? pumpSplit(t) : null;
  const tiles: Tile[] = [
    {
      title: "Program deployed",
      detail: facts.programData.state === "known" ? "Executable, upgradeable loader" : "Program account",
      address: program,
    },
    {
      title: "Upgrade authority",
      detail:
        upgrade.state === "unknown"
          ? "Couldn’t reach the RPC — check the program on the explorer"
          : upgrade.value === null
            ? "None — the program is immutable"
            : platform && upgrade.value === platform.admin
              ? "Held by the platform admin (a Squads multisig on mainnet)"
              : "The key that can upgrade the program's code",
      address: upgrade.state === "known" ? upgrade.value : program,
    },
    {
      title: "Mint authority revoked",
      detail: !example
        ? "Revoked when the token is created: by pump.fun's create for pump launches, in create_launch for the two legacy ones"
        : mint?.state === "known"
          ? `$${example.symbol}: mint ${mint.value.mintAuthority ? shortAddr(mint.value.mintAuthority) : "none"} · freeze ${mint.value.freezeAuthority ? shortAddr(mint.value.freezeAuthority) : "none"}`
          : `$${example.symbol} — check its authorities on the explorer`,
      address: example?.mint ?? null,
    },
    {
      title: "Vault PDA",
      detail: example
        ? `$${example.symbol}’s vault, owned by its launch account · withdrawals only by the admin multisig or the dev key, each an on-chain event`
        : "One per launch, derived from the launch · withdrawals only by the admin multisig or the dev key, each an on-chain event",
      address: vault,
    },
    {
      title: "Terms frozen per launch",
      detail:
        t && s
          ? example!.venue === "pump"
            ? `$${example!.symbol}: creator fee ${s.vaultPct}% vault / ${s.burnPct}% burn / ${s.backerPct}% backers · payback at ${fmtMult(s.payoutMult)}, ${s.payoutSharePct}% per ${fmtInterval(s.payoutIntervalHours)} · ${s.launchFeePct}% launch fee`
            : `$${example!.symbol} (Holdfast curve): ${pctFromBps(t.tradeFeeBps)} trade fee · ${pctFromBps(t.backerFeeShareBps)} / ${pctFromBps(t.creatorFeeShareBps)} / ${pctFromBps(10_000 - t.backerFeeShareBps - t.creatorFeeShareBps)} backers / creator / platform`
          : "Creator-fee split, payback rule, agent limits and launch fee, copied into each launch account at creation",
      address: example?.address ?? null,
    },
    {
      title: "Agent authority",
      detail: platform?.agentExecutors.length ? (
        <>
          Can only sign the agent buy and sell instructions, payout_backers and buyback_burn. Its pump trades run through the{" "}
          <Link href="/agents#wallets" className="underline decoration-ink-3/60 underline-offset-2 hover:decoration-ink">
            agent wallets
          </Link>
        </>
      ) : (
        "Can only sign the agent buy and sell instructions, payout_backers and buyback_burn"
      ),
      address: platform?.agentAuthority ?? null,
    },
  ];
  return (
    <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li key={tile.title} className="flex flex-col gap-3 bg-paper p-5">
          <VerifyGlyph size={16} className="text-ink" />
          <div className="min-w-0 flex-1">
            <p className="ui text-ink">{tile.title}</p>
            <p className="small mt-1 text-ink-3">{tile.detail}</p>
          </div>
          {tile.address ? (
            <a
              href={explorerAddress(tile.address)}
              target="_blank"
              rel="noreferrer"
              className="mono inline-flex w-fit items-center gap-1 text-ink-2 transition-colors hover:text-ink"
            >
              {shortAddr(tile.address)}
              <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-label="Open in explorer" />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
