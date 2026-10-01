use anchor_lang::prelude::*;

#[event]
pub struct LaunchCreated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub index: u64,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub raise_min: u64,
    pub raise_max: u64,
    pub raise_deadline: i64,
    pub bundle_supply_bps: u16,
    pub reserve_bps: u16,
    pub whitelisted: bool,
    pub timestamp: i64,
}

#[event]
pub struct Deposited {
    pub launch: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
    pub raised: u64,
    pub timestamp: i64,
}

#[event]
pub struct LaunchCancelled {
    pub launch: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct Refunded {
    pub launch: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct Launched {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub raised: u64,
    pub launch_fee: u64,
    pub bundle_sol: u64,
    pub bundle_tokens: u64,
    pub vault_sol: u64,
    pub price_q64: u128,
    pub timestamp: i64,
}

#[event]
pub struct Trade {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub is_agent: bool,
    /// Lamports paid (buy, gross incl. fee) or received (sell, net of fee).
    pub sol_amount: u64,
    pub token_amount: u64,
    pub fee: u64,
    pub price_q64: u128,
    pub ema_q64: u128,
    pub real_sol: u64,
    pub token_reserve: u64,
    pub vault_sol: u64,
    pub vault_tokens: u64,
    pub timestamp: i64,
}

#[event]
pub struct BackerFeesClaimed {
    pub launch: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct CreatorFeesClaimed {
    pub launch: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PlatformFeesSwept {
    pub launch: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// `payout_backers`: vault SOL credited to backers' claimable balance — `kind` 0 repays the
/// principal (`initial_vault_sol`), 1 is a dividend (`payout_share_bps` of vault SOL).
#[event]
pub struct BackersPaid {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub kind: u8,
    pub amount: u64,
    pub vault_sol_after: u64,
    pub timestamp: i64,
}

#[event]
pub struct WoundDown {
    pub launch: Pubkey,
    pub mint: Pubkey,
    /// Curve SOL + vault SOL credited to backers through the fee accumulator.
    pub sol_to_backers: u64,
    /// Vault tokens moved back to the curve account.
    pub tokens_returned: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultWithdrawn {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub sol: u64,
    pub tokens: u64,
    /// The platform fee recipient that received the SOL and owns the token account.
    pub recipient: Pubkey,
    /// Token account (owned by `recipient`) that received the tokens.
    pub recipient_tokens: Pubkey,
    pub timestamp: i64,
}

/// pump.fun / PumpSwap creator fees swept into the launch and split between the buyback pool,
/// vault SOL (or backers once the launch is wound down) and backers.
#[event]
pub struct CreatorFeesCollected {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub to_buyback_pool: u64,
    pub to_vault: u64,
    pub to_backers: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuybackBurned {
    pub launch: Pubkey,
    pub buyback_mint: Pubkey,
    pub sol: u64,
    pub tokens: u64,
    pub buyback_pool_sol: u64,
    pub timestamp: i64,
}

#[event]
pub struct PumpGraduated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct LaunchMigrated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub timestamp: i64,
}
