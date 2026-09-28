import { lamportsToSol, PROGRAM_ID, shortAddr } from "@holdfast/sdk";
import { CLUSTER_NAME } from "@/lib/env";
import { explorerAddress } from "@/lib/explorer";
import { pctFromBps } from "../../band/model";
import { SplitBar } from "../../landing/fee-split";
import { InstructionList } from "../../landing/instruction-list";
import { instructionRows } from "../../landing/instructions";
import { DEMO, EmaTerm } from "../../landing/launch-steps";
import { ProofTiles } from "../../landing/proof-tiles";
import { SimulatorPanel } from "../../landing/simulator-panel";
import { A, B, C, Callout, Code, Figure, Ol, P, Table, Ul } from "../prose";
import type { DocPage } from "../types";

export const theVault: DocPage = {
  slug: "the-vault",
  group: "Protocol",
  nav: "The vault",
  title: "The vault",
  description: "Where the bundle lives: a program-owned account per launch that no instruction can empty.",
  sections: ({ seed }) => [
    {
      id: "what-is-in-it",
      title: "What's in it",
      body: (
        <>
          <P>
            At launch the bundle tokens and the SOL reserve move into the launch&rsquo;s vault — a Token-2022 account at a program
            address derived from the launch (<C>[&quot;vault&quot;, launch]</C>) plus SOL held on the launch account. Only the program
            can sign for it.
          </P>
          <Figure>{DEMO.theLock}</Figure>
        </>
      ),
    },
    {
      id: "no-withdraw",
      title: "There is no withdraw",
      body: (
        <>
          <P>
            The program has no instruction that sends vault tokens or vault SOL to a wallet — not for the creator, the admin or the
            agent. The only instructions that touch the vault are <C>agent_buy</C> and <C>agent_sell</C>, and both move value between
            the vault and <B>the same launch&rsquo;s curve</B>.
          </P>
          <Callout tone="accent" title="withdraw_vault does not exist">
            Every instruction is listed on <A href="/docs/program">Program reference</A>, generated from the IDL.
          </Callout>
        </>
      ),
    },
    {
      id: "cost-basis",
      title: "Average cost",
      body: (
        <P>
          The vault tracks the SOL cost of the tokens it holds (average-cost method). Agent buys add their SOL to the cost; agent sells
          remove the sold tokens&rsquo; share of it. That average is what the agent rules compare fills against, so the vault never buys
          above its cost and never sells below cost plus the band.
          {seed ? (
            <>
              {" "}
              ${seed.symbol}&rsquo;s vault is at{" "}
              <A href={explorerAddress(seed.address)}>{shortAddr(seed.address)}</A>.
            </>
          ) : null}
        </P>
      ),
    },
  ],
};

export const agents: DocPage = {
  slug: "agents",
  group: "Protocol",
  nav: "The vault agent",
  title: "The vault agent",
  description: "A single rate-limited signer that trades each vault against its own curve — buying dips below cost, selling rallies above it.",
  sections: ({ p, platform }) => [
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
                "Fill ≤ vault average cost, or a buy-back ≥ band under the average agent sell, paid from sell proceeds",
                p ? `Fill ≥ vault average cost + ${pctFromBps(p.agentBandBps)}` : "Fill ≥ vault average cost + band",
              ],
              [
                "Budget per window",
                p ? `≤ ${pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL per ${Math.round(p.agentWindowSecs / 60)} min` : "Share of vault SOL per window",
                p ? `≤ ${pctFromBps(p.agentSellBpsPerWindow)} of vault tokens per ${Math.round(p.agentWindowSecs / 60)} min` : "Share of vault tokens per window",
              ],
              ["Price impact", p ? `≤ ${pctFromBps(p.agentMaxImpactBps)}` : "Capped", p ? `≤ ${pctFromBps(p.agentMaxImpactBps)}` : "Capped"],
              ["Fee", "None", "None"],
            ]}
          />
        </>
      ),
    },
    {
      id: "simulator",
      title: "Try it",
      body: (
        <Figure caption="Drag the price: the decision is the program's arithmetic on a live launch's vault, curve and terms.">
          <SimulatorPanel />
        </Figure>
      ),
    },
    {
      id: "ema",
      title: "The EMA",
      body: (
        <>
          <P>
            The <EmaTerm p={p} /> is updated by the program at every trade, before reserves change:
          </P>
          <Code label="update_ema">{`ema += (spot − ema) · dt / (dt + period)   // dt = seconds since the last trade${p ? `, period = ${p.emaPeriodSecs}s` : ""}`}</Code>
          <P>A single large trade moves the EMA only a little, so a dump opens a gap below the band — that gap is what the agent buys.</P>
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
            its transactions don&rsquo;t fail on EMA drift.
          </P>
          <Callout title="If the agent is offline">
            Vaults stop trading until it&rsquo;s back; nothing can leave them either way, and public trading carries on. The admin can
            also pause agents (<C>agents_paused</C>) — the pause is visible in <C>/api/platform</C>.
          </Callout>
          <Figure>{DEMO.agentDefends}</Figure>
        </>
      ),
    },
  ],
};

export const fees: DocPage = {
  slug: "fees",
  group: "Protocol",
  nav: "Fees",
  title: "Fees",
  description: "Every fee the program charges, where it goes, and why it can't change for a launch you backed.",
  sections: ({ p }) => [
    {
      id: "split",
      title: "The trade fee split",
      body: p ? (
        <Figure caption="Current platform defaults; each launch keeps the split it was created with.">
          <SplitBar params={p} />
        </Figure>
      ) : (
        <P>Couldn&rsquo;t load the fee split from the indexer.</P>
      ),
    },
    {
      id: "all-fees",
      title: "All fees",
      body: (
        <Table
          head={["Fee", "Amount", "Paid by", "Goes to"]}
          rows={[
            ["Trade fee", p ? pctFromBps(p.tradeFeeBps) : "—", "Public buys and sells", "Backers, creator, platform (split above)"],
            ["Launch fee", p ? `${pctFromBps(p.launchFeeBps)} of the raise` : "—", "The raise, at launch", "Platform"],
            ["Create fee", p ? `${lamportsToSol(p.createFeeLamports)} SOL` : "—", "Creator", "Platform fee recipient"],
            ["Agent trades", "0", "—", "—"],
            ["Refunds", "0", "—", "—"],
          ]}
        />
      ),
    },
    {
      id: "frozen",
      title: "Frozen per launch",
      body: (
        <P>
          <C>create_launch</C> copies the trade fee, the split, the launch fee and every agent limit into the launch account&rsquo;s{" "}
          <C>terms</C>. <C>update_platform</C> only changes defaults for launches created afterwards. Platform fees are swept by the
          permissionless <C>sweep_platform_fees</C>, which can only pay the configured recipient.
        </P>
      ),
    },
  ],
};

export const verify: DocPage = {
  slug: "verify",
  group: "Protocol",
  nav: "Verify on-chain",
  title: "Security & verification",
  description: "Check every claim yourself: the program, its authorities, a mint, a vault, and the instruction list.",
  sections: ({ facts, platform, seed }) => [
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
            <li>The vault is the program address <C>[&quot;vault&quot;, launch]</C> — only the program can move its tokens.</li>
            <li>The launch account&rsquo;s <C>terms</C> hold the fee split and agent limits you backed under.</li>
            <li>The instruction list below has nothing that moves vault funds to a wallet.</li>
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
          <InstructionList rows={instructionRows()} />
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
            <B>The admin</B> can pause new launches and deposits, pause the agent, and change defaults for future launches — not the
            terms of existing ones.
          </li>
          <li>
            <B>The agent operator</B> decides when to trade within the rules; it can&rsquo;t break them.
          </li>
        </Ul>
      ),
    },
  ],
};
