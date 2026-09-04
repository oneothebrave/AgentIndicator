# Agent Indicator 开发计划

## 目标

先用浏览器完成圆屏模拟器和 Agent 状态机，再把同一套状态协议接到 ESP32-S3 圆屏硬件。前端只消费 bridge 推送的统一事件，不提供本地 mock、手动状态切换或关闭 stream 的入口。

## 总体架构

```text
Codex / CLI / other agent
  -> local bridge
  -> normalized status event
  -> browser simulator
  -> ESP32-S3 firmware later
```

浏览器端只消费统一状态，不直接保存 OpenAI Key，也不直接调用 Codex。真实接入放在后续 bridge 层中处理。

## 阶段 1：浏览器圆屏模拟器

- 建立 Vite + React + TypeScript 项目。
- 定义 Agent 状态类型、事件类型和状态机 reducer。
- 实现圆形屏幕外观，包括状态标签、进度环、表情动画和休眠态。
- 实现事件日志，方便确认状态机输入和输出。

## 阶段 2：本地 bridge

- 增加 Node.js bridge 服务。
- 对外提供 WebSocket：`ws://127.0.0.1:8787/status`。
- 输入端先支持 mock source，后续接 Codex app-server 或其他 CLI。
- 输出端保持统一 WebSocket 消息协议，由 `src/domain/statusProtocol.ts` 定义和校验。

连接建立时发送：

```json
{
  "kind": "bridge.hello",
  "source": "mock-bridge",
  "version": 1,
  "at": 1788179800000,
  "intervalMs": 1600
}
```

状态更新时发送：

```json
{
  "kind": "agent.event",
  "event": {
    "id": "...",
    "type": "reasoning.started",
    "origin": "mock",
    "at": 1788179800000,
    "label": "Thinking",
    "detail": "Mock source is reasoning"
  }
}
```

`bridge.hello.source` 表示 bridge 服务实例，`agent.event.event.origin` 表示事件真正来自 `mock` 还是 `codex`。所有 status source 先通过 `normalizeAgentEvent()` 生成标准 `AgentEvent`，再通过 `agentEventMessage()` 包装后广播。

当前 mock bridge 已提供：

- `npm run bridge:mock` 通过 `server/index.ts` 启动本地 WebSocket 服务。`server/sources/statusSource.ts` 保留为 source 合同定义。
- `ws://127.0.0.1:8787/status` 推送 `bridge.hello` 和 `agent.event`。
- `http://127.0.0.1:8787/health` 返回服务健康状态。
- 浏览器前端固定连接 bridge，不提供 URL 输入框或启停开关。

当前 Codex app-server bridge 已提供：

- `npm run bridge:codex` 通过 `server/index.ts` 启动本地 WebSocket 服务，并默认选择 `codex` source。
- `server/sources/codexSource.ts` 启动 `codex app-server --stdio`，完成 `initialize` / `initialized` 握手。
- 设置 `AGENT_INDICATOR_CODEX_PROMPT` 后，bridge 会创建临时 Codex thread 并调用 `turn/start`，再把 app-server 推送的 `turn/*`、`item/*`、`thread/status/changed` 等事件映射成统一 `AgentEvent`。
- 未设置 `AGENT_INDICATOR_CODEX_PROMPT` 时，只连接 app-server，不主动发起真实 Codex turn，避免无意消耗模型调用或改动工作区。

PowerShell 示例：

```powershell
$env:AGENT_INDICATOR_CODEX_PROMPT = "只读检查当前项目结构，并用一句话总结。不要修改文件。"
npm run bridge:codex
```

可选环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `AGENT_INDICATOR_CODEX_PROMPT` | 空 | 要发给 Codex 的真实 turn 输入。为空时不启动 turn。 |
| `AGENT_INDICATOR_CODEX_THREAD_ID` | 空 | 指定后用 `thread/resume` 续接已有 app-server thread。 |
| `AGENT_INDICATOR_CODEX_CWD` | 当前项目目录 | Codex turn 的工作目录和 runtime workspace root。 |
| `AGENT_INDICATOR_CODEX_MODEL` | Codex 配置默认值 | 可选模型覆盖。 |
| `AGENT_INDICATOR_CODEX_EFFORT` | Codex 配置默认值 | 可选 reasoning effort 覆盖。 |
| `AGENT_INDICATOR_CODEX_APPROVAL_POLICY` | `never` | app-server approval policy；支持 `never`、`on-request`、`untrusted`。 |
| `AGENT_INDICATOR_CODEX_SANDBOX` | `read-only` | 默认只读；需要真实改文件时显式改为 `workspace-write`。 |
| `AGENT_INDICATOR_CODEX_REQUEST_TIMEOUT_MS` | `30000` | JSON-RPC 请求超时时间。 |

## 阶段 3：真实 Agent 接入

- Codex 优先走 `codex app-server` 的事件流，当前第一版已接入 app-server 管理的 thread/turn；它不是无侵入监听 Codex Desktop 当前 UI 任务。
- OpenAI API 自建 agent 走 Responses API streaming events。
- 其他 agent 先看官方 hooks/event stream；没有事件流时再封装 CLI stdout。
- bridge 层负责把不同来源事件映射到统一 `AgentEvent`。当前 `server/sources/codexSource.ts` 已提供 Codex app-server notification 到 `AgentEvent` 的映射入口。

## 阶段 4：硬件接入

- 第一版建议 USB 串口，协议为 newline-delimited JSON。
- 第二版再加 Wi-Fi WebSocket 或 HTTP polling。
- ESP32 固件只保留显示逻辑、动画状态机和简单连接状态。
- 任何 token、账户认证和复杂解析都留在电脑端。

## 后续完善 / Backlog

这些项不阻塞硬件接入，放在事件链路稳定后的维护阶段处理：

- 增加 `AGENT_INDICATOR_CODEX_DEBUG_EVENTS` 调试开关：默认只打印 app-server notification/request method，必要时再支持完整 payload 输出，用于排查真实 Codex 事件流。
- 将 `.tmp` 里的临时事件采集脚本正式化：移动到 `scripts/`，并增加 npm script，作为不依赖前端 UI 的状态流验证工具。

## 状态集合

| 状态 | 用途 |
| --- | --- |
| `idle` | 空闲 |
| `thinking` | 推理、规划 |
| `editing` | 正在修改文件 |
| `running` | 正在运行命令、测试或构建 |
| `tool` | 正在调用工具 |
| `searching` | 正在搜索或读取外部信息 |
| `waiting` | 等待用户审批或输入 |
| `speaking` | 正在输出回答 |
| `done` | 当前任务完成 |
| `error` | 出错 |
| `sleepy` | 一段时间无事件，进入待机表情 |
| `sleep` | 长时间无事件，熄屏或低功耗显示 |

## 当前完成范围

已完成阶段 1、阶段 2 的 mock bridge、固定 WebSocket 协议和 source 合同，以及阶段 3 的 Codex app-server 第一版接入。ESP32 固件仍未实现。

