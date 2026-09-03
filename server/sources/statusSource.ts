import type { StatusMessage } from "../../src/domain/statusProtocol";

export type SendStatusMessage = (message: StatusMessage) => void;

export type StatusSourceBridgeRuntime = {
  sendStatusMessage: SendStatusMessage;
  getClientCount: () => number;
  waitForClient: () => Promise<void>;
};

export type StatusSource = {
  name: string;
  startPublishing: (bridgeRuntime: StatusSourceBridgeRuntime) => void;
  stop: () => void;
};
