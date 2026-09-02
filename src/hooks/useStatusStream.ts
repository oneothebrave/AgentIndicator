import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../domain/agentStatus";
import { isStatusMessage } from "../domain/statusProtocol";

export type StreamConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

type UseStatusStreamOptions = {
  url: string;
  onEvent: (event: AgentEvent) => void;
};

export function useStatusStream({
  url,
  onEvent,
}: UseStatusStreamOptions) {
  const [connectionState, setConnectionState] =
    useState<StreamConnectionState>("connecting");
  const [lastMessageAt, setLastMessageAt] = useState<number | undefined>();
  const [lastError, setLastError] = useState<string | undefined>();
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;

    function connect() {
      setConnectionState(
        reconnectAttempt === 0 ? "connecting" : "reconnecting",
      );

      try {
        socket = new WebSocket(url);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Invalid URL");
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        setConnectionState("connected");
        setLastError(undefined);
      });

      socket.addEventListener("message", (message) => {
        try {
          const parsed = JSON.parse(String(message.data));

          if (!isStatusMessage(parsed)) {
            setLastError("Ignored invalid status message");
            return;
          }

          setLastMessageAt(Date.now());

          if (parsed.kind === "agent.event") {
            onEventRef.current(parsed.event);
          }
        } catch (error) {
          setLastError(
            error instanceof Error ? error.message : "Failed to parse message",
          );
        }
      });

      socket.addEventListener("error", () => {
        setConnectionState("error");
        setLastError("WebSocket connection failed");
      });

      socket.addEventListener("close", () => {
        if (stopped) {
          return;
        }

        setConnectionState("disconnected");
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (stopped) {
        return;
      }

      const delay = Math.min(5000, 800 + reconnectAttempt * 700);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close(1000, "client closed");
    };
  }, [url]);

  return {
    connectionState,
    lastError,
    lastMessageAt,
  };
}
