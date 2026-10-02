import type { Commitment, TransactionError } from "@solana/web3.js";
import { log } from "./log";

/**
 * One JSON-RPC websocket carrying every subscription the agent holds (`accountSubscribe` for the live launches,
 * their venue accounts, the platform and the clock sysvar; `slotSubscribe`; one-shot `signatureSubscribe` for
 * the agent's own sends). It reconnects with exponential back-off and re-subscribes everything; a socket that
 * goes quiet for STALE_MS is replaced (the clock sysvar changes every slot, so a live socket never does).
 * `healthy` says whether the data it delivers can stand in for a fresh RPC read.
 */

/** No message for this long: the socket is presumed dead (half-open) and replaced. */
const STALE_MS = 5_000;
/** `healthy` needs a message within this window (≈ 5 slots). */
const HEALTHY_MS = 2_000;
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
const WATCHDOG_MS = 1_000;

export interface AccountUpdate {
  data: Buffer;
  lamports: number;
  /** Slot of the bank the update was read from (for `processed`: the slot the change landed in). */
  slot: number;
  /** Wall-clock ms the notification arrived. */
  at: number;
}

export interface SignatureUpdate {
  /** Transaction error of a landed failure; null = success. */
  err: TransactionError | null;
  slot: number;
  at: number;
}

type Sub =
  | { method: "accountSubscribe"; params: unknown[]; onAccount: (u: AccountUpdate) => void }
  | { method: "slotSubscribe"; params: unknown[]; onSlot: (slot: number, at: number) => void }
  | { method: "signatureSubscribe"; params: unknown[]; onSignature: (u: SignatureUpdate) => void };

const UNSUBSCRIBE: Record<Sub["method"], string> = {
  accountSubscribe: "accountUnsubscribe",
  slotSubscribe: "slotUnsubscribe",
  signatureSubscribe: "signatureUnsubscribe",
};

export interface StreamStats {
  connected: boolean;
  healthy: boolean;
  subscriptions: number;
  notifications: number;
  reconnects: number;
  /** Unix ms of the last message (null before the first). */
  lastMessageAt: number | null;
}

/** The websocket endpoint of an RPC URL: https → wss, an explicit port + 1 (the validator convention, 8899 → 8900). */
export function wsUrlOf(rpcUrl: string): string {
  const u = new URL(rpcUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (u.port) u.port = String(Number(u.port) + 1);
  return u.toString();
}

export class Stream {
  private ws: WebSocket | null = null;
  private open = false;
  /** Local id → subscription; survives reconnects. */
  private readonly subs = new Map<number, Sub>();
  /** Server subscription id ↔ local id, for the current socket only. */
  private readonly byServer = new Map<number, number>();
  private readonly toServer = new Map<number, number>();
  /** JSON-RPC request id → the subscribe it answers (local id and method). */
  private readonly requests = new Map<number, { local: number; method: Sub["method"] }>();
  private nextLocal = 1;
  private nextRequest = 1;
  private backoffMs = MIN_BACKOFF_MS;
  private connectStartedAt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly watchdog: NodeJS.Timeout;
  private closed = false;
  private lastMessageAt: number | null = null;
  private notifications = 0;
  private reconnects = 0;
  /** Sockets opened so far: a new value means notifications may have been missed in between. */
  private opens = 0;

  constructor(
    private readonly url: string,
    private readonly commitment: Commitment,
  ) {
    this.watchdog = setInterval(() => this.check(), WATCHDOG_MS);
    this.watchdog.unref();
    this.connect();
  }

  /** Connected and delivering: its data is as fresh as an RPC read. */
  get healthy(): boolean {
    return this.open && this.lastMessageAt !== null && Date.now() - this.lastMessageAt < HEALTHY_MS;
  }

  /** Changes whenever a socket opens (subscriptions are re-made; changes in the gap were not delivered). */
  get epoch(): number {
    return this.opens;
  }

  stats(): StreamStats {
    return {
      connected: this.open,
      healthy: this.healthy,
      subscriptions: this.subs.size,
      notifications: this.notifications,
      reconnects: this.reconnects,
      lastMessageAt: this.lastMessageAt,
    };
  }

  account(address: string, onAccount: (u: AccountUpdate) => void): number {
    return this.add({ method: "accountSubscribe", params: [address, { encoding: "base64", commitment: this.commitment }], onAccount });
  }

  slots(onSlot: (slot: number, at: number) => void): number {
    return this.add({ method: "slotSubscribe", params: [], onSlot });
  }

  /** One notification when `signature` reaches `commitment`, then the subscription ends (server side too). */
  signature(signature: string, commitment: Commitment, onSignature: (u: SignatureUpdate) => void): number {
    return this.add({ method: "signatureSubscribe", params: [signature, { commitment }], onSignature });
  }

  remove(id: number): void {
    const sub = this.subs.get(id);
    if (!sub) return;
    this.subs.delete(id);
    const server = this.toServer.get(id);
    if (server === undefined) return;
    this.toServer.delete(id);
    this.byServer.delete(server);
    // A signature subscription that already notified was dropped on both sides then; one still waiting is ended here.
    this.send(UNSUBSCRIBE[sub.method], [server]);
  }

  close(): void {
    this.closed = true;
    clearInterval(this.watchdog);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private add(sub: Sub): number {
    const id = this.nextLocal++;
    this.subs.set(id, sub);
    if (this.open) this.subscribe(id, sub);
    return id;
  }

  private subscribe(id: number, sub: Sub): void {
    const request = this.send(sub.method, sub.params);
    if (request !== null) this.requests.set(request, { local: id, method: sub.method });
  }

  private send(method: string, params: unknown[]): number | null {
    if (!this.ws || !this.open) return null;
    const id = this.nextRequest++;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return id;
  }

  private connect(): void {
    if (this.closed) return;
    this.reconnectTimer = null;
    this.connectStartedAt = Date.now();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.opens += 1;
      this.lastMessageAt = Date.now();
      for (const [id, sub] of this.subs) this.subscribe(id, sub);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.onMessage(String(ev.data));
    };
    ws.onclose = () => this.dropped(ws, "closed");
    ws.onerror = () => this.dropped(ws, "error");
  }

  private dropped(ws: WebSocket, why: string): void {
    if (this.ws !== ws) return;
    const wasOpen = this.open;
    this.ws = null;
    this.open = false;
    this.byServer.clear();
    this.toServer.clear();
    this.requests.clear();
    try {
      ws.close();
    } catch {
      // already closing
    }
    if (this.closed) return;
    this.reconnects += 1;
    log("stream_reconnect", { why, wasOpen, retryInMs: this.backoffMs, origin: new URL(this.url).origin });
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private check(): void {
    if (!this.ws) return;
    const now = Date.now();
    if (!this.open && now - this.connectStartedAt > CONNECT_TIMEOUT_MS) this.dropped(this.ws, "connect timeout");
    else if (this.open && this.lastMessageAt !== null && now - this.lastMessageAt > STALE_MS) this.dropped(this.ws, "stale");
  }

  private onMessage(raw: string): void {
    const at = Date.now();
    this.lastMessageAt = at;
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: { subscription: number; result: unknown } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const req = this.requests.get(msg.id);
      if (req === undefined) return;
      this.requests.delete(msg.id);
      if (msg.error || typeof msg.result !== "number") {
        log("stream_subscribe_failed", { method: req.method, error: msg.error?.message ?? "no subscription id" });
        return;
      }
      if (!this.subs.has(req.local)) {
        // Removed while the subscribe was in flight.
        this.send(UNSUBSCRIBE[req.method], [msg.result]);
        return;
      }
      this.byServer.set(msg.result, req.local);
      this.toServer.set(req.local, msg.result);
      // A subscription confirmed on this socket: the connection works, the next drop starts the back-off over.
      this.backoffMs = MIN_BACKOFF_MS;
      return;
    }
    if (!msg.params) return;
    const local = this.byServer.get(msg.params.subscription);
    const sub = local === undefined ? undefined : this.subs.get(local);
    if (!sub) return;
    this.notifications += 1;
    if (sub.method === "accountSubscribe") {
      const r = msg.params.result as { context: { slot: number }; value: { data: [string, string]; lamports: number } | null };
      if (!r.value) return;
      sub.onAccount({ data: Buffer.from(r.value.data[0], "base64"), lamports: r.value.lamports, slot: r.context.slot, at });
    } else if (sub.method === "slotSubscribe") {
      sub.onSlot((msg.params.result as { slot: number }).slot, at);
    } else {
      const r = msg.params.result as { context: { slot: number }; value: { err: TransactionError | null } | string };
      // `receivedSignature` notifications only exist with `enableReceivedNotification`, which is never requested.
      if (typeof r.value === "string") return;
      this.subs.delete(local!);
      this.byServer.delete(msg.params.subscription);
      this.toServer.delete(local!);
      sub.onSignature({ err: r.value.err ?? null, slot: r.context.slot, at });
    }
  }
}
