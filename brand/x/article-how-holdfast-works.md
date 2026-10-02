# How Holdfast works

*Backers buy first, a vault agent works the chart, and every rule is an account you can open.*

[cover: cover.png — title card]

What a Holdfast launch is, what the vault agent may do, when backers are paid back, what the admin and the dev key can do, and how to check each of those against the chain. Live on Solana mainnet, in beta, at holdfast.fun.

## The first buyer is usually the first seller

On a bonding-curve launch the first buy is the cheapest buy there will ever be, and whoever makes it decides when it is sold. Nothing in a standard launch separates the two: the wallet that buys at block 0 is the wallet that can sell at block 1, and the curve pays it with the SOL of everyone who arrived after. The chart shows the first candle; it does not show who holds it, or that holding it was ever conditional.

Holdfast changes who makes that first buy, where the tokens go, and what can be done with them, and makes each of those three things checkable. The first buy is made with SOL that backers pooled before the token existed, in the same instruction that creates the token. The tokens go into a vault that no wallet holds a key to. What can be done with them is a short list of program instructions with limits the program enforces on every call. The rest of this article is that list, with the numbers.

## What Holdfast is

Holdfast is a Solana program. Every Holdfast launch is an ordinary pump.fun token, created by the program itself, and its first buy is made with SOL that backers pooled before the token existed.

- **Backers buy first.** A creator opens a raise; backers put in SOL (1 SOL minimum raise; in the beta, at most 50 SOL per launch and 5 SOL per wallet). At launch, one instruction creates the token on pump.fun and spends the pool on the very first buy, the bundle. Nobody can trade before it.
- **The bundle sits in a vault.** The bundle and the SOL left over at launch belong to the launch account. Nobody holds a key to them. Four things move value out: the vault agent's trades against the token's own market, the on-chain payback rule, the platform admin, and the dev key.
- **A vault agent works the chart.** It sells slowly into strength, more the higher the market cap has run and the more real buy volume there is, sized so no trade moves the price more than 3%, and buys dips back with what it sold. Everything it sells for stays in the vault as SOL. There is no profit split; the vault is meant to grow.
- **Backers are paid back from the vault.** Once the vault's liquid SOL reaches 5× what went in at launch and the chart is strong, the agent may pay backers: their principal first, then 15% of the vault, never more than once per 4 hours. On top, 10% of pump.fun's creator fees go to backers on every trade, claimable any time.
- **The admin and the dev key can withdraw.** The admin is a 2-of-3 Squads multisig; the dev key is a single key the admin sets. The admin can call `admin_withdraw_vault` and take any amount of a vault's SOL and tokens to the platform fee recipient; the dev key can call `dev_withdraw_vault` and take the same to its own wallet. Neither can touch the token's liquidity on pump.fun, what backers have accrued, or the buyback pool. Every withdrawal is an on-chain event (`VaultWithdrawn` or `VaultWithdrawnByDev`), listed on the launch page. The vault is not locked; it is watched.
- **Holdfast earns the launch fee and nothing else.** 1% of the raise plus a 0.02 SOL create fee, once per launch. The creator's share of fees is 0%.

"Backers buy first" is a statement about the bundle. Every other holder, the creator included if they buy on pump.fun like anyone else, can sell at any time, and the price can fall like any token's. "Paid back" is a statement about a rule: it fires only if the vault gets there.

[image: card-how.png — the four beats: raise, launch, the vault agent works the chart, backers get paid back]

## How a launch works

Four beats, with the numbers of the 10 SOL worked example from holdfast.fun/docs/how-it-works. The launch arithmetic is `previewPumpBundle`, the same bundle maths `launch_pump` runs, on the create wizard's default terms (30% reserve, no bundle cap: the bundle buys as much as the raise can, up to 75% of supply). A real launch's fills differ by its venue fees and price.

**1. Raise.** A creator sets a minimum and a maximum raise, a duration (1 minute to 14 days), an optional per-wallet cap and whitelist, the reserve (the share of the raise kept as SOL in the vault, up to 80%) and, optionally, a bundle cap (1% to 75% of supply). Without a cap the bundle follows the raise: the more SOL raised, the bigger the share of supply it buys, up to 75%. Backers deposit SOL. If the minimum isn't met by the deadline, or the creator cancels, every backer refunds 100%.

Say the raise closes at 10 SOL and you put in 1 SOL, a 10% share.

**2. Launch.** Trading is closed until `launch_pump` runs. The creator can call it once the minimum is met; anyone can once the deadline passes or the raise fills, so a funded raise can't be held hostage. The instruction takes the 1% launch fee, pays pump.fun's create rent, keeps the reserve, and spends the rest on the first buy of the brand-new bonding curve, up to the bundle cap (75% of supply without one). If the budget would buy more than the cap, the bundle buys exactly the cap and the unspent SOL stays in the vault. The buy never completes pump.fun's curve at launch either: whatever the curve can't take also stays as vault SOL. pump.fun's curve completes at roughly 85 SOL of buys.

| Where the 10 SOL goes | Amount |
|---|---|
| Launch fee (1%) to Holdfast | 0.1 SOL |
| pump.fun create rent | ≈ 0.0204 SOL |
| The bundle: the first buy on the curve, including pump.fun's fee | 6.792 SOL → 196,085,371 tokens (19.6% of supply) |
| Reserve kept as vault SOL for dip buys | 3.087 SOL |
| What went in at launch (`initial_vault_sol`) | 9.8796 SOL |
| Market cap right after the bundle | ≈ 41.86 SOL |

[image: card-bundle.png — one instruction: pump.fun Create, then the bundle Buy, nothing between]

**3. The vault agent works the chart.** Rules in the next section. Say that weeks later the price rallies to 3× the bundle's entry and the agent sells a tenth of its tokens into it, sized so the sell doesn't dent the chart:

| The rally sell | Amount |
|---|---|
| Tokens sold (19,608,537) | cost 0.6792 SOL → sold for 2.0376 SOL |
| Proceeds, kept in the vault as SOL | 2.0376 SOL |
| Vault SOL after the sell (liquid SOL only, the payback rule's measure) | 5.125 SOL (0.51× what went in) |

Nothing leaves the vault on a sell. That SOL is what the agent buys the next dip with, and the cycle repeats as long as the token trades. Meanwhile pump.fun pays the launch a creator fee on every trade of the token; say `collect_pump_fees` has swept 2 SOL of it so far:

| Creator fees swept | Amount |
|---|---|
| To the vault as SOL (75%) | 1.5 SOL |
| To the buyback-and-burn pool (15%) | 0.3 SOL |
| To backers by deposit share (10%) | 0.2 SOL |
| Your 10% share, claimable now | 0.02 SOL |

**4. Backers get paid back.** The last step, and it is opportunistic, not a promise. Only when the vault's liquid SOL reaches 5× what went in at launch (49.398 SOL here; tokens don't count) and the chart is strong may the agent pay backers:

| Payback | Amount |
|---|---|
| Vault SOL needed (5× of 9.8796 SOL) | 49.398 SOL |
| First payout: the principal, by deposit share | 9.8796 SOL · your 10%: 0.988 SOL |
| Then, at most every 4 h while the chart stays strong: 15% of the vault | 5.928 SOL of 39.518 SOL · your 10%: 0.593 SOL |

The principal payout starts the 4 h clock too. If the vault is under 5× or the chart is weak at the check, nothing is paid; buying back dips always comes first, and no payout can take the vault below its 0.1 SOL floor. A token that never gets there pays nothing beyond its share of creator fees, and a token that falls stays down until it doesn't.

## The vault agent

[image: card-vault.png — what the vault agent does: sells into strength, buys back dips, everything it sells for stays in the vault]

The agent is an off-chain service with one key. The program accepts that key only in `agent_buy_pump`, `agent_sell_pump`, `payout_backers` and `buyback_burn`, and every trade must pass every check below or the transaction fails. The values are the platform defaults, frozen into each launch at creation; the right-hand figure is the ceiling the program enforces on every future launch.

| Rule | Launch terms | Hard cap in the program |
|---|---|---|
| EMA band: buy only under, sell only over | 2% (200 bps) | ≥ 0.5%, ≤ 50% |
| EMA period | 30 min | 5 min to 7 days |
| Buy budget per window | 10% of vault SOL | 20% |
| Sell budget per window | 5% of vault tokens | 20% |
| Window | 1 hour | 5 min to 24 h |
| Max price impact per trade | 3% | 10% |
| Vault SOL floor | 0.1 SOL | ≥ 0.05 SOL |

In plain words:

**The EMA can't be yanked.** Before every agent trade the program folds the venue price into the EMA with weight dt / (dt + period), dt clamped to the period:

EMA += (spot − EMA) × dt / (dt + 1800 s)

A price that sat at a new level for 30 minutes moves the EMA halfway there. A second trade in the same second moves it 0%. The weight never reaches 1, so holding a price can't snap the EMA to it. On pump.fun launches the EMA is a sample taken only by the agent's own instructions, never by the permissionless cranks anyone could run right after a flash move.

**Nothing inside the band.** Within 2% of the EMA, the agent can't trade at all.

**The vault never sells at a loss.** The vault tracks the SOL cost of the tokens it holds (average-cost method). A sell has to fill at least 2% above that average, and the whole fill, cost and gain alike, goes to vault SOL.

**The vault can't be steered into buying high.** A buy has to fill at or below the average cost, or, as a buy-back, at least 2% under the agent's own average sell price, so each sell-then-buy-back round trip ends with more tokens than it sold. Either way it spends vault SOL, never below the 0.1 SOL floor (`VaultFloor`).

**Budgets are small and reset hourly.** At most 10% of the vault's SOL may be spent and 5% of its tokens sold per hour, and no single trade may move the price more than 3%. The launch account stores the budgets as `windowBuyCap` and `windowSellCap`.

**Anti-sandwich.** A vault trade's slippage floor is checked against the measured fill, so a trade that gets sandwiched fails instead of filling badly.

[image: card-agent-rules.png — what every vault agent trade must pass]

**A sell ramp on top, by state, not by clock.** The program's caps are the maximum; the agent's own policy sells less early on. While a launch trades near its launch price with little volume, rally sells may take at most 1 SOL of proceeds per window, whatever the on-chain cap allows. The allowance ramps toward the cap only as both the market-cap multiple over the bundle price (full at 17.6×) and the SOL traded on the token (full at 1,387 SOL) grow, and a rally with net buying on at least 1.39× the median minute volume may sell 6.63× that: into real buy volume, never into a thin uptick. Selling is not a bad outcome; the proceeds are what buys the next dip.

**Support mode when the chart is quiet.** While the launch's 24-hour activity is below 2× the vault's SOL, dip buys shrink to a third of the size the band, impact and window rules would allow and keep at least 5 minutes between the agent's own fills: small, spaced buys that give a quiet chart volume without spending a window's budget in one clip.

**The payout gate.** `payout_backers` is signed by the agent key, so nobody can force a payout while the vault should be buying a dip. The program decides whether a payout is allowed (liquid vault SOL ≥ 5× what went in, ≥ 4 h since the last one, never below the floor; principal first, then 15%). The agent decides when: only when spot is above the EMA band, net buying is running on at least 1.39× the median minute volume, the price is above the 30-minute VWAP and the launch price, and no more than 20% under the 24-hour high. A due payout in a weak market is skipped and the reason is written to the launch's activity feed ("payout eligible, skipped: price under EMA band").

**What the AI does, and doesn't.** Every decision, including every do-nothing reason, is appended to a per-launch activity feed at holdfast.fun/agents. A language model puts those decisions into plain English on the launch page: it describes decisions the rules already made, never makes one, and never sees the key. Separately, a research loop periodically re-fits the policy's knobs (entry margins, the ramp, support mode) on real pump.fun history and adopts a proposal only if it beats the current parameters out of sample and every value stays inside a fixed parameter space; the program's hard caps are the launch terms the policy cannot touch, so no proposal can widen what the vault may do. What it learned is published as "What the agent learned" on the site.

The agent doesn't hold a price. It's counter-cyclical inside a small budget, and that's all.

## Where the money goes

| Flow | Vault | Backers | Buyback-and-burn pool | Creator | Holdfast |
|---|---|---|---|---|---|
| Everything the vault agent sells for | 100% | — | — | — | — |
| pump.fun's creator fee on every trade of the token | 75% | 10% (claimable any time) | 15% | 0% | 0% |
| Backer payback (`payout_backers`), once the vault is 5× liquid | — | principal, then 15% of the vault per payout, ≥ 4 h apart | — | — | — |
| pump.fun's trade fee | pump.fun's own schedule; none of it reaches Holdfast | | | | |
| Launch fee, once | — | — | — | — | 1% of the raise |
| Create fee, once | — | — | — | — | 0.02 SOL |
| Missed minimum or cancelled raise | — | 100% refund | — | — | 0 |
| Dead launch (`wind_down_pump`) | — | all vault SOL, pro-rata | — | — | 0 |

[image: card-money.png — the split, frozen into every launch]

`create_launch_pump` copies the launch fee, the creator-fee split, every agent limit and the payback terms into the launch account's `terms`. Changing platform defaults later only affects launches created afterwards. Hard caps the admin can never exceed: launch fee ≤ 5%, create fee ≤ 1 SOL, vault share of creator fees ≤ 90%, burn share ≤ 50%, payout multiple ≥ 1×, payout share ≤ 50%, payout interval ≥ 1 h, dead-holder threshold ≤ 20%, vault floor ≥ 0.05 SOL, bundle ≤ 75% of supply, and the agent limits in the table above. Tokens are never taken as fees, so Holdfast never has launch tokens to sell.

## When backers get paid back

| The rule | Value | Who enforces it |
|---|---|---|
| Vault liquid SOL (tokens don't count) | ≥ 5× `initial_vault_sol` | program |
| First payout | the principal, by deposit share | program |
| Each later payout | 15% of vault SOL | program |
| Between payouts | ≥ 4 h | program |
| Vault floor no payout may cross | 0.1 SOL | program |
| Who can crank it | the agent key only | program |
| Chart check at the moment of the crank | spot above the EMA band, net buying on ≥ 1.39× median minute volume, above the 30 min VWAP and the launch price, within 20% of the 24 h high | agent policy |
| A dip at the same time | the dip buy comes first; the payout is skipped and logged | agent policy |
| Where it lands | each backer's claimable balance, pro-rata; `claim_backer_fees` any time | program |

[image: card-payback.png — the payback rule: 5× liquid, principal first, then 15% at most every 4 h, dips first, 0.1 SOL floor]

Every payout is a `BackersPaid` event on the launch page. Separately, and from the first trade, 10% of pump.fun's creator fees accrue to backers by deposit share and are claimable any time, whether or not the vault ever reaches 5×.

## What the program can and cannot do

The program has 33 instructions. Here is every one, by who may sign it.

- **Anyone:** `launch_pump` (once the deadline passed or the raise filled), `graduate_pump` (records the PumpSwap pool once pump.fun migrated a completed curve), `collect_pump_fees` (sweeps the creator fee into the 75/15/10 split), `sweep_platform_fees` (moves Holdfast's accrued fee to the fee recipient), `wind_down_pump` (dead launches only: live 3 days, no vault trade for 24 h, at most 5% of supply outside the curve and the vault), `accept_admin` (the proposed new admin). On the legacy Holdfast curve: `launch`, `buy`, `sell`, `wind_down`.
- **Creator:** `create_launch_pump` (and the legacy `create_launch`, disabled on mainnet), `launch_pump` as soon as the minimum is met, `cancel_launch` before launch, `claim_creator_fees` (0% by default, so nothing to claim).
- **Backer:** `deposit`, `refund` (missed minimum or cancelled raise), `claim_backer_fees` (the 10% fee share and any payback).
- **Vault agent (one key):** `agent_buy_pump`, `agent_sell_pump` (and `agent_buy`, `agent_sell` on the legacy curve), `payout_backers`, `buyback_burn`. Every trade passes the checks in the table above or fails.
- **Admin (2-of-3 multisig):** `initialize_platform`, `update_platform`, `set_fee_recipient`, `set_agent_authority`, `set_dev_authority`, `propose_admin`, `migrate_platform`, `migrate_launch`, `admin_withdraw_vault`.
- **Dev key (one key, set by the admin):** `dev_withdraw_vault`.

Instructions that move vault funds to wallets: `payout_backers` (to backers' claimable balance, under the payback rule), `wind_down_pump` (to backers, dead launches only), `admin_withdraw_vault` (admin only, to the platform's fee recipient) and `dev_withdraw_vault` (the dev key only, to its own wallet), with an event every time.

What nobody can do: mint more tokens (pump.fun's `create` leaves no mint authority and no freeze authority), change an existing launch's terms, redirect what backers have accrued, block refunds, trading or claims with a pause, pay backers before the vault is 5× liquid or more often than once per 4 hours, or spend the buyback pool on anything but buying and burning the Holdfast token.

What the admin can do: withdraw any vault's SOL and tokens to the fee recipient, pause new launches and deposits, pause the agent as a circuit breaker (which also stops payouts and buybacks), rotate the agent key, set, rotate or disable the dev key, change the fee recipient, and change defaults for future launches within the hard caps. The admin is also the program's upgrade authority, and an upgrade could change any rule. Both are the same 2-of-3 Squads multisig, and every action is a proposal its members sign.

What the dev key can do: withdraw any vault's SOL and tokens to its own wallet with `dev_withdraw_vault`, under the same accounting as the admin's withdrawal (never the token's liquidity, backers' accruals or the buyback pool), even while the platform is paused. It can do nothing else. Every use is a `VaultWithdrawnByDev` event on the launch page.

What anyone can do: once a launch has been live for 3 days, saw no vault trade for 24 hours, and at most 5% of the supply sits outside pump.fun's curve and the vault, anyone can call `wind_down_pump`. The vault's tokens are sold into the venue, all of the vault's SOL goes to backers pro-rata (possibly less than they put in), and trading stops for good. Claims keep working.

[image: card-not.png — what Holdfast doesn't do]

## Verify it yourself

Every claim above maps to an account you can open, on mainnet, with any RPC. `getAccountInfo` through https://api.holdfast.fun/rpc works without a key.

- **The program.** `EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ` is executable under the upgradeable loader. Its upgrade authority is `6vUgXnEMbho2pVTEnwwGRj9xjcnb2btKGoWGqoMuzBWF`, the vault of the admin multisig.
- **The multisig.** `29dhkpFcpteUaEZkdooNCFdoGy8z4HBXPpjdAVG3bsT1` is a Squads v4 multisig: threshold 2, 3 members, no time lock. The same vault is the platform's `admin` and `fee_recipient`.
- **Any launch's mint.** Open a launch page on holdfast.fun and its "Verify on-chain" panel: mint authority revoked, freeze authority none, supply 1,000,000,000 fixed, the vault's token balance, all read live, each account with an explorer link. Explorers show both authority rows empty.
- **Any launch's terms.** The launch account the panel links stores them frozen: launch fee 100 bps, band 200 bps, window 3,600 s, EMA period 1,800 s, buy budget 1,000 bps, sell budget 500 bps, max impact 300 bps, the 75/15/10 creator-fee split and the payback terms. `/api/launches/<launch address>` on api.holdfast.fun returns the same fields decoded.
- **Any launch's transaction.** The launch page's activity lists the launch event with an explorer link. Open it: one `LaunchPump` instruction whose inner instructions are pump.fun's `Create` and then `Buy`. No other transaction can run between the two.
- **The vault.** A token account owned by the launch's pump-authority PDA (`["pump-authority", launch]`), which only the program can sign for. Every exit from it (agent trade, payout, wind-down, admin or dev-key withdrawal) is an event listed on the launch page.
- **The dev key.** Shown on the platform account as `dev_authority` and on the verify page; the default pubkey means no dev key is set. It is the only key besides the admin that can withdraw a vault.
- **The agent key.** Shown on the platform account as `agent_authority` and on the verify page. The program accepts it only in the agent instructions; it can never withdraw. Its decisions are at agent.holdfast.fun/status and holdfast.fun/agents.

[image: card-check.png — program id, multisig, and where to open any launch's own accounts]

The same checklist, with live tiles linking each account, is at holdfast.fun/docs/verify. To derive the accounts yourself, `@holdfast/sdk` exports `launchPda`, `pumpAuthorityPda`, `payoutStatus` and the instruction builders; every instruction, who can call it and what it can move is at holdfast.fun/docs/program.

## Risks and what's not done

- **The admin and the dev key can withdraw a vault.** `admin_withdraw_vault` (the 2-of-3 multisig) and `dev_withdraw_vault` (a single dev key, to its own wallet) exist and stay. Every use is a `VaultWithdrawn` or `VaultWithdrawnByDev` event on the launch page. We would rather show the power and the event log than claim a lock we don't have.
- **The program is upgradeable, and unaudited.** The upgrade authority is the admin multisig; an upgrade could change any rule. The program and SDK ship with a litesvm integration suite that asserts the accounting invariants after every step, and the agent policy with a backtest; no external review has been done yet.
- **Price can fall.** The vault holds one slice of supply and trades inside hourly budgets. Every other holder can sell at any time. The agent doesn't hold a price.
- **Payback is conditional.** No payout happens unless a vault reaches 5× liquid SOL and the chart is strong at the check. Many tokens never get there. A wind-down returns the vault's SOL pro-rata, which can be less than what went in.
- **The Holdfast token isn't live.** The 15% buyback pool accrues on every launch; `buyback_mint` on the platform account is unset, so nothing has been bought or burned yet. Setting it is an `update_platform` proposal on the multisig.
- **Beta caps.** 50 SOL per launch and 5 SOL per wallet (creators are exempt on their own launch) stay for now.
- **Custody.** Sign in with Google and Holdfast makes you a wallet, with the key sealed server-side and exportable any time. A wallet you hold yourself is still the better default.

The full list is at holdfast.fun/docs/risks.

## Links

- Site: https://holdfast.fun
- How it works, with the 10 SOL example: https://holdfast.fun/docs/how-it-works
- Verify on-chain: https://holdfast.fun/docs/verify
- Risks: https://holdfast.fun/docs/risks
- Program instructions and IDL: https://holdfast.fun/docs/program
- Every vault agent decision: https://holdfast.fun/agents
- Indexer API: https://api.holdfast.fun
- Agent status: https://agent.holdfast.fun/status
