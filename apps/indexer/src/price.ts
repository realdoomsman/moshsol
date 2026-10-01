import type { FastifyBaseLogger } from "fastify";

const WSOL = "So11111111111111111111111111111111111111112";
const STATE_KEY = "sol_usd";
const FETCH_TIMEOUT_MS = 5_000;

/** The SOL/USD price in use and the unix time it was fetched. */
export interface SolUsd {
  usd: number;
  at: number;
}

export interface PriceSource {
  name: string;
  url: string;
  /** Pulls the USD price out of the decoded JSON body; anything but a finite positive number is rejected. */
  parse: (body: unknown) => unknown;
}

/** Keyless public feeds, tried in order on every refresh. */
export const PRICE_SOURCES: readonly PriceSource[] = [
  {
    name: "jupiter",
    url: `https://lite-api.jup.ag/price/v3?ids=${WSOL}`,
    parse: (body) => (body as Record<string, { usdPrice?: unknown } | undefined>)?.[WSOL]?.usdPrice,
  },
  {
    name: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    parse: (body) => (body as { solana?: { usd?: unknown } })?.solana?.usd,
  },
];

/** The slice of `Store` the poller persists through (`sync_state`). */
export interface PriceState {
  getState(key: string): string | null;
  setState(key: string, value: string): void;
}

export interface PriceOptions {
  refreshMs: number;
  sources?: readonly PriceSource[];
  fetch?: typeof fetch;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

function loadState(store: PriceState): SolUsd | null {
  const raw = store.getState(STATE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SolUsd>;
    return typeof v.usd === "number" && Number.isFinite(v.usd) && v.usd > 0 && typeof v.at === "number" ? { usd: v.usd, at: v.at } : null;
  } catch {
    return null;
  }
}

/**
 * SOL/USD poller: refreshes every `refreshMs` from the first source that answers, keeps the last good value in
 * memory and in `sync_state` (so a restart during a feed outage still prices launches), and never clears it — a
 * feed outage is logged once when it starts and once when it ends, like the chain sync's outages.
 */
export class SolPrice {
  private value: SolUsd | null;
  private timer: NodeJS.Timeout | null = null;
  private failing = false;
  private readonly sources: readonly PriceSource[];
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly store: PriceState,
    private readonly log: Pick<FastifyBaseLogger, "info" | "warn">,
    private readonly opts: PriceOptions,
  ) {
    this.sources = opts.sources ?? PRICE_SOURCES;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.value = loadState(store);
  }

  /** Last good price, or null until the first successful fetch (and nothing persisted). */
  get current(): SolUsd | null {
    return this.value;
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tries every source in order; resolves to the fresh price, or null (last value kept) when all failed. */
  async refresh(): Promise<SolUsd | null> {
    const errors: Record<string, string> = {};
    for (const source of this.sources) {
      try {
        const value = { usd: await this.fetchFrom(source), at: this.now() };
        this.value = value;
        this.store.setState(STATE_KEY, JSON.stringify(value));
        if (this.failing) {
          this.failing = false;
          this.log.info({ source: source.name, usd: value.usd }, "sol price feed recovered");
        }
        return value;
      } catch (err) {
        errors[source.name] = err instanceof Error ? err.message : String(err);
      }
    }
    if (!this.failing) {
      this.failing = true;
      this.log.warn({ errors, lastGoodAt: this.value?.at ?? null }, "sol price feeds unavailable; keeping the last price");
    }
    return null;
  }

  private async fetchFrom(source: PriceSource): Promise<number> {
    const res = await this.fetch(source.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const usd = source.parse(await res.json());
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) throw new Error(`unexpected price ${JSON.stringify(usd)}`);
    return usd;
  }
}
