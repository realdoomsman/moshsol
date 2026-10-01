import type { ActivityDbRow } from "./db";
import type { ActivityEvent } from "./types";

/** An indexed event row (joined with its launch) as the wire `ActivityEvent`. */
export function activityFromRow(r: ActivityDbRow): ActivityEvent {
  const ev: ActivityEvent = {
    id: `${r.signature}:${r.event_index}`,
    type: r.type,
    signature: r.signature,
    timestamp: r.timestamp,
    launch: r.launch,
    venue: r.venue,
    mint: r.mint,
    symbol: r.symbol,
    name: r.name,
    image: r.image,
    actor: r.actor,
  };
  if (r.is_agent !== null) ev.isAgent = r.is_agent === 1;
  if (r.is_buy !== null) ev.isBuy = r.is_buy === 1;
  if (r.sol_amount !== null) ev.solAmount = r.sol_amount;
  if (r.token_amount !== null) ev.tokenAmount = r.token_amount;
  if (r.ref !== null) ev.ref = r.ref;
  return ev;
}
