import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../../../src/domain/agentStatus";
import {
  agentEventMessage,
  normalizeAgentEvent,
} from "../../../src/domain/statusProtocol";
import type { PublishStatusMessage } from "../statusSource";
import type { CodexAgentEventInput, CodexNotification } from "./types";
import { getErrorMessage, getNestedString, getNestedValue } from "./utils";

const CODEX_SOURCE_ORIGIN = "codex";

export function publishNotificationFromCodex(
  publish: PublishStatusMessage,
  notification: CodexNotification,
) {
  const event = mapCodexNotificationToAgentEvent(notification);

  if (event) {
    publish(agentEventMessage(event));
  }
}

export function publishAgentEvent(
  publish: PublishStatusMessage,
  input: CodexAgentEventInput,
) {
  publish(
    agentEventMessage(
      normalizeAgentEvent({
        id: randomUUID(),
        origin: CODEX_SOURCE_ORIGIN,
        ...input,
      }),
    ),
  );
}

export function mapCodexNotificationToAgentEvent(
  notification: CodexNotification,
): AgentEvent | undefined {
  const input = mapCodexNotificationToInput(notification);

  if (!input) {
    return undefined;
  }

  return normalizeAgentEvent({
    id: randomUUID(),
    origin: CODEX_SOURCE_ORIGIN,
    ...input,
  });
}

function mapCodexNotificationToInput(
  notification: CodexNotification,
): CodexAgentEventInput | undefined {
  switch (notification.method) {
    case "error":
      return {
        type: "turn.failed",
        label: "Error",
        detail: getErrorMessage(notification.params, "Codex app-server error"),
      };
    case "thread/status/changed":
      return mapThreadStatusChanged(notification.params);
    case "turn/started":
      return {
        type: "turn.started",
        label: "Thinking",
        detail: "Codex turn started",
      };
    case "turn/completed":
      return mapTurnCompleted(notification.params);
    case "turn/diff/updated":
    case "item/fileChange/patchUpdated":
    case "item/fileChange/outputDelta":
      return {
        type: "file.change",
        label: "Editing",
        detail: "Codex updated files",
      };
    case "turn/plan/updated":
    case "item/plan/delta":
      return {
        type: "reasoning.started",
        label: "Thinking",
        detail: "Codex updated its plan",
      };
    case "item/started":
      return mapItemStarted(notification.params);
    case "item/completed":
      return mapItemCompleted(notification.params);
    case "item/agentMessage/delta":
      return {
        type: "message.delta",
        label: "Speaking",
        detail: "Codex is writing a response",
      };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return {
        type: "reasoning.started",
        label: "Thinking",
        detail: "Codex is reasoning",
      };
    case "item/commandExecution/outputDelta":
    case "command/exec/outputDelta":
    case "process/outputDelta":
      return {
        type: "command.started",
        label: "Running",
        detail: "Codex command is producing output",
      };
    case "item/mcpToolCall/progress":
      return {
        type: "tool.started",
        label: "Tool",
        detail: "Codex tool call is in progress",
      };
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
      return {
        type: "approval.requested",
        label: "Waiting",
        detail: "Codex is waiting for approval or input",
      };
    default:
      return undefined;
  }
}

function mapThreadStatusChanged(
  params: unknown,
): CodexAgentEventInput | undefined {
  const status = getNestedString(params, ["status", "type"]);

  if (status === "active") {
    return {
      type: "reasoning.started",
      label: "Thinking",
      detail: "Codex thread is active",
    };
  }

  if (status === "systemError") {
    return {
      type: "turn.failed",
      label: "Error",
      detail: "Codex thread reported a system error",
    };
  }

  return undefined;
}

function mapTurnCompleted(params: unknown): CodexAgentEventInput {
  const status = getNestedString(params, ["turn", "status", "type"]);
  const legacyStatus = getNestedString(params, ["turn", "status"]);

  if (status === "failed" || legacyStatus === "failed") {
    return {
      type: "turn.failed",
      label: "Error",
      detail: getErrorMessage(
        getNestedValue(params, ["turn", "error"]),
        "Codex turn failed",
      ),
    };
  }

  if (status === "interrupted" || legacyStatus === "interrupted") {
    return {
      type: "turn.completed",
      label: "Interrupted",
      detail: "Codex turn was interrupted",
    };
  }

  return {
    type: "turn.completed",
    label: "Done",
    detail: "Codex turn completed",
  };
}

function mapItemStarted(params: unknown): CodexAgentEventInput {
  const itemType = getItemType(params);

  if (itemType === "reasoning" || itemType === "plan") {
    return {
      type: "reasoning.started",
      label: "Thinking",
      detail: `Codex started ${itemType}`,
    };
  }

  if (itemType === "fileChange") {
    return {
      type: "file.change",
      label: "Editing",
      detail: "Codex started a file change",
    };
  }

  if (itemType === "commandExecution") {
    return {
      type: "command.started",
      label: "Running",
      detail:
        getNestedString(params, ["item", "command"]) ??
        "Codex started a command",
    };
  }

  if (itemType === "webSearch") {
    return {
      type: "search.started",
      label: "Searching",
      detail: "Codex started a web search",
    };
  }

  if (
    itemType === "mcpToolCall" ||
    itemType === "dynamicToolCall" ||
    itemType === "collabAgentToolCall"
  ) {
    return {
      type: "tool.started",
      label: "Tool",
      detail: `Codex started ${itemType}`,
    };
  }

  if (itemType === "agentMessage") {
    return {
      type: "message.delta",
      label: "Speaking",
      detail: "Codex started a response",
    };
  }

  return {
    type: "tool.started",
    label: "Tool",
    detail: itemType ? `Codex started ${itemType}` : "Codex started an item",
  };
}

function mapItemCompleted(params: unknown): CodexAgentEventInput | undefined {
  const itemType = getItemType(params);

  if (!itemType) {
    return undefined;
  }

  const itemStatus =
    getNestedString(params, ["item", "status", "type"]) ??
    getNestedString(params, ["item", "status"]);

  if (
    itemStatus === "failed" ||
    itemStatus === "error" ||
    getNestedValue(params, ["item", "error"])
  ) {
    return {
      type: "turn.failed",
      label: "Error",
      detail: `Codex ${itemType} failed`,
    };
  }

  return undefined;
}

function getItemType(params: unknown): string | undefined {
  return getNestedString(params, ["item", "type"]);
}
