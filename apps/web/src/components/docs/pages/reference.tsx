import { IDL, PROGRAM_ID } from "@holdfast/sdk";
import Link from "next/link";
import { CLUSTER, CLUSTER_LABEL, CLUSTER_NAME, INDEXER_URL, IS_TEST_CLUSTER } from "@/lib/env";
import { fmtInterval, fmtMult, pumpSplit } from "@/lib/pump-terms";
import { pctFromBps } from "../../band/model";
import { glossaryRule } from "../../glossary";
import { Lockup } from "../../brand/lockup";
import { Mark } from "../../brand/mark";
import { faqItems } from "../../landing/faq";
import { instructionRows, windDownRule } from "../../landing/instructions";
import { A, B, C, Callout, Code, P, Table, Ul } from "../prose";
import { paybackSentence } from "../rules";
import type { DocPage } from "../types";

type IdlField = { name: string; type: unknown; docs?: string[] };
const idl = IDL as unknown as {
  accounts: { name: string }[];
  events: { name: string }[];
  errors: { code: number; name: string; msg?: string }[];
  types: { name: string; docs?: string[]; type: { kind: string; fields?: IdlField[] } }[];
};
const typeName = (t: unknown): string =>
  typeof t === "string"
    ? t
    : t && typeof t === "object"
      ? "defined" in t
        ? (t as { defined: { name: string } }).defined.name
        : "option" in t
          ? `Option<${typeName((t as { option: unknown }).option)}>`
          : "vec" in t
            ? `Vec<${typeName((t as { vec: unknown }).vec)}>`
            : "array" in t
              ? `[${typeName((t as { array: [unknown, number] }).array[0])}; ${(t as { array: [unknown, number] }).array[1]}]`
              : "unknown"
      : "unknown";

export const overview: DocPage = {
  slug: "",
  group: "Start",
  nav: "Overview",
  title: "Holdfast docs",
  description:
    "Holdfast is the Solana launchpad where backers buy first. Backers' SOL makes a pump.fun token's first buy, which sits in an on-chain vault traded only by a rate-limited agent; the vault keeps what it sells, earns most of the token's creator fees, and pays backers back once it has grown.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "start",
        title: "Start here",
        body: (
          <Table
            head={["If you want to…", "Read"]}
            rows={[
              ["Understand the mechanism in two minutes", <A key="h" href="/docs/how-it-works">How it works (2 min)</A>],
              ["Back a raise and earn", <A key="b" href="/docs/for-backers">For backers</A>],
              ["Launch a token", <A key="c" href="/docs/for-creators">For creators</A>],
              ["Trade", <A key="t" href="/docs/for-traders">For traders</A>],
              ["Check the claims", <A key="v" href="/docs/verify">Verify on-chain</A>],
              ["Build on the data", <A key="a" href="/docs/api">Indexer API</A>],
            ]}
          />
        ),
      },
      {
        id: "numbers",
        title: "The numbers",
        body: (
          <Ul>
            <li>Fixed supply of 1,000,000,000 per launch; the bundle buys at most the creator&rsquo;s cap of it, in the same instruction that creates the token.</li>
            <li>
              pump.fun&rsquo;s creator fee on the token: {s.vaultPct}% to the vault as SOL, {s.burnPct}% to buy back and burn the Holdfast
              token, {s.backerPct}% to backers. Creators earn 0% of fees; Holdfast earns the {s.launchFeePct}% launch fee and the create fee.
            </li>
            <li>
              Everything the vault agent sells stays in the vault. {paybackSentence(s)} Never below the {s.minVaultSol} SOL vault floor.
            </li>
            {p ? (
              <li>
                Agent band {pctFromBps(p.agentBandBps)} around the EMA; buys ≤ {pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL and sells ≤{" "}
                {pctFromBps(p.agentSellBpsPerWindow)} of vault tokens per {Math.round(p.agentWindowSecs / 60)} minutes.
              </li>
            ) : null}
            <li>
              100% refund if a raise misses its minimum; all of the vault&rsquo;s SOL to backers when a dead launch (≤ {s.deadHoldersPct}% of
              supply held outside the vault and pump.fun) is wound down.
            </li>
            <li>
              Vault withdrawals only by the platform admin (<C>admin_withdraw_vault</C>), each one shown on the launch page.
            </li>
          </Ul>
        ),
      },
    ];
  },
};

export const program: DocPage = {
  slug: "program",
  group: "Reference",
  nav: "Program reference",
  title: "Program reference",
  description: "Instructions, accounts, events and errors of the Holdfast program, generated from the IDL shipped in @holdfast/sdk.",
  sections: ({ p }) => [
    {
      id: "address",
      title: "Address",
      body: (
        <P>
          <C>{PROGRAM_ID.toBase58()}</C> on {CLUSTER_NAME}. Anchor IDL: <C>packages/sdk/src/idl/moshsol.json</C>.
        </P>
      ),
    },
    {
      id: "instructions",
      title: "Instructions",
      body: (
        <Table
          head={["Instruction", "Args", "Signer", "Writable accounts"]}
          rows={instructionRows(pumpSplit(p)).map((r) => [
            <C key="n">{r.name}</C>,
            r.args.length ? r.args.map((a) => `${a.name}: ${a.type}`).join(", ") : "—",
            r.accounts.filter((a) => a.signer).map((a) => a.name).join(", ") || "none",
            r.accounts.filter((a) => a.writable).map((a) => a.name).join(", ") || "—",
          ])}
        />
      ),
    },
    {
      id: "accounts",
      title: "Accounts",
      body: (
        <>
          {idl.accounts.map((a) => {
            const t = idl.types.find((x) => x.name === a.name);
            return (
              <div key={a.name} className="mt-6 first:mt-0">
                <p className="ui text-ink">
                  <C>{a.name}</C>
                </p>
                {t?.docs?.length ? <P>{t.docs.join(" ")}</P> : null}
                <Table head={["Field", "Type"]} rows={(t?.type.fields ?? []).map((f) => [<C key="f">{f.name}</C>, typeName(f.type)])} />
              </div>
            );
          })}
        </>
      ),
    },
    {
      id: "events",
      title: "Events",
      body: (
        <Table
          head={["Event", "Fields"]}
          rows={idl.events.map((e) => [
            <C key="e">{e.name}</C>,
            (idl.types.find((x) => x.name === e.name)?.type.fields ?? []).map((f) => f.name).join(", "),
          ])}
        />
      ),
    },
    {
      id: "errors",
      title: "Errors",
      body: <Table head={["Code", "Name", "Message"]} rows={idl.errors.map((e) => [String(e.code), e.name, e.msg ?? ""])} />,
    },
  ],
};

export const api: DocPage = {
  slug: "api",
  group: "Reference",
  nav: "Indexer API",
  title: "Indexer API",
  description: "Read-only JSON over HTTP plus a push WebSocket, served by the Holdfast indexer. CORS is open.",
  sections: () => [
    {
      id: "base",
      title: "Base URL and conventions",
      body: (
        <>
          <P>
            Base URL: <C>{INDEXER_URL}</C>. Amounts in strings are raw integers (lamports; token base units with 6 decimals); fields
            ending in <C>Sol</C> are SOL floats; times are unix seconds. Errors are <C>{`{ "error": "…" }`}</C> with a status code;
            paging uses exclusive <C>before</C> cursors.
          </P>
          <Code label="Shell">{`curl ${INDEXER_URL}/api/launches?status=live&sort=trending&limit=5`}</Code>
        </>
      ),
    },
    {
      id: "endpoints",
      title: "Endpoints",
      body: (
        <Table
          head={["Route", "Returns"]}
          rows={[
            ["GET /api/health", "Sync status, slot, lag"],
            ["GET /api/platform", "Platform account and default params"],
            ["GET /api/stats", "SOL/USD price, launch counts, volume, vault SOL, backers repaid and paid out, vault withdrawals"],
            ["GET /api/launches?status=&sort=&q=&limit=&offset=", "Launch summaries (sort: new, trending, volume, mcap, raised)"],
            ["GET /api/launches/:mint", "One launch: on-chain snapshot + indexer fields"],
            ["GET /api/launches/:mint/trades?before=&limit=&agent=1", "Trades, newest first; agent=1 for vault-agent trades"],
            ["GET /api/launches/:mint/candles?tf=", "OHLC candles (tf 60, 300, 900, 3600, 86400)"],
            ["GET /api/candles?ids=&tf=", "Candles for up to 50 launches in one call, keyed by the ids as given (unknown ids omitted)"],
            ["GET /api/launches/:mint/backers", "Backers with deposit, claimed and claimable fees"],
            ["GET /api/launches/:mint/deposits", "Raise deposits"],
            ["GET /api/launches/:mint/holders?limit=", "Token holders, vault and curve labelled"],
            ["GET /api/launches/:mint/traders", "Top traders by volume"],
            ["GET /api/launches/:mint/comments", "Thread, newest first"],
            ["GET /api/trending", "King of the hill and the top 10 live launches"],
            ["GET /api/leaderboard?kind=&window=", "Backers, creators, traders or launches over 24h / 7d / all"],
            ["GET /api/search?q=", "Up to 8 launches and 8 wallets"],
            ["GET /api/users/:wallet", "Profile and stats for any wallet"],
            ["GET /api/portfolio/:wallet", "Positions and claimables from the deposit ledger, token holdings from chain"],
            ["GET /api/activity?limit=", "Latest events across all launches"],
            ["GET /api/agents", "Vault-agent totals, window budgets and recent agent trades"],
          ]}
        />
      ),
    },
    {
      id: "websocket",
      title: "WebSocket",
      body: (
        <>
          <P>
            Connect to <C>{`${INDEXER_URL.replace(/^http/, "ws")}/ws`}</C>. The server only pushes JSON messages: <C>event</C> (a new
            on-chain event), <C>launch</C> (a launch summary changed), <C>comment</C>, <C>comment_deleted</C> and <C>reset</C> (the index
            was rebuilt after a chain reset — drop caches).
          </P>
          <Code label="JavaScript">{`const ws = new WebSocket("${INDEXER_URL.replace(/^http/, "ws")}/ws");
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.type === "event" && msg.event.isAgent) console.log("agent trade", msg.event);
};`}</Code>
        </>
      ),
    },
    {
      id: "signed-writes",
      title: "Signed writes",
      body: (
        <P>
          Comments and profiles are written with an Ed25519 signature of the wallet over a four-line message:{" "}
          <C>holdfast:&lt;kind&gt;:v1</C>, the subject, the SHA-256 of the payload and a unix timestamp (±300 s). Each signed message is
          accepted once. Signing a message costs nothing and sends no transaction.
        </P>
      ),
    },
  ],
};

export const faq: DocPage = {
  slug: "faq",
  group: "Reference",
  nav: "FAQ",
  title: "FAQ",
  description: "Short answers, each linked to the page that proves it.",
  sections: ({ p }) =>
    faqItems(p).map((item, i) => ({
      id: `q${i + 1}`,
      title: item.q,
      body: (
        <P>
          {item.a} <A href={item.href}>{item.more} ›</A>
        </P>
      ),
    })),
};

export const risks: DocPage = {
  slug: "risks",
  group: "Reference",
  nav: "Risks",
  title: "Risks",
  description:
    "What Holdfast removes, sniper first buys and dumps by the creator or backers, and everything it doesn't: the vault can shrink, payback is not guaranteed, wind-down can return less than you put in.",
  sections: ({ p }) => {
    const s = pumpSplit(p);
    return [
      {
        id: "admin-withdraw",
        title: "The admin can withdraw vaults",
        body: (
          <Callout tone="warn" title="Vault funds are not locked">
            The platform admin can call <C>admin_withdraw_vault</C> on any launch and send its vault SOL and tokens to the platform fee
            recipient, tokens it could then sell. The admin is a Squads 2-of-3 multisig on mainnet. The instruction can&rsquo;t touch what
            backers have already accrued, and every withdrawal is on-chain (<C>VaultWithdrawn</C>) and shown on the launch page. See{" "}
            <A href="/docs/verify">Verify on-chain</A>.
          </Callout>
        ),
      },
      {
        id: "market",
        title: "Market risk",
        body: (
          <Callout tone="warn" title="Price can go down">
            Other holders can sell at any time. The vault agent is rate-limited and buys only on its own rules; it does not hold a price
            or guarantee anything. You can lose what you put in.
          </Callout>
        ),
      },
      {
        id: "vault",
        title: "Vault and payback risk",
        body: (
          <Ul>
            <li>
              <B>The vault can shrink.</B> It buys dips with its SOL; a token that keeps falling leaves it holding tokens worth less than
              it paid, and the admin can withdraw it.
            </li>
            <li>
              <B>Payback is not guaranteed.</B> {paybackSentence(s)} A vault that never reaches {fmtMult(s.payoutMult)}, or whose chart is
              weak at every {fmtInterval(s.payoutIntervalHours)} check, pays nothing beyond your share of creator fees.
            </li>
            <li>
              <B>Wind-down can return less than principal.</B> It sells what the vault holds into a dead market and splits whatever SOL is
              left. It is the worst case, not a refund.
            </li>
          </Ul>
        ),
      },
      {
        id: "protocol",
        title: "Protocol and operator risk",
        body: (
          <Ul>
            <li>
              <B>Upgradeable program.</B> While an upgrade authority exists, an upgrade could change any rule. Check it on{" "}
              <A href="/docs/verify">Verify on-chain</A>.
            </li>
            <li>
              <B>Admin controls.</B> Besides vault withdrawals, the admin can pause new launches and deposits and pause the vault agent.
              Trading on the venue, refunds and claims don&rsquo;t depend on it.
            </li>
            <li>
              <B>Agent availability.</B> If the agent is offline the vault doesn&rsquo;t trade and no payback runs. Its status is public at{" "}
              <A href="/agents">/agents</A>.
            </li>
            <li>
              <B>Wind-down.</B> Once a launch is {windDownRule(s)}, anyone can end it: its SOL goes to backers and the vault stops trading
              for good.
            </li>
            <li>
              <B>Bugs.</B> The program and SDK are unaudited software.{IS_TEST_CLUSTER ? ` ${CLUSTER_LABEL[CLUSTER]} is for testing; its SOL has no value.` : ""}
            </li>
          </Ul>
        ),
      },
      {
        id: "creator",
        title: "Creator and token risk",
        body: (
          <P>
            A creator can&rsquo;t touch the bundle, but can hold ordinary tokens bought on pump.fun like anyone else, and token metadata
            (name, image, links) is whatever they uploaded. Holdfast doesn&rsquo;t vet launches.
          </P>
        ),
      },
    ];
  },
};

export const glossary: DocPage = {
  slug: "glossary",
  group: "Reference",
  nav: "Glossary",
  title: "Glossary",
  description: "The nouns Holdfast uses, each in one sentence.",
  sections: ({ p }) => [
    {
      id: "terms",
      title: "Terms",
      body: (
        <dl className="border-t border-line">
          {[
            ["Raise", "The pre-launch period where backers deposit SOL toward a min and max."],
            ["Backer", "A wallet that deposited into a raise; it earns the backers' share of creator fees, the vault's paybacks and its wind-down SOL, pro-rata to its deposit."],
            ["Bundle", glossaryRule("bundle", pumpSplit(p))],
            ["Vault", glossaryRule("vault", pumpSplit(p))],
            ["Reserve", "The share of the raise kept as SOL in the vault for the agent to buy dips with."],
            ["Initial vault SOL", "What went in at launch: the bundle's SOL plus the reserve (initial_vault_sol). The payback rule measures the vault's liquid SOL against it."],
            ["Curve", "A launch's market: pump.fun's bonding curve (then PumpSwap), or the legacy Holdfast constant-product curve that never migrates."],
            ["EMA", `Exponential moving average of price, updated at every trade${p ? ` over ${Math.round(p.emaPeriodSecs / 60)} minutes` : ""}.`],
            ["Band", `The zone around the EMA${p ? ` (± ${pctFromBps(p.agentBandBps)})` : ""} inside which the vault agent holds.`],
            ["Vault average cost", "The SOL cost per token of what the vault holds. Agent buys must fill at or below it (or, as a buy-back, a band under the average sell price); agent sells must fill at least a band above it."],
            ["Window", "The period over which the agent's buy and sell budgets reset."],
            ["Impact", "How far a trade moves the spot price, in percent."],
            ["Terms", "The fee split, the payback rule, the vault floor and the agent limits frozen into a launch at creation."],
            ["Vault agent", glossaryRule("vaultAgent", pumpSplit(p))],
            ["Backer earnings", glossaryRule("backerEarnings", pumpSplit(p))],
            ["Payback", glossaryRule("payback", pumpSplit(p))],
            ["Vault floor", glossaryRule("vaultFloor", pumpSplit(p))],
            ["Buyback pool", glossaryRule("buybackPool", pumpSplit(p))],
            ["Wind-down", glossaryRule("windDown", pumpSplit(p))],
          ].map(([t, d]) => (
            <div key={t} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="ui text-ink">{t}</dt>
              <dd className="body text-ink-2">{d}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ],
};

export const brand: DocPage = {
  slug: "brand",
  group: "Reference",
  nav: "Brand kit",
  title: "Brand kit",
  description: "The Clamp, the wordmark and the colours — and how not to use them.",
  sections: () => [
    {
      id: "mark",
      title: "The Clamp",
      body: (
        <>
          <P>Two square jaws gripping an orange coin: the bundle, held. The jaws take the text colour; the coin is always Buoy orange.</P>
          <div className="mt-6 flex flex-wrap items-center gap-10 rounded-md border border-line bg-surface p-8">
            <Mark size={64} className="text-ink" title="Holdfast mark" />
            <Mark size={32} className="text-ink" />
            <Mark size={16} className="text-ink" />
            <Lockup size={28} />
          </div>
          <Ul>
            <li>
              <A href="/brand/holdfast-mark.svg">Mark (SVG)</A> · <A href="/brand/holdfast-lockup.svg">Lockup (SVG)</A> ·{" "}
              <A href="/brand/holdfast-wordmark.svg">Wordmark (SVG)</A>
            </li>
            <li>The wordmark is always lowercase &ldquo;holdfast&rdquo;; in prose the product is &ldquo;Holdfast&rdquo;.</li>
          </Ul>
        </>
      ),
    },
    {
      id: "colour",
      title: "Colour",
      body: (
        <>
          <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
            {[
              ["Ground", "#0F100E", "bg-paper"],
              ["Ink", "#F2F1EC", "bg-ink"],
              ["Buoy orange", "#FF5B1A", "bg-accent"],
              ["Line", "#2A2B27", "bg-line"],
            ].map(([name, hex, cls]) => (
              <div key={name} className="bg-surface p-3">
                <div className={`h-12 rounded-sm ring-1 ring-line-2 ring-inset ${cls}`} />
                <p className="small mt-2 text-ink">{name}</p>
                <p className="mono text-ink-3">{hex}</p>
              </div>
            ))}
          </div>
          <P>
            One surface everywhere: off-white ink on the dark ground, like the mark itself. Orange means the protocol — the vault, the
            agent, the backer share. Green and red mean price direction only. Everything else is ink and greys.
          </P>
        </>
      ),
    },
    {
      id: "dont",
      title: "Don't",
      body: (
        <Ul>
          <li>Recolour the coin, round the jaws, or add glows, gradients or padlocks.</li>
          <li>
            Promise outcomes: no &ldquo;safe&rdquo;, &ldquo;guaranteed&rdquo;, &ldquo;100x&rdquo;, and no &ldquo;floor&rdquo; except the
            vault floor, the SOL a vault keeps for fees.
          </li>
          <li>
            Say &ldquo;AI&rdquo; or &ldquo;bot&rdquo;: it&rsquo;s <Link href="/docs/agents" className="underline">the vault agent</Link>. The one
            exception is the optional narration, which may be described as it is: a language model writes a plain-English note for each
            decision and never decides trades.
          </li>
        </Ul>
      ),
    },
  ],
};
