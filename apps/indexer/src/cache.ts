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
