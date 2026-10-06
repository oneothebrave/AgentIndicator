import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCliExitWatcher } from "./cliExit";
import { createHookEventPublisher, isHookEvent, type HookEvent } from "./events";
import type { ProcessObservation } from "../../../shared/windows-process.mjs";
import type { StatusMessage } from "../../../src/domain/statusProtocol";

function setup(pinned?: string) {
  const output: StatusMessage[] = [];
  const publisher = createHookEventPublisher((message) => output.push(message), pinned);
  const processes = new Map<
    number,
    { state: ReturnType<ProcessObservation["poll"]>; closes: number }
  >();
  let opens = 0;
  const watcher = createCliExitWatcher(publisher, {
    supported: true,
    openProcess(identity) {
      opens++;
      const process = { state: "alive" as ReturnType<ProcessObservation["poll"]>, closes: 0 };
      processes.set(identity.pid, process);
      return {
        poll: () => process.state,
        close: () => {
          process.closes++;
        },
      };
    },
  });
  const event = (
    name: HookEvent["hook_event_name"],
    fields: Partial<HookEvent> = {},
  ): HookEvent => ({
    id: randomUUID(),
    hook_event_name: name,
    session_id: pinned ?? "a",
    turn_id: "t1",
    cli_process: { pid: 10, started_at: "100" },
    ...fields,
  });
  const send = (name: HookEvent["hook_event_name"], fields: Partial<HookEvent> = {}) =>
    watcher.receive(event(name, fields));
  const last = () => {
    const message = output[output.length - 1];
    return message?.kind === "agent.event" ? message.event.type : undefined;
  };
  return { publisher, watcher, processes, send, last, output, opens: () => opens };
}

test("proven CLI exit clears activity/binding and permits a fresh terminal", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "command" });
  state.send("PermissionRequest", { tool_name: "Bash", tool_use_id: "command" });
  state.send("SubagentStart", { agent_id: "child" });
  assert.equal(state.last(), "approval.requested");
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  const binding = state.publisher.status();
  assert.equal(binding.sessionId, null);
  assert.equal(binding.turnId, null);
  assert.equal(binding.activeTools + binding.pendingApprovals + binding.activeSubagents, 0);
  assert.equal(state.last(), "thread.idle");
  assert.equal(state.processes.get(10)!.closes, 1);
  assert.equal(state.send("PreToolUse", { tool_name: "Bash", tool_use_id: "late" }), false);
  assert.equal(
    state.send("UserPromptSubmit", {
      session_id: "b",
      turn_id: "t2",
      cli_process: { pid: 20, started_at: "200" },
    }),
    true,
  );
  assert.equal(state.publisher.status().sessionId, "b");
});

test("silent long work, approval and unknown wait result never release a live CLI", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  for (let index = 0; index < 100; index++) {
    state.watcher.check();
  }
  assert.equal(state.last(), "turn.started");
  state.send("PermissionRequest", { tool_name: "Bash" });
  state.processes.get(10)!.state = "unknown";
  state.watcher.check();
  assert.equal(state.watcher.status().phase, "degraded");
  assert.equal(state.last(), "approval.requested");
  assert.equal(state.publisher.status().sessionId, "a");
  state.processes.get(10)!.state = "alive";
  state.watcher.check();
  assert.equal(state.watcher.status().phase, "watching");
});

test("same CLI newer turn shares one handle; exit releases its current turn", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  state.send("Stop");
  state.send("UserPromptSubmit", { turn_id: "t2" });
  assert.equal(state.opens(), 1);
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  assert.equal(state.publisher.status().sessionId, null);
  assert.equal(state.last(), "thread.idle");
});

test("ignored session cannot replace owner; stale exit cannot reset a takeover after error", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  const newCli = { session_id: "b", turn_id: "t2", cli_process: { pid: 20, started_at: "200" } };
  assert.equal(state.send("UserPromptSubmit", newCli), false);
  assert.equal(state.opens(), 1);
  state.publisher.failTurn("a", "t1");
  assert.equal(state.send("UserPromptSubmit", newCli), true);
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  assert.equal(state.publisher.status().sessionId, "b");
  assert.equal(state.last(), "turn.started");
  assert.equal(state.processes.get(10)!.closes, 1);
});

test("delayed old process hooks cannot clear a resumed session with the same session ID", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  state.processes.get(10)!.state = "exited";
  const replacement = { turn_id: "t2", cli_process: { pid: 10, started_at: "200" } };
  assert.equal(state.send("UserPromptSubmit", replacement), true);
  assert.equal(state.send("SessionEnd", { turn_id: undefined }), false);
  assert.equal(state.send("SessionEnd", { turn_id: undefined, cli_process: undefined }), false);
  assert.equal(state.last(), "turn.started");
  assert.equal(state.publisher.status().turnId, "t2");
  assert.equal(state.send("SessionEnd", { ...replacement, turn_id: undefined }), true);
  assert.equal(state.publisher.status().sessionId, null);
});

test("unidentified takeover detaches old owner; unsupported and unavailable monitoring retain binding", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  state.publisher.failTurn("a", "t1");
  state.send("UserPromptSubmit", { session_id: "b", turn_id: "t2", cli_process: undefined });
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  assert.equal(state.publisher.status().sessionId, "b");
  assert.equal(state.watcher.status().phase, "unidentified");
  for (const supported of [true, false]) {
    const publisher = createHookEventPublisher(() => {});
    const watcher = createCliExitWatcher(publisher, {
      supported,
      openProcess() {
        throw new Error("process-open-unavailable");
      },
    });
    context.after(watcher.stop);
    watcher.receive({
      id: randomUUID(),
      hook_event_name: "UserPromptSubmit",
      session_id: "retained",
      turn_id: "t",
      cli_process: { pid: 1, started_at: "1" },
    });
    watcher.check();
    assert.equal(publisher.status().sessionId, "retained");
    assert.equal(watcher.status().phase, supported ? "degraded" : "unsupported");
  }
});

test("explicit SessionEnd and stop release handles; automatic exit preserves pin", (context) => {
  const state = setup("pinned");
  context.after(state.watcher.stop);
  state.send("UserPromptSubmit");
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  assert.equal(state.publisher.status().sessionId, "pinned");
  assert.equal(state.publisher.status().turnId, null);
  state.send("UserPromptSubmit", { turn_id: "t2" });
  state.send("SessionEnd", { turn_id: undefined });
  assert.equal(state.processes.get(10)!.closes, 1);
  state.send("UserPromptSubmit", { turn_id: "t3" });
  const before = state.output.length;
  state.watcher.stop();
  state.processes.get(10)!.state = "exited";
  state.watcher.check();
  assert.equal(state.output.length, before);
});

test("hook validator rejects malformed process identities", () => {
  const event = { id: "id", hook_event_name: "UserPromptSubmit", session_id: "s", turn_id: "t" };
  assert.equal(isHookEvent({ ...event, cli_process: { pid: 10, started_at: "100" } }), true);
  for (const cli_process of [
    null,
    {},
    { pid: 10, started_at: 100 },
    { pid: -1, started_at: "100" },
  ]) {
    assert.equal(isHookEvent({ ...event, cli_process }), false);
  }
  assert.equal(isHookEvent({ ...event, client_kind: "cli" }), false);
  assert.equal(isHookEvent({ ...event, client_kind: "invented" }), false);
});

test("known non-interactive notifications cannot bind or overwrite a CLI", (context) => {
  const state = setup();
  context.after(state.watcher.stop);
  assert.equal(
    state.send("UserPromptSubmit", { client_kind: "other", cli_process: undefined }),
    false,
  );
  assert.equal(state.publisher.status().sessionId, null);
  state.send("UserPromptSubmit", { client_kind: "cli" });
  assert.equal(state.send("SessionEnd", { client_kind: "other", turn_id: undefined }), false);
  assert.equal(state.last(), "turn.started");
  assert.equal(state.publisher.status().sessionId, "a");
});
