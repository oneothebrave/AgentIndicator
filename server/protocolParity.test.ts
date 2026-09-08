import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentEventTypes, mapEventToState } from "../src/domain/agentStatus";

test("firmware implements all and only the shared AgentEvent mappings", () => {
  const header = readFileSync(new URL("../firmware/stackchan/include/event_states.h", import.meta.url), "utf8");
  const rows = [...header.matchAll(/\{"([^"]+)", "([^"]+)", 0x[0-9a-f]+\}/g)].map(m => [m[1], m[2]]);
  assert.equal(rows.length, agentEventTypes.length);
  assert.deepEqual(rows.map(r => r[0]).sort(), [...agentEventTypes].sort());
  for (const type of agentEventTypes) assert.equal(rows.find(r => r[0] === type)?.[1], mapEventToState({ id: "parity", at: 0, origin: "mock", type }, "idle"));
});
