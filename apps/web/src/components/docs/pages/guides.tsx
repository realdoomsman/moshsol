import {
  LIMITS,
  lamportsToSol,
  previewPumpBundle,
  PUMP_CREATE_COST_LAMPORTS,
  WIND_DOWN_IDLE_SECS,
  WIND_DOWN_MIN_AGE_SECS,
} from "@holdfast/sdk";
import { fmtSolValue, fmtTokens } from "@/lib/format";
import { pumpSplit } from "@/lib/pump-terms";
import type { PlatformInfo } from "@/lib/types";
import { pctFromBps } from "../../band/model";
import { Term } from "../../glossary";
import { HowStepsStacked } from "../../landing/how-steps";
import { DEMO, EmaTerm, launchSteps } from "../../landing/launch-steps";
import { SplitBar } from "../../landing/fee-split";
import { WIND_DOWN_RULE } from "../../landing/instructions";
import { A, B, C, Callout, Figure, Ol, P, Table, Ul } from "../prose";
import type { DocPage } from "../types";

const days = (s: number) => (s >= 86_400 ? `${s / 86_400} days` : `${Math.round(s / 60)} minutes`);

const EXAMPLE_RAISE = 10_000_000_000n;
/** The example backer's deposit: 1 of the 10 SOL. */
const EXAMPLE_DEPOSIT = 1_000_000_000n;
/** The example rally: the agent sells a tenth of the vault's tokens at 1.5× their average cost. */
const EXAMPLE_SELL_FRACTION = 10n;
const EXAMPLE_RALLY = 1.5;

const sol = (lamports: bigint) => `${fmtSolValue(lamportsToSol(lamports))} SOL`;

/** A 10 SOL raise through `launch_pump`'s exact bundle maths and the frozen split, with a 30% reserve and 15% bundle cap. */
function workedExample(p: PlatformInfo["params"] | null) {
  const s = pumpSplit(p);
  const b = previewPumpBundle({ raised: EXAMPLE_RAISE, launchFeeBps: p?.launchFeeBps ?? 100, reserveBps: 3_000, bundleSupplyBps: 1_500 });
  const sellTokens = b.bundleTokens / EXAMPLE_SELL_FRACTION;
  const sellCost = b.bundleSol / EXAMPLE_SELL_FRACTION;
  const proceeds = BigInt(Math.round(Number(sellCost) * EXAMPLE_RALLY));
  const profit = proceeds - sellCost;
  const toBackers = (profit * BigInt(Math.round(s.backerPct * 100))) / 10_000n;
  const toPool = profit - toBackers;
  const yours = (toBackers * EXAMPLE_DEPOSIT) / EXAMPLE_RAISE;
  return { s, b, sellTokens, sellCost, proceeds, profit, toBackers, toPool, yours };
}

export const howItWorks: DocPage = {
  slug: "how-it-works",
  group: "Start",
  nav: "How it works (2 min)",
  title: "How it works",
  description:
    "Back a token before it launches on pump.fun. Your SOL makes the first buy, a vault agent trades it under on-chain limits, and backers keep most of the profit.",
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
                {s.launchFeePct}% launch fee, on its very first buy: the <Term k="bundle" split={s} />. Nobody can trade before it.
                Part of the raise stays as SOL. Both sit in the launch&rsquo;s <Term k="vault" split={s} />.
              </li>
              <li>
                <B>Earn.</B> Only the <Term k="vaultAgent" split={s} /> trades the vault: it sells into rallies above the vault&rsquo;s
                average cost and buys back dips, never more than its per-window caps, never below cost. Each time it sells at a
                profit, {s.backerPct}% of that profit is credited to backers by deposit share (<Term k="backerEarnings" split={s} />)
                and {s.burnPct}% goes to the <Term k="buybackPool" split={s} />, which buys the Holdfast token and burns it.
              </li>
            </Ol>
            <P>
              Buying and selling the token itself happens on pump.fun; every launch page links there. Holdfast earns only the{" "}
              {s.launchFeePct}% launch fee and a small create fee, and the creator earns 0% of fees: pump.fun&rsquo;s creator fee goes{" "}
              {s.backerPct}% into the vault as more market-making capital and {s.burnPct}% to the same buyback pool.
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
              Say a raise closes at {sol(EXAMPLE_RAISE)} and you put in {sol(EXAMPLE_DEPOSIT)}, a 10% share. The creator kept a 30% SOL
              reserve and capped the bundle at 15% of supply. At launch:
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
                ["Market cap right after the bundle", `≈ ${fmtSolValue(x.b.marketCapAfter)} SOL`],
              ]}
            />
            <P>
              Weeks later the price rallies to 1.5× the vault&rsquo;s average cost and the agent sells a tenth of its tokens into it:
            </P>
            <Table
              head={["The rally sell", "Amount"]}
              rows={[
                [`Tokens sold (${fmtTokens(x.sellTokens)})`, `cost ${sol(x.sellCost)} → sold for ${sol(x.proceeds)}`],
                ["Cost part, back to vault SOL", sol(x.sellCost)],
                ["Realized profit", sol(x.profit)],
                [
                  <>
                    To backers ({s.backerPct}%), by deposit share (<Term key="e" k="backerEarnings" split={s} />)
                  </>,
                  sol(x.toBackers),
                ],
                [
                  <>
                    To the <Term key="p" k="buybackPool" split={s} /> ({s.burnPct}%)
                  </>,
                  sol(x.toPool),
                ],
                ["Your 10% share, claimable now", sol(x.yours)],
              ]}
            />
            <P>
              The cost part goes back into vault SOL, so the agent has more to buy the next dip with, and the cycle repeats as long as
              the token trades. Nothing here is a promise: a token that never rallies above the vault&rsquo;s cost pays nothing, and a
              token that falls stays down until it doesn&rsquo;t. The numbers are the program&rsquo;s own bundle maths from{" "}
              <C>previewPumpBundle</C>; a real launch&rsquo;s fills differ by its venue fees and price.
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
                <B>The coin dies.</B> Once a launch is {WIND_DOWN_RULE}, anyone can run the <Term k="windDown" split={s} />: the
                vault&rsquo;s tokens are sold back into the venue and all of the vault&rsquo;s SOL is credited to backers.
              </li>
              <li>
                <B>The vault agent goes offline.</B> Nothing moves; the vault just sits. Its limits are enforced by the program, not
                the agent, so a stolen agent key can&rsquo;t extract anything either.
              </li>
            </Ul>
            <Callout tone="warn" title="The vault can be withdrawn">
              The platform admin (a Squads multisig on mainnet) can withdraw a vault&rsquo;s SOL and tokens with{" "}
              <C>admin_withdraw_vault</C>. Every withdrawal is on-chain and listed on the launch page. See <A href="/docs/risks">Risks</A>.
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
                ["Live", <C key="l">launch_pump</C>, "Public trading on pump.fun, vault-agent trades, profit claims."],
                ["Refunding", <><C>cancel_launch</C>, or <C>refund</C> after a missed minimum</>, "Every backer takes back 100% of their deposit."],
                [
                  "Wound down",
                  <C key="w">wind_down_pump</C>,
                  `After ${WIND_DOWN_MIN_AGE_SECS / 86_400} days, ${WIND_DOWN_IDLE_SECS / 3_600} idle hours and no outside holder. The vault's SOL was credited to backers; claims keep working.`,
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
  description: "Fund the first buy, get a share of every trading fee for the life of the launch, and never be the exit liquidity for the bundle.",
  sections: ({ p }) => [
    {
      id: "backing",
      title: "Backing a raise",
      body: (
        <>
          <Ol>
            <li>Open a launch that is raising and enter an amount. Deposits are clipped to the room left under the max raise and to the per-wallet cap, so you never overpay.</li>
            <li>Whitelisted raises accept only listed wallets; the app builds the Merkle proof for you.</li>
            <li>When the raise launches, your SOL has bought the bundle — the first slice of supply — and it sits in the vault.</li>
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
          <P>
            {p ? (
              <>
                Every public trade pays a {pctFromBps(p.tradeFeeBps)} fee; {pctFromBps(p.backerFeeShareBps)} of it accrues to backers,
                pro-rata to their deposit.
              </>
            ) : (
              "Every public trade pays a fee; the backers' share accrues pro-rata to their deposit."
            )}{" "}
            So does <B>100% of the vault agent&rsquo;s realized profit</B>: when it sells above the vault&rsquo;s average cost, the
            difference goes to backers, not the vault. The program tracks both with a fee-per-share accumulator, so your claimable
            amount is exact at any moment and never expires. Vault-agent trades pay no fee.
          </P>
          {p ? (
            <Figure caption="From /api/platform — each launch freezes these at creation.">
              <SplitBar params={p} />
            </Figure>
          ) : null}
          <Figure>{DEMO.claim}</Figure>
        </>
      ),
    },
    {
      id: "claiming",
      title: "Claiming",
      body: (
        <P>
          <C>claim_backer_fees</C> pays everything accrued to your deposit so far: fee share, profit share and, if the launch wound
          down, your share of its SOL. Claim per launch from the token page, or all at once from <A href="/portfolio">Portfolio</A>.
          Zero volume pays zero — earnings come only from real trades and wind-down.
        </P>
      ),
    },
    {
      id: "wind-down",
      title: "When a launch winds down",
      body: (
        <P>
          Once a launch is {WIND_DOWN_RULE}, anyone can call <C>wind_down</C>. The vault&rsquo;s tokens go back to the curve and the
          curve&rsquo;s and vault&rsquo;s SOL is credited to backers pro-rata; trading ends. See <A href="/docs/the-vault">The vault</A>.
        </P>
      ),
    },
    {
      id: "admin-withdraw",
      title: "What the admin can do",
      body: (
        <Callout tone="warn" title="The vault can be withdrawn">
          The platform admin can withdraw vault SOL and tokens with <C>admin_withdraw_vault</C>. Your accrued earnings and the
          curve&rsquo;s liquidity are out of its reach, and every withdrawal is shown on the launch page. See{" "}
          <A href="/docs/risks">Risks</A>.
        </Callout>
      ),
    },
  ],
};

export const forCreators: DocPage = {
  slug: "for-creators",
  group: "Guides",
  nav: "For creators",
  title: "For creators",
  description: "Launch in one transaction with a fixed supply, a bundle only the vault agent trades, and a share of every trade.",
  sections: ({ p }) => [
    {
      id: "create",
      title: "Creating a launch",
      body: (
        <>
          <P>
            <C>create_launch</C> mints exactly 1,000,000,000 tokens (6 decimals) to the curve and revokes the mint authority in the same
            instruction. There is no freeze authority. It also copies the fee split and the agent limits into the launch, where they
            can never change.
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
              ["Max bundle", p ? `${LIMITS.minBundleSupplyBps / 100}% to ${pctFromBps(p.maxBundleSupplyBps)} of supply` : `From ${LIMITS.minBundleSupplyBps / 100}% of supply`],
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
          At launch the program takes the {p ? pctFromBps(p.launchFeeBps) : ""} launch fee from the raise, keeps your chosen reserve
          share as SOL in the vault, and spends the rest buying on the curve — capped at your max bundle share of supply. SOL beyond the
          cap also stays in the vault. The bigger the raise, the higher the starting market cap.
        </P>
      ),
    },
    {
      id: "creator-fees",
      title: "Creator fees",
      body: (
        <P>
          {p
            ? `${pctFromBps(p.creatorFeeShareBps)} of every trade fee — ${pctFromBps((p.tradeFeeBps * p.creatorFeeShareBps) / 10_000)} of volume — accrues to the creator wallet.`
            : "A fixed share of every trade fee accrues to the creator wallet."}{" "}
          Claim it any time with <C>claim_creator_fees</C>, even after a wind-down. You can&rsquo;t touch the vault; only the vault
          agent trades it, and only the platform admin can withdraw it.
        </P>
      ),
    },
  ],
};

export const forTraders: DocPage = {
  slug: "for-traders",
  group: "Guides",
  nav: "For traders",
  title: "For traders",
  description: "One curve per launch, no migration, a known fee, and a vault that trades against you only inside published rules.",
  sections: ({ p }) => [
    {
      id: "curve",
      title: "The curve",
      body: (
        <>
          <P>
            Each launch trades on its own constant-product curve: <C>x · y = k</C>, where <C>x</C> is{" "}
            {p ? `${lamportsToSol(p.virtualSolReserves)} SOL of virtual reserves` : "virtual SOL reserves"} plus the real SOL in the
            curve and <C>y</C> the tokens left in it. Spot price is <C>x / y</C>. This is the legacy venue of the two launches created before pump.fun
            launches; its liquidity never migrates to a DEX and no instruction takes it out while anyone outside the curve and vault
            holds the token. New launches trade on pump.fun instead (see Venues).
          </P>
          <P>
            Sells can only pay out real SOL in the curve, so the curve stops quoting at the price where its real SOL reaches zero:
            the price it started at. That&rsquo;s a property of the curve&rsquo;s math, not a promise about what a token is worth.
          </P>
        </>
      ),
    },
    {
      id: "fees-slippage",
      title: "Fees, impact and slippage",
      body: (
        <Ul>
          <li>{p ? `${pctFromBps(p.tradeFeeBps)} fee` : "A fixed fee"} on every buy (taken from the SOL in) and sell (from the SOL out).</li>
          <li>Quotes use the program&rsquo;s exact integer maths; the trade panel shows price impact and the minimum you&rsquo;ll receive.</li>
          <li>Slippage sets that minimum. If price moves past it while you sign, the transaction fails instead of filling worse.</li>
        </Ul>
      ),
    },
    {
      id: "reading-the-band",
      title: "Reading the band",
      body: (
        <P>
          The chart shows the on-chain <EmaTerm p={p} /> and the agent band around it. Orange diamonds are vault-agent trades: it can
          only buy below the lower edge and sell above the upper one, within its per-window budget — see{" "}
          <A href="/docs/agents">the vault agent</A>. Agent trades are tagged in every trades table.
        </P>
      ),
    },
    {
      id: "what-it-isnt",
      title: "What this doesn't protect",
      body: (
        <Callout tone="warn" title="Other holders can still sell">
          The bundle is held in the vault and traded only by the rate-limited agent, but any other holder can sell at any time, the
          platform admin can withdraw a vault, and price can fall like any token. See <A href="/docs/risks">Risks</A>.
        </Callout>
      ),
    },
  ],
};
