import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexSource, type CodexSourceConfig } from "./sources/codexSource";
import type { StatusMessage } from "../src/domain/statusProtocol";

const fixture = fileURLToPath(new URL("./sources/codex/fixtures/app-server.mjs", import.meta.url));
function config(mode: string, trace?: string): CodexSourceConfig {
  return { launch: { command: process.execPath, args: [fixture, mode, ...(trace ? [trace] : [])], cwd: process.cwd() },
    client: { requestTimeoutMs: 1000 }, events: { messageDeltaThrottleMs: 0 },
    turn: { cwd: process.cwd(), prompt: "local fixture", approvalPolicy: "never", sandbox: "read-only", waitForClient: false } };
}
function recorder() {
  const messages: StatusMessage[] = [];
  return { messages, types: () => messages.flatMap(m => m.kind === "agent.event" ? [m.event.type] : []),
    runtime: { sendStatusMessage: (m: StatusMessage) => messages.push(m), getClientCount: () => 1, waitForClient: async () => {} } };
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(20); }
  throw new Error("fixture timeout");
}

test("startup timeout stops source once; delayed notifications cannot revive it", { timeout: 5000 }, async t => {
  const source = createCodexSource(config("timeout")), r = recorder();
  t.after(() => source.stop());
  source.startPublishing(r.runtime);
  await until(() => r.types().includes("turn.failed"));
  await delay(650);
  assert.deepEqual(r.types(), ["turn.started", "turn.failed"]);
  const last = r.messages[r.messages.length - 1];
  assert.ok(last?.kind === "agent.event" && last.event.detail?.includes("source stopped"));
});

test("process startup failure publishes only one error", { timeout: 5000 }, async t => {
  const c = config("hang"); c.launch.command = join(tmpdir(), "agent-indicator-nonexistent-executable");
  const source = createCodexSource(c), r = recorder();
  t.after(() => source.stop());
  source.startPublishing(r.runtime);
  await until(() => r.types().length > 0);
  await delay(50);
  assert.deepEqual(r.types(), ["turn.failed"]);
});

test("stop during initialize is quiet and a fresh run can complete", { timeout: 5000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "indicator-source-"));
  const trace = join(dir, "trace");
  const c = config("hang", trace); c.client.requestTimeoutMs = 2000;
  const source = createCodexSource(c), r = recorder();
  t.after(async () => { source.stop(); await rm(dir, { recursive: true, force: true }); });
  source.startPublishing(r.runtime);
  await until(async () => (await readFile(trace, "utf8").catch(() => "")).includes("initialize"));
  source.stop();
  c.launch.args = [fixture, "normal"];
  source.startPublishing(r.runtime);
  await until(() => r.types().includes("turn.completed"));
  assert.deepEqual(r.types(), ["turn.started", "reasoning.started", "turn.completed"]);
});

test("stop while waiting for a client prevents deferred startup", async () => {
  const c = config("hang"); c.turn.waitForClient = true;
  const source = createCodexSource(c), r = recorder();
  let release!: () => void;
  source.startPublishing({ ...r.runtime, waitForClient: () => new Promise<void>(resolve => { release = resolve; }) });
  source.stop(); release();
  await delay(300);
  assert.deepEqual(r.types(), []);
});
