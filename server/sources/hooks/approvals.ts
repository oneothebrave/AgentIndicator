import type { HookEvent } from "./events";

/** Correlate ID-less approvals conservatively, including identical parallel calls. */
export class PendingApprovals {
  private entries = new Map<string, { id?: string; hash?: string; name: string; candidates: Set<string> }>();
  private calls = new Map<string, { hash?: string; name: string }>();

  get size() { return this.entries.size; }
  clear() { this.entries.clear(); this.calls.clear(); }

  start(event: HookEvent) {
    this.calls.set(event.tool_use_id!, { hash: event.tool_input_hash, name: event.tool_name! });
    // A PreToolUse received after its PermissionRequest is not proof of approval.
    for (const entry of this.entries.values()) {
      if (!entry.id && entry.hash && entry.hash === event.tool_input_hash && entry.name === event.tool_name)
        entry.candidates.add(event.tool_use_id!);
    }
  }

  request(event: HookEvent) {
    const candidates = new Set<string>();
    if (event.tool_input_hash) for (const [id, call] of this.calls) {
      if (call.hash === event.tool_input_hash && call.name === event.tool_name) candidates.add(id);
    }
    this.entries.set(event.tool_use_id ? `tool:${event.tool_use_id}` : event.id, {
      id: event.tool_use_id, hash: event.tool_input_hash, name: event.tool_name!, candidates,
    });
  }

  complete(event: HookEvent) {
    const call = this.calls.get(event.tool_use_id!);
    this.calls.delete(event.tool_use_id!);
    for (const [key, entry] of this.entries) {
      if (entry.id) {
        if (entry.id === event.tool_use_id) this.entries.delete(key);
        continue;
      }
      const hash = event.tool_input_hash ?? call?.hash;
      if (!entry.hash || entry.hash !== hash || entry.name !== event.tool_name) continue;
      if (entry.candidates.size) {
        if (!entry.candidates.delete(event.tool_use_id!)) continue;
        if (entry.candidates.size) continue;
      }
      this.entries.delete(key);
    }
  }
}
