import type { AgentEventInput } from "../../../src/domain/statusProtocol";

export type CodexNotification = {
  method: string;
  params?: unknown;
};

export type CodexAgentEventInput = Omit<AgentEventInput, "id" | "origin">;

export type CodexApprovalPolicy = "never" | "on-request" | "untrusted";

export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type CodexAppServerLaunchConfig = {
  command: string;
  args: string[];
  cwd: string;
};

export type JsonRpcClientConfig = {
  requestTimeoutMs: number;
};

export type CodexTurnConfig = {
  cwd: string;
  model?: string;
  effort?: string;
  prompt?: string;
  threadId?: string;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  waitForClient: boolean;
};

export type CodexEventConfig = {
  messageDeltaThrottleMs: number;
};

export type CodexSourceConfig = {
  launch: CodexAppServerLaunchConfig;
  client: JsonRpcClientConfig;
  turn: CodexTurnConfig;
  events: CodexEventConfig;
};

export type CodexThreadStartResult = {
  threadId: string;
};

export type CodexLauncher = Pick<CodexAppServerLaunchConfig, "command"> & {
  argsPrefix: string[];
};
