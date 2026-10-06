import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { isProcessIdentity } from "../../../shared/windows-process.mjs";

async function invoke(port: number, input: string) {
  const child = spawn(process.execPath, ["scripts/codex-hook.mjs"], {
    env: { ...process.env, AGENT_INDICATOR_HOOK_PORT: String(port) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input);
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "{}");
  assert.equal(stderr, "");
}
test("sender removes private payloads and never supplies an approval decision", async () => {
  let body = "";
  const server = createServer((req, res) => {
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => res.end("{}"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await invoke(
      (server.address() as AddressInfo).port,
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        session_id: "s",
        turn_id: "t",
        tool_name: "Bash",
        prompt: "private",
        tool_input: { command: "private" },
        tool_response: "private",
        transcript_path: "private",
        cli_process: { pid: -1, started_at: "forged" },
        client_kind: "forged",
      }),
    );
    const event = JSON.parse(body);
    const keys = Object.keys(event)
      .filter((key) => key !== "cli_process")
      .sort();
    assert.deepEqual(keys, [
      "client_kind",
      "hook_event_name",
      "id",
      "observed_at",
      "session_id",
      "tool_input_hash",
      "tool_name",
      "turn_id",
    ]);
    assert.match(event.tool_input_hash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(event.observed_at));
    assert.equal(event.hook_event_name, "PermissionRequest");
    assert.ok(!body.includes("private"));
    assert.ok(!body.includes("forged"));
    assert.ok(["cli", "other", "unknown"].includes(event.client_kind));
    if (event.cli_process !== undefined) {
      assert.equal(isProcessIdentity(event.cli_process), true);
    }
  } finally {
    server.close();
  }
});
test("bridge failure and malformed stdin do not fail the CLI hook", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await invoke(port, JSON.stringify({ hook_event_name: "Stop", session_id: "s", turn_id: "t" }));
  await invoke(port, "bad json");
});
test("an unresponsive receiver cannot stall a hook indefinitely", async () => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const start = Date.now();
  try {
    await invoke((server.address() as AddressInfo).port, "{}");
    assert.ok(Date.now() - start < 2000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
