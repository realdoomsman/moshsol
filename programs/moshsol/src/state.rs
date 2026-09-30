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
    /// Blocks agent trades (circuit breaker). Vault funds stay locked either way.
    pub agents_paused: bool,
    /// Beta cap on a new launch's `raise_max`; 0 = only the hard `MAX_RAISE_LAMPORTS` limit.
    pub max_raise_lamports: u64,
    /// Beta cap on one wallet's total deposit into any raise, on top of the creator's own
    /// `max_per_wallet`; 0 = no platform cap.
    pub max_wallet_deposit_lamports: u64,
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
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum LaunchStatus {
    Raising,
    Live,
    Refunding,
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

    // ---- curve (constant product with virtual SOL; liquidity can never be removed) ----
    pub virtual_sol: u64,
    pub real_sol: u64,
    pub token_reserve: u64,

    // ---- locked vault ----
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
    pub last_public_trade_slot: u64,
    pub last_agent_trade_slot: u64,
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
            LaunchStatus::Live => self.real_sol
                + self.vault_sol
                + (self.backer_fees_accrued - self.backer_fees_claimed)
                + self.creator_fees_unclaimed
                + self.platform_fees_unclaimed,
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
        if backer > 0 {
            // raised > 0 is guaranteed for live launches (launch requires raise_min > 0)
            let inc = (backer as u128)
                .checked_mul(ACC_PRECISION)
                .ok_or(MoshError::MathOverflow)?
                / self.raised as u128;
            self.acc_fee_per_share = self
                .acc_fee_per_share
                .checked_add(inc)
                .ok_or(MoshError::MathOverflow)?;
            self.backer_fees_accrued = self
                .backer_fees_accrued
                .checked_add(backer)
                .ok_or(MoshError::MathOverflow)?;
        }
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

    /// Folds the price that prevailed since the last trade into the EMA with weight
    /// dt / (dt + period). Must be called *before* the reserves change so same-slot manipulation
    /// cannot move the EMA, and the weight never reaches 1 so no idle gap can snap the EMA to a
    /// price an attacker is holding.
    pub fn update_ema(&mut self, now: i64) -> Result<()> {
        let p = self.price_q64()?;
        if self.ema_price == 0 {
            self.ema_price = p;
        } else {
            let dt = now.saturating_sub(self.last_trade_ts).max(0) as u128;
            let den = dt + self.terms.ema_period_secs as u128;
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
