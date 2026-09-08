import { WebSocket } from "ws";
import { mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const seconds = Number(process.argv[2] ?? 60);
const port = Number(process.env.AGENT_INDICATOR_PORT ?? 8787);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600 || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Usage: npm run events:capture -- <seconds 1–3600>");
const directory = fileURLToPath(new URL("../.tmp/events/", import.meta.url));
mkdirSync(directory, { recursive: true });
const path = join(directory, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
const ws = new WebSocket(`ws://127.0.0.1:${port}/status`, { maxPayload: 65536 });
let count = 0, finished = false;
function finish(reason) {
  if (finished) return;
  finished = true; clearTimeout(timer); ws.terminate();
  appendFileSync(path, JSON.stringify({ summary: true, reason, count }) + "\n");
  console.log(`[events] ${count} records: ${path}`);
}
const timer = setTimeout(() => finish("duration"), seconds * 1000);
ws.on("message", data => {
  try {
    const m = JSON.parse(data.toString());
    const clean = m.kind === "bridge.hello" ? { kind: m.kind, version: m.version, source: m.source }
      : m.kind === "agent.event" ? { kind: m.kind, type: m.event?.type, origin: m.event?.origin, at: m.event?.at } : null;
    if (clean) { appendFileSync(path, JSON.stringify({ receivedAt: Date.now(), ...clean }) + "\n"); count++; }
  } catch { /* Never dump raw messages or private details. */ }
});
ws.on("error", () => { process.exitCode = 1; finish("connection-error"); });
ws.on("close", () => finish("closed"));
process.on("SIGINT", () => finish("interrupted"));
