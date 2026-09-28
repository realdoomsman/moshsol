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
  `Launches that can't be dumped. Backers fund the first buy — it's locked in a vault forever, and they earn 50% of every trading fee. Live on Solana devnet.`
- **Location:** `Solana`
- **Website:** `https://holdfast.up.railway.app`
- **Pinned post:** Post 1 below with `announce.png`.

Voice rules (from the brand brief): numbers over adjectives; never promise price ("floor", "guaranteed", "can't go down", "100x" are banned); say "vault agent", not "AI" or "bot"; sentence case; dry wit only in replies, never about money.

## Launch thread (post 1 is the pin)
1. Launches that can't be dumped.
   Backers fund the first buy. At launch it's locked in an on-chain vault forever — there is no withdraw instruction. Backers earn 50% of every trading fee.
   Live on Solana devnet → holdfast.up.railway.app
   [image: announce.png]
2. How a launch works, in four beats:
   01 Back the raise — miss the minimum and everyone is refunded in full.
   02 The bundle locks — the pool buys first, before any public trade exists.
   03 The vault agent defends — buys dips, sells rallies, inside limits the program enforces.
   04 Backers earn — half of every 1% trading fee, forever.
3. The vault agent can't go rogue. Every trade must pass on-chain checks:
   • price ≥ 2% under/over the EMA
   • buys at or below the vault's average cost
   • sells above cost — the vault never realizes a loss
   • per-window budgets and a 3% max price impact
   The agent key can move value only between the launch's own curve and vault.
4. Rules you can check, not promises. Mint authority revoked. Fixed 1B supply. Fees frozen per launch at creation. 0 withdraw instructions. Every guarantee on the site links to the account that proves it → holdfast.up.railway.app/docs/verify
5. Drag the price on the landing page and watch what the program would let the vault agent do. It's the real arithmetic, seeded with a live launch.

## Standalone posts
- "The first buy on Holdfast is locked forever. Not vested. Not time-locked. There is no instruction that can move it out."
- "Every Holdfast launch freezes its fee split at creation. Backers get 50% of fees. The admin can't change that later."
- "The vault agent's latest call, live: holdfast.up.railway.app/agents"
- "Back a raise with a few devnet SOL, watch the bundle lock, claim your fee share. Nothing to lose but test SOL."
