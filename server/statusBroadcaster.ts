import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  AGENT_EVENT_KIND,
  createBridgeHelloMessage,
  type AgentEventMessage,
  type StatusMessage,
} from "../src/domain/statusProtocol";

export type BridgeServerConfig = {
  host: string;
  port: number;
  statusPath: string;
  bridgeSource: string;
  sourceIntervalMs?: number;
};

export type BridgeServer = {
  broadcast: (message: StatusMessage) => void;
  close: (onClosed?: () => void) => void;
  getClientCount: () => number;
  listen: (onListening?: () => void) => void;
  waitForClient: () => Promise<void>;
};

export function createBridgeServer(config: BridgeServerConfig): BridgeServer {
  const clients = new Set<WebSocket>();
  const clientWaiters = new Set<() => void>();
  let latestAgentEventMessage: AgentEventMessage | undefined;
  const server = createHealthServer(config, clients, () => latestAgentEventMessage);
  const wss = new WebSocketServer({ server, path: config.statusPath });

  wss.on("connection", (client) => {
    clients.add(client);
    resolveClientWaiters(clientWaiters);
    send(
      client,
      createBridgeHelloMessage({
        source: config.bridgeSource,
        intervalMs: config.sourceIntervalMs,
      }),
    );
    if (latestAgentEventMessage) {
      send(client, latestAgentEventMessage);
    }

    client.on("close", () => {
      clients.delete(client);
    });
  });

  return {
    broadcast(message) {
      if (message.kind === AGENT_EVENT_KIND) {
        latestAgentEventMessage = message;
      }

      const encoded = JSON.stringify(message);

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(encoded);
        }
      }
    },
    close(onClosed) {
      for (const client of clients) {
        client.close(1001, "bridge shutting down");
      }

      wss.close(() => {
        server.close(() => onClosed?.());
      });
    },
    getClientCount() {
      return clients.size;
    },
    waitForClient() {
      if (clients.size > 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        clientWaiters.add(resolve);
      });
    },
    listen(onListening) {
      server.listen(config.port, config.host, () => {
        console.log(
          `[bridge] status stream ws://${config.host}:${config.port}${config.statusPath}`,
        );
        console.log(
          `[bridge] health check http://${config.host}:${config.port}/health`,
        );
        onListening?.();
      });
    },
  };
}

function createHealthServer(
  config: BridgeServerConfig,
  clients: Set<WebSocket>,
  getLatestAgentEventMessage: () => AgentEventMessage | undefined,
): Server {
  return createServer((request, response) => {
    if (request.url === "/health") {
      const latestAgentEventMessage = getLatestAgentEventMessage();

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          service: "agent-indicator-bridge",
          source: config.bridgeSource,
          clients: clients.size,
          latestAgentEvent: latestAgentEventMessage?.event,
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
}

function send(client: WebSocket, message: StatusMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function resolveClientWaiters(clientWaiters: Set<() => void>) {
  for (const resolve of clientWaiters) {
    resolve();
  }

  clientWaiters.clear();
}
