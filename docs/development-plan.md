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
- 输入端先支持假事件文件，后续接 Codex app-server 或其他 CLI。
- 输出端保持统一 JSON：

```json
{
  "state": "thinking",
  "label": "Thinking",
  "detail": "Reasoning about code changes",
  "at": 1788179800000
}
```

当前 mock bridge 已提供：

- `npm run bridge:mock` 启动本地 WebSocket 服务。
- `ws://127.0.0.1:8787/status` 推送 `bridge.hello` 和 `agent.event`。
- `http://127.0.0.1:8787/health` 返回服务健康状态。
- 浏览器前端固定连接 bridge，不提供 URL 输入框或启停开关。

## 阶段 3：真实 Agent 接入

- Codex 优先走 `codex app-server` 的事件流。
- OpenAI API 自建 agent 走 Responses API streaming events。
- 其他 agent 先看官方 hooks/event stream；没有事件流时再封装 CLI stdout。
- bridge 层负责把不同来源事件映射到统一状态。

## 阶段 4：硬件接入

- 第一版建议 USB 串口，协议为 newline-delimited JSON。
- 第二版再加 Wi-Fi WebSocket 或 HTTP polling。
- ESP32 固件只保留显示逻辑、动画状态机和简单连接状态。
- 任何 token、账户认证和复杂解析都留在电脑端。

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

本次先完成阶段 1，不接真实 Codex，也不写 ESP32 固件。这样能先把产品形态、状态命名和动画节奏定下来。
