import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexEventPublisher, mapCodexNotificationToAgentEvent as map } from "./events";
import type { TurnOutcome, ThreadActiveFlag } from "./contract";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

test("official string outcomes never turn failed, interrupted or unknown into done", () => {
  for (const [status, expected] of [["completed","turn.completed"],["failed","turn.failed"],["interrupted","thread.idle"]] as const) {
    const params: TurnOutcome = { threadId: "s", turn: { id: "t", status, error: status === "failed" ? { message: "404" } : null } };
    assert.equal(map({ method: "turn/completed", params })?.type, expected);
  }
  for (const status of [undefined, "future", { type: "failed" }, "inProgress"]) {
    assert.equal(map({ method: "turn/completed", params: { turn: { status } } }), undefined);
  }
});

test("waiting flags and retry errors respect official semantics", () => {
  for (const flag of ["waitingOnApproval", "waitingOnUserInput"] satisfies ThreadActiveFlag[]) {
    assert.equal(map({ method: "thread/status/changed", params: { status: { type: "active", activeFlags: [flag] } } })?.type, "approval.requested");
  }
  assert.equal(map({ method: "error", params: { willRetry: true, error: { message: "retry" } } }), undefined);
  assert.equal(map({ method: "error", params: { willRetry: false, error: { message: "404" } } })?.type, "turn.failed");
  assert.equal(map({ method: "item/completed", params: { item: { type: "commandExecution", status: "failed" } } }), undefined);
});

test("context compaction and image operations use existing expressions", () => {
  for (const [type, expected] of [["contextCompaction","reasoning.started"],["imageView","tool.started"],["imageGeneration","tool.started"]])
    assert.equal(map({ method: "item/started", params: { item: { type } } })?.type, expected);
});

function setup() {
  const messages: StatusMessage[] = [];
  const p = createCodexEventPublisher({ config: { messageDeltaThrottleMs: 0 }, sendStatusMessage: e => messages.push(e) });
  const send = (method: string, fields: Record<string, unknown> = {}) => p.publishNotificationFromCodex({ method, params: { threadId: "s", ...fields } });
  const last = () => { const m = messages[messages.length - 1]; return m?.kind === "agent.event" ? m.event.type : undefined; };
  send("turn/started", { turn: { id: "t", status: "inProgress" } });
  return { p, send, last, messages };
}

test("parallel tools and approval resolution restore the actual remaining activity", () => {
  const t = setup();
  t.send("item/started", { turnId: "t", item: { id: "a", type: "commandExecution" } });
  t.send("item/started", { turnId: "t", item: { id: "b", type: "fileChange" } });
  t.p.publishServerRequestFromCodex({ id: "r", method: "item/commandExecution/requestApproval", params: { threadId: "s", turnId: "t" } });
  t.send("item/agentMessage/delta", { turnId: "t" });
  assert.equal(t.last(), "approval.requested");
  t.send("item/completed", { turnId: "t", item: { id: "b", type: "fileChange", status: "failed" } });
  assert.equal(t.last(), "approval.requested");
  t.send("serverRequest/resolved", { requestId: "r" });
  assert.equal(t.last(), "command.started");
  t.send("item/completed", { turnId: "t", item: { id: "a", type: "commandExecution", status: "failed" } });
  assert.equal(t.last(), "reasoning.started");
  t.send("turn/completed", { turn: { id: "t", status: "completed" } });
  assert.equal(t.last(), "turn.completed");
});

test("flags hold waiting until cleared, terminal states reject late output and other threads", () => {
  const t = setup();
  t.send("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnUserInput"] } });
  t.send("item/reasoning/textDelta", { turnId: "t" });
  assert.equal(t.last(), "approval.requested");
  t.send("thread/status/changed", { status: { type: "active", activeFlags: [] } });
  assert.equal(t.last(), "reasoning.started");
  t.send("error", { turnId: "t", willRetry: false, error: { message: "404" } });
  const count = t.messages.length;
  t.send("turn/completed", { turn: { id: "t", status: "failed" } });
  t.send("thread/status/changed", { status: { type: "idle" } });
  t.send("item/agentMessage/delta", { turnId: "t" });
  t.send("turn/started", { threadId: "other", turn: { id: "foreign" } });
  assert.equal(t.messages.length, count);
  assert.equal(t.last(), "turn.failed");
  t.send("turn/started", { turn: { id: "next", status: "inProgress" } });
  t.send("item/agentMessage/delta", { turnId: "t" });
  assert.equal(t.last(), "turn.started");
  t.send("turn/completed", { turn: { id: "next", status: "interrupted" } });
  assert.equal(t.last(), "thread.idle");
});
