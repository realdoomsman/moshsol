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
    #[msg("Agents may only buy below the vault's average cost, or buy back with sell proceeds below the average sell price")]
    AgentAboveCostBasis,
    #[msg("Agents may only sell above the vault's average cost plus band")]
    AgentBelowCostBasis,
    #[msg("Only the program upgrade authority can initialize the platform")]
    NotUpgradeAuthority,
    #[msg("An agent trade and a public trade can't share a slot; retry in the next slot")]
    SameSlotTrade,
    #[msg("Platform terms changed since this launch was prepared; review them and retry")]
    TermsChanged,
    #[msg("Launch must be live for 3 days before it can wind down")]
    LaunchTooYoung,
    #[msg("Launch traded in the last 24 hours; it can't wind down yet")]
    RecentTrade,
    #[msg("Tokens are held outside the curve and vault; the launch can't wind down")]
    OutsideHolders,
}
