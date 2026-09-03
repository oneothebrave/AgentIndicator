import {
  isAgentEventOrigin,
  isAgentEventType,
  type AgentEvent,
} from "./agentStatus";

export const STATUS_PROTOCOL_VERSION = 1;
export const BRIDGE_HELLO_KIND = "bridge.hello";
export const AGENT_EVENT_KIND = "agent.event";

export type AgentEventInput = Omit<AgentEvent, "at"> &
  Partial<Pick<AgentEvent, "at">>;

export type BridgeHelloInput = {
  source: string;
  at?: number;
  intervalMs?: number;
};

export type BridgeHelloMessage = {
  kind: typeof BRIDGE_HELLO_KIND;
  source: string;
  version: typeof STATUS_PROTOCOL_VERSION;
  at: number;
  intervalMs?: number;
};

export type AgentEventMessage = {
  kind: typeof AGENT_EVENT_KIND;
  event: AgentEvent;
};

export type StatusMessage = BridgeHelloMessage | AgentEventMessage;

export function bridgeHelloMessage(input: BridgeHelloInput): BridgeHelloMessage {
  return {
    kind: BRIDGE_HELLO_KIND,
    source: input.source,
    version: STATUS_PROTOCOL_VERSION,
    at: input.at ?? Date.now(),
    intervalMs: input.intervalMs,
  };
}

export function normalizeAgentEvent(input: AgentEventInput): AgentEvent {
  return {
    id: input.id,
    type: input.type,
    at: input.at ?? Date.now(),
    origin: input.origin,
    label: input.label,
    detail: input.detail,
  };
}

export function agentEventMessage(event: AgentEvent): AgentEventMessage {
  return {
    kind: AGENT_EVENT_KIND,
    event,
  };
}

export function isStatusMessage(value: unknown): value is StatusMessage {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === BRIDGE_HELLO_KIND) {
    return (
      typeof value.source === "string" &&
      value.version === STATUS_PROTOCOL_VERSION &&
      typeof value.at === "number" &&
      (value.intervalMs === undefined || typeof value.intervalMs === "number")
    );
  }

  if (value.kind === AGENT_EVENT_KIND) {
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
    !isAgentEventOrigin(value.origin) ||
    !isAgentEventType(value.type)
  ) {
    return false;
  }

  return isOptionalString(value.label) && isOptionalString(value.detail);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
