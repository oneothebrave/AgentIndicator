import { randomUUID } from "node:crypto";
import type { AgentEventType } from "../../../src/domain/agentStatus";
import { createAgentEventMessage, normalizeAgentEvent } from "../../../src/domain/statusProtocol";
import type { SendStatusMessage } from "../statusSource";
import { PendingApprovals } from "./approvals";

export const hookNames = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop"] as const;
export type HookEvent = {
  id: string;
  hook_event_name: typeof hookNames[number];
  session_id: string;
  turn_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input_hash?: string;
  observed_at?: number;
  agent_id?: string;
};

export function isHookEvent(value: unknown): value is HookEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const shortString = (s: unknown) => typeof s === "string" && s.length > 0 && s.length <= 256;
  if (!shortString(v.id) || !shortString(v.session_id) || !hookNames.includes(v.hook_event_name as HookEvent["hook_event_name"])) return false;
  for (const key of ["turn_id", "tool_name", "tool_use_id", "agent_id"]) {
    if (v[key] !== undefined && !shortString(v[key])) return false;
  }
  if (v.observed_at !== undefined && (!Number.isSafeInteger(v.observed_at) || (v.observed_at as number) < 0)) return false;
  if (v.tool_input_hash !== undefined && (typeof v.tool_input_hash !== "string" || !/^[a-f0-9]{64}$/.test(v.tool_input_hash))) return false;
  if (["SubagentStart", "SubagentStop"].includes(v.hook_event_name as string) && !shortString(v.agent_id)) return false;
  if (!["SessionStart", "SessionEnd"].includes(v.hook_event_name as string) && !shortString(v.turn_id)) return false;
  if (["PreToolUse", "PostToolUse", "PermissionRequest"].includes(v.hook_event_name as string) && !shortString(v.tool_name)) return false;
  if (["PreToolUse", "PostToolUse"].includes(v.hook_event_name as string) && !shortString(v.tool_use_id)) return false;
  return true;
}

// Single-session ownership is intentional: other terminals cannot overwrite it.
export function createHookEventPublisher(send: SendStatusMessage, pinnedSession?: string) {
  let session = pinnedSession;
  let turn: string | undefined;
  let failed = false;
  let terminal: "completed" | "interrupted" | "failed" | undefined;
  let promptObservedAt = -1;
  const seen = new Set<string>();
  const closedTurns = new Set<string>();
  const tools = new Map<string, { type: AgentEventType; name: string }>();
  const waiting = new PendingApprovals();
  const subagents = new Set<string>();
  let lastHook: string | undefined;
  let accepted = 0;
  let ignored = 0;

  function remember(set: Set<string>, key: string) {
    set.add(key);
    if (set.size > 512) set.delete(set.values().next().value!);
  }
  function emit(type: AgentEventType, detail: string, id: string = randomUUID()) {
    send(createAgentEventMessage(normalizeAgentEvent({ id, type, origin: "codex", detail })));
  }
  function closeTurn() {
    if (turn) remember(closedTurns, `${session}:${turn}`);
    tools.clear();
    waiting.clear();
    subagents.clear();
  }
  function busy(event: HookEvent) {
    const active = [...tools.values()];
    emit(waiting.size ? "approval.requested" : active[active.length - 1]?.type ?? (subagents.size ? "tool.started" : "reasoning.started"), `CLI hook: ${event.hook_event_name}`, event.id);
  }
  return {
    status: () => ({ sessionId: session ?? null, turnId: turn ?? null, lastHook, accepted, ignored, activeTools: tools.size, pendingApprovals: waiting.size, activeSubagents: subagents.size }),
    failTurn(sessionId: string, turnId: string) {
      if (session !== sessionId || turn !== turnId || terminal === "failed" || terminal === "interrupted") return false;
      closeTurn();
      failed = true;
      terminal = "failed";
      emit("turn.failed", "CLI terminal failure (local transcript)");
      return true;
    },
    reset(expectedSession: string | null) {
      if ((session ?? null) !== expectedSession) return false;
      closeTurn();
      turn = undefined;
      session = pinnedSession;
      lastHook = undefined;
      failed = false;
      terminal = undefined;
      promptObservedAt = -1;
      emit("thread.idle", "CLI session binding manually reset");
      return true;
    },
    receive(event: HookEvent) {
      const ignore = () => { ignored++; return false; };
      if (seen.has(event.id)) return ignore();
      remember(seen, event.id);
      // A delayed tool event from a reset turn must not reclaim ownership.
      if (event.turn_id && closedTurns.has(`${event.session_id}:${event.turn_id}`)) return ignore();
      // A terminal failure must not strand a newly opened CLI behind the old
      // session. Only a fresh prompt can take over; late tools cannot do so.
      if (failed && !pinnedSession && event.hook_event_name === "UserPromptSubmit") {
        if (event.observed_at !== undefined && event.observed_at < promptObservedAt) return ignore();
        session = event.session_id;
        turn = undefined;
      }
      if (!session) {
        if (!["UserPromptSubmit", "PreToolUse", "PermissionRequest"].includes(event.hook_event_name)) return ignore();
        session = event.session_id;
      }
      if (session !== event.session_id) return ignore();
      if (event.turn_id && closedTurns.has(`${session}:${event.turn_id}`)) return ignore();
      if (event.hook_event_name === "UserPromptSubmit") {
        if (event.observed_at !== undefined && event.observed_at < promptObservedAt) return ignore();
        // Replayed prompt with a new transport ID must not clear active tools.
        if (turn === event.turn_id) return ignore();
        failed = false;
        terminal = undefined;
        promptObservedAt = event.observed_at ?? -1;
        if (turn && turn !== event.turn_id) closeTurn();
        turn = event.turn_id;
        tools.clear();
        waiting.clear();
        subagents.clear();
      } else if (event.turn_id) {
        if (turn && turn !== event.turn_id) return ignore();
        turn = event.turn_id;
      }
      accepted++;
      lastHook = event.hook_event_name;
      switch (event.hook_event_name) {
        case "UserPromptSubmit": emit("turn.started", "CLI prompt submitted", event.id); break;
        case "PreToolUse": {
          const type = event.tool_name === "Bash" ? "command.started" : event.tool_name === "apply_patch" ? "file.change" : "tool.started";
          tools.set(event.tool_use_id!, { type, name: event.tool_name! });
          waiting.start(event);
          busy(event);
          break;
        }
        case "PermissionRequest":
          waiting.request(event);
          busy(event);
          break;
        case "PostToolUse":
          tools.delete(event.tool_use_id!);
          waiting.complete(event);
          busy(event);
          break;
        case "Stop":
          closeTurn();
          terminal = "completed";
          emit("turn.completed", "CLI Stop hook: response stopped (not a success guarantee)", event.id);
          break;
        case "Interrupt": closeTurn(); terminal = "interrupted"; emit("thread.idle", "CLI turn interrupted", event.id); break;
        case "SessionEnd":
          closeTurn();
          emit("thread.idle", "CLI session ended", event.id);
          turn = undefined;
          session = pinnedSession;
          failed = false;
          terminal = undefined;
          promptObservedAt = -1;
          break;
        case "SubagentStart": subagents.add(event.agent_id!); busy(event); break;
        case "SubagentStop": subagents.delete(event.agent_id!); busy(event); break;
        case "PreCompact": case "PostCompact": busy(event); break;
        case "SessionStart": break;
      }
      if (process.env.AGENT_INDICATOR_DEBUG_EVENTS === "1") console.log(`[codex-hooks] ${event.hook_event_name} session=${event.session_id} turn=${event.turn_id ?? "-"}`);
      return true;
    },
  };
}
