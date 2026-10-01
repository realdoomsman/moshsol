import type { WebSocket } from "ws";
import { HiddenLaunches } from "./hidden";
import type { WsMessage } from "./types";

const HEARTBEAT_MS = 30_000;
/**
 * Unsent bytes a client may have queued before it is dropped (it reconnects and refetches). Without a cap a client
 * that stops reading makes the server buffer every broadcast for it until the heartbeat notices (up to 2 × HEARTBEAT_MS).
 */
export const MAX_BUFFERED_BYTES = 1 << 20;

/**
 * Fan-out of indexer updates to `/ws` clients, with ping/pong liveness checks. Event and launch pushes of hidden
 * launches are dropped: clients build their live feeds and lists from them.
 */
export class Hub {
  private readonly clients = new Map<WebSocket, { alive: boolean }>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly hidden = new HiddenLaunches()) {
    this.heartbeat = setInterval(() => {
      for (const [socket, state] of this.clients) {
        if (!state.alive) {
          socket.terminate();
          this.clients.delete(socket);
          continue;
        }
        state.alive = false;
        socket.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  add(socket: WebSocket): void {
    const state = { alive: true };
    this.clients.set(socket, state);
    socket.on("pong", () => {
      state.alive = true;
    });
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
  }

  broadcast(msg: WsMessage): void {
    if (this.clients.size === 0) return;
    if (msg.type === "event" && this.hidden.has({ address: msg.event.launch, mint: msg.event.mint })) return;
    if (msg.type === "launch" && this.hidden.has(msg.launch)) return;
    const data = JSON.stringify(msg);
    for (const socket of this.clients.keys()) {
      if (socket.readyState !== socket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.terminate();
        this.clients.delete(socket);
        continue;
      }
      socket.send(data);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.clients.keys()) socket.close(1001, "server shutting down");
    this.clients.clear();
  }
}
