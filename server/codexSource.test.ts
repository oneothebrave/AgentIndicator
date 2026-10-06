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
  return {
    launch: {
      command: process.execPath,
      args: [fixture, mode, ...(trace ? [trace] : [])],
      cwd: process.cwd(),
    },
    client: { requestTimeoutMs: 1000 },
    events: { messageDeltaThrottleMs: 0 },
    turn: {
      cwd: process.cwd(),
      prompt: "local fixture",
      approvalPolicy: "never",
      sandbox: "read-only",
      waitForClient: false,
    },
  };
}
function recorder() {
  const messages: StatusMessage[] = [];
  return {
    messages,
    types: () =>
      messages.flatMap((message) => (message.kind === "agent.event" ? [message.event.type] : [])),
    runtime: {
      sendStatusMessage: (message: StatusMessage) => messages.push(message),
      getClientCount: () => 1,
      waitForClient: async () => {},
    },
  };
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) {
      return;
    }
    await delay(20);
  }
  throw new Error("fixture timeout");
}

test(
  "startup timeout stops source once; delayed notifications cannot revive it",
  { timeout: 5000 },
  async (context) => {
    const source = createCodexSource(config("timeout"));
    const recording = recorder();
    context.after(() => source.stop());
    source.startPublishing(recording.runtime);
    await until(() => recording.types().includes("turn.failed"));
    await delay(650);
    assert.deepEqual(recording.types(), ["turn.started", "turn.failed"]);
    const last = recording.messages[recording.messages.length - 1];
    assert.ok(last?.kind === "agent.event" && last.event.detail?.includes("source stopped"));
  },
);

test("process startup failure publishes only one error", { timeout: 5000 }, async (context) => {
  const sourceConfig = config("hang");
  sourceConfig.launch.command = join(tmpdir(), "agent-indicator-nonexistent-executable");
  const source = createCodexSource(sourceConfig);
  const recording = recorder();
  context.after(() => source.stop());
  source.startPublishing(recording.runtime);
  await until(() => recording.types().length > 0);
  await delay(50);
  assert.deepEqual(recording.types(), ["turn.failed"]);
});

test(
  "stop during initialize is quiet and a fresh run can complete",
  { timeout: 5000 },
  async (context) => {
    const dir = await mkdtemp(join(tmpdir(), "indicator-source-"));
    const trace = join(dir, "trace");
    const sourceConfig = config("hang", trace);
    sourceConfig.client.requestTimeoutMs = 2000;
    const source = createCodexSource(sourceConfig);
    const recording = recorder();
    context.after(async () => {
      source.stop();
      await rm(dir, { recursive: true, force: true });
    });
    source.startPublishing(recording.runtime);
    await until(async () => (await readFile(trace, "utf8").catch(() => "")).includes("initialize"));
    source.stop();
    sourceConfig.launch.args = [fixture, "normal"];
    source.startPublishing(recording.runtime);
    await until(() => recording.types().includes("turn.completed"));
    assert.deepEqual(recording.types(), ["turn.started", "reasoning.started", "turn.completed"]);
  },
);

test("stop while waiting for a client prevents deferred startup", async () => {
  const sourceConfig = config("hang");
  sourceConfig.turn.waitForClient = true;
  const source = createCodexSource(sourceConfig);
  const recording = recorder();
  let release!: () => void;
  source.startPublishing({
    ...recording.runtime,
    waitForClient: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  source.stop();
  release();
  await delay(300);
  assert.deepEqual(recording.types(), []);
});
