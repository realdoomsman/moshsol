How Holdfast locks the first buy of every launch in an on-chain vault, what its vault agent is allowed to do with it, and what nobody can do. Live on Solana devnet; mainnet beta next.
How a launch usually dies
On most Solana launchpads, the first buyer is whoever lands a transaction first. For creators who want that to be them, there's a product category.
Bundler tools create a token and buy it from many wallets in one atomic package. Solana's Jito bundles run up to 5 transactions "sequentially and atomically", all or nothing (Jito docs). One vendor's pump.fun bundler adds "up to 16 extra wallets" to the launch buy for 0.1 SOL and states the point plainly: "you're the first buyer of your own meme coin, so when the price moves up you can sell and lock in profits." The same vendor sells a bundle-sell tool for selling "from multiple wallets within the same block" (Smithii).
The sequence is familiar to anyone who has traded the trenches:
Block 0. The token is created and a bundle buys a slice of supply across fresh wallets, so the holder list looks spread out.
The candle. The chart prints one tall green bar. Scanners show a dozen early holders.
The arrivals. Buyers see momentum and climb the curve.
The exit. The bundle wallets sell into that demand, often in the same block. The curve pays them the SOL the later buyers put in. The late buyers hold what's left.
For scale, Solidus Labs counted more than 7 million tokens deployed on pump.fun between January 2024 and March 2025; about 97,000 kept more than $1,000 of liquidity. Its report classed 98.7% of pump.fun tokens as pump-and-dumps or rugs; pump.fun disputed the finding (Benzinga). At the far end, Bubblemaps found 82% of $LIBRA's supply in one wallet cluster within an hour of launch, and describes later tokens from the same operators as launching with "heavy bundling at deploy, multiple wallets sniping the first block" (Bubblemaps).
Nothing in a standard launch stops the first buyer from being the first seller. Holdfast is built to remove that one option, and to make the removal checkable.
Edit
Provide a caption (optional)
What Holdfast is
Holdfast is a Solana launchpad program where the first buy of every launch is made with backers' pooled SOL, and the tokens it buys are locked in a program-owned vault forever.
0 withdraw instructions. No instruction in the program sends vault tokens or vault SOL to a wallet: not to the creator, not to the admin, not to the agent.
A vault agent with one narrow key. An off-chain service trades the vault against the launch's own curve, and only when the program's checks pass. It can move value between the vault and that curve. Nowhere else.
Backers earn 50% of the 1% trade fee on every public trade, for as long as the token trades.
"Can't be dumped" means the bundle. Every other holder, the creator included if they buy on the curve, can sell at any time, and the price can fall like any token's.
How a launch works
Four beats. The numbers are from $BARN (Barnacle), a demo launch the team created on devnet through the same program anyone can use.
Edit
Provide a caption (optional)
1. Raise. A creator sets a minimum and maximum raise, a duration (60 seconds to 14 days), an optional per-wallet cap and whitelist, the bundle size (1% to 25% of supply) and the reserve (the share of the raise kept as SOL in the vault, up to 80%). In the same instruction that creates the launch, the program mints the entire 1,000,000,000-token supply to the curve and revokes the mint authority. The mint has no freeze authority. Backers deposit SOL. If the minimum isn't met by the deadline, or the creator cancels, every backer can refund 100%.
$BARN set a 0.5 SOL minimum and a 0.9 SOL maximum, and raised 0.9 SOL from one backer, the team's test wallet.
2. Lock. Trading is closed until launch runs. The creator can call it once the minimum is met; anyone can once the deadline passes or the raise fills. It takes the 1% launch fee, sets the reserve aside, and spends the rest buying from the curve, before any public trade can exist. If that budget would buy more than the bundle cap, the bundle buys exactly the cap and the unspent SOL stays in the vault.
$BARN: 0.9 SOL raised → 0.009 SOL launch fee → 0.2673 SOL reserve (30%) → 0.6237 SOL bought 20,366,579 $BARN, 2.04% of supply. The vault's average cost is 3.062 × 10⁻⁸ SOL per token; the bundle left the spot price at 3.126 × 10⁻⁸.
3. The vault agent trades. Rules below.
4. Backers earn. Every public buy and sell pays 1%: 0.5% to backers pro-rata to their deposit, claimable any time; 0.3% to the creator; 0.2% to the platform.
Each launch trades on its own constant-product curve with 30 virtual SOL. There is no graduation and no migration to a DEX, so there's no LP to pull and no migration moment to snipe. Liquidity can't be withdrawn.
The vault agent's rules
Every agent trade must pass every one of these checks inside the program, or the transaction fails. Values are the devnet defaults, frozen into each launch at creation; the right column is the ceiling the program enforces on every future launch.
Edit
Provide a caption (optional)
In plain words:
The EMA can't be yanked. Before every trade, the program folds the price since the last trade into the EMA with weight dt / (dt + period). With the 30-minute period on devnet, a price that sat at a new level for 30 minutes moves the EMA halfway there. A second trade in the same second moves it 0%. The weight never reaches 1, so holding a price for a while can't snap the EMA to it.
Nothing inside the band. Within 2% of the EMA, the agent can't trade at all.
The vault never sells at a loss. The vault tracks the SOL cost of the tokens it holds (average-cost method). A sell has to fill at least 2% above that average.
The vault can't be steered into buying high. A buy has to fill at or below the average cost. The one exception is a buy-back funded only by SOL from the agent's own earlier sales, at least 2% under its average sell price, so each sell-then-buy-back round trip ends with more tokens than it sold.
Budgets are small and reset hourly. For $BARN that's 0.02673 SOL of buys and 1,018,329 tokens of sells per hour, the same figures the indexer reports at /api/agents.
A worked case: a large holder sells and price drops 6% under the EMA. The EMA barely moves, so a gap opens under the band. If the fill would be at or below the vault's cost (or covered by the buy-back budget), the agent may buy, each trade moving price at most 3%, up to that hour's budget. On a rally more than 2% over the EMA and 2% over cost, it may sell up to 5% of the vault's tokens per hour.
The agent doesn't hold a price. It's counter-cyclical inside a small budget, and that's all.
One consequence of these rules deserves saying out loud. The bundle's average cost is below the price the bundle leaves on the curve, so while the vault still holds its whole bundle, the reserve SOL can't buy: no reachable fill is at or below cost. In practice the agent's first trades are sells into rallies above cost, and its early dip-buys are buy-backs funded by those sales. Buys from the reserve itself only become reachable after the vault has sold a large share of its bundle: 46% to 49% of it for raises of 3 to 50 SOL with a 30% reserve, in our calculations.
The service that sizes trades is public too. It stays 0.25% inside the band edge so EMA drift doesn't fail its transactions, uses at most 90% of the impact limit, skips trades under 0.01 SOL, and waits 15 seconds between trades on the same launch. Its latest decision per launch, with a plain-English reason, is at /agents. As of this writing all three live devnet launches read "price inside band (+0.0% vs EMA)" and the agent has made 0 trades on devnet. The recording below is from a local validator, where simulated traffic pushes price out of the band.
Edit
Provide a caption (optional)
Fees
Edit
Provide a caption (optional)
create_launch copies the trade fee, the split, the launch fee and every agent limit into the launch account's terms. Changing platform defaults later only affects launches created afterwards. A test named launch_terms_are_frozen_at_creation checks exactly that.
For scale: a 1 SOL buy pays 0.01 SOL. 0.005 SOL of it goes to backers; a backer who put in 10% of the raise accrues 0.0005 SOL. Tokens are never taken as fees, so the platform never has launch tokens to sell.
What the program can and cannot do
The program has 18 instructions. Here is every one.
Edit
Provide a caption (optional)
Instructions that move vault funds to a wallet: 0.
What nobody can do: mint more tokens, freeze a holder's account, change an existing launch's fees or agent limits, redirect backer fees, withdraw the curve's liquidity, or use a pause to block refunds, trading or claims.
What the admin can do: pause new launches and deposits, pause the agent as a circuit breaker, change defaults for future launches within the hard caps, rotate the agent key, and change the platform's fee recipient. The upgrade authority can upgrade the program, and an upgrade could change any rule. That is the largest trust assumption left, and it's why the roadmap below moves it to a multisig.
Verify it yourself
Every claim above maps to an account you can open. Set the explorer to devnet.
Edit
Provide a caption (optional)
The program. C1c2ggJWMy2Ta4ogc297mGWk7Fj617dAxQr91BJKpTSW is executable. Its upgrade authority today is FwYLuQQev8VnGnXySMd7NSJvSYwqhe3tgcdyWzEVpnAs, a single key, on devnet.
A mint. $BARN, 2EHiesvgebXTC3A1XkiwN7MtxqnHp5zZCrjU8tGGC1nD: Token-2022, supply 1,000,000,000, mint authority none, freeze authority none. The explorer hides authority rows when they're empty and labels the mint "Fixed Supply"; the $BARN token page's "Verify on-chain" panel reads both authorities straight from the chain, and any RPC getAccountInfo call returns them as null.
The vault. BDjzU2tgToQkzsKMzM2cSV6yUTdHnFsgVVjjBmZeP7zJ is the program address ["vault", launch]. Its owner is the launch account, which only the program can sign for. It holds 20,366,578.83 $BARN, the bundle.
The terms. The launch account 9buYSR1HkcAALqn39qV2Gp3qYqXaeWcsE86kGeBgZ2E3 stores terms: trade fee 100 bps, backer share 5,000, creator share 3,000, band 200, window 3,600 s, EMA period 1,800 s.
The instruction list. Read the IDL or /docs/program. Look for anything that sends vault tokens or vault SOL to a wallet. There isn't one.
The agent key. 3qLLfTodvtLMSfUmzLMXLwm7L2uQrRz2MsGjEwWmFj2t. The program only accepts it in agent_buy and agent_sell.
The same checklist, with live tiles linking each account, is at holdfast.up.railway.app/docs/verify. To derive the accounts yourself, @holdfast/sdk exports launchPda(mint), vaultPda(launch) and curvePda(launch).
How it compares
Every launchpad below solves a real problem, and several are larger than Holdfast will be for a long time. The question here is narrower: who can sell the first buy, and what enforces the answer.
Edit
Provide a caption (optional)
The closest design to ours is Mosh (mosh.trade, @Moshdottrade), which launched on Robinhood Chain on 23 September. The core idea is the same: funders pool a raise, the bundle goes into vaults nobody can withdraw from, agents trade it within per-window limits, and funders earn fees instead of holding tokens (Mosh docs). Where Mosh's own docs describe it differently:
Chain and venue. Mosh runs on Robinhood Chain and launches through a partner launchpad (Pons today). The bundle buys from that launchpad's public bonding curve "in steps", then the token graduates to a pool where the agents trade (The curve). Holdfast is on Solana. Its bundle is a single buy inside launch, before any public trade exists, and the token stays on its own curve.
What the contract checks. Mosh's vaults are bound to one pair and venue, with per-window limits on spending and selling, and an operator can't withdraw (Custody, The swarm). Its agents are AI vault managers, and a steward adjusts strategy settings, including the price belo