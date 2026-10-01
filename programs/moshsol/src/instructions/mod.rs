pub mod agent;
pub mod create_launch;
pub mod fees;
pub mod launch_token;
pub mod migrate;
pub mod platform;
pub mod pump_agent;
pub mod pump_fees;
pub mod pump_launch;
pub mod pump_venue;
pub mod raise;
pub mod trade;
pub mod vault;

pub use agent::*;
pub use create_launch::*;
pub use fees::*;
pub use launch_token::*;
pub use migrate::*;
pub use platform::*;
pub use pump_agent::*;
pub use pump_fees::*;
pub use pump_launch::*;
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
