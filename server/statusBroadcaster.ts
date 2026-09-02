import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type {
  BridgeHelloMessage,
  StatusMessage,
} from "../src/domain/statusProtocol";

export type StatusBroadcasterConfig = {
  host: string;
  port: number;
  statusPath: string;
  bridgeSource: string;
  sourceIntervalMs?: number;
};

export type StatusBroadcaster = {
  broadcast: (message: StatusMessage) => void;
  close: (onClosed?: () => void) => void;
  getClientCount: () => number;
  listen: () => void;
};

export function createStatusBroadcaster(
  config: StatusBroadcasterConfig,
): StatusBroadcaster {
  const clients = new Set<WebSocket>();
  const server = createHealthServer(config, clients);
  const wss = new WebSocketServer({ server, path: config.statusPath });

  wss.on("connection", (client) => {
    clients.add(client);
    send(client, createHelloMessage(config));

    client.on("close", () => {
      clients.delete(client);
    });
  });

  return {
    broadcast(message) {
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
    listen() {
      server.listen(config.port, config.host, () => {
        console.log(
          `[bridge] status stream ws://${config.host}:${config.port}${config.statusPath}`,
        );
        console.log(
          `[bridge] health check http://${config.host}:${config.port}/health`,
        );
      });
    },
  };
}

function createHealthServer(
  config: StatusBroadcasterConfig,
  clients: Set<WebSocket>,
): Server {
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          service: "agent-indicator-bridge",
          source: config.bridgeSource,
          clients: clients.size,
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
}

function createHelloMessage(
  config: StatusBroadcasterConfig,
): BridgeHelloMessage {
  return {
    kind: "bridge.hello",
    source: config.bridgeSource,
    version: 1,
    at: Date.now(),
    intervalMs: config.sourceIntervalMs,
  };
}

function send(client: WebSocket, message: StatusMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}
