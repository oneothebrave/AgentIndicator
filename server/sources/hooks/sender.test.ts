import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

async function invoke(port: number, input: string) {
  const child = spawn(process.execPath, ["scripts/codex-hook.mjs"], { env: { ...process.env, AGENT_INDICATOR_HOOK_PORT: String(port) }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", b => stdout += b);
  child.stderr.on("data", b => stderr += b);
  child.stdin.end(input);
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "{}");
  assert.equal(stderr, "");
}
test("sender removes private payloads and never supplies an approval decision", async () => {
  let body = "";
  const server = createServer((req, res) => { req.on("data", b => body += b); req.on("end", () => res.end("{}")); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    await invoke((server.address() as AddressInfo).port, JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "s", turn_id: "t", tool_name: "Bash", prompt: "private", tool_input: { command: "private" }, tool_response: "private", transcript_path: "private" }));
    const event = JSON.parse(body);
    assert.deepEqual(Object.keys(event).sort(), ["hook_event_name", "id", "session_id", "tool_name", "turn_id"]);
    assert.equal(event.hook_event_name, "PermissionRequest");
    assert.ok(!body.includes("private"));
  } finally { server.close(); }
});
test("bridge failure and malformed stdin do not fail the CLI hook", async () => {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await invoke(port, JSON.stringify({ hook_event_name: "Stop", session_id: "s", turn_id: "t" }));
  await invoke(port, "bad json");
});
test("an unresponsive receiver cannot stall a hook indefinitely", async () => {
  const server = createServer(() => {}); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const start = Date.now();
  try {
    await invoke((server.address() as AddressInfo).port, "{}");
    assert.ok(Date.now() - start < 2000);
  } finally { server.closeAllConnections(); server.close(); }
});
