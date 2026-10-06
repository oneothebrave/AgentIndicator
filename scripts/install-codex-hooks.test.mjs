import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHooks, updateHookConfig } from "./install-codex-hooks.mjs";
import registration from "../shared/hook-events.json" with { type: "json" };

test("installer retires SessionStart, preserves unrelated handlers and is idempotent", () => {
  const ours = { type: "command", command: "ours" };
  const other = { type: "command", command: "other", timeout: 12 };
  const config = {
    description: "preserve",
    hooks: {
      SessionStart: [{ matcher: "resume", hooks: [ours, other] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ ...ours, command: "legacy" }, other] }],
      FutureEvent: [{ hooks: [other] }],
    },
  };
  const options = { command: "ours", legacyCommand: "legacy" };
  const result = updateHookConfig(config, options);
  assert.deepEqual(result.hooks.SessionStart, [{ matcher: "resume", hooks: [other] }]);
  assert.deepEqual(result.hooks.PreToolUse[0], { matcher: "Bash", hooks: [other] });
  assert.deepEqual(result.hooks.FutureEvent, config.hooks.FutureEvent);
  assert.equal(result.description, "preserve");
  for (const [name, enabled] of Object.entries(registration)) {
    const installed = (result.hooks[name] ?? [])
      .flatMap((group) => group.hooks)
      .filter((hook) => hook.command === "ours");
    assert.equal(installed.length, enabled ? 1 : 0);
  }
  assert.deepEqual(updateHookConfig(result, options), result);
  const uninstalled = updateHookConfig(result, { ...options, uninstall: true });
  assert.deepEqual(uninstalled.hooks.PreToolUse, [{ matcher: "Bash", hooks: [other] }]);
  assert.equal(JSON.stringify(uninstalled).includes('"ours"'), false);
  assert.equal(config.hooks.SessionStart[0].hooks.length, 2);
});

test("file installation backs up changes, repeated install does not rewrite, invalid input is preserved", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "indicator-installer-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, "hooks.json");
  const original = '{"description":"keep","hooks":{}}';
  await writeFile(target, original);
  assert.equal(await installHooks({ target }), true);
  const files = await readdir(dir);
  const backup = files.find((name) => name.endsWith(".bak"));
  assert.ok(backup);
  assert.equal(await readFile(join(dir, backup), "utf8"), original);
  assert.equal(await installHooks({ target }), false);
  assert.deepEqual(await readdir(dir), files);
  await writeFile(target, '{"hooks":{"PreToolUse":[{}]}}');
  await assert.rejects(installHooks({ target }), /Invalid existing PreToolUse/);
  assert.equal(await readFile(target, "utf8"), '{"hooks":{"PreToolUse":[{}]}}');
});
