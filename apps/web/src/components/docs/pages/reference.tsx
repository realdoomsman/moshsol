import { IDL, PROGRAM_ID } from "@holdfast/sdk";
import Link from "next/link";
import { CLUSTER, CLUSTER_LABEL, CLUSTER_NAME, INDEXER_URL, IS_TEST_CLUSTER } from "@/lib/env";
import { pctFromBps } from "../../band/model";
import { Lockup } from "../../brand/lockup";
import { Mark } from "../../brand/mark";
import { faqItems } from "../../landing/faq";
import { instructionRows } from "../../landing/instructions";
import { A, B, C, Callout, Code, P, Table, Ul } from "../prose";
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
    "Holdfast is the Solana launchpad where the first buy can never be dumped. Backers' SOL buys the first slice of supply, which is locked forever in an on-chain vault, traded only by a rate-limited agent — and backers earn a share of every trading fee.",
  sections: ({ p }) => [
    {
      id: "start",
      title: "Start here",
      body: (
        <Table
          head={["If you want to…", "Read"]}
          rows={[
            ["Understand the mechanism", <A key="h" href="/docs/how-it-works">How a launch works</A>],
            ["Back a raise and earn fees", <A key="b" href="/docs/for-backers">For backers</A>],
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
          <li>Fixed supply of 1,000,000,000 per launch; mint authority revoked at creation; no freeze authority.</li>
          {p ? (
            <>
              <li>
                {pctFromBps(p.tradeFeeBps)} fee per public trade: {pctFromBps(p.backerFeeShareBps)} to backers,{" "}
                {pctFromBps(p.creatorFeeShareBps)} to the creator, {pctFromBps(10_000 - p.backerFeeShareBps - p.creatorFeeShareBps)} to
                the platform.
              </li>
              <li>
                Agent band {pctFromBps(p.agentBandBps)} around the EMA; buys ≤ {pctFromBps(p.agentBuyBpsPerWindow)} of vault SOL and sells ≤{" "}
                {pctFromBps(p.agentSellBpsPerWindow)} of vault tokens per {Math.round(p.agentWindowSecs / 60)} minutes.
              </li>
            </>
          ) : null}
          <li>0 withdraw instructions.</li>
        </Ul>
      ),
    },
  ],
};

export const program: DocPage = {
  slug: "program",
  group: "Reference",
  nav: "Program reference",
  title: "Program reference",
  description: "Instructions, accounts, events and errors of the Holdfast program, generated from the IDL shipped in @holdfast/sdk.",
  sections: () => [
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
          rows={instructionRows().map((r) => [
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
            ["GET /api/stats", "Launch counts, volume, locked vault SOL"],
            ["GET /api/launches?status=&sort=&q=&limit=&offset=", "Launch summaries (sort: new, trending, volume, mcap, raised)"],
            ["GET /api/launches/:mint", "One launch: on-chain snapshot + indexer fields"],
            ["GET /api/launches/:mint/trades?before=&limit=&agent=1", "Trades, newest first; agent=1 for vault-agent trades"],
            ["GET /api/launches/:mint/candles?tf=", "OHLC candles (tf 60, 300, 900, 3600, 86400)"],
            ["GET /api/launches/:mint/backers", "Backers with deposit, claimed and claimable fees"],
            ["GET /api/launches/:mint/deposits", "Raise deposits"],
            ["GET /api/launches/:mint/holders?limit=", "Token holders, vault and curve labelled"],
            ["GET /api/launches/:mint/traders", "Top traders by volume"],
            ["GET /api/launches/:mint/comments", "Thread, newest first"],
            ["GET /api/trending", "King of the hill and the top 10 live launches"],
            ["GET /api/leaderboard?kind=&window=", "Backers, creators, traders or launches over 24h / 7d / all"],
            ["GET /api/search?q=", "Up to 8 launches and 8 wallets"],
            ["GET /api/users/:wallet", "Profile and stats for any wallet"],
            ["GET /api/portfolio/:wallet", "Positions, claimables and holdings, live from chain"],
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
  description: "What Holdfast removes — the bundle dump — and everything it doesn't.",
  sections: () => [
    {
      id: "market",
      title: "Market risk",
      body: (
        <Callout tone="warn" title="Price can go down">
          Other holders can sell at any time. The vault agent is rate-limited and only buys below its cost; it does not hold a price,
          set a floor or guarantee anything. You can lose what you put in.
        </Callout>
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
            <B>Admin controls.</B> The admin can pause new launches and deposits and pause the vault agent. Trading, refunds and claims
            don&rsquo;t depend on it.
          </li>
          <li>
            <B>Agent availability.</B> If the agent is offline the vault doesn&rsquo;t trade. Its status is public at{" "}
            <A href="/agents">/agents</A>.
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
          A creator can&rsquo;t dump the bundle, but can hold ordinary tokens bought on the curve like anyone else, and token metadata
          (name, image, links) is whatever they uploaded. Holdfast doesn&rsquo;t vet launches.
        </P>
      ),
    },
  ],
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
            ["Backer", "A wallet that deposited into a raise; it earns the backers' share of trade fees pro-rata to its deposit."],
            ["Bundle", "The first buy on the curve, made with the raise at launch before any public trade."],
            ["Vault", "The program-owned account per launch that holds the bundle tokens and the SOL reserve; it has no withdraw."],
            ["Reserve", "The share of the raise kept as SOL in the vault for the agent to buy dips with."],
            ["Curve", "The launch's constant-product market (x · y = k) with virtual SOL reserves; it never migrates."],
            ["EMA", `Exponential moving average of price, updated at every trade${p ? ` over ${Math.round(p.emaPeriodSecs / 60)} minutes` : ""}.`],
            ["Band", `The zone around the EMA${p ? ` (± ${pctFromBps(p.agentBandBps)})` : ""} inside which the vault agent holds.`],
            ["Vault average cost", "The SOL cost per token of what the vault holds; agent buys must fill at or below it."],
            ["Window", "The period over which the agent's buy and sell budgets reset."],
            ["Impact", "How far a trade moves the spot price, in percent."],
            ["Terms", "The fee split and agent limits frozen into a launch at creation."],
            ["Vault agent", "The rate-limited signer allowed to call agent_buy and agent_sell."],
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
          <li>Promise outcomes: no &ldquo;safe&rdquo;, &ldquo;floor&rdquo;, &ldquo;guaranteed&rdquo;.</li>
          <li>
            Say &ldquo;AI&rdquo; or &ldquo;bot&rdquo; — it&rsquo;s <Link href="/docs/agents" className="underline">the vault agent</Link>.
          </li>
        </Ul>
      ),
    },
  ],
};
