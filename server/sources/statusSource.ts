import type { StatusMessage } from "../../src/domain/statusProtocol";

export type PublishStatusMessage = (message: StatusMessage) => void;

export type StatusSourceBridgeRuntime = {
  getClientCount: () => number;
};

export type StatusSource = {
  name: string;
  startPublishing: (
    publish: PublishStatusMessage,
    bridgeRuntime: StatusSourceBridgeRuntime,
  ) => void;
  stop: () => void;
};
