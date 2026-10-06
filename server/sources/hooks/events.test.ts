import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createHookEventPublisher, isHookEvent, type HookEvent } from "./events";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

function setup() {
  const out: StatusMessage[] = [];
  const publisher = createHookEventPublisher((message) => out.push(message));
  const event = (
    name: HookEvent["hook_event_name"],
    fields: Partial<HookEvent> = {},
  ): HookEvent => ({
    id: randomUUID(),
    hook_event_name: name,
    session_id: "cli-a",
    turn_id: "turn-a",
    ...fields,
  });
  const send = (name: HookEvent["hook_event_name"], fields: Partial<HookEvent> = {}) =>
    publisher.receive(event(name, fields));
  const last = () => {
    const message = out[out.length - 1];
    return message.kind === "agent.event" ? message.event.type : undefined;
  };
  return { publisher, out, event, send, last };
}

test("manual reset rejects a stale target and prevents delayed turn rebinding", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  assert.equal(state.publisher.reset("another-session", "turn-a"), false);
  assert.equal(state.publisher.status().activeTools, 1);
  assert.equal(state.publisher.reset("cli-a", "turn-a"), true);
  assert.equal(state.last(), "thread.idle");
  assert.equal(state.publisher.status().sessionId, null);
  assert.equal(state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "delayed" }), false);
  assert.equal(state.publisher.status().sessionId, null);
  assert.equal(state.send("UserPromptSubmit", { session_id: "cli-b", turn_id: "new" }), true);
});

test("manual reset preserves an explicitly pinned session", () => {
  const publisher = createHookEventPublisher(() => {}, "pinned");
  assert.equal(publisher.reset("pinned", null), true);
  assert.equal(publisher.status().sessionId, "pinned");
});

test("a reset based on an older turn cannot clear a new turn in the same CLI", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("Stop");
  state.send("UserPromptSubmit", { turn_id: "new-turn" });
  state.send("PreToolUse", { turn_id: "new-turn", tool_name: "Bash", tool_use_id: "new-tool" });
  assert.equal(state.publisher.reset("cli-a", "turn-a"), false);
  assert.equal(state.publisher.status().activeTools, 1);
  assert.equal(state.last(), "command.started");
  assert.equal(state.publisher.reset("cli-a", "new-turn"), true);
});

test("retired SessionStart notifications from old installations are harmless", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  assert.equal(state.send("SessionStart", { turn_id: undefined }), false);
  assert.equal(state.publisher.status().lastHook, "UserPromptSubmit");
  assert.equal(state.last(), "turn.started");
});
test("ignores other sessions and stale turn events, accepts subsequent turns", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  assert.equal(state.send("UserPromptSubmit", { session_id: "cli-b" }), false);
  state.send("Stop");
  assert.equal(state.last(), "turn.completed");
  assert.equal(state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "late" }), false);
  state.send("UserPromptSubmit", { turn_id: "turn-b" });
  assert.equal(state.last(), "turn.started");
  assert.equal(state.send("Stop"), false);
});
test("parallel tool completion keeps the remaining tool active", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  state.send("PreToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(state.last(), "file.change");
  state.send("PostToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(state.last(), "command.started");
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  assert.equal(state.last(), "reasoning.started");
});
test("approval is observable without resolving it; interruption closes the turn", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PermissionRequest", { tool_name: "Bash" });
  assert.equal(state.last(), "approval.requested");
  state.send("Interrupt");
  assert.equal(state.last(), "thread.idle");
  assert.equal(state.send("Stop"), false);
});
test("session end releases ownership and repeated event ids are ignored", () => {
  const state = setup();
  const event = state.event("UserPromptSubmit");
  assert.equal(state.publisher.receive(event), true);
  assert.equal(state.publisher.receive(event), false);
  state.send("SessionEnd", { turn_id: undefined });
  assert.equal(state.publisher.status().sessionId, null);
  assert.equal(state.send("UserPromptSubmit", { session_id: "cli-b" }), true);
});
test("an unrelated tool finishing does not clear a pending approval", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PermissionRequest", { tool_name: "Bash" });
  state.send("PostToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(state.last(), "approval.requested");
});
test("rejects malformed events and missing tool/turn identities", () => {
  const state = setup();
  assert.equal(isHookEvent(null), false);
  assert.equal(isHookEvent(state.event("PreToolUse")), false);
  assert.equal(isHookEvent(state.event("Stop", { turn_id: undefined })), false);
  assert.equal(isHookEvent(state.event("UserPromptSubmit")), true);
});

test("same-name tool completion only clears its own approval", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "running" });
  state.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "waiting" });
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "running" });
  assert.equal(state.last(), "approval.requested");
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "waiting" });
  assert.equal(state.last(), "reasoning.started");
});

test("parallel same-name approvals remain waiting until both complete", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "first" });
  state.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "second" });
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "first" });
  assert.equal(state.last(), "approval.requested");
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "second" });
  assert.equal(state.last(), "reasoning.started");
});

test("approval without an invocation ID is retained until the turn closes", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("PermissionRequest", { tool_name: "Bash" });
  state.send("PostToolUse", { tool_name: "Bash", tool_use_id: "other" });
  assert.equal(state.last(), "approval.requested");
  state.send("Stop");
  assert.equal(state.last(), "turn.completed");
  state.send("UserPromptSubmit", { turn_id: "next" });
  state.send("PreToolUse", { turn_id: "next", tool_name: "Bash", tool_use_id: "next-tool" });
  assert.equal(state.last(), "command.started");
});

test("ID-less approval resumes on matching input; other same-name calls cannot clear it", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  const firstInputHash = "a".repeat(64);
  const secondInputHash = "b".repeat(64);
  state.send("PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "approved",
    tool_input_hash: firstInputHash,
  });
  state.send("PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "other",
    tool_input_hash: secondInputHash,
  });
  state.send("PermissionRequest", { tool_name: "Bash", tool_input_hash: firstInputHash });
  state.send("PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "other",
    tool_input_hash: secondInputHash,
  });
  assert.equal(state.last(), "approval.requested");
  state.send("PostToolUse", {
    tool_name: "Bash",
    tool_use_id: "approved",
    tool_input_hash: firstInputHash,
  });
  assert.equal(state.last(), "reasoning.started");
  assert.equal(state.publisher.status().pendingApprovals, 0);
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "next" });
  assert.equal(state.last(), "command.started");
});

test("identical parallel calls keep ambiguous approval until all candidates finish", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  const fields = { tool_name: "Bash", tool_input_hash: "a".repeat(64) };
  state.send("PreToolUse", { ...fields, tool_use_id: "a" });
  state.send("PreToolUse", { ...fields, tool_use_id: "b" });
  state.send("PermissionRequest", fields);
  state.send("PostToolUse", { ...fields, tool_use_id: "a" });
  assert.equal(state.last(), "approval.requested");
  state.send("PostToolUse", { ...fields, tool_use_id: "b" });
  assert.equal(state.last(), "reasoning.started");
});

test("missing PreToolUse can recover with matching PostToolUse; rejected approvals can finish normally", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  const fields = { tool_name: "Bash", tool_input_hash: "a".repeat(64) };
  state.send("PermissionRequest", fields);
  state.send("PostToolUse", { ...fields, tool_use_id: "returned-error" });
  assert.equal(state.last(), "reasoning.started");
  state.send("Stop");
  assert.equal(state.last(), "turn.completed");
});

test("older observed prompts and duplicate prompts do not replace active work", () => {
  const state = setup();
  state.send("UserPromptSubmit", { observed_at: 200 });
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "active" });
  assert.equal(state.send("UserPromptSubmit", { turn_id: "old", observed_at: 100 }), false);
  assert.equal(state.send("UserPromptSubmit", { observed_at: 201 }), false);
  assert.equal(state.publisher.status().activeTools, 1);
  assert.equal(state.send("UserPromptSubmit", { turn_id: "next", observed_at: 300 }), true);
  assert.equal(state.publisher.status().activeTools, 0);
});

test("subagent completion never completes its parent turn", () => {
  const state = setup();
  state.send("UserPromptSubmit");
  state.send("SubagentStart", { agent_id: "a" });
  state.send("SubagentStart", { agent_id: "b" });
  state.send("SubagentStop", { agent_id: "a" });
  assert.equal(state.last(), "tool.started");
  state.send("SubagentStop", { agent_id: "b" });
  assert.equal(state.last(), "reasoning.started");
  state.send("Stop");
  assert.equal(state.last(), "turn.completed");
});
