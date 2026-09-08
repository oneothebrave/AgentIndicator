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
