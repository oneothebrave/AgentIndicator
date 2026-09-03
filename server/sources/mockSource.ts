import { randomUUID } from "node:crypto";
import { demoTimeline } from "../../src/data/demoTimeline";
import {
  agentEventMessage,
  normalizeAgentEvent,
} from "../../src/domain/statusProtocol";
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
        const event = normalizeAgentEvent({
          id: randomUUID(),
          type: template.type,
          origin: "mock",
          label: template.label,
          detail: template.detail,
        });

        sequence += 1;
        publish(agentEventMessage(event));
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
