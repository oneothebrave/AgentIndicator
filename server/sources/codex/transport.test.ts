import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CodexAppServerProcess } from "./appServerProcess";
import { CodexAppServerClient } from "./client";

test("stdin EOF racing with child exit is handled once", { timeout: 5000 }, async (context) => {
  const failures: Error[] = [];
  let complete!: () => void;
  const ended = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const process = new CodexAppServerProcess(
    {
      command: globalThis.process.execPath,
      args: ["-e", "process.stdin.destroy(); console.log('ready'); setTimeout(()=>{},150)"],
      cwd: globalThis.process.cwd(),
    },
    {
      onLine() {
        process.writeLine("x".repeat(65536));
      },
      onStderrLine() {},
      onExit(error) {
        failures.push(error);
        complete();
      },
    },
  );
  context.after(() => process.stop());
  process.start();
  await ended;
  await delay(50);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /EOF|EPIPE|pipe/i);
  assert.throws(() => process.writeLine("late"), /not writable/);
});

test(
  "child exit drains final notifications and rejects pending requests",
  { timeout: 5000 },
  async (context) => {
    const notices: string[] = [];
    const exits: string[] = [];
    const client = new CodexAppServerClient({
      launch: {
        command: process.execPath,
        args: [
          "-e",
          `process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({method:'last'})+'\\n',()=>process.exit(17))})`,
        ],
        cwd: process.cwd(),
      },
      client: { requestTimeoutMs: 3000 },
      onNotification(notification) {
        notices.push(notification.method);
      },
      onServerRequest() {},
      onExit(detail) {
        exits.push(detail);
      },
    });
    context.after(() => client.stop());
    client.start();
    await assert.rejects(client.request("pending"), /code 17/);
    assert.deepEqual(notices, ["last"]);
    assert.equal(exits.length, 1);
  },
);

test(
  "explicit stop rejects pending requests without reporting source failure",
  { timeout: 5000 },
  async () => {
    const exits: string[] = [];
    const client = new CodexAppServerClient({
      launch: {
        command: process.execPath,
        args: ["-e", "process.stdin.resume()"],
        cwd: process.cwd(),
      },
      client: { requestTimeoutMs: 3000 },
      onNotification() {},
      onServerRequest() {},
      onExit(detail) {
        exits.push(detail);
      },
    });
    client.start();
    const pending = assert.rejects(client.request("pending"), /client stopped/);
    client.stop();
    await pending;
    await delay(50);
    assert.deepEqual(exits, []);
  },
);
