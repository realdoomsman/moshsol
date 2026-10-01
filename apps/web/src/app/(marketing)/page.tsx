import type { Metadata } from "next";
import Link from "next/link";
import { AgentLive } from "@/components/landing/agent-live";
import { loadChainFacts } from "@/components/landing/chain-facts";
import { Creators } from "@/components/landing/creators";
import { FaqList, faqItems } from "@/components/landing/faq";
import { prefetchLanding } from "@/components/landing/featured";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowSteps } from "@/components/landing/how-steps";
import { HowStrip } from "@/components/landing/how-strip";
import { MoneyTrio } from "@/components/landing/money-trio";
import { InstructionList } from "@/components/landing/instruction-list";
import { instructionRows } from "@/components/landing/instructions";
import { launchSteps } from "@/components/landing/launch-steps";
import { LiveLaunches } from "@/components/landing/live-launches";
import { ProofTiles } from "@/components/landing/proof-tiles";
import { RulesStrip } from "@/components/landing/rules-strip";
import { Section, SectionHeader } from "@/components/landing/section";
import { Hydrate, serverQueryClient } from "@/lib/prefetch";
import { pumpSplit } from "@/lib/pump-terms";
import { platformQuery } from "@/lib/query-options";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Landing (§4.2): hero, three-step strip, launches row, rules, how it works, proof, splits, creators, agent, FAQ, CTA. */
export default async function LandingPage() {
  const client = serverQueryClient();
  const { seed } = await prefetchLanding(client);
  const facts = loadChainFacts(seed?.mint ?? null);
  const platform = client.getQueryData(platformQuery().queryKey) ?? null;
  const p = platform?.params ?? null;
  const s = pumpSplit(p);
  const steps = launchSteps(p);

  return (
    <Hydrate client={client}>
      <div>
        <Hero params={p} />
        <HowStrip params={p} />

        <Section label="On Holdfast now" frameClassName="pt-12 md:pb-24 md:pt-16">
          <LiveLaunches />
        </Section>

        <RulesStrip />

        <Section id="how" frameClassName="md:pb-16">
          <SectionHeader title="How a launch works">
            <p className="body-l text-ink-2">
              Four beats, each one enforced by an instruction on-chain.{" "}
              <Link href="/docs/how-it-works" className="text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
                How it works ›
              </Link>
            </p>
          </SectionHeader>
          <HowSteps steps={steps} />
        </Section>

        <Section id="verify">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
            <div className="self-start lg:sticky lg:top-[120px] lg:col-span-5">
              <h2 className="display-l text-ink">Rules you can check, not promises.</h2>
              <p className="body-l mt-6 max-w-[30em] text-ink-2">
                Every instruction the program exposes, read from its IDL — including{" "}
                <span className="mono text-ink">admin_withdraw_vault</span>, which lets the platform admin (a Squads multisig on mainnet)
                withdraw a vault. Every withdrawal is on-chain and shown on the launch page.
              </p>
            </div>
            <div className="lg:col-span-7">
              <InstructionList rows={instructionRows(s)} />
            </div>
          </div>
          <div className="mt-12">
            <ProofTiles facts={await facts} platform={platform} example={seed} />
          </div>
        </Section>

        <Section id="fees">
          <SectionHeader title="Where the money goes">
            <p className="body-l text-ink-2">
              Every launch freezes its split at creation. Creators take no cut of fees. pump.fun&rsquo;s creator fee goes {s.vaultPct}% to the
              vault, {s.burnPct}% to buying and burning the Holdfast token and {s.backerPct}% to backers; what the vault agent sells stays in
              the vault.
            </p>
          </SectionHeader>
          <div className="mt-12">
            <MoneyTrio params={p} />
          </div>
        </Section>

        <Section id="creators">
          <Creators />
        </Section>

        <Section id="agent">
          <SectionHeader title="The agent, live">
            <p className="body-l text-ink-2">One signer, rate-limited on-chain, reporting every decision in plain words.</p>
          </SectionHeader>
          <div className="mt-12">
            <AgentLive />
          </div>
        </Section>

        <Section id="faq">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
            <h2 className="display-l text-ink lg:col-span-4">Questions</h2>
            <div className="lg:col-span-7 lg:col-start-6">
              <FaqList items={faqItems(p)} />
            </div>
          </div>
        </Section>

        <FinalCta />
      </div>
    </Hydrate>
  );
}
