import { isRecord } from "./utils";

export type JsonRpcId = string | number;

export type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type JsonRpcRequestOrNotification = {
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export function parseJsonRpcMessage(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    value.id !== undefined &&
    !("method" in value) &&
    ("result" in value || "error" in value)
  );
}

export function isJsonRpcRequestOrNotification(
  value: unknown,
): value is JsonRpcRequestOrNotification {
  return isRecord(value) && typeof value.method === "string";
}
