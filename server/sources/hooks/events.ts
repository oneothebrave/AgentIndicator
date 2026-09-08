import { randomUUID } from "node:crypto";
import type { AgentEventType } from "../../../src/domain/agentStatus";
import { createAgentEventMessage, normalizeAgentEvent } from "../../../src/domain/statusProtocol";
import type { SendStatusMessage } from "../statusSource";

export const hookNames = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt", "PreCompact", "PostCompact"] as const;
export type HookEvent = {
  id: string;
  hook_event_name: typeof hookNames[number];
  session_id: string;
  turn_id?: string;
  tool_name?: string;
  tool_use_id?: string;
};

export function isHookEvent(value: unknown): value is HookEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const shortString = (s: unknown) => typeof s === "string" && s.length > 0 && s.length <= 256;
  if (!shortString(v.id) || !shortString(v.session_id) || !hookNames.includes(v.hook_event_name as HookEvent["hook_event_name"])) return false;
  for (const key of ["turn_id", "tool_name", "tool_use_id"]) {
    if (v[key] !== undefined && !shortString(v[key])) return false;
  }
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
  const seen = new Set<string>();
  const closedTurns = new Set<string>();
  const tools = new Map<string, { type: AgentEventType; name: string }>();
  const waiting = new Set<string>();
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
  }
  function busy(event: HookEvent) {
    const active = [...tools.values()];
    emit(waiting.size ? "approval.requested" : active[active.length - 1]?.type ?? "reasoning.started", `CLI hook: ${event.hook_event_name}`, event.id);
  }
  return {
    status: () => ({ sessionId: session ?? null, turnId: turn ?? null, lastHook, accepted, ignored, activeTools: tools.size }),
    failTurn(sessionId: string, turnId: string) {
      if (session !== sessionId || turn !== turnId || closedTurns.has(`${session}:${turn}`)) return false;
      closeTurn();
      failed = true;
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
        failed = false;
        if (turn && turn !== event.turn_id) closeTurn();
        turn = event.turn_id;
        tools.clear();
        waiting.clear();
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
          busy(event);
          break;
        }
        case "PermissionRequest":
          // Without an invocation ID, keep Waiting until the turn closes;
          // a same-name tool completion does not identify this approval.
          waiting.add(event.tool_use_id ? `tool:${event.tool_use_id}` : `event:${event.id}`);
          busy(event);
          break;
        case "PostToolUse":
          tools.delete(event.tool_use_id!);
          waiting.delete(`tool:${event.tool_use_id}`);
          busy(event);
          break;
        case "Stop":
          closeTurn();
          emit("turn.completed", "CLI Stop hook: response stopped (not a success guarantee)", event.id);
          break;
        case "Interrupt": closeTurn(); emit("thread.idle", "CLI turn interrupted", event.id); break;
        case "SessionEnd":
          closeTurn();
          emit("thread.idle", "CLI session ended", event.id);
          turn = undefined;
          session = pinnedSession;
          failed = false;
          break;
        case "PreCompact": case "PostCompact": busy(event); break;
        case "SessionStart": break;
      }
      console.log(`[codex-hooks] ${event.hook_event_name} session=${event.session_id} turn=${event.turn_id ?? "-"}`);
      return true;
    },
  };
}
