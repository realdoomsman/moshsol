import type { WebSocket } from "ws";
import type { WsMessage } from "./types";

const HEARTBEAT_MS = 30_000;

/** Fan-out of indexer updates to `/ws` clients, with ping/pong liveness checks. */
export class Hub {
  private readonly clients = new Map<WebSocket, { alive: boolean }>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
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
    const data = JSON.stringify(msg);
    for (const socket of this.clients.keys()) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.clients.keys()) socket.close(1001, "server shutting down");
    this.clients.clear();
  }
}
