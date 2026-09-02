import type { StatusMessage } from "../../src/domain/statusProtocol";

export type EmitStatusMessage = (message: StatusMessage) => void;

export type StatusSourceContext = {
  getClientCount: () => number;
};

export type StatusSource = {
  name: string;
  start: (emit: EmitStatusMessage, context: StatusSourceContext) => void;
  stop: () => void;
};
