"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { INDEXER_WS_URL } from "./env";
import type { ActivityEvent, CommentsPage, LaunchSummary, WsMessage } from "./types";

type Listener = (event: ActivityEvent) => void;

interface LiveContext {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
}

const Ctx = createContext<LiveContext>({ connected: false, subscribe: () => () => undefined });

/** Per-mint query families refreshed whenever the indexer reports an on-chain event for that mint. */
const MINT_KEYS = ["trades", "traders", "candles", "backers", "deposits", "holders", "token-balance", "backer", "launch-account"];

/**
 * Single indexer websocket for the whole app. Pushes launch snapshots straight into the
 * react-query cache and invalidates everything an event could have changed.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const [subscribe] = useState(() => (fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let reconnect: number | undefined;
    let listRefresh: number | undefined;
    let disposed = false;

    const refreshLists = () => {
      if (listRefresh !== undefined) return;
      listRefresh = window.setTimeout(() => {
        listRefresh = undefined;
        for (const key of ["launches", "stats", "agents", "portfolio"]) qc.invalidateQueries({ queryKey: [key] });
      }, 1200);
    };

    const connect = () => {
      ws = new WebSocket(INDEXER_WS_URL);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        qc.invalidateQueries({ queryKey: ["activity"] });
      };
      ws.onmessage = (m) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(m.data)) as WsMessage;
        } catch {
          return;
        }
        if (msg.type === "event") {
          const event = msg.event;
          qc.setQueryData<{ events: ActivityEvent[] }>(["activity"], (old) =>
            old ? { events: [event, ...old.events.filter((e) => e.id !== event.id)].slice(0, 80) } : old,
          );
          for (const key of MINT_KEYS) qc.invalidateQueries({ queryKey: [key, event.mint] });
          refreshLists();
          listeners.current.forEach((fn) => fn(event));
        } else if (msg.type === "launch") {
          const launch = msg.launch;
          const key = ["launch", launch.mint];
          // A fetch started before the indexer saw the change would overwrite this newer push.
          void qc.cancelQueries({ queryKey: key, exact: true }).then(() => qc.setQueryData<LaunchSummary>(key, launch));
          refreshLists();
        } else if (msg.type === "comment") {
          const { mint, comment } = msg;
          // Newest-first head page: prepend the comment and bump its parent's reply count.
          qc.setQueryData<CommentsPage>(["comments", mint, "head"], (old) =>
            old && !old.comments.some((c) => c.id === comment.id)
              ? {
                  ...old,
                  total: old.total + 1,
                  comments: [
                    comment,
                    ...old.comments.map((c) => (c.id === comment.replyTo ? { ...c, replyCount: c.replyCount + 1 } : c)),
                  ],
                }
              : old,
          );
          if (comment.replyTo !== null) qc.invalidateQueries({ queryKey: ["comments", mint, "replies"] });
          // The launch summary carries the visible comment count.
          qc.invalidateQueries({ queryKey: ["launch", mint], exact: true });
        } else if (msg.type === "comment_deleted") {
          qc.invalidateQueries({ queryKey: ["comments", msg.mint] });
          qc.invalidateQueries({ queryKey: ["launch", msg.mint], exact: true });
        } else if (msg.type === "reset") {
          void qc.invalidateQueries();
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) reconnect = window.setTimeout(connect, Math.min(15_000, 1_000 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnect);
      window.clearTimeout(listRefresh);
      if (ws) {
        const sock = ws;
        sock.onclose = null;
        sock.onmessage = null;
        sock.onerror = null;
        // Closing while CONNECTING logs a browser warning (React StrictMode double-mounts this
        // effect in dev); let it finish the handshake and close right away instead.
        if (sock.readyState === WebSocket.CONNECTING) sock.onopen = () => sock.close();
        else sock.close();
      }
    };
  }, [qc]);

  return <Ctx.Provider value={{ connected, subscribe }}>{children}</Ctx.Provider>;
}

export function useLive(): LiveContext {
  return useContext(Ctx);
}

/** Poll only while the websocket is down (plus a slow safety refresh while it is up). */
export function useFallbackInterval(ms = 5_000): number {
  return useLive().connected ? 30_000 : ms;
}

/** Subscribe to live activity events, optionally for a single mint. */
export function useLiveEvents(fn: Listener, mint?: string) {
  const { subscribe } = useLive();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(
    () =>
      subscribe((e) => {
        if (!mint || e.mint === mint) ref.current(e);
      }),
    [subscribe, mint],
  );
}
