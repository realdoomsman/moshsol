import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebSocket } from "ws";
import { Hub, MAX_BUFFERED_BYTES } from "./hub";

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
