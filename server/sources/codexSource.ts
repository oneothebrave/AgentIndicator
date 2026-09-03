import { CodexAppServerClient } from "./codex/client";
import { readCodexSourceConfigFromEnv } from "./codex/config";
import {
  publishAgentEvent,
  publishNotificationFromCodex,
} from "./codex/events";
import { resolveServerRequest } from "./codex/serverRequests";
import { startCodexSession } from "./codex/session";
import type { CodexSourceConfig } from "./codex/types";
import { getErrorMessage } from "./codex/utils";
import type {
  PublishStatusMessage,
  StatusSource,
  StatusSourceBridgeRuntime,
} from "./statusSource";

export type { CodexNotification, CodexSourceConfig } from "./codex/types";
export { mapCodexNotificationToAgentEvent } from "./codex/events";

export function createCodexSource(
  config: CodexSourceConfig = readCodexSourceConfigFromEnv(),
): StatusSource {
  let client: CodexAppServerClient | undefined;
  let stopping = false;

  return {
    name: "codex-app-server",
    startPublishing(
      publish: PublishStatusMessage,
      _bridgeRuntime: StatusSourceBridgeRuntime,
    ) {
      if (client) {
        return;
      }

      stopping = false;
      client = new CodexAppServerClient({
        launch: config.launch,
        client: config.client,
        onNotification(notification) {
          publishNotificationFromCodex(publish, notification);
        },
        onServerRequest(request) {
          publishNotificationFromCodex(publish, request);
          return resolveServerRequest(request);
        },
        onExit(exitDescription) {
          if (stopping) {
            return;
          }

          publishAgentEvent(publish, {
            type: "turn.failed",
            label: "Error",
            detail: `codex app-server exited: ${exitDescription}`,
          });
        },
      });

      void startCodexSession(client, config.turn, publish).catch((error: unknown) => {
        publishAgentEvent(publish, {
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
