#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod pump;
pub mod state;

use instructions::*;
use state::PlatformParams;

declare_id!("EduEwYBkqWCNbZ95nQVeakY8d4tGKM2qaAk7kuW76AMQ");

#[program]
pub mod moshsol {
    use super::*;

    // ---------------- platform admin ----------------

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        fee_recipient: Pubkey,
        agent_authority: Pubkey,
        params: PlatformParams,
    ) -> Result<()> {
        platform::initialize_platform(ctx, fee_recipient, agent_authority, params)
    }

    pub fn update_platform(ctx: Context<AdminOnly>, params: PlatformParams) -> Result<()> {
        platform::update_platform(ctx, params)
    }

    pub fn set_fee_recipient(ctx: Context<AdminOnly>, fee_recipient: Pubkey) -> Result<()> {
        platform::set_fee_recipient(ctx, fee_recipient)
    }

    pub fn set_agent_authority(ctx: Context<AdminOnly>, agent_authority: Pubkey) -> Result<()> {
        platform::set_agent_authority(ctx, agent_authority)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        platform::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        platform::accept_admin(ctx)
    }

    /// One-time after the pump upgrade: grows the platform account to the current layout.
    pub fn migrate_platform(ctx: Context<MigratePlatform>) -> Result<()> {
        migrate::migrate_platform(ctx)
    }

    /// One-time per pre-pump launch after the upgrade: grows it to the current layout.
    pub fn migrate_launch(ctx: Context<MigrateLaunch>) -> Result<()> {
        migrate::migrate_launch(ctx)
    }

    // ---------------- launch lifecycle ----------------

    pub fn create_launch(ctx: Context<CreateLaunch>, args: CreateLaunchArgs) -> Result<()> {
        create_launch::create_launch(ctx, args)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        raise::deposit(ctx, amount, proof)
    }

    pub fn cancel_launch(ctx: Context<CancelLaunch>) -> Result<()> {
        raise::cancel_launch(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        raise::refund(ctx)
    }

    pub fn launch(ctx: Context<LaunchToken>) -> Result<()> {
        launch_token::launch(ctx)
    }

    // ---------------- pump.fun launches ----------------

    pub fn create_launch_pump(ctx: Context<CreateLaunchPump>, args: CreateLaunchPumpArgs) -> Result<()> {
        pump_launch::create_launch_pump(ctx, args)
    }

    pub fn launch_pump(ctx: Context<LaunchPump>) -> Result<()> {
        pump_launch::launch_pump(ctx)
    }

    pub fn graduate_pump(ctx: Context<GraduatePump>) -> Result<()> {
        pump_launch::graduate_pump(ctx)
    }

    pub fn agent_buy_pump<'info>(
        ctx: Context<'_, '_, 'info, 'info, AgentTradePump<'info>>,
        sol_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        pump_agent::agent_buy_pump(ctx, sol_in, min_tokens_out)
    }

    pub fn agent_sell_pump<'info>(
        ctx: Context<'_, '_, 'info, 'info, AgentTradePump<'info>>,
        tokens_in: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        pump_agent::agent_sell_pump(ctx, tokens_in, min_sol_out)
    }

    pub fn collect_pump_fees<'info>(ctx: Context<'_, '_, 'info, 'info, CollectPumpFees<'info>>) -> Result<()> {
        pump_fees::collect_pump_fees(ctx)
    }

    pub fn buyback_burn<'info>(
        ctx: Context<'_, '_, 'info, 'info, BuybackBurn<'info>>,
        max_sol: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        pump_fees::buyback_burn(ctx, max_sol, min_tokens_out)
    }

    pub fn wind_down_pump<'info>(ctx: Context<'_, '_, 'info, 'info, WindDownPump<'info>>) -> Result<()> {
        vault::wind_down_pump(ctx)
    }

    // ---------------- trading ----------------

    pub fn buy(ctx: Context<Buy>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        trade::buy(ctx, sol_in, min_tokens_out)
    }

    pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        trade::sell(ctx, tokens_in, min_sol_out)
    }

    pub fn agent_buy(ctx: Context<AgentTrade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        agent::agent_buy(ctx, sol_in, min_tokens_out)
    }

    pub fn agent_sell(ctx: Context<AgentTrade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        agent::agent_sell(ctx, tokens_in, min_sol_out)
    }

    // ---------------- fees ----------------

    pub fn claim_backer_fees(ctx: Context<ClaimBackerFees>) -> Result<()> {
        fees::claim_backer_fees(ctx)
    }

    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        fees::claim_creator_fees(ctx)
    }

    pub fn sweep_platform_fees(ctx: Context<SweepPlatformFees>) -> Result<()> {
        fees::sweep_platform_fees(ctx)
    }

    // ---------------- vault ----------------

    pub fn wind_down(ctx: Context<WindDown>) -> Result<()> {
        vault::wind_down(ctx)
    }

    pub fn admin_withdraw_vault(ctx: Context<AdminWithdrawVault>, sol: u64, tokens: u64) -> Result<()> {
        vault::admin_withdraw_vault(ctx, sol, tokens)
    }
}
