// A notification-only hook. Never emit approval decisions or model context.
import { request } from "node:http";
import { randomUUID } from "node:crypto";

const deadline = setTimeout(() => finish(), 800);
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  process.stdout.write("{}\n", () => process.exit(0));
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
let input = "";
let size = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  size += Buffer.byteLength(chunk);
  if (size > 1024 * 1024) { finish(); return; }
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const raw = JSON.parse(input);
    const event = { id: randomUUID() };
    for (const key of ["hook_event_name", "session_id", "turn_id", "tool_name", "tool_use_id"]) {
      if (typeof raw[key] === "string" && raw[key].length <= 256) event[key] = raw[key];
    }
    const body = JSON.stringify(event);
    const req = request({ hostname: "127.0.0.1", port: Number(process.env.AGENT_INDICATOR_HOOK_PORT ?? 8788), path: "/hook", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 300 }, res => {
      res.resume();
      res.on("end", finish);
      res.on("error", finish);
    });
    req.on("error", finish);
    req.on("timeout", () => { req.destroy(); finish(); });
    req.end(body);
  } catch { finish(); }
});
