# Agent Indicator 开发计划

## 当前实现（2026-10-06）

目标是正常使用 terminal 中的 Codex CLI 时，M5StackChan ESP32-S3 同步显示状态。
日常入口为 `npm start`，另一终端运行 `codex`。前端只作为协议模拟器。
当前固件为 `2026.10.06-r1`，银色 motion-eyes-v5，六态加离线，工作抬头 20°。
本轮验收依据见 [2026-10-06 验收记录](fix-validation-2026-10-06.md)。

```text
交互式 Codex CLI
  → 通知 hooks → 127.0.0.1:8788/hook
  → Node bridge → ws://<电脑局域网IP>:8787/status
  → StackChan 本地动画和头部策略
  → 浏览器协议模拟器（可选）
```

状态流只保留 `bridge.hello` 和 `agent.event`。进程信息仅在电脑回环通知中使用，
不加入 WebSocket 协议，不发送给硬件。固件不接触 Codex 原始协议或账户凭据。
电脑与机器人须连接同一可互访网络；8787 对局域网开放，8788 只监听回环地址。

## 已完成

- 浏览器协议模拟器、13 个统一事件映射、bridge、mock 与 app-server 开发来源。
- 日常 CLI hooks 接入、会话和轮次隔离、并行工具、审批等待与中断映射。
- 模型/网络终止错误的本地 transcript 补充监听；错误后新 CLI 提问可接管。
- 一键启动、只读诊断、显式会话释放、脱敏事件采集与连续采样脚本。
- StackChan 配网、WebSocket 重连、独立网络任务、表情与点击调试页、20°头部策略。
- 用户已确认的 v5 尺寸、银色配色、单行书写、思考方向、等待张望、完成左眼眨眼。
- 代码样式整理：TS/JS 使用 Prettier，C++ 使用 clang-format；见 [代码样式](code-style.md)。

### 本轮完成：完成后自动恢复默认姿态（原事项 1）

收到新的实时 `turn.completed` 后，左眼眨一次并展示笑眼 **5 秒**。
其间没有新状态时，设备展示回到 idle，头部经过 350ms 稳定门槛，以 900ms 定时移动回水平。
最近真实事件仍为 done；调试页显示当前展示和最近事件，不伪造 Codex idle、不释放会话。

新工作、等待、异常、真实 idle 或断线均取消旧完成计时。
thinking/running/waiting/error 不因静默而退回 idle。最近 32 个完成 ID 去重；
同一完成不延长计时，重连的旧完成快照不重播庆祝。
设备重启后的首个旧完成通过 `event.at <= hello.at` 识别；两者使用同一 bridge 时钟。
计时使用单调 millis，并覆盖回绕边界。

### 本轮完成：CLI 意外退出恢复（原事项 2）

Windows 通知脚本沿父进程链识别交互式 CLI，附带 PID 和创建时间。
bridge 校验同一进程身份并持有 Windows 进程句柄，每 500ms 检查真实退出信号。
确认退出后清理该会话的工具/审批/子代理并发布 idle，新 CLI 可重新绑定。
PID 重用、旧进程迟到通知、会话接管、固定会话和源关闭均有回归覆盖。

已确认的 app-server/exec 等非交互客户端通知不会抢占 CLI 状态。
无法识别来源、访问被拒或非 Windows 系统不会猜测退出，诊断明确提示降级，
仍可使用 `npm run session:reset`。具体边界见 [CLI hooks](cli-hooks.md)。

### 本轮完成：开发文档整理（原事项 5）

本计划只描述当前实现和剩余工作。旧阶段规划、柔软伙伴、旧版本号、旧启动脚本和
“done 一直保持”等记录移入 [开发计划历史归档](history/development-plan-before-2026-10-06.md)。
CLI、设计规范、头部说明和固件 README 同步当前行为；日期验收文件保留当时的事实。

## 状态和显示边界

| 统一状态 | 硬件表情 | 头部 |
| --- | --- | --- |
| idle、sleepy、sleep | 空闲 | 水平 |
| thinking、searching、speaking | 思考 | 抬头 20° |
| running、editing、tool | 执行 | 抬头 20° |
| waiting | 等待 | 保持已有目标 |
| done | 完成 5 秒后展示 idle | 完成停留时保持；收尾回平 |
| error | 深红 xx，保持到新状态 | 保持已有目标 |
| 连接离线 | 灰色插头眼、插座眼和心电图嘴巴 | 水平 |

离线是连接覆盖状态；不增加 Agent 事件类型。CLI hooks 未提供的细分状态不伪造。
Stop 表示响应停止，不保证任务成功；终止错误补充监听可以更正同一轮次的完成。

## 剩余待办

- [ ] 有效的 12 小时连续采样（原事项 4）：须保留最终 summary、实际时长及维护窗口，
  旧 720 分钟配置但无完整 summary 的采样不算通过。
- [ ] 专项实机验收（原事项 3）：路由器/Wi-Fi 中断、真实审批拒绝、舵机通信/机械故障。
  设备断电恢复、模拟消息和纯策略测试不能替代这些场景。
- [ ] 更广的真实 CLI 场景：上下文压缩、图像操作、子代理事件；已有映射/单元测试，
  不把它们描述成全部完成真实模型与硬件验收。

不恢复前端 mock/Auto Play/Speed/URL 输入/启停 stream，不新增 legacy app-server 分支。
当前不需要新增硬件表情状态。

## 开发与验证入口

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动或复用日常 CLI bridge |
| `npm run doctor` | 只读诊断服务、连接及监听器 |
| `npm run session:reset` | 显式释放当前绑定，保留固定会话配置 |
| `npm test` | Node/状态映射/HTTP/进程恢复回归 |
| `npm run build` | TypeScript 检查与生产构建 |
| `npm run test:contract` | 校验本机 Codex app-server 官方 schema |
| `npm run format` | 整理 TS/JS 和当前设计预览的样式 |
| `npm run events:capture -- 60` | 脱敏采集状态流 60 秒 |
| `npm run stability -- --minutes 720` | 只读连续采样 12 小时 |
| `npm run dev:mock` / `dev:app-server` | 隔离开发来源；与日常 bridge 使用同端口时须先停止旧服务 |

固件构建、logic-test 与烧录见 [固件 README](../firmware/stackchan/README.md)；
动画几何见 [设计规范](design/expression-design.md)，头部限位与串口命令见 [头部说明](head-motion.md)。
硬件烧录/服务维护期间不计入连续稳定运行证据。
