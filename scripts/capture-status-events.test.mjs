import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

for (const [host, bound, close] of [
  ["0.0.0.0", "127.0.0.1", false],
  ["127.0.0.2", "127.0.0.2", false],
  ["::", "::1", false],
  ["127.0.0.1", "127.0.0.1", true],
]) {
  test(
    `capture uses configured ${host} address, close=${close}`,
    { timeout: 7000 },
    async (context) => {
      const server = createServer();
      const wss = new WebSocketServer({ server, path: "/status" });
      context.after(() => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close();
        server.close();
      });
      wss.on("connection", (socket) => {
        socket.send(
          JSON.stringify({ kind: "bridge.hello", source: "test", version: 1, at: Date.now() }),
        );
        socket.send(
          JSON.stringify({
            kind: "agent.event",
            event: {
              type: "turn.started",
              origin: "codex",
              at: Date.now(),
              detail: "private-value",
            },
          }),
        );
        if (close) {
          socket.close();
        }
      });
      server.listen(0, bound);
      try {
        await once(server, "listening");
      } catch (error) {
        if (bound === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) {
          return context.skip("IPv6 unavailable");
        }
        throw error;
      }
      const port = server.address().port;
      const child = spawn(process.execPath, ["scripts/capture-status-events.mjs", "1"], {
        env: {
          ...process.env,
          AGENT_INDICATOR_HOST: host,
          AGENT_INDICATOR_PORT: String(port),
          AGENT_INDICATOR_HOOK_PORT: port === 8788 ? "8789" : "8788",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      context.after(() => child.kill());
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      assert.equal((await once(child, "close"))[0], 0, output);
      const path = output.match(/records: (.+)/)?.[1].trim();
      assert.ok(path, output);
      const text = await readFile(path, "utf8");
      assert.equal(text.includes("private-value"), false);
      const rows = text.trim().split("\n").map(JSON.parse);
      assert.equal(rows[0].kind, "bridge.hello");
      assert.equal(rows[1].type, "turn.started");
      assert.deepEqual(rows[2], { summary: true, reason: close ? "closed" : "duration", count: 2 });
    },
  );
}
