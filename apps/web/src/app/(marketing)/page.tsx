import Link from "next/link";
import { pctFromBps } from "@/components/band/model";
import { prefetchHero } from "@/components/band/prefetch-hero";
import { AgentLive } from "@/components/landing/agent-live";
import { loadChainFacts } from "@/components/landing/chain-facts";
import { Creators } from "@/components/landing/creators";
import { FaqList, faqItems } from "@/components/landing/faq";
import { FeeSplit } from "@/components/landing/fee-split";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowSteps } from "@/components/landing/how-steps";
import { InstructionList } from "@/components/landing/instruction-list";
import { instructionRows } from "@/components/landing/instructions";
import { launchSteps } from "@/components/landing/launch-steps";
import { LiveLaunches } from "@/components/landing/live-launches";
import { ProofTiles } from "@/components/landing/proof-tiles";
import { Reveal } from "@/components/landing/reveal";
import { RulesStrip } from "@/components/landing/rules-strip";
import { Section, SectionHeader } from "@/components/landing/section";
import { SimulatorPanel } from "@/components/landing/simulator-panel";
import { Hydrate, serverQueryClient } from "@/lib/prefetch";
import { platformQuery } from "@/lib/query-options";

/** Landing (§4.2): hero with the live Band, launches row, rules, how it works, simulator, proof, fees, creators, agent, FAQ, CTA. */
export default async function LandingPage() {
  const client = serverQueryClient();
  const { seed } = await prefetchHero(client);
  const facts = loadChainFacts(seed?.mint ?? null);
  const platform = client.getQueryData(platformQuery().queryKey) ?? null;
  const p = platform?.params ?? null;
  const steps = launchSteps(p);

  return (
    <Hydrate client={client}>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-full max-w-[1264px] -translate-x-1/2 border-x border-line xl:block"
        />
        <Hero backerFeeShareBps={p?.backerFeeShareBps ?? null} />

        <Section label="On Holdfast now" frameClassName="pt-12 md:pb-24 md:pt-16">
          <Reveal>
            <LiveLaunches />
          </Reveal>
        </Section>

        <RulesStrip />

        <Section id="how" frameClassName="md:pb-16">
          <Reveal>
            <SectionHeader title="How a launch works">
              <p className="body-l text-ink-2">
                Four beats, each one enforced by an instruction on-chain.{" "}
                <Link href="/docs/how-it-works" className="text-ink underline decoration-ink-3/60 underline-offset-4 hover:decoration-ink">
                  How it works ›
                </Link>
              </p>
            </SectionHeader>
          </Reveal>
          <HowSteps steps={steps} />
        </Section>

        <Section id="simulator">
          <Reveal>
            <SectionHeader title="Buys the dip. Sells the rip. Never at a loss.">
              <p className="body-l text-ink-2">
                The vault agent trades each vault against its own curve, under limits frozen into the launch. Drag the price and see what
                the program would let it do.
              </p>
              <Link href="/docs/agents" className="ui mt-4 inline-block text-ink transition-colors hover:text-accent-ink">
                Read the agent rules →
              </Link>
            </SectionHeader>
          </Reveal>
          <div className="mt-12">
            <SimulatorPanel />
          </div>
        </Section>

        <Section id="verify">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
            <Reveal className="self-start lg:sticky lg:top-[120px] lg:col-span-5">
              <h2 className="display-l text-ink">Rules you can check, not promises.</h2>
              <p className="body-l mt-6 max-w-[30em] text-ink-2">
                Every instruction the program exposes, read from its IDL — including{" "}
                <span className="mono text-ink">admin_withdraw_vault</span>, which lets the platform admin (a multisig on mainnet)
                withdraw a vault. Every withdrawal is on-chain and shown on the launch page.
              </p>
            </Reveal>
            <div className="lg:col-span-7">
              <InstructionList rows={instructionRows()} />
            </div>
          </div>
          <div className="mt-12">
            <ProofTiles facts={await facts} platform={platform} example={seed} />
          </div>
        </Section>

        <Section id="fees">
          <Reveal>
            <SectionHeader title="Where the fee goes">
              {p ? (
                <p className="body-l text-ink-2">
                  {pctFromBps(p.backerFeeShareBps)} of every trading fee goes to the backers who funded the first buy, pro-rata to their
                  deposit, for the life of the launch — and so does 100% of the vault agent&rsquo;s realized profit.
                </p>
              ) : null}
            </SectionHeader>
          </Reveal>
          <div className="mt-12">
            <FeeSplit />
          </div>
        </Section>

        <Section id="creators">
          <Creators />
        </Section>

        <Section id="agent">
          <Reveal>
            <SectionHeader title="The agent, live">
              <p className="body-l text-ink-2">One signer, rate-limited on-chain, reporting every decision in plain words.</p>
            </SectionHeader>
          </Reveal>
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
