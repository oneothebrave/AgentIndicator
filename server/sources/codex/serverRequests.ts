import type { JsonRpcServerRequest } from "./jsonRpc";

export function resolveServerRequest(request: JsonRpcServerRequest) {
  switch (request.method) {
    case "currentTime/read":
      return {
        currentTimeAt: Math.floor(Date.now() / 1000),
      };
    case "item/commandExecution/requestApproval":
      return { decision: "decline" };
    case "item/fileChange/requestApproval":
      return { decision: "decline" };
    case "item/permissions/requestApproval":
      return {
        permissions: {},
        scope: "turn",
      };
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "mcpServer/elicitation/request":
      return {
        action: "decline",
        content: null,
        _meta: null,
      };
    default:
      throw new Error(
        `Agent Indicator bridge does not implement server request: ${request.method}`,
      );
  }
}
