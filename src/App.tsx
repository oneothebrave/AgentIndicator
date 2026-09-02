import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  createInitialSnapshot,
  reduceAgentSnapshot,
  type AgentEvent,
  type AgentSnapshot,
} from "./domain/agentStatus";
import { EventLog } from "./components/EventLog";
import { RoundScreen } from "./components/RoundScreen";
import { StatusControls } from "./components/StatusControls";
import { useStatusStream } from "./hooks/useStatusStream";

const STATUS_STREAM_URL = "ws://127.0.0.1:8787/status";

type SnapshotAction =
  | { type: "event"; event: AgentEvent }
  | { type: "reset"; at: number };

function snapshotReducer(
  snapshot: AgentSnapshot,
  action: SnapshotAction,
): AgentSnapshot {
  switch (action.type) {
    case "event":
      return reduceAgentSnapshot(snapshot, action.event);
    case "reset":
      return createInitialSnapshot(action.at);
    default:
      return snapshot;
  }
}

export default function App() {
  const [snapshot, dispatch] = useReducer(
    snapshotReducer,
    undefined,
    createInitialSnapshot,
  );
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [clock, setClock] = useState(() => new Date());

  const recentEvents = useMemo(() => events.slice(0, 10), [events]);

  const pushEvent = useCallback((event: AgentEvent) => {
    dispatch({ type: "event", event });
    setEvents((current) => [event, ...current].slice(0, 40));
  }, []);

  const stream = useStatusStream({
    url: STATUS_STREAM_URL,
    onEvent: pushEvent,
  });

  const reset = useCallback(() => {
    setEvents([]);
    dispatch({ type: "reset", at: Date.now() });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);

    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="appShell">
      <div className="workspace">
        <RoundScreen snapshot={snapshot} clock={clock} />
        <div className="sideColumn">
          <StatusControls
            streamUrl={STATUS_STREAM_URL}
            connectionState={stream.connectionState}
            lastError={stream.lastError}
            lastMessageAt={stream.lastMessageAt}
            onReset={reset}
          />
          <EventLog events={recentEvents} />
        </div>
      </div>
    </main>
  );
}
