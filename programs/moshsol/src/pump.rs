//! Minimal hand-written client for the pump.fun bonding curve, the PumpSwap AMM and their fee
//! program: program ids, PDAs, instruction data and the account prefixes this program reads.
//! Layouts come from the on-chain IDLs (pump.fun `6EF8…`, PumpSwap `pAMM…`); only the fields we
//! use are decoded, so later appended fields don't break anything.
//!
//! Every CPI is sent with the venue accounts forwarded from `remaining_accounts` in the order of
//! the layouts below. The venue programs validate their own PDAs and config accounts; this
//! program pins what matters to it — the program ids, the launch's bonding curve / pool and its
//! own token accounts — and measures every fill from balance deltas.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::pubkey;
use anchor_spl::token::spl_token;

use crate::errors::MoshError;

pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const PUMP_AMM_PROGRAM_ID: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const PUMP_FEE_PROGRAM_ID: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
pub const MPL_TOKEN_METADATA_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const WSOL_MINT: Pubkey = spl_token::native_mint::ID;
/// `spl_token::state::Account::LEN`.
pub const SPL_TOKEN_ACCOUNT_LEN: usize = 165;

const BONDING_CURVE_DISC: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
const POOL_DISC: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];

const IX_CREATE: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];
const IX_BUY: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];
const IX_BUY_EXACT_SOL_IN: [u8; 8] = [56, 252, 116, 8, 158, 223, 205, 95];
const IX_SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const IX_COLLECT_CREATOR_FEE: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];
const IX_AMM_BUY_EXACT_QUOTE_IN: [u8; 8] = [198, 46, 21, 82, 180, 217, 232, 112];
const IX_AMM_SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const IX_AMM_COLLECT_COIN_CREATOR_FEE: [u8; 8] = [160, 57, 89, 42, 181, 139, 43, 66];
/// Same name, hence the same discriminator, on pump.fun and PumpSwap.
const IX_INIT_USER_VOLUME_ACCUMULATOR: [u8; 8] = [94, 6, 202, 115, 255, 96, 232, 183];

// ---------------- PDAs ----------------

pub fn bonding_curve_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &PUMP_PROGRAM_ID).0
}

pub fn pool_authority_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pool-authority", mint.as_ref()], &PUMP_PROGRAM_ID).0
}

/// The canonical PumpSwap pool pump.fun migrates a graduated curve into (index 0, quoted in
/// WSOL, created by the curve's pool authority).
pub fn pool_pda(mint: &Pubkey) -> Pubkey {
    let authority = pool_authority_pda(mint);
    Pubkey::find_program_address(
        &[b"pool", &0u16.to_le_bytes(), authority.as_ref(), mint.as_ref(), WSOL_MINT.as_ref()],
        &PUMP_AMM_PROGRAM_ID,
    )
    .0
}

// ---------------- account views ----------------

/// Prefix of pump.fun's `BondingCurve` account.
pub struct BondingCurve {
    pub virtual_token_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub real_token_reserves: u64,
    pub real_quote_reserves: u64,
    pub complete: bool,
    pub creator: Pubkey,
}

impl BondingCurve {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        require_keys_eq!(*info.owner, PUMP_PROGRAM_ID, MoshError::InvalidVenueAccount);
        let data = info.try_borrow_data()?;
        require!(data.len() >= 8 + 5 * 8 + 1 + 32 && data[..8] == BONDING_CURVE_DISC, MoshError::InvalidVenueAccount);
        let u = |at: usize| u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
        Ok(Self {
            virtual_token_reserves: u(8),
            virtual_quote_reserves: u(16),
            real_token_reserves: u(24),
            real_quote_reserves: u(32),
            complete: data[48] != 0,
            creator: Pubkey::new_from_array(data[49..81].try_into().unwrap()),
        })
    }

    /// Spot price (Q64.64 lamports per base unit) from the virtual reserves, the quantity
    /// pump.fun prices every trade on.
    pub fn price_q64(&self) -> Result<u128> {
        crate::math::price_q64(self.virtual_quote_reserves, self.virtual_token_reserves)
    }
}

/// Prefix of PumpSwap's `Pool` account.
pub struct Pool {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    pub coin_creator: Pubkey,
}

impl Pool {
    pub fn load(info: &AccountInfo) -> Result<Self> {
        require_keys_eq!(*info.owner, PUMP_AMM_PROGRAM_ID, MoshError::InvalidVenueAccount);
        let data = info.try_borrow_data()?;
        require!(data.len() >= 243 && data[..8] == POOL_DISC, MoshError::InvalidVenueAccount);
        let pk = |at: usize| Pubkey::new_from_array(data[at..at + 32].try_into().unwrap());
        // 8 disc + 1 pool_bump + 2 index + 32 creator
        Ok(Self {
            base_mint: pk(43),
            quote_mint: pk(75),
            pool_base_token_account: pk(139),
            pool_quote_token_account: pk(171),
            coin_creator: pk(211),
        })
    }
}

/// Whether `info` is an initialised SPL Token account (owner and size, never the balance:
/// anyone can send lamports to an address that does not exist yet).
pub fn is_token_account(info: &AccountInfo) -> bool {
    *info.owner == spl_token::ID && info.data_len() == SPL_TOKEN_ACCOUNT_LEN
}

/// Balance of an SPL Token account read straight from its data.
pub fn token_amount(info: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*info.owner, spl_token::ID, MoshError::InvalidVenueAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() == SPL_TOKEN_ACCOUNT_LEN, MoshError::InvalidVenueAccount);
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

// ---------------- instruction data ----------------

fn put_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

fn with_disc(disc: [u8; 8], cap: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(8 + cap);
    v.extend_from_slice(&disc);
    v
}

pub fn create_data(name: &str, symbol: &str, uri: &str, creator: &Pubkey) -> Vec<u8> {
    let mut v = with_disc(IX_CREATE, 44 + name.len() + symbol.len() + uri.len());
    put_str(&mut v, name);
    put_str(&mut v, symbol);
    put_str(&mut v, uri);
    v.extend_from_slice(creator.as_ref());
    v
}

/// `buy(amount, max_sol_cost, track_volume = false)`: exact tokens out.
pub fn buy_data(amount: u64, max_sol_cost: u64) -> Vec<u8> {
    let mut v = with_disc(IX_BUY, 17);
    v.extend_from_slice(&amount.to_le_bytes());
    v.extend_from_slice(&max_sol_cost.to_le_bytes());
    v.push(0);
    v
}

/// `buy_exact_sol_in(spendable_sol_in, min_tokens_out, track_volume = false)`.
pub fn buy_exact_sol_in_data(spendable_sol_in: u64, min_tokens_out: u64) -> Vec<u8> {
    let mut v = with_disc(IX_BUY_EXACT_SOL_IN, 17);
    v.extend_from_slice(&spendable_sol_in.to_le_bytes());
    v.extend_from_slice(&min_tokens_out.to_le_bytes());
    v.push(0);
    v
}

pub fn sell_data(amount: u64, min_sol_output: u64) -> Vec<u8> {
    let mut v = with_disc(IX_SELL, 16);
    v.extend_from_slice(&amount.to_le_bytes());
    v.extend_from_slice(&min_sol_output.to_le_bytes());
    v
}

pub fn collect_creator_fee_data() -> Vec<u8> {
    IX_COLLECT_CREATOR_FEE.to_vec()
}

/// PumpSwap `buy_exact_quote_in(spendable_quote_in, min_base_amount_out, track_volume = false)`.
pub fn amm_buy_exact_quote_in_data(spendable_quote_in: u64, min_base_amount_out: u64) -> Vec<u8> {
    let mut v = with_disc(IX_AMM_BUY_EXACT_QUOTE_IN, 17);
    v.extend_from_slice(&spendable_quote_in.to_le_bytes());
    v.extend_from_slice(&min_base_amount_out.to_le_bytes());
    v.push(0);
    v
}

pub fn amm_sell_data(base_amount_in: u64, min_quote_amount_out: u64) -> Vec<u8> {
    let mut v = with_disc(IX_AMM_SELL, 16);
    v.extend_from_slice(&base_amount_in.to_le_bytes());
    v.extend_from_slice(&min_quote_amount_out.to_le_bytes());
    v
}

pub fn amm_collect_coin_creator_fee_data() -> Vec<u8> {
    IX_AMM_COLLECT_COIN_CREATOR_FEE.to_vec()
}

// ---------------- venue account layouts (remaining accounts) ----------------

/// Accounts a pump.fun bonding-curve `buy` / `sell` needs beyond the mint, the user, its token
/// account, the system and token programs. Sells skip the two volume accumulators. The last
/// two are what pump.fun reads from its remaining accounts since its April 2026 upgrade.
pub mod curve {
    pub const GLOBAL: usize = 0;
    pub const FEE_RECIPIENT: usize = 1;
    pub const BONDING_CURVE: usize = 2;
    pub const ASSOCIATED_BONDING_CURVE: usize = 3;
    pub const CREATOR_VAULT: usize = 4;
    pub const EVENT_AUTHORITY: usize = 5;
    pub const PROGRAM: usize = 6;
    pub const GLOBAL_VOLUME_ACCUMULATOR: usize = 7;
    pub const USER_VOLUME_ACCUMULATOR: usize = 8;
    pub const FEE_CONFIG: usize = 9;
    pub const FEE_PROGRAM: usize = 10;
    /// `[bonding-curve-v2, mint]` on pump.fun.
    pub const BONDING_CURVE_V2: usize = 11;
    /// One of `Global.buyback_fee_recipients`.
    pub const BUYBACK_FEE_RECIPIENT: usize = 12;
    pub const LEN: usize = 13;
}

/// Accounts a PumpSwap `buy_exact_quote_in` / `sell` needs beyond the base mint, the user, its
/// base token account, the system and token programs. The last three are PumpSwap's remaining
/// accounts since its April 2026 upgrade.
pub mod pool {
    pub const POOL: usize = 0;
    pub const GLOBAL_CONFIG: usize = 1;
    pub const WSOL_MINT: usize = 2;
    /// WSOL ATA of the pump authority; created and closed inside the instruction.
    pub const USER_WSOL: usize = 3;
    pub const POOL_BASE: usize = 4;
    pub const POOL_QUOTE: usize = 5;
    pub const PROTOCOL_FEE_RECIPIENT: usize = 6;
    pub const PROTOCOL_FEE_RECIPIENT_ATA: usize = 7;
    pub const ASSOCIATED_TOKEN_PROGRAM: usize = 8;
    pub const EVENT_AUTHORITY: usize = 9;
    pub const PROGRAM: usize = 10;
    pub const COIN_CREATOR_VAULT_ATA: usize = 11;
    pub const COIN_CREATOR_VAULT_AUTHORITY: usize = 12;
    pub const GLOBAL_VOLUME_ACCUMULATOR: usize = 13;
    pub const USER_VOLUME_ACCUMULATOR: usize = 14;
    pub const FEE_CONFIG: usize = 15;
    pub const FEE_PROGRAM: usize = 16;
    /// `[pool-v2, base mint]` on PumpSwap.
    pub const POOL_V2: usize = 17;
    /// One of `GlobalConfig.buyback_fee_recipients` and its WSOL ATA.
    pub const BUYBACK_FEE_RECIPIENT: usize = 18;
    pub const BUYBACK_FEE_RECIPIENT_ATA: usize = 19;
    pub const LEN: usize = 20;
}

/// The fixed accounts every venue trade shares.
pub struct Trader<'a, 'info> {
    pub mint: &'a AccountInfo<'info>,
    pub user: &'a AccountInfo<'info>,
    pub user_tokens: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    /// The launch account, appended (writable, unused by the venue) to every venue CPI: the
    /// runtime syncs a CPI's accounts from the caller's view before the call and checks that
    /// the caller's lamport sum didn't change, so lamports this program moved off the launch
    /// directly must be visible there.
    pub launch: &'a AccountInfo<'info>,
}

fn meta(info: &AccountInfo, writable: bool, signer: bool) -> AccountMeta {
    if writable {
        AccountMeta::new(info.key(), signer)
    } else {
        AccountMeta::new_readonly(info.key(), signer)
    }
}

/// pump.fun `buy` / `buy_exact_sol_in` / `sell` with `data`; `r` is the `curve` layout.
pub fn curve_trade<'info>(
    t: &Trader<'_, 'info>,
    r: &[AccountInfo<'info>],
    data: Vec<u8>,
    is_buy: bool,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    require!(r.len() >= curve::LEN, MoshError::InvalidVenueAccount);
    require_keys_eq!(r[curve::PROGRAM].key(), PUMP_PROGRAM_ID, MoshError::InvalidVenueAccount);
    let mut accounts = vec![
        meta(&r[curve::GLOBAL], false, false),
        meta(&r[curve::FEE_RECIPIENT], true, false),
        meta(t.mint, false, false),
        meta(&r[curve::BONDING_CURVE], true, false),
        meta(&r[curve::ASSOCIATED_BONDING_CURVE], true, false),
        meta(t.user_tokens, true, false),
        meta(t.user, true, true),
        meta(t.system_program, false, false),
    ];
    if is_buy {
        accounts.push(meta(t.token_program, false, false));
        accounts.push(meta(&r[curve::CREATOR_VAULT], true, false));
    } else {
        accounts.push(meta(&r[curve::CREATOR_VAULT], true, false));
        accounts.push(meta(t.token_program, false, false));
    }
    accounts.push(meta(&r[curve::EVENT_AUTHORITY], false, false));
    accounts.push(meta(&r[curve::PROGRAM], false, false));
    if is_buy {
        accounts.push(meta(&r[curve::GLOBAL_VOLUME_ACCUMULATOR], false, false));
        accounts.push(meta(&r[curve::USER_VOLUME_ACCUMULATOR], true, false));
    }
    accounts.push(meta(&r[curve::FEE_CONFIG], false, false));
    accounts.push(meta(&r[curve::FEE_PROGRAM], false, false));
    accounts.push(meta(&r[curve::BONDING_CURVE_V2], false, false));
    accounts.push(meta(&r[curve::BUYBACK_FEE_RECIPIENT], true, false));
    accounts.push(meta(t.launch, true, false));

    let mut infos: Vec<AccountInfo<'info>> = Vec::with_capacity(17);
    infos.extend_from_slice(&r[..curve::LEN]);
    infos.push(t.mint.clone());
    infos.push(t.user_tokens.clone());
    infos.push(t.user.clone());
    infos.push(t.system_program.clone());
    infos.push(t.token_program.clone());
    infos.push(t.launch.clone());
    invoke_signed(
        &Instruction { program_id: PUMP_PROGRAM_ID, accounts, data },
        &infos,
        &[signer_seeds],
    )?;
    Ok(())
}

/// pump.fun and PumpSwap create a buyer's volume accumulator on its first buy with the buyer
/// paying the rent; that would come out of the launch's SOL (or an agent wallet's own balance),
/// so the signer fronting rent creates it first (once per buyer and venue) when it is missing —
/// missing meaning not owned by the venue, as anyone can send lamports to the address (the
/// venue's init tops a funded address up). `r` is the `curve` layout, or `pool` if `graduated`.
pub fn ensure_volume_accumulator<'info>(
    user: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    r: &[AccountInfo<'info>],
    graduated: bool,
) -> Result<()> {
    let (program_id, uva, event_authority, program) = if graduated {
        (PUMP_AMM_PROGRAM_ID, &r[pool::USER_VOLUME_ACCUMULATOR], &r[pool::EVENT_AUTHORITY], &r[pool::PROGRAM])
    } else {
        (PUMP_PROGRAM_ID, &r[curve::USER_VOLUME_ACCUMULATOR], &r[curve::EVENT_AUTHORITY], &r[curve::PROGRAM])
    };
    if *uva.owner == program_id {
        return Ok(());
    }
    require_keys_eq!(program.key(), program_id, MoshError::InvalidVenueAccount);
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(user.key(), false),
            AccountMeta::new(uva.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(event_authority.key(), false),
            AccountMeta::new_readonly(program_id, false),
        ],
        data: IX_INIT_USER_VOLUME_ACCUMULATOR.to_vec(),
    };
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[payer.clone(), user.clone(), uva.clone(), system_program.clone(), event_authority.clone(), program.clone()],
    )?;
    Ok(())
}

/// PumpSwap `buy_exact_quote_in` / `sell` with `data`; `r` is the `pool` layout.
pub fn pool_trade<'info>(
    t: &Trader<'_, 'info>,
    r: &[AccountInfo<'info>],
    data: Vec<u8>,
    is_buy: bool,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    require!(r.len() >= pool::LEN, MoshError::InvalidVenueAccount);
    require_keys_eq!(r[pool::PROGRAM].key(), PUMP_AMM_PROGRAM_ID, MoshError::InvalidVenueAccount);
    let mut accounts = vec![
        meta(&r[pool::POOL], true, false),
        meta(t.user, true, true),
        meta(&r[pool::GLOBAL_CONFIG], false, false),
        meta(t.mint, false, false),
        meta(&r[pool::WSOL_MINT], false, false),
        meta(t.user_tokens, true, false),
        meta(&r[pool::USER_WSOL], true, false),
        meta(&r[pool::POOL_BASE], true, false),
        meta(&r[pool::POOL_QUOTE], true, false),
        meta(&r[pool::PROTOCOL_FEE_RECIPIENT], false, false),
        meta(&r[pool::PROTOCOL_FEE_RECIPIENT_ATA], true, false),
        meta(t.token_program, false, false),
        meta(t.token_program, false, false),
        meta(t.system_program, false, false),
        meta(&r[pool::ASSOCIATED_TOKEN_PROGRAM], false, false),
        meta(&r[pool::EVENT_AUTHORITY], false, false),
        meta(&r[pool::PROGRAM], false, false),
        meta(&r[pool::COIN_CREATOR_VAULT_ATA], true, false),
        meta(&r[pool::COIN_CREATOR_VAULT_AUTHORITY], false, false),
    ];
    if is_buy {
        accounts.push(meta(&r[pool::GLOBAL_VOLUME_ACCUMULATOR], false, false));
        accounts.push(meta(&r[pool::USER_VOLUME_ACCUMULATOR], true, false));
    }
    accounts.push(meta(&r[pool::FEE_CONFIG], false, false));
    accounts.push(meta(&r[pool::FEE_PROGRAM], false, false));
    accounts.push(meta(&r[pool::POOL_V2], false, false));
    accounts.push(meta(&r[pool::BUYBACK_FEE_RECIPIENT], false, false));
    accounts.push(meta(&r[pool::BUYBACK_FEE_RECIPIENT_ATA], true, false));
    accounts.push(meta(t.launch, true, false));

    let mut infos: Vec<AccountInfo<'info>> = Vec::with_capacity(23);
    infos.extend_from_slice(&r[..pool::LEN]);
    infos.push(t.mint.clone());
    infos.push(t.user_tokens.clone());
    infos.push(t.user.clone());
    infos.push(t.system_program.clone());
    infos.push(t.token_program.clone());
    infos.push(t.launch.clone());
    invoke_signed(
        &Instruction { program_id: PUMP_AMM_PROGRAM_ID, accounts, data },
        &infos,
        &[signer_seeds],
    )?;
    Ok(())
}
