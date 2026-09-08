# Agent Indicator 开发计划

## 当前状态（2026-09-09）

日常入口为 `npm start`＋普通 Codex CLI；设备为已购买的 M5StackChan ESP32-S3。当前固件 `2026.09.08-r1`，银色 motion-eyes-v5，空闲水平、工作抬头 20°。已完成本轮状态、错误监听、舵机修复与烧录；具体覆盖和剩余边界以 [修复验收记录](fix-validation-2026-09-09.md) 为准。下方带日期或旧版本的条目属于历史过程，不能代替当前验收结论。

自动化入口：`npm test`（54 项），`npm run test:contract`（本机 Codex 协议契约），PlatformIO `logic-test`（ESP32 上 120 条断言）。debug event 开关与脱敏事件采集已实现：`AGENT_INDICATOR_DEBUG_EVENTS=1`、`npm run events:capture -- 60`。12 小时有效连续采样、路由器断网和机械故障注入仍需单独验收。

## 目标

先用浏览器完成圆屏模拟器和 Agent 状态机，再把同一套状态协议接到已购买并确认的 M5StackChan AI Desktop Robot（ESP32-S3）硬件。前端只作为模拟器消费 bridge 推送的统一事件，不再继续打磨表情/UI，不提供本地 mock、手动状态切换或关闭 stream 的入口。

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

表情设计已定稿为「柔软伙伴」第二轮，详见 [表情设计规范](design/expression-design.md) 与 [视觉参考](design/stackchan-soft-companion-v2.html)。后续硬件表情统一沿用该语言：空闲无腮红、异常 xx、等待圆眼圆嘴、完成笑眼腮红，思考与执行采用不同的眼形和动作节奏。默认表情页隐藏调试文字，点击切换信息页。

- 已确认设备为 M5StackChan AI Desktop Robot（ESP32-S3），USB 端口 COM3，实测 16MB Flash。首轮屏幕 demo 位于 `firmware/stackchan/`。
- USB 用于烧录和串口日志；状态链路直接使用 Wi-Fi WebSocket，连接 `ws://<电脑局域网IP>:8787/status`。
- 先跑对应设备的官方屏幕 demo，再接 Wi-Fi/WebSocket client，最后按 `src/domain/agentStatus.ts` 中的映射将 `AgentEvent.type` 显示为文字和颜色。
- 硬件只消费既有 `bridge.hello`（协议版本 1）和 `agent.event`，不增加串口专用状态协议。
- ESP32 固件负责显示和连接状态，支持断线重连；断线时显示连接中/离线，不将断线误报为 Agent 出错。
- 任何 token、账户认证和复杂解析都留在电脑端。

局域网联调时，bridge 必须监听可被设备访问的地址；当前代码默认只监听 `127.0.0.1`。PowerShell 示例：

```powershell
$env:AGENT_INDICATOR_HOST = "0.0.0.0"
npm run bridge:mock
```

电脑和设备连接同一可互访局域网，设备填写电脑的局域网 IP（不能填写 `127.0.0.1` 或 `0.0.0.0`）。如 Windows 防火墙阻止连接，为专用网络放行 bridge 的 TCP 8787 端口。先用现有 mock source 验证硬件事件显示，再切换 `bridge:codex` 验证真实事件。

## 后续完善 / Backlog

稳定性验收已继续推进，详见 [验收记录](stability-validation.md)：真实 CLI 审批等待已获硬件目视确认；设备关机再开机自动恢复已确认；复现 CLI 意外退出残留后新增 `npm run session:reset` 显式恢复。bridge 增加主动心跳清理与关闭期限，新增连续采样命令。当前 32 项测试与构建通过；12 小时运行、路由器断网和自动发现 CLI 退出仍待完成。

已新增 `npm start` 一键启动与 `npm run doctor` 只读诊断。覆盖端口有效性及冲突检查、现有 CLI bridge 复用、hooks 配置提示、候选局域网地址和客户端数量变化。详细使用方法与诊断边界见 [CLI hooks 接入](cli-hooks.md)。物理断网、真实审批、CLI 意外退出的自动恢复与半天到一天稳定性测试仍待验证。

2026-09-07 验证：29 项自动化测试通过，TypeScript 检查和生产构建通过。已用 `npm start` 替换旧的前台 bridge，观察客户端数量从 0 恢复为 1；`npm run doctor` 正常。未修改硬件固件。

日常交互式 CLI 接入已增加 `codex-hooks` source：使用 `npm run bridge:cli` 和普通 `codex`，无需测试 prompt。具体安装、会话绑定和限制见 [CLI hooks 接入](cli-hooks.md)。已完成真实 CLI 多轮命令、文件修改、中断、退出及硬件目视验收。真实审批与长期运行仍待验证。

事件诊断维护项（2026-09-09 已完成）：

- 已实现 `AGENT_INDICATOR_DEBUG_EVENTS=1`，统一控制 hooks 与 app-server 的逐事件诊断；默认关闭，不输出完整 payload。
- 已实现 `scripts/capture-status-events.mjs` 与 `npm run events:capture -- 60`，脱敏采集统一状态流，供无前端验收使用。

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

当前表情实现已迁移至 `motion-eyes-v3`：用户确认的视频参考六态动态替代柔软伙伴。正式规范见 [动态表情设计](design/expression-design.md)，预览见 [六态动画](design/video-motion-study.html)。包括左右上看与镜像思绪点、单行书写和视线跟随、等待左右张望、完成左眼单独眨眼后保持笑眼。原始事件协议保留，显示端将细分状态归入六态；历史造型和验证记录以下方日期记录保留。

motion-eyes-v3 固件编译、COM3 烧录与写入哈希校验通过，固件 1,061,680 字节。六态模拟演示已完成，串口采样位于 `.tmp/motion-v3-serial.log`。用户反馈仍有细节需要调整，尚未记为最终视觉验收通过。

2026-09-07 done 显示修复：用户反馈调试状态为 done，表情却显示 idle。定位为固件的 3 秒本地造型替换规则，现已移除；done 持续显示笑眼、笑嘴与腮红，直到收到新状态。正式设计规范和固件 README 已同步更新，取代下方历史记录中的定时放松行为。修复固件 1,059,696 字节，COM3 编译烧录及哈希校验通过。

2026-09-07 柔软伙伴定稿与固件更新：

- 用户接受第二轮设计，正式规范已写入 `docs/design/expression-design.md`，后续表情按此扩展。
- `face_renderer.h` 已采用暖白小眼睛与简洁嘴形，空闲无腮红，异常 xx；等待与完成保留选定稿，思考采用侧看与停顿，执行采用专注眼形和三点节奏。默认表情页仅保留连接点，点击查看调试文字。
- 新固件编译通过，1,059,712 字节，经 COM3 烧录并通过哈希校验。完成表情现保持约 3 秒后放松，取代首版的 4 秒；真实 done 不变。
- 12 种模拟状态与点击切页串口验证通过，日志位于本地 `.tmp/soft-companion-v2-serial.log`；用户确认新表情和点击切换均正常。演示已退出，CLI bridge 已恢复，健康检查 `source=codex-cli-hooks`、`clients=1`，重新收到真实 codex 事件。

2026-09-07 表情显示进展：

- StackChan 默认显示本地动态表情：状态驱动眼睛、眉毛、嘴形和提示符，支持眨眼和平滑过渡；轻点屏幕切换原有调试信息页。
- done 开心约 4 秒后放松，但保留真实 done 状态；断线显示离线表情，不误报 Agent error。
- 固件编译、COM3 烧录和写入校验通过。模拟状态序列覆盖 12 种状态；串口确认表情切换和触摸切页，用户确认表情与点击切换正常。
- 演示结束已恢复 codex-cli-hooks bridge，设备自动重连，健康检查 clients=1。模拟等待表情不代表真实 CLI approval 已验证。

已完成阶段 1、阶段 2 的 mock bridge、固定 WebSocket 协议和 source 合同，以及阶段 3 的 Codex app-server 第一版接入。

2026-09-06 硬件进展：

- 完成原设备 16MB Flash 备份；StackChan 屏幕 demo 已编译、烧录并通过写入校验。串口连续报告 `board=27`（StackChan）、`display=320x240` 与递增 uptime；用户已确认标题、RGB 色块与运行秒数正常。
- `firmware/stackchan/` 已增加并烧录 `status-client`：Wi-Fi、WebSocket、协议版本校验、13 种事件映射、连接状态显示与重连。已逐项核对映射和颜色与 TypeScript 定义一致。
- 用户已填写 Git 忽略的 `include/config.local.h`；重新烧录并通过写入校验，设备成功接入 Wi-Fi，获得 IP `192.168.3.44`。
- 电脑 `192.168.3.30:8787` 的 mock bridge 与设备完成版本 1 握手；硬件收到模拟事件并映射为对应状态。停止 mock bridge 后，串口报告断开并重试；启动 Codex bridge 后，设备自动重新握手并恢复收事件。
- 真实 Codex 只读任务已完成：通过 app-server 执行读取 `package.json` 的任务，硬件串口收到 `origin=codex` 的 thinking、running、speaking、idle、done；健康检查显示 `source=codex-app-server`、`clients=1`、最新事件 `turn.completed`。用户已确认实屏显示 Connected、done、Source codex。
- 首轮硬件 bring-up 已通过。真实 approval 等待、Wi-Fi 接入点中断恢复、长时间稳定性与其他硬件状态覆盖仍需后续验证。本次成功不意味着已接入 Codex Desktop 当前 UI 任务的无侵入监听。


2026-09-07：用户确认放大与灵动版本 `motion-eyes-v4`，替代 v3 为当前设计基准。眼睛放大约 30%，思考加强上看、非对称眼形与停顿回看；执行共用笔尖路径驱动视线，笔放大 15%。预览见 [v4](design/video-motion-review-v4.html)。

2026-09-07：用户确认 motion-eyes-v5 为正式设计：眼睛在 v4 基础上再大 20%，思考气泡外移上移；离线为插头眼、插座眼与扫描心电图嘴巴。正式规范与预览已同步。
