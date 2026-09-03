import { CodexAppServerProcess } from "./appServerProcess";
import {
  isJsonRpcRequestOrNotification,
  isJsonRpcResponse,
  isJsonRpcServerRequest,
  parseJsonRpcMessage,
  type JsonRpcRequestOrNotification,
  type JsonRpcResponse,
  type JsonRpcServerRequest,
} from "./jsonRpc";
import { PendingJsonRpcRequests } from "./pendingRequests";
import type {
  CodexAppServerLaunchConfig,
  CodexNotification,
  JsonRpcClientConfig,
} from "./types";
import { getErrorMessage } from "./utils";

type CodexAppServerClientOptions = {
  launch: CodexAppServerLaunchConfig;
  client: JsonRpcClientConfig;
  onNotification: (notification: CodexNotification) => void;
  onServerRequest: (
    request: JsonRpcServerRequest,
  ) => unknown | Promise<unknown>;
  onExit: (description: string) => void;
};

export class CodexAppServerClient {
  private readonly clientConfig: JsonRpcClientConfig;
  private readonly onNotification: (notification: CodexNotification) => void;
  private readonly onServerRequest: (
    request: JsonRpcServerRequest,
  ) => unknown | Promise<unknown>;
  private readonly onExit: (description: string) => void;
  private readonly appServerProcess: CodexAppServerProcess;
  private nextRequestId = 1;
  private readonly pendingRequests = new PendingJsonRpcRequests();

  constructor(options: CodexAppServerClientOptions) {
    this.clientConfig = options.client;
    this.onNotification = options.onNotification;
    this.onServerRequest = options.onServerRequest;
    this.onExit = options.onExit;
    this.appServerProcess = new CodexAppServerProcess(options.launch, {
      onLine: (line) => {
        this.handleLine(line);
      },
      onStderrLine(line) {
        console.error(`[codex app-server] ${line}`);
      },
      onExit: (error, description) => {
        this.pendingRequests.rejectAll(error);
        this.onExit(description);
      },
    });
  }

  start() {
    this.appServerProcess.start();
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const message =
      params === undefined ? { method, id } : { method, id, params };

    return this.pendingRequests.request({
      id,
      method,
      timeoutMs: this.clientConfig.requestTimeoutMs,
      send: () => {
        this.send(message);
      },
    });
  }

  notify(method: string, params?: unknown) {
    const message = params === undefined ? { method } : { method, params };
    this.send(message);
  }

  stop() {
    this.pendingRequests.rejectAll(
      new Error("codex app-server client stopped"),
    );
    this.appServerProcess.stop();
  }

  private handleLine(line: string) {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    const message = parseJsonRpcMessage(trimmed);

    if (message === undefined) {
      console.warn(`[codex-source] ignored non-JSON app-server line: ${trimmed}`);
      return;
    }

    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }

    if (isJsonRpcServerRequest(message)) {
      void this.handleServerRequest(message);
      return;
    }

    if (isJsonRpcRequestOrNotification(message)) {
      this.onNotification(message);
      return;
    }

    console.warn(`[codex-source] ignored JSON app-server line: ${trimmed}`);
  }

  private handleResponse(response: JsonRpcResponse) {
    this.pendingRequests.resolveResponse(response);
  }

  private async handleServerRequest(request: JsonRpcServerRequest) {
    let response: unknown;

    try {
      response = {
        id: request.id,
        result: await this.onServerRequest(request),
      };
    } catch (error) {
      response = {
        id: request.id,
        error: {
          code: -32601,
          message: getErrorMessage(error, "Unsupported server request"),
        },
      };
    }

    try {
      this.send(response);
    } catch (error) {
      console.warn(
        `[codex-source] failed to send server request response: ${getErrorMessage(
          error,
          "unknown error",
        )}`,
      );
    }
  }

  private send(message: unknown) {
    const serialized = JSON.stringify(message);

    if (serialized === undefined) {
      throw new Error("cannot send undefined JSON-RPC message");
    }

    this.appServerProcess.writeLine(serialized);
  }
}
