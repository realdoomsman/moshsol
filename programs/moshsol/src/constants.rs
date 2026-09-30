pub const PLATFORM_SEED: &[u8] = b"platform";
pub const LAUNCH_SEED: &[u8] = b"launch";
pub const CURVE_SEED: &[u8] = b"curve";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BACKER_SEED: &[u8] = b"backer";

pub const TOKEN_DECIMALS: u8 = 6;
/// 1,000,000,000 tokens with 6 decimals. Entire supply is minted to the curve at creation
/// and the mint authority is revoked in the same instruction.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * 1_000_000;

pub const BPS: u64 = 10_000;
/// Fixed-point precision for the backer fee accumulator.
pub const ACC_PRECISION: u128 = 1_000_000_000_000_000_000;

// Hard limits the admin can never exceed. These make the trust claims verifiable on-chain.
pub const MAX_TRADE_FEE_BPS: u16 = 200; // 2%
/// Non-zero floor so price-manipulation round trips always cost the manipulator.
pub const MIN_TRADE_FEE_BPS: u16 = 30; // 0.3%
pub const MAX_LAUNCH_FEE_BPS: u16 = 500; // 5% of raise
// Floors on the trade-fee split so the admin can never route every fee to the platform.
pub const MIN_BACKER_FEE_SHARE_BPS: u16 = 2_500; // backers always get at least 25% of trade fees
pub const MIN_CREATOR_FEE_SHARE_BPS: u16 = 1_000; // creators always get at least 10%
pub const MAX_CREATE_FEE_LAMPORTS: u64 = 1_000_000_000; // 1 SOL
pub const MAX_BUNDLE_SUPPLY_BPS: u16 = 3_000; // bundle can never buy more than 30% of supply
pub const MAX_RESERVE_BPS: u16 = 8_000;
pub const MAX_AGENT_WINDOW_BPS: u16 = 2_000; // agents can move at most 20% of the vault per window
pub const MAX_AGENT_IMPACT_BPS: u16 = 1_000; // single agent trade can move price at most 10%
pub const MIN_AGENT_BAND_BPS: u16 = 50; // agents must buy at least 0.5% under / sell 0.5% over the EMA
pub const MAX_AGENT_BAND_BPS: u16 = 5_000;
pub const MIN_WINDOW_SECS: u32 = 300;
pub const MAX_WINDOW_SECS: u32 = 86_400;
pub const MIN_EMA_PERIOD_SECS: u32 = 300;
pub const MAX_EMA_PERIOD_SECS: u32 = 7 * 86_400;
pub const MIN_VIRTUAL_SOL: u64 = 1_000_000_000; // 1 SOL
pub const MAX_VIRTUAL_SOL: u64 = 1_000_000_000_000; // 1000 SOL

pub const MIN_RAISE_DURATION_SECS: i64 = 60;
pub const MAX_RAISE_DURATION_SECS: i64 = 14 * 86_400;
pub const MAX_RAISE_LAMPORTS: u64 = 100_000 * 1_000_000_000;
pub const MIN_BUNDLE_SUPPLY_BPS: u16 = 100;

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_PROOF_LEN: usize = 24;
