"use client";

import { lamportsToSol } from "@holdfast/sdk";
import {
  Bot,
  ChevronDown,
  Coins,
  FileLock2,
  Lock,
  PieChart,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { usePlatform } from "@/lib/queries";
import { VaultScene } from "../explore/vault-scene";
import { ButtonLink } from "../legacy/button";
import { Card } from "../legacy/primitives";

const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

export function HowItWorks() {
  const { data } = usePlatform();
  const p = data?.params;
  /** Placeholder glyph while the live parameter loads; never a made-up number. */
  const v = (fn: (x: NonNullable<typeof p>) => string) => (p ? fn(p) : "…");
  const minutes = (s: number) => `${Math.round(s / 60)} min`;

  const steps: { icon: typeof Rocket; title: string; body: ReactNode }[] = [
    {
      icon: Sparkles,
      title: "Create",
      body: (
        <>
          A creator sets the raise (min/max, duration, optional whitelist), the max bundle size (up to{" "}
          {v((x) => pct(x.maxBundleSupplyBps))} of supply) and how much of the raise stays in the vault as SOL. All 1B
          tokens are minted to the curve and the mint authority is revoked in the same instruction. Cost:{" "}
          {v((x) => `${lamportsToSol(x.createFeeLamports)} SOL`)} + rent.
        </>
      ),
    },
    {
      icon: Users,
      title: "Raise",
      body: (
        <>
          Backers deposit SOL. Deposits are clipped to the cap so nobody overpays. If the minimum isn&apos;t met by the
          deadline — or the creator cancels — every backer refunds 100%.
        </>
      ),
    },
    {
      icon: Rocket,
      title: "Launch",
      body: (
        <>
          The launch instruction takes a {v((x) => pct(x.launchFeeBps))} fee, then buys the bundle on the curve{" "}
          <em>before any public trade is possible</em> — nobody can snipe ahead of it. Bundle tokens and the SOL reserve
          go into the vault. There is no instruction to take them out.
        </>
      ),
    },
    {
      icon: TrendingUp,
      title: "Trade",
      body: (
        <>
          Anyone buys and sells on a constant-product curve with {v((x) => `${lamportsToSol(x.virtualSolReserves)} SOL`)}{" "}
          of virtual liquidity. Liquidity never migrates and can never be withdrawn. Each trade pays{" "}
          {v((x) => pct(x.tradeFeeBps))}.
        </>
      ),
    },
    {
      icon: Bot,
      title: "Agents defend",
      body: (
        <>
          Rate-limited agents trade the vault: buy dips {v((x) => pct(x.agentBandBps))} under the EMA at or below cost,
          sell rallies above EMA and cost — at most {v((x) => pct(x.agentSellBpsPerWindow))} of the vault&apos;s tokens per{" "}
          {v((x) => minutes(x.agentWindowSecs))}.
        </>
      ),
    },
    {
      icon: Coins,
      title: "Backers earn",
      body: (
        <>
          {v((x) => pct(x.backerFeeShareBps))} of every trading fee accrues to backers pro-rata to their deposit.
          Claim whenever you like — forever.
        </>
      ),
    },
  ];

  const split = [
    {
      who: "Backers",
      gets: p ? `${pct((p.tradeFeeBps * p.backerFeeShareBps) / 10_000)} of every trade` : "…",
      how: "Pro-rata to deposit, claimable any time",
      tone: "text-[#c2a6ff]",
    },
    {
      who: "Creator",
      gets: p ? `${pct((p.tradeFeeBps * p.creatorFeeShareBps) / 10_000)} of every trade` : "…",
      how: "Claimable any time by the creator wallet",
      tone: "text-lime",
    },
    {
      who: "Platform",
      gets: p
        ? `${pct((p.tradeFeeBps * (10_000 - p.backerFeeShareBps - p.creatorFeeShareBps)) / 10_000)} of trades · ${pct(p.launchFeeBps)} of the raise · ${lamportsToSol(p.createFeeLamports)} SOL per create`
        : "…",
      how: "Swept permissionlessly to a fixed treasury",
      tone: "text-cyan",
    },
    {
      who: "Vault",
      gets: "The bundle + SOL reserve",
      how: "Locked forever, traded only by agents within limits",
      tone: "text-up",
    },
  ];

  const trust = [
    {
      icon: FileLock2,
      title: "Locked by code",
      body: "Vault tokens sit in a program-owned account. The program has no withdraw instruction — not for the creator, not for the admin, not for the agent.",
    },
    {
      icon: Bot,
      title: "Agents can't go rogue",
      body: "The agent key can only call agent_buy and agent_sell, bounded by band, cost basis, per-window budgets and max impact — all checked on-chain.",
    },
    {
      icon: ShieldCheck,
      title: "Fixed supply, revoked mint",
      body: "Exactly 1,000,000,000 tokens are minted at creation and the mint authority is revoked in the same instruction. No freeze authority exists.",
    },
    {
      icon: PieChart,
      title: "Fees frozen per launch",
      body: "Every launch copies the fee split and agent limits into its own account at creation. Platform changes can never touch an existing launch.",
    },
  ];

  const faq = [
    {
      q: "Can the creator dump the bundle?",
      a: "No. The bundle is bought by the launch instruction and lands in the vault, which no one — creator included — can withdraw from. Only the agent can sell vault tokens, and only into rallies above cost.",
    },
    {
      q: "What happens if a raise misses its minimum?",
      a: "After the deadline anyone can refund. The first refund marks the raise as failed on-chain and every backer gets 100% of their deposit back. The same applies if the creator cancels.",
    },
    {
      q: "Can fees or agent limits change after I back a launch?",
      a: "No. Each launch freezes its terms (trade fee, fee split, launch fee, agent band, budgets, window and EMA period) when it's created. Admin updates only affect future launches.",
    },
    {
      q: "What if the agent goes offline?",
      a: "Nothing is at risk. The vault simply stops trading until the agent is back — it can never be drained, and trading on the curve continues normally.",
    },
    {
      q: "Why keep some of the raise as SOL?",
      a: "The reserve lets agents buy dips. They can only buy below the EMA band and at or below the vault's average cost, so the reserve is never spent chasing price.",
    },
    {
      q: "Does the token migrate to a DEX?",
      a: "No. Liquidity lives on the holdfast curve forever, so it can never be pulled.",
    },
    {
      q: "How do I verify all of this?",
      a: "Every launch page has a Verify on-chain card: mint authority, supply, vault and curve accounts, with explorer links. The Agents page shows the live rules and every agent trade.",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-16 pb-8">
      <section className="pt-2 text-center">
        <VaultScene orbiters={[]} className="mx-auto max-w-[460px]" />
        <div className="type-eyebrow mt-2 flex items-center justify-center gap-2 text-lime">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-lime text-lime" aria-hidden /> Docs · how it works
        </div>
        <h1 className="type-display mx-auto mt-4 max-w-3xl text-[40px] sm:text-6xl">
          A launchpad where the <span className="text-lime">bundle works for the market</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Backers fund a bundle that is locked forever in an on-chain vault. Agents trade it inside hard limits to
          soften dumps and rallies. Backers earn a share of every trade.
        </p>
      </section>

      <section aria-labelledby="flow">
        <h2 id="flow" className="type-title mb-6 text-2xl sm:text-3xl">
          The flow
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="card animate-in overflow-hidden p-5 sm:p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-6 -right-2 font-mono text-[88px] leading-none font-bold text-white/[0.03] select-none"
              >
                0{i + 1}
              </div>
              <div className="relative flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl border border-lime/20 bg-lime/10 text-lime shadow-[0_0_24px_-8px_rgb(198_255_61/0.6)]">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="font-mono text-sm text-dim">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="split">
        <h2 id="split" className="type-title mb-6 text-2xl sm:text-3xl">
          Who gets what
        </h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table text-sm [&_td]:py-4">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Gets</th>
                  <th className="hidden sm:table-cell">How</th>
                </tr>
              </thead>
              <tbody>
                {split.map((r) => (
                  <tr key={r.who}>
                    <td className={`align-top font-semibold ${r.tone}`}>{r.who}</td>
                    <td>
                      <span className="font-medium">{r.gets}</span>
                      <span className="mt-1 block text-xs text-muted sm:hidden">{r.how}</span>
                    </td>
                    <td className="hidden text-muted sm:table-cell">{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-xs text-dim">
            Live platform defaults for new launches. Each launch shows its own frozen terms on its page.
          </p>
        </Card>
      </section>

      <section aria-labelledby="trust">
        <h2 id="trust" className="type-title mb-6 text-2xl sm:text-3xl">
          Trust model
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map((t) => (
            <div key={t.title} className="card p-5">
              <span className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.04]">
                <t.icon className="size-5 text-lime" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold">{t.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="faq" className="mx-auto w-full max-w-3xl">
        <h2 id="faq" className="type-title mb-6 text-2xl sm:text-3xl">
          FAQ
        </h2>
        <div className="grid gap-2.5">
          {faq.map((f) => (
            <details key={f.q} className="card group p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-[inherit] px-5 py-4 font-medium transition-colors hover:text-lime">
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-dim transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card relative overflow-hidden p-8 text-center sm:p-12">
        <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full bg-lime/15 blur-3xl" />
        <Lock className="relative mx-auto size-7 text-lime" aria-hidden />
        <h2 className="type-title relative mt-4 text-3xl sm:text-4xl">Launch something that can&apos;t be dumped</h2>
        <div className="relative mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/create" variant="primary" size="lg">
            Create a launch
          </ButtonLink>
          <ButtonLink href="/agents" variant="secondary" size="lg">
            See the agents
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
