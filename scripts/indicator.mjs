import { createServer } from "node:net";
import { request } from "node:http";
import { networkInterfaces, homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function settings(env = process.env) {
  const port = Number(env.AGENT_INDICATOR_PORT ?? 8787);
  const hookPort = Number(env.AGENT_INDICATOR_HOOK_PORT ?? 8788);
  if (![port, hookPort].every(p => Number.isInteger(p) && p > 0 && p <= 65535) || port === hookPort)
    throw new Error("两个端口必须是不同的 1–65535 整数。");
  const host = env.AGENT_INDICATOR_HOST ?? "0.0.0.0";
  return { port, hookPort, host, probeHost: host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host };
}

// Bound response size and deadline, including a server that sends headers but stalls.
export function health(host, port) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const req = request({ host, port, path: "/health", method: "GET" }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        data += chunk;
        if (data.length > 65536) { finish(null); req.destroy(); }
      });
      res.on("error", () => finish(null));
      res.on("end", () => {
        try { finish(res.statusCode === 200 ? JSON.parse(data) : null); } catch { finish(null); }
      });
    });
    const timer = setTimeout(() => { finish(null); req.destroy(); }, 1000);
    req.on("error", () => finish(null));
    req.end();
  });
}

export function canBind(host, port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once("error", error => resolve({ free: false, reason: error.code }));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve({ free: true })));
  });
}

export async function inspect(config) {
  const [bridge, hooks] = await Promise.all([
    health(config.probeHost, config.port), health("127.0.0.1", config.hookPort),
  ]);
  const bridgeOK = bridge?.ok === true && bridge.service === "agent-indicator-bridge" && bridge.source === "codex-cli-hooks";
  const hooksOK = hooks?.ok === true && hooks.source === "codex-cli-hooks";
  return { bridge, hooks, ready: bridgeOK && hooksOK, bridgeOK, hooksOK };
}

function report(status) {
  console.log(`[诊断] CLI bridge ${status.bridgeOK ? "正常" : "不可用或来源不匹配"}；hooks 接收端 ${status.hooksOK ? "正常" : "不可用或来源不匹配"}`);
  if (status.bridgeOK) {
    const count = status.bridge.clients;
    console.log(`[连接] WebSocket 客户端：${Number.isInteger(count) ? count : "未知"}。协议没有设备身份，客户端数量不能单独证明机器人已连接。`);
    if (count === 0) console.log("[排查] 确认机器人开机、同一可互访 Wi-Fi、电脑 IP 与固件配置一致；检查专用网络防火墙 TCP 端口。");
    const event = status.bridge.latestAgentEvent;
    console.log(`[事件] 最近类型：${typeof event?.type === "string" ? event.type : "暂无"}；来源：${typeof event?.origin === "string" ? event.origin : "暂无"}`);
  }
  if (status.hooksOK) console.log(`[会话] ${status.hooks.sessionId ? "已绑定会话" : "等待 CLI 活动"}；接收 ${status.hooks.accepted ?? 0}，忽略 ${status.hooks.ignored ?? 0}。`);
}

async function localChecks(config) {
  const locations = [join(root, ".codex", "hooks.json"), join(process.env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json")];
  for (const [index, path] of locations.entries()) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      const found = Object.values(parsed.hooks ?? {}).some(groups => Array.isArray(groups) && groups.some(g => g.hooks?.some(h => typeof h.command === "string" && h.command.includes("codex-hook.mjs"))));
      console.log(`[配置] ${index === 0 ? "项目" : "用户级"} hooks：${found ? "发现通知脚本配置" : "未发现通知脚本配置"}`);
    } catch (error) {
      console.log(`[配置] ${index === 0 ? "项目" : "用户级"} hooks：${error.code === "ENOENT" ? "未安装" : "无法读取或 JSON 无效"}`);
    }
  }
  console.log("[配置] 文件存在不代表 CLI 已信任。若没有事件，在 CLI 的 /hooks 中审核；需要安装时运行 npm run hooks:install。");
  if (["127.0.0.1", "localhost", "::1"].includes(config.host)) console.log("[注意] 当前仅监听回环地址，机器人无法访问。使用 AGENT_INDICATOR_HOST=0.0.0.0 后重启。");
  const ips = Object.values(networkInterfaces()).flat().filter(a => a && !a.internal && a.family === "IPv4").map(a => a.address);
  console.log(`[地址] 监听 ${config.host}:${config.port}；候选局域网地址（可能含虚拟网卡）：`);
  for (const ip of new Set(ips)) console.log(`  ws://${ip}:${config.port}/status`);
  if (!ips.length) console.log("  未发现外部 IPv4 网卡，请检查网络连接。");
  if (config.hookPort !== 8788) console.log(`[注意] 自定义 hooks 端口 ${config.hookPort}，运行 Codex 的终端也必须设置相同 AGENT_INDICATOR_HOOK_PORT。`);
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !["--check", "--reset-session"].includes(arg)) || args.length > 1) throw new Error("用法：npm start、npm run doctor 或 npm run session:reset");
  const config = settings();
  await localChecks(config);
  const status = await inspect(config);
  report(status);
  if (args.includes("--reset-session")) {
    if (!status.ready) throw new Error("CLI bridge 不完整，无法释放会话。请先检查服务。");
    const response = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedSessionId: status.hooks.sessionId }), signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error("会话在检查后发生变化或释放失败，请重新运行 doctor。");
    console.log("[恢复] 已清除当前轮次并显示 idle。现在可在目标 CLI 输入新任务；固定会话配置仍生效。");
    return 0;
  }
  if (args.includes("--check")) return status.ready ? 0 : 1;
  if (status.ready) {
    console.log("[启动] CLI bridge 已在运行，复用现有服务，不创建第二个实例。现在可在另一终端正常运行 codex。");
    return 0;
  }
  const ports = await Promise.all([canBind(config.host, config.port), canBind("127.0.0.1", config.hookPort)]);
  if (ports.some(p => !p.free)) {
    ports.forEach((p, i) => { if (!p.free) console.error(`[启动失败] 端口 ${i ? config.hookPort : config.port} 不可用（${p.reason}）。请检查占用者；不会自动结束其他进程。`); });
    console.error("如果运行的是 mock/app-server 或不完整的旧 bridge，请在其终端按 Ctrl+C，再运行 npm start。");
    return 1;
  }
  try { await import("tsx/esm/api"); } catch { throw new Error("缺少项目依赖，请先在项目目录运行 npm install。"); }
  process.env.AGENT_INDICATOR_HOST = config.host;
  console.log("[启动] 启动 CLI bridge；此终端保持运行，Ctrl+C 停止。另一终端运行 codex。");
  const { tsImport } = await import("tsx/esm/api");
  await tsImport(pathToFileURL(join(root, "server", "cli.ts")).href, import.meta.url);
  let last = "", busy = false;
  const monitor = async () => {
    if (busy) return;
    busy = true;
    try {
      const next = await inspect(config);
      const key = JSON.stringify([next.ready, next.bridge?.clients]);
      if (key !== last) { report(next); last = key; }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void monitor(); }, 3000);
  timer.unref();
  await monitor();
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(`[启动失败] ${error.message}`); process.exitCode = 1; });
