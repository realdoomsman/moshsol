# Holdfast — X account kit

Everything here is about the mechanism only: no other coins or projects, no token addresses, no test launches, no transaction signatures. The program id, the admin multisig and holdfast.fun links are the only identifiers. Nothing in this folder is posted by the repo; `kit/CHECKLIST.md` is the posting order for whoever runs the account.

The bar: a brand-new account has to look premium and credible. Every post makes one point a smart non-developer gets in five seconds, then one checkable detail. No instruction names in post copy (they live in the article), no hashtags, no emojis, no hype, at most one holdfast.fun link per post and not on every post.

## Files

| File | Use | Size |
|---|---|---|
| `kit/avatar.png` | **Profile picture**: the mark on ink | 1000×1000 |
| `kit/banner.png` | **Header**: one line of copy + holdfast.fun, kept clear of the avatar overlap | 1500×500 @2x (3000×1000) |
| `cover.png` | Cover image of the X Article | 1600×900 @2x |
| `article-how-holdfast-works.md` | The X Article (title, subtitle, `[cover: …]` and `[image: …]` slots mark where the images go) | — |
| `card-how.png`, `card-bundle.png`, `card-vault.png`, `card-agent-rules.png`, `card-money.png`, `card-payback.png`, `card-not.png`, `card-check.png` | One image per post P1–P8: one idea in display type, one supporting line, one checkable detail; smallest text 30 px at 1600×900 | 1600×900 @2x (3200×1800) |
| `video/final/holdfast-explainer.mp4` | Pinned post video (voiceover + music; `.srt` alongside; `-4x5` variant for mobile) | — |
| `video/final/the-bundle.mp4`, `video/final/vault-agent.mp4` | V1, V2 (voiceover + music; `.srt` alongside) | — |
| `pfp*.png`, `banner*.png`, `announce*.png` | Earlier assets, kept for reference | — |
| `src/stats.mjs`, `src/wallets.mjs`, `src/burns.mjs`, `src/buys.mjs`, `src/dashboard.mjs`, `src/momentum.mjs`, `src/tracker-list.mjs`, `src/agent-video.mjs` → `stats/<unix time>/` | Live-data cards, videos + post copy from one read of `api.holdfast.fun` and the chain (shared style, fetch, RPC, agent-trade paging, card and video render in `src/stat-card.mjs`; video audio in `src/audio.mjs`; each takes an optional launch address, default HOLD). `stats.mjs`: launch, vault, creator fees, platform totals. `wallets.mjs`: the 15 agent wallets (`platform.agent_executors`) with each one's sells, SOL fee float and token balance. `burns.mjs`: burned supply from the mint, split into pump.fun BOOST (`BoostBuyAndBurn`), Holdfast buyback-and-burn and other burns. `buys.mjs`: every vault buy as a labelled bar chart. `dashboard.mjs`: "N minutes in" market + vault card. `momentum.mjs`: since-launch market-cap area chart. `tracker-list.mjs`: the agent wallets as a tracker import list. `agent-video.mjs`: 17 s 1920×1080 MP4 with audio: USD market-cap candles from launch with the 20-min trend, every vault trade popping in with a tick, live panel and tape, end card. `dashboard.mjs` and `momentum.mjs` still print SOL amounts and "N×" (see the live-post rules below). Chain reads need `RPC_URL` or `.mainnet/config.json`. `posts.json` holds the copy and alt text | 1600×900 @2x; video 1920×1080 |

Everything with `card-`, `cover`, `kit/banner` and `kit/avatar` is generated: `node brand/x/src/cards.mjs --render` rewrites the `src/*.html` sources from the numbers in the script (README "Vault economics", `constants.rs` defaults and hard caps, the platform account, `previewPumpBundle` for the docs' 10 SOL example) and screenshots them with headless Chrome. Review every card at 600×338 before posting; that is the timeline size (`kit/review/` holds the last review set).

## Profile fields

- **Name:** `Holdfast`
- **Handle ideas:** `@holdfast`, `@holdfastfun`, `@holdfast_sol`, `@holdfastlaunch` (check which is free)
- **Location:** `Solana`
- **Website:** `https://holdfast.fun`
- **Avatar / header:** `kit/avatar.png` / `kit/banner.png`
- **Pinned post:** the quote-post of the article below, with `video/final/holdfast-explainer.mp4`

### Bio (160 max)

```
Back a token before it launches on pump.fun. Pooled SOL makes the first buy, a vault agent works the chart, backers are paid back at 5×. Beta.
```

Voice rules (from the brand brief): numbers over adjectives; never promise price ("floor", "guaranteed", "can't go down", "100x" are banned; "paid back" is always conditional on the 5× rule); say "vault agent", not "bot" ("AI" only for the narration and research features, which never trade); sentence case; no emojis; dry; everything checkable.

## Post plan (1 pinned + 8 cards + 2 videos; no threads, no replies)

Every number below is read from the chain, the README or computed with the program's own helpers (see `src/cards.mjs` for the sources). Lengths: `node brand/x/kit/lengths.mjs` counts every block the way X does (any `*.fun` domain = 23 characters); cards ≤ 260, pinned and videos ≤ 280, bio ≤ 160.

| # | One point | Media |
|---|---|---|
| PINNED | Quote-post of the X Article "How Holdfast works" | `video/final/holdfast-explainer.mp4` |
| P1 | A launch in four beats | `card-how.png` |
| P2 | Create, then Buy, nothing between | `card-bundle.png` |
| P3 | What the vault agent does | `card-vault.png` |
| P4 | Never sells at a loss, never buys high | `card-agent-rules.png` |
| P5 | 75 / 15 / 10 | `card-money.png` |
| P6 | Paid back at 5× | `card-payback.png` |
| P7 | What Holdfast doesn't do | `card-not.png` |
| P8 | Check it yourself | `card-check.png` |
| V1 | Video: the bundle | `video/final/the-bundle.mp4` |
| V2 | Video: the vault agent | `video/final/vault-agent.mp4` |

### PINNED · quote-post of the article
**Media:** `video/final/holdfast-explainer.mp4`, quoting the published X Article (`article-how-holdfast-works.md`). Publish the article first; the quoted link adds no characters.

```
Back a token before it launches on pump.fun.

Backers pool SOL; one instruction creates the token and buys first with that pool. A vault agent works the chart inside program limits. Creator fees: 75% vault, 15% burn, 10% backers. At 5×, backers are paid back.
```

### P1 · A launch in four beats
**Media:** `card-how.png`

```
A Holdfast launch in four beats.

Backers pool SOL. One instruction creates the token and makes the first buy with the pool. A vault agent works the chart. Once the vault is 5× liquid, backers are paid back.

Beta: 50 SOL per launch, 5 per wallet.
```

### P2 · The bundle
**Media:** `card-bundle.png`

```
Create, then Buy. Nothing between.

A Holdfast token is created and bought in one instruction, with the backers' pool. Trading is closed until it runs, so the launch transaction is the token's first trade, and the tokens go to a vault, not a wallet.
```

### P3 · What the vault agent does
**Media:** `card-vault.png`

```
The vault agent sells into strength and buys back dips.

Everything it sells for stays in the vault as SOL, and that SOL buys the next dip. No profit split.

Every decision, including every "did nothing", is logged: holdfast.fun/agents
```

### P4 · Agent rules
**Media:** `card-agent-rules.png`

```
The vault never sells at a loss and never buys high.

A sell has to fill 2% over the EMA and above the vault's average cost. A buy has to fill 2% under the EMA and at or below cost. The program checks every trade; a trade that fails a check fails.
```

### P5 · Where the money goes
**Media:** `card-money.png`

```
Where pump.fun's creator fee goes on a Holdfast launch: 75% to the vault, 15% buys and burns the Holdfast token, 10% to backers.

The creator takes 0%. Holdfast earns 1% of the raise plus 0.02 SOL, once, and none of the trading fees.
```

### P6 · When backers get paid back
**Media:** `card-payback.png`

```
Backers are paid back at 5×.

Once the vault's liquid SOL is 5× what went in at launch and the chart is strong: principal first, then 15% of the vault, at most once per 4 hours.

A dip always comes first. Not a promise.
```

### P7 · What Holdfast doesn't do
**Media:** `card-not.png`

```
What Holdfast doesn't do: hold a price, promise a payout, lock the vault, or let AI trade.

The admin, a 2-of-3 Squads multisig, can withdraw a vault; every withdrawal is an on-chain event on the launch page. No external audit yet.

holdfast.fun/docs/risks
```

### P8 · Check it yourself
**Media:** `card-check.png`

```
Check it yourself.

Open any launch page → Verify on-chain: no mint authority, no freeze, fixed supply, read live. The launch transaction is one instruction: Create, then Buy.

Program: EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ
```

### V1 · Video: the bundle
**Media:** `video/final/the-bundle.mp4`

```
The bundle, step by step.

The raise closes, one instruction creates the token on pump.fun and makes its first buy with the backers' pool, and the tokens land in the vault. Nothing trades in between.

Local validator, mainnet pump.fun programs.
```

### V2 · Video: the vault agent
**Media:** `video/final/vault-agent.mp4`

```
The vault agent, in one minute.

It sells into strength only above the band and the vault's cost, buys back dips only under the band and at or below cost, inside hourly budgets and a 3% impact cap. Every decision is logged.

Illustrative chart; the numbers are the program's.
```

## Posted on @TryHoldFast (2026-10-01)
Article `2105645092799127789` · P1 `2105645338124070939` · P2 `2105645917810659832` · P3 `2105646427636678663` · P4 `2105646937693204482` · P5 `2105647450509754440` · P6 `2105648190305304913` · P7 `2105648703889703193` · P8 `2105649217314099427` (program id left on the card only) · PINNED quote of the article + holdfast-explainer.mp4 `2105670300943966523` · V1 `2105670961483714724` · V2 `2105671549097549852`.

## Live-stats posts on @TryHoldFast (2026-10-03, ~18 min after HOLD launched)
HOLD launch `2106244281795244442` (snapshot `stats/1791002673`) · HOLD vault `2106244372895527126` · HOLD creator fees `2106244425298944039` · platform totals `2106244484723843570` (snapshot `stats/1791002750`).
HOLD agent wallets (2 images: explanation + all 15 with sells / float / balance) `2106247832801878341` (snapshot `stats/1791003514`).
HOLD vault buys (bar chart, one bar per buy) `2106256356164477202` (snapshot `stats/1791005600`).
HOLD vault agent video (every trade on the candles, 16 s) `2106260597587267644` (snapshot `stats/1791006596`).
HOLD dashboard, 86 minutes in (market + vault marked at the current price) `2106261180306325918` (snapshot `stats/1791006748`).
HOLD 42× since launch (log mcap chart, 105 minutes in) `2106266049259938187` (snapshot `stats/1791007910`).
HOLD agent wallets as a tracker import list (JSON `[{"address","name","emoji"}]`, the format Axiom, Padre and GMGN all import; `src/tracker-list.mjs`) `2106268454277832817` (snapshot `stats/1791008470`, list in `agent-wallets.json`).
HOLD zoomed out (video: log mcap line from launch with a live "N×" counter and every vault trade dotted, then an end card; no audio; generator removed after review, superseded by `agent-video.mjs`) `2106273416139706585` (snapshot `stats/1791009651`).
HOLD vault agent, trade by trade (video with audio: USD market-cap candles from launch, rising 20-min trend line, every vault sell / buy popping in with a tick, live market cap / sold / bought panel and tape, end card "$14K → $520K"; `src/agent-video.mjs` + `src/audio.mjs`) `2106274733897712109` (snapshot `stats/1791009969`).
HOLD dip (video with audio, `agent-video.mjs --dip 30`: last 30 minutes of USD candles, every vault trade with ticks, the window low marked, end card "$128K → $397K", 34 vault buys into the dip) `2106277714676085003` (snapshot `stats/1791010680`).
HOLD burned supply (card: 6.94% of supply burned, split pump.fun BOOST / Holdfast buyback-and-burn / other, Holdfast's share priced in USD; `src/burns.mjs`) `2106282259544220145` (snapshot `stats/1791011768`).

Live-post rules (from review, 2026-10-03): market caps and amounts in USD (at the indexer's current SOL price), not SOL; no "N×" multiples as values; every video has audio (`src/audio.mjs`: the kit's cached music bed + a tick per on-screen trade; Gemini TTS / Lyria are refused for this project's key as of this date, so no new voiceover or music can be generated).
