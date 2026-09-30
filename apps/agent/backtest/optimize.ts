import { mulberry32, type Rng } from "./sim";

/**
 * Search over a box of numeric parameters (the policy's `PARAM_SPACE`, or the launch terms) in a
 * normalized cube [0, 1]^d (log-scaled where the box says so): seeded random search for a broad
 * start, then CMA-ES (Hansen, "The CMA Evolution Strategy: A Tutorial", arXiv:1604.00772) from the
 * best random point. Out-of-cube samples are evaluated at the clipped point minus a distance
 * penalty, so the mean stays inside.
 */

export interface Bounds {
  lo: number;
  hi: number;
  log?: boolean;
  /** Decoded values are rounded to integers (on-chain terms). */
  int?: boolean;
}

/** The tuned subset `keys` of a point; every other field stays at its value in `base`. */
export class SearchSpace<K extends string, P extends Record<K, number>> {
  constructor(
    readonly box: Record<K, Bounds>,
    readonly keys: K[],
    readonly base: P,
  ) {}

  encode(p: P): number[] {
    return this.keys.map((k) => {
      const { lo, hi, log } = this.box[k];
      return log ? Math.log(p[k] / lo) / Math.log(hi / lo) : (p[k] - lo) / (hi - lo);
    });
  }

  decode(u: number[]): P {
    const out = { ...this.base };
    this.keys.forEach((k, i) => {
      const { lo, hi, log, int } = this.box[k];
      const v = Math.min(1, Math.max(0, u[i]!));
      const x = log ? lo * (hi / lo) ** v : lo + v * (hi - lo);
      (out as Record<K, number>)[k] = int ? Math.min(hi, Math.max(lo, Math.round(x))) : x;
    });
    return out;
  }
}

export type Fitness<P> = (batch: P[]) => Promise<number[]>;

export interface Trial<P> {
  params: P;
  score: number;
}

export async function randomSearch<K extends string, P extends Record<K, number>>(
  space: SearchSpace<K, P>,
  n: number,
  seeds: P[],
  fitness: Fitness<P>,
  rng: Rng,
): Promise<Trial<P>[]> {
  const batch = [...seeds, ...Array.from({ length: n }, () => space.decode(space.keys.map(() => rng())))];
  const scores = await fitness(batch);
  return batch.map((params, i) => ({ params, score: scores[i]! })).sort((a, b) => b.score - a.score);
}

/** Symmetric eigendecomposition (cyclic Jacobi): C = B diag(d) Bᵀ. */
function eigen(c: number[][]): { b: number[][]; d: number[] } {
  const n = c.length;
  const a = c.map((r) => [...r]);
  const b: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-30) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = cs * akp - sn * akq;
          a[k]![q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = cs * apk - sn * aqk;
          a[q]![k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < n; k++) {
          const bkp = b[k]![p]!;
          const bkq = b[k]![q]!;
          b[k]![p] = cs * bkp - sn * bkq;
          b[k]![q] = sn * bkp + cs * bkq;
        }
      }
    }
  }
  return { b, d: a.map((r, i) => Math.max(1e-20, r[i]!)) };
}

export interface CmaOptions<P> {
  sigma: number;
  generations: number;
  seed: number;
  onGeneration?: (gen: number, best: Trial<P>, sigma: number) => void;
}

/** Maximizes `fitness` over `space` from `start`; returns every evaluated trial, best first. */
export async function cmaes<K extends string, P extends Record<K, number>>(
  space: SearchSpace<K, P>,
  start: P,
  fitness: Fitness<P>,
  o: CmaOptions<P>,
): Promise<Trial<P>[]> {
  const rng = mulberry32(o.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const n = space.keys.length;
  const lambda = 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  const rawW = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = rawW.reduce((s, w) => s + w, 0);
  const w = rawW.map((x) => x / wSum);
  const muEff = 1 / w.reduce((s, x) => s + x * x, 0);
  const cs = (muEff + 2) / (n + muEff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
  const c1 = 2 / ((n + 1.3) ** 2 + muEff);
  const cmu = Math.min(1 - c1, (2 * (muEff - 2 + 1 / muEff)) / ((n + 2) ** 2 + muEff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  let m = space.encode(start);
  let sigma = o.sigma;
  let pc = new Array<number>(n).fill(0);
  let ps = new Array<number>(n).fill(0);
  let C: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const trials: Trial<P>[] = [];

  for (let g = 0; g < o.generations; g++) {
    const { b, d } = eigen(C);
    const sd = d.map(Math.sqrt);
    const ys = Array.from({ length: lambda }, () => {
      const z = Array.from({ length: n }, gauss);
      return b.map((row) => row.reduce((s, bij, j) => s + bij * sd[j]! * z[j]!, 0));
    });
    const xs = ys.map((y) => m.map((mi, i) => mi + sigma * y[i]!));
    const raw = await fitness(xs.map((x) => space.decode(x)));
    const scores = xs.map((x, i) => raw[i]! - 100 * x.reduce((s, xi) => s + (xi - Math.min(1, Math.max(0, xi))) ** 2, 0));
    xs.forEach((x, i) => trials.push({ params: space.decode(x), score: raw[i]! }));
    const order = scores.map((_, i) => i).sort((a, c) => scores[c]! - scores[a]!);

    const old = m;
    m = Array.from({ length: n }, (_, i) => order.slice(0, mu).reduce((s, k, r) => s + w[r]! * xs[k]![i]!, 0));
    const yw = m.map((mi, i) => (mi - old[i]!) / sigma);
    // C^{-1/2} yw = B diag(1/sqrt d) Bᵀ yw
    const bty = b[0]!.map((_, j) => b.reduce((s, row, i) => s + row[j]! * yw[i]!, 0));
    const inv = b.map((row) => row.reduce((s, bij, j) => s + (bij * bty[j]!) / sd[j]!, 0));
    ps = ps.map((p, i) => (1 - cs) * p + Math.sqrt(cs * (2 - cs) * muEff) * inv[i]!);
    const psNorm = Math.sqrt(ps.reduce((s, p) => s + p * p, 0));
    const hs = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) < (1.4 + 2 / (n + 1)) * chiN ? 1 : 0;
    pc = pc.map((p, i) => (1 - cc) * p + hs * Math.sqrt(cc * (2 - cc) * muEff) * yw[i]!);
    const sel = order.slice(0, mu).map((k) => ys[k]!);
    C = C.map((row, i) =>
      row.map(
        (cij, j) =>
          (1 - c1 - cmu) * cij +
          c1 * (pc[i]! * pc[j]! + (1 - hs) * cc * (2 - cc) * cij) +
          cmu * sel.reduce((s, y, r) => s + w[r]! * y[i]! * y[j]!, 0),
      ),
    );
    sigma *= Math.exp((cs / ds) * (psNorm / chiN - 1));
    const best = trials.reduce((a, t) => (t.score > a.score ? t : a));
    o.onGeneration?.(g, best, sigma);
  }
  return trials.sort((a, b) => b.score - a.score);
}
