import { LAMPORTS_PER_SOL, PublicKey, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import {
  BUYBACK,
  PUMP_VENUE_FEE_BPS,
  WIND_DOWN_IDLE_SECS,
  WSOL_MINT,
  ammCreatorVaultAuthorityPda,
  bondingCurvePda,
  bps,
  creatorVaultPda,
  decodeBondingCurve,
  describeError,
  fetchVenueState,
  minOut,
  payoutStatus,
  poolPda,
  pumpRefOf,
  quoteBuy,
  splAta,
  windDownTimingBlocker,
  type LaunchAccount,
  type LaunchJson,
  type MoshClient,
  type MoshEvent,
  type PlatformAccount,
  type PumpLaunchRef,
  type VenueState,
} from "@holdfast/sdk";
import type { ActivityItem, ActivityKind, ActivityLog } from "./activity";
import type { LookupTable } from "./alt";
import type { AgentConfig } from "./config";
import type { FlowFeatures } from "./flow";
import { log } from "./log";
import { landed, sendIxs } from "./send";
import type { CrankAttempt, CrankKind } from "./status";
import { payoutMarketStrong, type MarketState, type Projection, type StrategyParams } from "./strategy";
import { tokenAmount } from "./venue";

/**
 * The permissionless instructions the agent cranks for every live launch, independent of agent pauses
 * and of which key is the agent authority: `wind_down` / `wind_down_pump` on both venues, and on pump
 * launches `graduate_pump` (once the curve completed and pump.fun migrated it), `collect_pump_fees`
 * (creator fees worth collecting) and `buyback_burn` (a buyback pool worth spending). Each check costs
 * RPC reads, so every (launch, crank) pair runs at most every `crankMs` (wind-down: WIND_DOWN_RECHECK_MS)
 * and a failed send backs off exponentially from there. `payout_backers` is different: it is signed by the
 * agent authority and only sent when the program says a payout is due AND the market is strong.
 */

/** Creator fees below this stay in pump.fun's vaults (the crank's own fee would be a visible share). */
const COLLECT_MIN_LAMPORTS = BigInt(0.01 * LAMPORTS_PER_SOL);
/**
 * Wait before re-reading balances of a launch that passes the wind-down timing rules but still has outside
 * holders (only a burn or a transfer back to the curve/vault can clear that without a trade), and the first
 * back-off step after a failed `wind_down` send.
 */
const WIND_DOWN_RECHECK_MS = 10 * 60_000;
/** Longest back-off of any crank after repeated failures. */
const MAX_CRANK_BACKOFF_MS = WIND_DOWN_IDLE_SECS * 1000;
/** Crank attempts kept for `GET /status`, newest first. */
const MAX_CRANKS = 50;
/** A payout that is due but skipped for market reasons is re-recorded in the activity feed at most this often. */
const PAYOUT_SKIP_NOTE_MS = 10 * 60_000;
/** Crank kinds shown in the launch activity feed (graduation and the Holdfast-token buyback are not this launch's chart). */
const ACTIVITY_KINDS: Partial<Record<CrankKind, ActivityKind>> = { collect_fees: "collect_fees", wind_down: "wind_down", payout: "payout" };
const ACTIVITY_LABELS: Record<string, string> = {
  collect_fees: "collected creator fees",
  wind_down: "wound down: vault sold and SOL paid to backers",
  payout: "paid backers",
};

export interface CrankLaunch {
  address: PublicKey;
  account: LaunchAccount;
  json: LaunchJson;
  symbol?: string;
}

interface CrankState {
  /** Wall-clock ms before which this crank neither reads nor sends for the launch. */
  nextAt: number;
  /** Consecutive failed sends (sizes the back-off). */
  failures: number;
  /** Payout: the market reason the last skip was recorded with, and when (`PAYOUT_SKIP_NOTE_MS`). */
  skipReason?: string;
  skipAt?: number;
}

export class Cranks {
  /** Attempts, newest first, at most MAX_CRANKS. */
  readonly attempts: CrankAttempt[] = [];
  private readonly state = new Map<string, Partial<Record<CrankKind, CrankState>>>();
  /** Lamports a 0-byte system account keeps for rent (pump.fun's creator vault never pays out below it). */
  private rentExemptZero: bigint | null = null;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly client: MoshClient,
    private readonly signer: Keypair,
    private readonly alt: LookupTable,
    private readonly activity: ActivityLog,
  ) {}

  /** Forgets launches that are no longer live. */
  retain(live: Set<string>): void {
    for (const key of [...this.state.keys()]) if (!live.has(key)) this.state.delete(key);
  }

  /**
   * `wind_down` / `wind_down_pump`. The launch's age and idle time are checked against the tick snapshot
   * first (no RPC); balances are read only once those pass. Returns true when the launch was wound down.
   */
  async windDown(l: CrankLaunch, now: bigint): Promise<boolean> {
    if (windDownTimingBlocker(l.json, Number(now)) !== null || !this.due(l, "wind_down")) return false;
    const blocker = await this.client.windDownBlocker(l.json, Number(now));
    if (blocker !== null) {
      this.defer(l, "wind_down", WIND_DOWN_RECHECK_MS);
      return false;
    }
    const cranker = this.signer.publicKey;
    const build = () =>
      l.json.venue === "pump" ? this.client.windDownPumpIx(cranker, pumpRefOf(l.json)) : this.client.windDownIx(cranker, l.account.mint);
    return this.attempt("wind_down", l, WIND_DOWN_RECHECK_MS, build, (events) => {
      const e = events.find((x) => x.name === "woundDown");
      return e?.name === "woundDown" ? { amount: e.data.solToBackers.toString(), tokens: e.data.tokensReturned.toString() } : {};
    });
  }

  /**
   * `payout_backers`, agent-signed: when the program's conditions hold (`payoutStatus.due`: liquid vault SOL ≥
   * the payout multiple of the initial vault, the 4 h interval, the vault floor) AND the market is strong by
   * the sell ramp's observables. A due payout in a weak market is skipped and the reason goes to the activity
   * feed (`payout`, `skipped`): the vault's SOL buys the dip first, backers are paid out of strength.
   */
  async payout(l: CrankLaunch, market: MarketState, proj: Projection, flow: FlowFeatures, now: bigint, params: StrategyParams): Promise<void> {
    const status = payoutStatus(l.account, Number(now));
    if (!status.due || !this.due(l, "payout")) return;
    const kind: 0 | 1 = status.principalRepaid ? 1 : 0;
    const gate = payoutMarketStrong(market, proj, params, flow);
    const key = l.address.toBase58();
    if (!gate.ok) {
      const per = this.state.get(key)?.payout;
      if (per?.skipReason !== gate.reason || Date.now() - (per.skipAt ?? 0) >= PAYOUT_SKIP_NOTE_MS) {
        this.defer(l, "payout", 0);
        const state = this.state.get(key)!.payout!;
        state.skipReason = gate.reason;
        state.skipAt = Date.now();
        this.activity.record(
          { address: l.json.address, mint: l.json.mint, symbol: l.symbol, venue: l.json.venue },
          {
            ts: Math.floor(Date.now() / 1000),
            kind: "payout",
            reason: `payout eligible, skipped: ${gate.reason}`,
            detail: { skipped: true, eligible: true, payoutKind: kind, targetSol: Number(status.target) / LAMPORTS_PER_SOL, liquidSol: Number(status.liquid) / LAMPORTS_PER_SOL },
          },
        );
        log("payout_skipped", { address: l.json.address, mint: l.json.mint, reason: gate.reason });
      }
      return;
    }
    this.defer(l, "payout", this.cfg.crankMs);
    await this.attempt("payout", l, this.cfg.crankMs, () => Promise.resolve(this.client.payoutBackersIx(l.address, this.signer.publicKey)), (events) => {
      const e = events.find((x) => x.name === "backersPaid");
      return e?.name === "backersPaid" ? { amount: e.data.amount.toString() } : {};
    }, { payoutKind: kind, market: gate.reason, targetSol: Number(status.target) / LAMPORTS_PER_SOL, liquidSol: Number(status.liquid) / LAMPORTS_PER_SOL });
  }

  /** The pump launch cranks: graduation, creator fee collection, buyback-and-burn. */
  async pump(l: CrankLaunch, platform: PlatformAccount, venue: VenueState | null, now: bigint): Promise<void> {
    const ref = pumpRefOf(l.json);
    const cranker = this.signer.publicKey;
    const connection = this.client.connection;
    const ms = this.cfg.crankMs;

    if (venue?.complete && !ref.graduated && this.due(l, "graduate")) {
      this.defer(l, "graduate", ms);
      // pump.fun migrates a completed curve into its canonical pool; `graduate_pump` records it once it exists.
      const pool = await connection.getAccountInfo(poolPda(ref.mint), "confirmed");
      if (pool) await this.attempt("graduate", l, ms, () => this.client.graduatePumpIx(ref), () => ({}));
    }

    if (this.due(l, "collect_fees")) {
      this.defer(l, "collect_fees", ms);
      const collectable = await this.collectable(ref);
      if (collectable >= COLLECT_MIN_LAMPORTS) {
        await this.attempt("collect_fees", l, ms, () => this.client.collectPumpFeesIx(cranker, ref), (events) => {
          const e = events.find((x) => x.name === "creatorFeesCollected");
          return e?.name === "creatorFeesCollected" ? { amount: e.data.amount.toString() } : {};
        });
      }
    }

    const buybackMint = platform.params.buybackMint;
    const pool = BigInt(l.account.buybackPoolSol.toString());
    const throttledUntil = BigInt(l.account.lastBuybackTs.toString()) + BigInt(BUYBACK.minIntervalSecs);
    if (!buybackMint.equals(PublicKey.default) && pool >= BUYBACK.minLamports && now >= throttledUntil && this.due(l, "buyback_burn")) {
      this.defer(l, "buyback_burn", ms);
      const ix = await this.buybackIx(l.address, buybackMint, pool);
      if (ix) {
        await this.attempt("buyback_burn", l, ms, () => Promise.resolve(ix), (events) => {
          const e = events.find((x) => x.name === "buybackBurned");
          return e?.name === "buybackBurned" ? { amount: e.data.sol.toString(), tokens: e.data.tokens.toString() } : {};
        });
      }
    }
  }

  /**
   * `buyback_burn` for `pool` lamports, quoted on the buyback mint's current venue (its pump.fun curve while
   * open, its PumpSwap pool after) with the agent's slippage floor; null when the venue is not readable or the
   * program's own floor (0.001 SOL after the 5%-of-reserves cap) would reject it.
   */
  private async buybackIx(launch: PublicKey, buybackMint: PublicKey, pool: bigint): Promise<TransactionInstruction | null> {
    const connection = this.client.connection;
    const curveInfo = await connection.getAccountInfo(bondingCurvePda(buybackMint), "confirmed");
    if (!curveInfo) return null;
    const buybackGraduated = decodeBondingCurve(curveInfo.data).complete;
    const venue = await fetchVenueState(connection, { mint: buybackMint, graduated: buybackGraduated });
    if (!venue) return null;
    const cap = bps(venue.curve.virtualSol + venue.curve.realSol, BUYBACK.maxVenueBps);
    const maxSol = pool < cap ? pool : cap;
    if (maxSol < BUYBACK.minLamports) return null;
    const minTokensOut = minOut(quoteBuy(venue.curve, maxSol, PUMP_VENUE_FEE_BPS).tokensOut, this.cfg.slippageBps);
    return this.client.buybackBurnIx({ cranker: this.signer.publicKey, launch, buybackMint, buybackGraduated, maxSol, minTokensOut });
  }

  /** Creator fees waiting in pump.fun's creator vault and, once graduated, PumpSwap's creator vault WSOL account. */
  private async collectable(ref: PumpLaunchRef): Promise<bigint> {
    const connection = this.client.connection;
    this.rentExemptZero ??= BigInt(await connection.getMinimumBalanceForRentExemption(0));
    const keys = [creatorVaultPda(ref.address)];
    if (ref.graduated) keys.push(splAta(ammCreatorVaultAuthorityPda(ref.address), WSOL_MINT));
    const [vault, wsol] = await connection.getMultipleAccountsInfo(keys, "confirmed");
    let total = 0n;
    if (vault) {
      const lamports = BigInt(vault.lamports);
      if (lamports > this.rentExemptZero) total += lamports - this.rentExemptZero;
    }
    if (wsol) total += tokenAmount(wsol);
    return total;
  }

  private due(l: CrankLaunch, kind: CrankKind): boolean {
    return Date.now() >= (this.state.get(l.address.toBase58())?.[kind]?.nextAt ?? 0);
  }

  private defer(l: CrankLaunch, kind: CrankKind, ms: number): void {
    const key = l.address.toBase58();
    let per = this.state.get(key);
    if (!per) {
      per = {};
      this.state.set(key, per);
    }
    per[kind] = { nextAt: Date.now() + ms, failures: per[kind]?.failures ?? 0 };
  }

  /**
   * Sends one crank instruction (or records it in dry run) and keeps the attempt for `/status`. A failure
   * backs off from `baseMs`, doubling per consecutive failure up to MAX_CRANK_BACKOFF_MS. Returns success.
   */
  private async attempt(
    kind: CrankKind,
    l: CrankLaunch,
    baseMs: number,
    build: () => Promise<TransactionInstruction>,
    outcome: (events: MoshEvent[]) => Pick<CrankAttempt, "amount" | "tokens">,
    detail: ActivityItem["detail"] = {},
  ): Promise<boolean> {
    const attempt: CrankAttempt = { kind, address: l.json.address, mint: l.json.mint, venue: l.json.venue, symbol: l.symbol, at: Math.floor(Date.now() / 1000) };
    if (this.cfg.dryRun) {
      this.defer(l, kind, baseMs);
      this.record(l, attempt, { dryRun: true }, detail);
      return false;
    }
    const key = l.address.toBase58();
    try {
      const sent = await sendIxs(this.client.connection, this.signer, [await build()], this.cfg.priorityFee, this.alt);
      const result = await landed(this.client, sent.signature);
      const per = this.state.get(key)?.[kind];
      if (per) per.failures = 0;
      this.record(l, { ...attempt, signature: sent.signature, ...outcome(result?.events ?? []) }, { ...sent.cost, ...result?.cost }, detail);
      return true;
    } catch (err) {
      const per = this.state.get(key)?.[kind];
      const failures = per?.failures ?? 0;
      const retryInMs = Math.min(baseMs * 2 ** failures, MAX_CRANK_BACKOFF_MS);
      this.defer(l, kind, retryInMs);
      this.state.get(key)![kind]!.failures = failures + 1;
      this.record(l, { ...attempt, error: describeError(err) }, { retryInMs }, detail);
      return false;
    }
  }

  private record(l: CrankLaunch, attempt: CrankAttempt, extra: Record<string, unknown>, detail: ActivityItem["detail"]): void {
    this.attempts.unshift(attempt);
    this.attempts.length = Math.min(this.attempts.length, MAX_CRANKS);
    log("crank", { ...attempt, ...extra });
    const activityKind = ACTIVITY_KINDS[attempt.kind];
    if (!activityKind) return;
    const facts: ActivityItem["detail"] = { ...detail };
    if (attempt.amount !== undefined) facts.amountSol = Number(attempt.amount) / LAMPORTS_PER_SOL;
    if (attempt.tokens !== undefined) facts.tokens = Number(attempt.tokens) / 1e6;
    if (attempt.error !== undefined) facts.error = attempt.error;
    if (extra.dryRun === true) facts.dryRun = true;
    const label = ACTIVITY_LABELS[activityKind] ?? activityKind;
    const reason = attempt.error ? `${label} failed: ${attempt.error}` : extra.dryRun ? `dry run, not sent: ${label}` : label;
    const item: Omit<ActivityItem, "narrative"> = { ts: attempt.at, kind: activityKind, reason, detail: facts };
    if (attempt.signature) item.sig = attempt.signature;
    this.activity.record({ address: l.json.address, mint: l.json.mint, symbol: l.symbol, venue: l.json.venue }, item);
  }
}
