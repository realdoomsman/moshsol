import type { FastifyInstance, FastifyReply } from "fastify";
import WebSocket from "ws";
import { Limiter, sweepLimiters } from "./ratelimit";
import { isRecord } from "./sanitize";

/**
 * JSON-RPC methods the web app issues through web3.js, spl-token, Anchor and the wallet adapter
 * (`getParsedAccountInfo`/`getMint`/`fetchNullable` → getAccountInfo, confirmTransaction → getSignatureStatuses +
 * getBlockHeight, faucet → requestAirdrop, failed-tx logs → getTransaction) plus cheap cluster probes.
 * Account scans (getProgramAccounts, getTokenAccountsByOwner, …) are never proxied.
 */
const HTTP_METHODS: Record<string, true> = {
  getAccountInfo: true,
  getMultipleAccounts: true,
  getBalance: true,
  getTokenAccountBalance: true,
  getLatestBlockhash: true,
  isBlockhashValid: true,
  getBlockHeight: true,
  getSlot: true,
  getSignatureStatuses: true,
  getTransaction: true,
  getRecentPrioritizationFees: true,
  getFeeForMessage: true,
  getMinimumBalanceForRentExemption: true,
  simulateTransaction: true,
  sendTransaction: true,
  requestAirdrop: true,
  getGenesisHash: true,
  getHealth: true,
  getEpochInfo: true,
  getVersion: true,
};
/** PubSub methods: onAccountChange, confirmTransaction, slot probes, and web3.js's `ping` keepalive notification. */
const WS_METHODS: Record<string, true> = {
  accountSubscribe: true,
  accountUnsubscribe: true,
  signatureSubscribe: true,
  signatureUnsubscribe: true,
  slotSubscribe: true,
  slotUnsubscribe: true,
  ping: true,
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_WS_PER_IP = 10;
const MAX_SUBS_PER_WS = 32;
/** Client frames buffered while the upstream socket is still connecting. */
const MAX_WS_BACKLOG = 32;

type RpcId = string | number | null;

const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function callId(call: unknown): RpcId {
  const id = isRecord(call) ? call.id : null;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Opt-in (RPC_PROXY) browser-facing proxy so a keyed RPC_URL/WS_URL never ships to the client:
 * `POST /rpc` forwards single/batch JSON-RPC to RPC_URL, `GET /rpc-ws` pipes PubSub to WS_URL. Both allow only
 * the methods above (others get -32601) and count every call against `perMin` per client IP (0 disables).
 */
export function registerRpcProxy(app: FastifyInstance, opts: { rpcUrl: string; wsUrl: string; perMin: number }): void {
  const limiter = opts.perMin > 0 ? new Limiter(opts.perMin) : null;
  if (limiter) sweepLimiters(app, [limiter]);

  const tooMany = (reply: FastifyReply, wait: number) =>
    reply
      .code(429)
      .header("Retry-After", String(wait))
      .send({ error: `rate limit exceeded (${opts.perMin} RPC calls/min); retry in ${wait}s` });

  app.post("/rpc", { bodyLimit: MAX_BODY_BYTES }, async (req, reply) => {
    const batch = Array.isArray(req.body);
    const calls: unknown[] = batch ? (req.body as unknown[]) : [req.body];
    if (calls.length === 0 || calls.length > MAX_BATCH) {
      return reply.send(rpcError(null, -32600, `batch must hold 1-${MAX_BATCH} calls`));
    }
    const over = limiter?.hit(req.ip, Date.now(), calls.length);
    if (over) {
      if (over.first) req.log.warn({ ip: req.ip, perMin: opts.perMin }, "rpc proxy rate limit hit");
      return tooMany(reply, over.wait);
    }

    const allowed: unknown[] = [];
    const rejected: object[] = [];
    for (const call of calls) {
      if (!isRecord(call) || typeof call.method !== "string") rejected.push(rpcError(callId(call), -32600, "invalid request"));
      else if (!Object.hasOwn(HTTP_METHODS, call.method)) {
        rejected.push(rpcError(callId(call), -32601, `method ${call.method.slice(0, 64)} is not available through this proxy`));
      } else allowed.push(call);
    }
    if (allowed.length === 0) return reply.send(batch ? rejected : rejected[0]);

    let upstream: Response;
    try {
      upstream = await fetch(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch ? allowed : allowed[0]),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      req.log.warn({ err: String(err), cause: String((err as Error).cause ?? "") }, "rpc proxy upstream failed");
      return reply.code(502).send(rpcError(null, -32603, "upstream RPC unavailable"));
    }
    const text = await upstream.text();
    if (rejected.length > 0 && upstream.ok) {
      try {
        const results: unknown = JSON.parse(text);
        if (Array.isArray(results)) return reply.send([...results, ...rejected]);
      } catch {
        // Not JSON: relay as-is below.
      }
    }
    return reply.code(upstream.status).type("application/json").send(text);
  });

  const socketsPerIp = new Map<string, number>();
  app.get("/rpc-ws", { websocket: true }, (socket, req) => {
    const ip = req.ip;
    const open = socketsPerIp.get(ip) ?? 0;
    if (open >= MAX_WS_PER_IP) return socket.close(1008, "too many connections");
    if (limiter?.hit(ip, Date.now())) return socket.close(1008, "rate limit exceeded");
    socketsPerIp.set(ip, open + 1);

    const upstream = new WebSocket(opts.wsUrl);
    let clientGone = false;
    const backlog: string[] = [];
    /** Subscription ids confirmed by upstream, and in-flight (un)subscribe requests keyed by client request id. */
    const subs = new Set<number>();
    const inflight = new Map<string | number, { unsubscribe: number | null }>();
    const reply = (id: RpcId, code: number, message: string) => socket.send(JSON.stringify(rpcError(id, code, message)));

    upstream.on("open", () => {
      for (const msg of backlog) upstream.send(msg);
      backlog.length = 0;
    });
    upstream.on("message", (data, isBinary) => {
      if (inflight.size > 0 && !isBinary) {
        try {
          const msg: unknown = JSON.parse(data.toString());
          const id = callId(msg);
          const pending = id === null ? undefined : inflight.get(id);
          if (pending && isRecord(msg)) {
            inflight.delete(id!);
            if (pending.unsubscribe === null && typeof msg.result === "number") subs.add(msg.result);
            if (pending.unsubscribe !== null && msg.result === true) subs.delete(pending.unsubscribe);
          }
        } catch {
          // Unparseable upstream frames are relayed untouched.
        }
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
    });
    upstream.on("close", () => socket.close(1011, "upstream closed"));
    upstream.on("error", (err) => {
      // Terminating a still-connecting upstream after the client left also lands here.
      if (clientGone) return;
      req.log.warn({ err: err.message }, "rpc-ws upstream error");
      socket.close(1011, "upstream RPC unavailable");
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) return socket.close(1003, "text frames only");
      const text = data.toString();
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch {
        return reply(null, -32700, "parse error");
      }
      const id = callId(msg);
      if (!isRecord(msg) || typeof msg.method !== "string") return reply(id, -32600, "invalid request");
      const method = msg.method;
      if (!Object.hasOwn(WS_METHODS, method)) return reply(id, -32601, `method ${method.slice(0, 64)} is not available through this proxy`);
      if (limiter?.hit(ip, Date.now())) {
        // Notifications (web3.js's ping) have no id and expect no answer.
        if (id !== null) reply(id, -32005, `rate limit exceeded (${opts.perMin} RPC calls/min)`);
        return;
      }
      if (method.endsWith("Subscribe") || method.endsWith("Unsubscribe")) {
        if (id === null) return reply(null, -32600, "subscription requests need an id");
        const unsubscribe = method.endsWith("Unsubscribe");
        const target = unsubscribe && Array.isArray(msg.params) ? msg.params[0] : null;
        if (unsubscribe && typeof target !== "number") return reply(id, -32602, "expected [subscriptionId]");
        if (!unsubscribe) {
          let pending = 0;
          for (const r of inflight.values()) if (r.unsubscribe === null) pending++;
          if (subs.size + pending >= MAX_SUBS_PER_WS) return reply(id, -32005, `at most ${MAX_SUBS_PER_WS} subscriptions per connection`);
        }
        inflight.set(id, { unsubscribe: unsubscribe ? (target as number) : null });
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else if (upstream.readyState === WebSocket.CONNECTING && backlog.length < MAX_WS_BACKLOG) backlog.push(text);
      else socket.close(1011, "upstream RPC unavailable");
    });

    socket.on("close", () => {
      clientGone = true;
      const left = (socketsPerIp.get(ip) ?? 1) - 1;
      if (left > 0) socketsPerIp.set(ip, left);
      else socketsPerIp.delete(ip);
      upstream.terminate();
    });
  });
}
