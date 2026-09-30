use anchor_lang::prelude::*;

use crate::constants::BPS;
use crate::errors::MoshError;

pub fn bps(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(MoshError::MathOverflow)?
        / BPS as u128;
    Ok(v as u64)
}

/// `bps` rounded up; used for trade fees so no trade, however small, is fee-free.
pub fn bps_ceil(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(MoshError::MathOverflow)?
        .div_ceil(BPS as u128);
    Ok(v as u64)
}

/// Tokens received for `sol_in` lamports on a constant-product curve (x = sol, y = tokens).
/// Floors, so k never decreases.
pub fn tokens_out(x: u64, y: u64, sol_in: u64) -> Result<u64> {
    let num = (y as u128).checked_mul(sol_in as u128).ok_or(MoshError::MathOverflow)?;
    let den = (x as u128).checked_add(sol_in as u128).ok_or(MoshError::MathOverflow)?;
    Ok((num / den) as u64)
}

/// Lamports received for `tokens_in` on the curve. Floors, so k never decreases.
pub fn sol_out(x: u64, y: u64, tokens_in: u64) -> Result<u64> {
    let num = (x as u128).checked_mul(tokens_in as u128).ok_or(MoshError::MathOverflow)?;
    let den = (y as u128).checked_add(tokens_in as u128).ok_or(MoshError::MathOverflow)?;
    Ok((num / den) as u64)
}

/// Lamports needed to buy exactly `tokens` (ceil). Requires tokens < y.
pub fn sol_in_for_tokens(x: u64, y: u64, tokens: u64) -> Result<u64> {
    require!(tokens < y, MoshError::InsufficientLiquidity);
    let num = (x as u128).checked_mul(tokens as u128).ok_or(MoshError::MathOverflow)?;
    let den = (y - tokens) as u128;
    Ok(num.div_ceil(den) as u64)
}

/// Spot price as Q64.64 lamports per token base unit.
pub fn price_q64(x: u64, y: u64) -> Result<u128> {
    require!(y > 0, MoshError::InsufficientLiquidity);
    Ok(((x as u128) << 64) / y as u128)
}

/// |after - before| / before in bps, rounded up.
pub fn move_bps(before: u128, after: u128) -> u64 {
    if before == 0 {
        return u64::MAX;
    }
    let diff = before.abs_diff(after);
    // diff is at most ~2^64 * 2^40 here, safe to scale by 1e4
    let v = (diff.saturating_mul(BPS as u128)).div_ceil(before);
    v.min(u64::MAX as u128) as u64
}

/// Sorted-pair sha256 merkle proof verification for `leaf`.
pub fn verify_merkle(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut node = leaf;
    for sibling in proof {
        node = if node <= *sibling {
            anchor_lang::solana_program::hash::hashv(&[&node, sibling]).to_bytes()
        } else {
            anchor_lang::solana_program::hash::hashv(&[sibling, &node]).to_bytes()
        };
    }
    node == *root
}
