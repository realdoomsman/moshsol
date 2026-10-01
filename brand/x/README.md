# Holdfast — X account kit

## Images (upload these)
| File | Use | Size |
|---|---|---|
| `pfp.png` | **Profile picture** (recommended) — the Clamp mark on ink | 1000×1000 |
| `pfp-paper.png` / `pfp-orange.png` | Alternates (light, orange) | 1000×1000 |
| `banner.png` | **Header** (light, matches the landing page) | 1500×500 @2x (3000×1000) |
| `banner-night.png` | Header, dark alternate (matches the app) | 3000×1000 |
| `announce.png` / `announce-night.png` | Pinned launch post image (P1) | 1600×900 |
| `card-money.png`, `card-bundle-math.png`, `card-agent-rules.png`, `card-not.png`, `card-refund-winddown.png`, `card-check.png` | Image cards for P4, P8, P6, P9, P10, P11 — dark ink, every text size ≥ 28 px at 1600×900 so they survive X's 600 px crop | 1600×900 @2x (3200×1800) |
| `article-how-holdfast-works.md` | The X Article for P3, with `[image: …]` slots for the cards | — |
| `preview-profile.png` | How the profile looks with pfp + banner (not for upload) | — |

The price line in the banner and card is real data: the price, EMA band and vault agent trades of a $MOSH launch on a local Solana validator, drawn with the site's chart rules (orange dashes = agent band, filled diamond = vault bought, hollow = vault sold). Sources are in `src/` (HTML, render at the listed sizes). The six cards are generated: `node brand/x/src/cards.mjs --render` rewrites `src/card-*.html` from the numbers in the script (platform account, program constants, `previewPumpBundle`, mainnet RPC reads of $HFPUMP) and screenshots them with headless Chrome at device scale 2.

## Profile fields
- **Name:** `Holdfast`
- **Handle ideas:** `@holdfast`, `@holdfastfun`, `@holdfast_sol`, `@holdfastlaunch` (check which is free)
- **Bio (160 max):**
  `Backers buy first and share the profit: 75% of the vault agent's realized profit, 25% buys back and burns the Holdfast token. Live on Solana mainnet.`
- **Location:** `Solana`
- **Website:** `https://holdfast.fun`
- **Pinned post:** P1 below with `announce.png`.

Voice rules (from the brand brief): numbers over adjectives; never promise price ("floor", "guaranteed", "can't go down", "100x" are banned); say "vault agent", not "AI" or "bot"; sentence case; dry wit only in replies, never about money.

## Post plan (12 posts, no threads; at most one reply each)

Every number below is read from the chain or computed with the program's own helpers (see `src/cards.mjs` for the sources). Check lengths before posting: X counts any `*.fun` domain as a 23-character link.

| # | Post | Media | Reply |
|---|---|---|---|
| P1 | Pinned announce | `announce.png` | — |
| P2 | Hero video: launch in a minute | `video/launch-in-a-minute.mp4` | — |
| P3 | Article link | X Article “How Holdfast works” | — |
| P4 | Where the money goes | `card-money.png` | yes |
| P5 | Video: the bundle | `video/the-bundle.mp4` | — |
| P6 | Agent rules | `card-agent-rules.png` | yes |
| P7 | Video: the agent defends | `video/agent-defends.mp4` | — |
| P8 | Bundle math | `card-bundle-math.png` | yes |
| P9 | What Holdfast doesn't do | `card-not.png` | yes |
| P10 | Refund and wind-down | `card-refund-winddown.png` | — |
| P11 | Check it yourself | `card-check.png` | yes |
| P12 | Video: claim | `video/claim.mp4` | — |

### P1 · Pinned announce
**Media:** `announce.png`

```
Backers buy first and share the profit.

On Holdfast, backers pool SOL before a token exists. At launch the pool makes its very first buy on pump.fun. A rate-limited vault agent trades the vault; backers get 75% of its realized profit.

holdfast.fun
```

### P2 · Hero video: launch in a minute
**Media:** `video/launch-in-a-minute.mp4`

```
A Holdfast launch in a minute: back the raise, the bundle buys first on pump.fun, the vault agent trades inside the program's limits, backers claim.

Recorded on a local validator running the mainnet pump.fun programs.
```

### P3 · Article link
**Media:** `X Article “How Holdfast works” (article-how-holdfast-works.md), link in the post`

```
How Holdfast works, in one read: who buys first, what the vault agent may do, where every lamport goes, what the admin can and can't do, and how to check each claim against mainnet.
```

### P4 · Where the money goes
**Media:** `card-money.png`

```
Where the money goes on a Holdfast launch:

• vault agent's realized profit: 75% backers, 25% buyback-and-burn
• pump.fun creator fee: 75% vault SOL, 25% buyback-and-burn
• creator: 0% of fees
• Holdfast: 1% of the raise + 0.02 SOL, once
```

**Reply (one, no thread):**

```
Why the creator gets 0%: a creator paid on volume wants volume at any price. On Holdfast the creator's pitch is the bundle itself: the backers funded it, it sits in the vault, and the vault agent sells it only above cost.
```

### P5 · Video: the bundle
**Media:** `video/the-bundle.mp4`

```
Trading on a Holdfast launch is closed until launch_pump runs. That instruction creates the token on pump.fun and makes its first buy with the backers' pool, before any public trade can exist.

$HFPUMP: 1 SOL raised, 0.6705 SOL bought 23.1M tokens.
```

### P6 · Agent rules
**Media:** `card-agent-rules.png`

```
Two checks on every vault agent trade, in the program:

Sell: ≥ 2% over the EMA and ≥ 2% over the vault's average cost. It never realizes a loss.

Buy: ≥ 2% under the EMA and ≤ average cost, or a buy-back paid from its own sales.

Per hour: ≤ 10% of vault SOL, 5% of tokens
```

**Reply (one, no thread):**

```
On top, the agent's own policy: near the launch price with little volume it sells at most 1 SOL an hour, whatever the on-chain cap allows. The allowance grows with market cap and traded volume, and sizes up only into real buy volume. Every decision: holdfast.fun/agents
```

### P7 · Video: the agent defends
**Media:** `video/agent-defends.mp4`

```
The vault agent defends, inside the band: it buys dips at least 2% under the EMA at or below the vault's cost, and sells rallies at least 2% over both. Rate-limited per hour. Every trade is a program instruction that fails if any check fails.
```

### P8 · Bundle math
**Media:** `card-bundle-math.png`

```
Bundle math at the beta cap (50 SOL raise, 30% reserve, 15% bundle cap):

50 − 0.5 launch fee − 0.0204 create rent
The cap binds: 150,000,000 tokens cost 4.936 SOL on a fresh pump.fun curve
44.543 SOL stays in the vault for dip buys
Start market cap ≈ 37.8 SOL
```

**Reply (one, no thread):**

```
A 10 SOL raise on the same terms buys the same 150M tokens for 4.936 SOL and keeps 4.943 SOL. Both from previewPumpBundle, the arithmetic launch_pump runs: holdfast.fun/docs/how-it-works
```

### P9 · What Holdfast doesn't do
**Media:** `card-not.png`

```
What Holdfast doesn't do:

• hold a price
• lock the vault: the admin, a 2-of-3 Squads multisig, can withdraw one. It did once, on the $HFPUMP test launch; the event is on the launch page
• have an external audit yet
• hide the agent's rules: they're in the program
• burn yet
```

**Reply (one, no thread):**

```
Why say it: every vault exit is an on-chain event (agent trade, wind-down, admin withdrawal) and the launch page lists all three. We'd rather show the power than claim a lock we don't have. holdfast.fun/docs/risks
```

### P10 · Refund and wind-down
**Media:** `card-refund-winddown.png`

```
Two ways SOL goes back to backers:

Miss the minimum, or the creator cancels: every backer refunds 100%. No fee.

Launch goes quiet (live 3+ days, no vault trade for 24 h, nobody else holding): anyone can call wind_down_pump. All vault SOL to backers, pro-rata.
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
The vault: 55xnr1fcoQbuzobTpQTMZPPguYyf8YnLVKDAkzcd12yj, a token account owned by the launch's pump-authority PDA. The agent key: FvbdC4n4qXu8JoVLDeb5m8hT8pDSjXFKBCWx322LtWKP, accepted only by agent_buy_pump and agent_sell_pump.
```

### P12 · Video: claim
**Media:** `video/claim.mp4`

```
Backers earn: 75% of the vault agent's realized profit, pro-rata to deposit, claimable any time with claim_backer_fees.

$HFPUMP's first sell realized 0.00641 SOL: 0.00481 to the backer's claim, 0.00160 to the buyback pool.

No wallet? Sign in with Google; the key is exportable.
```
