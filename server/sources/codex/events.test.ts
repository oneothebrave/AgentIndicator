import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEventType } from "../../../src/domain/agentStatus";
import {
  AGENT_EVENT_KIND,
  type StatusMessage,
} from "../../../src/domain/statusProtocol";
import {
  createCodexEventPublisher,
  mapCodexNotificationToAgentEvent,
  mapCodexServerRequestToAgentEvent,
} from "./events";
import type { JsonRpcServerRequest } from "./jsonRpc";
import { resolveServerRequest } from "./serverRequests";

describe("Codex app-server notification mapping", () => {
  it("maps thread lifecycle status changes", () => {
    assertNotificationEvent(
      { method: "thread/status/changed", params: { status: { type: "active" } } },
      "reasoning.started",
    );
    assertNotificationEvent(
      { method: "thread/status/changed", params: { status: { type: "idle" } } },
      "thread.idle",
    );
    assertNotificationEvent(
      {
        method: "thread/status/changed",
        params: { status: { type: "systemError" } },
      },
      "turn.failed",
    );
  });

  it("maps turn lifecycle notifications", () => {
    assertNotificationEvent({ method: "turn/started" }, "turn.started");
    assertNotificationEvent(
      { method: "turn/completed", params: { turn: { status: { type: "completed" } } } },
      "turn.completed",
    );
    assertNotificationEvent(
      {
        method: "turn/completed",
        params: {
          turn: {
            status: { type: "failed" },
            error: { message: "model failed" },
          },
        },
      },
      "turn.failed",
      "model failed",
    );
  });

  it("maps actionable item starts to status events", () => {
    assertNotificationEvent(
      {
        method: "item/started",
        params: { item: { type: "commandExecution", command: "npm test" } },
      },
      "command.started",
      "npm test",
    );
    assertNotificationEvent(
      { method: "item/started", params: { item: { type: "fileChange" } } },
      "file.change",
    );
    assertNotificationEvent(
      { method: "item/started", params: { item: { type: "webSearch" } } },
      "search.started",
    );
    assertNotificationEvent(
      { method: "item/started", params: { item: { type: "mcpToolCall" } } },
      "tool.started",
    );
    assertNotificationEvent(
      { method: "item/started", params: { item: { type: "agentMessage" } } },
      "message.delta",
    );
  });

  it("ignores user-authored and unknown item starts", () => {
    assert.equal(
      mapCodexNotificationToAgentEvent({
        method: "item/started",
        params: { item: { type: "userMessage" } },
      }),
      undefined,
    );
    assert.equal(
      mapCodexNotificationToAgentEvent({
        method: "item/started",
        params: { item: { type: "unknownFutureItem" } },
      }),
      undefined,
    );
  });

  it("maps stream delta notifications", () => {
    assertNotificationEvent(
      { method: "item/commandExecution/outputDelta" },
      "command.started",
    );
    assertNotificationEvent({ method: "item/agentMessage/delta" }, "message.delta");
    assertNotificationEvent(
      { method: "item/reasoning/summaryTextDelta" },
      "reasoning.started",
    );
    assertNotificationEvent({ method: "turn/diff/updated" }, "file.change");
  });
});

describe("Codex app-server server request mapping", () => {
  it("maps documented approval and input requests to Waiting", () => {
    const documentedRequestMethods = [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
    ];

    for (const method of documentedRequestMethods) {
      const event = mapCodexServerRequestToAgentEvent(
        serverRequest(method),
      );

      assert.equal(event?.type, "approval.requested", method);
      assert.equal(event?.origin, "codex", method);
      assert.equal(event?.label, "Waiting", method);
    }
  });

  it("does not map undocumented server request methods", () => {
    assert.equal(
      mapCodexServerRequestToAgentEvent(serverRequest("undocumented/request")),
      undefined,
    );
  });
});

describe("Codex app-server server request responses", () => {
  it("declines documented command and file-change approval requests", () => {
    assert.deepEqual(
      resolveServerRequest(serverRequest("item/commandExecution/requestApproval")),
      { decision: "decline" },
    );
    assert.deepEqual(
      resolveServerRequest(serverRequest("item/fileChange/requestApproval")),
      { decision: "decline" },
    );
  });

  it("responds to documented permission, tool-input, and MCP elicitation requests", () => {
    assert.deepEqual(
      resolveServerRequest(serverRequest("item/permissions/requestApproval")),
      { permissions: {}, scope: "turn" },
    );
    assert.deepEqual(resolveServerRequest(serverRequest("item/tool/requestUserInput")), {
      answers: {},
    });
    assert.deepEqual(resolveServerRequest(serverRequest("mcpServer/elicitation/request")), {
      action: "decline",
      content: null,
      _meta: null,
    });
  });

  it("throws for unsupported server request methods", () => {
    assert.throws(() => resolveServerRequest(serverRequest("undocumented/request")));
  });
});

describe("Codex event publisher", () => {
  it("emits status messages with the bridge protocol kind", () => {
    const messages: StatusMessage[] = [];
    const publisher = createCodexEventPublisher({
      config: { messageDeltaThrottleMs: 0 },
      sendStatusMessage(message) {
        messages.push(message);
      },
    });

    publisher.publishNotificationFromCodex({ method: "turn/started" });

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.kind, AGENT_EVENT_KIND);
    assert.equal(messages[0]?.event.type, "turn.started");
    assert.equal(messages[0]?.event.origin, "codex");
  });

  it("throttles high-frequency message deltas", () => {
    const messages: StatusMessage[] = [];
    const publisher = createCodexEventPublisher({
      config: { messageDeltaThrottleMs: 60_000 },
      sendStatusMessage(message) {
        messages.push(message);
      },
    });

    publisher.publishNotificationFromCodex({ method: "item/agentMessage/delta" });
    publisher.publishNotificationFromCodex({ method: "item/agentMessage/delta" });
    publisher.publishNotificationFromCodex({ method: "turn/completed" });

    assert.deepEqual(
      messages.map((message) => message.kind === AGENT_EVENT_KIND && message.event.type),
      ["message.delta", "turn.completed"],
    );
  });
});

function assertNotificationEvent(
  notification: Parameters<typeof mapCodexNotificationToAgentEvent>[0],
  expectedType: AgentEventType,
  expectedDetail?: string,
) {
  const event = mapCodexNotificationToAgentEvent(notification);

  assert.equal(event?.type, expectedType);
  assert.equal(event?.origin, "codex");
  assert.equal(typeof event?.id, "string");
  assert.equal(typeof event?.at, "number");

  if (expectedDetail) {
    assert.equal(event?.detail, expectedDetail);
  }
}

function serverRequest(method: string): JsonRpcServerRequest {
  return {
    id: "test-request",
    method,
    params: {
      threadId: "test-thread",
      turnId: "test-turn",
    },
  };
}
