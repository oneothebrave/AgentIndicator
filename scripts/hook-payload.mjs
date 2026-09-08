import { createHash, randomUUID } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

// Only the digest crosses loopback. No prompt, command, response or path is sent.
export function hookPayload(raw, now = Date.now()) {
  const event = { id: randomUUID(), observed_at: now };
  for (const key of ["hook_event_name", "session_id", "turn_id", "tool_name", "tool_use_id", "agent_id"]) {
    if (typeof raw[key] === "string" && raw[key].length <= 256) event[key] = raw[key];
  }
  if (raw.tool_input !== undefined && event.tool_name) {
    // Approval descriptions are metadata. Bash/patch approval input carries the
    // same command, while the remaining tool arguments can differ by stage.
    const input = ["Bash", "apply_patch"].includes(event.tool_name)
      ? raw.tool_input?.command
      : raw.tool_input;
    if (input !== undefined) event.tool_input_hash = createHash("sha256")
      .update(JSON.stringify([event.session_id, event.turn_id, event.tool_name, canonical(input)]))
      .digest("hex");
  }
  return event;
}
