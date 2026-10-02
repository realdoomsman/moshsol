import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, curveStateOf, poolStateOf, type CurveState } from "@holdfast/sdk";
import { PublicKey } from "@solana/web3.js";

/**
 * A public trade decoded from the venue's own Anchor event: pump.fun's `TradeEvent` on the bonding curve, PumpSwap's
 * `BuyEvent` / `SellEvent` on the pool. Amounts are what the venue's reserves exchanged, fees aside; `fee` is every fee
 * the venue took on top (pump.fun protocol + creator fees, plus the LP fee on PumpSwap).
 */
export interface PumpTradeEvent {
  /** The curve event carries the mint; the pool events carry the pool. */
  mint: string | null;
  pool: string | null;
  user: string;
  isBuy: boolean;
  timestamp: number;
  solAmount: bigint;
  tokenAmount: bigint;
  fee: bigint;
  /** Reserves right after the trade, as the SDK quotes them (`curveStateOf` / `poolStateOf`, effective quote on the pool). */
  reserves: CurveState;
}

const PUMP_PROGRAM = PUMP_PROGRAM_ID.toBase58();
const PUMP_AMM_PROGRAM = PUMP_AMM_PROGRAM_ID.toBase58();

// Anchor event discriminators: sha256("event:<Name>")[0..8].
const TRADE_EVENT = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const BUY_EVENT = Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]);
const SELL_EVENT = Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]);

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const RETURN = /^Program (\w+) (?:success|failed)/;
const DATA = "Program data: ";

class Reader {
  private at = 8;
  constructor(private readonly b: Buffer) {}
  u32(): number {
    const v = this.b.readUInt32LE(this.at);
    this.at += 4;
    return v;
  }
  u64(): bigint {
    const v = this.b.readBigUInt64LE(this.at);
    this.at += 8;
    return v;
  }
  i64(): number {
    const v = this.b.readBigInt64LE(this.at);
    this.at += 8;
    return Number(v);
  }
  i128(): bigint {
    const lo = this.b.readBigUInt64LE(this.at);
    const hi = this.b.readBigInt64LE(this.at + 8);
    this.at += 16;
    return (hi << 64n) + lo;
  }
  bool(): boolean {
    return this.b[this.at++] !== 0;
  }
  pubkey(): string {
    const v = new PublicKey(this.b.subarray(this.at, this.at + 32)).toBase58();
    this.at += 32;
    return v;
  }
  skip(bytes: number): void {
    this.at += bytes;
  }
  /** Bytes left after the cursor (negative once a skip ran past the end). */
  left(): number {
    return this.b.length - this.at;
  }
}

/** pump.fun `TradeEvent` (bonding curve). */
function decodeTradeEvent(b: Buffer): PumpTradeEvent {
  const r = new Reader(b);
  const mint = r.pubkey();
  const solAmount = r.u64();
  const tokenAmount = r.u64();
  const isBuy = r.bool();
  const user = r.pubkey();
  const timestamp = r.i64();
  const virtualSolReserves = r.u64();
  const virtualTokenReserves = r.u64();
  const realSolReserves = r.u64();
  const realTokenReserves = r.u64();
  r.pubkey(); // fee_recipient
  r.u64(); // fee_basis_points
  const fee = r.u64();
  r.pubkey(); // creator
  r.u64(); // creator_fee_basis_points
  const creatorFee = r.u64();
  return {
    mint,
    pool: null,
    user,
    isBuy,
    timestamp,
    solAmount,
    tokenAmount,
    fee: fee + creatorFee,
    reserves: curveStateOf({
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply: 0n,
      complete: false,
      creator: PublicKey.default,
    }),
  };
}

/**
 * PumpSwap `BuyEvent` / `SellEvent` (pool; quote = WSOL, base = the token). The event's pool reserves are the vault
 * balances before the trade; the reserves returned are after it: a buy adds `quote_amount_in_with_lp_fee` to the quote
 * vault (protocol and creator fees go elsewhere), a sell takes `quote_amount_out_without_lp_fee` out of it. The quote
 * is priced on the vault balance plus the pool's signed `virtual_quote_reserves`, appended to newer events (0 on older ones).
 */
function decodePoolEvent(b: Buffer, isBuy: boolean): PumpTradeEvent {
  const r = new Reader(b);
  const timestamp = r.i64();
  const baseAmount = r.u64(); // base_amount_out (buy) / base_amount_in (sell)
  r.u64(); // max_quote_amount_in / min_quote_amount_out
  r.skip(16); // user_base_token_reserves, user_quote_token_reserves
  const poolBaseReserves = r.u64();
  const poolQuoteReserves = r.u64();
  const quoteAmount = r.u64(); // quote_amount_in (buy) / quote_amount_out (sell)
  r.u64(); // lp_fee_basis_points
  const lpFee = r.u64();
  r.u64(); // protocol_fee_basis_points
  const protocolFee = r.u64();
  const vaultQuote = r.u64(); // quote_amount_in_with_lp_fee (buy) / quote_amount_out_without_lp_fee (sell)
  const userQuoteAmount = r.u64(); // user_quote_amount_in / user_quote_amount_out
  const pool = r.pubkey();
  const user = r.pubkey();
  r.skip(32 * 5); // user base/quote token accounts, protocol fee recipient (+ token account), coin_creator
  r.u64(); // coin_creator_fee_basis_points
  const creatorFee = r.u64();
  if (isBuy && r.left() >= 1 + 8 * 5 + 4) {
    // track_volume, total_unclaimed_tokens, total_claimed_tokens, current_sol_volume, last_update_timestamp, min_base_amount_out, ix_name
    r.skip(1 + 8 * 5);
    r.skip(r.u32());
  }
  r.skip(8 * 4); // cashback_fee_basis_points, cashback, buyback_fee_basis_points, buyback_fee
  const virtualQuoteReserves = r.left() >= 16 ? r.i128() : 0n;
  return {
    mint: null,
    pool,
    user,
    isBuy,
    timestamp,
    // Buy: what the user put in net of fees (`quote_amount_in` is gross); sell: what the pool paid out before fees.
    solAmount: isBuy ? userQuoteAmount : quoteAmount,
    tokenAmount: baseAmount,
    fee: lpFee + protocolFee + creatorFee,
    reserves: isBuy
      ? poolStateOf(poolQuoteReserves + vaultQuote, poolBaseReserves - baseAmount, virtualQuoteReserves)
      : poolStateOf(poolQuoteReserves - vaultQuote, poolBaseReserves + baseAmount, virtualQuoteReserves),
  };
}

/** True when `programId` was invoked (at any depth) in these logs. */
export function invokesProgram(logs: string[], programId: string): boolean {
  return logs.some((line) => INVOKE.exec(line)?.[1] === programId);
}

/**
 * The venue trade events of a transaction's logs, in log order. `Program data:` lines are attributed to the program on
 * top of the invoke stack, so only pump.fun's and PumpSwap's own events are decoded (never another program's event
 * that happens to share a discriminator).
 */
export function decodePumpTrades(logs: string[]): PumpTradeEvent[] {
  const out: PumpTradeEvent[] = [];
  const stack: string[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (RETURN.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith(DATA)) continue;
    const program = stack[stack.length - 1];
    if (program !== PUMP_PROGRAM && program !== PUMP_AMM_PROGRAM) continue;
    const b = Buffer.from(line.slice(DATA.length), "base64");
    if (b.length < 8) continue;
    const disc = b.subarray(0, 8);
    try {
      if (program === PUMP_PROGRAM && disc.equals(TRADE_EVENT)) out.push(decodeTradeEvent(b));
      else if (program === PUMP_AMM_PROGRAM && disc.equals(BUY_EVENT)) out.push(decodePoolEvent(b, true));
      else if (program === PUMP_AMM_PROGRAM && disc.equals(SELL_EVENT)) out.push(decodePoolEvent(b, false));
    } catch {
      // A truncated payload (older event layout): not a trade we can book.
    }
  }
  return out;
}
