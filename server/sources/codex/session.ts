import type { PublishStatusMessage } from "../statusSource";
import type { CodexAppServerClient } from "./client";
import { publishAgentEvent } from "./events";
import type { CodexThreadStartResult, CodexTurnConfig } from "./types";
import { getNestedString } from "./utils";

export async function startCodexSession(
  client: CodexAppServerClient,
  turnConfig: CodexTurnConfig,
  publish: PublishStatusMessage,
) {
  client.start();

  await client.request("initialize", {
    clientInfo: {
      name: "agent-indicator",
      title: "Agent Indicator Bridge",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: false,
      requestAttestation: false,
    },
  });

  client.notify("initialized");

  console.log("[codex-source] connected to codex app-server");

  const prompt = turnConfig.prompt?.trim();

  if (!prompt) {
    console.log(
      "[codex-source] no AGENT_INDICATOR_CODEX_PROMPT set; connected without starting a turn",
    );
    return;
  }

  const { threadId } = await startOrResumeThread(client, turnConfig);

  publishAgentEvent(publish, {
    type: "turn.started",
    label: "Thinking",
    detail: turnConfig.threadId
      ? `Resumed Codex thread ${threadId}`
      : `Started Codex thread ${threadId}`,
  });

  await client.request("turn/start", {
    threadId,
    input: [
      {
        type: "text",
        text: prompt,
        text_elements: [],
      },
    ],
    cwd: turnConfig.cwd,
    approvalPolicy: turnConfig.approvalPolicy,
    sandboxPolicy: toSandboxPolicy(turnConfig),
    model: turnConfig.model ?? null,
    effort: turnConfig.effort ?? null,
    turnTrigger: "agent-indicator",
  });

  console.log(`[codex-source] started Codex turn on thread ${threadId}`);
}

async function startOrResumeThread(
  client: CodexAppServerClient,
  turnConfig: CodexTurnConfig,
): Promise<CodexThreadStartResult> {
  if (turnConfig.threadId) {
    const result = await client.request("thread/resume", {
      threadId: turnConfig.threadId,
      cwd: turnConfig.cwd,
      approvalPolicy: turnConfig.approvalPolicy,
      sandbox: turnConfig.sandbox,
      model: turnConfig.model ?? null,
      excludeTurns: true,
    });

    return {
      threadId: extractThreadId(result) ?? turnConfig.threadId,
    };
  }

  const result = await client.request("thread/start", {
    cwd: turnConfig.cwd,
    approvalPolicy: turnConfig.approvalPolicy,
    sandbox: turnConfig.sandbox,
    model: turnConfig.model ?? null,
    ephemeral: true,
    threadSource: "agent-indicator",
  });

  const threadId = extractThreadId(result);

  if (!threadId) {
    throw new Error("codex app-server did not return a thread id");
  }

  return { threadId };
}

function toSandboxPolicy(turnConfig: CodexTurnConfig) {
  if (turnConfig.sandbox === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (turnConfig.sandbox === "workspace-write") {
    return {
      type: "workspaceWrite",
      writableRoots: [turnConfig.cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }

  return {
    type: "readOnly",
    networkAccess: false,
  };
}

function extractThreadId(result: unknown): string | undefined {
  return (
    getNestedString(result, ["thread", "id"]) ??
    getNestedString(result, ["threadId"])
  );
}
