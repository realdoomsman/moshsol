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
