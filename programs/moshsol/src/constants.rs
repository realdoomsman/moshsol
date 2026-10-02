pub const PLATFORM_SEED: &[u8] = b"platform";
pub const LAUNCH_SEED: &[u8] = b"launch";
pub const CURVE_SEED: &[u8] = b"curve";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BACKER_SEED: &[u8] = b"backer";
/// System-owned PDA that is the pump.fun / PumpSwap `user` of a pump launch (the launch
/// account itself is program-owned, so the system program can't debit it) and the authority of
/// the launch's SPL token accounts. Holds no lamports between instructions.
pub const PUMP_AUTHORITY_SEED: &[u8] = b"pump-authority";

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
pub const MAX_BUNDLE_SUPPLY_BPS: u16 = 7_500; // bundle can never buy more than 75% of supply
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
/// `burn_share_bps` (share of a pump launch's creator fees that goes to the buyback-and-burn
/// pool) can never exceed half.
pub const MAX_BURN_SHARE_BPS: u16 = 5_000;
pub const DEFAULT_BURN_SHARE_BPS: u16 = 1_500;
/// `creator_fee_vault_bps` (share of creator fees that becomes vault SOL, the agent's capital)
/// can never exceed 90%; what neither the vault nor the burn pool takes goes to backers.
pub const MAX_CREATOR_FEE_VAULT_BPS: u16 = 9_000;
pub const DEFAULT_CREATOR_FEE_VAULT_BPS: u16 = 7_500;
/// Backer payback (`payout_backers`): the vault must hold at least `payout_mult_bps` × its
/// initial SOL in liquid SOL (never less than 1×), pays at most `payout_share_bps` of it per
/// dividend (never more than half), never more than once per `payout_interval_secs` (never
/// less than an hour), and never below `min_vault_sol` (never less than 0.05 SOL, the fee /
/// rent reserve agent buys also keep).
pub const MIN_PAYOUT_MULT_BPS: u32 = 10_000;
pub const DEFAULT_PAYOUT_MULT_BPS: u32 = 50_000;
pub const MAX_PAYOUT_SHARE_BPS: u16 = 5_000;
pub const DEFAULT_PAYOUT_SHARE_BPS: u16 = 1_500;
pub const MIN_PAYOUT_INTERVAL_SECS: u32 = 3_600;
pub const DEFAULT_PAYOUT_INTERVAL_SECS: u32 = 14_400;
pub const MIN_MIN_VAULT_SOL: u64 = 50_000_000;
pub const DEFAULT_MIN_VAULT_SOL: u64 = 100_000_000;
/// `wind_down`: tokens held outside the venue and vault may be at most `dead_holders_bps` of
/// the supply (never more than 20%).
pub const MAX_DEAD_HOLDERS_BPS: u16 = 2_000;
pub const DEFAULT_DEAD_HOLDERS_BPS: u16 = 500;
/// `buyback_burn` guards: no dust-sized buys, at most this share of the Holdfast token venue's
/// quote reserves per call, and at least this long between calls per launch.
pub const MIN_BUYBACK_LAMPORTS: u64 = 1_000_000; // 0.001 SOL
pub const BUYBACK_MAX_VENUE_BPS: u16 = 500; // 5% of the venue's quote reserves
pub const BUYBACK_MIN_INTERVAL_SECS: i64 = 60;
/// In-program slippage floor of a buyback: the fill must return at least this share of the
/// fee-free constant-product quote from the venue's reserves.
pub const BUYBACK_MIN_FILL_BPS: u16 = 9_700;
/// Fee headroom assumed when sizing the bundle buy on pump.fun from the fee-free quote, so the
/// `buy(amount, max_sol_cost)` never fails on the venue's fee (1.25% today) and the remainder
/// stays in the vault.
pub const PUMP_BUY_FEE_HEADROOM_BPS: u16 = 300;

pub const MIN_RAISE_DURATION_SECS: i64 = 60;
pub const MAX_RAISE_DURATION_SECS: i64 = 14 * 86_400;
/// A raise that met its minimum must be launched within this long after its deadline; past it,
/// nobody can launch it any more and every backer can refund (`refund` flips it to Refunding).
pub const LAUNCH_GRACE_SECS: i64 = 3 * 86_400;
pub const MAX_RAISE_LAMPORTS: u64 = 100_000 * 1_000_000_000;
pub const MIN_BUNDLE_SUPPLY_BPS: u16 = 100;

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_PROOF_LEN: usize = 24;

/// `wind_down` needs the launch to have been live this long, so nobody can wind a launch down
/// before the market had a chance to form.
pub const WIND_DOWN_MIN_AGE_SECS: i64 = 3 * 86_400;
/// ...and no vault trade for this long.
pub const WIND_DOWN_IDLE_SECS: i64 = 86_400;
