import { DEFAULT_PUBKEY } from "./db";

/** Name/symbol columns a launch row may carry (metadata first, then on-chain). */
interface Named {
  address: string;
  mint: string;
  meta_name?: string | null;
  onchain_name?: string | null;
  meta_symbol?: string | null;
  onchain_symbol?: string | null;
  /** Summary objects (WS pushes) carry the resolved name/symbol instead. */
  name?: string | null;
  symbol?: string | null;
}

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Launches kept off every list and discovery surface (`HIDDEN_LAUNCHES`: launch addresses and/or mints): the launch
 * list and its search, trending, `/api/search`, the launches leaderboard, stats, the global activity feed, profiles
 * and `/ws` list pushes. They still resolve by id (`/api/launches/:id` and its sub-routes), flagged `hidden: true`.
 *
 * Brand impersonators are hidden automatically: any launch whose name contains "holdfast" (ignoring case, spaces
 * and punctuation) or whose symbol is "HOLD", unless its mint is listed in `OFFICIAL_MINTS`. Those are also flagged
 * `impersonator: true`, which the web treats as not found.
 */
export class HiddenLaunches {
  private readonly ids: ReadonlySet<string>;
  private readonly official: ReadonlySet<string>;

  constructor(ids: Iterable<string> = [], official: Iterable<string> = []) {
    this.ids = new Set(ids);
    this.official = new Set(official);
  }

  /** Configured ids: each hides at most one launch, so a list over-fetched by this many still fills its page. */
  get size(): number {
    return this.ids.size;
  }

  /** Uses the Holdfast name or the $HOLD ticker without being an official mint. */
  impersonator(launch: Named): boolean {
    if (launch.mint !== DEFAULT_PUBKEY && this.official.has(launch.mint)) return false;
    const names = [launch.meta_name, launch.onchain_name, launch.name].map(squash);
    const symbols = [launch.meta_symbol, launch.onchain_symbol, launch.symbol].map(squash);
    return names.some((n) => n.includes("holdfast")) || symbols.some((s) => s === "hold" || s.includes("holdfast"));
  }

  /** By address, or by mint once the launch has one (a pump launch has none while raising), or as an impersonator. */
  has(launch: Named): boolean {
    return this.ids.has(launch.address) || (launch.mint !== DEFAULT_PUBKEY && this.ids.has(launch.mint)) || this.impersonator(launch);
  }
}
