import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexEventPublisher, mapCodexNotificationToAgentEvent as map } from "./events";
import type { TurnOutcome, ThreadActiveFlag } from "./contract";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

test("official string outcomes never turn failed, interrupted or unknown into done", () => {
  for (const [status, expected] of [
    ["completed", "turn.completed"],
    ["failed", "turn.failed"],
    ["interrupted", "thread.idle"],
  ] as const) {
    const params: TurnOutcome = {
      threadId: "s",
      turn: { id: "t", status, error: status === "failed" ? { message: "404" } : null },
    };
    assert.equal(map({ method: "turn/completed", params })?.type, expected);
  }
  for (const status of [undefined, "future", { type: "failed" }, "inProgress"]) {
    assert.equal(map({ method: "turn/completed", params: { turn: { status } } }), undefined);
  }
});

test("waiting flags and retry errors respect official semantics", () => {
  for (const flag of ["waitingOnApproval", "waitingOnUserInput"] satisfies ThreadActiveFlag[]) {
    assert.equal(
      map({
        method: "thread/status/changed",
        params: { status: { type: "active", activeFlags: [flag] } },
      })?.type,
      "approval.requested",
    );
  }
  assert.equal(
    map({ method: "error", params: { willRetry: true, error: { message: "retry" } } }),
    undefined,
  );
  assert.equal(
    map({ method: "error", params: { willRetry: false, error: { message: "404" } } })?.type,
    "turn.failed",
  );
  assert.equal(
    map({
      method: "item/completed",
      params: { item: { type: "commandExecution", status: "failed" } },
    }),
    undefined,
  );
});

test("context compaction and image operations use existing expressions", () => {
  for (const [type, expected] of [
    ["contextCompaction", "reasoning.started"],
    ["imageView", "tool.started"],
    ["imageGeneration", "tool.started"],
  ]) {
    assert.equal(map({ method: "item/started", params: { item: { type } } })?.type, expected);
  }
});

function setup() {
  const messages: StatusMessage[] = [];
  const publisher = createCodexEventPublisher({
    config: { messageDeltaThrottleMs: 0 },
    sendStatusMessage: (message) => messages.push(message),
  });
  const send = (method: string, fields: Record<string, unknown> = {}) =>
    publisher.publishNotificationFromCodex({ method, params: { threadId: "s", ...fields } });
  const last = () => {
    const message = messages[messages.length - 1];
    return message?.kind === "agent.event" ? message.event.type : undefined;
  };
  send("turn/started", { turn: { id: "t", status: "inProgress" } });
  return { p: publisher, send, last, messages };
}

test("parallel tools and approval resolution restore the actual remaining activity", () => {
  const state = setup();
  state.send("item/started", { turnId: "t", item: { id: "a", type: "commandExecution" } });
  state.send("item/started", { turnId: "t", item: { id: "b", type: "fileChange" } });
  state.p.publishServerRequestFromCodex({
    id: "r",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "s", turnId: "t" },
  });
  state.send("item/agentMessage/delta", { turnId: "t" });
  assert.equal(state.last(), "approval.requested");
  state.send("item/completed", {
    turnId: "t",
    item: { id: "b", type: "fileChange", status: "failed" },
  });
  assert.equal(state.last(), "approval.requested");
  state.send("serverRequest/resolved", { requestId: "r" });
  assert.equal(state.last(), "command.started");
  state.send("item/completed", {
    turnId: "t",
    item: { id: "a", type: "commandExecution", status: "failed" },
  });
  assert.equal(state.last(), "reasoning.started");
  state.send("turn/completed", { turn: { id: "t", status: "completed" } });
  assert.equal(state.last(), "turn.completed");
});

test("flags hold waiting until cleared, terminal states reject late output and other threads", () => {
  const state = setup();
  state.send("thread/status/changed", {
    status: { type: "active", activeFlags: ["waitingOnUserInput"] },
  });
  state.send("item/reasoning/textDelta", { turnId: "t" });
  assert.equal(state.last(), "approval.requested");
  state.send("thread/status/changed", { status: { type: "active", activeFlags: [] } });
  assert.equal(state.last(), "reasoning.started");
  state.send("error", { turnId: "t", willRetry: false, error: { message: "404" } });
  const count = state.messages.length;
  state.send("turn/completed", { turn: { id: "t", status: "failed" } });
  state.send("thread/status/changed", { status: { type: "idle" } });
  state.send("item/agentMessage/delta", { turnId: "t" });
  state.send("turn/started", { threadId: "other", turn: { id: "foreign" } });
  assert.equal(state.messages.length, count);
  assert.equal(state.last(), "turn.failed");
  state.send("turn/started", { turn: { id: "next", status: "inProgress" } });
  state.send("item/agentMessage/delta", { turnId: "t" });
  assert.equal(state.last(), "turn.started");
  state.send("turn/completed", { turn: { id: "next", status: "interrupted" } });
  assert.equal(state.last(), "thread.idle");
});
