import { createServer } from "node:net";
import { request } from "node:http";
import { networkInterfaces, homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function bridgeSettings(env = process.env) {
  const port = Number(env.AGENT_INDICATOR_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("bridge 端口必须是 1–65535 整数。");
  }
  const host = env.AGENT_INDICATOR_HOST ?? "0.0.0.0";
  let probeHost = host;
  if (host === "0.0.0.0") {
    probeHost = "127.0.0.1";
  } else if (host === "::") {
    probeHost = "::1";
  }
  return { port, host, probeHost };
}

export function settings(env = process.env) {
  const bridge = bridgeSettings(env);
  const hookPort = Number(env.AGENT_INDICATOR_HOOK_PORT ?? 8788);
  if (!Number.isInteger(hookPort) || hookPort < 1 || hookPort > 65535 || bridge.port === hookPort) {
    throw new Error("两个端口必须是不同的 1–65535 整数。");
  }
  return { ...bridge, hookPort };
}

// Bound response size and deadline, including a server that sends headers but stalls.
export function health(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const healthRequest = request({ host, port, path: "/health", method: "GET" }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
        if (data.length > 65536) {
          finish(null);
          healthRequest.destroy();
        }
      });
      response.on("error", () => finish(null));
      response.on("end", () => {
        try {
          finish(response.statusCode === 200 ? JSON.parse(data) : null);
        } catch {
          finish(null);
        }
      });
    });
    const timer = setTimeout(() => {
      finish(null);
      healthRequest.destroy();
    }, 1000);
    healthRequest.on("error", () => finish(null));
    healthRequest.end();
  });
}

export function canBind(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) => resolve({ free: false, reason: error.code }));
    server.listen({ host, port, exclusive: true }, () =>
      server.close(() => resolve({ free: true })),
    );
  });
}

export async function inspect(config) {
  const [bridge, hooks] = await Promise.all([
    health(config.probeHost, config.port),
    health("127.0.0.1", config.hookPort),
  ]);
  const bridgeOK =
    bridge?.ok === true &&
    bridge.service === "agent-indicator-bridge" &&
    bridge.source === "codex-cli-hooks";
  const hooksOK = hooks?.ok === true && hooks.source === "codex-cli-hooks";
  return { bridge, hooks, ready: bridgeOK && hooksOK, bridgeOK, hooksOK };
}

// Only meaningful diagnostics affect logging; polling timestamps are noise.
export function createDiagnosticReporter(write = report) {
  let previous;
  return (status) => {
    const observer = status.hooks?.terminalObserver;
    const cliObserver = status.hooks?.cliObserver;
    const key = JSON.stringify([
      status.bridgeOK,
      status.hooksOK,
      status.bridge?.clients,
      observer?.phase,
      observer?.error,
      cliObserver?.phase,
      cliObserver?.error,
    ]);
    if (key === previous) {
      return;
    }
    previous = key;
    write(status);
  };
}

function report(status) {
  console.log(
    `[诊断] CLI bridge ${status.bridgeOK ? "正常" : "不可用或来源不匹配"}；hooks 接收端 ${status.hooksOK ? "正常" : "不可用或来源不匹配"}`,
  );
  if (status.bridgeOK) {
    const count = status.bridge.clients;
    console.log(
      `[连接] WebSocket 客户端：${Number.isInteger(count) ? count : "未知"}。协议没有设备身份，客户端数量不能单独证明机器人已连接。`,
    );
    if (count === 0) {
      console.log(
        "[排查] 确认机器人开机、同一可互访 Wi-Fi、电脑 IP 与固件配置一致；检查专用网络防火墙 TCP 端口。",
      );
    }
    const event = status.bridge.latestAgentEvent;
    console.log(
      `[事件] 最近类型：${typeof event?.type === "string" ? event.type : "暂无"}；来源：${typeof event?.origin === "string" ? event.origin : "暂无"}`,
    );
  }
  if (status.hooksOK) {
    console.log(
      `[会话] ${status.hooks.sessionId ? "已绑定会话" : "等待 CLI 活动"}；接收 ${status.hooks.accepted ?? 0}，忽略 ${status.hooks.ignored ?? 0}。`,
    );
  }
  if (status.hooksOK && status.hooks.terminalObserver) {
    const observer = status.hooks.terminalObserver;
    let label = `${observer.phase}${observer.error ? `；${observer.error}` : ""}`;
    if (observer.phase === "unbound") {
      label = "等待 CLI 活动";
    } else if (observer.phase === "reading" && !observer.error) {
      label = "正常";
    }
    console.log(`[终止错误监听] ${label}。`);
  }
  if (status.hooksOK && status.hooks.cliObserver) {
    const observer = status.hooks.cliObserver;
    const labels = {
      unbound: "等待 CLI 活动",
      watching: "正在监听当前 CLI 的退出",
      unidentified: "缺少 CLI 进程身份；意外退出后可用 session:reset 恢复",
      unsupported: "当前系统不支持自动退出检测；可用 session:reset 恢复",
      degraded: "进程监听不可用；可用 session:reset 恢复",
    };
    console.log(
      `[CLI 退出监听] ${labels[observer.phase] ?? observer.phase}${observer.error ? `；${observer.error}` : ""}。`,
    );
  }
}

async function localChecks(config) {
  const locations = [
    join(root, ".codex", "hooks.json"),
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json"),
  ];
  for (const [index, path] of locations.entries()) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      const found = Object.values(parsed.hooks ?? {}).some(
        (groups) =>
          Array.isArray(groups) &&
          groups.some((group) =>
            group.hooks?.some(
              (hook) => typeof hook.command === "string" && hook.command.includes("codex-hook.mjs"),
            ),
          ),
      );
      console.log(
        `[配置] ${index === 0 ? "项目" : "用户级"} hooks：${found ? "发现通知脚本配置" : "未发现通知脚本配置"}`,
      );
    } catch (error) {
      console.log(
        `[配置] ${index === 0 ? "项目" : "用户级"} hooks：${error.code === "ENOENT" ? "未安装" : "无法读取或 JSON 无效"}`,
      );
    }
  }
  console.log(
    "[配置] 文件存在不代表 CLI 已信任。若没有事件，在 CLI 的 /hooks 中审核；需要安装时运行 npm run hooks:install。",
  );
  if (["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    console.log(
      "[注意] 当前仅监听回环地址，机器人无法访问。使用 AGENT_INDICATOR_HOST=0.0.0.0 后重启。",
    );
  }
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((adapter) => adapter && !adapter.internal && adapter.family === "IPv4")
    .map((adapter) => adapter.address);
  console.log(`[地址] 监听 ${config.host}:${config.port}；候选局域网地址（可能含虚拟网卡）：`);
  for (const ip of new Set(ips)) {
    console.log(`  ws://${ip}:${config.port}/status`);
  }
  if (!ips.length) {
    console.log("  未发现外部 IPv4 网卡，请检查网络连接。");
  }
  if (config.hookPort !== 8788) {
    console.log(
      `[注意] 自定义 hooks 端口 ${config.hookPort}，运行 Codex 的终端也必须设置相同 AGENT_INDICATOR_HOOK_PORT。`,
    );
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => !["--check", "--reset-session"].includes(arg)) || args.length > 1) {
    throw new Error("用法：npm start、npm run doctor 或 npm run session:reset");
  }
  const config = settings();
  await localChecks(config);
  const status = await inspect(config);
  report(status);
  if (args.includes("--reset-session")) {
    if (!status.ready) {
      throw new Error("CLI bridge 不完整，无法释放会话。请先检查服务。");
    }
    const response = await fetch(`http://127.0.0.1:${config.hookPort}/session/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedSessionId: status.hooks.sessionId,
        expectedTurnId: status.hooks.turnId,
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      throw new Error("会话在检查后发生变化或释放失败，请重新运行 doctor。");
    }
    console.log(
      "[恢复] 已清除当前轮次并显示 idle。现在可在目标 CLI 输入新任务；固定会话配置仍生效。",
    );
    return 0;
  }
  if (args.includes("--check")) {
    return status.ready ? 0 : 1;
  }
  if (status.ready) {
    console.log(
      "[启动] CLI bridge 已在运行，复用现有服务，不创建第二个实例。现在可在另一终端正常运行 codex。",
    );
    return 0;
  }
  const ports = await Promise.all([
    canBind(config.host, config.port),
    canBind("127.0.0.1", config.hookPort),
  ]);
  if (ports.some((portStatus) => !portStatus.free)) {
    ports.forEach((portStatus, index) => {
      if (!portStatus.free) {
        console.error(
          `[启动失败] 端口 ${index ? config.hookPort : config.port} 不可用（${portStatus.reason}）。请检查占用者；不会自动结束其他进程。`,
        );
      }
    });
    console.error(
      "如果运行的是 mock/app-server 或不完整的旧 bridge，请在其终端按 Ctrl+C，再运行 npm start。",
    );
    return 1;
  }
  let tsImport;
  try {
    ({ tsImport } = await import("tsx/esm/api"));
  } catch {
    throw new Error("缺少项目依赖，请先在项目目录运行 npm install。");
  }
  process.env.AGENT_INDICATOR_HOST = config.host;
  console.log("[启动] 启动 CLI bridge；此终端保持运行，Ctrl+C 停止。另一终端运行 codex。");
  await tsImport(pathToFileURL(join(root, "server", "cli.ts")).href, import.meta.url);
  const reportChanges = createDiagnosticReporter();
  let busy = false;
  const monitor = async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const next = await inspect(config);
      reportChanges(next);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void monitor();
  }, 3000);
  timer.unref();
  await monitor();
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[启动失败] ${error.message}`);
      process.exitCode = 1;
    });
}
