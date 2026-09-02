import type { AgentEvent } from "../domain/agentStatus";

export type DemoEventTemplate = Omit<AgentEvent, "id" | "at" | "source">;

export const demoTimeline: DemoEventTemplate[] = [
  {
    type: "turn.started",
    label: "Thinking",
    detail: "New turn started",
  },
  {
    type: "reasoning.started",
    label: "Thinking",
    detail: "Making a short plan",
  },
  {
    type: "search.started",
    label: "Searching",
    detail: "Reading project context",
  },
  {
    type: "file.change",
    label: "Editing",
    detail: "Updating frontend files",
  },
  {
    type: "command.started",
    label: "Running",
    detail: "Checking the build",
  },
  {
    type: "tool.started",
    label: "Tool",
    detail: "Using a local helper",
  },
  {
    type: "approval.requested",
    label: "Waiting",
    detail: "Waiting for approval",
  },
  {
    type: "message.delta",
    label: "Speaking",
    detail: "Writing the result",
  },
  {
    type: "turn.completed",
    label: "Done",
    detail: "Turn completed",
  },
  {
    type: "inactivity.sleepy",
    label: "Sleepy",
    detail: "No recent activity",
  },
  {
    type: "inactivity.sleep",
    label: "Sleep",
    detail: "Low activity mode",
  },
];
