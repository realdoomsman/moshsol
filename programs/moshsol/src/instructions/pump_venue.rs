//! What every instruction that trades a pump launch's venue shares: reading the venue's price
//! and reserves from the forwarded accounts, executing a buy / sell through the pump authority
//! (with the transient WSOL account PumpSwap needs) and measuring the fill from balance deltas.

use std::cell::Cell;

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, get_associated_token_address};
use anchor_spl::token::{self, CloseAccount};

use super::pay_out;
use crate::errors::MoshError;
use crate::math;
use crate::pump::{self, BondingCurve, Trader};
use crate::state::Launch;

/// Spot and reserves of a pump launch's venue: the bonding curve's virtual reserves, or the
/// pool's effective reserves once graduated (`pump::pool_reserves`: the quote balance plus the
/// pool's `virtual_quote_reserves`, as PumpSwap prices every trade).
pub struct VenueView {
    pub price_q64: u128,
    pub quote_reserve: u64,
    pub base_reserve: u64,
    /// Curve completed (trading there is over; graduate and use the pool).
    pub complete: bool,
}

pub fn venue_view<'info>(launch: &Launch, r: &[AccountInfo<'info>]) -> Result<VenueView> {
    if launch.pump.graduated {
        let (quote_reserve, base_reserve) = pump::pool_reserves(&launch.pump.pool, r)?;
        Ok(VenueView {
            price_q64: math::price_q64(quote_reserve, base_reserve)?,
            quote_reserve,
            base_reserve,
            complete: false,
        })
    } else {
        require!(r.len() >= pump::curve::LEN, MoshError::InvalidVenueAccount);
        require_keys_eq!(
            r[pump::curve::BONDING_CURVE].key(),
            launch.pump.bonding_curve,
            MoshError::InvalidVenueAccount
        );
        let curve = BondingCurve::load(&r[pump::curve::BONDING_CURVE])?;
        Ok(VenueView {
            price_q64: curve.price_q64()?,
            quote_reserve: curve.virtual_quote_reserves,
            base_reserve: curve.virtual_token_reserves,
            complete: curve.complete,
        })
    }
}

/// Tokens the venue itself holds: the bonding curve's ATA before graduation, the pool's base
/// account after. Used by the wind-down "no outside holders" check.
pub fn venue_tokens<'info>(launch: &Launch, r: &[AccountInfo<'info>]) -> Result<u64> {
    if launch.pump.graduated {
        pump::token_amount(&r[pump::pool::POOL_BASE])
    } else {
        let expected = get_associated_token_address(&launch.pump.bonding_curve, &launch.mint);
        require_keys_eq!(
            r[pump::curve::ASSOCIATED_BONDING_CURVE].key(),
            expected,
            MoshError::InvalidVenueAccount
        );
        pump::token_amount(&r[pump::curve::ASSOCIATED_BONDING_CURVE])
    }
}

/// Everything a venue trade needs: the launch (where the SOL lives), its pump authority (the
/// venue `user`, signing with `authority_seeds`), the token account the venue `user` owns for
/// `mint`, the signer that fronts transient rent, and the venue accounts. Call `settle` after
/// the last CPI of the instruction: it returns fronted rent to the payer, a direct lamport
/// move no later CPI would see. Every trade first sweeps whatever the authority already holds
/// (anyone can send lamports to the PDA) into the launch and records it in `donated`, so the
/// measured fill never includes it; the caller credits `donated` to the vault. The same goes
/// for whatever a pre-existing WSOL account of the venue `user` holds (anyone can create and
/// fund it): it lands on the launch when the account is closed after the trade and is `donated`.
///
/// With an `executor` (an agent wallet, a real signer) the executor is the venue `user` instead
/// of the pump authority and `user_tokens` is its token account: the launch's SOL reaches it
/// right before the venue call, and whatever it holds above what it had when the trade started
/// goes back to the launch right after, so the fill is measured on the launch exactly as
/// without one and the executor keeps nothing.
pub struct VenueTrade<'a, 'info> {
    pub launch: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub authority_seeds: &'a [&'a [u8]],
    pub mint: &'a AccountInfo<'info>,
    pub user_tokens: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub graduated: bool,
    pub remaining: &'a [AccountInfo<'info>],
    pub executor: Option<&'a AccountInfo<'info>>,
    /// The executor's lamports when the current trade started.
    pub executor_base: Cell<u64>,
    /// Rent the payer fronted for a transient WSOL account, owed back by `settle`.
    pub rent_owed: Cell<u64>,
    /// Lamports found on the pump authority or on its pre-existing WSOL account before trading,
    /// swept into the launch (the latter by closing the account after the trade).
    pub donated: Cell<u64>,
}

impl<'a, 'info> VenueTrade<'a, 'info> {
    /// The venue `user`: the executor when there is one, else the pump authority.
    fn user(&self) -> &'a AccountInfo<'info> {
        self.executor.unwrap_or(self.authority)
    }

    fn trader(&self) -> Trader<'a, 'info> {
        Trader {
            mint: self.mint,
            user: self.user(),
            user_tokens: self.user_tokens,
            system_program: self.system_program,
            token_program: self.token_program,
        }
    }

    /// Starts a trade: sweeps the authority (`absorb`) and notes the executor's lamports.
    fn begin(&self) -> Result<()> {
        self.absorb()?;
        if let Some(e) = self.executor {
            self.executor_base.set(e.lamports());
        }
        Ok(())
    }

    /// After a bonding-curve call: everything the venue `user` holds beyond its starting
    /// balance goes back to the launch (the pump authority starts empty; the executor's own
    /// balance stays with it). Fails if the venue took more than the launch gave it.
    fn return_to_launch(&self) -> Result<()> {
        let Some(e) = self.executor else {
            self.sweep()?;
            return Ok(());
        };
        let extra = e
            .lamports()
            .checked_sub(self.executor_base.get())
            .ok_or(MoshError::ExecutorNotSettled)?;
        if extra > 0 {
            system_program::transfer(
                CpiContext::new(
                    self.system_program.clone(),
                    system_program::Transfer { from: e.clone(), to: self.launch.clone() },
                ),
                extra,
            )?;
        }
        Ok(())
    }

    /// Spends up to `sol_in` lamports of the launch's SOL on the venue. Returns (lamports
    /// spent, tokens received), both measured.
    pub fn buy(&self, sol_in: u64, min_tokens_out: u64) -> Result<(u64, u64)> {
        self.begin()?;
        let sol_before = self.launch.lamports();
        let rent_before = self.rent_owed.get();
        let donated_before = self.donated.get();
        let tokens_before = pump::token_amount(self.user_tokens)?;
        pump::ensure_volume_accumulator(self.user(), self.payer, self.system_program, self.remaining, self.graduated)?;
        if self.graduated {
            self.open_wsol()?;
            // The SOL reaches the WSOL account from the venue `user` by a plain transfer and is
            // wrapped by a `sync_native` carrying that account alone: SPL Token (p-token on
            // mainnet) fails an instruction given any account it doesn't take.
            self.fund(sol_in)?;
            let wsol = &self.remaining[pump::pool::USER_WSOL];
            system_program::transfer(
                CpiContext::new_with_signer(
                    self.system_program.clone(),
                    system_program::Transfer { from: self.user().clone(), to: wsol.clone() },
                    &[self.authority_seeds],
                ),
                sol_in,
            )?;
            token::sync_native(CpiContext::new(self.token_program.clone(), token::SyncNative { account: wsol.clone() }))?;
            pump::pool_trade(
                &self.trader(),
                self.remaining,
                pump::amm_buy_exact_quote_in_data(sol_in, min_tokens_out.max(1)),
                true,
                self.authority_seeds,
            )?;
            self.close_wsol()?;
        } else {
            self.fund(sol_in)?;
            pump::curve_trade(
                &self.trader(),
                self.remaining,
                pump::buy_exact_sol_in_data(sol_in, min_tokens_out.max(1)),
                true,
                self.authority_seeds,
            )?;
            self.return_to_launch()?;
        }
        // Rent a closed WSOL account dropped on the launch is the payer's, not a fill; what the
        // account held before the trade is donated, not a fill.
        let spent = sol_before + (self.rent_owed.get() - rent_before) + (self.donated.get() - donated_before)
            - self.launch.lamports();
        let tokens = pump::token_amount(self.user_tokens)? - tokens_before;
        Ok((spent, tokens))
    }

    /// Bonding-curve `buy(amount, max_sol_cost)`: exactly `amount` tokens for at most
    /// `max_sol_cost` lamports (the bundle buy, which is capped in tokens). Returns (lamports
    /// spent, tokens received), both measured.
    pub fn buy_tokens(&self, amount: u64, max_sol_cost: u64) -> Result<(u64, u64)> {
        require!(!self.graduated, MoshError::WrongVenue);
        self.absorb()?;
        let sol_before = self.launch.lamports();
        let tokens_before = pump::token_amount(self.user_tokens)?;
        self.fund(max_sol_cost)?;
        pump::curve_trade(
            &self.trader(),
            self.remaining,
            pump::buy_data(amount, max_sol_cost),
            true,
            self.authority_seeds,
        )?;
        self.sweep()?;
        let spent = sol_before - self.launch.lamports();
        let tokens = pump::token_amount(self.user_tokens)? - tokens_before;
        Ok((spent, tokens))
    }

    /// Sells `tokens_in` of the venue `user`'s tokens into the venue; the proceeds land on the
    /// launch. Returns (lamports received, tokens sold), both measured.
    pub fn sell(&self, tokens_in: u64, min_sol_out: u64) -> Result<(u64, u64)> {
        self.begin()?;
        let sol_before = self.launch.lamports();
        let rent_before = self.rent_owed.get();
        let donated_before = self.donated.get();
        let tokens_before = pump::token_amount(self.user_tokens)?;
        if self.graduated {
            self.open_wsol()?;
            pump::pool_trade(
                &self.trader(),
                self.remaining,
                pump::amm_sell_data(tokens_in, min_sol_out),
                false,
                self.authority_seeds,
            )?;
            self.close_wsol()?;
        } else {
            pump::curve_trade(
                &self.trader(),
                self.remaining,
                pump::sell_data(tokens_in, min_sol_out),
                false,
                self.authority_seeds,
            )?;
            self.return_to_launch()?;
        }
        let received = self.launch.lamports()
            - sol_before
            - (self.rent_owed.get() - rent_before)
            - (self.donated.get() - donated_before);
        let sold = tokens_before - pump::token_amount(self.user_tokens)?;
        Ok((received, sold))
    }

    /// Makes sure the venue `user`'s WSOL ATA exists for a PumpSwap trade. Existence is decided
    /// by the account being a token account, not by its balance (anyone can send lamports to
    /// the address); whatever the payer fronts for it is measured and owed back by `settle`.
    /// Every lamport already at the address — rent and wrapped balance of an account someone
    /// created and funded, or bare lamports sent to it before it existed (the ATA program only
    /// tops those up to rent) — reaches the launch when `close_wsol` unwraps it, so it is booked
    /// as donated and kept out of the measured fill.
    fn open_wsol(&self) -> Result<()> {
        let r = self.remaining;
        let wsol = &r[pump::pool::USER_WSOL];
        require_keys_eq!(
            wsol.key(),
            get_associated_token_address(self.user().key, &pump::WSOL_MINT),
            MoshError::InvalidVenueAccount
        );
        self.donated.set(self.donated.get() + wsol.lamports());
        if pump::is_token_account(wsol) {
            return Ok(());
        }
        require_keys_eq!(
            r[pump::pool::ASSOCIATED_TOKEN_PROGRAM].key(),
            associated_token::ID,
            MoshError::InvalidVenueAccount
        );
        let payer_before = self.payer.lamports();
        associated_token::create_idempotent(CpiContext::new(
            r[pump::pool::ASSOCIATED_TOKEN_PROGRAM].clone(),
            associated_token::Create {
                payer: self.payer.clone(),
                associated_token: wsol.clone(),
                authority: self.user().clone(),
                mint: r[pump::pool::WSOL_MINT].clone(),
                system_program: self.system_program.clone(),
                token_program: self.token_program.clone(),
            },
        ))?;
        self.rent_owed.set(self.rent_owed.get() + (payer_before - self.payer.lamports()));
        Ok(())
    }

    /// Unwraps the WSOL account into the launch (its rent included; the payer's share of it is
    /// in `rent_owed`). The pump authority signs with its seeds, an executor as a real signer.
    fn close_wsol(&self) -> Result<()> {
        let wsol = &self.remaining[pump::pool::USER_WSOL];
        token::close_account(CpiContext::new_with_signer(
            self.token_program.clone(),
            CloseAccount {
                account: wsol.clone(),
                destination: self.launch.clone(),
                authority: self.user().clone(),
            },
            &[self.authority_seeds],
        ))
    }

    /// Returns the rent the payer fronted. Must be the instruction's last lamport move.
    pub fn settle(&self) -> Result<()> {
        let owed = self.rent_owed.replace(0);
        if owed > 0 {
            pay_out(self.launch, self.payer, owed)?;
        }
        Ok(())
    }

    /// Sweeps what the authority holds before a trade and books it as donated. Every trade
    /// does this itself; `launch_pump` calls it before funding the authority for `create`.
    pub fn absorb(&self) -> Result<()> {
        let swept = self.sweep()?;
        self.donated.set(self.donated.get() + swept);
        Ok(())
    }

    /// Moves `amount` of the launch's lamports to the venue `user` (the pump authority or the
    /// executor, both system accounts that can sign) and flushes the direct move to the runtime
    /// with a zero-lamport transfer between the two, so the next CPI (the venue's) doesn't need
    /// the launch among its accounts: the runtime syncs only a CPI's own accounts from the
    /// caller and rejects the call if the caller's lamport sum moved.
    pub fn fund(&self, amount: u64) -> Result<()> {
        let user = self.user();
        self.launch.sub_lamports(amount)?;
        user.add_lamports(amount)?;
        system_program::transfer(
            CpiContext::new_with_signer(
                self.system_program.clone(),
                system_program::Transfer { from: user.clone(), to: self.launch.clone() },
                &[self.authority_seeds],
            ),
            0,
        )
    }

    /// Moves every lamport the pump authority holds back to the launch, so it ends the
    /// instruction empty (a system account can't be left rent-paying). Returns the amount.
    pub fn sweep(&self) -> Result<u64> {
        let amount = self.authority.lamports();
        if amount > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    self.system_program.clone(),
                    system_program::Transfer {
                        from: self.authority.clone(),
                        to: self.launch.clone(),
                    },
                    &[self.authority_seeds],
                ),
                amount,
            )?;
        }
        Ok(amount)
    }
}
