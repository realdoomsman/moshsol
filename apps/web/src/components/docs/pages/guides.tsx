import { LIMITS, lamportsToSol } from "@holdfast/sdk";
import { pctFromBps } from "../../band/model";
import { HowStepsStacked } from "../../landing/how-steps";
import { DEMO, EmaTerm, launchSteps } from "../../landing/launch-steps";
import { SplitBar } from "../../landing/fee-split";
import { WIND_DOWN_RULE } from "../../landing/instructions";
import { A, B, C, Callout, Figure, Ol, P, Table, Ul } from "../prose";
import type { DocPage } from "../types";

const days = (s: number) => (s >= 86_400 ? `${s / 86_400} days` : `${Math.round(s / 60)} minutes`);

export const howItWorks: DocPage = {
  slug: "how-it-works",
  group: "Start",
  nav: "How a launch works",
  title: "How a launch works",
  description: "Four beats — raise, buy first, defend, earn — each enforced by an instruction of the Holdfast program.",
  sections: ({ p }) => [
    {
      id: "the-four-beats",
      title: "The four beats",
      body: <HowStepsStacked steps={launchSteps(p)} />,
    },
    {
      id: "lifecycle",
      title: "Lifecycle and states",
      body: (
        <>
          <P>
            A launch account moves through four on-chain states: <C>Raising</C>, <C>Live</C>, <C>Refunding</C> and{" "}
            <C>WoundDown</C>. The UI adds &ldquo;ready to launch&rdquo; (minimum met, not launched yet) and &ldquo;raise failed&rdquo;
            (deadline passed below the minimum) from the clock.
          </P>
          <Table
            head={["State", "Entered by", "What can happen"]}
            rows={[
              ["Raising", <C key="c">create_launch</C>, "Deposits until the deadline or the max raise; the creator may cancel."],
              ["Live", <C key="l">launch</C>, "Public buys and sells, vault-agent trades, fee and profit claims."],
              ["Refunding", <><C>cancel_launch</C>, or <C>refund</C> after a missed minimum</>, "Every backer takes back 100% of their deposit."],
              [
                "Wound down",
                <C key="w">wind_down</C>,
                "No more trading. The curve's and vault's SOL was credited to backers; all fee claims keep working.",
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
          The creator can call <C>launch</C> any time the minimum is met. Anyone can call it once the minimum is met and either the
          deadline has passed or the raise is full — so a creator can&rsquo;t hold a funded raise hostage.
        </P>
      ),
    },
  ],
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
            curve and <C>y</C> the tokens left in it. Spot price is <C>x / y</C>. Liquidity never migrates to a DEX and no instruction
            takes it out while anyone outside the curve and vault holds the token, so the curve is always there to sell into.
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
