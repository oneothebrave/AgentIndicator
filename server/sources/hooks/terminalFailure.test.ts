import { test } from "node:test";
import assert from "node:assert/strict";
import { createTerminalFailureWatcher, hasTerminalFailure } from "./terminalFailure";
import { mkdtemp, writeFile, appendFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookEventPublisher } from "./events";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

test("only explicit terminal errors on the selected turn qualify", () => {
  const record = (type: string, turn_id: string, error: unknown) => JSON.stringify({ type: "event_msg", payload: { type, turn_id, error } });
  assert.equal(hasTerminalFailure(record("task_complete", "a", { message: "404" }), "a"), true);
  assert.equal(hasTerminalFailure(record("task_complete", "b", { message: "404" }), "a"), false);
  assert.equal(hasTerminalFailure(record("task_complete", "a", null), "a"), false);
  assert.equal(hasTerminalFailure(record("warning", "a", { message: "retry" }), "a"), false);
  assert.equal(hasTerminalFailure('{"partial":', "a"), false);
});

test("terminal error releases tools, holds error and ignores delayed hooks", () => {
  const out: StatusMessage[] = [], p = createHookEventPublisher(e => out.push(e));
  p.receive({ id: "1", session_id: "a", turn_id: "t", hook_event_name: "UserPromptSubmit" });
  p.receive({ id: "2", session_id: "a", turn_id: "t", hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "tool" });
  assert.equal(p.failTurn("b", "t"), false);
  assert.equal(p.failTurn("a", "other"), false);
  assert.equal(p.failTurn("a", "t"), true);
  assert.equal(p.status().activeTools, 0);
  assert.equal(p.failTurn("a", "t"), false);
  assert.equal(p.receive({ id: "3", session_id: "a", turn_id: "t", hook_event_name: "Stop" }), false);
  const last = out[out.length - 1];
  assert.equal(last.kind === "agent.event" && last.event.type, "turn.failed");
  assert.equal(p.receive({ id: "4", session_id: "a", turn_id: "new", hook_event_name: "UserPromptSubmit" }), true);
});


test("new CLI prompt takes over after failure, stale tools cannot overwrite it", () => {
  const out: StatusMessage[] = [], p = createHookEventPublisher(e => out.push(e));
  const prompt = (id: string, session_id: string, turn_id: string) => p.receive({ id, session_id, turn_id, hook_event_name: "UserPromptSubmit" });
  prompt("1", "old", "failed");
  p.failTurn("old", "failed");
  assert.equal(p.receive({ id: "2", session_id: "new", turn_id: "new-turn", hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "x" }), false);
  assert.equal(prompt("3", "new", "new-turn"), true);
  assert.equal(p.status().sessionId, "new");
  assert.equal(p.receive({ id: "4", session_id: "old", hook_event_name: "SessionEnd" }), false);
  assert.equal(prompt("5", "old", "failed"), false);
  assert.equal(p.failTurn("old", "failed"), false);
  assert.equal(p.receive({ id: "6", session_id: "new", turn_id: "new-turn", hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "y" }), true);
  const last = out[out.length - 1];
  assert.equal(last.kind === "agent.event" && last.event.type, "command.started");
});

test("failure takeover respects pinned sessions and active ownership", () => {
  for (const pinned of [undefined, "old"]) {
    const p = createHookEventPublisher(() => {}, pinned);
    p.receive({ id: "1", session_id: "old", turn_id: "t", hook_event_name: "UserPromptSubmit" });
    assert.equal(p.receive({ id: "2", session_id: "new", turn_id: "n", hook_event_name: "UserPromptSubmit" }), false);
    p.failTurn("old", "t");
    assert.equal(p.receive({ id: "3", session_id: "new", turn_id: "n", hook_event_name: "UserPromptSubmit" }), !pinned);
  }
});

test("terminal failure corrects current completion, never cancellation or a newer turn", () => {
  const p = createHookEventPublisher(() => {});
  p.receive({ id: "1", session_id: "s", turn_id: "t", hook_event_name: "UserPromptSubmit" });
  p.receive({ id: "2", session_id: "s", turn_id: "t", hook_event_name: "Stop" });
  assert.equal(p.failTurn("s", "t"), true);
  assert.equal(p.failTurn("s", "t"), false);
  p.receive({ id: "3", session_id: "s", turn_id: "next", hook_event_name: "UserPromptSubmit" });
  assert.equal(p.failTurn("s", "t"), false);
  p.receive({ id: "4", session_id: "s", turn_id: "next", hook_event_name: "Interrupt" });
  assert.equal(p.failTurn("s", "next"), false);
});

const terminal = (turn: string, text = "") => JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: turn, last_agent_message: text, error: { message: "404" } } }) + "\n";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "indicator-watcher-test-"));
  return { root, path: join(root, "rollout-session.jsonl"), clean: () => rm(root, { recursive: true, force: true }) };
}

test("incremental watcher handles long UTF-8 records, partial writes and duplicate polls", async () => {
  const f = await fixture(); let count = 0;
  const w = createTerminalFailureWatcher(f.root, () => ({ sessionId: "session", turnId: "t" }), () => count++, { bytesPerPoll: 65536 });
  try {
    const bytes = Buffer.from(terminal("t", "中文".repeat(40000)));
    await writeFile(f.path, bytes.subarray(0, bytes.length - 1));
    for (let i = 0; i < 5; i++) await w.poll();
    assert.equal(count, 0);
    await appendFile(f.path, "\n"); await w.poll(); await w.poll();
    assert.equal(count, 1); assert.equal(w.status().phase, "reading");
  } finally { w.stop(); await f.clean(); }
});

test("watcher relocates missing files and resets reader on replacement or truncation", async () => {
  const f = await fixture(); let count = 0;
  const w = createTerminalFailureWatcher(f.root, () => ({ sessionId: "session", turnId: "t" }), () => count++);
  try {
    await w.poll(); assert.equal(w.status().phase, "missing");
    await writeFile(f.path, '{}\n'.repeat(100)); await w.poll();
    await rename(f.path, join(f.root, "archived.jsonl")); await w.poll();
    assert.equal(w.status().phase, "error");
    await writeFile(f.path, terminal("t")); await w.poll(); assert.equal(count, 1);
    await writeFile(f.path, '{}\n'); await w.poll();
    await appendFile(f.path, terminal("t")); await w.poll(); assert.equal(count, 2);
  } finally { w.stop(); await f.clean(); }
});

test("oversized records are diagnosed; subsequent valid records still work", async () => {
  const f = await fixture(); let count = 0;
  const w = createTerminalFailureWatcher(f.root, () => ({ sessionId: "session", turnId: "t" }), () => count++, { maxRecordBytes: 512 });
  try {
    await writeFile(f.path, terminal("t", "x".repeat(1000)) + terminal("t")); await w.poll();
    assert.equal(count, 1); assert.equal(w.status().oversizedRecords, 1);
    assert.equal(w.status().error, "record_too_large");
  } finally { w.stop(); await f.clean(); }
});

test("rebinding rescans existing records, stale reads and stopped callbacks are suppressed", async () => {
  const f = await fixture(); let count = 0, turnId = "old";
  const w = createTerminalFailureWatcher(f.root, () => ({ sessionId: "session", turnId }), () => count++);
  try {
    await writeFile(f.path, terminal("new")); await w.poll(); assert.equal(count, 0);
    turnId = "new"; await w.poll(); assert.equal(count, 1);
    await writeFile(f.path, terminal("later")); turnId = "later";
    const pending = w.poll(); w.stop(); await pending; assert.equal(count, 1);
  } finally { w.stop(); await f.clean(); }
});
