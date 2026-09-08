// Consumed subset of `codex app-server generate-ts`, CLI 0.153.4.
// These discriminants are checked against the installed schema by test:contract.
export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";
export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
export type TurnOutcome = { turn: { id: string; status: TurnStatus; error: { message: string } | null }; threadId: string };
