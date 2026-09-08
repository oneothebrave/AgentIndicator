import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { settings, inspect } from "./indicator.mjs";

const args = process.argv.slice(2);
const minutes = args.length === 0 ? 5 : args.length === 2 && args[0] === "--minutes" ? Number(args[1]) : NaN;
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
  console.error("用法：npm run stability -- --minutes 720（1–1440 分钟，默认 5 分钟）");
  process.exitCode = 1;
} else {
  const config = settings();
  const directory = fileURLToPath(new URL("../.tmp/stability/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
  const file = await open(path, "wx");
  let stopped = false, samples = 0, failures = 0, zeroClients = 0;
  let last = "";
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });
  const started = Date.now(), end = started + minutes * 60000;
  console.log(`只读采样 ${minutes} 分钟，每 5 秒一次；日志：${path}`);
  try {
    do {
      const status = await inspect(config);
      const sample = {
        at: new Date().toISOString(), ready: status.ready,
        clients: status.bridgeOK ? status.bridge.clients : null,
        uptimeSeconds: status.bridgeOK ? status.bridge.uptimeSeconds : null,
        memory: status.bridgeOK ? status.bridge.memory : null,
        eventType: status.bridgeOK ? status.bridge.latestAgentEvent?.type : null,
        accepted: status.hooksOK ? status.hooks.accepted : null,
        ignored: status.hooksOK ? status.hooks.ignored : null,
      };
      samples++; if (!status.ready) failures++; if (sample.clients === 0) zeroClients++;
      await file.write(JSON.stringify(sample) + "\n");
      const key = JSON.stringify([sample.ready, sample.clients]);
      if (key !== last) { console.log(`[采样] 服务正常=${sample.ready}，客户端=${sample.clients}`); last = key; }
      if (Date.now() >= end || stopped) break;
      await delay(Math.min(5000, end - Date.now()));
    } while (!stopped);
    const summary = { summary: true, elapsedSeconds: Math.round((Date.now() - started) / 1000), samples, failures, zeroClients, interrupted: stopped };
    await file.write(JSON.stringify(summary) + "\n");
    console.log(JSON.stringify(summary));
    if (failures) process.exitCode = 1;
  } finally { await file.close(); }
}
