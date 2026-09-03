import type { JsonRpcId, JsonRpcResponse } from "./jsonRpc";
import { getErrorMessage } from "./utils";

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class PendingJsonRpcRequests {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();

  request(options: {
    id: JsonRpcId;
    method: string;
    timeoutMs: number;
    send: () => void;
  }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(options.id);
        reject(
          new Error(
            `Timed out waiting for codex app-server response to ${options.method}`,
          ),
        );
      }, options.timeoutMs);

      this.pending.set(options.id, {
        method: options.method,
        resolve,
        reject,
        timeout,
      });

      try {
        options.send();
      } catch (error) {
        this.reject(options.id, error);
      }
    });
  }

  resolveResponse(response: JsonRpcResponse) {
    const pending = this.pending.get(response.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(
          response.error.message ??
            `codex app-server ${pending.method} request failed`,
        ),
      );
      return;
    }

    pending.resolve(response.result);
  }

  rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pending.clear();
  }

  private reject(id: JsonRpcId, error: unknown) {
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.reject(
      error instanceof Error
        ? error
        : new Error(getErrorMessage(error, "JSON-RPC request failed")),
    );
  }
}
