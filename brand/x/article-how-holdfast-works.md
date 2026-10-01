# How Holdfast works

How Holdfast turns a launch's first buy into a vault that backers fund and a rate-limited agent trades, what the program lets that agent do, what the platform admin can do, and how to check all of it against the chain. Live on Solana mainnet, in beta, at holdfast.fun.

## How a launch usually dies

On most Solana launchpads, the first buyer is whoever lands a transaction first. For creators who want that to be them, there's a product category.

Bundler tools create a token and buy it from many wallets in one atomic package. Solana's Jito bundles run up to 5 transactions "sequentially and atomically", all or nothing (Jito docs). One vendor's pump.fun bundler adds "up to 16 extra wallets" to the launch buy for 0.1 SOL and states the point plainly: "you're the first buyer of your own meme coin, so when the price moves up you can sell and lock in profits." The same vendor sells a bundle-sell tool for selling "from multiple wallets within the same block" (Smithii).

The sequence is familiar to anyone who has traded the trenches:

1. **Block 0.** The token is created and a bundle buys a slice of supply across fresh wallets, so the holder list looks spread out.
2. **The candle.** The chart prints one tall green bar. Scanners show a dozen early holders.
3. **The arrivals.** Buyers see momentum and climb the curve.
4. **The exit.** The bundle wallets sell into that demand, often in the same block. The curve pays them the SOL the later buyers put in. The late buyers hold what's left.

For scale, Solidus Labs counted more than 7 million tokens deployed on pump.fun between January 2024 and March 2025; about 97,000 kept more than $1,000 of liquidity. Its report classed 98.7% of pump.fun tokens as pump-and-dumps or rugs; pump.fun disputed the finding (Benzinga). At the far end, Bubblemaps found 82% of $LIBRA's supply in one wallet cluster within an hour of launch, and describes later tokens from the same operators as launching with "heavy bundling at deploy, multiple wallets sniping the first block" (Bubblemaps).

Nothing in a standard launch stops the first buyer from being the first seller. Holdfast is built to change who the first buyer is, what they can do with the tokens, and to make both checkable.

## What Holdfast is

Holdfast is a Solana program. Every Holdfast launch is an ordinary pump.fun token, created by the program itself, and its first buy is made with SOL that backers pooled before the token existed.

- **Backers buy first.** A creator opens a raise; backers put in SOL (1 SOL minimum raise; in the beta, at most 50 SOL per launch and 5 SOL per wallet). At launch, one instruction creates the token on pump.fun and spends the pool on the very first buy. Nobody can trade before it.
- **The tokens sit in a vault.** The bundle and the reserve SOL belong to the launch account. Nobody holds a key to them. Two things move value out: the vault agent's trades against the token's own market, and the platform admin.
- **The admin can withdraw.** The admin is a 2-of-3 Squads multisig. It can call `admin_withdraw_vault` and take any amount of a vault's SOL and tokens to the platform fee recipient. Every withdrawal is an on-chain `VaultWithdrawn` event, listed on the launch page. The vault is not locked; it is watched.
- **Backers share the profit.** When the vault agent sells above the vault's average cost, 75% of the realized profit is credited to backers pro-rata and 25% goes to a buyback-and-burn pool for the Holdfast token. The creator's share of fees is 0%. Holdfast earns a 1% launch fee and a 0.02 SOL create fee, once per launch, and nothing from trading.

"Backers buy first" is a statement about the bundle. Every other holder, the creator included if they buy on pump.fun like anyone else, can sell at any time, and the price can fall like any token's.

## How a launch works

Four beats. The numbers are from $HFPUMP (Holdfast Pump Test), launch `Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs`, created on mainnet through the same program anyone can use, read from https://api.holdfast.fun on 1 October 2026.

**1. Raise.** A creator sets a minimum and a maximum raise, a duration (1 minute to 14 days), an optional per-wallet cap and whitelist, the bundle cap (1% to 25% of supply) and the reserve (the share of the raise kept as SOL in the vault, up to 80%). Backers deposit SOL. If the minimum isn't met by the deadline, or the creator cancels, every backer refunds 100%.

$HFPUMP set a 1 SOL minimum and a 1.2 SOL maximum with a one-address whitelist and a one-hour deadline, and raised exactly 1 SOL from one backer, the team's wallet, five minutes in.

**2. Launch.** Trading is closed until `launch_pump` runs. The creator can call it once the minimum is met; anyone can once the deadline passes or the raise fills, so a funded raise can't be held hostage. The instruction takes the 1% launch fee, pays pump.fun's create rent, keeps the reserve, and spends the rest on the first buy of the brand-new bonding curve, capped at the bundle cap. If the budget would buy more than the cap, the bundle buys exactly the cap and the unspent SOL stays in the vault.

$HFPUMP: 1 SOL raised → 0.01 SOL launch fee → ≈ 0.02 SOL of pump.fun rent → 30% reserve → 0.6705 SOL bought 23,107,334.88 $HFPUMP, 2.31% of supply, at an average cost of 2.902 × 10⁻⁸ SOL per token.

[image: card-bundle-math.png — the same arithmetic at the 50 SOL beta cap: the 15% bundle cap binds, 4.936 SOL buys 150,000,000 tokens and 44.543 SOL stays in the vault]

**3. The vault agent trades.** Rules in the next section. On $HFPUMP, two seconds after launch the agent sold 1,155,366.74 tokens, exactly its 5%-of-vault hourly budget, for 0.03993 SOL: 3.456 × 10⁻⁸ SOL per token, 19% above the vault's average cost. The realized profit, 0.00641 SOL, was split in the same transaction: 0.00481 SOL to the backer, 0.00160 SOL to the buyback pool. Since then the price has sat inside the band and the agent has held; its reason at agent.holdfast.fun/status reads "price inside band (−0.9% vs EMA)".

**4. Backers earn.** Backers claim their accrued share any time with `claim_backer_fees`. Two more streams feed the vault: pump.fun's creator fee on every trade of the token, which the program collects into the launch and splits 75% into vault SOL and 25% into the buyback pool, and the cost part of every agent sell. On $HFPUMP, `collect_pump_fees` has brought in 0.02119 SOL of creator fees so far; the buyback pool holds 0.0069 SOL.

Ten minutes after launch, the admin multisig withdrew the $HFPUMP vault: 0.3513 SOL and 21,951,968.14 tokens, signature `3KqmGhC8…ray9Aj`, shown on the launch page. It was a test of exactly the power this article keeps mentioning. The backer's accrued 0.00481 SOL was untouched; `admin_withdraw_vault` can't reach backer accruals.

## The vault agent's rules

The agent is an off-chain service with one key. The program accepts that key only in `agent_buy_pump` and `agent_sell_pump`, and every call must pass every check below or the transaction fails. The values are the platform defaults, frozen into each launch at creation; the right-hand figure is the ceiling the program enforces on every future launch.

| Rule | $HFPUMP terms | Hard cap in the program |
|---|---|---|
| EMA band: buy only under, sell only over | 2% (200 bps) | ≥ 0.5%, ≤ 50% |
| EMA period | 30 min | 5 min to 7 days |
| Buy budget per window | 10% of vault SOL | 20% |
| Sell budget per window | 5% of vault tokens | 20% |
| Window | 1 hour | 5 min to 24 h |
| Max price impact per trade | 3% | 10% |

In plain words:

**The EMA can't be yanked.** Before every agent trade the program folds the venue price into the EMA with weight dt / (dt + period), dt clamped to the period:

EMA += (spot − EMA) × dt / (dt + 1800 s)

A price that sat at a new level for 30 minutes moves the EMA halfway there. A second trade in the same second moves it 0%. The weight never reaches 1, so holding a price can't snap the EMA to it. On pump.fun launches the EMA is a sample taken only by the agent's own instructions, never by the permissionless cranks anyone could run right after a flash move.

**Nothing inside the band.** Within 2% of the EMA, the agent can't trade at all.

**The vault never sells at a loss.** The vault tracks the SOL cost of the tokens it holds (average-cost method). A sell has to fill at least 2% above that average.

**The vault can't be steered into buying high.** A buy has to fill at or below the average cost. The one exception is a buy-back paid only from the agent's own earlier sale proceeds, at least 2% under its average sell price, so each sell-then-buy-back round trip ends with more tokens than it sold.

**Budgets are small and reset hourly.** At most 10% of the vault's SOL may be spent and 5% of its tokens sold per hour, and no single trade may move the price more than 3%. For $HFPUMP's 1 SOL raise that was 0.0302 SOL of buys and 1,155,366 tokens of sells per hour, the figures the launch account stores as `windowBuyCap` and `windowSellCap`.

[image: card-agent-rules.png — the two checks, the budgets and the guardrail]

**A guardrail on top, by state, not by clock.** The program's caps are the maximum; the agent's own policy sells less early on. While a launch trades near its launch price with little volume, rally sells may take at most 1 SOL of proceeds per window, whatever the on-chain cap allows. The allowance ramps toward the cap only as both the market-cap multiple over the bundle price (full at 17.6×) and the SOL traded on the token (full at 1,387 SOL) grow, and a rally with net buying on at least 1.39× the median minute volume may sell 6.63× that: into real buy volume, never into a thin uptick. Dip buy-backs are untouched. Each decision, with its reason, is published at agent.holdfast.fun/status and holdfast.fun/agents; the parameters are tuned in a backtest against real pump.fun price history, not by hand.

The agent doesn't hold a price. It's counter-cyclical inside a small budget, and that's all.

## Where the money goes

| Flow | Backers | Buyback-and-burn pool | Vault | Creator | Holdfast |
|---|---|---|---|---|---|
| Vault agent's realized profit (sell fill − average cost) | 75% | 25% | — | 0% | 0% |
| Cost part of every agent sell | — | — | 100% | — | — |
| pump.fun's creator fee on every trade of the token | — | 25% | 75% | 0% | 0% |
| pump.fun's trade fee | pump.fun's own schedule; none of it reaches Holdfast | | | | |
| Launch fee, once | — | — | — | — | 1% of the raise |
| Create fee, once | — | — | — | — | 0.02 SOL |
| Missed minimum or cancelled raise | 100% refund | — | — | — | 0 |

[image: card-money.png — the split, read from the platform account]

`create_launch_pump` copies the launch fee, the burn share and every agent limit into the launch account's `terms`. Changing platform defaults later only affects launches created afterwards, and the program refuses a launch whose terms changed between the creator reviewing and signing (`TermsChanged`). Hard caps the admin can never exceed: launch fee ≤ 5%, create fee ≤ 1 SOL, burn share ≤ 50%, bundle ≤ 30% of supply, and the agent limits in the table above. Tokens are never taken as fees, so Holdfast never has launch tokens to sell.

For scale, the 10 SOL worked example at holdfast.fun/docs/how-it-works: a rally to 1.5× the vault's cost in which the agent sells a tenth of its 150,000,000 tokens realizes 0.2468 SOL of profit; 0.1851 SOL goes to backers, and a backer who put in 1 of the 10 SOL can claim 0.0185 SOL.

## What the program can and cannot do

The program has 30 instructions. Here is every one.

- **Platform (admin only):** `initialize_platform`, `update_platform`, `set_fee_recipient`, `set_agent_authority`, `propose_admin`, `accept_admin`, `migrate_platform`, `migrate_launch`.
- **Raise:** `create_launch_pump` (and the legacy `create_launch`, disabled on mainnet), `deposit`, `cancel_launch` (creator), `refund` (backer).
- **Launch and venue:** `launch_pump` (creator, or anyone once the raise is ready), `graduate_pump` (anyone, records the PumpSwap pool once pump.fun migrated a completed curve), `collect_pump_fees` (anyone), `buyback_burn` (agent authority), `wind_down_pump` (anyone, once eligible); and `launch`, `buy`, `sell`, `wind_down` for the two legacy launches on Holdfast's own curve.
- **Vault agent:** `agent_buy_pump`, `agent_sell_pump` (and `agent_buy`, `agent_sell` on the legacy curve).
- **Claims:** `claim_backer_fees`, `claim_creator_fees`, `sweep_platform_fees`.
- **Vault withdrawal:** `admin_withdraw_vault`.

Instructions that move vault funds to a wallet: one, `admin_withdraw_vault`, admin only, to the platform's fee recipient, with an event every time.

What nobody can do: mint more tokens (pump.fun's `create` leaves no mint authority and no freeze authority), change an existing launch's terms, redirect backer accruals, block refunds, trading or claims with a pause, or spend the buyback pool on anything but buying and burning the Holdfast token.

What the admin can do: withdraw any vault's SOL and tokens to the fee recipient, pause new launches and deposits, pause the agent as a circuit breaker, rotate the agent key, change the fee recipient, and change defaults for future launches within the hard caps. The admin is also the program's upgrade authority, and an upgrade could change any rule. Both are the same 2-of-3 Squads multisig, and every action is a proposal its members sign.

What anyone can do: once a launch has been live for 3 days, saw no vault trade for 24 hours, and every token in existence sits in pump.fun's curve or the vault, anyone can call `wind_down_pump`. The vault's tokens are sold into the venue, all of the vault's SOL is credited to backers pro-rata, and trading stops for good. Claims keep working.

[image: card-refund-winddown.png — the two ways SOL goes back to backers]

## Verify it yourself

Every claim above maps to an account you can open, on mainnet, with any RPC. `getAccountInfo` through https://api.holdfast.fun/rpc works without a key.

- **The program.** `EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ` is executable under the upgradeable loader. Its upgrade authority is `6vUgXnEMbho2pVTEnwwGRj9xjcnb2btKGoWGqoMuzBWF`, the vault of the admin multisig.
- **The multisig.** `29dhkpFcpteUaEZkdooNCFdoGy8z4HBXPpjdAVG3bsT1` is a Squads v4 multisig: threshold 2, 3 members, no time lock. The same vault is the platform's `admin` and `fee_recipient`.
- **A mint.** $HFPUMP, `GyHYt6bjNkXVmECCuzKsMuZLXW8T8L6g8oTH7hhyxnPy`: SPL Token, supply 1,000,000,000, `mintAuthority: null`, `freezeAuthority: null`. Explorers show both authority rows empty.
- **The launch.** `Yw9a3uqxNVDhfD7FBmcbAeZAn81nRuG3Q1K3GDLJfYs` stores the frozen terms: launch fee 100 bps, burn share 2,500 bps, band 200 bps, window 3,600 s, EMA period 1,800 s, buy budget 1,000 bps, sell budget 500 bps, max impact 300 bps. /api/launches/Yw9a3… returns the same fields.
- **The vault.** `55xnr1fcoQbuzobTpQTMZPPguYyf8YnLVKDAkzcd12yj` is the launch's token account, owned by its pump-authority PDA `HBjvgzut64yHQnFxbvv5TZByjv3U9qjcx834RjKCQR98` (`["pump-authority", launch]`), which only the program can sign for. Today it holds 0 tokens: the withdrawal above emptied it, and the event that says so is at /api/launches/GyHY…/activity?type=vault_withdrawn.
- **The agent key.** `FvbdC4n4qXu8JoVLDeb5m8hT8pDSjXFKBCWx322LtWKP`. The program accepts it only in the agent instructions; its decisions are at agent.holdfast.fun/status.

[image: card-check.png — the five accounts]

The same checklist, with live tiles linking each account, is at holdfast.fun/docs/verify. To derive the accounts yourself, `@holdfast/sdk` exports `launchPda`, `pumpAuthorityPda` and the instruction builders; every instruction, who can call it and what it can move is at holdfast.fun/docs/program.

## How it compares

Every launchpad below solves a real problem, and several are larger than Holdfast will be for a long time. The question here is narrower: who can sell a launch's first buy, and what enforces the answer.

- **pump.fun, plain.** Whoever bought it. The creator can buy in the create transaction, and sell whenever they like.
- **bags.fm, default mode.** Whoever bought it.
- **Holdfast.** Nobody holds the bundle. The vault agent may sell it only above the vault's average cost, at most 5% of it per hour; the admin multisig may withdraw it, publicly.

The closest design to ours is Mosh (mosh.trade), which launched on Robinhood Chain on 23 September. The core idea is the same: funders pool a raise, the bundle goes into vaults, agents trade it within per-window limits, and funders earn instead of holding tokens (Mosh docs). Mosh launches through a partner launchpad, its bundle buys from that launchpad's public curve "in steps", and the token graduates to a pool where the agents trade. Holdfast's bundle is a single buy inside `launch_pump` before any public trade exists, and the token is a pump.fun token from its first block.

## Roadmap, and what's not done yet

- **The Holdfast token.** The 25% buyback pool accrues on every launch today, but `buyback_mint` on the platform account is unset, so nothing has been bought or burned yet. Setting it is an `update_platform` proposal on the multisig; until then the pools hold SOL.
- **External audit.** The program and SDK are unaudited. They ship with a litesvm integration suite that asserts the accounting invariants after every step, and the agent policy with a backtest; an external review is on the roadmap.
- **The caps.** 50 SOL per launch and 5 SOL per wallet (creators are exempt on their own launch) stay for now.
- **Custody.** Sign in with Google and Holdfast makes you a wallet, with the key sealed server-side and exportable any time. A wallet you hold yourself is still the better default.

What won't change: the admin keeps `admin_withdraw_vault`. We would rather show the power and the event log than claim a lock we don't have.

[image: card-not.png — what Holdfast doesn't do]
