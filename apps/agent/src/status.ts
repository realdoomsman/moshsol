import { once } from "node:events";
import http from "node:http";

/** One entry of `GET /status` → `decisions` (see the Agent status API contract). */
export interface Decision {
  mint: string;
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
}

/**
 * One entry of `GET /status` → `windDowns`: a `wind_down` the agent cranked for a launch that met every rule
 * (in dry run: would have sent). Neither `signature` nor `error` = dry run.
 */
export interface WindDown {
  mint: string;
  symbol?: string;
  /** Unix seconds (wall clock) of the attempt. */
  at: number;
  signature?: string;
  error?: string;
  /** From the landed `WoundDown` event: lamports credited to backers, token base units returned to the curve. */
  solToBackers?: string;
  tokensReturned?: string;
}

export interface StatusSnapshot {
  agent: string;
  dryRun: boolean;
  startedAt: number;
  lastTickAt: number | null;
  tick: number;
  /** Fee wallet balance as of the last tick (null before the first). */
  balanceSol: number | null;
  decisions: Decision[];
  /** Recent wind-down attempts, newest first. */
  windDowns: WindDown[];
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
