import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CodexApprovalPolicy,
  CodexLauncher,
  CodexSandboxMode,
  CodexSourceConfig,
} from "./types";

export function readCodexSourceConfigFromEnv(): CodexSourceConfig {
  const launcher = readCodexLauncher();
  const cwd = process.env.AGENT_INDICATOR_CODEX_CWD ?? process.cwd();

  return {
    launch: {
      command: launcher.command,
      args: [...launcher.argsPrefix, "app-server", "--stdio"],
      cwd,
    },
    client: {
      requestTimeoutMs: Number(
        process.env.AGENT_INDICATOR_CODEX_REQUEST_TIMEOUT_MS ?? 30_000,
      ),
    },
    turn: {
      cwd,
      model: process.env.AGENT_INDICATOR_CODEX_MODEL,
      effort: process.env.AGENT_INDICATOR_CODEX_EFFORT,
      prompt: process.env.AGENT_INDICATOR_CODEX_PROMPT,
      threadId: process.env.AGENT_INDICATOR_CODEX_THREAD_ID,
      approvalPolicy: readApprovalPolicy(),
      sandbox: readSandboxMode(),
      waitForClient: readBooleanEnv(
        "AGENT_INDICATOR_CODEX_WAIT_FOR_CLIENT",
        true,
      ),
    },
    events: {
      messageDeltaThrottleMs: Number(
        process.env.AGENT_INDICATOR_CODEX_MESSAGE_DELTA_THROTTLE_MS ?? 300,
      ),
    },
  };
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

function readCodexLauncher(): CodexLauncher {
  const commandOverride = process.env.AGENT_INDICATOR_CODEX_COMMAND;

  if (commandOverride) {
    return {
      command: commandOverride,
      argsPrefix: [],
    };
  }

  const appData = process.env.APPDATA;
  const npmCodexScript = appData
    ? join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
    : undefined;

  if (npmCodexScript && existsSync(npmCodexScript)) {
    return {
      command: process.execPath,
      argsPrefix: [npmCodexScript],
    };
  }

  return {
    command: "codex",
    argsPrefix: [],
  };
}

function readApprovalPolicy(): CodexApprovalPolicy {
  const value = process.env.AGENT_INDICATOR_CODEX_APPROVAL_POLICY;

  if (value === "on-request" || value === "untrusted" || value === "never") {
    return value;
  }

  return "never";
}

function readSandboxMode(): CodexSandboxMode {
  const value = process.env.AGENT_INDICATOR_CODEX_SANDBOX;

  if (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  ) {
    return value;
  }

  return "read-only";
}
