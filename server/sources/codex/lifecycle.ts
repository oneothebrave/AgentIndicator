import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentEventType } from "../../../src/domain/agentStatus";
import type { JsonRpcServerRequest } from "./jsonRpc";
import type { CodexNotification } from "./types";
import { getNestedString, getNestedValue } from "./utils";

const toolEvents = new Set<AgentEventType>(["command.started", "file.change", "tool.started", "search.started"]);

/** Lifecycle protection for the one thread owned by this app-server source. */
export class CodexLifecycle {
  private thread?: string;
  private turn?: string;
  private terminal = false;
  private closed = new Set<string>();
  private tools = new Map<string, AgentEventType>();
  private requests = new Set<string>();
  private waitingFlag = false;

  private accepts(params: unknown) {
    const thread = getNestedString(params, ["threadId"]);
    if (this.thread && thread && thread !== this.thread) return false;
    this.thread ??= thread;
    return true;
  }
  private clear() { this.tools.clear(); this.requests.clear(); this.waitingFlag = false; }
  private close() {
    if (this.turn) this.closed.add(this.turn);
    if (this.closed.size > 512) this.closed.delete(this.closed.values().next().value!);
    this.terminal = true;
    this.clear();
  }
  private activity(fallback: AgentEventType = "reasoning.started"): AgentEvent {
    const active = [...this.tools.values()];
    return { id: randomUUID(), at: Date.now(), origin: "codex",
      type: this.waitingFlag || this.requests.size ? "approval.requested" : active[active.length - 1] ?? fallback };
  }
  request(request: JsonRpcServerRequest, event?: AgentEvent) {
    if (!event || !this.accepts(request.params) || this.terminal) return undefined;
    const turn = getNestedString(request.params, ["turnId"]);
    if (this.turn && turn && turn !== this.turn) return undefined;
    this.requests.add(String(request.id));
    return event;
  }
  notification(n: CodexNotification, event?: AgentEvent): AgentEvent | undefined {
    if (!this.accepts(n.params)) return undefined;
    const turn = getNestedString(n.params, ["turnId"]) ?? getNestedString(n.params, ["turn", "id"]);
    if (n.method === "turn/started") {
      if (turn && (this.closed.has(turn) || turn === this.turn)) return undefined;
      if (this.turn) this.closed.add(this.turn);
      this.turn = turn;
      this.terminal = false;
      this.clear();
      return event;
    }
    if (turn && this.turn && turn !== this.turn) return undefined;
    if (this.terminal) return undefined;
    if ((n.method === "turn/completed" && event) || event?.type === "turn.failed") {
      this.close();
      return event;
    }
    if (n.method === "serverRequest/resolved") {
      const id = getNestedValue(n.params, ["requestId"]);
      if (!this.requests.delete(String(id))) return undefined;
      return this.activity();
    }
    if (n.method === "thread/status/changed") {
      const status = getNestedString(n.params, ["status", "type"]);
      if (status === "active") this.waitingFlag = event?.type === "approval.requested";
      if (status === "idle") {
        // End-of-turn idle often arrives before/after turn/completed. Let the
        // explicit outcome decide whether to smile, fail or return to idle.
        if (this.turn) return undefined;
        this.clear();
        return event;
      }
    }
    const itemId = getNestedString(n.params, ["item", "id"]);
    if (n.method === "item/started" && itemId && event && toolEvents.has(event.type)) this.tools.set(itemId, event.type);
    if (n.method === "item/completed" && itemId && this.tools.delete(itemId)) return this.activity();
    if (!event) return undefined;
    if (this.waitingFlag || this.requests.size || this.tools.size) return this.activity(event.type);
    return event;
  }
}
