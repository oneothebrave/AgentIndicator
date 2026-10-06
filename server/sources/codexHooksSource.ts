import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { watchTerminalFailures } from "./hooks/terminalFailure";
import { createCliExitWatcher } from "./hooks/cliExit";
import { createHookEventPublisher, isHookEvent } from "./hooks/events";
import { createAgentEventMessage, normalizeAgentEvent } from "../../src/domain/statusProtocol";
import type { StatusSource } from "./statusSource";

const SOURCE_NAME = "codex-cli-hooks";
const MAX_BODY_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 2000;

type HookPublisher = ReturnType<typeof createHookEventPublisher>;
type FailureWatcher = ReturnType<typeof watchTerminalFailures>;
type ExitWatcher = ReturnType<typeof createCliExitWatcher>;
type SessionResetRequest = {
  expectedSessionId: string | null;
  expectedTurnId: string | null;
};

function sendJson(response: ServerResponse, status: number, value: unknown = {}) {
  response.writeHead(status).end(JSON.stringify(value));
}

function isSessionResetRequest(value: unknown): value is SessionResetRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const fields = value as Record<string, unknown>;
  return [fields.expectedSessionId, fields.expectedTurnId].every(
    (field) => field === null || typeof field === "string",
  );
}

function handlePayload(
  path: string | undefined,
  body: string,
  response: ServerResponse,
  publisher: HookPublisher,
  exitWatcher: ExitWatcher,
) {
  try {
    const payload: unknown = JSON.parse(body);

    if (path === "/session/reset") {
      if (!isSessionResetRequest(payload)) {
        sendJson(response, 400);
        return;
      }

      const reset = publisher.reset(payload.expectedSessionId, payload.expectedTurnId);
      if (reset) {
        exitWatcher.clear();
      }
      sendJson(response, reset ? 200 : 409, { reset });
      return;
    }

    if (!isHookEvent(payload)) {
      sendJson(response, 400);
      return;
    }

    sendJson(response, 200, { accepted: exitWatcher.receive(payload) });
  } catch {
    sendJson(response, 400);
  }
}

function readRequestBody(
  request: IncomingMessage,
  response: ServerResponse,
  onBody: (body: string) => void,
) {
  let body = "";
  let receivedBytes = 0;

  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    receivedBytes += Buffer.byteLength(chunk);
    if (receivedBytes > MAX_BODY_BYTES) {
      sendJson(response, 413);
      request.destroy();
      return;
    }

    body += chunk;
  });
  request.on("error", () => {
    // A disconnected or oversized request has no body left to process.
  });
  request.on("end", () => {
    if (!response.writableEnded) {
      onBody(body);
    }
  });
}

function handleHookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  publisher: HookPublisher,
  failureWatcher: FailureWatcher | undefined,
  exitWatcher: ExitWatcher,
) {
  response.setHeader("Content-Type", "application/json");

  // No browser ingestion, no LAN ingress: the listener is loopback-only.
  if (request.headers.origin) {
    sendJson(response, 403);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      source: SOURCE_NAME,
      ...publisher.status(),
      terminalObserver: failureWatcher?.status(),
      cliObserver: exitWatcher.status(),
    });
    return;
  }

  const isPostRoute =
    request.method === "POST" && (request.url === "/hook" || request.url === "/session/reset");
  if (!isPostRoute) {
    sendJson(response, 404);
    return;
  }

  if (request.headers["content-type"] !== "application/json") {
    sendJson(response, 415);
    return;
  }

  readRequestBody(request, response, (body) => {
    handlePayload(request.url, body, response, publisher, exitWatcher);
  });
}

export function createCodexHooksSource(
  port = Number(process.env.AGENT_INDICATOR_HOOK_PORT ?? 8788),
): StatusSource {
  let server: ReturnType<typeof createServer> | undefined;
  let stopFailureWatcher: FailureWatcher | undefined;
  let exitWatcher: ExitWatcher | undefined;

  return {
    name: SOURCE_NAME,
    startPublishing(runtime) {
      const publisher = createHookEventPublisher(
        runtime.sendStatusMessage,
        process.env.AGENT_INDICATOR_HOOK_SESSION_ID,
      );
      const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
      const watcher = createCliExitWatcher(publisher);
      exitWatcher = watcher;
      stopFailureWatcher = watchTerminalFailures(
        join(codexHome, "sessions"),
        publisher.status,
        publisher.failTurn,
      );

      server = createServer((request, response) => {
        handleHookRequest(request, response, publisher, stopFailureWatcher, watcher);
      });
      server.requestTimeout = REQUEST_TIMEOUT_MS;
      server.headersTimeout = REQUEST_TIMEOUT_MS;
      server.on("error", (error) => {
        console.error("[codex-hooks] listener failed:", error.message);
        process.exitCode = 1;
        // Do not leave a healthy-looking hardware stream with a dead source.
        process.emit("SIGTERM");
      });
      server.listen(port, "127.0.0.1", () => {
        console.log(`[codex-hooks] local receiver http://127.0.0.1:${port}/hook`);
        runtime.sendStatusMessage(
          createAgentEventMessage(
            normalizeAgentEvent({
              id: "hooks-ready",
              origin: "codex",
              type: "thread.idle",
              detail: "Waiting for a CLI prompt",
            }),
          ),
        );
      });
    },
    stop() {
      stopFailureWatcher?.();
      exitWatcher?.stop();
      server?.close();
      server?.closeAllConnections();
    },
  };
}
