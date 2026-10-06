import { WebSocket } from "ws";
import { mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { bridgeSettings } from "./indicator.mjs";

const seconds = Number(process.argv[2] ?? 60);
const { port, probeHost } = bridgeSettings();
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
  throw new Error("Usage: npm run events:capture -- <seconds 1–3600>");
}
const directory = fileURLToPath(new URL("../.tmp/events/", import.meta.url));
mkdirSync(directory, { recursive: true });
const outputPath = join(directory, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
const host = probeHost.includes(":") ? `[${probeHost}]` : probeHost;
const socket = new WebSocket(`ws://${host}:${port}/status`, { maxPayload: 65536 });
let recordCount = 0;
let finished = false;
function finish(reason) {
  if (finished) {
    return;
  }
  finished = true;
  clearTimeout(timer);
  socket.terminate();
  appendFileSync(outputPath, JSON.stringify({ summary: true, reason, count: recordCount }) + "\n");
  console.log(`[events] ${recordCount} records: ${outputPath}`);
}
const timer = setTimeout(() => finish("duration"), seconds * 1000);
socket.on("message", (data) => {
  try {
    const message = JSON.parse(data.toString());
    let publicMessage = null;
    if (message.kind === "bridge.hello") {
      publicMessage = { kind: message.kind, version: message.version, source: message.source };
    } else if (message.kind === "agent.event") {
      publicMessage = {
        kind: message.kind,
        type: message.event?.type,
        origin: message.event?.origin,
        at: message.event?.at,
      };
    }
    if (publicMessage) {
      appendFileSync(
        outputPath,
        JSON.stringify({ receivedAt: Date.now(), ...publicMessage }) + "\n",
      );
      recordCount++;
    }
  } catch {
    /* Never dump raw messages or private details. */
  }
});
socket.on("error", () => {
  process.exitCode = 1;
  finish("connection-error");
});
socket.on("close", () => finish("closed"));
process.on("SIGINT", () => finish("interrupted"));
