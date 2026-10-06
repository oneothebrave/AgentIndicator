import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  isInteractiveCodex,
  isProcessIdentity,
  observeWindowsProcess,
  windowsProcessIdentity,
} from "../shared/windows-process.mjs";

test("process metadata is bounded and interactive classification excludes server/exec clients", () => {
  assert.equal(isProcessIdentity({ pid: 3, started_at: "123" }), true);
  for (const value of [
    null,
    {},
    { pid: 0, started_at: "123" },
    { pid: 1, started_at: "0" },
    { pid: 1.5, started_at: "123" },
    { pid: 1, started_at: "1".repeat(21) },
  ]) {
    assert.equal(isProcessIdentity(value), false);
  }
  for (const args of [
    [],
    ["codex", 123],
    ["codex", "app-server"],
    ["codex", "exec"],
    ["codex", "mcp-server"],
    ["codex", "--version"],
  ]) {
    assert.equal(isInteractiveCodex("C:\\bin\\codex.exe", args), false);
  }
  assert.equal(isInteractiveCodex("C:\\bin\\node.exe", ["codex"]), false);
  assert.equal(isInteractiveCodex("C:\\bin\\codex.exe", ["codex", "--no-alt-screen"]), true);
  assert.equal(isInteractiveCodex("C:\\bin\\codex.exe", ["codex", "resume", "session"]), true);
});

test(
  "Windows handle observes actual termination and rejects a reused identity",
  {
    skip: process.platform !== "win32",
    timeout: 10000,
  },
  async (context) => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await once(child, "spawn");
    context.after(() => child.kill());
    const identity = windowsProcessIdentity(child.pid);
    const observed = observeWindowsProcess(identity);
    context.after(() => observed.close());
    assert.equal(observed.poll(), "alive");
    assert.throws(
      () =>
        observeWindowsProcess({
          ...identity,
          started_at: (BigInt(identity.started_at) + 1n).toString(),
        }),
      /identity-changed/,
    );
    assert.throws(() => observeWindowsProcess(identity, true), /not-interactive-cli/);
    const ended = once(child, "exit");
    child.kill();
    await ended;
    assert.equal(observed.poll(), "exited");
    observed.close();
    observed.close();
    assert.equal(observed.poll(), "unknown");
  },
);
