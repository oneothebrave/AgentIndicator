export type ProcessIdentity = { pid: number; started_at: string };
export type ProcessObservation = {
  poll(): "alive" | "exited" | "unknown";
  close(): void;
};
export function isProcessIdentity(value: unknown): value is ProcessIdentity;
export function isInteractiveCodex(image: string, args: string[]): boolean;
export function observeWindowsProcess(
  identity: ProcessIdentity,
  requireCli?: boolean,
): ProcessObservation;
export function findCliProcess(parentPid?: number): ProcessIdentity | undefined;
export function identifyHookProcess(
  parentPid?: number,
): { kind: "cli"; identity: ProcessIdentity } | { kind: "other" | "unknown" };
export function windowsProcessIdentity(pid: number): ProcessIdentity;
