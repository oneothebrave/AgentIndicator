import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { watchTerminalFailures } from "./hooks/terminalFailure";
import { createHookEventPublisher, isHookEvent } from "./hooks/events";
import { createAgentEventMessage, normalizeAgentEvent } from "../../src/domain/statusProtocol";
import type { StatusSource } from "./statusSource";

export function createCodexHooksSource(port = Number(process.env.AGENT_INDICATOR_HOOK_PORT ?? 8788)): StatusSource {
  let server: ReturnType<typeof createServer> | undefined;
  let stopFailureWatcher: (() => void) | undefined;
  return {
    name: "codex-cli-hooks",
    startPublishing(runtime) {
      const publisher = createHookEventPublisher(runtime.sendStatusMessage, process.env.AGENT_INDICATOR_HOOK_SESSION_ID);
      stopFailureWatcher = watchTerminalFailures(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions"), publisher.status, publisher.failTurn);
      server = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        // No browser ingestion, no LAN ingress: the listener is loopback-only.
        if (req.headers.origin) { res.writeHead(403).end("{}"); return; }
        if (req.method === "GET" && req.url === "/health") {
          res.end(JSON.stringify({ ok: true, source: "codex-cli-hooks", ...publisher.status() })); return;
        }
        if (req.method !== "POST" || !["/hook", "/session/reset"].includes(req.url ?? "")) { res.writeHead(404).end("{}"); return; }
        if (req.headers["content-type"] !== "application/json") { res.writeHead(415).end("{}"); return; }
        let body = "";
        let size = 0;
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > 4096) { res.writeHead(413).end("{}"); req.destroy(); return; }
          body += chunk;
        });
        req.on("error", () => {});
        req.on("end", () => {
          if (res.writableEnded) return;
          try {
            if (req.url === "/session/reset") {
              const value = JSON.parse(body);
              if (!value || !(value.expectedSessionId === null || typeof value.expectedSessionId === "string")) { res.writeHead(400).end("{}"); return; }
              const reset = publisher.reset(value.expectedSessionId);
              res.writeHead(reset ? 200 : 409).end(JSON.stringify({ reset }));
              return;
            }
            const event: unknown = JSON.parse(body);
            if (!isHookEvent(event)) { res.writeHead(400).end("{}"); return; }
            res.end(JSON.stringify({ accepted: publisher.receive(event) }));
          } catch { res.writeHead(400).end("{}"); }
        });
      });
      server.requestTimeout = 2000;
      server.headersTimeout = 2000;
      server.on("error", (error) => {
        console.error("[codex-hooks] listener failed:", error.message);
        process.exitCode = 1;
        // Do not leave a healthy-looking hardware stream with a dead source.
        process.emit("SIGTERM");
      });
      server.listen(port, "127.0.0.1", () => {
        console.log(`[codex-hooks] local receiver http://127.0.0.1:${port}/hook`);
        runtime.sendStatusMessage(createAgentEventMessage(normalizeAgentEvent({ id: "hooks-ready", origin: "codex", type: "thread.idle", detail: "Waiting for a CLI prompt" })));
      });
    },
    stop() { stopFailureWatcher?.(); server?.close(); server?.closeAllConnections(); },
  };
}
