# Agent Indicator

正常使用终端里的 Codex CLI，让 M5StackChan ESP32-S3 同步显示工作状态，并在工作时抬头。

电脑端通过 CLI hooks 接收真实生命周期事件，由 Node bridge 转换为统一 WebSocket 协议；
机器人通过 Wi-Fi 接收事件，在本地绘制动画并控制头部。浏览器是可选的协议模拟器，
日常使用不需要打开网页，也不需要由 bridge 另行提交测试 prompt。

## 当前实现

截至 2026-10-06，正式固件为 `2026.10.06-r1`，目标硬件为 M5StackChan ESP32-S3。

- 银色 motion-eyes-v5：空闲、思考、执行、等待、完成、异常，以及连接离线表现。
- 空闲时头部水平，工作时抬头约 20°；等待和异常保持已有头部目标。
- 新的实时完成展示 5 秒后恢复空闲姿态；新活动可立即打断收尾。
- 点击屏幕可切换表情页和调试页；断线显示离线动画并自动重连。
- CLI 会话隔离、并行工具与审批等待映射、终止错误补充监听，以及 Windows CLI 退出恢复。
- 本地诊断、显式会话释放、脱敏事件采集和连续采样。

```text
交互式 Codex CLI
  → 生命周期 hooks / 本地终止错误补充监听
  → Node bridge
  → WebSocket：bridge.hello + agent.event
  → StackChan：本地动画 + 头部姿态
  → 浏览器协议模拟器（可选）
```

## 快速开始

电脑端当前以 Windows / PowerShell 为验收环境，本机使用 Node.js 24.13.0、npm 11.6.2。
需要已安装并可正常运行的 Codex CLI，且该版本支持项目使用的 hooks。
机器人与电脑须处于可互访的局域网，机器人接入 2.4GHz Wi-Fi。

### 1. 安装依赖和通知 hooks

在项目根目录执行；以下路径是本机示例，可替换为实际检出目录：

```powershell
cd E:\AgentIndicator
npm ci
npm run hooks:install
```

默认将通知定义合并到本项目的 `.codex/hooks.json`，保留其他处理器，并在内容变化时备份。
随后在本项目目录启动 Codex CLI，通过 `/hooks` 审核并信任通知定义。
配置文件存在不代表 CLI 已信任它。

如果希望在其他项目中使用 Codex 时也同步机器人，改用用户级安装。
若已经执行过上面的项目级安装，先移除本项目这一份，避免重复通知：

```powershell
npm run hooks:install -- --uninstall
npm run hooks:install -- --global
```

用户级定义写入 `CODEX_HOME` 下的 `hooks.json`，未指定时使用用户目录的 `.codex`。
同样需要在 CLI 中审核信任。移动本仓库或更换 Node 路径后，检查旧定义并重新安装。
完整接入说明见 [CLI hooks](docs/cli-hooks.md)。

### 2. 启动电脑端

终端一：

```powershell
cd E:\AgentIndicator
npm start
```

终端二：进入已安装并信任 hooks 的项目，然后正常运行：

```powershell
codex
```

`npm start` 固定使用 `codex-hooks` 来源，检查端口、hooks 配置和候选局域网地址。
新启动的服务需要保持终端运行；若已有健康的日常 bridge，则复用该服务并退出启动器。
被其他来源或程序占用的端口会报错，不会自动结束占用者。

### 3. 连接机器人

已经配置并烧录的设备直接开机即可。新设备的配网、构建、烧录和串口验证见
[固件 README](firmware/stackchan/README.md)。

机器人连接：

```text
ws://<电脑局域网IPv4>:8787/status
```

固件配置位于本地 `firmware/stackchan/include/config.local.h`，以
`config.example.h` 为模板，仅在文件不存在时创建。`BRIDGE_HOST` 填电脑局域网 IP，
不含 `ws://` 或 `/status`；不能填 `127.0.0.1` 或 `0.0.0.0`。
`USE_SAVED_WIFI=true` 优先复用设备保存的 Wi-Fi；没有保存配置时，在本地填写凭据并设为 `false`。
本地配置、Flash 备份和固件二进制可能包含配网信息，不应提交或上传。

新设备还需人工校准水平位置；本机的舵机基准不能直接用于其他设备。
无有效校准时固件不会自动运动。操作见 [头部姿态说明](docs/head-motion.md)。

## 硬件状态

统一协议的细分状态在硬件上合并为六种工作表情；离线是连接状态覆盖。

| 表现 | 对应状态                            | 动画与头部                                               |
| ---- | ----------------------------------- | -------------------------------------------------------- |
| 空闲 | `idle`、`sleepy`、`sleep`           | 银色胶囊眼，偶尔侧看和眨眼；头部水平                     |
| 思考 | `thinking`、`searching`、`speaking` | 交替看向左右上方，配镜像思绪点；抬头约 20°               |
| 执行 | `running`、`editing`、`tool`        | 单行书写，银色笔迹，视线跟随，抬眼回正后重写；抬头约 20° |
| 等待 | `waiting`                           | 琥珀眼左右张望、呼吸点；保持已有头部目标                 |
| 完成 | `done`                              | 左眼眨一次、笑眼停留 5 秒，然后展示空闲并回平            |
| 异常 | `error`                             | 深红 `xx`，轻摇一次后保持；保持已有头部目标              |
| 离线 | 连接失效                            | 灰色插头眼、插座眼和心电图嘴巴；头部回平                 |

完成收尾仅改变设备展示：bridge 最近真实事件仍是 `done`，CLI 会话仍保持绑定。
调试页分别显示当前展示与最近真实事件。重复完成不会延长停留，重连收到的旧完成快照不重播庆祝。
工作、等待和异常没有“静默一段时间自动空闲”的规则。

`Stop` 表示本轮响应停止，不保证任务成功；同轮显式终止错误可将完成更正为异常。
本来源不会伪造 hooks 没有提供的细分状态。表情规范见
[设计方案](docs/design/expression-design.md)。

## 配置与协议

日常入口使用以下环境变量，通常保持默认即可：

| 变量                              | 默认值    | 用途                                 |
| --------------------------------- | --------- | ------------------------------------ |
| `AGENT_INDICATOR_HOST`            | `0.0.0.0` | 日常 bridge 监听地址                 |
| `AGENT_INDICATOR_PORT`            | `8787`    | WebSocket 和 bridge 健康检查端口     |
| `AGENT_INDICATOR_HOOK_PORT`       | `8788`    | 仅监听 `127.0.0.1` 的 hooks 接收端口 |
| `AGENT_INDICATOR_HOOK_SESSION_ID` | 未设置    | 可选，固定接收指定 CLI 会话          |
| `AGENT_INDICATOR_DEBUG_EVENTS`    | 未启用    | 设置为 `1` 输出脱敏事件诊断          |

两个端口必须不同。更改 hooks 端口时，运行 bridge 和 Codex 的两个终端都需设置相同值；
更改状态端口或电脑 IP 时，还需同步固件配置。
服务面向可信局域网使用，电脑防火墙需允许机器人访问状态端口；hooks 端口无需对局域网开放。

WebSocket 协议版本为 `1`，只包含两种消息：

```json
{ "kind": "bridge.hello", "source": "codex-cli-hooks", "version": 1, "at": 1791244800000 }
```

```json
{
  "kind": "agent.event",
  "event": { "id": "example-1", "type": "turn.started", "at": 1791244801000, "origin": "codex" }
}
```

`at` 为 Unix 毫秒时间。事件类型和结构以
[agentStatus.ts](src/domain/agentStatus.ts)、[statusProtocol.ts](src/domain/statusProtocol.ts)
为准；硬件只理解统一事件，无需解析 Codex 原始协议。

日常 hooks 通知不发送提示词、命令正文、输出、文件内容或进程命令行。
终止错误补充监听在电脑本地读取绑定会话的 transcript，接受显式整轮终止错误。
它是版本适配，并非稳定公共协议；升级 Codex 后需重新核对。

## 诊断与恢复

```powershell
npm run doctor
```

诊断显示服务来源、候选 IP、WebSocket 客户端数、最近事件、会话绑定以及错误/进程监听状态。
客户端数量包含浏览器，不能单凭数量确认机器人已绘制表情。

| 现象                              | 排查方式                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| 机器人显示离线                    | 检查 Wi-Fi、电脑 IP、bridge 是否运行以及防火墙；设备会自动重连    |
| 已连接，但 CLI 没有带来状态变化   | 检查 hooks 安装范围、CLI 的 `/hooks` 信任以及是否被另一个会话绑定 |
| bridge 启动提示端口占用           | 在原终端停止旧 mock/app-server 或其他占用服务，再启动日常入口     |
| CLI 意外退出后状态未恢复          | 查看 `cliObserver` 是否降级，必要时显式释放会话                   |
| 调试页最近事件为 done，表情已空闲 | 这是完成后的正常收尾行为                                          |

显式释放当前绑定：

```powershell
npm run session:reset
```

该命令不停止用户 CLI，固定会话配置仍保留。释放后在目标 CLI 输入新任务即可重新绑定。
自动进程退出检测目前仅支持 Windows；无法验证进程身份或权限不足时保持绑定，由诊断提示降级。

脱敏采集统一事件 60 秒，结果写入 `.tmp/events/`：

```powershell
npm run events:capture -- 60
```

只读连续采样 12 小时，结果写入 `.tmp/stability/`：

```powershell
npm run stability -- --minutes 720
```

采样期间电脑保持唤醒，bridge 和机器人保持运行。验收需检查最终 summary、
实际时长、服务失败及零客户端记录；指定 720 分钟或退出码为 0 本身不代表通过。
烧录和服务维护窗口应单独记录，不计为连续稳定运行证据。

## 开发与验证

| 命令                     | 用途                                              |
| ------------------------ | ------------------------------------------------- |
| `npm test`               | 状态映射、HTTP、会话、脚本和 Windows 进程恢复回归 |
| `npm run build`          | TypeScript 检查和 Vite 生产构建                   |
| `npm run test:contract`  | 校验本机 Codex app-server schema 契约             |
| `npm run format`         | 按约定整理 TS/JS 和当前 HTML 设计预览             |
| `npm run dev`            | 启动可选的浏览器协议模拟器，以终端打印地址为准    |
| `npm run preview`        | 预览已构建的浏览器模拟器                          |
| `npm run dev:mock`       | 启动 mock bridge，自动产生模拟事件                |
| `npm run dev:app-server` | 启动独立 `codex app-server --stdio` 开发来源      |

mock/app-server 与日常 bridge 共用默认状态端口，切换前需停止旧服务。
app-server 来源用于接入开发，通过 `AGENT_INDICATOR_CODEX_PROMPT` 配置独立测试任务，
不会监听另一个终端里的 CLI。浏览器固定消费 `ws://127.0.0.1:8787/status`，仅供电脑本地使用；
其显示样式和状态保持规则不代替固件验收。

2026-10-06 回归结果：84 项 Node 测试通过，项目构建、协议契约和三个固件环境编译通过。
ESP32 纯逻辑测试实机运行 183 条断言、0 失败；正式固件已恢复，完成收尾和头部运动已做受控事件验证。
具体证据和验收边界见 [本轮验收记录](docs/fix-validation-2026-10-06.md)。
代码约定与工具配置见 [代码样式](docs/code-style.md)；固件编译、测试和烧录见
[固件 README](firmware/stackchan/README.md)。

## 目录与后续工作

```text
server/                 bridge、状态来源、事件映射与回归测试
shared/                 hooks 注册表、Windows 进程适配器
scripts/                启动、安装、诊断、采集和设备工具
src/                    浏览器模拟器、统一状态与协议定义
firmware/stackchan/      ESP32 固件、动画、展示策略与头部控制
docs/                   接入说明、设计规范、计划与验收记录
docs/history/           历史方案和阶段文档
```

尚未完成的验收：有效的 12 小时连续采样、Wi-Fi/路由器中断、真实审批拒绝、
舵机故障保护，以及上下文压缩、图像操作和子代理的更广真实 CLI 场景。
已有单元测试和受控回放不能替代这些验收；目前无需新增硬件表情状态。
最新进展以 [开发计划](docs/development-plan.md) 为准，历史记录保留各自日期的结论。
