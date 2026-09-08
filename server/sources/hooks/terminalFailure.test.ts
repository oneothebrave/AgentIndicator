import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTerminalFailure } from "./terminalFailure";
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
