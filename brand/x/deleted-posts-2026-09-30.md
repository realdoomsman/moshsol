# Posts deleted on 2026-09-30 (devnet-era copy, old domain)

## https://x.com/HoldFastFun/status/2104401252721566034

Mainnet beta, next. What changes:

- max raise: 25 SOL per launch
- max deposit: 5 SOL per wallet
- both snapshotted into each launch at creation
- admin and upgrade key on a Squads multisig
- external audit, report published in full

Until then: devnet, test SOL. Break things.

## https://x.com/HoldFastFun/status/2104403747229040794

Launches that can't be dumped.

On Holdfast, backers' SOL makes the first buy of every launch. It's locked in a vault with 0 withdraw instructions; only a rate-limited vault agent trades it. Backers earn 50% of every trade fee.

Live on Solana devnet. Mainnet beta next.

## https://x.com/HoldFastFun/status/2104404137597088132

A Holdfast launch in under a minute: back the raise, the bundle locks, the vault agent trades inside the rules, backers earn.

Recorded on a local validator and the live devnet site. Every rule shown links to the account that proves it.

## https://x.com/HoldFastFun/status/2104401016741396719

Bundle math at the beta cap (25 SOL raise, 25% bundle, 30% reserve):

25 SOL - 1% launch fee = 24.75
Reserve kept: 7.425
Budget: 17.325, but the cap is 250M tokens, which costs 10 SOL

Vault: 250M tokens + 14.75 SOL
Average cost: 4.0e-8 SOL per token

## https://x.com/HoldFastFun/status/2104400785501212731

How is Holdfast different from Mosh?

Same core idea: backers fund the bundle, it's locked, agents trade it, backers earn fees.

Ours: Solana; the bundle buys before any public trade; price checks run in the program; backers get 50% of trade fees.

Mosh is live. We're on devnet.

## https://x.com/HoldFastFun/status/2104400552339673209

What if the vault agent's key leaks?

Whoever holds it can call agent_buy and agent_sell. Both only move value between a launch's vault and its own curve, inside the band, cost and budget checks.

Nothing can be sent to a wallet. The admin can pause agents and rotate the key.

## https://x.com/HoldFastFun/status/2104400321380557164

Why nobody can buy ahead of the bundle:

Trading on a Holdfast launch is closed until the launch instruction runs. That instruction executes the bundle buy itself, then opens trading. There's no earlier slot to land in.

Creator can call it at min; anyone after the deadline.

## https://x.com/HoldFastFun/status/2104400088021741582

Holdfast launches never graduate.

Each token trades on its own curve for life: no migration to a DEX, no LP tokens anyone could pull, no migration block to snipe.

The trade-off: a curve with 30 virtual SOL is shallow. Big trades move price a lot.

## https://x.com/HoldFastFun/status/2104399854050971773

What Holdfast doesn't do:

- stop anyone except the bundle from selling
- hold a price
- have an external audit yet (internal review only)
- run on mainnet (devnet, test SOL)
- remove the upgrade key: one devnet key can still upgrade the program

The vault agent is an off-chain

## https://x.com/HoldFastFun/status/2104399172103205137

Hourly budgets for the $BARN vault agent on devnet, read from chain on Sep 28:

buys: up to 10% of vault SOL = 0.02673 SOL
sells: up to 5% of vault tokens = 1,018,329 tokens
each trade: at most 3% price impact

The program's ceiling for any launch: 20% per window, 10% impact.

## https://x.com/HoldFastFun/status/2104398933904830841

If a raise misses its minimum by the deadline, or the creator cancels, every backer can refund 100%. No fee.

On devnet our test launch $RFND did exactly that: 0.02 SOL raised, minimum missed, 0.02 SOL refunded.

Try it with test SOL: 
https://
holdfast.up.railway.app

## https://x.com/HoldFastFun/status/2104398694338433358

The vault agent publishes every decision with a reason, including when it does nothing.

Inside 2% of the EMA it can't trade, and it says so: "price inside band". Outside the band, the reason names the check that allowed or blocked the trade.


https://
holdfast.up.railway.app/agents

## https://x.com/HoldFastFun/status/2104398456030642420

Who can sell a launch's first buy?


http://
pump.fun: whoever bought it. The creator can buy in the create transaction.

http://
bags.fm, default mode: whoever bought it.
Holdfast: nobody can withdraw it. Only the vault agent trades it, above cost, up to 5% of vault tokens an hour.

## https://x.com/HoldFastFun/status/2104398218234937366

Every Holdfast launch copies its terms into its own account at creation: trade fee, fee split, launch fee, every vault agent limit.

Changing platform defaults later only affects new launches. There's a test for exactly that: launch_terms_are_frozen_at_creation.

## https://x.com/HoldFastFun/status/2104397979629109479

For creators: you set the raise, the bundle size (1-25% of supply) and how much SOL stays in the vault. You earn 30% of every trade fee. You get no token allocation.

Your pitch to backers becomes checkable: the first buy is theirs, and it's locked.


https://
holdfast.up.railway.app/create

## https://x.com/HoldFastFun/status/2104397741938131317

Two checks on every vault agent trade:

Sell: fill at least 2% above the vault's average cost. It never realizes a loss.

Buy: fill at or below that average cost, or a buy-back paid from its own sales, 2%+ under its average sell.

It can't be steered into buying high.

## https://x.com/HoldFastFun/status/2104397466275594703

The vault agent trades off an EMA the program updates before every trade:

ema += (spot - ema) * dt / (dt + period)

Same-second trades move it 0%. 30 minutes at a new price moves it halfway. The weight never reaches 1, so holding a price can't snap the EMA to it.

## https://x.com/HoldFastFun/status/2104397226004889648

What backing a Holdfast raise gets you:

- your SOL makes the first buy, before any public trade
- those tokens are locked; only the vault agent trades them, inside on-chain limits
- 0.5% of every public trade, pro-rata to your deposit
- a 100% refund if the minimum isn't met

## https://x.com/HoldFastFun/status/2104396987328028902

Check it yourself. $BARN on devnet:

supply: 1,000,000,000, fixed
mint authority: none
freeze authority: none

The explorer labels it "Fixed Supply". The bundle, 20,366,579 tokens, sits in a vault owned by the launch account. No instruction moves it out.


https://
explorer.solana.com/address/2EHies
vgebXTC3A1XkiwN7MtxqnHp5zZCrjU8tGGC1nD?cluster=devnet
…

## https://x.com/HoldFastFun/status/2104396748638810255

Withdraw instructions in the Holdfast program: 0.

There are 18 instructions. The only ones that touch a launch's vault move value between that vault and the same launch's curve.

Not the creator, not the admin, not the vault agent can send vault tokens or SOL to a wallet.

## https://x.com/HoldFastFun/status/2104396614408540395

How a bundled launch usually goes:

1. Block 0: the creator buys from many wallets in one atomic bundle
2. One green candle, a dozen "holders"
3. Buyers arrive
4. The bundle sells into them, often in one block

Holdfast removes step 4. The first buy is locked in a vault.

## https://x.com/HoldFastFun/status/2104393740492161520


