import assert from "node:assert/strict";
import { test } from "node:test";
import { hookPayload } from "./hook-payload.mjs";

test("approval fingerprints survive metadata differences without exposing commands", () => {
  const raw = { session_id: "s", turn_id: "t", tool_name: "Bash", tool_input: { command: "private command" } };
  const pre = hookPayload({ ...raw, hook_event_name: "PreToolUse", tool_use_id: "call" });
  const approval = hookPayload({ ...raw, hook_event_name: "PermissionRequest", tool_input: { ...raw.tool_input, description: "approval reason" } });
  assert.equal(pre.tool_input_hash, approval.tool_input_hash);
  assert.equal(JSON.stringify(pre).includes("private"), false);
  assert.notEqual(pre.tool_input_hash, hookPayload({ ...raw, turn_id: "other" }).tool_input_hash);
  assert.notEqual(pre.tool_input_hash, hookPayload({ ...raw, tool_input: { command: "other" } }).tool_input_hash);
});

test("structured tool input hashing is stable across property order", () => {
  const raw = { session_id: "s", turn_id: "t", tool_name: "mcp__test__run" };
  assert.equal(hookPayload({ ...raw, tool_input: { a: 1, b: [2, 3] } }).tool_input_hash,
    hookPayload({ ...raw, tool_input: { b: [2, 3], a: 1 } }).tool_input_hash);
});
