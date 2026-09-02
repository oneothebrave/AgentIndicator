import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { demoTimeline } from "../src/data/demoTimeline";
import type { AgentEvent } from "../src/domain/agentStatus";
import type { StatusMessage } from "../src/domain/statusProtocol";

const host = process.env.AGENT_INDICATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_INDICATOR_PORT ?? 8787);
const statusPath = "/status";
const intervalMs = Number(process.env.AGENT_INDICATOR_INTERVAL_MS ?? 1600);

const clients = new Set<WebSocket>();
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "agent-indicator-mock-bridge",
        clients: clients.size,
      }),
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: statusPath });
let sequence = 0;

wss.on("connection", (client) => {
  clients.add(client);
  send(client, {
    kind: "bridge.hello",
    source: "mock-bridge",
    version: 1,
    at: Date.now(),
    intervalMs,
  });

  client.on("close", () => {
    clients.delete(client);
  });
});

const ticker = setInterval(() => {
  if (clients.size === 0) {
    return;
  }

  const template = demoTimeline[sequence % demoTimeline.length];
  const event: AgentEvent = {
    id: randomUUID(),
    type: template.type,
    at: Date.now(),
    source: "bridge",
    label: template.label,
    detail: template.detail,
  };

  sequence += 1;
  broadcast({ kind: "agent.event", event });
}, intervalMs);

server.listen(port, host, () => {
  console.log(`[mock-bridge] status stream ws://${host}:${port}${statusPath}`);
  console.log(`[mock-bridge] health check http://${host}:${port}/health`);
});

function broadcast(message: StatusMessage) {
  const encoded = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function send(client: WebSocket, message: StatusMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function shutdown() {
  clearInterval(ticker);

  for (const client of clients) {
    client.close(1001, "bridge shutting down");
  }

  wss.close(() => {
    server.close(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
