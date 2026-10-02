import { lamportsToSol, PROGRAM_ID, shortAddr } from "@holdfast/sdk";
import { CLUSTER_NAME } from "@/lib/env";
import { fmtSolValue } from "@/lib/format";
import { explorerAddress } from "@/lib/explorer";
import { BUYBACK_MINT_UNSET, fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import { pctFromBps } from "../../band/model";
import { Term } from "../../glossary";
import { SplitBar } from "../../landing/fee-split";
import { InstructionList } from "../../landing/instruction-list";
import { instructionRows, windDownRule } from "../../landing/instructions";
import { DEMO, EmaTerm } from "../../landing/launch-steps";
import { ProofTiles } from "../../landing/proof-tiles";
import { A, B, C, Callout, Code, Figure, Ol, P, Table, Ul } from "../prose";
import { paybackSentence } from "../rules";
import type { DocPage } from "../types";

export const theVault: DocPage = {
  slug: "the-vault",
  group: "Protocol",
  nav: "The vault",
  title: "The vault",
  description: "Where the bundle lives: a program-owned account per launch, what can move it, where its proceeds go, how it pays backers back, and how it winds down.",
  sections: ({ p, seed }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "what-is-in-it",
        title: "What's in it",
        body: (
          <>
            <P>
              At launch the bundle tokens and the SOL reserve move into the launch&rsquo;s vault: a token account at a program address
              derived from the launch (<C>[&quot;vault&quot;, launch]</C>) plus SOL held on the launch account. Only the program can sign
              for it. The bundle plus the reserve is recorded as <C>initial_vault_sol</C>, what went in at launch; the payback rule
              measures the vault against it.
            </P>
            <Figure>{DEMO.theBundle}</Figure>
          </>
        ),
      },
      {
        id: "venues",
        title: "Venues",
        body: (
          <>
            <P>
              Every launch has a venue. New launches are <B>pump.fun tokens</B>: the raise seeds the launch with a one-time create key,
              and <C>launch_pump</C> creates the token on pump.fun with the launch itself as the token&rsquo;s creator and buys the
              bundle on pump.fun&rsquo;s bonding curve in the same instruction, before any public trade can exist. Public trading happens
              on pump.fun (and on PumpSwap once the curve completes and <C>graduate_pump</C> records the pool), never on this site;
              there is no Holdfast trade fee on these launches. The vault agent trades the vault on that venue under the rules on{" "}
              <A href="/docs/agents">the vault agent</A>.
            </P>
            <P>
              The two launches created before this change trade on the <B>Holdfast curve</B>, the program&rsquo;s own constant-product
              market with a {p ? pctFromBps(p.tradeFeeBps) : ""} trade fee split between backers, creator and platform and liquidity
              that never migrates. New launches on that curve are closed (<C>holdfast_curve_enabled</C> is off on mainnet). The vault
              rules below apply to both venues.
            </P>
          </>
        ),
      },
      {
        id: "who-can-move-it",
        title: "Who can move it",
        body: (
          <>
            <P>
              The creator has no instruction that touches the vault. These do, and each emits an event the launch page shows:
            </P>
            <Table
              head={["Instruction", "Signer", "What it moves"]}
              rows={[
                [<C key="a">agent_buy / agent_sell</C>, "Agent authority", "Value between the vault and the launch's venue, inside the agent rules; sell proceeds stay in the vault"],
                [<C key="f">collect_pump_fees</C>, "Anyone", `pump.fun creator fees: ${s.vaultPct}% into the vault, ${s.burnPct}% to the buyback pool, ${s.backerPct}% to backers`],
                [<C key="p">payout_backers</C>, "Agent authority, once eligible", `Vault SOL to backers: the principal, then ${s.payoutSharePct}% of the vault at most every ${fmtInterval(s.payoutIntervalHours)}`],
                [<C key="w">wind_down_pump</C>, "Anyone, once eligible", "Vault tokens sold into the venue; all vault SOL to backers"],
                [<C key="x">admin_withdraw_vault</C>, "Platform admin (2-of-3 Squads multisig)", "Any amount of vault SOL and tokens to the platform fee recipient"],
                [<C key="d">dev_withdraw_vault</C>, "Dev key (one key, set by the admin)", "Any amount of vault SOL and tokens to the dev key's own wallet"],
              ]}
            />
            <Callout tone="warn" title="The admin and the dev key can withdraw a vault">
              <C>admin_withdraw_vault</C> lets the platform admin, a 2-of-3 Squads multisig on mainnet, send a vault&rsquo;s SOL and
              tokens to the platform fee recipient; <C>dev_withdraw_vault</C> lets a single dev key (the platform&rsquo;s{" "}
              <C>dev_authority</C>, set by the admin) send them to its own wallet, even while the platform is paused. Neither can touch
              the token&rsquo;s liquidity, what backers have already accrued or the buyback pool. Every withdrawal is an on-chain event (
              <C>VaultWithdrawn</C> or <C>VaultWithdrawnByDev</C>) listed on the launch page. See <A href="/docs/risks">Risks</A>.
            </Callout>
          </>
        ),
      },
      {
        id: "vault-proceeds",
        title: "Vault proceeds",
        body: (
          <>
            <P>
              When the agent sells, the whole fill stays in the vault as liquid SOL. Nothing is split off: that SOL is the agent&rsquo;s
              capital for buying back dips and giving the chart volume when it slows, and it is what the vault is measured by. The vault
              is meant to grow.
            </P>
            <P>
              pump.fun&rsquo;s creator fee on the token adds to it. Each <C>collect_pump_fees</C> sweep (permissionless) sends{" "}
              {s.vaultPct}% to the vault as SOL, {s.burnPct}% to the launch&rsquo;s <Term k="buybackPool" split={s} /> and {s.backerPct}%
              to backers through the fee-per-share accumulator, claimable with <C>claim_backer_fees</C>. The creator wallet gets 0%.{" "}
              <C>buyback_burn</C> (signed by the agent authority, at most once a minute per launch) spends the pool on the Holdfast token
              and burns what it bought; every burn is listed on the launch page.
              {p?.buybackMint === BUYBACK_MINT_UNSET ? " The Holdfast token isn’t live yet, so the pools keep accruing until it is." : null}
            </P>
            {seed && seed.profitSharedSol > 0 ? (
              <P>
                Before October 2026 a share of each sell above cost was paid straight to backers; ${seed.symbol} paid{" "}
                {fmtSolValue(seed.profitSharedSol)} SOL that way under the old model. Launches since keep everything in the vault.
              </P>
            ) : null}
          </>
        ),
      },
      {
        id: "backer-payback",
        title: "Backer payback",
        body: (
          <>
            <P>
              {paybackSentence(s)} It is opportunistic, not a goal: <C>payout_backers</C> is signed by the agent authority only, and it
              runs only when every condition holds at the check.
            </P>
            <Ul>
              <li>
                The vault&rsquo;s <B>liquid SOL</B> is at least {fmtMult(s.payoutMult)} <C>initial_vault_sol</C>. Tokens don&rsquo;t count.
              </li>
              <li>
                The chart is <B>strong</B>: price above the EMA band, real buy flow, not in a drawdown. If it isn&rsquo;t, nothing is paid
                and the agent keeps the SOL for buy-backs.
              </li>
              <li>
                The <B>first</B> payout repays the principal, <C>initial_vault_sol</C>, pro-rata to deposit. Every later payout is{" "}
                {s.payoutSharePct}% of the vault&rsquo;s SOL.
              </li>
              <li>
                Never more than <B>one payout per {fmtInterval(s.payoutIntervalHours)}</B>; the principal payout starts the clock too.
              </li>
              <li>
                No payout, and no agent buy, may take the vault below its <Term k="vaultFloor" split={s} />, <C>min_vault_sol</C> (
                {s.minVaultSol} SOL on mainnet), kept for fees and rent.
              </li>
            </Ul>
            <P>
              Each payout emits <C>BackersPaid</C> and shows on the launch page as the principal or a {s.payoutSharePct}% payout;
              backers claim it with <C>claim_backer_fees</C>. A vault that never reaches {fmtMult(s.payoutMult)} pays nothing beyond
              its share of creator fees.
            </P>
          </>
        ),
      },
      {
        id: "wind-down",
        title: "Wind-down",
        body: (
          <>
            <P>
              Anyone can call <C>wind_down_pump</C> on a live launch that is {windDownRule(s)}. Outside holdings are measured from real
              balances: the mint&rsquo;s supply minus the vault&rsquo;s and the venue&rsquo;s own token accounts. The vault sells what it
              holds into the venue and all of its SOL is credited to backers pro-rata, claimable with <C>claim_backer_fees</C>. That
              can be less than what went in: it is the worst case, not a refund.
            </P>
            <P>
              The launch then shows <B>Wound down</B>: agent trades stop for good. Backer claims keep working; the buyback pool stays
              for its crank.
            </P>
          </>
        ),
      },
      {
        id: "cost-basis",
        title: "Average cost",
        body: (
          <P>
            The vault tracks the SOL cost of the tokens it holds (average-cost method). Agent buys add their SOL to the cost; agent sells
            remove the sold tokens&rsquo; share of it. That average is what the agent rules compare fills against, so the vault never
            buys above its cost and never sells below cost plus the band.
            {seed ? (
              <>
                {" "}
                ${seed.symbol}&rsquo;s vault is at <A href={explorerAddress(seed.address)}>{shortAddr(seed.address)}</A>.
              </>
            ) : null}
          </P>
        ),
      },
    ];
  },
};

export const agents: DocPage = {
  slug: "agents",
  group: "Protocol",
  nav: "The vault agent",
  title: "The vault agent",
  description: "A single rate-limited signer that trades each vault on its venue: selling slowly into strength, buying back dips with what it sold, and paying backers back when the vault has grown.",
  sections: ({ p, platform }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "what-it-does",
        title: "What it does",
        body: (
          <>
            <P>
              The agent sells slowly into strength: the higher the market-cap multiple and the more real buy volume, the more it may
              sell, sized so it doesn&rsquo;t hurt the chart. It buys back dips and gives the chart volume when it slows, using what it
              sold. All sell proceeds stay in the vault as SOL, so a well-traded vault grows.
            </P>
            <P>{paybackSentence(s)}</P>
          </>
        ),
      },
      {
        id: "rules",
        title: "The rules, on-chain",
        body: (
          <>
            <P>
              Limits are copied into each launch at creation (<C>terms</C>); the values below are today&rsquo;s defaults from{" "}
              <C>/api/platform</C>. The program checks every one of them on each agent trade.
            </P>
            <Table
              head={["Rule", "Buy (agent_buy)", "Sell (agent_sell)"]}
              rows={[
                [
                  "Price vs EMA",
                  p ? `Spot ≤ EMA − ${pctFromBps(p.agentBandBps)}` : "Spot ≤ EMA − band",
                  p ? `Spot ≥ EMA + ${pctFromBps(p.agentBandBps)}` : "Spot ≥ EMA + band",
                ],
                [
                  "Fill vs vault cost",
                  "Fill ≤ vault average cost, or a buy-back ≥ band under the average agent sell",
                  p ? `Fill ≥ vault average cost + ${pctFromBps(p.agentBandBps)}` : "Fill ≥ vault average cost + band",
                ],
                [
                  "Budget per window",
                  p ? `≤ ${pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL per ${Math.round(p.agentWindowSecs / 60)} min` : "Share of vault SOL per window",
                  p ? `≤ ${pctFromBps(p.agentSellBpsPerWindow)} of vault tokens per ${Math.round(p.agentWindowSecs / 60)} min` : "Share of vault tokens per window",
                ],
                ["Price impact", p ? `≤ ${pctFromBps(p.agentMaxImpactBps)}` : "Capped", p ? `≤ ${pctFromBps(p.agentMaxImpactBps)}` : "Capped"],
                ["Vault floor", `Vault SOL stays ≥ ${s.minVaultSol} SOL`, "—"],
                ["Proceeds", "Paid from vault SOL", "Stay in the vault as SOL"],
                ["Fee", "None", "None"],
              ]}
            />
            <Table
              head={["Payback (payout_backers)", "Rule"]}
              rows={[
                ["Signer", "Agent authority only"],
                ["Vault SOL", `≥ ${fmtMult(s.payoutMult)} initial_vault_sol (liquid SOL; tokens don't count)`],
                ["Chart", "Strong: price above the EMA band, real buy flow, not in a drawdown (the agent's own check; the program enforces every other row)"],
                ["Amount", `The principal first, then ${s.payoutSharePct}% of vault SOL`],
                ["Frequency", `At most one payout per ${fmtInterval(s.payoutIntervalHours)}, the principal payout included`],
                ["Floor", `Never below ${s.minVaultSol} SOL (min_vault_sol)`],
              ]}
            />
          </>
        ),
      },
      {
        id: "ema",
        title: "The EMA",
        body: (
          <>
            <P>
              The <EmaTerm p={p} /> is updated by the program at every vault trade, before reserves change:
            </P>
            <Code label="update_ema">{`ema += (spot − ema) · dt / (dt + period)   // dt = seconds since the last trade${p ? `, period = ${p.emaPeriodSecs}s` : ""}`}</Code>
            <P>A single large trade moves the EMA only a little, so a dump opens a gap below the band; that gap is what the agent buys.</P>
          </>
        ),
      },
      {
        id: "operation",
        title: "Who runs it",
        body: (
          <>
            <P>
              The agent is an off-chain service holding the platform&rsquo;s agent authority key
              {platform ? (
                <>
                  {" "}
                  (<A href={explorerAddress(platform.agentAuthority)}>{shortAddr(platform.agentAuthority)}</A>)
                </>
              ) : null}
              . It evaluates each live launch every tick and reports its decision with a plain-English reason at{" "}
              <A href="/agents">/agents</A>. It trades a little inside the on-chain limits (a small safety margin at the band edge) so
              its transactions don&rsquo;t fail on EMA drift. An optional language model writes a plain-English note for each decision;
              it never decides trades.
            </P>
            <Callout title="If the agent is offline">
              Vaults stop trading and no payback runs until it&rsquo;s back; public trading on the venue carries on. The admin can also
              pause agents (<C>agents_paused</C>); the pause is visible in <C>/api/platform</C>.
            </Callout>
            <Figure>{DEMO.agentDefends}</Figure>
          </>
        ),
      },
    ];
  },
};

export const fees: DocPage = {
  slug: "fees",
  group: "Protocol",
  nav: "Fees",
  title: "Fees",
  description: "Every fee the program charges, where it goes, and why it can't change for a launch you backed.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "all-fees",
        title: "All fees",
        body: (
          <Table
            head={["Fee", "Amount", "Paid by", "Goes to"]}
            rows={[
              ["Launch fee", `${s.launchFeePct}% of the raise`, "The raise, at launch", "Platform"],
              ["Create fee", p ? `${lamportsToSol(p.createFeeLamports)} SOL` : "—", "Creator", "Platform fee recipient"],
              ["pump.fun trade fee", "pump.fun's own", "Public buys and sells on pump.fun", "pump.fun; its creator-fee part to the launch (below)"],
              [
                "pump.fun creator fee",
                "Set by pump.fun",
                "Public trades of the token",
                `${s.vaultPct}% vault SOL · ${s.burnPct}% buyback-and-burn pool · ${s.backerPct}% backers (collect_pump_fees)`,
              ],
              ["Agent trades", "0", "—", "Sell proceeds stay in the vault"],
              ["Backer payback", `Principal, then ${s.payoutSharePct}% of vault SOL per payout`, `The vault, once ≥ ${fmtMult(s.payoutMult)} its start`, "Backers, pro-rata"],
              ["Refunds", "0", "—", "—"],
              ["Legacy curve trade fee", p ? pctFromBps(p.tradeFeeBps) : "—", "Public buys and sells on the Holdfast curve", "Backers, creator, platform (split below)"],
            ]}
          />
        ),
      },
      {
        id: "holdfast-earns",
        title: "What Holdfast earns",
        body: (
          <P>
            Only the {s.launchFeePct}% launch fee and the create fee. The creator earns 0% of fees on pump.fun launches. Platform fees
            are swept by the permissionless <C>sweep_platform_fees</C>, which can only pay the configured recipient.
          </P>
        ),
      },
      {
        id: "split",
        title: "Legacy curve: the trade fee split",
        body: p ? (
          <Figure caption="Applies only to the two launches on the Holdfast curve; each keeps the split it was created with.">
            <SplitBar params={p} />
          </Figure>
        ) : (
          <P>Couldn&rsquo;t load the fee split from the indexer.</P>
        ),
      },
      {
        id: "frozen",
        title: "Frozen per launch",
        body: (
          <P>
            Creating a launch copies the launch fee, the creator-fee split, the payback rule, the vault floor and every agent limit into
            the launch account&rsquo;s <C>terms</C>. <C>update_platform</C> only changes defaults for launches created afterwards.
          </P>
        ),
      },
    ];
  },
};

export const verify: DocPage = {
  slug: "verify",
  group: "Protocol",
  nav: "Verify on-chain",
  title: "Security & verification",
  description: "Check every claim yourself: the program, its authorities, a mint, a vault, and the instruction list.",
  sections: ({ p, facts, platform, seed }) => [
    {
      id: "checklist",
      title: "The checklist",
      body: (
        <>
          <Ol>
            <li>
              Program <A href={explorerAddress(PROGRAM_ID.toBase58())}>{shortAddr(PROGRAM_ID.toBase58())}</A> is deployed and
              executable.
            </li>
            <li>A launch&rsquo;s mint shows no mint authority and no freeze authority, and a supply of exactly 1,000,000,000.</li>
            <li>
              <C>launch_pump</C> does pump.fun&rsquo;s <C>create</C> and the bundle <C>buy</C> in one instruction of one transaction,
              so no trade can happen before the bundle: the launch transaction is the token&rsquo;s first.
            </li>
            <li>
              The vault is the program address <C>[&quot;vault&quot;, launch]</C>: only the program can sign for it, through the
              agent trades, <C>payout_backers</C>, <C>wind_down_pump</C>, <C>admin_withdraw_vault</C> and <C>dev_withdraw_vault</C>.
            </li>
            <li>The launch account&rsquo;s <C>terms</C> hold the fee split, the payback rule and the agent limits you backed under.</li>
            <li>
              The platform account&rsquo;s <C>admin</C> is the only key that can call <C>admin_withdraw_vault</C>, and its{" "}
              <C>fee_recipient</C> is where those withdrawals go; its <C>dev_authority</C> is the only key that can call{" "}
              <C>dev_withdraw_vault</C>, which pays the dev key itself
              {platform ? (
                <>
                  {" "}
                  (admin <A href={explorerAddress(platform.admin)}>{shortAddr(platform.admin)}</A>, recipient{" "}
                  <A href={explorerAddress(platform.feeRecipient)}>{shortAddr(platform.feeRecipient)}</A>, dev key{" "}
                  {platform.devAuthority ? <A href={explorerAddress(platform.devAuthority)}>{shortAddr(platform.devAuthority)}</A> : "none set"})
                </>
              ) : null}
              .
            </li>
            <li>
              Every withdrawal is a <C>VaultWithdrawn</C> (admin) or <C>VaultWithdrawnByDev</C> (dev key) event: it&rsquo;s listed on
              the launch page and at <C>/api/launches/:mint/activity?type=vault_withdrawn</C>. Every payback is a <C>BackersPaid</C>{" "}
              event (<C>?type=backers_paid</C>).
            </li>
          </Ol>
          <Figure caption={`Read live from ${CLUSTER_NAME} on the server; each tile links to the account.`}>
            <ProofTiles facts={facts} platform={platform} example={seed} />
          </Figure>
        </>
      ),
    },
    {
      id: "derive",
      title: "Derive the accounts yourself",
      body: (
        <Code label="TypeScript · @holdfast/sdk">{`import { PublicKey } from "@solana/web3.js";
import { launchPda, vaultPda, curvePda } from "@holdfast/sdk";

const mint = new PublicKey("${seed?.mint ?? "<mint>"}");
const launch = launchPda(mint);       // ["launch", mint]
const vault = vaultPda(launch);       // ["vault", launch]
const curve = curvePda(launch);       // ["curve", launch]`}</Code>
      ),
    },
    {
      id: "instructions",
      title: "Every instruction",
      body: (
        <Figure>
          <InstructionList rows={instructionRows(pumpSplit(p))} />
        </Figure>
      ),
    },
    {
      id: "trust",
      title: "What you still trust",
      body: (
        <Ul>
          <li>
            <B>The upgrade authority.</B>{" "}
            {facts.upgradeAuthority.state === "known" && facts.upgradeAuthority.value
              ? `The program is upgradeable by ${shortAddr(facts.upgradeAuthority.value)}; an upgrade could change any rule.`
              : "Check whether the program is upgradeable on the explorer; an upgrade could change any rule."}
          </li>
          <li>
            <B>The admin</B> can withdraw any vault&rsquo;s SOL and tokens to the fee recipient with <C>admin_withdraw_vault</C>
            (never what backers have already accrued), pause new launches and deposits, pause the agent, set the dev key, and change
            defaults for future launches, not the terms of existing ones.
          </li>
          <li>
            <B>The dev key</B>, a single key, can withdraw any vault&rsquo;s SOL and tokens to its own wallet with{" "}
            <C>dev_withdraw_vault</C>, under the same limits and even while the platform is paused. Every one of its withdrawals is a{" "}
            <C>VaultWithdrawnByDev</C> event on the launch page.
          </li>
          <li>
            <B>The agent operator</B> decides when to trade and when to pay backers within the rules; it can&rsquo;t break them, and
            it can&rsquo;t send vault SOL anywhere but the venue and the backers&rsquo; accumulator.
          </li>
        </Ul>
      ),
    },
  ],
};
