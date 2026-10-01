/**
 * Values cached per key for `ttlMs`; concurrent loads of one key share a single in-flight promise, so a
 * burst of requests for the same key costs one upstream call. Bounded to `maxKeys` entries (expired ones
 * go first, then the oldest) because keys may be caller-chosen (wallets).
 */
export class TtlCache<V> {
  private readonly hits = new Map<string, { value: V; at: number }>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.hits.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private set(key: string, value: V): void {
    this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) {
      const now = this.now();
      for (const [k, v] of this.hits) if (now - v.at >= this.ttlMs) this.hits.delete(k);
      // Map iteration is insertion order, so the first key is the oldest.
      if (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    }
    this.hits.set(key, { value, at: this.now() });
  }
}

/**
 * Synchronous values derived from the database, one slot per key: a value is reused while `version()` is unchanged
 * and it is younger than `ttlMs`, else recomputed. `version` moves on every write (`Store.dataVersion`), so readers
 * see a write at once; `ttlMs` only bounds the drift of values that also depend on the clock (rolling 1h/24h windows).
 * Keys must come from a bounded set (fixed names, known launches × timeframes): slots are never evicted.
 */
export class ReadCache {
  private readonly slots = new Map<string, { version: number; at: number; value: unknown }>();

  constructor(
    private readonly version: () => number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get<V>(key: string, compute: () => V): V {
    const version = this.version();
    const at = this.now();
    const hit = this.slots.get(key);
    if (hit && hit.version === version && at - hit.at < this.ttlMs) return hit.value as V;
    const value = compute();
    this.slots.set(key, { version, at, value });
    return value;
  }
}
