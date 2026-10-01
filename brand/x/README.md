# Holdfast — X account kit

## Images (upload these)
| File | Use | Size |
|---|---|---|
| `pfp.png` | **Profile picture** (recommended) — the Clamp mark on ink | 1000×1000 |
| `pfp-paper.png` / `pfp-orange.png` | Alternates (light, orange) | 1000×1000 |
| `banner.png` | **Header** (light, matches the landing page) | 1500×500 @2x (3000×1000) |
| `banner-night.png` | Header, dark alternate (matches the app) | 3000×1000 |
| `announce.png` / `announce-night.png` | Pinned launch post image (P1) | 1600×900 |
| `card-money.png`, `card-vault.png`, `card-payback.png`, `card-agent-rules.png`, `card-not.png`, `card-check.png` | Image cards for P6, P4, P8, P9, P10, P11 — dark ink, every text size ≥ 28 px at 1600×900 so they survive X's 600 px crop | 1600×900 @2x (3200×1800) |
| `article-how-holdfast-works.md` | The X Article for P3, with `[image: …]` slots for the cards | — |
| `preview-profile.png` | How the profile looks with pfp + banner (not for upload) | — |

The price line in the banner and card is real data: the price, EMA band and vault agent trades of a $MOSH launch on a local Solana validator, drawn with the site's chart rules (orange dashes = agent band, filled diamond = vault bought, hollow = vault sold). Sources are in `src/` (HTML, render at the listed sizes). The six cards are generated: `node brand/x/src/cards.mjs --render` rewrites `src/card-*.html` from the numbers in the script (README "Vault economics", `constants.rs` defaults and hard caps, the platform account, `DEFAULT_PARAMS` of the agent, `previewPumpBundle` for the docs' 10 SOL example, mainnet reads of $HFPUMP) and screenshots them with headless Chrome at device scale 2.

## Profile fields
- **Name:** `Holdfast`
- **Handle ideas:** `@holdfast`, `@holdfastfun`, `@holdfast_sol`, `@holdfastlaunch` (check which is free)
- **Bio (160 max):**
  `Back a token before it hits pump.fun. Your SOL makes the first buy; a vault agent works the chart and pays backers back once the vault is 5×. Live on Solana.`
- **Location:** `Solana`
- **Website:** `https://holdfast.fun`
- **Pinned post:** P1 below with `announce.png`.

Voice rules (from the brand brief): numbers over adjectives; never promise price ("floor", "guaranteed", "can't go down", "100x" are banned; "paid back" is always conditional on the 5× rule); say "vault agent", not "bot" ("AI" only for the narration and research features, which never trade); sentence case; dry wit only in replies, never about money.

## Post plan (12 posts, no threads; at most one reply each, replies on 5 posts)

Every number below is read from the chain, the README or computed with the program's own helpers (see `src/cards.mjs` for the sources). Check lengths before posting: X counts any `*.fun` domain as a 23-character link.

| # | Post | Media | Reply |
|---|---|---|---|
| P1 | Pinned announce | `announce.png` | — |
| P2 | Hero video: launch in a minute | `video/launch-in-a-minute.mp4` | — |
| P3 | Article link | X Article “How Holdfast works” | — |
| P4 | What the vault agent does | `card-vault.png` | yes |
| P5 | Video: the bundle | `video/the-bundle.mp4` | — |
| P6 | Where the money goes | `card-money.png` | yes |
| P7 | Video: the agent defends | `video/agent-defends.mp4` | — |
| P8 | When backers get paid back | `card-payback.png` | yes |
| P9 | Agent rules | `card-agent-rules.png` | — |
| P10 | What Holdfast doesn't do | `card-not.png` | yes |
| P11 | Check it yourself | `card-check.png` | yes |
| P12 | Video: backers get paid | `video/payout.mp4` | — |

### P1 · Pinned announce
**Media:** `announce.png`

```
Back a token before it hits pump.fun.

Pooled SOL makes the token's first buy in the instruction that creates it. A vault agent sells into strength, buys back dips, keeps it all in the vault. At 5×, backers are paid back.

holdfast.fun
```

### P2 · Hero video: launch in a minute
**Media:** `video/launch-in-a-minute.mp4`

```
A Holdfast launch in a minute: back the raise, the bundle buys first in the instruction that creates the token, the vault agent works the chart inside the program's limits.

Recorded on a local validator running the mainnet pump.fun programs.
```

### P3 · Article link
**Media:** `X Article “How Holdfast works” (article-how-holdfast-works.md), link in the post`

```
How Holdfast works, in one read: who buys first, what the vault agent may do, when backers get paid back, where every lamport goes, what the admin can and can't do, and how to check each claim against mainnet.
```

### P4 · What the vault agent does
**Media:** `card-vault.png`

```
What the vault agent does:

• sells slowly into strength: more the higher the mcap multiple and the more real buy volume, never over 3% impact
• buys dips back with what it sold
• keeps every lamport it sells for in the vault

No profit split. The vault is meant to grow.
```

**Reply (one, no thread):**

```
Quiet chart? Support mode: while 24 h activity is under 2× the vault's SOL, dip buys shrink to a third of the allowed size and sit 5 min apart. Small, spaced buys that give the chart volume without spending a window's budget at once. Each decision: holdfast.fun/agents
```

### P5 · Video: the bundle
**Media:** `video/the-bundle.mp4`

```
A Holdfast launch is closed until launch_pump runs. One instruction creates the token on pump.fun and makes its first buy with the backers' pool: Create, then Buy, nothing between.

$HFPUMP: 1 SOL raised, 0.6705 SOL bought 23.1M tokens. Tx TnjK9WUN…yyYPnkN
```

### P6 · Where the money goes
**Media:** `card-money.png`

```
Where the money goes on a Holdfast launch:

• pump.fun creator fee: 75% vault SOL, 15% buyback-and-burn, 10% backers
• what the vault agent sells for: 100% stays in the vault
• creator: 0% of fees
• Holdfast: 1% of the raise + 0.02 SOL, once
```

**Reply (one, no thread):**

```
Why the creator gets 0%: a creator paid on volume wants volume at any price. On Holdfast the creator's pitch is the bundle itself: backers funded it, it sits in the vault, and the vault agent sells it only above cost.
```

### P7 · Video: the agent defends
**Media:** `video/agent-defends.mp4`

```
The vault agent defends, inside the band: it buys dips at least 2% under the EMA, at or below the vault's cost or under its own average sell, and sells rallies at least 2% over both. Hourly budgets, 3% impact cap, 0.1 SOL floor. Every trade fails if any check fails.
```

### P8 · When backers get paid back
**Media:** `card-payback.png`

```
When backers get paid back:

The vault's liquid SOL is 5× what went in at launch, and the chart is strong. Then: principal first, then 15% of the vault, never more than once per 4 h.

A dip comes first; a due payout in a weak chart is skipped. The vault keeps a 0.1 SOL floor.
```

**Reply (one, no thread):**

```
The 10 SOL example from the docs: 9.8796 SOL went in at launch, so payouts start at 49.398 SOL liquid. First payout 9.8796 SOL; a 1 SOL backer gets 0.988. Then 15% of what's left: 5.928 SOL, 0.593 to that backer. holdfast.fun/docs/how-it-works
```

### P9 · Agent rules
**Media:** `card-agent-rules.png`

```
The program checks every vault agent trade:

Sell: ≥ 2% over the EMA and ≥ 2% over the vault's average cost. Never a loss.

Buy: ≥ 2% under the EMA; ≤ average cost, or a buy-back under its average sell.

Per hour: ≤ 10% of vault SOL, 5% of tokens. ≤ 3% impact. 0.1 SOL floor.
```

### P10 · What Holdfast doesn't do
**Media:** `card-not.png`

```
What Holdfast doesn't do:

• hold a price
• promise a payout: 5× liquid and a strong chart first
• lock the vault: the admin (a 2-of-3 Squads multisig) can withdraw one; every withdrawal is an on-chain event on the launch page
• have an audit yet
• let AI trade; it narrates
```

**Reply (one, no thread):**

```
Why say it: every vault exit is an on-chain event (agent trade, payout, wind-down, admin withdrawal) and the launch page lists all of them. We'd rather show the power than claim a lock we don't have. holdfast.fun/docs/risks
```

### P11 · Check it yourself
**Media:** `card-check.png`

```
Check it yourself, mainnet:

program EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ

$HFPUMP mint GyHYt6bjNkXVmECCuzKsMuZLXW8T8L6g8oTH7hhyxnPy: supply 1,000,000,000, mint authority none, freeze none

admin: Squads multisig 29dhkp…bsT1, 2 of 3

holdfast.fun/docs/verify
```

**Reply (one, no thread):**

```
The vault: 55xnr1fcoQbuzobTpQTMZPPguYyf8YnLVKDAkzcd12yj, a token account owned by the launch's pump-authority PDA. The agent key: FvbdC4n4qXu8JoVLDeb5m8hT8pDSjXFKBCWx322LtWKP, accepted only by the agent instructions; it can never withdraw.
```

### P12 · Video: backers get paid
**Media:** `video/payout.mp4`

```
Backers get paid: once a vault's liquid SOL is 5× what went in and the chart is strong, payout_backers credits every backer pro-rata. Principal first, then 15% of the vault, at most once per 4 h. Claim any time.

No wallet? Sign in with Google; the key is exportable.
```

## Posted 2026-10-01 (vault model)
Pinned P1 `2105619625388187833` · P2 video `2105620480648413276` · P3 article `2105629518241177910` · P4 `2105620778591064136` (+reply) · P5 `2105621009281806640` · P6 `2105621977356747253` (+reply) · P7 `2105622987877790008` · P8 `2105623196368019515` (+reply) · P9 `2105624186429342121` · P10 `2105625093326209428` (+reply) · P11 `2105626081139073479` (+reply) · P12 `2105626314384527495`. The 7-post profit-share thread from 2026-09-30 was deleted (its text is in git history of this file).
