export type AgentState =
  | "idle"
  | "thinking"
  | "editing"
  | "running"
  | "tool"
  | "searching"
  | "waiting"
  | "speaking"
  | "done"
  | "error"
  | "sleepy"
  | "sleep";

export type AgentEventSource = "bridge";

export type AgentEventType =
  | "turn.started"
  | "reasoning.started"
  | "file.change"
  | "command.started"
  | "tool.started"
  | "search.started"
  | "approval.requested"
  | "message.delta"
  | "turn.completed"
  | "turn.failed"
  | "inactivity.sleepy"
  | "inactivity.sleep";

export type AgentEvent = {
  id: string;
  type: AgentEventType;
  at: number;
  source: AgentEventSource;
  label?: string;
  detail?: string;
};

export type AgentSnapshot = {
  state: AgentState;
  label: string;
  detail: string;
  accent: string;
  progress: number;
  updatedAt: number;
  eventCount: number;
  lastEventType?: AgentEventType;
  lastEventSource?: AgentEventSource;
};

export type StateMeta = {
  label: string;
  detail: string;
  accent: string;
  progress: number;
};

export const agentEventTypes: AgentEventType[] = [
  "turn.started",
  "reasoning.started",
  "file.change",
  "command.started",
  "tool.started",
  "search.started",
  "approval.requested",
  "message.delta",
  "turn.completed",
  "turn.failed",
  "inactivity.sleepy",
  "inactivity.sleep",
];

export const stateMeta: Record<AgentState, StateMeta> = {
  idle: {
    label: "Idle",
    detail: "Ready for the next turn",
    accent: "#64d2ff",
    progress: 4,
  },
  thinking: {
    label: "Thinking",
    detail: "Planning the next move",
    accent: "#a78bfa",
    progress: 24,
  },
  editing: {
    label: "Editing",
    detail: "Changing files",
    accent: "#34d399",
    progress: 42,
  },
  running: {
    label: "Running",
    detail: "Executing commands",
    accent: "#fbbf24",
    progress: 58,
  },
  tool: {
    label: "Tool",
    detail: "Calling a tool",
    accent: "#22d3ee",
    progress: 66,
  },
  searching: {
    label: "Searching",
    detail: "Looking up context",
    accent: "#38bdf8",
    progress: 72,
  },
  waiting: {
    label: "Waiting",
    detail: "Needs approval or input",
    accent: "#fb7185",
    progress: 50,
  },
  speaking: {
    label: "Speaking",
    detail: "Writing a response",
    accent: "#f472b6",
    progress: 86,
  },
  done: {
    label: "Done",
    detail: "Turn completed",
    accent: "#86efac",
    progress: 100,
  },
  error: {
    label: "Error",
    detail: "Something failed",
    accent: "#f87171",
    progress: 100,
  },
  sleepy: {
    label: "Sleepy",
    detail: "No recent activity",
    accent: "#c4b5fd",
    progress: 8,
  },
  sleep: {
    label: "Sleep",
    detail: "Low activity mode",
    accent: "#64748b",
    progress: 0,
  },
};

export function createInitialSnapshot(now = Date.now()): AgentSnapshot {
  const meta = stateMeta.idle;

  return {
    state: "idle",
    label: meta.label,
    detail: meta.detail,
    accent: meta.accent,
    progress: meta.progress,
    updatedAt: now,
    eventCount: 0,
  };
}

export function reduceAgentSnapshot(
  snapshot: AgentSnapshot,
  event: AgentEvent,
): AgentSnapshot {
  const resolvedState = mapEventToState(event, snapshot.state);
  const meta = stateMeta[resolvedState];

  return {
    state: resolvedState,
    label: event.label ?? meta.label,
    detail: event.detail ?? meta.detail,
    accent: meta.accent,
    progress: meta.progress,
    updatedAt: event.at,
    eventCount: snapshot.eventCount + 1,
    lastEventType: event.type,
    lastEventSource: event.source,
  };
}

export function mapEventToState(
  event: AgentEvent,
  fallback: AgentState,
): AgentState {
  switch (event.type) {
    case "turn.started":
      return "thinking";
    case "reasoning.started":
      return "thinking";
    case "file.change":
      return "editing";
    case "command.started":
      return "running";
    case "tool.started":
      return "tool";
    case "search.started":
      return "searching";
    case "approval.requested":
      return "waiting";
    case "message.delta":
      return "speaking";
    case "turn.completed":
      return "done";
    case "turn.failed":
      return "error";
    case "inactivity.sleepy":
      return "sleepy";
    case "inactivity.sleep":
      return "sleep";
    default:
      return fallback;
  }
}

export function isAgentEventType(value: unknown): value is AgentEventType {
  return (
    typeof value === "string" && agentEventTypes.includes(value as AgentEventType)
  );
}
