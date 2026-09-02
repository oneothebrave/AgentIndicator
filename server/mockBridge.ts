import { runBridge } from "./index";
import { createMockSource } from "./sources/mockSource";

const host = process.env.AGENT_INDICATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_INDICATOR_PORT ?? 8787);
const statusPath = "/status";
const intervalMs = Number(process.env.AGENT_INDICATOR_INTERVAL_MS ?? 1600);

runBridge(createMockSource({ intervalMs }), {
  host,
  port,
  statusPath,
  sourceIntervalMs: intervalMs,
});

