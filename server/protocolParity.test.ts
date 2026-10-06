import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentEventTypes, mapEventToState } from "../src/domain/agentStatus";

test("firmware implements all and only the shared AgentEvent mappings", () => {
  const header = readFileSync(
    new URL("../firmware/stackchan/include/event_states.h", import.meta.url),
    "utf8",
  );
  const rows = [...header.matchAll(/\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*0x[0-9a-f]+\s*\}/g)].map(
    (match) => [match[1], match[2]],
  );
  assert.equal(rows.length, agentEventTypes.length);
  assert.deepEqual(rows.map((row) => row[0]).sort(), [...agentEventTypes].sort());
  for (const type of agentEventTypes) {
    assert.equal(
      rows.find((row) => row[0] === type)?.[1],
      mapEventToState({ id: "parity", at: 0, origin: "mock", type }, "idle"),
    );
  }
});

test("default firmware build selects the production status client", () => {
  const ini = readFileSync(
    new URL("../firmware/stackchan/platformio.ini", import.meta.url),
    "utf8",
  );
  assert.match(ini, /\[platformio\]\s+default_envs\s*=\s*status-client\s/);
});
