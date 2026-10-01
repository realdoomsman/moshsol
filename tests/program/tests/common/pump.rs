//! pump.fun / PumpSwap side of the harness: the mainnet programs and config accounts from
//! `tests/program/fixtures` (refresh with `scripts/dump-pump-fixtures.sh`), PDAs, the venue
//! account lists, instruction helpers for the pump launch instructions, and public traders that
//! hit pump.fun / PumpSwap directly (what the agent's rules are measured against).

use anchor_lang::{system_program, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent;
use anchor_spl::associated_token::{get_associated_token_address, ID as ATA_ID};
use anchor_spl::token::spl_token;
use anchor_spl::token::ID as TOKEN_ID;
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use base64::Engine;
use moshsol::constants::*;
use moshsol::instructions::CreateLaunchPumpArgs;
use moshsol::pump::{
    self, MPL_TOKEN_METADATA_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID, WSOL_MINT,
};
use moshsol::state::{Launch, LaunchTerms};
use solana_sdk::account::Account;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::sysvar;

use super::*;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures");

/// pump.fun `Global.withdraw_authority`, the account `migrate` pays the migration fee to.
pub const PUMP_WITHDRAW_AUTHORITY: Pubkey = solana_sdk::pubkey!("39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg");

pub fn fixture_account(name: &str) -> (Pubkey, Account) {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{FIXTURES}/{name}.json")).unwrap()).unwrap();
    let pubkey: Pubkey = json["pubkey"].as_str().unwrap().parse().unwrap();
    let a = &json["account"];
    let data = base64::engine::general_purpose::STANDARD
        .decode(a["data"][0].as_str().unwrap())
        .unwrap();
    let account = Account {
        lamports: a["lamports"].as_u64().unwrap(),
        data,
        owner: a["owner"].as_str().unwrap().parse().unwrap(),
        executable: a["executable"].as_bool().unwrap_or(false),
        rent_epoch: 0,
    };
    (pubkey, account)
}

// ---------------- PDAs ----------------

pub fn pump_authority_pda(launch: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PUMP_AUTHORITY_SEED, launch.as_ref()], &moshsol::ID).0
}
pub fn spl_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address(owner, mint)
}
fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}
pub fn pump_global() -> Pubkey {
    pda(&[b"global"], &PUMP_PROGRAM_ID)
}
pub fn pump_event_authority() -> Pubkey {
    pda(&[b"__event_authority"], &PUMP_PROGRAM_ID)
}
pub fn pump_mint_authority() -> Pubkey {
    pda(&[b"mint-authority"], &PUMP_PROGRAM_ID)
}
pub fn pump_gva() -> Pubkey {
    pda(&[b"global_volume_accumulator"], &PUMP_PROGRAM_ID)
}
pub fn pump_uva(user: &Pubkey) -> Pubkey {
    pda(&[b"user_volume_accumulator", user.as_ref()], &PUMP_PROGRAM_ID)
}
pub fn creator_vault(creator: &Pubkey) -> Pubkey {
    pda(&[b"creator-vault", creator.as_ref()], &PUMP_PROGRAM_ID)
}
pub fn fee_config(program: &Pubkey) -> Pubkey {
    pda(&[b"fee_config", program.as_ref()], &PUMP_FEE_PROGRAM_ID)
}
pub fn metadata_pda(mint: &Pubkey) -> Pubkey {
    pda(&[b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), mint.as_ref()], &MPL_TOKEN_METADATA_ID)
}
pub fn amm_global_config() -> Pubkey {
    pda(&[b"global_config"], &PUMP_AMM_PROGRAM_ID)
}
pub fn amm_event_authority() -> Pubkey {
    pda(&[b"__event_authority"], &PUMP_AMM_PROGRAM_ID)
}
pub fn amm_gva() -> Pubkey {
    pda(&[b"global_volume_accumulator"], &PUMP_AMM_PROGRAM_ID)
}
pub fn amm_uva(user: &Pubkey) -> Pubkey {
    pda(&[b"user_volume_accumulator", user.as_ref()], &PUMP_AMM_PROGRAM_ID)
}
pub fn amm_creator_vault_authority(creator: &Pubkey) -> Pubkey {
    pda(&[b"creator_vault", creator.as_ref()], &PUMP_AMM_PROGRAM_ID)
}
pub fn lp_mint(pool: &Pubkey) -> Pubkey {
    pda(&[b"pool_lp_mint", pool.as_ref()], &PUMP_AMM_PROGRAM_ID)
}
pub fn bonding_curve_v2(mint: &Pubkey) -> Pubkey {
    pda(&[b"bonding-curve-v2", mint.as_ref()], &PUMP_PROGRAM_ID)
}
pub fn pool_v2(mint: &Pubkey) -> Pubkey {
    pda(&[b"pool-v2", mint.as_ref()], &PUMP_AMM_PROGRAM_ID)
}
pub fn boost_vault_authority(pool: &Pubkey) -> Pubkey {
    pda(&[b"boost_vault", pool.as_ref()], &PUMP_AMM_PROGRAM_ID)
}

/// Decoded prefix of a pump.fun bonding curve.
pub struct Curve {
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub complete: bool,
    pub creator: Pubkey,
}

pub fn curve_price_q64(c: &Curve) -> u128 {
    moshsol::math::price_q64(c.virtual_sol_reserves, c.virtual_token_reserves).unwrap()
}

/// Remaining accounts of a bonding-curve trade on `mint` (created by `creator`) by `launch`'s
/// pump authority.
pub fn curve_accounts(
    mint: &Pubkey,
    creator: &Pubkey,
    launch: &Pubkey,
    fee_recipient: &Pubkey,
    buyback_fee_recipient: &Pubkey,
) -> Vec<AccountMeta> {
    let curve = pump::bonding_curve_pda(mint);
    let user = pump_authority_pda(launch);
    vec![
        AccountMeta::new_readonly(pump_global(), false),
        AccountMeta::new(*fee_recipient, false),
        AccountMeta::new(curve, false),
        AccountMeta::new(spl_ata(&curve, mint), false),
        AccountMeta::new(creator_vault(creator), false),
        AccountMeta::new_readonly(pump_event_authority(), false),
        AccountMeta::new_readonly(PUMP_PROGRAM_ID, false),
        AccountMeta::new_readonly(pump_gva(), false),
        AccountMeta::new(pump_uva(&user), false),
        AccountMeta::new_readonly(fee_config(&PUMP_PROGRAM_ID), false),
        AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
        AccountMeta::new_readonly(bonding_curve_v2(mint), false),
        AccountMeta::new(*buyback_fee_recipient, false),
    ]
}

/// Remaining accounts of a PumpSwap trade by `launch`'s pump authority on `mint`'s pool.
pub fn pool_accounts(
    mint: &Pubkey,
    coin_creator: &Pubkey,
    launch: &Pubkey,
    protocol_fee_recipient: &Pubkey,
    buyback_fee_recipient: &Pubkey,
) -> Vec<AccountMeta> {
    let pool = pump::pool_pda(mint);
    let user = pump_authority_pda(launch);
    let cva = amm_creator_vault_authority(coin_creator);
    vec![
        AccountMeta::new(pool, false),
        AccountMeta::new_readonly(amm_global_config(), false),
        AccountMeta::new_readonly(WSOL_MINT, false),
        AccountMeta::new(spl_ata(&user, &WSOL_MINT), false),
        AccountMeta::new(spl_ata(&pool, mint), false),
        AccountMeta::new(spl_ata(&pool, &WSOL_MINT), false),
        AccountMeta::new_readonly(*protocol_fee_recipient, false),
        AccountMeta::new(spl_ata(protocol_fee_recipient, &WSOL_MINT), false),
        AccountMeta::new_readonly(ATA_ID, false),
        AccountMeta::new_readonly(amm_event_authority(), false),
        AccountMeta::new_readonly(PUMP_AMM_PROGRAM_ID, false),
        AccountMeta::new(spl_ata(&cva, &WSOL_MINT), false),
        AccountMeta::new_readonly(cva, false),
        AccountMeta::new_readonly(amm_gva(), false),
        AccountMeta::new(amm_uva(&user), false),
        AccountMeta::new_readonly(fee_config(&PUMP_AMM_PROGRAM_ID), false),
        AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
        AccountMeta::new_readonly(pool_v2(mint), false),
        AccountMeta::new_readonly(*buyback_fee_recipient, false),
        AccountMeta::new(spl_ata(buyback_fee_recipient, &WSOL_MINT), false),
    ]
}

pub fn collect_pool_accounts(launch: &Pubkey) -> Vec<AccountMeta> {
    let cva = amm_creator_vault_authority(launch);
    vec![
        AccountMeta::new_readonly(WSOL_MINT, false),
        AccountMeta::new_readonly(cva, false),
        AccountMeta::new(spl_ata(&cva, &WSOL_MINT), false),
        AccountMeta::new(spl_ata(launch, &WSOL_MINT), false),
        AccountMeta::new_readonly(amm_event_authority(), false),
        AccountMeta::new_readonly(PUMP_AMM_PROGRAM_ID, false),
        AccountMeta::new_readonly(ATA_ID, false),
    ]
}

pub fn default_pump_args() -> CreateLaunchPumpArgs {
    let params = test_params();
    CreateLaunchPumpArgs {
        name: "Pump Dog".into(),
        symbol: "PDOG".into(),
        uri: "https://example.com/pdog.json".into(),
        raise_min: 10 * SOL,
        raise_max: 50 * SOL,
        max_per_wallet: 0,
        duration_secs: 3_600,
        whitelist_root: [0u8; 32],
        bundle_supply_bps: 2_000,
        reserve_bps: 3_000,
        expected_terms: LaunchTerms::pump(&params),
        max_create_fee_lamports: params.create_fee_lamports,
    }
}

impl Env {
    /// Loads pump.fun, PumpSwap, the fee program, Metaplex token metadata and their config
    /// accounts from the fixtures, funds the fee recipients (a system account can't receive a
    /// rent-paying balance) and sets the WSOL token accounts PumpSwap's protocol fee needs.
    pub fn with_pump(&mut self) {
        for (name, id) in [
            ("pump", PUMP_PROGRAM_ID),
            ("pump_amm", PUMP_AMM_PROGRAM_ID),
            ("pump_fee", PUMP_FEE_PROGRAM_ID),
            ("mpl_token_metadata", MPL_TOKEN_METADATA_ID),
        ] {
            self.svm
                .add_program_from_file(id, format!("{FIXTURES}/{name}.so"))
                .expect("fixture program; run scripts/dump-pump-fixtures.sh");
        }
        for name in [
            "pump_global",
            "pump_global_volume_accumulator",
            "pump_fee_config",
            "amm_fee_config",
            "amm_global_config",
            "amm_global_volume_accumulator",
            "wsol_mint",
        ] {
            let (k, a) = fixture_account(name);
            self.svm.set_account(k, a).unwrap();
        }
        for k in [
            self.pump_fee_recipient(),
            self.amm_protocol_fee_recipient(),
            self.buyback_fee_recipient(),
            PUMP_WITHDRAW_AUTHORITY,
        ] {
            if self.lamports(&k) == 0 {
                self.svm.airdrop(&k, SOL).unwrap();
            }
        }
        // PumpSwap sends protocol fees to the recipient's WSOL ATA, which must already exist.
        let payer = self.admin.insecure_clone();
        let pfr = self.amm_protocol_fee_recipient();
        self.create_spl_ata(&payer, &pfr, &WSOL_MINT);
        let bfr = self.buyback_fee_recipient();
        self.create_spl_ata(&payer, &bfr, &WSOL_MINT);
    }

    /// First of pump.fun `Global.buyback_fee_recipients` (the same list PumpSwap uses).
    pub fn buyback_fee_recipient(&self) -> Pubkey {
        let g = self.svm.get_account(&pump_global()).unwrap().data;
        Pubkey::new_from_array(g[741..773].try_into().unwrap())
    }

    /// pump.fun `Global.fee_recipient`.
    pub fn pump_fee_recipient(&self) -> Pubkey {
        let g = self.svm.get_account(&pump_global()).unwrap().data;
        Pubkey::new_from_array(g[41..73].try_into().unwrap())
    }

    /// First of PumpSwap `GlobalConfig.protocol_fee_recipients`.
    pub fn amm_protocol_fee_recipient(&self) -> Pubkey {
        let g = self.svm.get_account(&amm_global_config()).unwrap().data;
        Pubkey::new_from_array(g[57..89].try_into().unwrap())
    }

    /// Rewrites pump.fun's fee config so curve trades pay `protocol_bps` on top of the 0.3%
    /// creator fee (mainnet today: 0.95% + 0.3%); lets a test make the venue keep more of a
    /// fill than the program's 97% floor allows.
    pub fn set_pump_protocol_fee_bps(&mut self, protocol_bps: u64) {
        let key = fee_config(&PUMP_PROGRAM_ID);
        let mut a = self.svm.get_account(&key).unwrap();
        // FeeConfig { bump, admin, flat_fees: Fees { lp, protocol, creator }, fee_tiers:
        // Vec<FeeTier { market_cap_lamports_threshold: u128, fees: Fees }> } behind the
        // discriminator; the fixture has one tier.
        const FLAT_PROTOCOL: usize = 8 + 1 + 32 + 8;
        const TIER0_PROTOCOL: usize = 8 + 1 + 32 + 24 + 4 + 16 + 8;
        assert_eq!(u32::from_le_bytes(a.data[65..69].try_into().unwrap()), 1, "one fee tier in the fixture");
        for at in [FLAT_PROTOCOL, TIER0_PROTOCOL] {
            a.data[at..at + 8].copy_from_slice(&protocol_bps.to_le_bytes());
        }
        self.svm.set_account(key, a).unwrap();
    }

    pub fn curve(&self, mint: &Pubkey) -> Curve {
        let d = self.svm.get_account(&pump::bonding_curve_pda(mint)).unwrap().data;
        let u = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
        Curve {
            virtual_token_reserves: u(8),
            virtual_sol_reserves: u(16),
            real_token_reserves: u(24),
            real_sol_reserves: u(32),
            complete: d[48] != 0,
            creator: Pubkey::new_from_array(d[49..81].try_into().unwrap()),
        }
    }

    pub fn spl_balance(&self, account: &Pubkey) -> u64 {
        match self.svm.get_account(account) {
            Some(a) if a.data.len() == 165 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            _ => 0,
        }
    }

    pub fn spl_mint_supply(&self, mint: &Pubkey) -> u64 {
        let d = self.svm.get_account(mint).unwrap().data;
        u64::from_le_bytes(d[36..44].try_into().unwrap())
    }

    pub fn create_spl_ata(&mut self, payer: &Keypair, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let ix = create_associated_token_account_idempotent(&payer.pubkey(), owner, mint, &TOKEN_ID);
        ok(self.send(&[ix], &[payer]));
        spl_ata(owner, mint)
    }

    /// Launch account by address (pump launches are keyed by their create key, not a mint).
    pub fn launch_at(&self, launch: &Pubkey) -> Launch {
        let a = self.svm.get_account(launch).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    /// Launch lamports == rent + every tracked bucket (incl. the buyback pool), the vault ATA holds
    /// exactly `vault_tokens`, and the pump authority never keeps lamports between instructions.
    pub fn assert_pump_invariants(&self, launch: &Pubkey) {
        let l = self.launch_at(launch);
        let acct = self.svm.get_account(launch).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(acct.lamports, rent + l.owed_lamports(), "launch lamport accounting");
        let authority = pump_authority_pda(launch);
        assert_eq!(self.lamports(&authority), 0, "pump authority holds no lamports at rest");
        if l.mint != Pubkey::default() {
            assert_eq!(self.spl_balance(&spl_ata(&authority, &l.mint)), l.vault_tokens, "vault tokens");
        }
    }

    // ---------------- Holdfast pump instructions ----------------

    pub fn create_pump(&mut self, creator: &Keypair, mut args: CreateLaunchPumpArgs) -> (Pubkey, TxResult) {
        let params = self.platform().params;
        args.expected_terms = LaunchTerms::pump(&params);
        args.max_create_fee_lamports = params.create_fee_lamports;
        self.create_pump_raw(creator, args)
    }

    pub fn create_pump_raw(&mut self, creator: &Keypair, args: CreateLaunchPumpArgs) -> (Pubkey, TxResult) {
        let create_key = Keypair::new();
        let launch = launch_pda(&create_key.pubkey());
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::CreateLaunchPump {
                creator: creator.pubkey(),
                platform: platform_pda(),
                fee_recipient: self.fee_recipient.pubkey(),
                create_key: create_key.pubkey(),
                launch,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::CreateLaunchPump { args }.data(),
        };
        let res = self.send(&[ix], &[creator, &create_key]);
        (launch, res)
    }

    pub fn create_pump_ok(&mut self, creator: &Keypair, args: CreateLaunchPumpArgs) -> Pubkey {
        let (launch, res) = self.create_pump(creator, args);
        ok(res);
        launch
    }

    /// Deposits into a launch by address (the shared instructions key the PDA by `create_key`).
    pub fn deposit_at(&mut self, owner: &Keypair, launch: &Pubkey, amount: u64) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::Deposit {
                owner: owner.pubkey(),
                platform: platform_pda(),
                launch: *launch,
                backer: backer_pda(launch, &owner.pubkey()),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::Deposit { amount, proof: vec![] }.data(),
        };
        self.send(&[ix], &[owner])
    }

    pub fn claim_backer_at(&mut self, owner: &Keypair, launch: &Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::ClaimBackerFees {
                owner: owner.pubkey(),
                launch: *launch,
                backer: backer_pda(launch, &owner.pubkey()),
            }
            .to_account_metas(None),
            data: moshsol::instruction::ClaimBackerFees {}.data(),
        };
        self.send(&[ix], &[owner])
    }

    pub fn launch_pump_ix(&self, cranker: &Pubkey, launch: &Pubkey, mint: &Pubkey) -> Instruction {
        let authority = pump_authority_pda(launch);
        let curve = pump::bonding_curve_pda(mint);
        Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::LaunchPump {
                cranker: *cranker,
                launch: *launch,
                pump_authority: authority,
                mint: *mint,
                mint_authority: pump_mint_authority(),
                bonding_curve: curve,
                associated_bonding_curve: spl_ata(&curve, mint),
                global: pump_global(),
                mpl_token_metadata: MPL_TOKEN_METADATA_ID,
                metadata: metadata_pda(mint),
                event_authority: pump_event_authority(),
                pump_program: PUMP_PROGRAM_ID,
                vault_tokens: spl_ata(&authority, mint),
                fee_recipient: self.pump_fee_recipient(),
                creator_vault: creator_vault(launch),
                global_volume_accumulator: pump_gva(),
                user_volume_accumulator: pump_uva(&authority),
                fee_config: fee_config(&PUMP_PROGRAM_ID),
                fee_program: PUMP_FEE_PROGRAM_ID,
                bonding_curve_v2: bonding_curve_v2(mint),
                buyback_fee_recipient: self.buyback_fee_recipient(),
                token_program: TOKEN_ID,
                associated_token_program: ATA_ID,
                system_program: system_program::ID,
                rent: sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::LaunchPump {}.data(),
        }
    }

    /// Launches with a fresh ephemeral mint keypair; returns (mint, result).
    pub fn launch_pump(&mut self, cranker: &Keypair, launch: &Pubkey) -> (Pubkey, TxResult) {
        let mint = Keypair::new();
        let ix = self.launch_pump_ix(&cranker.pubkey(), launch, &mint.pubkey());
        let res = self.send(&[ix], &[cranker, &mint]);
        (mint.pubkey(), res)
    }

    fn pump_agent_accounts(&self, agent: &Pubkey, launch: &Pubkey) -> Vec<AccountMeta> {
        let l = self.launch_at(launch);
        let authority = pump_authority_pda(launch);
        let mut metas = moshsol::accounts::AgentTradePump {
            agent: *agent,
            platform: platform_pda(),
            launch: *launch,
            mint: l.mint,
            pump_authority: authority,
            vault_tokens: spl_ata(&authority, &l.mint),
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        metas.extend(self.venue_accounts(launch));
        metas
    }

    /// The launch's current venue accounts (curve before graduation, pool after).
    pub fn venue_accounts(&self, launch: &Pubkey) -> Vec<AccountMeta> {
        let l = self.launch_at(launch);
        if l.pump.graduated {
            pool_accounts(&l.mint, launch, launch, &self.amm_protocol_fee_recipient(), &self.buyback_fee_recipient())
        } else {
            curve_accounts(&l.mint, launch, launch, &self.pump_fee_recipient(), &self.buyback_fee_recipient())
        }
    }

    pub fn agent_buy_pump_as(&mut self, agent: &Keypair, launch: &Pubkey, sol_in: u64, min_out: u64) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: self.pump_agent_accounts(&agent.pubkey(), launch),
            data: moshsol::instruction::AgentBuyPump { sol_in, min_tokens_out: min_out }.data(),
        };
        self.send(&[ix], &[agent])
    }

    pub fn agent_buy_pump(&mut self, launch: &Pubkey, sol_in: u64, min_out: u64) -> TxResult {
        let agent = self.agent.insecure_clone();
        self.agent_buy_pump_as(&agent, launch, sol_in, min_out)
    }

    pub fn agent_sell_pump(&mut self, launch: &Pubkey, tokens_in: u64, min_out: u64) -> TxResult {
        let agent = self.agent.insecure_clone();
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: self.pump_agent_accounts(&agent.pubkey(), launch),
            data: moshsol::instruction::AgentSellPump { tokens_in, min_sol_out: min_out }.data(),
        };
        self.send(&[ix], &[&agent])
    }

    pub fn collect_pump_fees(&mut self, cranker: &Keypair, launch: &Pubkey) -> TxResult {
        let l = self.launch_at(launch);
        let mut accounts = moshsol::accounts::CollectPumpFees {
            cranker: cranker.pubkey(),
            launch: *launch,
            creator_vault: creator_vault(launch),
            pump_event_authority: pump_event_authority(),
            pump_program: PUMP_PROGRAM_ID,
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        if l.pump.graduated {
            accounts.extend(collect_pool_accounts(launch));
        }
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts,
            data: moshsol::instruction::CollectPumpFees {}.data(),
        };
        self.send(&[ix], &[cranker])
    }

    /// `buyback_burn` as the agent authority (the only allowed cranker).
    pub fn buyback_burn(&mut self, launch: &Pubkey, buyback_mint: &Pubkey, max_sol: u64, min_tokens_out: u64) -> TxResult {
        let agent = self.agent.insecure_clone();
        self.buyback_burn_as(&agent, launch, buyback_mint, max_sol, min_tokens_out)
    }

    pub fn buyback_burn_as(
        &mut self,
        cranker: &Keypair,
        launch: &Pubkey,
        buyback_mint: &Pubkey,
        max_sol: u64,
        min_tokens_out: u64,
    ) -> TxResult {
        let authority = pump_authority_pda(launch);
        let mut accounts = moshsol::accounts::BuybackBurn {
            cranker: cranker.pubkey(),
            platform: platform_pda(),
            launch: *launch,
            pump_authority: authority,
            buyback_mint: *buyback_mint,
            burn_tokens: spl_ata(&authority, buyback_mint),
            buyback_curve: pump::bonding_curve_pda(buyback_mint),
            token_program: TOKEN_ID,
            associated_token_program: ATA_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let graduated = self
            .svm
            .get_account(&pump::bonding_curve_pda(buyback_mint))
            .map(|a| a.data.len() > 48 && a.data[48] != 0)
            .unwrap_or(false);
        if graduated {
            let creator = self.curve(buyback_mint).creator;
            accounts.extend(pool_accounts(
                buyback_mint,
                &creator,
                launch,
                &self.amm_protocol_fee_recipient(),
                &self.buyback_fee_recipient(),
            ));
        } else {
            let creator = self.curve(buyback_mint).creator;
            accounts.extend(curve_accounts(
                buyback_mint,
                &creator,
                launch,
                &self.pump_fee_recipient(),
                &self.buyback_fee_recipient(),
            ));
        }
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts,
            data: moshsol::instruction::BuybackBurn { max_sol, min_tokens_out }.data(),
        };
        self.send(&[ix], &[cranker])
    }

    pub fn graduate_pump(&mut self, payer: &Keypair, launch: &Pubkey) -> TxResult {
        let l = self.launch_at(launch);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::GraduatePump {
                launch: *launch,
                bonding_curve: pump::bonding_curve_pda(&l.mint),
                pool: pump::pool_pda(&l.mint),
            }
            .to_account_metas(None),
            data: moshsol::instruction::GraduatePump {}.data(),
        };
        self.send(&[ix], &[payer])
    }

    pub fn wind_down_pump(&mut self, cranker: &Keypair, launch: &Pubkey) -> TxResult {
        let l = self.launch_at(launch);
        let authority = pump_authority_pda(launch);
        let mut accounts = moshsol::accounts::WindDownPump {
            cranker: cranker.pubkey(),
            launch: *launch,
            mint: l.mint,
            pump_authority: authority,
            vault_tokens: spl_ata(&authority, &l.mint),
            token_program: TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(self.venue_accounts(launch));
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts,
            data: moshsol::instruction::WindDownPump {}.data(),
        };
        self.send(&[ix], &[cranker])
    }

    pub fn admin_withdraw_pump(&mut self, admin: &Keypair, launch: &Pubkey, sol: u64, tokens: u64) -> TxResult {
        let l = self.launch_at(launch);
        let fr = self.fee_recipient.pubkey();
        let recipient_tokens = self.create_spl_ata(admin, &fr, &l.mint);
        let authority = pump_authority_pda(launch);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::AdminWithdrawVault {
                admin: admin.pubkey(),
                platform: platform_pda(),
                launch: *launch,
                mint: l.mint,
                vault_tokens: spl_ata(&authority, &l.mint),
                fee_recipient: fr,
                recipient_tokens,
                token_authority: authority,
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::AdminWithdrawVault { sol, tokens }.data(),
        };
        self.send(&[ix], &[admin])
    }

    pub fn migrate_platform(&mut self, admin: &Keypair) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::MigratePlatform {
                admin: admin.pubkey(),
                platform: platform_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::MigratePlatform {}.data(),
        };
        self.send(&[ix], &[admin])
    }

    pub fn migrate_launch(&mut self, admin: &Keypair, launch: &Pubkey, initial_vault_sol: u64) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::MigrateLaunch {
                admin: admin.pubkey(),
                platform: platform_pda(),
                launch: *launch,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::MigrateLaunch { initial_vault_sol }.data(),
        };
        self.send(&[ix], &[admin])
    }

    pub fn payout_backers_as(&mut self, agent: &Keypair, launch: &Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::PayoutBackers {
                agent: agent.pubkey(),
                platform: platform_pda(),
                launch: *launch,
            }
            .to_account_metas(None),
            data: moshsol::instruction::PayoutBackers {}.data(),
        };
        self.send(&[ix], &[agent])
    }

    pub fn payout_backers(&mut self, launch: &Pubkey) -> TxResult {
        let agent = self.agent.insecure_clone();
        self.payout_backers_as(&agent, launch)
    }

    /// Rewrites a launch account by address (see `set_launch`).
    pub fn set_launch_at(&mut self, launch: &Pubkey, f: impl FnOnce(&mut Launch)) {
        let mut acct = self.svm.get_account(launch).unwrap();
        let mut l = self.launch_at(launch);
        f(&mut l);
        let mut data = Vec::with_capacity(acct.data.len());
        l.try_serialize(&mut data).unwrap();
        acct.data[..data.len()].copy_from_slice(&data);
        self.svm.set_account(*launch, acct).unwrap();
    }

    /// Creates a pump launch, funds it and launches it as the creator.
    pub fn live_pump_launch(&mut self, deposits: &[u64]) -> (Keypair, Pubkey, Pubkey, Vec<Keypair>) {
        let creator = self.user(10);
        let launch = self.create_pump_ok(&creator, default_pump_args());
        let mut backers = vec![];
        for d in deposits {
            let b = self.user(d / SOL + 2);
            ok(self.deposit_at(&b, &launch, *d));
            backers.push(b);
        }
        let (mint, res) = self.launch_pump(&creator, &launch);
        ok(res);
        (creator, launch, mint, backers)
    }

    // ---------------- public traders on the venues ----------------

    /// A wallet buys on the pump.fun curve with exactly `sol_in` lamports.
    pub fn pump_public_buy(&mut self, trader: &Keypair, mint: &Pubkey, sol_in: u64) -> TxResult {
        let ata = create_associated_token_account_idempotent(&trader.pubkey(), &trader.pubkey(), mint, &TOKEN_ID);
        let ix = self.pump_public_buy_ix(trader, mint, sol_in);
        self.send(&[ata, ix], &[trader])
    }

    fn pump_public_buy_ix(&self, trader: &Keypair, mint: &Pubkey, sol_in: u64) -> Instruction {
        let curve = pump::bonding_curve_pda(mint);
        let creator = self.curve(mint).creator;
        Instruction {
            program_id: PUMP_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(pump_global(), false),
                AccountMeta::new(self.pump_fee_recipient(), false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new(curve, false),
                AccountMeta::new(spl_ata(&curve, mint), false),
                AccountMeta::new(spl_ata(&trader.pubkey(), mint), false),
                AccountMeta::new(trader.pubkey(), true),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new_readonly(TOKEN_ID, false),
                AccountMeta::new(creator_vault(&creator), false),
                AccountMeta::new_readonly(pump_event_authority(), false),
                AccountMeta::new_readonly(PUMP_PROGRAM_ID, false),
                AccountMeta::new_readonly(pump_gva(), false),
                AccountMeta::new(pump_uva(&trader.pubkey()), false),
                AccountMeta::new_readonly(fee_config(&PUMP_PROGRAM_ID), false),
                AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
                AccountMeta::new_readonly(bonding_curve_v2(mint), false),
                AccountMeta::new(self.buyback_fee_recipient(), false),
            ],
            data: pump::buy_exact_sol_in_data(sol_in, 1),
        }
    }

    /// A wallet buys exactly `amount` tokens on the curve for at most `max_sol` (what buys the
    /// curve out: `buy_exact_sol_in` can't overshoot the real reserves).
    pub fn pump_public_buy_tokens(&mut self, trader: &Keypair, mint: &Pubkey, amount: u64, max_sol: u64) -> TxResult {
        let ata = create_associated_token_account_idempotent(&trader.pubkey(), &trader.pubkey(), mint, &TOKEN_ID);
        let mut ix = self.pump_public_buy_ix(trader, mint, 0);
        ix.data = pump::buy_data(amount, max_sol);
        self.send(&[ata, ix], &[trader])
    }

    pub fn pump_public_sell(&mut self, trader: &Keypair, mint: &Pubkey, tokens: u64) -> TxResult {
        let curve = pump::bonding_curve_pda(mint);
        let creator = self.curve(mint).creator;
        let ix = Instruction {
            program_id: PUMP_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(pump_global(), false),
                AccountMeta::new(self.pump_fee_recipient(), false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new(curve, false),
                AccountMeta::new(spl_ata(&curve, mint), false),
                AccountMeta::new(spl_ata(&trader.pubkey(), mint), false),
                AccountMeta::new(trader.pubkey(), true),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new(creator_vault(&creator), false),
                AccountMeta::new_readonly(TOKEN_ID, false),
                AccountMeta::new_readonly(pump_event_authority(), false),
                AccountMeta::new_readonly(PUMP_PROGRAM_ID, false),
                AccountMeta::new_readonly(fee_config(&PUMP_PROGRAM_ID), false),
                AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
                AccountMeta::new_readonly(bonding_curve_v2(mint), false),
                AccountMeta::new(self.buyback_fee_recipient(), false),
            ],
            data: pump::sell_data(tokens, 0),
        };
        self.send(&[ix], &[trader])
    }

    /// pump.fun `migrate`: moves a completed curve into its PumpSwap pool (what pump.fun's own
    /// bot does within seconds on mainnet). Permissionless; the payer covers the pool's rent.
    pub fn pump_migrate(&mut self, payer: &Keypair, mint: &Pubkey) -> TxResult {
        let curve = pump::bonding_curve_pda(mint);
        let pool_authority = pump::pool_authority_pda(mint);
        let pool = pump::pool_pda(mint);
        let lp = lp_mint(&pool);
        let ix = Instruction {
            program_id: PUMP_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(pump_global(), false),
                AccountMeta::new(PUMP_WITHDRAW_AUTHORITY, false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new(curve, false),
                AccountMeta::new(spl_ata(&curve, mint), false),
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new_readonly(TOKEN_ID, false),
                AccountMeta::new_readonly(PUMP_AMM_PROGRAM_ID, false),
                AccountMeta::new(pool, false),
                AccountMeta::new(pool_authority, false),
                AccountMeta::new(spl_ata(&pool_authority, mint), false),
                AccountMeta::new(spl_ata(&pool_authority, &WSOL_MINT), false),
                AccountMeta::new_readonly(amm_global_config(), false),
                AccountMeta::new_readonly(WSOL_MINT, false),
                AccountMeta::new(lp, false),
                AccountMeta::new(
                    get_associated_token_address_with_program_id(&pool_authority, &lp, &TOKEN_2022_ID),
                    false,
                ),
                AccountMeta::new(spl_ata(&pool, mint), false),
                AccountMeta::new(spl_ata(&pool, &WSOL_MINT), false),
                AccountMeta::new_readonly(TOKEN_2022_ID, false),
                AccountMeta::new_readonly(ATA_ID, false),
                AccountMeta::new_readonly(amm_event_authority(), false),
                AccountMeta::new_readonly(pump_event_authority(), false),
                AccountMeta::new_readonly(PUMP_PROGRAM_ID, false),
                AccountMeta::new_readonly(sysvar::rent::ID, false),
                AccountMeta::new_readonly(boost_vault_authority(&pool), false),
                AccountMeta::new(spl_ata(&boost_vault_authority(&pool), &WSOL_MINT), false),
            ],
            data: vec![155, 234, 231, 146, 236, 158, 162, 30],
        };
        self.send(&[ix], &[payer])
    }

    /// A wallet buys on PumpSwap with exactly `quote_in` lamports (wrapped for the trade).
    pub fn amm_public_buy(&mut self, trader: &Keypair, mint: &Pubkey, quote_in: u64) -> TxResult {
        let pool = pump::pool_pda(mint);
        let coin_creator = self.curve(mint).creator;
        let cva = amm_creator_vault_authority(&coin_creator);
        let pfr = self.amm_protocol_fee_recipient();
        let wsol = spl_ata(&trader.pubkey(), &WSOL_MINT);
        let ixs = vec![
            create_associated_token_account_idempotent(&trader.pubkey(), &trader.pubkey(), mint, &TOKEN_ID),
            create_associated_token_account_idempotent(&trader.pubkey(), &trader.pubkey(), &WSOL_MINT, &TOKEN_ID),
            solana_sdk::system_instruction::transfer(&trader.pubkey(), &wsol, quote_in),
            spl_token::instruction::sync_native(&TOKEN_ID, &wsol).unwrap(),
            Instruction {
                program_id: PUMP_AMM_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new(pool, false),
                    AccountMeta::new(trader.pubkey(), true),
                    AccountMeta::new_readonly(amm_global_config(), false),
                    AccountMeta::new_readonly(*mint, false),
                    AccountMeta::new_readonly(WSOL_MINT, false),
                    AccountMeta::new(spl_ata(&trader.pubkey(), mint), false),
                    AccountMeta::new(wsol, false),
                    AccountMeta::new(spl_ata(&pool, mint), false),
                    AccountMeta::new(spl_ata(&pool, &WSOL_MINT), false),
                    AccountMeta::new_readonly(pfr, false),
                    AccountMeta::new(spl_ata(&pfr, &WSOL_MINT), false),
                    AccountMeta::new_readonly(TOKEN_ID, false),
                    AccountMeta::new_readonly(TOKEN_ID, false),
                    AccountMeta::new_readonly(system_program::ID, false),
                    AccountMeta::new_readonly(ATA_ID, false),
                    AccountMeta::new_readonly(amm_event_authority(), false),
                    AccountMeta::new_readonly(PUMP_AMM_PROGRAM_ID, false),
                    AccountMeta::new(spl_ata(&cva, &WSOL_MINT), false),
                    AccountMeta::new_readonly(cva, false),
                    AccountMeta::new_readonly(amm_gva(), false),
                    AccountMeta::new(amm_uva(&trader.pubkey()), false),
                    AccountMeta::new_readonly(fee_config(&PUMP_AMM_PROGRAM_ID), false),
                    AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
                    AccountMeta::new_readonly(pool_v2(mint), false),
                    AccountMeta::new_readonly(self.buyback_fee_recipient(), false),
                    AccountMeta::new(spl_ata(&self.buyback_fee_recipient(), &WSOL_MINT), false),
                ],
                data: pump::amm_buy_exact_quote_in_data(quote_in, 1),
            },
            spl_token::instruction::close_account(&TOKEN_ID, &wsol, &trader.pubkey(), &trader.pubkey(), &[]).unwrap(),
        ];
        self.send(&ixs, &[trader])
    }

    pub fn amm_public_sell(&mut self, trader: &Keypair, mint: &Pubkey, base_in: u64) -> TxResult {
        let pool = pump::pool_pda(mint);
        let coin_creator = self.curve(mint).creator;
        let cva = amm_creator_vault_authority(&coin_creator);
        let pfr = self.amm_protocol_fee_recipient();
        let wsol = spl_ata(&trader.pubkey(), &WSOL_MINT);
        let ixs = vec![
            create_associated_token_account_idempotent(&trader.pubkey(), &trader.pubkey(), &WSOL_MINT, &TOKEN_ID),
            Instruction {
                program_id: PUMP_AMM_PROGRAM_ID,
                accounts: vec![
                    AccountMeta::new(pool, false),
                    AccountMeta::new(trader.pubkey(), true),
                    AccountMeta::new_readonly(amm_global_config(), false),
                    AccountMeta::new_readonly(*mint, false),
                    AccountMeta::new_readonly(WSOL_MINT, false),
                    AccountMeta::new(spl_ata(&trader.pubkey(), mint), false),
                    AccountMeta::new(wsol, false),
                    AccountMeta::new(spl_ata(&pool, mint), false),
                    AccountMeta::new(spl_ata(&pool, &WSOL_MINT), false),
                    AccountMeta::new_readonly(pfr, false),
                    AccountMeta::new(spl_ata(&pfr, &WSOL_MINT), false),
                    AccountMeta::new_readonly(TOKEN_ID, false),
                    AccountMeta::new_readonly(TOKEN_ID, false),
                    AccountMeta::new_readonly(system_program::ID, false),
                    AccountMeta::new_readonly(ATA_ID, false),
                    AccountMeta::new_readonly(amm_event_authority(), false),
                    AccountMeta::new_readonly(PUMP_AMM_PROGRAM_ID, false),
                    AccountMeta::new(spl_ata(&cva, &WSOL_MINT), false),
                    AccountMeta::new_readonly(cva, false),
                    AccountMeta::new_readonly(fee_config(&PUMP_AMM_PROGRAM_ID), false),
                    AccountMeta::new_readonly(PUMP_FEE_PROGRAM_ID, false),
                    AccountMeta::new_readonly(pool_v2(mint), false),
                    AccountMeta::new_readonly(self.buyback_fee_recipient(), false),
                    AccountMeta::new(spl_ata(&self.buyback_fee_recipient(), &WSOL_MINT), false),
                ],
                data: pump::amm_sell_data(base_in, 0),
            },
            spl_token::instruction::close_account(&TOKEN_ID, &wsol, &trader.pubkey(), &trader.pubkey(), &[]).unwrap(),
        ];
        self.send(&ixs, &[trader])
    }
}
