import { CLUSTER_NAME } from "@/lib/env";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
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
  theBundle: (
    <VideoSlot
      name="the-bundle"
      label="Launch now: the token is created on pump.fun, the bundle is its first buy and lands in the vault."
      fallback={<LockFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · a launch's vault`}
    />
  ),
  agentDefends: (
    <VideoSlot
      name="agent-defends"
      label="A dump pushes price under the band and the vault agent buys back at a discount to its last sells."
      fallback={<AgentFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · the vault agent's latest call`}
    />
  ),
  claim: (
    <VideoSlot
      name="claim"
      label="A backer claims their share of the launch's creator fees and payback with one transaction."
      fallback={<ClaimFallback />}
      fallbackCaption={`Live from ${CLUSTER_NAME} · backer ledger`}
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
      description: `At launch the token is created on pump.fun and the pool, minus the ${s.launchFeePct}% launch fee and the create fee, makes the first buy in the same instruction, before any public trade can exist. The tokens and the SOL reserve go into the vault. Only the vault agent trades them; the platform admin can withdraw, and every withdrawal is public.`,
      rule: p ? `Bundle: ≤ ${pctFromBps(p.maxBundleSupplyBps)} of supply` : null,
      frame: DEMO.theBundle,
    },
    {
      title: "The agent holds it",
      description: (
        <>
          It sells slowly when the chart is strong, sized so it doesn&rsquo;t hurt the chart, and buys back dips at least{" "}
          {p ? pctFromBps(p.agentBandBps) : "the band"} under the <EmaTerm p={p} /> with what it sold. Every sale stays in the vault as
          SOL. Rate-limited, on-chain.
        </>
      ),
      rule: p ? `Per window: ≤ ${pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL` : null,
      frame: DEMO.agentDefends,
    },
    {
      title: "Backers get paid back",
      description: `When the vault's SOL is ${fmtMult(s.payoutMult)} what went in at launch and the chart is strong, the agent may pay backers: principal first, then ${s.payoutSharePct}% of the vault every ${fmtInterval(s.payoutIntervalHours)}. Buying back dips always comes first. On top, ${s.backerPct}% of pump.fun's creator fee goes to backers pro-rata; ${s.vaultPct}% to the vault, ${s.burnPct}% buys and burns the Holdfast token. Claim any time.`,
      rule: `Payback: ${fmtMult(s.payoutMult)} the start, then ${s.payoutSharePct}% per ${fmtInterval(s.payoutIntervalHours)}`,
      frame: DEMO.claim,
    },
  ];
}
