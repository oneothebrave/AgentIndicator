import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { settings, health, canBind, inspect } from "./indicator.mjs";

async function listener(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}
async function freePort() {
  const server = await listener();
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function child(config, ...args) {
  const p = spawn(process.execPath, ["scripts/indicator.mjs", ...args], { env: {
    ...process.env, AGENT_INDICATOR_HOST: "127.0.0.1", AGENT_INDICATOR_PORT: String(config.port),
    AGENT_INDICATOR_HOOK_PORT: String(config.hookPort), AGENT_INDICATOR_SOURCE: "codex",
    AGENT_INDICATOR_CODEX_PROMPT: "must not start an app-server task",
  }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  p.stdout.on("data", b => { output += b; }); p.stderr.on("data", b => { output += b; });
  return { p, output: () => output, ended: once(p, "exit") };
}
async function until(fn) {
  for (let i = 0; i < 60; i++) { if (await fn()) return; await delay(100); }
  throw new Error("Timed out waiting for bridge");
}

test("reject invalid and colliding port configuration", () => {
  for (const port of ["0", "-1", "abc", "65536", "1.5", "8788"])
    assert.throws(() => settings({ AGENT_INDICATOR_PORT: port }));
});

test("health bounds stalled responses and detects occupied ports", async () => {
  const server = await listener((_req, res) => { res.writeHead(200); res.write("{"); });
  try {
    const port = server.address().port;
    assert.equal((await canBind("127.0.0.1", port)).free, false);
    const start = Date.now();
    assert.equal(await health("127.0.0.1", port), null);
    assert.ok(Date.now() - start < 2500);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test("foreign service conflict does not terminate the occupied server", async () => {
  const server = await listener((_req, res) => res.end(JSON.stringify({ ok: true, source: "mock" })));
  try {
    const run = child({ port: server.address().port, hookPort: await freePort() });
    const [code] = await run.ended;
    assert.equal(code, 1, run.output());
    assert.match(run.output(), /端口.*不可用/);
    assert.equal((await health("127.0.0.1", server.address().port)).source, "mock");
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test("fresh startup, reuse, doctor, websocket reconnect and hook delivery", { timeout: 20000 }, async () => {
  const config = { host: "127.0.0.1", probeHost: "127.0.0.1", port: await freePort(), hookPort: await freePort() };
  const run = child(config);
  let ws;
  try {
    await until(async () => (await inspect(config)).ready);
    assert.equal((await inspect(config)).bridge.clients, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      ws = new WebSocket(`ws://127.0.0.1:${config.port}/status`);
      const [hello] = await once(ws, "message");
      assert.equal(JSON.parse(hello).kind, "bridge.hello");
      await until(async () => (await inspect(config)).bridge.clients === 1);
      ws.close(); await once(ws, "close");
      await until(async () => (await inspect(config)).bridge.clients === 0);
    }
    const response = await fetch(`http://127.0.0.1:${config.hookPort}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "startup-test", hook_event_name: "UserPromptSubmit", session_id: "test-session", turn_id: "test-turn" }) });
    assert.equal(response.status, 200);
    assert.equal((await inspect(config)).bridge.latestAgentEvent.type, "turn.started");
    const rejected = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, { method: "POST", headers: { "content-type": "application/json", origin: "http://example.test" }, body: JSON.stringify({ expectedSessionId: "test-session" }) });
    assert.equal(rejected.status, 403);
    const stale = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedSessionId: "stale" }) });
    assert.equal(stale.status, 409);
    const reset = child(config, "--reset-session");
    assert.equal((await reset.ended)[0], 0, reset.output());
    assert.equal((await inspect(config)).hooks.sessionId, null);
    assert.equal((await inspect(config)).bridge.latestAgentEvent.type, "thread.idle");
    for (const args of [[], ["--check"]]) {
      const duplicate = child(config, ...args);
      assert.equal((await duplicate.ended)[0], 0, duplicate.output());
      if (!args.length) assert.match(duplicate.output(), /复用现有服务/);
    }
  } finally {
    ws?.terminate(); run.p.kill(); await run.ended;
  }
  const offline = child(config, "--check");
  assert.equal((await offline.ended)[0], 1, offline.output());
});
