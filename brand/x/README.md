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
   On Holdfast, backers fund a token's first buy. The launch creates the token on pump.fun and buys the bundle before anyone else can. A rate-limited vault agent trades it; backers get 75% of its realized profit.
   Live on Solana → holdfast.fun
   [image: announce.png]
2. How a launch works:
   01 Back the raise — miss the minimum and everyone is refunded in full.
   02 Launch — the token is created on pump.fun and the bundle is its first buy.
   03 The vault agent trades — sells into rallies, buys back dips, inside limits the program enforces.
   04 Earn — 75% of the agent's realized profit goes to backers, 25% buys back and burns the Holdfast token.
3. The creator gets 0% of fees. pump.fun's creator fee on every trade flows to the launch instead: 75% into the vault as market-making capital, 25% to the buyback-and-burn pool. Holdfast itself only earns the 1% launch fee and the create fee.
4. The vault agent can't go rogue. Every trade must pass on-chain checks:
   • price ≥ 2% under/over the EMA
   • buys at or below the vault's average cost
   • sells above cost — the vault never realizes a loss
   • per-window budgets and a 3% max price impact
   • near the launch price with little volume it may sell about 1 SOL an hour, and only sells big into real buy volume
   The agent key can move value only between the launch's vault and the token's own market.
5. Rules you can check, not promises. Fixed supply, metadata on-chain, terms frozen per launch at creation. The platform admin (a Squads multisig) can withdraw a vault, and every withdrawal shows on the launch page → holdfast.fun/docs/verify
6. When a launch goes quiet — 3+ days old, no trade for 24h, nobody outside the market and the vault holding — anyone can wind it down. The vault sells what's left and all its SOL goes to backers.
7. No wallet? Sign in with Google and Holdfast makes you one. Export the key any time.

## Standalone posts
- "On Holdfast, when the vault agent sells above its average cost, 75% of the profit goes to the backers who funded the first buy and 25% buys back and burns the Holdfast token."
- "The platform admin can withdraw a vault with admin_withdraw_vault. Every withdrawal is an on-chain event, shown on the launch page."
- "Creators on Holdfast earn 0% of fees. The pump.fun creator fee goes to the vault that trades their token and to the burn pool. Every launch freezes that at creation."
- "The vault agent's latest call, live: holdfast.fun/agents"
- "Back a raise from 1 SOL, watch the bundle buy first on pump.fun, claim your share of the agent's profit. Sign in with Google if you don't have a wallet."
