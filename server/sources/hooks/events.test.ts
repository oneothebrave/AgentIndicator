import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createHookEventPublisher, isHookEvent, type HookEvent } from "./events";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

function setup() {
  const out: StatusMessage[] = [];
  const publisher = createHookEventPublisher(e => out.push(e));
  const event = (name: HookEvent["hook_event_name"], fields: Partial<HookEvent> = {}): HookEvent => ({ id: randomUUID(), hook_event_name: name, session_id: "cli-a", turn_id: "turn-a", ...fields });
  const send = (name: HookEvent["hook_event_name"], fields: Partial<HookEvent> = {}) => publisher.receive(event(name, fields));
  const last = () => { const e = out[out.length - 1]; return e.kind === "agent.event" ? e.event.type : undefined; };
  return { publisher, out, event, send, last };
}

test("manual reset rejects a stale target and prevents delayed turn rebinding", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  assert.equal(t.publisher.reset("another-session"), false);
  assert.equal(t.publisher.status().activeTools, 1);
  assert.equal(t.publisher.reset("cli-a"), true);
  assert.equal(t.last(), "thread.idle");
  assert.equal(t.publisher.status().sessionId, null);
  assert.equal(t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "delayed" }), false);
  assert.equal(t.publisher.status().sessionId, null);
  assert.equal(t.send("UserPromptSubmit", { session_id: "cli-b", turn_id: "new" }), true);
});

test("manual reset preserves an explicitly pinned session", () => {
  const publisher = createHookEventPublisher(() => {}, "pinned");
  assert.equal(publisher.reset("pinned"), true);
  assert.equal(publisher.status().sessionId, "pinned");
});
test("ignores other sessions and stale turn events, accepts subsequent turns", () => {
  const t = setup();
  t.send("UserPromptSubmit");
  assert.equal(t.send("UserPromptSubmit", { session_id: "cli-b" }), false);
  t.send("Stop");
  assert.equal(t.last(), "turn.completed");
  assert.equal(t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "late" }), false);
  t.send("UserPromptSubmit", { turn_id: "turn-b" });
  assert.equal(t.last(), "turn.started");
  assert.equal(t.send("Stop"), false);
});
test("parallel tool completion keeps the remaining tool active", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  t.send("PreToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(t.last(), "file.change");
  t.send("PostToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(t.last(), "command.started");
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "shell" });
  assert.equal(t.last(), "reasoning.started");
});
test("approval is observable without resolving it; interruption closes the turn", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PermissionRequest", { tool_name: "Bash" });
  assert.equal(t.last(), "approval.requested");
  t.send("Interrupt");
  assert.equal(t.last(), "thread.idle");
  assert.equal(t.send("Stop"), false);
});
test("session end releases ownership and repeated event ids are ignored", () => {
  const t = setup(); const event = t.event("UserPromptSubmit");
  assert.equal(t.publisher.receive(event), true);
  assert.equal(t.publisher.receive(event), false);
  t.send("SessionEnd", { turn_id: undefined });
  assert.equal(t.publisher.status().sessionId, null);
  assert.equal(t.send("UserPromptSubmit", { session_id: "cli-b" }), true);
});
test("an unrelated tool finishing does not clear a pending approval", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PermissionRequest", { tool_name: "Bash" });
  t.send("PostToolUse", { tool_name: "apply_patch", tool_use_id: "edit" });
  assert.equal(t.last(), "approval.requested");
});
test("rejects malformed events and missing tool/turn identities", () => {
  const t = setup();
  assert.equal(isHookEvent(null), false);
  assert.equal(isHookEvent(t.event("PreToolUse")), false);
  assert.equal(isHookEvent(t.event("Stop", { turn_id: undefined })), false);
  assert.equal(isHookEvent(t.event("UserPromptSubmit")), true);
});

test("same-name tool completion only clears its own approval", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "running" });
  t.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "waiting" });
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "running" });
  assert.equal(t.last(), "approval.requested");
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "waiting" });
  assert.equal(t.last(), "reasoning.started");
});

test("parallel same-name approvals remain waiting until both complete", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "first" });
  t.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "second" });
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "first" });
  assert.equal(t.last(), "approval.requested");
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "second" });
  assert.equal(t.last(), "reasoning.started");
});

test("approval without an invocation ID is retained until the turn closes", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("PermissionRequest", { tool_name: "Bash" });
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "other" });
  assert.equal(t.last(), "approval.requested");
  t.send("Stop");
  assert.equal(t.last(), "turn.completed");
  t.send("UserPromptSubmit", { turn_id: "next" });
  t.send("PreToolUse", { turn_id: "next", tool_name: "Bash", tool_use_id: "next-tool" });
  assert.equal(t.last(), "command.started");
});

test("ID-less approval resumes on matching input; other same-name calls cannot clear it", () => {
  const t = setup(); t.send("UserPromptSubmit");
  const a = "a".repeat(64), b = "b".repeat(64);
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "approved", tool_input_hash: a });
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "other", tool_input_hash: b });
  t.send("PermissionRequest", { tool_name: "Bash", tool_input_hash: a });
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "other", tool_input_hash: b });
  assert.equal(t.last(), "approval.requested");
  t.send("PostToolUse", { tool_name: "Bash", tool_use_id: "approved", tool_input_hash: a });
  assert.equal(t.last(), "reasoning.started");
  assert.equal(t.publisher.status().pendingApprovals, 0);
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "next" });
  assert.equal(t.last(), "command.started");
});

test("identical parallel calls keep ambiguous approval until all candidates finish", () => {
  const t = setup(); t.send("UserPromptSubmit");
  const fields = { tool_name: "Bash", tool_input_hash: "a".repeat(64) };
  t.send("PreToolUse", { ...fields, tool_use_id: "a" });
  t.send("PreToolUse", { ...fields, tool_use_id: "b" });
  t.send("PermissionRequest", fields);
  t.send("PostToolUse", { ...fields, tool_use_id: "a" });
  assert.equal(t.last(), "approval.requested");
  t.send("PostToolUse", { ...fields, tool_use_id: "b" });
  assert.equal(t.last(), "reasoning.started");
});

test("missing PreToolUse can recover with matching PostToolUse; rejected approvals can finish normally", () => {
  const t = setup(); t.send("UserPromptSubmit");
  const fields = { tool_name: "Bash", tool_input_hash: "a".repeat(64) };
  t.send("PermissionRequest", fields);
  t.send("PostToolUse", { ...fields, tool_use_id: "returned-error" });
  assert.equal(t.last(), "reasoning.started");
  t.send("Stop"); assert.equal(t.last(), "turn.completed");
});

test("older observed prompts and duplicate prompts do not replace active work", () => {
  const t = setup(); t.send("UserPromptSubmit", { observed_at: 200 });
  t.send("PreToolUse", { tool_name: "Bash", tool_use_id: "active" });
  assert.equal(t.send("UserPromptSubmit", { turn_id: "old", observed_at: 100 }), false);
  assert.equal(t.send("UserPromptSubmit", { observed_at: 201 }), false);
  assert.equal(t.publisher.status().activeTools, 1);
  assert.equal(t.send("UserPromptSubmit", { turn_id: "next", observed_at: 300 }), true);
  assert.equal(t.publisher.status().activeTools, 0);
});

test("subagent completion never completes its parent turn", () => {
  const t = setup(); t.send("UserPromptSubmit");
  t.send("SubagentStart", { agent_id: "a" }); t.send("SubagentStart", { agent_id: "b" });
  t.send("SubagentStop", { agent_id: "a" }); assert.equal(t.last(), "tool.started");
  t.send("SubagentStop", { agent_id: "b" }); assert.equal(t.last(), "reasoning.started");
  t.send("Stop"); assert.equal(t.last(), "turn.completed");
});
