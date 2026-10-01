import { once } from "node:events";
import http from "node:http";
import type { LaunchVenue } from "@holdfast/sdk";
import type { FlowFeatures } from "./flow";

/** One entry of `GET /status` → `decisions` (see the Agent status API contract). */
export interface Decision {
  /** The launch PDA (what the agent keys everything by; pump launches share the default mint before `launch_pump`). */
  address: string;
  mint: string;
  venue: LaunchVenue;
  symbol?: string;
  /** Unix seconds (wall clock) when the decision was made. */
  at: number;
  action: "buy" | "sell" | "hold" | "skip";
  reason: string;
  priceSol: number;
  emaSol: number;
  bandLowSol: number;
  bandHighSol: number;
  /** Lamports for buys, token base units for sells. */
  amount?: string;
  signature?: string;
  error?: string;
  /** Public order flow seen between polls (src/flow.ts): what the flow knobs and the sell guardrail looked at. */
  flow: FlowFeatures;
}

export type CrankKind = "collect_fees" | "buyback_burn" | "graduate" | "wind_down";

/**
 * One entry of `GET /status` → `cranks`: a permissionless instruction the agent cranked for a launch that met
 * every rule (in dry run: would have sent). Neither `signature` nor `error` = dry run.
 */
export interface CrankAttempt {
  kind: CrankKind;
  address: string;
  mint: string;
  venue: LaunchVenue;
  symbol?: string;
  /** Unix seconds (wall clock) of the attempt. */
  at: number;
  signature?: string;
  error?: string;
  /** Lamports, from the landed event: fees collected, SOL spent on the buyback, or SOL credited to backers at wind-down. */
  amount?: string;
  /** Token base units, from the landed event: burned by the buyback, or returned to the curve / sold at wind-down. */
  tokens?: string;
}

export interface StatusSnapshot {
  agent: string;
  dryRun: boolean;
  startedAt: number;
  lastTickAt: number | null;
  tick: number;
  /** Fee wallet balance as of the last tick (null before the first). */
  balanceSol: number | null;
  /** Address lookup table used for PumpSwap trades once created or configured (`AGENT_ALT`). */
  lookupTable: string | null;
  decisions: Decision[];
  /** Recent crank attempts, newest first. */
  cranks: CrankAttempt[];
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function startStatusServer(
  host: string,
  port: number,
  snapshot: () => StatusSnapshot,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (pathname !== "/status") send(404, { error: "not found" });
    else if (req.method !== "GET") send(405, { error: "method not allowed" });
    else send(200, snapshot());
  });
  server.listen(port, host);
  await once(server, "listening");
  return server;
}
