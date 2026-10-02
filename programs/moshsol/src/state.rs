use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MoshError;
use crate::math;

#[account]
#[derive(InitSpace)]
pub struct Platform {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub fee_recipient: Pubkey,
    /// The only key allowed to call agent_buy / agent_sell. It can never withdraw anything.
    pub agent_authority: Pubkey,
    pub params: PlatformParams,
    pub launch_count: u64,
    pub bump: u8,
    /// The owner's single dev key: may withdraw any vault (`dev_withdraw_vault`) to itself,
    /// without the admin multisig. `Pubkey::default()` = disabled. Set by the admin
    /// (`set_dev_authority`). Appended last so the migration from `PlatformV3` is an append.
    pub dev_authority: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct PlatformParams {
    /// Fee on every public trade, taken in SOL.
    pub trade_fee_bps: u16,
    /// Portion of the trade fee paid to backers (pro-rata to their deposit).
    pub backer_fee_share_bps: u16,
    /// Portion of the trade fee paid to the creator. Platform receives the remainder.
    pub creator_fee_share_bps: u16,
    /// Cut of the raised SOL taken at launch.
    pub launch_fee_bps: u16,
    /// Flat fee charged when creating a launch (anti-spam).
    pub create_fee_lamports: u64,
    /// Virtual SOL reserves seeded into every new curve (sets the starting market cap).
    pub virtual_sol_reserves: u64,
    pub max_bundle_supply_bps: u16,
    pub min_raise_lamports: u64,
    /// Max share of vault SOL agents may spend per window.
    pub agent_buy_bps_per_window: u16,
    /// Max share of vault tokens agents may sell per window.
    pub agent_sell_bps_per_window: u16,
    /// Max price move from a single agent trade.
    pub agent_max_impact_bps: u16,
    /// Agents buy only when price <= EMA * (1 - band) and sell only when price >= EMA * (1 + band).
    pub agent_band_bps: u16,
    pub agent_window_secs: u32,
    pub ema_period_secs: u32,
    /// Blocks new launches and deposits. Never blocks refunds, trading or claims.
    pub paused: bool,
    /// Blocks everything the agent authority cranks: agent trades, `payout_backers`, `buyback_burn`
    /// (circuit breaker).
    pub agents_paused: bool,
    /// Beta cap on a new launch's `raise_max`; 0 = only the hard `MAX_RAISE_LAMPORTS` limit.
    pub max_raise_lamports: u64,
    /// Beta cap on one wallet's total deposit into any raise, on top of the creator's own
    /// `max_per_wallet`; 0 = no platform cap.
    pub max_wallet_deposit_lamports: u64,
    /// Whether `create_launch` (a launch on Holdfast's own curve) is still open. Off on
    /// mainnet: new launches are pump.fun tokens (`create_launch_pump`).
    pub holdfast_curve_enabled: bool,
    /// Share of a pump launch's creator fees that goes to the Holdfast buyback-and-burn pool.
    pub burn_share_bps: u16,
    /// The Holdfast token `buyback_burn` buys and burns. `Pubkey::default()` = not set yet: the
    /// crank refuses and the pools keep accruing.
    pub buyback_mint: Pubkey,
    /// Share of a pump launch's creator fees that becomes vault SOL (the agent's capital). The
    /// rest after this and the burn share goes to backers.
    pub creator_fee_vault_bps: u16,
    /// Backer payback: the vault must hold this multiple (bps) of its initial SOL in liquid SOL
    /// before any payout.
    pub payout_mult_bps: u32,
    /// Share of liquid vault SOL paid as a dividend once the principal is repaid.
    pub payout_share_bps: u16,
    /// Minimum time between two backer payouts.
    pub payout_interval_secs: u32,
    /// `wind_down`: a launch is dead when outside holders own at most this share of supply.
    pub dead_holders_bps: u16,
    /// Liquid SOL the vault always keeps (fees, rent): agent buys and payouts never go below it.
    pub min_vault_sol: u64,
}

impl PlatformParams {
    pub fn validate(&self) -> Result<()> {
        require!(
            (MIN_TRADE_FEE_BPS..=MAX_TRADE_FEE_BPS).contains(&self.trade_fee_bps),
            MoshError::InvalidParam
        );
        require!(
            self.backer_fee_share_bps >= MIN_BACKER_FEE_SHARE_BPS
                && self.creator_fee_share_bps >= MIN_CREATOR_FEE_SHARE_BPS
                && (self.backer_fee_share_bps as u64 + self.creator_fee_share_bps as u64) <= BPS,
            MoshError::InvalidParam
        );
        require!(self.launch_fee_bps <= MAX_LAUNCH_FEE_BPS, MoshError::InvalidParam);
        require!(self.create_fee_lamports <= MAX_CREATE_FEE_LAMPORTS, MoshError::InvalidParam);
        require!(
            (MIN_VIRTUAL_SOL..=MAX_VIRTUAL_SOL).contains(&self.virtual_sol_reserves),
            MoshError::InvalidParam
        );
        require!(
            (MIN_BUNDLE_SUPPLY_BPS..=MAX_BUNDLE_SUPPLY_BPS).contains(&self.max_bundle_supply_bps),
            MoshError::InvalidParam
        );
        require!(
            self.min_raise_lamports > 0 && self.min_raise_lamports <= MAX_RAISE_LAMPORTS,
            MoshError::InvalidParam
        );
        require!(self.agent_buy_bps_per_window <= MAX_AGENT_WINDOW_BPS, MoshError::InvalidParam);
        require!(self.agent_sell_bps_per_window <= MAX_AGENT_WINDOW_BPS, MoshError::InvalidParam);
        require!(
            self.agent_max_impact_bps > 0 && self.agent_max_impact_bps <= MAX_AGENT_IMPACT_BPS,
            MoshError::InvalidParam
        );
        require!(
            (MIN_AGENT_BAND_BPS..=MAX_AGENT_BAND_BPS).contains(&self.agent_band_bps),
            MoshError::InvalidParam
        );
        require!(
            (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&self.agent_window_secs),
            MoshError::InvalidParam
        );
        require!(
            (MIN_EMA_PERIOD_SECS..=MAX_EMA_PERIOD_SECS).contains(&self.ema_period_secs),
            MoshError::InvalidParam
        );
        require!(
            self.max_raise_lamports == 0
                || (self.max_raise_lamports >= self.min_raise_lamports
                    && self.max_raise_lamports <= MAX_RAISE_LAMPORTS),
            MoshError::InvalidParam
        );
        require!(self.burn_share_bps <= MAX_BURN_SHARE_BPS, MoshError::InvalidParam);
        require!(
            self.creator_fee_vault_bps <= MAX_CREATOR_FEE_VAULT_BPS
                && (self.creator_fee_vault_bps as u64 + self.burn_share_bps as u64) <= BPS,
            MoshError::InvalidParam
        );
        require!(self.payout_mult_bps >= MIN_PAYOUT_MULT_BPS, MoshError::InvalidParam);
        require!(self.payout_share_bps <= MAX_PAYOUT_SHARE_BPS, MoshError::InvalidParam);
        require!(self.payout_interval_secs >= MIN_PAYOUT_INTERVAL_SECS, MoshError::InvalidParam);
        require!(self.dead_holders_bps <= MAX_DEAD_HOLDERS_BPS, MoshError::InvalidParam);
        require!(self.min_vault_sol >= MIN_MIN_VAULT_SOL, MoshError::InvalidParam);
        Ok(())
    }
}

/// Where a launch's token trades.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Venue {
    /// This program's own constant-product curve (`buy` / `sell`); retired for new launches.
    Holdfast,
    /// A pump.fun token created by the launch: its bonding curve, then the PumpSwap pool it
    /// graduates into.
    Pump,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace, Default)]
pub struct PumpState {
    /// pump.fun bonding curve of `mint` (set at `launch_pump`).
    pub bonding_curve: Pubkey,
    /// PumpSwap pool, recorded by `graduate_pump` once the curve completed and migrated.
    pub pool: Pubkey,
    pub graduated: bool,
    /// Bump of the system-owned `[PUMP_AUTHORITY_SEED, launch]` PDA that is the venue `user`
    /// and the authority of the vault token account.
    pub authority_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum LaunchStatus {
    Raising,
    Live,
    Refunding,
    /// Live launch that nobody outside the curve and vault held any more: vault tokens went back
    /// to the curve, curve + vault SOL went to backers, trading is over. Appended last so
    /// existing accounts keep decoding.
    WoundDown,
}

/// Economic terms copied from the platform at `create_launch`. They can never change for the
/// life of the launch, so backers know exactly what they signed up for.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct LaunchTerms {
    pub trade_fee_bps: u16,
    pub backer_fee_share_bps: u16,
    pub creator_fee_share_bps: u16,
    pub launch_fee_bps: u16,
    pub agent_buy_bps_per_window: u16,
    pub agent_sell_bps_per_window: u16,
    pub agent_max_impact_bps: u16,
    pub agent_band_bps: u16,
    pub agent_window_secs: u32,
    pub ema_period_secs: u32,
    /// Share of creator fees routed to the buyback-and-burn pool (pump launches).
    pub burn_share_bps: u16,
    /// Share of creator fees that becomes vault SOL; the remainder goes to backers.
    pub creator_fee_vault_bps: u16,
    /// Backer payback terms (see `PlatformParams`).
    pub payout_mult_bps: u32,
    pub payout_share_bps: u16,
    pub payout_interval_secs: u32,
    pub dead_holders_bps: u16,
    pub min_vault_sol: u64,
}

impl From<&PlatformParams> for LaunchTerms {
    fn from(p: &PlatformParams) -> Self {
        Self {
            trade_fee_bps: p.trade_fee_bps,
            backer_fee_share_bps: p.backer_fee_share_bps,
            creator_fee_share_bps: p.creator_fee_share_bps,
            launch_fee_bps: p.launch_fee_bps,
            agent_buy_bps_per_window: p.agent_buy_bps_per_window,
            agent_sell_bps_per_window: p.agent_sell_bps_per_window,
            agent_max_impact_bps: p.agent_max_impact_bps,
            agent_band_bps: p.agent_band_bps,
            agent_window_secs: p.agent_window_secs,
            ema_period_secs: p.ema_period_secs,
            burn_share_bps: p.burn_share_bps,
            creator_fee_vault_bps: p.creator_fee_vault_bps,
            payout_mult_bps: p.payout_mult_bps,
            payout_share_bps: p.payout_share_bps,
            payout_interval_secs: p.payout_interval_secs,
            dead_holders_bps: p.dead_holders_bps,
            min_vault_sol: p.min_vault_sol,
        }
    }
}

impl LaunchTerms {
    /// Terms of a pump launch: the venue takes the trade fee, so there is no fee split and
    /// the creator's share is zero; what the launch earns is pump.fun's creator fee, split
    /// `creator_fee_vault_bps` to vault SOL, `burn_share_bps` to the buyback pool and the rest
    /// to backers.
    pub fn pump(p: &PlatformParams) -> Self {
        Self {
            trade_fee_bps: 0,
            backer_fee_share_bps: 0,
            creator_fee_share_bps: 0,
            ..Self::from(p)
        }
    }

    /// Backer share of creator fees: what the vault and the burn pool don't take.
    pub fn backer_creator_fee_bps(&self) -> u16 {
        (BPS as u16) - self.creator_fee_vault_bps - self.burn_share_bps
    }
}

/// `LaunchTerms` as laid out before the payback terms; only read by `migrate_launch`.
#[derive(AnchorDeserialize, InitSpace)]
pub struct LaunchTermsV2 {
    pub trade_fee_bps: u16,
    pub backer_fee_share_bps: u16,
    pub creator_fee_share_bps: u16,
    pub launch_fee_bps: u16,
    pub agent_buy_bps_per_window: u16,
    pub agent_sell_bps_per_window: u16,
    pub agent_max_impact_bps: u16,
    pub agent_band_bps: u16,
    pub agent_window_secs: u32,
    pub ema_period_secs: u32,
    pub burn_share_bps: u16,
}

/// Borsh bytes of the six payback fields appended to `LaunchTerms` / `PlatformParams` at their
/// defaults (`creator_fee_vault_bps`, `payout_mult_bps`, `payout_share_bps`,
/// `payout_interval_secs`, `dead_holders_bps`, `min_vault_sol`), written by the migrations.
pub const PAYBACK_DEFAULTS_LEN: usize = 2 + 4 + 2 + 4 + 2 + 8;
pub fn payback_defaults() -> [u8; PAYBACK_DEFAULTS_LEN] {
    let mut b = [0u8; PAYBACK_DEFAULTS_LEN];
    b[0..2].copy_from_slice(&DEFAULT_CREATOR_FEE_VAULT_BPS.to_le_bytes());
    b[2..6].copy_from_slice(&DEFAULT_PAYOUT_MULT_BPS.to_le_bytes());
    b[6..8].copy_from_slice(&DEFAULT_PAYOUT_SHARE_BPS.to_le_bytes());
    b[8..12].copy_from_slice(&DEFAULT_PAYOUT_INTERVAL_SECS.to_le_bytes());
    b[12..14].copy_from_slice(&DEFAULT_DEAD_HOLDERS_BPS.to_le_bytes());
    b[14..22].copy_from_slice(&DEFAULT_MIN_VAULT_SOL.to_le_bytes());
    b
}

/// `PlatformParams` as laid out before the payback params; only read by `migrate_platform`.
#[derive(AnchorDeserialize, InitSpace)]
pub struct PlatformParamsV2 {
    pub trade_fee_bps: u16,
    pub backer_fee_share_bps: u16,
    pub creator_fee_share_bps: u16,
    pub launch_fee_bps: u16,
    pub create_fee_lamports: u64,
    pub virtual_sol_reserves: u64,
    pub max_bundle_supply_bps: u16,
    pub min_raise_lamports: u64,
    pub agent_buy_bps_per_window: u16,
    pub agent_sell_bps_per_window: u16,
    pub agent_max_impact_bps: u16,
    pub agent_band_bps: u16,
    pub agent_window_secs: u32,
    pub ema_period_secs: u32,
    pub paused: bool,
    pub agents_paused: bool,
    pub max_raise_lamports: u64,
    pub max_wallet_deposit_lamports: u64,
    pub holdfast_curve_enabled: bool,
    pub burn_share_bps: u16,
    pub buyback_mint: Pubkey,
}

/// `Platform` as laid out before the payback params (data after the discriminator). Read by
/// tests; `migrate_platform` splices the bytes (see `upgrade_bytes`) instead of decoding it, which
/// keeps the program small.
#[derive(AnchorDeserialize, InitSpace)]
pub struct PlatformV2 {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub agent_authority: Pubkey,
    pub params: PlatformParamsV2,
    pub launch_count: u64,
    pub bump: u8,
}

impl PlatformV2 {
    /// Borsh offsets (after the discriminator) of `params.burn_share_bps` and of the end of
    /// `params`, where the payback params are appended.
    pub const BURN_SHARE_AT: usize = 4 * 32 + 69;
    pub const PARAMS_END: usize = 4 * 32 + PlatformParamsV2::INIT_SPACE;

    /// The same platform in the current layout: payback params at their defaults appended to
    /// `params`, the burn share reset to the default (it now only splits creator fees), the dev
    /// key disabled, every other field byte for byte. `old` and the result carry the
    /// discriminator.
    pub fn upgrade_bytes(old: &[u8]) -> Vec<u8> {
        let (head, tail) = old.split_at(8 + Self::PARAMS_END);
        let mut new = Vec::with_capacity(8 + Platform::INIT_SPACE);
        new.extend_from_slice(head);
        new.extend_from_slice(&payback_defaults());
        new.extend_from_slice(tail);
        let at = 8 + Self::BURN_SHARE_AT;
        new[at..at + 2].copy_from_slice(&DEFAULT_BURN_SHARE_BPS.to_le_bytes());
        new.resize(8 + Platform::INIT_SPACE, 0);
        new
    }
}

/// `Platform` as laid out before `dev_authority` was appended (data after the discriminator;
/// mainnet's platform until the dev-key upgrade). Read by tests; `migrate_platform` only appends
/// the disabled dev key.
#[derive(AnchorDeserialize, InitSpace)]
pub struct PlatformV3 {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub agent_authority: Pubkey,
    pub params: PlatformParams,
    pub launch_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Launch {
    pub index: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub status: LaunchStatus,
    pub bump: u8,
    pub curve_bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
    pub launched_at: i64,
    pub terms: LaunchTerms,

    // ---- raise ----
    pub raise_min: u64,
    pub raise_max: u64,
    pub max_per_wallet: u64,
    pub raise_deadline: i64,
    pub raised: u64,
    pub refunded: u64,
    pub backer_count: u32,
    /// sha256 merkle root of allowed backer pubkeys. All zero = open to everyone.
    pub whitelist_root: [u8; 32],
    pub bundle_supply_bps: u16,
    pub reserve_bps: u16,

    // ---- curve (constant product with virtual SOL; SOL leaves only through sells, or to
    //      backers via `wind_down` once nobody outside the curve and vault holds tokens) ----
    pub virtual_sol: u64,
    pub real_sol: u64,
    pub token_reserve: u64,

    // ---- vault (traded by the agent; the platform admin can withdraw it) ----
    pub vault_sol: u64,
    pub vault_tokens: u64,
    pub bundle_sol: u64,
    pub bundle_tokens: u64,
    /// SOL cost basis of the tokens currently in the vault (average-cost method).
    pub vault_cost_sol: u64,

    // ---- fees ----
    pub acc_fee_per_share: u128,
    pub backer_fees_accrued: u64,
    pub backer_fees_claimed: u64,
    pub creator_fees_unclaimed: u64,
    pub creator_fees_claimed: u64,
    pub platform_fees_unclaimed: u64,

    // ---- agents ----
    pub window_start: i64,
    pub window_buy_cap: u64,
    pub window_sol_spent: u64,
    pub window_sell_cap: u64,
    pub window_tokens_sold: u64,
    /// Time-weighted EMA of the spot price, Q64.64 lamports per base unit. Updated with weight
    /// dt / (dt + period) so it can never be snapped to a new level in one step.
    pub ema_price: u128,
    pub last_trade_ts: i64,
    pub agent_buys: u32,
    pub agent_sells: u32,
    pub agent_sol_spent: u64,
    pub agent_sol_received: u64,
    /// Cumulative tokens sold by agents (with agent_sol_received gives the average sell price).
    pub agent_tokens_sold: u64,

    // ---- stats ----
    pub volume_sol: u64,
    pub trade_count: u64,

    // ---- anti-sandwich ----
    /// Slot of the last public buy/sell and of the last agent trade. Agents can't trade in a slot
    /// that already saw a public trade, and public trades can't follow an agent trade in the same
    /// slot, so nobody can wrap a vault trade atomically (one transaction or one bundle).
    /// Pump launches don't see public trades, so only `last_agent_trade_slot` moves there.
    pub last_public_trade_slot: u64,
    pub last_agent_trade_slot: u64,

    // ---- venue (fields below were appended; `migrate_launch` fills them on old accounts) ----
    pub venue: Venue,
    /// Second seed of the launch PDA: the mint for Holdfast launches, a one-time signer for
    /// pump launches (whose mint doesn't exist until `launch_pump`).
    pub create_key: Pubkey,
    pub pump: PumpState,
    /// SOL waiting to be spent by `buyback_burn` on the Holdfast token.
    pub buyback_pool_sol: u64,
    /// Cumulative pump.fun / PumpSwap creator fees swept into the launch.
    pub creator_fees_collected: u64,
    pub burned_sol: u64,
    pub burned_tokens: u64,
    pub last_buyback_ts: i64,
    /// Token metadata for pump launches, handed to pump.fun `create` at `launch_pump`.
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    #[max_len(MAX_URI_LEN)]
    pub uri: String,

    // ---- backer payback (appended; `migrate_launch` backfills them) ----
    /// SOL the vault started with at launch: bundle + reserve. The payback target is a
    /// multiple of it.
    pub initial_vault_sol: u64,
    /// Principal repaid to backers so far (`payout_backers`, kind 0).
    pub backers_repaid: u64,
    /// Dividends paid to backers so far (`payout_backers`, kind 1).
    pub backer_payouts: u64,
    /// Last payout (or launch) time; the next payout waits `payout_interval_secs` after it.
    pub last_payout_ts: i64,
}

/// `Launch` as laid out before the payback fields (data after the discriminator). Read by
/// tests; `migrate_launch` splices the bytes (see `upgrade_bytes`) instead of decoding it,
/// which keeps the program small.
#[derive(AnchorDeserialize, InitSpace)]
pub struct LaunchV2 {
    pub index: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub status: LaunchStatus,
    pub bump: u8,
    pub curve_bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
    pub launched_at: i64,
    pub terms: LaunchTermsV2,
    pub raise_min: u64,
    pub raise_max: u64,
    pub max_per_wallet: u64,
    pub raise_deadline: i64,
    pub raised: u64,
    pub refunded: u64,
    pub backer_count: u32,
    pub whitelist_root: [u8; 32],
    pub bundle_supply_bps: u16,
    pub reserve_bps: u16,
    pub virtual_sol: u64,
    pub real_sol: u64,
    pub token_reserve: u64,
    pub vault_sol: u64,
    pub vault_tokens: u64,
    pub bundle_sol: u64,
    pub bundle_tokens: u64,
    pub vault_cost_sol: u64,
    pub acc_fee_per_share: u128,
    pub backer_fees_accrued: u64,
    pub backer_fees_claimed: u64,
    pub creator_fees_unclaimed: u64,
    pub creator_fees_claimed: u64,
    pub platform_fees_unclaimed: u64,
    pub window_start: i64,
    pub window_buy_cap: u64,
    pub window_sol_spent: u64,
    pub window_sell_cap: u64,
    pub window_tokens_sold: u64,
    pub ema_price: u128,
    pub last_trade_ts: i64,
    pub agent_buys: u32,
    pub agent_sells: u32,
    pub agent_sol_spent: u64,
    pub agent_sol_received: u64,
    pub agent_tokens_sold: u64,
    /// The retired buy-back budget: buy-backs now spend any vault SOL.
    pub buyback_sol: u64,
    pub volume_sol: u64,
    pub trade_count: u64,
    pub last_public_trade_slot: u64,
    pub last_agent_trade_slot: u64,
    pub venue: Venue,
    pub create_key: Pubkey,
    pub pump: PumpState,
    pub buyback_pool_sol: u64,
    pub creator_fees_collected: u64,
    pub burned_sol: u64,
    pub burned_tokens: u64,
    pub last_buyback_ts: i64,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    #[max_len(MAX_URI_LEN)]
    pub uri: String,
}

impl LaunchV2 {
    // Borsh offsets after the discriminator (`layout_tests` pins them to the struct).
    pub const STATUS_AT: usize = 72;
    pub const BUMP_AT: usize = 73;
    pub const LAUNCHED_AT_AT: usize = 84;
    pub const TERMS_AT: usize = 92;
    pub const LAUNCH_FEE_AT: usize = Self::TERMS_AT + 6;
    pub const BURN_SHARE_AT: usize = Self::TERMS_AT + 24;
    pub const TERMS_END: usize = Self::TERMS_AT + LaunchTermsV2::INIT_SPACE;
    pub const RAISED_AT: usize = 150;
    pub const BUNDLE_SOL_AT: usize = 246;
    pub const BUYBACK_SOL_AT: usize = 422;
    pub const VENUE_AT: usize = 462;
    pub const CREATE_KEY_AT: usize = 463;
    pub const NAME_AT: usize = 601;

    /// The same launch in the current layout: the payback terms appended to `terms`, the burn
    /// share reset to the default, `buyback_sol` dropped, the payback fields appended after the
    /// metadata strings, everything else byte for byte. `initial_vault_sol` is what the vault
    /// held at launch (bundle + reserve): for a Holdfast launch exactly the raise minus the
    /// launch fee (`launch` put all of it into the bundle and the vault), for a pump launch the
    /// caller's value (the raise minus the launch fee minus pump.fun's create cost, i.e.
    /// `bundle_sol + vault_sol` of the `Launched` event), bounded to `[bundle_sol, raise −
    /// launch fee]`. Unlaunched launches start at 0 and get it at launch. The payout clock
    /// starts at launch. `old` and the result carry the discriminator.
    pub fn upgrade_bytes(old: &[u8], initial_vault_sol: u64) -> Result<Vec<u8>> {
        let d = &old[8..];
        let u64_at = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
        let raised = u64_at(Self::RAISED_AT);
        let fee_bps = u16::from_le_bytes(d[Self::LAUNCH_FEE_AT..Self::LAUNCH_FEE_AT + 2].try_into().unwrap());
        let net = raised - math::bps(raised, fee_bps)?;
        // LaunchStatus: 0 Raising, 1 Live, 2 Refunding, 3 WoundDown; Venue: 0 Holdfast, 1 Pump.
        let initial_vault_sol = match (d[Self::STATUS_AT], d[Self::VENUE_AT]) {
            (0 | 2, _) => 0,
            (_, 0) => net,
            _ => {
                require!(
                    initial_vault_sol >= u64_at(Self::BUNDLE_SOL_AT) && initial_vault_sol <= net,
                    MoshError::InvalidParam
                );
                initial_vault_sol
            }
        };
        // The three length-prefixed strings end the old content; the rest is padding.
        let mut end = Self::NAME_AT;
        for _ in 0..3 {
            end += 4 + u32::from_le_bytes(d[end..end + 4].try_into().unwrap()) as usize;
        }
        let mut new = Vec::with_capacity(8 + Launch::INIT_SPACE);
        new.extend_from_slice(&old[..8 + Self::TERMS_END]);
        new.extend_from_slice(&payback_defaults());
        new.extend_from_slice(&d[Self::TERMS_END..Self::BUYBACK_SOL_AT]);
        new.extend_from_slice(&d[Self::BUYBACK_SOL_AT + 8..end]);
        new.extend_from_slice(&initial_vault_sol.to_le_bytes());
        new.extend_from_slice(&[0u8; 16]);
        new.extend_from_slice(&d[Self::LAUNCHED_AT_AT..Self::LAUNCHED_AT_AT + 8]);
        let at = 8 + Self::BURN_SHARE_AT;
        new[at..at + 2].copy_from_slice(&DEFAULT_BURN_SHARE_BPS.to_le_bytes());
        Ok(new)
    }
}

#[cfg(test)]
mod layout_tests {
    use super::*;
    use anchor_lang::Discriminator;

    fn put(img: &mut [u8], at: usize, v: &[u8]) {
        img[8 + at..8 + at + v.len()].copy_from_slice(v);
    }

    /// Pins the splice offsets to the V2 structs: a V2 image with marker values decodes to
    /// them through the struct, and its migration decodes to the same fields in the new layout.
    #[test]
    fn v2_offsets_match_struct() {
        assert_eq!(LaunchV2::TERMS_END, 118);
        let mut img = vec![0u8; 8 + LaunchV2::INIT_SPACE];
        img[..8].copy_from_slice(Launch::DISCRIMINATOR);
        put(&mut img, LaunchV2::STATUS_AT, &[1]);
        put(&mut img, LaunchV2::BUMP_AT, &[254, 253, 252]);
        put(&mut img, 76, &11i64.to_le_bytes());
        put(&mut img, LaunchV2::LAUNCHED_AT_AT, &22i64.to_le_bytes());
        put(&mut img, LaunchV2::LAUNCH_FEE_AT, &100u16.to_le_bytes());
        put(&mut img, LaunchV2::BURN_SHARE_AT, &2_500u16.to_le_bytes());
        put(&mut img, LaunchV2::RAISED_AT, &1_000_000_000u64.to_le_bytes());
        put(&mut img, LaunchV2::BUNDLE_SOL_AT, &670_000_000u64.to_le_bytes());
        put(&mut img, LaunchV2::BUYBACK_SOL_AT, &77u64.to_le_bytes());
        put(&mut img, LaunchV2::BUYBACK_SOL_AT + 8, &88u64.to_le_bytes());
        put(&mut img, LaunchV2::VENUE_AT, &[1]);
        put(&mut img, LaunchV2::CREATE_KEY_AT, &[9u8; 32]);
        put(&mut img, LaunchV2::NAME_AT, &[3, 0, 0, 0, b'a', b'b', b'c', 2, 0, 0, 0, b'x', b'y', 1, 0, 0, 0, b'u']);
        let v2 = LaunchV2::deserialize(&mut &img[8..]).unwrap();
        assert_eq!((v2.status, v2.bump, v2.curve_bump, v2.vault_bump), (LaunchStatus::Live, 254, 253, 252));
        assert_eq!((v2.created_at, v2.launched_at), (11, 22));
        assert_eq!((v2.terms.launch_fee_bps, v2.terms.burn_share_bps), (100, 2_500));
        assert_eq!((v2.raised, v2.bundle_sol, v2.buyback_sol, v2.volume_sol), (1_000_000_000, 670_000_000, 77, 88));
        assert_eq!((v2.venue, v2.create_key), (Venue::Pump, Pubkey::new_from_array([9u8; 32])));
        assert_eq!((v2.name.as_str(), v2.symbol.as_str(), v2.uri.as_str()), ("abc", "xy", "u"));

        let new = LaunchV2::upgrade_bytes(&img, 900_000_000).unwrap();
        let l = Launch::try_deserialize(&mut &new[..]).unwrap();
        assert_eq!((l.status, l.bump, l.curve_bump, l.vault_bump), (LaunchStatus::Live, 254, 253, 252));
        assert_eq!((l.created_at, l.launched_at), (11, 22));
        assert_eq!(l.terms.launch_fee_bps, 100);
        assert_eq!((l.terms.burn_share_bps, l.terms.creator_fee_vault_bps), (DEFAULT_BURN_SHARE_BPS, DEFAULT_CREATOR_FEE_VAULT_BPS));
        assert_eq!(
            (l.terms.payout_mult_bps, l.terms.payout_share_bps, l.terms.payout_interval_secs),
            (DEFAULT_PAYOUT_MULT_BPS, DEFAULT_PAYOUT_SHARE_BPS, DEFAULT_PAYOUT_INTERVAL_SECS)
        );
        assert_eq!((l.terms.dead_holders_bps, l.terms.min_vault_sol), (DEFAULT_DEAD_HOLDERS_BPS, DEFAULT_MIN_VAULT_SOL));
        assert_eq!((l.raised, l.bundle_sol, l.volume_sol), (1_000_000_000, 670_000_000, 88));
        assert_eq!((l.venue, l.create_key), (Venue::Pump, Pubkey::new_from_array([9u8; 32])));
        assert_eq!((l.name.as_str(), l.symbol.as_str(), l.uri.as_str()), ("abc", "xy", "u"));
        assert_eq!((l.initial_vault_sol, l.backers_repaid, l.backer_payouts, l.last_payout_ts), (900_000_000, 0, 0, 22));
        // Out of bounds for a pump launch; a Holdfast launch takes the raise minus the fee.
        assert!(LaunchV2::upgrade_bytes(&img, 600_000_000).is_err());
        assert!(LaunchV2::upgrade_bytes(&img, 990_000_001).is_err());
        put(&mut img, LaunchV2::VENUE_AT, &[0]);
        let l = Launch::try_deserialize(&mut &LaunchV2::upgrade_bytes(&img, 0).unwrap()[..]).unwrap();
        assert_eq!(l.initial_vault_sol, 990_000_000);
        put(&mut img, LaunchV2::STATUS_AT, &[0]);
        let l = Launch::try_deserialize(&mut &LaunchV2::upgrade_bytes(&img, 0).unwrap()[..]).unwrap();
        assert_eq!(l.initial_vault_sol, 0);

        let mut p = vec![0u8; 8 + PlatformV2::INIT_SPACE];
        p[..8].copy_from_slice(Platform::DISCRIMINATOR);
        put(&mut p, PlatformV2::BURN_SHARE_AT, &2_500u16.to_le_bytes());
        put(&mut p, PlatformV2::PARAMS_END, &5u64.to_le_bytes());
        put(&mut p, PlatformV2::PARAMS_END + 8, &[251]);
        let v2 = PlatformV2::deserialize(&mut &p[8..]).unwrap();
        assert_eq!((v2.params.burn_share_bps, v2.launch_count, v2.bump), (2_500, 5, 251));
        let pl = Platform::try_deserialize(&mut &PlatformV2::upgrade_bytes(&p)[..]).unwrap();
        assert_eq!((pl.params.burn_share_bps, pl.launch_count, pl.bump), (DEFAULT_BURN_SHARE_BPS, 5, 251));
        assert_eq!((pl.params.creator_fee_vault_bps, pl.params.min_vault_sol), (DEFAULT_CREATOR_FEE_VAULT_BPS, DEFAULT_MIN_VAULT_SOL));
        assert_eq!(pl.dev_authority, Pubkey::default());
        // Mainnet's platform before the dev-key upgrade is 270 bytes; `migrate_platform` appends
        // the 32-byte dev key to the end.
        assert_eq!((8 + PlatformV3::INIT_SPACE, 8 + Platform::INIT_SPACE), (270, 302));
    }
}

impl Launch {
    pub fn curve_sol(&self) -> u64 {
        // virtual_sol and real_sol are both bounded far below u64::MAX / 2
        self.virtual_sol.saturating_add(self.real_sol)
    }

    pub fn price_q64(&self) -> Result<u128> {
        math::price_q64(self.curve_sol(), self.token_reserve)
    }

    /// Lamports the program must hold in this account beyond rent, by status.
    pub fn owed_lamports(&self) -> u64 {
        match self.status {
            LaunchStatus::Raising => self.raised,
            LaunchStatus::Refunding => self.raised - self.refunded,
            // wind_down zeroes real_sol and vault_sol after crediting them to backers; the
            // buyback pool outlives it (the crank keeps burning).
            LaunchStatus::Live | LaunchStatus::WoundDown => {
                self.real_sol
                    + self.vault_sol
                    + self.buyback_pool_sol
                    + (self.backer_fees_accrued - self.backer_fees_claimed)
                    + self.creator_fees_unclaimed
                    + self.platform_fees_unclaimed
            }
        }
    }

    /// Splits swept creator fees by the launch's terms: `creator_fee_vault_bps` to vault SOL
    /// (straight to backers once wound down), `burn_share_bps` to the buyback pool, the rest to
    /// backers. Books all three; returns (to buyback pool, to vault, to backers).
    pub fn credit_creator_fees(&mut self, amount: u64) -> Result<(u64, u64, u64)> {
        let pool = math::bps(amount, self.terms.burn_share_bps)?;
        let vault = math::bps(amount, self.terms.creator_fee_vault_bps)?;
        let mut backers = amount - pool - vault;
        self.buyback_pool_sol = self
            .buyback_pool_sol
            .checked_add(pool)
            .ok_or(MoshError::MathOverflow)?;
        let to_vault = if self.status == LaunchStatus::Live {
            self.vault_sol = self.vault_sol.checked_add(vault).ok_or(MoshError::MathOverflow)?;
            vault
        } else {
            backers += vault;
            0
        };
        self.credit_backers(backers)?;
        Ok((pool, to_vault, backers))
    }

    /// Liquid vault SOL the payback rule needs before any backer payout.
    pub fn payout_target(&self) -> Result<u64> {
        let t = (self.initial_vault_sol as u128) * (self.terms.payout_mult_bps as u128) / BPS as u128;
        u64::try_from(t).map_err(|_| MoshError::MathOverflow.into())
    }

    /// Lamports that arrived for the launch itself (donations): vault SOL while Live, straight
    /// to backers once wound down.
    pub fn credit_vault(&mut self, amount: u64) -> Result<()> {
        if self.status == LaunchStatus::Live {
            self.vault_sol = self.vault_sol.checked_add(amount).ok_or(MoshError::MathOverflow)?;
            Ok(())
        } else {
            self.credit_backers(amount)
        }
    }

    /// Moves `amount` of vault SOL to backers' claimable credit, never below the vault floor.
    pub fn pay_backers_from_vault(&mut self, amount: u64) -> Result<()> {
        let left = self.vault_sol.checked_sub(amount).ok_or(MoshError::InsufficientVault)?;
        require!(left >= self.terms.min_vault_sol, MoshError::VaultFloor);
        self.vault_sol = left;
        self.credit_backers(amount)
    }

    pub fn apply_buy(&mut self, sol_in: u64, tokens_out: u64) -> Result<()> {
        self.real_sol = self.real_sol.checked_add(sol_in).ok_or(MoshError::MathOverflow)?;
        self.token_reserve = self
            .token_reserve
            .checked_sub(tokens_out)
            .ok_or(MoshError::InsufficientLiquidity)?;
        Ok(())
    }

    pub fn apply_sell(&mut self, tokens_in: u64, sol_out: u64) -> Result<()> {
        self.real_sol = self
            .real_sol
            .checked_sub(sol_out)
            .ok_or(MoshError::InsufficientLiquidity)?;
        self.token_reserve = self
            .token_reserve
            .checked_add(tokens_in)
            .ok_or(MoshError::MathOverflow)?;
        Ok(())
    }

    /// Splits a trade fee between backers, creator and platform using the launch's fixed terms.
    /// Returns (backer, creator, platform).
    pub fn distribute_fee(&mut self, fee: u64) -> Result<(u64, u64, u64)> {
        let backer = math::bps(fee, self.terms.backer_fee_share_bps)?;
        let creator = math::bps(fee, self.terms.creator_fee_share_bps)?;
        let platform = fee - backer - creator;
        self.credit_backers(backer)?;
        self.creator_fees_unclaimed = self
            .creator_fees_unclaimed
            .checked_add(creator)
            .ok_or(MoshError::MathOverflow)?;
        self.platform_fees_unclaimed = self
            .platform_fees_unclaimed
            .checked_add(platform)
            .ok_or(MoshError::MathOverflow)?;
        Ok((backer, creator, platform))
    }

    /// Adds `amount` lamports to what backers can claim, pro-rata to their deposits. The
    /// per-share increment rounds down, so claims never exceed `backer_fees_accrued`; the
    /// rounding dust stays in the launch account.
    pub fn credit_backers(&mut self, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        // raised > 0 is guaranteed once live (launch requires raise_min > 0)
        let inc = (amount as u128)
            .checked_mul(ACC_PRECISION)
            .ok_or(MoshError::MathOverflow)?
            / self.raised as u128;
        self.acc_fee_per_share = self
            .acc_fee_per_share
            .checked_add(inc)
            .ok_or(MoshError::MathOverflow)?;
        self.backer_fees_accrued = self
            .backer_fees_accrued
            .checked_add(amount)
            .ok_or(MoshError::MathOverflow)?;
        Ok(())
    }

    /// Average-cost basis of `tokens` of the vault's current holdings, rounded up so the basis
    /// left behind (rounded down) never overstates the average cost of what remains. Requires
    /// 0 < tokens <= vault_tokens, so the result is <= vault_cost_sol.
    pub fn vault_cost_of(&self, tokens: u64) -> u64 {
        let num = (self.vault_cost_sol as u128) * (tokens as u128);
        num.div_ceil(self.vault_tokens as u128) as u64
    }

    /// Folds the price that prevailed since the last trade into the EMA with weight
    /// dt / (dt + period). Must be called *before* the reserves change so same-slot manipulation
    /// cannot move the EMA, and the weight never reaches 1 so no idle gap can snap the EMA to a
    /// price an attacker is holding. Holdfast launches price every trade, so the EMA is exact.
    pub fn update_ema(&mut self, now: i64) -> Result<()> {
        let p = self.price_q64()?;
        self.update_ema_with(now, p)
    }

    /// Pump launches only see the venue price when an agent trade samples it (public trades
    /// and the permissionless cranks never do), so `dt` is time since the last *sample*, not
    /// how long `p` prevailed. There it is clamped to the period: one sample moves the EMA at
    /// most halfway to the sampled price, however long the launch sat idle.
    pub fn update_ema_with(&mut self, now: i64, p: u128) -> Result<()> {
        if self.ema_price == 0 {
            self.ema_price = p;
        } else {
            let period = self.terms.ema_period_secs as u128;
            let mut dt = now.saturating_sub(self.last_trade_ts).max(0) as u128;
            if self.venue == Venue::Pump {
                dt = dt.min(period);
            }
            let den = dt + period;
            // |p - ema| < 2^104 and dt < 2^40 for any realistic launch; checked anyway.
            let step = |d: u128| -> Result<u128> {
                Ok(d.checked_mul(dt).ok_or(MoshError::MathOverflow)? / den)
            };
            if p >= self.ema_price {
                self.ema_price += step(p - self.ema_price)?;
            } else {
                self.ema_price -= step(self.ema_price - p)?;
            }
        }
        self.last_trade_ts = now;
        Ok(())
    }

    pub fn roll_window(&mut self, now: i64) -> Result<()> {
        if now >= self.window_start.saturating_add(self.terms.agent_window_secs as i64) {
            self.window_start = now;
            self.window_buy_cap = math::bps(self.vault_sol, self.terms.agent_buy_bps_per_window)?;
            self.window_sell_cap = math::bps(self.vault_tokens, self.terms.agent_sell_bps_per_window)?;
            self.window_sol_spent = 0;
            self.window_tokens_sold = 0;
        }
        Ok(())
    }

    /// Average vault cost as (sol, tokens). Falls back to the bundle's entry if the vault is empty.
    pub fn cost_basis(&self) -> (u64, u64) {
        if self.vault_tokens > 0 {
            (self.vault_cost_sol, self.vault_tokens)
        } else {
            (self.bundle_sol, self.bundle_tokens)
        }
    }

    pub fn record_volume(&mut self, sol: u64) {
        self.volume_sol = self.volume_sol.saturating_add(sol);
        self.trade_count = self.trade_count.saturating_add(1);
    }

    /// The token account holding the vault's tokens: a program PDA under Token-2022 for
    /// Holdfast launches, the pump authority's SPL Token ATA for pump launches.
    pub fn vault_token_account(&self, launch: &Pubkey) -> Pubkey {
        match self.venue {
            Venue::Holdfast => {
                Pubkey::create_program_address(&[VAULT_SEED, launch.as_ref(), &[self.vault_bump]], &crate::ID)
                    .expect("stored vault bump")
            }
            Venue::Pump => {
                let authority = self.pump_authority(launch);
                anchor_spl::associated_token::get_associated_token_address(&authority, &self.mint)
            }
        }
    }

    pub fn pump_authority(&self, launch: &Pubkey) -> Pubkey {
        Pubkey::create_program_address(
            &[PUMP_AUTHORITY_SEED, launch.as_ref(), &[self.pump.authority_bump]],
            &crate::ID,
        )
        .expect("stored authority bump")
    }
}

#[account]
#[derive(InitSpace)]
pub struct Backer {
    pub launch: Pubkey,
    pub owner: Pubkey,
    /// Lamports deposited. Doubles as the fee-share weight.
    pub deposited: u64,
    pub fees_claimed: u64,
    pub bump: u8,
}

impl Backer {
    pub fn claimable(&self, launch: &Launch) -> Result<u64> {
        let entitled = (self.deposited as u128)
            .checked_mul(launch.acc_fee_per_share)
            .ok_or(MoshError::MathOverflow)?
            / ACC_PRECISION;
        let entitled = u64::try_from(entitled).map_err(|_| MoshError::MathOverflow)?;
        Ok(entitled.saturating_sub(self.fees_claimed))
    }
}
