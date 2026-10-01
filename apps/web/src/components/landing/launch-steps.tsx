import { CLUSTER_NAME } from "@/lib/env";
import { pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../band/model";
import { RuleTooltip } from "../ui/tooltip";
import type { HowStep } from "./how-steps";
import { AgentFallback, ClaimFallback, LockFallback, RaiseFallback } from "./step-fallbacks";
import { VideoSlot } from "./video-slot";

type Params = PlatformInfo["params"] | null;

/** "EMA" with its one-sentence definition (defined once per page, §3.2 rule 5). */
export function EmaTerm({ p }: { p: Params }) {
  return (
    <RuleTooltip
      rule={`Exponential moving average of price, updated on-chain at every trade${p ? ` over a ${Math.round(p.emaPeriodSecs / 60)}-minute period` : ""}.`}
    >
      EMA
    </RuleTooltip>
  );
}

/** The four product-loop slots (§3.9), each with its live fallback from the running cluster. */
export const DEMO = {
  backARaise: (
    <VideoSlot
      name="back-a-raise"
      label="Backing a raise: the deposit fills the progress bar and the bundle preview updates."
      fallback={<RaiseFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · the open raise closing soonest`}
    />
  ),
  theLock: (
    <VideoSlot
      name="the-lock"
      label="The raise fills, the launch runs and the bundle lands in the vault."
      fallback={<LockFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · a launch's vault`}
    />
  ),
  agentDefends: (
    <VideoSlot
      name="agent-defends"
      label="A dump pushes price under the band and the vault agent buys."
      fallback={<AgentFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · the vault agent's latest call`}
    />
  ),
  claim: (
    <VideoSlot
      name="claim"
      label="Claimable backer fees tick up and are claimed with one transaction."
      fallback={<ClaimFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · backer fee ledger`}
    />
  ),
};

/** The mechanism in four beats (§4.2 §4), rule lines rendered from `/api/platform` params. */
export function launchSteps(p: Params): HowStep[] {
  const s = pumpSplit(p);
  return [
    {
      title: "Back the raise",
      description: "Backers pool SOL before the token exists. Miss the minimum and everyone is refunded in full.",
      rule: "Refund: 100% if min not met or creator cancels",
      frame: DEMO.backARaise,
    },
    {
      title: "The bundle buys first",
      description: `At launch the token is created on pump.fun and the pool, minus the ${s.launchFeePct}% launch fee, makes the first buy, before any public trade can exist. The tokens go into the vault. Only the vault agent trades them; the platform admin can withdraw, and every withdrawal is public.`,
      rule: p ? `Bundle: ≤ ${pctFromBps(p.maxBundleSupplyBps)} of supply` : null,
      frame: DEMO.theLock,
    },
    {
      title: "The agent defends",
      description: (
        <>
          It buys dips at least {p ? pctFromBps(p.agentBandBps) : "the band"} under the <EmaTerm p={p} /> and at or below the
          vault&rsquo;s cost, and sells rallies above both. Rate-limited, on-chain.
        </>
      ),
      rule: p ? `Per window: ≤ ${pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL` : null,
      frame: DEMO.agentDefends,
    },
    {
      title: "Backers earn",
      description: `${s.backerPct}% of the vault agent's realized profit goes to backers, pro-rata to their deposit; ${s.burnPct}% buys and burns the Holdfast token. pump.fun's creator fee flows ${s.backerPct}% into the vault and ${s.burnPct}% to the same buyback pool. Claim any time.`,
      rule: `${s.backerPct}% of agent profit to backers, ${s.burnPct}% to buyback and burn`,
      frame: DEMO.claim,
    },
  ];
}
