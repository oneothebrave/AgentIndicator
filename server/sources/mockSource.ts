import { randomUUID } from "node:crypto";
import { demoTimeline } from "../../src/data/demoTimeline";
import type { AgentEvent } from "../../src/domain/agentStatus";
import type {
  PublishStatusMessage,
  StatusSource,
  StatusSourceBridgeRuntime,
} from "./statusSource";

export type MockSourceOptions = {
  intervalMs: number;
  skipWhenNoClients?: boolean;
};

export function createMockSource({
  intervalMs,
  skipWhenNoClients = true,
}: MockSourceOptions): StatusSource {
  let sequence = 0;
  let ticker: NodeJS.Timeout | undefined;

  return {
    name: "mock-bridge",
    startPublishing(
      publish: PublishStatusMessage,
      bridgeRuntime: StatusSourceBridgeRuntime,
    ) {
      if (ticker) {
        return;
      }

      ticker = setInterval(() => {
        if (skipWhenNoClients && bridgeRuntime.getClientCount() === 0) {
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
        publish({ kind: "agent.event", event });
      }, intervalMs);
    },
    stop() {
      if (!ticker) {
        return;
      }

      clearInterval(ticker);
      ticker = undefined;
    },
  };
}
