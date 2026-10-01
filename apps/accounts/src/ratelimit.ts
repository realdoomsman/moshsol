const WINDOW_MS = 60_000;

/** Fixed one-minute request windows per key (client IP, user id). Same scheme as the indexer's limiter. */
export class Limiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(readonly perMin: number) {}

  /** Counts `n` requests; null while within budget, else the seconds until the window resets. */
  hit(key: string, now: number, n = 1): number | null {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(key, w);
    }
    w.count += n;
    return w.count <= this.perMin ? null : Math.ceil((w.resetAt - now) / 1000);
  }

  sweep(now: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
