import type {
  EmitStatusMessage,
  StatusSource,
  StatusSourceContext,
} from "./statusSource";

export function createCodexSource(): StatusSource {
  return {
    name: "codex-bridge",
    start(_emit: EmitStatusMessage, _context: StatusSourceContext) {
      throw new Error("codexSource is not implemented yet");
    },
    stop() {},
  };
}
