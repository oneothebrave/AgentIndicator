# Agent Indicator 代码审查 · 2026-09-08

**后续状态：** 本文保留修复前的审查证据；2026-09-09 已按用户指令实施修复和固件烧录，当前结果与仍有的来源限制见 [修复验收记录](fix-validation-2026-09-09.md)。下文“待修复”描述的是审查时状态。

结论：需要局部重构，测试尚未补齐。主要问题是状态语义与生命周期边界，不需要重做表情或更换硬件协议。继续保留空闲、思考、执行、等待、完成、异常六态，以及独立的离线显示。

本次检查覆盖 Node bridge、两种 Codex source、hooks 安装与启动脚本、统一协议、ESP32 网络与显示、头部控制、测试和开发文档。未修改运行逻辑，未烧录或操作舵机。以下区分协议输入复现、代码路径分析与待验证假设。

## 1. 已执行的验证

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| `npm test` | 36 项通过 | 当前已有断言通过 |
| `npm run build` | TypeScript 检查、Vite 构建通过 | TS 类型与构建可用 |
| PlatformIO `status-client` 编译 | 通过；RAM 52,408 字节，程序 1,081,573 字节 | 固件可编译；不代表运动和断网行为通过 |
| `codex --version` | 0.153.4 | 本机适配基准 |
| `codex app-server generate-ts --out .tmp/review-schema` | 成功 | 直接核对本机安装版本的协议结构 |
| 定向复现探针 | 8 条：1 条阳性对照通过，7 条预期断言失败 | 其中 5 条是协议/文件解析复现，2 条是人工构造的事件顺序边界；不能等同于 7 个独立线上故障 |

复现脚本位于本地 [.tmp/review-regressions.test.ts](../.tmp/review-regressions.test.ts)，运行：`node --import tsx --test .tmp/review-regressions.test.ts`。它没有加入正式测试命令；修复时应将适用案例整理成正式回归测试。脚本使用内存 publisher 和临时文件，不向真实 bridge 注入事件。

## 2. 应先修复的问题

### P1：CLI 审批恢复后可能一直显示 waiting

位置：[hooks/events.ts](../server/sources/hooks/events.ts)，第 116–125 行。

`PermissionRequest` 没有 `tool_use_id` 时，代码把等待项存为 `event:<id>`；`PostToolUse` 只删除 `tool:<id>`。因此即使审批已处理、工具已经结束，后续 `busy()` 仍然优先输出 waiting，直到 Stop、Interrupt 或下一轮清理。

现有测试 `approval without an invocation ID is retained until the turn closes` 明确固定了这个降级行为。它验证了“不会被无关工具误清除”，没有解决“真实审批结束后恢复工作”。官方 hooks 对审批事件中的调用 ID 有缺失情形，不能假定该字段总存在。[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)

修复应采用可靠的审批与调用关联或明确的恢复信号；保留并行审批保护。不能仅凭同名工具完成就清空所有等待。需要用脱敏的真实审批完整序列验证“等待→审批处理→工具运行/完成→思考”，覆盖允许、拒绝和中断。

### P1：app-server 失败结束被映射为 done，测试数据也写错了

位置：[codex/events.ts](../server/sources/codex/events.ts)，第 229–255 行；[codex/events.test.ts](../server/sources/codex/events.test.ts)，第 35–54 行。

本机生成的 `TurnStatus` 是字符串联合：`completed | interrupted | failed | inProgress`。实现却读取 `turn.status.type`，测试也传入 `{ status: { type: "failed" } }`。

已经复现：合法的 `{ turn: { status: "failed", error: { message: "..." } } }` 得到 `turn.completed`。真实的 `interrupted` 同样得到 done。即使单独的 error 通知先显示异常，随后该完成通知仍可能把它覆盖成完成。

应按本机官方 schema 修正结构，失败映射 error，中断与 CLI 的 Interrupt 保持一致映射 idle。不要保留错误结构作为兼容分支。测试 fixture 应受生成的类型或明确的契约校验约束；未知/缺失的结束状态不能默认宣告成功。

证据：[生成的 TurnStatus](../.tmp/review-schema/v2/TurnStatus.ts)。本项影响 `codex app-server` source，与日常 hooks 路径是不同入口。

### P1：app-server 的等待与重试语义丢失

位置：[codex/events.ts](../server/sources/codex/events.ts)，第 110–115、197–207 行。

两条输入复现：

- `status: { type: "active", activeFlags: ["waitingOnApproval"] }` 被映射成 thinking，而非 waiting。`waitingOnUserInput` 也走同一错误路径。
- `error` 通知中的 `willRetry: true` 被直接映射成 `turn.failed`，把可重试的传输问题显示为最终异常。

应让 active flags 参与状态决策，且让待解决的审批/输入优先于一般 reasoning/delta；可重试错误保留工作状态，重试情况放诊断信息。最终失败才进入 error。依据是本机生成的 [ThreadStatus](../.tmp/review-schema/v2/ThreadStatus.ts)、[ThreadActiveFlag](../.tmp/review-schema/v2/ThreadActiveFlag.ts)、[ErrorNotification](../.tmp/review-schema/v2/ErrorNotification.ts)。

此外，`item/completed` 的工具失败目前也输出 `turn.failed`（第 333–345 行）。工具失败可能被模型处理后继续工作，需与整轮失败分开，增加“工具失败→模型继续→最终成功/失败”的序列测试。

### P2：CLI 终止错误监视器会漏掉长记录

位置：[terminalFailure.ts](../server/sources/hooks/terminalFailure.ts)，第 30–45 行。

监视器只读文件末尾 64 KiB，并丢弃开头的不完整行。若 `task_complete` 单条 JSONL 记录超过 64 KiB，整条终止错误会被丢掉。已用同形短记录作阳性对照：短记录成功触发错误；同一记录加入 70,000 字符的 `last_agent_message` 后漏报。如果没有其他结束事件，界面会继续保留工作表情。

建议按文件游标增量读入，保留跨读取边界的完整记录；设置合理的记录上限，并在无法解析时提供诊断。补齐首次绑定已有文件、分段写入、长记录、文件替换/消失、切换会话和关闭 watcher 的测试。

目前文件路径找到后始终缓存，读取异常全部吞掉。文件移动后也缺少重新定位与观察能力降级提示。此时 HTTP 服务正常并不代表终止错误检测正常。不要从日志缺失或安静时间推断 error。

该适配器依赖 CLI transcript，官方明确它不是稳定 API，必须保留版本约束和契约探针。[官方 hooks/transcript 说明](https://learn.chatgpt.com/docs/hooks)

### P2：舵机停用后在相同姿态重新启用，可能仍无扭矩

位置：[head_motion.h](../firmware/stackchan/include/head_motion.h)，第 20、58–59 行。

代码路径：已经到达某目标 → 串口 `x` 关闭扭矩，但保留 `target` → `e` 恢复自动控制 → 状态要求同一目标 → `move()` 因 `pos == target` 提前返回，永远跳过 `EnableTorque(2, 1)`。直到目标发生变化才可能恢复。

应分别管理“目标位置”与“扭矩是否启用”，对同目标恢复进行显式处理。也需考虑松力后头部被移动的情况，不能用旧 target 代替实际位置。本项来自确定的代码路径分析，本次未在硬件执行 `x/e`。

同文件的 ReadPos/WritePos/EnableTorque 失败没有重试间隔或失败上限。达到 350ms 状态稳定门槛后，每次显示循环都会再次尝试。舵机通信位于 UI loop，故障时可能拖慢动画。应增加有限重试、退避和可观察故障状态；具体帧率影响仍需故障注入验证。

## 3. 生命周期边界：需要明确规则并补验证

以下为人工构造输入或设计限制，未证明它们已在当前真实 CLI 流程中发生，不能直接当成已确认的线上原因。

1. **Stop 与终止错误的到达顺序。** `failTurn()` 拒绝所有已关闭 turn。构造 Stop → 同轮明确 terminal error，错误纠正失败；现有测试仅覆盖 error → Stop。需要先采集真实顺序，再决定是否允许“仍是当前轮、尚无新轮”的明确失败修正完成，同时阻止旧轮污染新轮。
2. **未见过的旧 UserPromptSubmit 迟到。** 同会话下，任何不同 turn 的 prompt 都会关闭当前轮并接管。人工倒序投递可让状态回退，且当前数据没有可靠顺序字段可用于区分。应查清 hook 投递顺序保证；若需支持乱序，增加有来源依据的排序/绑定策略，不能仅凭测试中的 `old/new` 名称判断。
3. **CLI 异常退出后会话绑定。** 目前已覆盖显式 terminal failure 后的新 CLI 接管；没有收到 SessionEnd、也没有明确失败的进程消失仍依赖 `session:reset`。单会话所有权本身是既定设计。需要明确如何选择新 CLI、如何避免 Desktop 或另一终端抢占，以及能可靠观察哪些退出信号，不能用“最近有活动”任意换会话。
4. **app-server 状态聚合。** 目前主要是逐通知即时映射，没有与 hooks 等价的活动工具集合、待审批集合、终态保护。应补并行工具完成、审批期间其他输出、结束后迟到 delta 等序列测试，再引入最小必要状态。

## 4. 测试是否写完

没有。已有测试对 hooks 去重、会话隔离、并行工具、审批保留、失败后新会话接管、发送器超时、启动器和 WebSocket 心跳有价值；欠缺的是实际协议契约、完整时序与硬件控制策略。

| 优先级 | 必补测试 | 当前缺口 |
| --- | --- | --- |
| P1 | 使用真实 schema 的完成/失败/中断、active flags、willRetry | 完成 fixture 错误；其余关键字段未断言 |
| P1 | 真实审批允许/拒绝后的恢复，以及多个相同工具并行审批 | 只证明等待能保持；无 ID 恢复未完成 |
| P1 | 新会话、迟到事件、终态顺序的完整轨迹 | 目前只覆盖部分方向和显式失败接管 |
| P2 | watcher 文件与定时轮询集成测试 | 正式用例测试纯解析函数，未覆盖实际尾读逻辑 |
| P2 | 13 个 AgentEvent 在 TS 与固件的映射一致性 | 两份表手工维护，无自动契约检查 |
| P2 | 固件协议解析：握手版本、坏包/超长包、未知事件、重连快照 | 无正式固件自动测试 |
| P2 | 头部策略：水平、工作 +20°、等待/完成/异常保持、离线回平、350ms 稳定门槛、x/e、校准与通信失败 | 当前仅编译和历史人工正常路径验收 |
| P2 | 动画关键时间点：单眼眨眼、单行清除、眼笔同步、离线 ECG 连续性 | 预览检查与实屏验收尚未形成可重复回归 |

固件测试先抽出纯姿态/时间计算及带假驱动的头部策略，用可控时钟验证边界。网络重连与舵机通信放到少量实机集成验收；不必给每个绘图 API 写镜像测试。`npm test` 也应有清晰的服务端与固件测试入口说明，避免误以为其覆盖 ESP32。

## 5. 是否需要映射其他状态

需要补充事件覆盖，但目前不需要新增表情。建议如下：

| 来源/情形 | 建议显示 | 实现边界 |
| --- | --- | --- |
| 等待审批、等待用户输入 | waiting | app-server 读取 activeFlags；hooks 保留可靠关联与恢复 |
| 最终失败 | error | 尊重终止语义，区别工具失败和重试 |
| 可重试网络错误 | 保留工作状态 | 重试信息只进诊断；不冒充最终异常 |
| 用户中断/取消 | idle | 两种 source 一致，不触发完成眨眼 |
| 上下文压缩 | thinking | hooks 已处理 PreCompact/PostCompact；补 app-server contextCompaction |
| 子任务执行 | running | 可接 SubagentStart/SubagentStop，并聚合父轮；子任务结束不能直接让父任务 done |
| 图片生成、查看图片等实际工具活动 | running | app-server 对本机 schema 中 imageGeneration/imageView 做适配；可先用 tool.started |
| 搜索、输出文本 | 保留现有 thinking 别名 | 不增加表情分支 |
| Wi-Fi/WS 断开或握手失败 | offline | 继续作为设备连接层状态，不与模型 error 混淆 |
| idle、sleepy、sleep | idle 表情 | 保留协议兼容，不新增低价值表情 |

本机生成的 `ThreadItem` 还包含 `subAgentActivity`、`sleep` 等条目。不能因名字含 sleep 就映射成“空闲入睡”：需要先核对其具体生命周期。新增未知事件计数/脱敏采集有助于按实际出现频率补适配。

当前 hooks 注册列表没有 SubagentStart/SubagentStop。官方说明这两类事件使用父 session，并带子代理标识，因此要按子代理身份做活动计数。[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)

硬件继续消费 `bridge.hello` 与 `agent.event`；上述补充多数可落到现有 AgentEvent，不应让 ESP32 理解 Codex 原始对象，也不引入 legacy approval 方法。

## 6. 值得做的局部重构

1. **分开外部协议适配与生命周期决策。** 先修正确认的映射，再把 hooks 的 session/turn、工具、审批和终态规则拆成小模块；用一个可重放的纯状态更新入口测试。不要一开始强行统一所有 source 的细节。
2. **重写 terminalFailure watcher 的读取与诊断边界。** 保留纯解析函数，把文件定位、游标读取、轮次绑定和版本检查隔开，注入时钟/文件入口，便于集成测试。
3. **整理 face_renderer.h 的最终参数。** `target()` 第 82–103 行先计算旧版思考/执行，再按 v4 覆盖，最后乘 v5 放大系数；离线早返回后还留有不可达绘图分支。改为明确的最终尺寸、调色板、时间轴和绘制函数，保持当前批准的银色与动态效果。
4. **统一可共享的映射和设计参数。** TS/固件事件表与多个 HTML 预览存在重复；可以由小型规范文件生成映射，或先加契约检查。字体/抗锯齿差异仍需实屏验收，不要求前端与 ESP32 共用绘图实现。
5. **拆开头部姿态策略与舵机驱动。** 当前固件已是工作 +64 原始单位，即用户要求的 +20°；水平基准来自本机校准。保留范围限制，把姿态选择、稳定门槛、扭矩恢复与故障重试分别测试。
6. **补版本与诊断信息。** 启动时目前只打印 `motion-eyes-v5-silver`，不足以辨认后续固件参数版本。可在串口/调试页加入固件构建标识、角度与设计版本；正式化 backlog 中的 debug event 开关和脱敏事件采集脚本。

## 7. 文档与长时验收

[head-motion.md](head-motion.md) 前文仍写工作 +10°、范围上限 +10°，末尾才说已改 +20°；[固件 README](../firmware/stackchan/README.md) 第 118 行仍写 +10°、raw=623。当前代码为 +20°，本机目标 raw=655。应把当前规范更新为单一结论，旧值放历史记录。

[development-plan.md](development-plan.md) 混有不同日期的 29/32 项测试、v3/v5 和“真实审批待验收”等记录。历史记录可以保留，但首页当前状态应与已确认的验收分开，避免被理解为仍在使用旧实现。

本地较长的采样文件 `.tmp/stability/2026-09-06T17-16-44.561Z.jsonl` 有 1,674 个样本，首末时间相隔约 10 小时 24 分钟；其中 ready=false 31 次，clients=0 759 次，没有 summary。两份短采样各有 60 秒的完成摘要。长文件可能包含关机、开发重启或电脑休眠，本次不能据此归因产品故障，也不能记作完整 12 小时通过。

现有 sampler 主要观察服务、连接数和内存；即使长测无异常，也不能证明动画连续或映射正确。后续长测需明确维护时段并保留结束摘要；状态准确性另用事件轨迹断言，动画与运动另做帧间隔/实屏验收。

## 8. 建议执行顺序

先修 CLI 审批恢复和 app-server 协议契约，并补相应回归；随后修错误监视器与头部 x/e、失败重试；再整理渲染参数、统一文档和状态表。子任务/上下文压缩等增量映射放在生命周期规则稳定之后。最后进行一次完整 CLI 审批、错误恢复、设备掉线、头部 20°运动的实机验收，再启动有效的长时采样。
