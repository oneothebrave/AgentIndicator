import {
  type BridgeServerConfig,
  createBridgeServer,
  type BridgeServer,
} from "./statusBroadcaster";
import { createCodexSource } from "./sources/codexSource";
import { createMockSource } from "./sources/mockSource";
import { createCodexHooksSource } from "./sources/codexHooksSource";
import type { StatusSource } from "./sources/statusSource";

const host = process.env.AGENT_INDICATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.AGENT_INDICATOR_PORT ?? 8787);
const statusPath = "/status";
const intervalMs = Number(process.env.AGENT_INDICATOR_INTERVAL_MS ?? 1600);
const defaultSourceName =
  process.env.npm_lifecycle_event === "bridge:cli" ? "codex-hooks" :
  process.env.npm_lifecycle_event === "bridge:codex" ? "codex" : "mock";
const sourceName = process.env.AGENT_INDICATOR_SOURCE ?? defaultSourceName;

const statusSource = createStatusSource(sourceName);

startBridge(statusSource, {
  host,
  port,
  statusPath,
  sourceIntervalMs: sourceName === "mock" ? intervalMs : undefined,
});

function createStatusSource(name: string): StatusSource {
  if (name === "codex-hooks") return createCodexHooksSource();
  if (name === "mock") {
    return createMockSource({ intervalMs });
  }

  if (name === "codex") {
    return createCodexSource();
  }

  throw new Error(`Unsupported AGENT_INDICATOR_SOURCE: ${name}`);
}

function startBridge(
  statusSource: StatusSource,
  config: Omit<BridgeServerConfig, "bridgeSource">,
) {
  const bridgeServer = createBridgeServer({
    ...config,
    bridgeSource: statusSource.name,
  });

  bridgeServer.listen(() => {
    statusSource.startPublishing({
      sendStatusMessage: bridgeServer.broadcast,
      getClientCount: bridgeServer.getClientCount,
      waitForClient: bridgeServer.waitForClient,
    });
  });

  registerShutdown(statusSource, bridgeServer);
}

function registerShutdown(statusSource: StatusSource, bridgeServer: BridgeServer) {
  function shutdown() {
    statusSource.stop();
    bridgeServer.close(() => process.exit(process.exitCode ?? 0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
