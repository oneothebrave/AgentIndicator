import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createBridgeServer } from "./statusBroadcaster";

test("heartbeat removes a silent peer and preserves a responding peer", { timeout: 5000 }, async () => {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const bridge = createBridgeServer({ host: "127.0.0.1", port, statusPath: "/status", bridgeSource: "test", heartbeatMs: 100 });
  await new Promise<void>(resolve => bridge.listen(resolve));
  const good = new WebSocket(`ws://127.0.0.1:${port}/status`);
  const silent = new WebSocket(`ws://127.0.0.1:${port}/status`, { autoPong: false });
  try {
    const removed = once(silent, "close");
    await Promise.all([once(good, "open"), once(silent, "open")]);
    await removed;
    await delay(220);
    assert.equal(bridge.getClientCount(), 1);
    assert.equal(good.readyState, WebSocket.OPEN);
  } finally {
    good.terminate(); silent.terminate();
    await new Promise<void>(resolve => bridge.close(resolve));
  }
});
