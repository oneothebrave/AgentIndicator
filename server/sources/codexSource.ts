import type {
  PublishStatusMessage,
  StatusSource,
  StatusSourceBridgeRuntime,
} from "./statusSource";

export function createCodexSource(): StatusSource {
  return {
    name: "codex-bridge",
    startPublishing(
      _publish: PublishStatusMessage,
      _bridgeRuntime: StatusSourceBridgeRuntime,
    ) {
      throw new Error("codexSource is not implemented yet");
    },
    stop() {},
  };
}
