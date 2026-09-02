import { isAgentEventType, type AgentEvent } from "./agentStatus";

export type BridgeHelloMessage = {
  kind: "bridge.hello";
  source: "mock-bridge";
  version: 1;
  at: number;
  intervalMs: number;
};

export type AgentEventMessage = {
  kind: "agent.event";
  event: AgentEvent;
};

export type StatusMessage = BridgeHelloMessage | AgentEventMessage;

export function isStatusMessage(value: unknown): value is StatusMessage {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "bridge.hello") {
    return (
      value.source === "mock-bridge" &&
      value.version === 1 &&
      typeof value.at === "number" &&
      typeof value.intervalMs === "number"
    );
  }

  if (value.kind === "agent.event") {
    return isAgentEvent(value.event);
  }

  return false;
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.at !== "number" ||
    value.source !== "bridge" ||
    !isAgentEventType(value.type)
  ) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
