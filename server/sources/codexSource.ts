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
  let run: { stop: () => void } | undefined;

  return {
    name: "codex-app-server",
    startPublishing(bridgeRuntime: StatusSourceBridgeRuntime) {
      if (run) {
        return;
      }

      let active = true;
      const codexEvents = createCodexEventPublisher({
        config: config.events,
        sendStatusMessage: bridgeRuntime.sendStatusMessage,
      });
      const stop = () => {
        active = false;
        client.stop();
      };
      const fail = (detail: string) => {
        if (!active) return;
        // A startup timeout doesn't prove the model failed. Stop this source
        // explicitly, then report its failure once. No late events may revive it.
        stop();
        codexEvents.publishAgentEvent({ type: "turn.failed", label: "Error", detail: `Codex source stopped: ${detail}` });
        console.error("[codex-source]", detail);
      };
      const client = new CodexAppServerClient({
        launch: config.launch,
        client: config.client,
        onNotification(notification) {
          if (!active) return;
          codexEvents.publishNotificationFromCodex(notification);
        },
        onServerRequest(request) {
          if (!active) throw new Error("Codex source stopped");
          codexEvents.publishServerRequestFromCodex(request);
          return resolveServerRequest(request);
        },
        onExit(exitDescription) {
          fail(`codex app-server exited: ${exitDescription}`);
        },
      });

      run = { stop };
      void startWhenReady(bridgeRuntime, client, config, () => active).catch((error: unknown) => {
        fail(getErrorMessage(error, "Failed to start codex app-server"));
      });
    },
    stop() {
      run?.stop();
      run = undefined;
    },
  };
}

async function startWhenReady(
  bridgeRuntime: StatusSourceBridgeRuntime,
  client: CodexAppServerClient,
  config: CodexSourceConfig,
  isActive: () => boolean,
) {
  if (config.turn.prompt?.trim() && config.turn.waitForClient) {
    console.log(
      "[codex-source] waiting for a WebSocket client before starting Codex turn",
    );
    await bridgeRuntime.waitForClient();
  }

  if (isActive()) await startCodexSession(client, config.turn);
}
