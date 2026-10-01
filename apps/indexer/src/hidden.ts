import { DEFAULT_PUBKEY } from "./db";

/**
 * Launches kept off every list and discovery surface (`HIDDEN_LAUNCHES`: launch addresses and/or mints): the launch
 * list and its search, trending, `/api/search`, the launches leaderboard, stats, the global activity feed, profiles
 * and `/ws` list pushes. They still resolve by id (`/api/launches/:id` and its sub-routes), flagged `hidden: true`.
 */
export class HiddenLaunches {
  private readonly ids: ReadonlySet<string>;

  constructor(ids: Iterable<string> = []) {
    this.ids = new Set(ids);
  }

  /** Configured ids: each hides at most one launch, so a list over-fetched by this many still fills its page. */
  get size(): number {
    return this.ids.size;
  }

  /** By address, or by mint once the launch has one (a pump launch has none while raising). */
  has(launch: { address: string; mint: string }): boolean {
    return this.ids.has(launch.address) || (launch.mint !== DEFAULT_PUBKEY && this.ids.has(launch.mint));
  }
}
