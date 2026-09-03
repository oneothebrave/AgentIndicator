import { CodexAppServerClient } from "./codex/client";
import { readCodexSourceConfigFromEnv } from "./codex/config";
import { createCodexEventPublisher } from "./codex/events";
import { resolveServerRequest } from "./codex/serverRequests";
import { startCodexSession } from "./codex/session";
import type { CodexSourceConfig } from "./codex/types";
import { getErrorMessage } from "./codex/utils";
import type {
  StatusSource,
  StatusSourceBridgeRuntime,
} from "./statusSource";

export type { CodexNotification, CodexSourceConfig } from "./codex/types";
export {
  mapCodexNotificationToAgentEvent,
  mapCodexServerRequestToAgentEvent,
} from "./codex/events";

export function createCodexSource(
  config: CodexSourceConfig = readCodexSourceConfigFromEnv(),
): StatusSource {
  let client: CodexAppServerClient | undefined;
  let stopping = false;

  return {
    name: "codex-app-server",
    startPublishing(bridgeRuntime: StatusSourceBridgeRuntime) {
      if (client) {
        return;
      }

      stopping = false;
      const codexEvents = createCodexEventPublisher({
        config: config.events,
        sendStatusMessage: bridgeRuntime.sendStatusMessage,
      });
      client = new CodexAppServerClient({
        launch: config.launch,
        client: config.client,
        onNotification(notification) {
          codexEvents.publishNotificationFromCodex(notification);
        },
        onServerRequest(request) {
          codexEvents.publishServerRequestFromCodex(request);
          return resolveServerRequest(request);
        },
        onExit(exitDescription) {
          if (stopping) {
            return;
          }

          codexEvents.publishAgentEvent({
            type: "turn.failed",
            label: "Error",
            detail: `codex app-server exited: ${exitDescription}`,
          });
        },
      });

      void startWhenReady(bridgeRuntime, client, config).catch((error: unknown) => {
        codexEvents.publishAgentEvent({
          type: "turn.failed",
          label: "Error",
          detail: getErrorMessage(error, "Failed to start codex app-server"),
        });
        console.error("[codex-source]", error);
      });
    },
    stop() {
      stopping = true;
      client?.stop();
      client = undefined;
    },
  };
}

async function startWhenReady(
  bridgeRuntime: StatusSourceBridgeRuntime,
  client: CodexAppServerClient,
  config: CodexSourceConfig,
) {
  if (config.turn.prompt?.trim() && config.turn.waitForClient) {
    console.log(
      "[codex-source] waiting for a WebSocket client before starting Codex turn",
    );
    await bridgeRuntime.waitForClient();
  }

  await startCodexSession(client, config.turn);
}
