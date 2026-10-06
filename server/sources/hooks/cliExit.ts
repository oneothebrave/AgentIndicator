import {
  observeWindowsProcess,
  type ProcessIdentity,
  type ProcessObservation,
} from "../../../shared/windows-process.mjs";
import type { createHookEventPublisher, HookEvent } from "./events";

type Publisher = ReturnType<typeof createHookEventPublisher>;
type ObserverOptions = {
  supported?: boolean;
  intervalMs?: number;
  openProcess?: (identity: ProcessIdentity) => ProcessObservation;
};
type ObserverPhase = "unbound" | "unidentified" | "unsupported" | "watching" | "degraded";
type CliOwner = {
  session: string;
  identity: ProcessIdentity;
  process: ProcessObservation;
};

function sameProcess(left: ProcessIdentity, right: ProcessIdentity) {
  return left.pid === right.pid && left.started_at === right.started_at;
}

// Silence is never an exit signal. Only a signaled handle for the bound CLI can
// release its session; an unreadable or unidentified process stays bound.
export function createCliExitWatcher(publisher: Publisher, options: ObserverOptions = {}) {
  const supported = options.supported ?? process.platform === "win32";
  const openProcess = options.openProcess ?? ((identity) => observeWindowsProcess(identity, true));
  let owner: CliOwner | undefined;
  let phase: ObserverPhase = supported ? "unbound" : "unsupported";
  let error: string | undefined;
  let stopped = false;

  function unobservedPhase(): ObserverPhase {
    if (!supported) {
      return "unsupported";
    }
    return publisher.status().sessionId ? "unidentified" : "unbound";
  }

  function clear() {
    owner?.process.close();
    owner = undefined;
    error = undefined;
    phase = unobservedPhase();
  }

  function check() {
    if (stopped || !owner) {
      return;
    }
    const binding = publisher.status();
    if (binding.sessionId !== owner.session) {
      clear();
      return;
    }
    let state: ReturnType<ProcessObservation["poll"]>;
    try {
      state = owner.process.poll();
    } catch {
      state = "unknown";
    }
    if (state === "exited") {
      // Compare the current turn, including a newer turn of the same process.
      publisher.reset(binding.sessionId, binding.turnId, "CLI process exited; session released");
      clear();
    } else {
      phase = state === "alive" ? "watching" : "degraded";
      error = state === "alive" ? undefined : "process-wait-unavailable";
    }
  }

  function observe(event: HookEvent) {
    const binding = publisher.status();
    if (event.hook_event_name === "SessionEnd" || !binding.sessionId) {
      clear();
      return;
    }
    if (owner && owner.session !== binding.sessionId) {
      clear();
    }
    if (!supported || event.agent_id || !event.cli_process || owner) {
      if (!owner) {
        phase = supported ? "unidentified" : "unsupported";
      }
      return;
    }
    try {
      owner = {
        session: binding.sessionId,
        identity: event.cli_process,
        process: openProcess(event.cli_process),
      };
      check();
    } catch (failure) {
      phase = "degraded";
      // Adapter errors contain fixed codes, never commands or paths.
      const message = failure instanceof Error ? failure.message : "process-open-unavailable";
      error = /^[a-z-]+$/.test(message) ? message : "process-open-unavailable";
    }
  }

  const timer = setInterval(check, options.intervalMs ?? 500);
  timer.unref();
  return {
    check,
    clear,
    receive(event: HookEvent) {
      if (stopped) {
        return false;
      }
      check();
      // Late SessionEnd/tool hooks from an older process cannot clear a CLI
      // that has resumed the same logical session under a different identity.
      if (
        owner &&
        event.session_id === owner.session &&
        ((event.cli_process && !sameProcess(owner.identity, event.cli_process)) ||
          (event.hook_event_name === "SessionEnd" && !event.cli_process))
      ) {
        return false;
      }
      const accepted = publisher.receive(event);
      if (accepted) {
        observe(event);
      }
      return accepted;
    },
    status: () => ({ phase, error }),
    stop() {
      stopped = true;
      clearInterval(timer);
      clear();
    },
  };
}
