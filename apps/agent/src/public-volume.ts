/**
 * Total traded volume of a pump launch, public trades included. The program's `Launch.volume_sol` only counts the
 * trades it sees (the bundle and the agent's own), so on pump.fun it understates a busy chart by orders of magnitude
 * and the sell guardrail — keyed on traded volume — would stay at its floor. The indexer counts every pump.fun /
 * PumpSwap trade; this reads its `volumeSol` per launch, refreshed in the background, never on the hot path.
 */
export class PublicVolume {
  private readonly lamports = new Map<string, bigint>();
  private readonly fetchedAt = new Map<string, number>();
  private readonly inflight = new Set<string>();
  /** Highest price (SOL per token) over the last 24 h from the indexer's hourly candles: survives agent restarts. */
  private readonly high = new Map<string, number>();
  private readonly highAt = new Map<string, number>();
  /** Per-minute highs (time → high, SOL per token) of the last 15 minutes from the indexer's 1-minute candles. */
  private readonly minuteHighs = new Map<string, { time: number; high: number }[]>();
  private readonly minuteAt = new Map<string, number>();

  constructor(
    private readonly indexerUrl: string | null,
    private readonly internalToken: string | null,
    private readonly refreshMs = 10_000,
    private readonly log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
  ) {}

  /** Last known total volume (lamports) of `launch`, or null; schedules a refresh when stale. */
  get(launch: string): bigint | null {
    if (!this.indexerUrl) return null;
    const at = this.fetchedAt.get(launch) ?? 0;
    if (Date.now() - at >= this.refreshMs) void this.refresh(launch);
    return this.lamports.get(launch) ?? null;
  }

  /** Indexed 24 h high (SOL per token) of `launch`, or null; refreshed at most once a minute. */
  high24h(launch: string): number | null {
    if (!this.indexerUrl) return null;
    if (Date.now() - (this.highAt.get(launch) ?? 0) >= 60_000) void this.refreshHigh(launch);
    return this.high.get(launch) ?? null;
  }

  /** Indexed high (SOL per token) over the last `secs` seconds of `launch`, or null; refreshed every 10 s. */
  recentHigh(launch: string, secs: number): number | null {
    if (!this.indexerUrl) return null;
    if (Date.now() - (this.minuteAt.get(launch) ?? 0) >= 10_000) void this.refreshMinutes(launch);
    const since = Date.now() / 1000 - secs;
    let high = 0;
    for (const c of this.minuteHighs.get(launch) ?? []) if (c.time + 60 > since && c.high > high) high = c.high;
    return high > 0 ? high : null;
  }

  private async refreshMinutes(launch: string): Promise<void> {
    const key = `min:${launch}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    this.minuteAt.set(launch, Date.now());
    try {
      const res = await fetch(`${this.indexerUrl}/api/launches/${launch}/candles?tf=60`, {
        headers: this.internalToken ? { "x-holdfast-internal": this.internalToken } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { candles?: { time: number; high: number }[] };
      const since = Date.now() / 1000 - 1_800;
      this.minuteHighs.set(launch, (body.candles ?? []).filter((c) => c.time >= since).map((c) => ({ time: c.time, high: c.high })));
    } catch (err) {
      this.log("minute candles fetch failed", { launch, err: String(err) });
    } finally {
      this.inflight.delete(key);
    }
  }

  private async refreshHigh(launch: string): Promise<void> {
    const key = `high:${launch}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    this.highAt.set(launch, Date.now());
    try {
      const res = await fetch(`${this.indexerUrl}/api/launches/${launch}/candles?tf=3600`, {
        headers: this.internalToken ? { "x-holdfast-internal": this.internalToken } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { candles?: { time: number; high: number }[] };
      const since = Date.now() / 1000 - 86_400;
      let high = 0;
      for (const c of body.candles ?? []) if (c.time + 3_600 > since && c.high > high) high = c.high;
      if (high > 0) this.high.set(launch, high);
    } catch (err) {
      this.log("24h high fetch failed", { launch, err: String(err) });
    } finally {
      this.inflight.delete(key);
    }
  }

  private async refresh(launch: string): Promise<void> {
    if (this.inflight.has(launch)) return;
    this.inflight.add(launch);
    this.fetchedAt.set(launch, Date.now());
    try {
      const res = await fetch(`${this.indexerUrl}/api/launches/${launch}`, {
        headers: this.internalToken ? { "x-holdfast-internal": this.internalToken } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { volumeSol?: string | number };
      if (body.volumeSol === undefined || body.volumeSol === null) return;
      this.lamports.set(launch, BigInt(String(body.volumeSol).split(".")[0]!));
    } catch (err) {
      this.log("public volume fetch failed", { launch, err: String(err) });
    } finally {
      this.inflight.delete(launch);
    }
  }
}
