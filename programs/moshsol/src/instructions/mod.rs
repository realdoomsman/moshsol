pub mod agent;
pub mod create_launch;
pub mod fees;
pub mod launch_token;
pub mod platform;
pub mod raise;
pub mod trade;
pub mod vault;

pub use agent::*;
pub use create_launch::*;
pub use fees::*;
pub use launch_token::*;
pub use platform::*;
pub use raise::*;
pub use trade::*;
pub use vault::*;

use anchor_lang::prelude::*;

/// Moves lamports out of a program-owned account. Must run after any CPI in the instruction.
pub(crate) fn pay_out<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    from.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}
