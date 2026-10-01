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
    /// Blocks agent trades (circuit breaker).
    pub agents_paused: bool,
    /// Beta cap on a new launch's `raise_max`; 0 = only the hard `MAX_RAISE_LAMPORTS` limit.
    pub max_raise_lamports: u64,
    /// Beta cap on one wallet's total deposit into any raise, on top of the creator's own
    /// `max_per_wallet`; 0 = no platform cap.
    pub max_wallet_deposit_lamports: u64,
    /// Whether `create_launch` (a launch on Holdfast's own curve) is still open. Off on
    /// mainnet: new launches are pump.fun tokens (`create_launch_pump`).
    pub holdfast_curve_enabled: bool,
    /// Share of a pump launch's creator fees and of the agent's realized profit that goes to
    /// the Holdfast buyback-and-burn pool; the rest goes to vault SOL / backers.
    pub burn_share_bps: u16,
    /// The Holdfast token `buyback_burn` buys and burns. `Pubkey::default()` = not set yet: the
    /// crank refuses and the pools keep accruing.
    pub buyback_mint: Pubkey,
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
    /// Share of creator fees and agent profit routed to the buyback-and-burn pool (pump
    /// launches; 0 on launches created before it existed).
    pub burn_share_bps: u16,
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
        }
    }
}

impl LaunchTerms {
    /// Terms of a pump launch: the venue takes the trade fee, so there is no fee split and
    /// the creator's share is zero; what the launch earns is pump.fun's creator fee, split by
    /// `burn_share_bps` between the buyback pool and vault SOL.
    pub fn pump(p: &PlatformParams) -> Self {
        Self {
            trade_fee_bps: 0,
            backer_fee_share_bps: 0,
            creator_fee_share_bps: 0,
            ..Self::from(p)
        }
    }
}

/// `LaunchTerms` as laid out before `burn_share_bps`; only read by `migrate_launch`.
#[derive(AnchorDeserialize, InitSpace)]
pub struct LaunchTermsV1 {
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
}

/// `PlatformParams` as laid out before the pump fields; only read by `migrate_platform`.
#[derive(AnchorDeserialize, InitSpace)]
pub struct PlatformParamsV1 {
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
}

/// `Platform` as laid out before the pump fields (data after the discriminator).
#[derive(AnchorDeserialize, InitSpace)]
pub struct PlatformV1 {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub agent_authority: Pubkey,
    pub params: PlatformParamsV1,
    pub launch_count: u64,
    pub bump: u8,
}

impl PlatformV1 {
    pub fn upgrade(self) -> Platform {
        let p = self.params;
        Platform {
            admin: self.admin,
            pending_admin: self.pending_admin,
            fee_recipient: self.fee_recipient,
            agent_authority: self.agent_authority,
            params: PlatformParams {
                trade_fee_bps: p.trade_fee_bps,
                backer_fee_share_bps: p.backer_fee_share_bps,
                creator_fee_share_bps: p.creator_fee_share_bps,
                launch_fee_bps: p.launch_fee_bps,
                create_fee_lamports: p.create_fee_lamports,
                virtual_sol_reserves: p.virtual_sol_reserves,
                max_bundle_supply_bps: p.max_bundle_supply_bps,
                min_raise_lamports: p.min_raise_lamports,
                agent_buy_bps_per_window: p.agent_buy_bps_per_window,
                agent_sell_bps_per_window: p.agent_sell_bps_per_window,
                agent_max_impact_bps: p.agent_max_impact_bps,
                agent_band_bps: p.agent_band_bps,
                agent_window_secs: p.agent_window_secs,
                ema_period_secs: p.ema_period_secs,
                paused: p.paused,
                agents_paused: p.agents_paused,
                max_raise_lamports: p.max_raise_lamports,
                max_wallet_deposit_lamports: p.max_wallet_deposit_lamports,
                holdfast_curve_enabled: false,
                burn_share_bps: DEFAULT_BURN_SHARE_BPS,
                buyback_mint: Pubkey::default(),
            },
            launch_count: self.launch_count,
            bump: self.bump,
        }
    }
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
    /// SOL from agent sells not yet used for buy-backs. Buy-backs above average cost may only
    /// spend this budget, and only below the average agent sell price.
    pub buyback_sol: u64,

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
}

/// `Launch` as laid out before the venue fields (data after the discriminator); only read by
/// `migrate_launch`.
#[derive(AnchorDeserialize, InitSpace)]
pub struct LaunchV1 {
    pub index: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub status: LaunchStatus,
    pub bump: u8,
    pub curve_bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
    pub launched_at: i64,
    pub terms: LaunchTermsV1,
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
    pub buyback_sol: u64,
    pub volume_sol: u64,
    pub trade_count: u64,
    pub last_public_trade_slot: u64,
    pub last_agent_trade_slot: u64,
}

impl LaunchV1 {
    /// The same launch in the current layout: a Holdfast-curve launch keyed by its mint, with
    /// no burn share and empty pump state.
    pub fn upgrade(self) -> Launch {
        let t = self.terms;
        Launch {
            index: self.index,
            creator: self.creator,
            mint: self.mint,
            status: self.status,
            bump: self.bump,
            curve_bump: self.curve_bump,
            vault_bump: self.vault_bump,
            created_at: self.created_at,
            launched_at: self.launched_at,
            terms: LaunchTerms {
                trade_fee_bps: t.trade_fee_bps,
                backer_fee_share_bps: t.backer_fee_share_bps,
                creator_fee_share_bps: t.creator_fee_share_bps,
                launch_fee_bps: t.launch_fee_bps,
                agent_buy_bps_per_window: t.agent_buy_bps_per_window,
                agent_sell_bps_per_window: t.agent_sell_bps_per_window,
                agent_max_impact_bps: t.agent_max_impact_bps,
                agent_band_bps: t.agent_band_bps,
                agent_window_secs: t.agent_window_secs,
                ema_period_secs: t.ema_period_secs,
                burn_share_bps: 0,
            },
            raise_min: self.raise_min,
            raise_max: self.raise_max,
            max_per_wallet: self.max_per_wallet,
            raise_deadline: self.raise_deadline,
            raised: self.raised,
            refunded: self.refunded,
            backer_count: self.backer_count,
            whitelist_root: self.whitelist_root,
            bundle_supply_bps: self.bundle_supply_bps,
            reserve_bps: self.reserve_bps,
            virtual_sol: self.virtual_sol,
            real_sol: self.real_sol,
            token_reserve: self.token_reserve,
            vault_sol: self.vault_sol,
            vault_tokens: self.vault_tokens,
            bundle_sol: self.bundle_sol,
            bundle_tokens: self.bundle_tokens,
            vault_cost_sol: self.vault_cost_sol,
            acc_fee_per_share: self.acc_fee_per_share,
            backer_fees_accrued: self.backer_fees_accrued,
            backer_fees_claimed: self.backer_fees_claimed,
            creator_fees_unclaimed: self.creator_fees_unclaimed,
            creator_fees_claimed: self.creator_fees_claimed,
            platform_fees_unclaimed: self.platform_fees_unclaimed,
            window_start: self.window_start,
            window_buy_cap: self.window_buy_cap,
            window_sol_spent: self.window_sol_spent,
            window_sell_cap: self.window_sell_cap,
            window_tokens_sold: self.window_tokens_sold,
            ema_price: self.ema_price,
            last_trade_ts: self.last_trade_ts,
            agent_buys: self.agent_buys,
            agent_sells: self.agent_sells,
            agent_sol_spent: self.agent_sol_spent,
            agent_sol_received: self.agent_sol_received,
            agent_tokens_sold: self.agent_tokens_sold,
            buyback_sol: self.buyback_sol,
            volume_sol: self.volume_sol,
            trade_count: self.trade_count,
            last_public_trade_slot: self.last_public_trade_slot,
            last_agent_trade_slot: self.last_agent_trade_slot,
            venue: Venue::Holdfast,
            create_key: self.mint,
            pump: PumpState::default(),
            buyback_pool_sol: 0,
            creator_fees_collected: 0,
            burned_sol: 0,
            burned_tokens: 0,
            last_buyback_ts: 0,
            name: String::new(),
            symbol: String::new(),
            uri: String::new(),
        }
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

    /// Splits `amount` by the launch's burn share: returns (buyback pool part, rest) and
    /// books the pool part.
    pub fn credit_buyback_pool(&mut self, amount: u64) -> Result<(u64, u64)> {
        let pool = math::bps(amount, self.terms.burn_share_bps)?;
        self.buyback_pool_sol = self
            .buyback_pool_sol
            .checked_add(pool)
            .ok_or(MoshError::MathOverflow)?;
        Ok((pool, amount - pool))
    }

    /// Lamports that arrived for the launch itself (creator fees, donations): vault SOL while
    /// Live, straight to backers once wound down. Returns (to vault, to backers).
    pub fn credit_vault(&mut self, amount: u64) -> Result<(u64, u64)> {
        if self.status == LaunchStatus::Live {
            self.vault_sol = self.vault_sol.checked_add(amount).ok_or(MoshError::MathOverflow)?;
            Ok((amount, 0))
        } else {
            self.credit_backers(amount)?;
            Ok((0, amount))
        }
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
