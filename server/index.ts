import { createStatusBroadcaster } from "./statusBroadcaster";
import type { StatusSource } from "./sources/statusSource";

export type BridgeRuntimeConfig = {
  host: string;
  port: number;
  statusPath: string;
  sourceIntervalMs?: number;
};

export function runBridge(source: StatusSource, config: BridgeRuntimeConfig) {
  const broadcaster = createStatusBroadcaster({
    ...config,
    bridgeSource: source.name,
  });

  source.start(broadcaster.broadcast, {
    getClientCount: broadcaster.getClientCount,
  });
  broadcaster.listen();

  function shutdown() {
    source.stop();
    broadcaster.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    stop() {
      source.stop();
      broadcaster.close();
    },
  };
}

