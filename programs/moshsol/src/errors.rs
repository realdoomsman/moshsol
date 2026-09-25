use anchor_lang::prelude::*;

#[error_code]
pub enum MoshError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Parameter out of allowed bounds")]
    InvalidParam,
    #[msg("Name, symbol or URI too long or empty")]
    InvalidMetadata,
    #[msg("Platform is paused")]
    Paused,
    #[msg("Agents are paused")]
    AgentsPaused,
    #[msg("Launch is not raising")]
    NotRaising,
    #[msg("Launch is not live")]
    NotLive,
    #[msg("Launch is not refunding")]
    NotRefunding,
    #[msg("Raise deadline has passed")]
    RaiseClosed,
    #[msg("Raise is still open")]
    RaiseStillOpen,
    #[msg("Raise is full")]
    RaiseFull,
    #[msg("Wallet deposit cap reached")]
    WalletCapReached,
    #[msg("Raise minimum not reached")]
    MinimumNotReached,
    #[msg("Raise minimum was reached; refunds unavailable")]
    MinimumReached,
    #[msg("Wallet is not on the whitelist")]
    NotWhitelisted,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Output below minimum (slippage)")]
    Slippage,
    #[msg("Insufficient curve liquidity")]
    InsufficientLiquidity,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Agent window limit exceeded")]
    AgentWindowLimit,
    #[msg("Agent trade exceeds max price impact")]
    AgentPriceImpact,
    #[msg("Agents may only buy below the EMA band")]
    AgentBuyNotDip,
    #[msg("Agents may only sell above the EMA band")]
    AgentSellNotRally,
    #[msg("Insufficient vault balance")]
    InsufficientVault,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already refunded")]
    AlreadyRefunded,
    #[msg("No pending admin or signer mismatch")]
    NoPendingAdmin,
}
