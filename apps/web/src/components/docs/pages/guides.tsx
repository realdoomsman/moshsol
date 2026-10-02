import { LIMITS, lamportsToSol, previewPumpBundle, PUMP_CREATE_COST_LAMPORTS, WIND_DOWN_IDLE_SECS, WIND_DOWN_MIN_AGE_SECS } from "@holdfast/sdk";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../../band/model";
import { Term } from "../../glossary";
import { HowStepsStacked } from "../../landing/how-steps";
import { windDownRule } from "../../landing/instructions";
import { DEMO, EmaTerm, launchSteps } from "../../landing/launch-steps";
import { A, B, C, Callout, Figure, Ol, P, Table, Ul } from "../prose";
import type { DocPage } from "../types";
import { paybackSentence } from "../rules";

const days = (s: number) => (s >= 86_400 ? `${s / 86_400} days` : `${Math.round(s / 60)} minutes`);

const EXAMPLE_RAISE = 10_000_000_000n;
/** The example backer's deposit: 1 of the 10 SOL. */
const EXAMPLE_DEPOSIT = 1_000_000_000n;
/** The example rally: the agent sells a tenth of the vault's tokens at 3× the bundle's entry price. */
const EXAMPLE_SELL_FRACTION = 10n;
const EXAMPLE_RALLY = 3n;
/** pump.fun creator fees swept by `collect_pump_fees` over the example launch's life. */
const EXAMPLE_CREATOR_FEES = 2_000_000_000n;

const sol = (lamports: bigint) => `${fmtSolValue(lamportsToSol(lamports))} SOL`;
const share = (lamports: bigint, pct: number) => (lamports * BigInt(Math.round(pct * 100))) / 10_000n;
const yours = (lamports: bigint) => (lamports * EXAMPLE_DEPOSIT) / EXAMPLE_RAISE;

/**
 * A 10 SOL raise through `launch_pump`'s exact bundle maths (30% reserve, no bundle cap: the platform
 * max), then the agent's sell, the creator-fee split and the payback rule, all from the frozen terms.
 */
function workedExample(p: PlatformInfo["params"] | null) {
  const s = pumpSplit(p);
  const maxBundleBps = p?.maxBundleSupplyBps ?? LIMITS.maxBundleSupplyBps;
  const b = previewPumpBundle({ raised: EXAMPLE_RAISE, launchFeeBps: p?.launchFeeBps ?? 100, reserveBps: 3_000, bundleSupplyBps: maxBundleBps });
  /** What went in at launch: the bundle plus the SOL reserve. */
  const initial = b.bundleSol + b.vaultSol;
  const sellTokens = b.bundleTokens / EXAMPLE_SELL_FRACTION;
  const sellCost = b.bundleSol / EXAMPLE_SELL_FRACTION;
  const proceeds = sellCost * EXAMPLE_RALLY;
  const vaultAfterSell = b.vaultSol + proceeds;
  const feesToVault = share(EXAMPLE_CREATOR_FEES, s.vaultPct);
  const feesToBurn = share(EXAMPLE_CREATOR_FEES, s.burnPct);
  const feesToBackers = EXAMPLE_CREATOR_FEES - feesToVault - feesToBurn;
  const target = (initial * BigInt(Math.round(s.payoutMult * 10_000))) / 10_000n;
  const afterPrincipal = target - initial;
  const dividend = share(afterPrincipal, s.payoutSharePct);
  return { s, b, maxBundleBps, initial, sellTokens, sellCost, proceeds, vaultAfterSell, feesToVault, feesToBurn, feesToBackers, target, afterPrincipal, dividend };
}

export const howItWorks: DocPage = {
  slug: "how-it-works",
  group: "Start",
  nav: "How it works (2 min)",
  title: "How it works",
  description:
    "Back a token before it launches on pump.fun. Your SOL makes the first buy, a vault agent trades it under on-chain limits, and the vault pays backers back once it has grown.",
  sections: ({ p }) => {
    const x = workedExample(p);
    const { s } = x;
    return [
      {
        id: "in-three-steps",
        title: "In three steps",
        body: (
          <>
            <Ol>
              <li>
                <B>Back.</B> A creator opens a raise with a minimum and a maximum in SOL. You put SOL in before the token exists. If
                the minimum isn&rsquo;t met by the deadline, or the creator cancels, every backer takes back 100%.
              </li>
              <li>
                <B>Launch on pump.fun.</B> One instruction creates the token on pump.fun and spends the pooled SOL, minus the{" "}
                {s.launchFeePct}% launch fee and the create rent, on its very first buy: the <Term k="bundle" split={s} />. Nobody can
                trade before it. Part of the raise stays as SOL. Both sit in the launch&rsquo;s <Term k="vault" split={s} />; together
                they are what went in at launch.
              </li>
              <li>
                <B>The vault grows, then pays back.</B> Only the <Term k="vaultAgent" split={s} /> trades the vault: it sells slowly
                into strength and buys back dips with what it sold, inside per-window caps the program enforces. Everything it sells
                stays in the vault as SOL. pump.fun&rsquo;s creator fee on the token adds {s.vaultPct}% to the vault, {s.burnPct}% to
                the <Term k="buybackPool" split={s} /> and {s.backerPct}% to backers. {paybackSentence(s)}
              </li>
            </Ol>
            <P>
              Buying and selling the token itself happens on pump.fun; every launch page links there. Holdfast earns only the{" "}
              {s.launchFeePct}% launch fee and a small create fee, and the creator earns 0% of fees.
            </P>
          </>
        ),
      },
      {
        id: "worked-example",
        title: "A worked example: a 10 SOL raise",
        body: (
          <>
            <P>
              Say a raise closes at {sol(EXAMPLE_RAISE)} and you put in {sol(EXAMPLE_DEPOSIT)}, a 10% share. The creator kept the default
              30% SOL reserve and set no bundle cap, so the bundle buys as much as the raise can (up to {pctFromBps(x.maxBundleBps)} of
              supply). At launch:
            </P>
            <Table
              head={["Where the 10 SOL goes", "Amount"]}
              rows={[
                [`Launch fee (${s.launchFeePct}%) to Holdfast`, sol(x.b.launchFee)],
                ["pump.fun create rent", `≈ ${sol(PUMP_CREATE_COST_LAMPORTS)}`],
                [
                  <>
                    The <Term key="b" k="bundle" split={s} />: the first buy on the curve, including pump.fun&rsquo;s fee
                  </>,
                  `${sol(x.b.bundleSol)} → ${fmtTokens(x.b.bundleTokens)} tokens (${x.b.supplyPct}% of supply)`,
                ],
                ["Reserve kept as vault SOL for dip buys", sol(x.b.vaultSol)],
                [
                  <>
                    What went in at launch (<C key="i">initial_vault_sol</C>)
                  </>,
                  sol(x.initial),
                ],
                ["Market cap right after the bundle", `≈ ${fmtSolValue(x.b.marketCapAfter)} SOL`],
              ]}
            />
            <P>
              Weeks later the price rallies to {fmtMult(Number(EXAMPLE_RALLY))} the bundle&rsquo;s entry and the agent sells a tenth of
              its tokens into it, sized so the sell doesn&rsquo;t dent the chart:
            </P>
            <Table
              head={["The rally sell", "Amount"]}
              rows={[
                [`Tokens sold (${fmtTokens(x.sellTokens)})`, `cost ${sol(x.sellCost)} → sold for ${sol(x.proceeds)}`],
                ["Proceeds, kept in the vault as SOL", sol(x.proceeds)],
                ["Vault SOL after the sell (liquid SOL only, the payback rule's measure)", `${sol(x.vaultAfterSell)} (${fmtMult(Number((x.vaultAfterSell * 100n) / x.initial) / 100)} what went in)`],
              ]}
            />
            <P>
              Nothing leaves the vault on a sell. That SOL is what the agent buys the next dip with, and the cycle repeats as long as the
              token trades. Meanwhile pump.fun pays the launch a creator fee on every trade; say <C>collect_pump_fees</C> has swept{" "}
              {sol(EXAMPLE_CREATOR_FEES)} of it so far:
            </P>
            <Table
              head={["Creator fees swept", "Amount"]}
              rows={[
                [`To the vault as SOL (${s.vaultPct}%)`, sol(x.feesToVault)],
                [
                  <>
                    To the <Term key="p" k="buybackPool" split={s} /> ({s.burnPct}%)
                  </>,
                  sol(x.feesToBurn),
                ],
                [
                  <>
                    To backers by deposit share ({s.backerPct}%, <Term key="e" k="backerEarnings" split={s} />)
                  </>,
                  sol(x.feesToBackers),
                ],
                ["Your 10% share, claimable now", sol(yours(x.feesToBackers))],
              ]}
            />
            <P>
              The <Term k="payback" split={s} /> is the last step and it is opportunistic, not a promise. Only when the vault&rsquo;s
              liquid SOL reaches {fmtMult(s.payoutMult)} what went in at launch ({sol(x.target)} here; tokens don&rsquo;t count) and the
              chart is strong may the agent pay backers:
            </P>
            <Table
              head={["Payback", "Amount"]}
              rows={[
                [`Vault SOL needed (${fmtMult(s.payoutMult)} of ${sol(x.initial)})`, sol(x.target)],
                ["First payout: the principal, by deposit share", `${sol(x.initial)} · your 10%: ${sol(yours(x.initial))}`],
                [
                  `Then, at most every ${fmtInterval(s.payoutIntervalHours)} while the chart stays strong: ${s.payoutSharePct}% of the vault`,
                  `${sol(x.dividend)} of ${sol(x.afterPrincipal)} · your 10%: ${sol(yours(x.dividend))}`,
                ],
              ]}
            />
            <P>
              The principal payout starts the {fmtInterval(s.payoutIntervalHours)} clock too. If the vault is under{" "}
              {fmtMult(s.payoutMult)} or the chart is weak at the check, nothing is paid; buying back dips always comes first, and no
              payout can take the vault below its <Term k="vaultFloor" split={s} />. A token that never gets there pays nothing beyond
              its share of creator fees, and a token that falls stays down until it doesn&rsquo;t. The launch numbers are the
              program&rsquo;s own bundle maths from <C>previewPumpBundle</C>; a real launch&rsquo;s fills differ by its venue fees and
              price.
            </P>
          </>
        ),
      },
      {
        id: "if-things-go-wrong",
        title: "If things go wrong",
        body: (
          <>
            <Ul>
              <li>
                <B>The raise misses its minimum</B> or the creator cancels: refunds open and every backer claims 100% of their deposit.
                No fee.
              </li>
              <li>
                <B>The coin dies.</B> Once a launch is {windDownRule(s)}, anyone can run the <Term k="windDown" split={s} />: the
                vault sells what it holds and all of its SOL goes to backers, pro-rata. That can be less than what they put in.
              </li>
              <li>
                <B>The vault agent goes offline.</B> Nothing moves; the vault just sits. Its limits are enforced by the program, not
                the agent, so a stolen agent key can&rsquo;t extract anything either.
              </li>
            </Ul>
            <Callout tone="warn" title="The vault can be withdrawn">
              The admin (a 2-of-3 Squads multisig) and a single dev key can withdraw a vault&rsquo;s SOL and tokens (
              <C>admin_withdraw_vault</C>, <C>dev_withdraw_vault</C>). Every withdrawal is an on-chain event on the launch page. See{" "}
              <A href="/docs/risks">Risks</A>.
            </Callout>
          </>
        ),
      },
      {
        id: "the-four-beats",
        title: "The four beats, live",
        body: <HowStepsStacked steps={launchSteps(p)} />,
      },
      {
        id: "lifecycle",
        title: "Lifecycle and states",
        body: (
          <>
            <P>
              A launch account moves through four on-chain states: <C>Raising</C>, <C>Live</C>, <C>Refunding</C> and <C>WoundDown</C>.
              The UI adds &ldquo;ready to launch&rdquo; (minimum met, not launched yet) and &ldquo;raise failed&rdquo; (deadline passed
              below the minimum) from the clock, and says under every status chip what you can do right now.
            </P>
            <Table
              head={["State", "Entered by", "What can happen"]}
              rows={[
                ["Raising", <C key="c">create_launch_pump</C>, "Deposits until the deadline or the max raise; the creator may cancel."],
                ["Live", <C key="l">launch_pump</C>, "Public trading on pump.fun, vault-agent trades, creator-fee sweeps, backer claims and paybacks."],
                ["Refunding", <><C>cancel_launch</C>, or <C>refund</C> after a missed minimum</>, "Every backer takes back 100% of their deposit."],
                [
                  "Wound down",
                  <C key="w">wind_down_pump</C>,
                  `After ${WIND_DOWN_MIN_AGE_SECS / 86_400} days, ${WIND_DOWN_IDLE_SECS / 3_600} idle hours and ≤ ${s.deadHoldersPct}% of supply held outside the vault and pump.fun. The vault's SOL was credited to backers; claims keep working.`,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: "who-can-launch",
        title: "Who can open trading",
        body: (
          <P>
            The creator can call <C>launch_pump</C> any time the minimum is met. Anyone can call it once the minimum is met and either
            the deadline has passed or the raise is full, so a creator can&rsquo;t hold a funded raise hostage.
          </P>
        ),
      },
    ];
  },
};

export const forBackers: DocPage = {
  slug: "for-backers",
  group: "Guides",
  nav: "For backers",
  title: "For backers",
  description: "Fund the first buy, earn a share of the token's creator fees, and be paid back by the vault once it has grown, never the exit liquidity for the bundle.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "backing",
        title: "Backing a raise",
        body: (
          <>
            <Ol>
              <li>Open a launch that is raising and enter an amount. Deposits are clipped to the room left under the max raise and to the per-wallet cap, so you never overpay.</li>
              <li>Whitelisted raises accept only listed wallets; the app builds the Merkle proof for you.</li>
              <li>
                When the raise launches, your SOL has bought the <Term k="bundle" split={s} />, the first slice of supply, and it sits
                in the <Term k="vault" split={s} /> with the SOL reserve. Together they are what went in at launch, the figure the
                payback rule measures against.
              </li>
            </Ol>
            <Figure>{DEMO.backARaise}</Figure>
          </>
        ),
      },
      {
        id: "refunds",
        title: "Refunds",
        body: (
          <P>
            If the raise misses its minimum by the deadline, anyone can open refunds and every backer claims <B>100%</B> of their deposit
            with <C>refund</C>. The same applies if the creator cancels before launch. There is no fee on a refund.
          </P>
        ),
      },
      {
        id: "earnings",
        title: "What you earn",
        body: (
          <>
            <Ul>
              <li>
                <B>Creator fees.</B> pump.fun pays the launch a creator fee on every trade of the token. Each sweep (
                <C>collect_pump_fees</C>, anyone can run it) sends {s.vaultPct}% to the vault as SOL, {s.burnPct}% to the{" "}
                <Term k="buybackPool" split={s} /> and {s.backerPct}% to backers, pro-rata to deposit. The creator gets 0%.
              </li>
              <li>
                <B>Payback.</B> {paybackSentence(s)} Only the vault&rsquo;s liquid SOL counts, never its tokens, and no payout may take the
                vault below its <Term k="vaultFloor" split={s} /> ({s.minVaultSol} SOL). It is signed by the agent authority alone and is
                opportunistic: a vault that never reaches {fmtMult(s.payoutMult)} pays nothing beyond the creator fees.
              </li>
              <li>
                <B>Wind-down.</B> If the launch dies, all of the vault&rsquo;s SOL is credited to backers pro-rata (see below).
              </li>
            </Ul>
            <P>
              The agent&rsquo;s own sells don&rsquo;t pay you directly: all proceeds stay in the vault, which is how it reaches{" "}
              {fmtMult(s.payoutMult)}. The program tracks everything owed to you with a fee-per-share accumulator, so your claimable
              amount is exact at any moment and never expires. On the two legacy Holdfast-curve launches, backers also earn{" "}
              {p ? pctFromBps(p.backerFeeShareBps) : "a share"} of the {p ? pctFromBps(p.tradeFeeBps) : ""} trade fee on that curve.
            </P>
            <Figure>{DEMO.payout}</Figure>
          </>
        ),
      },
      {
        id: "claiming",
        title: "Claiming",
        body: (
          <P>
            <C>claim_backer_fees</C> pays everything accrued to your deposit so far: your share of creator fees, paybacks and, if the
            launch wound down, your share of its SOL. Claim per launch from the token page, or all at once from{" "}
            <A href="/portfolio">Portfolio</A>. Zero volume pays zero: earnings come only from real trades, paybacks and wind-down.
          </P>
        ),
      },
      {
        id: "wind-down",
        title: "When a launch winds down",
        body: (
          <P>
            Once a launch is {windDownRule(s)}, anyone can call <C>wind_down_pump</C>. The vault sells what it holds into pump.fun and
            all of its SOL is credited to backers pro-rata; trading of the vault ends. That is the worst case, and it can return less than
            you put in. See <A href="/docs/the-vault">The vault</A>.
          </P>
        ),
      },
      {
        id: "admin-withdraw",
        title: "Who can withdraw a vault",
        body: (
          <Callout tone="warn" title="The vault can be withdrawn">
            The admin (a 2-of-3 Squads multisig, <C>admin_withdraw_vault</C>) and a single dev key (<C>dev_withdraw_vault</C>, to its
            own wallet) can withdraw vault SOL and tokens. What you have already accrued is out of their reach, and every withdrawal is
            an on-chain event on the launch page. See <A href="/docs/risks">Risks</A>.
          </Callout>
        ),
      },
    ];
  },
};

export const forCreators: DocPage = {
  slug: "for-creators",
  group: "Guides",
  nav: "For creators",
  title: "For creators",
  description: "Launch on pump.fun in one transaction with a bundle only the vault agent trades, no creator fee, and no way to dump on your backers.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "create",
        title: "Creating a launch",
        body: (
          <>
            <P>
              <C>create_launch_pump</C> opens the raise and seeds it with a one-time create key for pump.fun. It also copies the fee
              split, the payback rule and the agent limits into the launch, where they can never change. The token itself is created
              at launch, with the launch account as its pump.fun creator.
            </P>
            <Table
              head={["Setting", "Limit"]}
              rows={[
                ["Min raise", p ? `≥ ${lamportsToSol(p.minRaiseLamports)} SOL` : "Platform minimum"],
                [
                  "Max raise",
                  // A platform beta cap ("0" or absent = none) tightens the program's hard limit.
                  p?.maxRaiseLamports && p.maxRaiseLamports !== "0"
                    ? `≥ min raise, ≤ ${lamportsToSol(p.maxRaiseLamports)} SOL (beta cap)`
                    : `≥ min raise, ≤ ${Number(LIMITS.maxRaiseLamports / 1_000_000_000n).toLocaleString("en-US")} SOL`,
                ],
                ...(p?.maxWalletDepositLamports && p.maxWalletDepositLamports !== "0"
                  ? [["Per wallet", `≤ ${lamportsToSol(p.maxWalletDepositLamports)} SOL per backer (beta cap)`]]
                  : []),
                ["Duration", `${days(LIMITS.minRaiseDurationSecs)} to ${days(LIMITS.maxRaiseDurationSecs)}`],
                [
                  "Bundle cap",
                  `No cap (the default: up to ${pctFromBps(p?.maxBundleSupplyBps ?? LIMITS.maxBundleSupplyBps)} of supply), or your own from ${LIMITS.minBundleSupplyBps / 100}%`,
                ],
                ["SOL reserve", `0% to ${LIMITS.maxReserveBps / 100}% of the raise`],
                ["Create fee", p ? `${lamportsToSol(p.createFeeLamports)} SOL + rent` : "Flat fee + rent"],
              ]}
            />
            <P>
              Preview the bundle at your min and max raise on the <A href="/#creators">landing page</A>, then{" "}
              <A href="/create">launch a token</A>.
            </P>
          </>
        ),
      },
      {
        id: "bundle",
        title: "How the bundle is sized",
        body: (
          <P>
            At launch <C>launch_pump</C> takes the {s.launchFeePct}% launch fee and the pump.fun create rent from the raise, keeps your
            chosen reserve share as SOL in the vault, and spends the rest on the token&rsquo;s first buy, in the same instruction that
            creates it. The bundle follows the raise: with no cap it buys as much as the SOL can, up to{" "}
            {pctFromBps(p?.maxBundleSupplyBps ?? LIMITS.maxBundleSupplyBps)} of supply; you can set a lower cap, and SOL beyond it
            stays in the vault. The buy never completes the pump.fun curve at launch; anything the curve can&rsquo;t take stays as
            vault SOL too. The bigger the raise, the higher the starting market cap, and the bundle plus the reserve is what the
            payback rule measures against.
          </P>
        ),
      },
      {
        id: "creator-fees",
        title: "Creator fees",
        body: (
          <P>
            You earn 0% of fees. pump.fun&rsquo;s creator fee is paid to the launch, not to you, and every sweep splits it {s.vaultPct}%
            to the vault, {s.burnPct}% to the buyback-and-burn pool and {s.backerPct}% to your backers. You can&rsquo;t touch the vault;
            only the vault agent trades it, and only the admin (a 2-of-3 Squads multisig) and a single dev key can withdraw it. Only the two legacy Holdfast-curve launches pay
            their creator {p ? pctFromBps(p.creatorFeeShareBps) : "a share"} of that curve&rsquo;s trade fee, claimable with{" "}
            <C>claim_creator_fees</C>.
          </P>
        ),
      },
    ];
  },
};

export const forTraders: DocPage = {
  slug: "for-traders",
  group: "Guides",
  nav: "For traders",
  title: "For traders",
  description: "Trade on pump.fun as usual; the only difference is a bundle in a vault that trades against you inside published rules.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "venue",
        title: "Where the token trades",
        body: (
          <>
            <P>
              Holdfast launches are ordinary pump.fun tokens: buy and sell them on pump.fun&rsquo;s bonding curve and, after it
              completes, on PumpSwap. There is no Holdfast trade fee; you pay pump.fun&rsquo;s. Every launch page links to the venue and
              shows the vault&rsquo;s trades alongside the chart.
            </P>
            <P>
              The two launches created before pump.fun support trade on the legacy Holdfast curve, a constant-product market (
              <C>x · y = k</C>) with {p ? `${lamportsToSol(p.virtualSolReserves)} SOL of virtual reserves` : "virtual SOL reserves"} and a{" "}
              {p ? pctFromBps(p.tradeFeeBps) : ""} fee on every buy and sell. Its liquidity never migrates to a DEX, and quotes use the
              program&rsquo;s exact integer maths with a slippage minimum: if price moves past it while you sign, the transaction fails
              instead of filling worse.
            </P>
          </>
        ),
      },
      {
        id: "reading-the-band",
        title: "Reading the band",
        body: (
          <P>
            The chart shows the <EmaTerm p={p} /> and the agent band around it. Orange diamonds are vault-agent trades: it can only buy
            below the lower edge and sell above the upper one, within its per-window budget and its max impact per trade, and never below
            its <Term k="vaultFloor" split={s} /> in SOL. See <A href="/docs/agents">the vault agent</A>. Agent trades are tagged in every
            trades table.
          </P>
        ),
      },
      {
        id: "what-it-isnt",
        title: "What this doesn't protect",
        body: (
          <Callout tone="warn" title="Other holders can still sell">
            The bundle is held in the vault and traded only by the rate-limited agent, but any other holder can sell at any time, the
            admin (a 2-of-3 Squads multisig) and a single dev key can withdraw a vault, and price can fall like any token. See{" "}
            <A href="/docs/risks">Risks</A>.
          </Callout>
        ),
      },
    ];
  },
};
