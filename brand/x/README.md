# Holdfast — X account kit

## Images (upload these)
| File | Use | Size |
|---|---|---|
| `pfp.png` | **Profile picture** (recommended) — the Clamp mark on ink | 1000×1000 |
| `pfp-paper.png` / `pfp-orange.png` | Alternates (light, orange) | 1000×1000 |
| `banner.png` | **Header** (light, matches the landing page) | 1500×500 @2x (3000×1000) |
| `banner-night.png` | Header, dark alternate (matches the app) | 3000×1000 |
| `announce.png` / `announce-night.png` | Pinned launch post image | 1600×900 |
| `preview-profile.png` | How the profile looks with pfp + banner (not for upload) | — |

The price line in the banner and card is real data: the price, EMA band and vault agent trades of a $MOSH launch on a local Solana validator, drawn with the site's chart rules (orange dashes = agent band, filled diamond = vault bought, hollow = vault sold). Sources are in `src/` (HTML, render at the listed sizes).

## Profile fields
- **Name:** `Holdfast`
- **Handle ideas:** `@holdfast`, `@holdfastfun`, `@holdfast_sol`, `@holdfastlaunch` (check which is free)
- **Bio (160 max):**
  `Backers buy first and share the profit: 100% of the vault agent's realized profit and 50% of every trading fee. Live on Solana.`
- **Location:** `Solana`
- **Website:** `https://holdfast.fun`
- **Pinned post:** Post 1 below with `announce.png`.

Voice rules (from the brand brief): numbers over adjectives; never promise price ("floor", "guaranteed", "can't go down", "100x" are banned); say "vault agent", not "AI" or "bot"; sentence case; dry wit only in replies, never about money.

## Launch thread (post 1 is the pin)
1. Backers buy first and share the profit.
   Backers fund the first buy. It sits in an on-chain vault, traded only by a rate-limited agent. Backers get 100% of its realized profit and 50% of every trading fee.
   Live on Solana → holdfast.fun
   [image: announce.png]
2. How a launch works, in four beats:
   01 Back the raise — miss the minimum and everyone is refunded in full.
   02 The bundle buys first — before any public trade exists.
   03 The vault agent defends — buys dips, sells rallies, inside limits the program enforces.
   04 Backers earn — half of every 1% trading fee and all of the agent's realized profit.
3. The vault agent can't go rogue. Every trade must pass on-chain checks:
   • price ≥ 2% under/over the EMA
   • buys at or below the vault's average cost
   • sells above cost — the vault never realizes a loss
   • per-window budgets and a 3% max price impact
   The agent key can move value only between the launch's own curve and vault.
4. Rules you can check, not promises. Mint authority revoked. Fixed 1B supply. Fees frozen per launch at creation. Only the platform admin (a Squads multisig) can withdraw a vault, and every withdrawal shows on the launch page → holdfast.fun/docs/verify
5. When a launch goes quiet — 3+ days old, no trade for 24h, nobody outside the curve and vault holding — anyone can wind it down. The vault's tokens go back to the curve and the curve's and vault's SOL goes to backers.
6. Drag the price on the landing page and watch what the program would let the vault agent do. It's the real arithmetic, seeded with a live launch.

## Standalone posts
- "On Holdfast, when the vault agent sells above its average cost, 100% of the profit goes to the backers who funded the first buy."
- "The platform admin can withdraw a vault with admin_withdraw_vault. Every withdrawal is an on-chain event, shown on the launch page."
- "Every Holdfast launch freezes its fee split at creation. Backers get 50% of fees. The admin can't change that later."
- "The vault agent's latest call, live: holdfast.fun/agents"
- "Back a raise from 1 SOL, watch the bundle buy first, claim your fee and profit share. Sign in with Google if you don't have a wallet."
