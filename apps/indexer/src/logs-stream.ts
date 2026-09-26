import type { FastifyBaseLogger } from "fastify";
import WebSocket from "ws";

export interface LogsNotification {
  signature: string;
  err: unknown;
  logs: string[];
  slot: number;
}

export interface LogsStreamHandlers {
  onLogs(n: LogsNotification): void;
  /** Called every time a (re)subscription is confirmed. */
  onSubscribed(): void;
}

const SUBSCRIBE_ID = 1;
const HEARTBEAT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * `logsSubscribe` (mentions: program, confirmed) over a dedicated socket. Reconnects with jittered
 * exponential backoff (1s → 30s) after validator restarts or network drops, and detects half-open
 * sockets with ping/pong. Delivery is best effort: the signature poller fills any gap.
 */
export class LogsStream {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private attempt = 0;
  private closed = false;
  private downSince: number | null = null;
  private lastError: string | null = null;
  private subscribedFlag = false;

  constructor(
    private readonly url: string,
    private readonly programId: string,
    private readonly handlers: LogsStreamHandlers,
    private readonly log: FastifyBaseLogger,
  ) {}

  get subscribed(): boolean {
    return this.subscribedFlag;
  }

  start(): void {
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.subscribedFlag = false;
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "indexer shutting down");
      else socket.terminate();
    }
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(this.url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    this.socket = socket;
    let awaitingPong = false;
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SUBSCRIBE_ID,
          method: "logsSubscribe",
          params: [{ mentions: [this.programId] }, { commitment: "confirmed" }],
        }),
      );
      this.stopHeartbeat();
      this.heartbeat = setInterval(() => {
        if (awaitingPong) {
          this.lastError = "no pong within heartbeat interval";
          socket.terminate();
          return;
        }
        awaitingPong = true;
        socket.ping();
      }, HEARTBEAT_MS);
    });
    socket.on("pong", () => {
      awaitingPong = false;
    });
    socket.on("message", (data) => this.onMessage(socket, data.toString()));
    socket.on("error", (err) => {
      this.lastError = err.message || String(err);
    });
    socket.on("close", () => this.onClose(socket));
  }

  private onMessage(socket: WebSocket, raw: string): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: { result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } } };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id === SUBSCRIBE_ID) {
      if (msg.error || typeof msg.result !== "number") {
        this.lastError = `logsSubscribe rejected: ${msg.error?.message ?? raw.slice(0, 120)}`;
        socket.terminate();
        return;
      }
      this.subscribedFlag = true;
      const retries = this.attempt;
      this.attempt = 0;
      if (this.downSince !== null) {
        this.log.info({ downMs: Date.now() - this.downSince, retries }, "logs websocket reconnected");
      } else {
        this.log.info({ url: this.url }, "logs websocket subscribed");
      }
      this.downSince = null;
      this.lastError = null;
      this.handlers.onSubscribed();
      return;
    }
    if (msg.method !== "logsNotification") return;
    const res = msg.params?.result;
    const value = res?.value;
    if (!value?.signature || typeof res?.context?.slot !== "number") return;
    this.handlers.onLogs({ signature: value.signature, err: value.err ?? null, logs: value.logs ?? [], slot: res.context.slot });
  }

  private onClose(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.stopHeartbeat();
    this.socket = null;
    const wasSubscribed = this.subscribedFlag;
    this.subscribedFlag = false;
    if (this.closed) return;
    if (wasSubscribed) {
      this.downSince = Date.now();
      this.log.warn({ reason: this.lastError ?? "closed by server" }, "logs websocket lost; poller covers the gap while reconnecting");
    } else if (this.downSince === null) {
      this.downSince = Date.now();
      this.log.warn({ url: this.url, reason: this.lastError ?? "closed" }, "logs websocket unavailable; retrying with backoff");
    }
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt += 1;
    this.log.debug({ attempt: this.attempt, delayMs: delay, reason: this.lastError }, "logs websocket reconnect scheduled");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
