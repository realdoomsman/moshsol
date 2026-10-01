import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebSocket } from "ws";
import { HiddenLaunches } from "./hidden";
import { Hub, MAX_BUFFERED_BYTES } from "./hub";
import type { WsMessage } from "./types";

/** The slice of a `ws` socket the hub uses. */
function fakeSocket(bufferedAmount: number) {
  const s = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount,
    sent: [] as string[],
    terminated: false,
    on: () => s,
    ping: () => {},
    send: (data: string) => void s.sent.push(data),
    terminate: () => void ((s.terminated = true), (s.readyState = 3)),
    close: () => {},
  };
  return s;
}

test("a client too far behind is dropped instead of buffered for; the others still get every message", (t) => {
  const hub = new Hub();
  t.after(() => hub.close());
  const reader = fakeSocket(0);
  const stalled = fakeSocket(MAX_BUFFERED_BYTES + 1);
  hub.add(reader as unknown as WebSocket);
  hub.add(stalled as unknown as WebSocket);

  hub.broadcast({ type: "reset", genesisHash: "a" });
  hub.broadcast({ type: "reset", genesisHash: "b" });
  assert.equal(reader.sent.length, 2);
  assert.equal(stalled.terminated, true);
  assert.deepEqual(stalled.sent, []);
});

test("event and launch pushes of hidden launches (by address or mint) are dropped; others still go out", (t) => {
  const hub = new Hub(new HiddenLaunches(["HiddenAddr", "HiddenMint"]));
  t.after(() => hub.close());
  const client = fakeSocket(0);
  hub.add(client as unknown as WebSocket);
  const event = (launch: string, mint: string) => ({ type: "event", event: { launch, mint } }) as unknown as WsMessage;
  const launch = (address: string, mint: string) => ({ type: "launch", launch: { address, mint } }) as unknown as WsMessage;

  hub.broadcast(event("HiddenAddr", "m1"));
  hub.broadcast(event("a2", "HiddenMint"));
  hub.broadcast(launch("HiddenAddr", "m1"));
  hub.broadcast(launch("a2", "HiddenMint"));
  hub.broadcast(event("a3", "m3"));
  hub.broadcast(launch("a3", "m3"));
  assert.deepEqual(client.sent.map((s) => JSON.parse(s).type), ["event", "launch"]);
});
