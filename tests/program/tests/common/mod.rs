#![allow(dead_code)]

use anchor_lang::error::ERROR_CODE_OFFSET;
use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, ID as ATA_ID};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::StateWithExtensions,
};
use anchor_spl::token_2022::ID as TOKEN_2022_ID;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use moshsol::constants::*;
use moshsol::errors::MoshError;
use moshsol::instructions::CreateLaunchArgs;
use moshsol::state::{Backer, Launch, Platform, PlatformParams};
use solana_sdk::clock::Clock;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::instruction::{Instruction, InstructionError};
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::{Transaction, TransactionError};

pub const SOL: u64 = LAMPORTS_PER_SOL;
pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn test_params() -> PlatformParams {
    PlatformParams {
        trade_fee_bps: 100,
        backer_fee_share_bps: 5_000,
        creator_fee_share_bps: 3_000,
        launch_fee_bps: 100,
        create_fee_lamports: SOL / 50,
        virtual_sol_reserves: 30 * SOL,
        max_bundle_supply_bps: 2_500,
        min_raise_lamports: SOL,
        agent_buy_bps_per_window: 1_000,
        agent_sell_bps_per_window: 500,
        agent_max_impact_bps: 300,
        agent_band_bps: 200,
        agent_window_secs: 3_600,
        ema_period_secs: 1_800,
        paused: false,
        agents_paused: false,
    }
}

pub fn default_args() -> CreateLaunchArgs {
    CreateLaunchArgs {
        name: "Mosh Dog".into(),
        symbol: "MDOG".into(),
        uri: "https://example.com/mdog.json".into(),
        raise_min: 10 * SOL,
        raise_max: 50 * SOL,
        max_per_wallet: 0,
        duration_secs: 3_600,
        whitelist_root: [0u8; 32],
        bundle_supply_bps: 2_000,
        reserve_bps: 3_000,
    }
}

pub fn platform_pda() -> Pubkey {
    Pubkey::find_program_address(&[PLATFORM_SEED], &moshsol::ID).0
}
pub fn launch_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LAUNCH_SEED, mint.as_ref()], &moshsol::ID).0
}
pub fn curve_pda(launch: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[CURVE_SEED, launch.as_ref()], &moshsol::ID).0
}
pub fn vault_pda(launch: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, launch.as_ref()], &moshsol::ID).0
}
pub fn backer_pda(launch: &Pubkey, owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[BACKER_SEED, launch.as_ref(), owner.as_ref()], &moshsol::ID).0
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &TOKEN_2022_ID)
}

pub fn err_code(e: MoshError) -> u32 {
    ERROR_CODE_OFFSET + e as u32
}

pub fn assert_err(res: TxResult, expected: MoshError) {
    match res {
        Ok(_) => panic!("expected {expected:?}, transaction succeeded"),
        Err(f) => match f.err {
            TransactionError::InstructionError(_, InstructionError::Custom(code)) => {
                assert_eq!(
                    code,
                    err_code(expected),
                    "expected {expected:?}, got custom {code}; logs:\n{}",
                    f.meta.logs.join("\n")
                )
            }
            other => panic!(
                "expected {expected:?}, got {other:?}; logs:\n{}",
                f.meta.logs.join("\n")
            ),
        },
    }
}

pub fn ok(res: TxResult) -> TransactionMetadata {
    match res {
        Ok(m) => m,
        Err(f) => panic!("tx failed: {:?}\n{}", f.err, f.meta.logs.join("\n")),
    }
}

pub fn merkle_leaf(pk: &Pubkey) -> [u8; 32] {
    solana_sdk::hash::hashv(&[pk.as_ref()]).to_bytes()
}

fn hash_pair(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    if a <= b {
        solana_sdk::hash::hashv(&[&a, &b]).to_bytes()
    } else {
        solana_sdk::hash::hashv(&[&b, &a]).to_bytes()
    }
}

/// Returns (root, proofs[i]) for a sorted-pair sha256 tree; odd nodes are promoted.
pub fn merkle(leaves: &[[u8; 32]]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
    let mut proofs: Vec<Vec<[u8; 32]>> = vec![vec![]; leaves.len()];
    let mut idx: Vec<usize> = (0..leaves.len()).collect();
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        let mut next = vec![];
        for pair in 0..level.len().div_ceil(2) {
            let l = pair * 2;
            if l + 1 < level.len() {
                next.push(hash_pair(level[l], level[l + 1]));
            } else {
                next.push(level[l]);
            }
        }
        for (leaf_i, pos) in idx.iter_mut().enumerate() {
            let sib = *pos ^ 1;
            if sib < level.len() {
                proofs[leaf_i].push(level[sib]);
            }
            *pos /= 2;
        }
        level = next;
    }
    (level[0], proofs)
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub fee_recipient: Keypair,
    pub agent: Keypair,
}

impl Env {
    pub fn new() -> Self {
        Self::with_params(test_params())
    }

    pub fn with_params(params: PlatformParams) -> Self {
        let mut svm = LiteSVM::new();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/moshsol.so");
        svm.add_program_from_file(moshsol::ID, so).expect("build the program first: anchor build");
        let admin = Keypair::new();
        let fee_recipient = Keypair::new();
        let agent = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();
        svm.airdrop(&fee_recipient.pubkey(), SOL).unwrap();
        svm.airdrop(&agent.pubkey(), SOL).unwrap();
        let mut env = Self { svm, admin, fee_recipient, agent };
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::InitializePlatform {
                admin: env.admin.pubkey(),
                platform: platform_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::InitializePlatform {
                fee_recipient: env.fee_recipient.pubkey(),
                agent_authority: env.agent.pubkey(),
                params,
            }
            .data(),
        };
        let admin = env.admin.insecure_clone();
        ok(env.send(&[ix], &[&admin]));
        env
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        let mut all = vec![ComputeBudgetInstruction::set_compute_unit_limit(400_000)];
        all.extend_from_slice(ixs);
        let tx = Transaction::new_signed_with_payer(
            &all,
            Some(&signers[0].pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn user(&mut self, sol: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), sol * SOL).unwrap();
        k
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, secs: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp += secs;
        c.slot += (secs.max(1) as u64) * 2;
        self.svm.set_sysvar(&c);
    }

    pub fn lamports(&self, pk: &Pubkey) -> u64 {
        self.svm.get_account(pk).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn platform(&self) -> Platform {
        let a = self.svm.get_account(&platform_pda()).unwrap();
        Platform::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn launch(&self, mint: &Pubkey) -> Launch {
        let a = self.svm.get_account(&launch_pda(mint)).unwrap();
        Launch::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn backer(&self, mint: &Pubkey, owner: &Pubkey) -> Option<Backer> {
        let a = self.svm.get_account(&backer_pda(&launch_pda(mint), owner))?;
        if a.data.is_empty() {
            return None;
        }
        Some(Backer::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        match self.svm.get_account(account) {
            Some(a) if !a.data.is_empty() => {
                StateWithExtensions::<spl_token_2022::state::Account>::unpack(&a.data)
                    .unwrap()
                    .base
                    .amount
            }
            _ => 0,
        }
    }

    pub fn mint_state(&self, mint: &Pubkey) -> spl_token_2022::state::Mint {
        let a = self.svm.get_account(mint).unwrap();
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&a.data).unwrap().base
    }

    /// Lamports held by the launch account == rent + every tracked bucket, and the token
    /// accounts hold exactly what the curve and vault fields claim.
    pub fn assert_invariants(&self, mint: &Pubkey) {
        let launch_key = launch_pda(mint);
        let l = self.launch(mint);
        let acct = self.svm.get_account(&launch_key).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(acct.lamports, rent + l.owed_lamports(), "launch lamport accounting");
        assert_eq!(self.token_balance(&curve_pda(&launch_key)), l.token_reserve, "curve tokens");
        assert_eq!(self.token_balance(&vault_pda(&launch_key)), l.vault_tokens, "vault tokens");
    }

    // ---------------- instruction helpers ----------------

    pub fn create(&mut self, creator: &Keypair, args: CreateLaunchArgs) -> (Pubkey, TxResult) {
        let mint = Keypair::new();
        let launch = launch_pda(&mint.pubkey());
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::CreateLaunch {
                creator: creator.pubkey(),
                platform: platform_pda(),
                fee_recipient: self.fee_recipient.pubkey(),
                launch,
                mint: mint.pubkey(),
                curve_tokens: curve_pda(&launch),
                vault_tokens: vault_pda(&launch),
                token_program: TOKEN_2022_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::CreateLaunch { args }.data(),
        };
        let res = self.send(&[ix], &[creator, &mint]);
        (mint.pubkey(), res)
    }

    pub fn create_ok(&mut self, creator: &Keypair, args: CreateLaunchArgs) -> Pubkey {
        let (mint, res) = self.create(creator, args);
        ok(res);
        mint
    }

    pub fn deposit(&mut self, owner: &Keypair, mint: &Pubkey, amount: u64, proof: Vec<[u8; 32]>) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::Deposit {
                owner: owner.pubkey(),
                platform: platform_pda(),
                launch,
                backer: backer_pda(&launch, &owner.pubkey()),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::Deposit { amount, proof }.data(),
        };
        self.send(&[ix], &[owner])
    }

    pub fn cancel(&mut self, creator: &Keypair, mint: &Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::CancelLaunch {
                creator: creator.pubkey(),
                launch: launch_pda(mint),
            }
            .to_account_metas(None),
            data: moshsol::instruction::CancelLaunch {}.data(),
        };
        self.send(&[ix], &[creator])
    }

    pub fn refund(&mut self, owner: &Keypair, mint: &Pubkey) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::Refund {
                owner: owner.pubkey(),
                launch,
                backer: backer_pda(&launch, &owner.pubkey()),
            }
            .to_account_metas(None),
            data: moshsol::instruction::Refund {}.data(),
        };
        self.send(&[ix], &[owner])
    }

    pub fn launch_token(&mut self, cranker: &Keypair, mint: &Pubkey) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::LaunchToken {
                cranker: cranker.pubkey(),
                platform: platform_pda(),
                launch,
                mint: *mint,
                curve_tokens: curve_pda(&launch),
                vault_tokens: vault_pda(&launch),
                token_program: TOKEN_2022_ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::Launch {}.data(),
        };
        self.send(&[ix], &[cranker])
    }

    pub fn buy(&mut self, trader: &Keypair, mint: &Pubkey, sol_in: u64, min_out: u64) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::Buy {
                trader: trader.pubkey(),
                platform: platform_pda(),
                launch,
                mint: *mint,
                curve_tokens: curve_pda(&launch),
                trader_tokens: ata(&trader.pubkey(), mint),
                token_program: TOKEN_2022_ID,
                associated_token_program: ATA_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::Buy { sol_in, min_tokens_out: min_out }.data(),
        };
        self.send(&[ix], &[trader])
    }

    pub fn sell(&mut self, trader: &Keypair, mint: &Pubkey, tokens_in: u64, min_out: u64) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::Sell {
                trader: trader.pubkey(),
                platform: platform_pda(),
                launch,
                mint: *mint,
                curve_tokens: curve_pda(&launch),
                trader_tokens: ata(&trader.pubkey(), mint),
                token_program: TOKEN_2022_ID,
            }
            .to_account_metas(None),
            data: moshsol::instruction::Sell { tokens_in, min_sol_out: min_out }.data(),
        };
        self.send(&[ix], &[trader])
    }

    fn agent_accounts(&self, agent: &Pubkey, mint: &Pubkey) -> Vec<solana_sdk::instruction::AccountMeta> {
        let launch = launch_pda(mint);
        moshsol::accounts::AgentTrade {
            agent: *agent,
            platform: platform_pda(),
            launch,
            mint: *mint,
            curve_tokens: curve_pda(&launch),
            vault_tokens: vault_pda(&launch),
            token_program: TOKEN_2022_ID,
        }
        .to_account_metas(None)
    }

    pub fn agent_buy_as(&mut self, agent: &Keypair, mint: &Pubkey, sol_in: u64, min_out: u64) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: self.agent_accounts(&agent.pubkey(), mint),
            data: moshsol::instruction::AgentBuy { sol_in, min_tokens_out: min_out }.data(),
        };
        self.send(&[ix], &[agent])
    }

    pub fn agent_buy(&mut self, mint: &Pubkey, sol_in: u64, min_out: u64) -> TxResult {
        let agent = self.agent.insecure_clone();
        self.agent_buy_as(&agent, mint, sol_in, min_out)
    }

    pub fn agent_sell(&mut self, mint: &Pubkey, tokens_in: u64, min_out: u64) -> TxResult {
        let agent = self.agent.insecure_clone();
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: self.agent_accounts(&agent.pubkey(), mint),
            data: moshsol::instruction::AgentSell { tokens_in, min_sol_out: min_out }.data(),
        };
        self.send(&[ix], &[&agent])
    }

    pub fn claim_backer(&mut self, owner: &Keypair, mint: &Pubkey) -> TxResult {
        let launch = launch_pda(mint);
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::ClaimBackerFees {
                owner: owner.pubkey(),
                launch,
                backer: backer_pda(&launch, &owner.pubkey()),
            }
            .to_account_metas(None),
            data: moshsol::instruction::ClaimBackerFees {}.data(),
        };
        self.send(&[ix], &[owner])
    }

    pub fn claim_creator(&mut self, creator: &Keypair, mint: &Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::ClaimCreatorFees {
                creator: creator.pubkey(),
                launch: launch_pda(mint),
            }
            .to_account_metas(None),
            data: moshsol::instruction::ClaimCreatorFees {}.data(),
        };
        self.send(&[ix], &[creator])
    }

    pub fn sweep(&mut self, payer: &Keypair, mint: &Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::SweepPlatformFees {
                platform: platform_pda(),
                launch: launch_pda(mint),
                fee_recipient: self.fee_recipient.pubkey(),
            }
            .to_account_metas(None),
            data: moshsol::instruction::SweepPlatformFees {}.data(),
        };
        self.send(&[ix], &[payer])
    }

    pub fn update_platform(&mut self, signer: &Keypair, params: PlatformParams) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::AdminOnly {
                admin: signer.pubkey(),
                platform: platform_pda(),
            }
            .to_account_metas(None),
            data: moshsol::instruction::UpdatePlatform { params }.data(),
        };
        self.send(&[ix], &[signer])
    }

    pub fn propose_admin(&mut self, signer: &Keypair, new_admin: Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::AdminOnly {
                admin: signer.pubkey(),
                platform: platform_pda(),
            }
            .to_account_metas(None),
            data: moshsol::instruction::ProposeAdmin { new_admin }.data(),
        };
        self.send(&[ix], &[signer])
    }

    pub fn accept_admin(&mut self, signer: &Keypair) -> TxResult {
        let ix = Instruction {
            program_id: moshsol::ID,
            accounts: moshsol::accounts::AcceptAdmin {
                new_admin: signer.pubkey(),
                platform: platform_pda(),
            }
            .to_account_metas(None),
            data: moshsol::instruction::AcceptAdmin {}.data(),
        };
        self.send(&[ix], &[signer])
    }

    /// Creates a launch, funds it with the given deposits and launches it as the creator.
    pub fn live_launch(&mut self, deposits: &[u64]) -> (Keypair, Pubkey, Vec<Keypair>) {
        let creator = self.user(10);
        let mint = self.create_ok(&creator, default_args());
        let mut backers = vec![];
        for d in deposits {
            let b = self.user(d / SOL + 2);
            ok(self.deposit(&b, &mint, *d, vec![]));
            backers.push(b);
        }
        ok(self.launch_token(&creator, &mint));
        (creator, mint, backers)
    }
}
