import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("hook listener startup failure exits with failure status", { timeout: 10000 }, async (t) => {
  const occupied = createServer();
  t.after(() => occupied.close());
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");

  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: {
      ...process.env,
      AGENT_INDICATOR_SOURCE: "codex-hooks",
      AGENT_INDICATOR_HOST: "127.0.0.1",
      AGENT_INDICATOR_PORT: "0",
      AGENT_INDICATOR_HOOK_PORT: String(address.port),
    },
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.match(stderr, /EADDRINUSE/);
  assert.equal(code, 1, stderr);
});
