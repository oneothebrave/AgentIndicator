# Agent Indicator 代码审查 · 2026-09-29

**修复进展：** 已实施维护修复，结果见 [2026-09-29 修复验收](fix-validation-2026-09-29.md)。下文保留审查时的证据，不表示问题仍未处理。

本轮是审查，未修改运行逻辑、hooks 配置或固件，未烧录、注入真实 bridge 事件或操作舵机。工作区在审查开始时干净。

结论：现有主要流程的回归通过，但仍有三处通过本地探针复现的缺陷，以及默认烧录环境、诊断显示和闲置驱动接口的风险。建议局部修复，不需要重写系统或新增表情状态。

## 验证范围与结果

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `npm test` | 54 项通过 | 现有自动化用例；不涵盖下述新探针 |
| `npm run build` | 通过 | TypeScript 与浏览器模拟器构建 |
| `codex --version` | 0.153.4 | 本机实际版本 |
| `npm run test:contract` | 通过 | 只检查 TurnStatus / ThreadActiveFlag 两个类型，不是完整协议验证 |
| PlatformIO `status-client` | 编译成功；RAM 52,424 字节，程序 1,081,337 字节 | 未重新运行 ESP32 的 120 条断言，未实屏验收 |
| 本地隔离探针 | 三处缺陷复现 | 使用假子进程、独立回环服务；不调用模型、不连接机器人 |

## 已复现的问题

### 1. P2：app-server 输入管道出错会直接终止 bridge

位置：[appServerProcess.ts:74](../server/sources/codex/appServerProcess.ts#L74)。

`writeLine()` 只检查 `stdin.writable` 后调用 `write()`。启动处监听的是 ChildProcess 的 `error`，没有监听子进程 stdin 流自己的 `error`。对方关闭输入管道时，写入错误可以异步触发，外层 try/catch 接不到。

复现：假子进程关闭 stdin 后延迟退出；父进程同时写入。进一步回归确认覆盖的是管道写入与子进程退出的竞争。实际得到未处理的 `Error: write EOF`，探针退出码为 1。Windows 已复现；其他系统错误码可能不同。

影响：仅开发用 `dev:app-server` 路径。bridge 本身会退出，硬件最终显示 offline，而非通过正常错误处理展示来源故障。日常 hooks 路径不使用这个类。

建议：把 stdin 错误接入统一、幂等的传输失败处理；拒绝挂起请求、清理子进程，并只发布一次来源失败。补写入与退出竞争的进程级测试。

探针：`.tmp/review-2026-09-29-stdin.ts`，运行 `node --import tsx .tmp/review-2026-09-29-stdin.ts`。当前退出码 1 是缺陷证据。

### 2. P2：app-server 请求超时被误当作整轮最终失败

位置：[codexSource.ts:60](../server/sources/codexSource.ts#L60)、[codex/events.ts](../server/sources/codex/events.ts) 的 `publishAgentEvent()`。

启动请求超时后，catch 直接发布 `turn.failed`，但既不终止仍存活的 client，也不经过 `CodexLifecycle`。如果服务器实际上已启动任务，只是没有及时返回 `turn/start` 响应，后续通知仍会照常发布。

复现：假 app-server 正常完成 initialize / thread/start，发送 turn/started，但不回复 turn/start；超时后继续发送 reasoning 和完成。实际事件为：

```text
turn.started → turn.failed → reasoning.started → turn.completed
```

同一轮没有重新开始，硬件却会先异常、再恢复思考、最后完成。这里的问题是把“请求响应超时”与“任务最终失败”混为一谈，而不是要求所有延迟事件都被强行丢弃。

建议：明确超时语义；可以保留任务状态并单独报告连接诊断，或明确停止来源并统一关闭生命周期。终态发布与通知处理应共享状态控制，避免一个入口绕过另一个。

探针：`.tmp/review-2026-09-29-timeout.ts` 和 `.tmp/review-2026-09-29-fake-app.mjs`。运行 `node --import tsx .tmp/review-2026-09-29-timeout.ts`。没有启动真实 Codex 或模型调用。

### 3. P2：事件采集器忽略自定义监听地址

位置：[capture-status-events.mjs:13](../scripts/capture-status-events.mjs#L13)。

启动器支持 `AGENT_INDICATOR_HOST` 为某个具体网卡地址，doctor 也使用对应 probeHost；采集器却始终连接 `127.0.0.1`。当 bridge 只绑定具体地址时，服务正常但 `events:capture` 会连接失败。

复现：独立服务只监听 `127.0.0.2`，健康检查成功；带相同 HOST 和 PORT 运行采集器，得到 0 records、退出码 1。该替代回环地址仅用于隔离复现，实际网卡地址有相同问题。默认 `0.0.0.0` 不受影响。

建议：复用启动器的主机/端口配置及探测地址规则，构造 WebSocket URL 时处理 IPv6 方括号。

探针：`.tmp/review-2026-09-29-capture.mjs`，运行 `node .tmp/review-2026-09-29-capture.mjs`。

## 配置与诊断风险（与上述实测缺陷分开）

- **默认烧录环境仍是屏幕 demo。** [platformio.ini:2](../firmware/stackchan/platformio.ini#L2) 设置 `default_envs = screen-demo`。省略 `-e` 执行 upload 会选择色块演示程序，替换正式联网固件。配置本身足以确认目标选择；本次没有实际烧录。建议默认 `status-client`，demo 仅显式选择。
- **持续监控不会及时显示终止错误监听器降级。** [indicator.mjs:134](../scripts/indicator.mjs#L134) 只比较 ready / clients。watcher 从正常变成 missing、ambiguous 或 error 时，这两项可能完全不变；此前终端显示“正常”后就不再刷新。重新运行 doctor 能看到实际状态。建议比较稳定的 observer phase / error，避免把每秒变化的 lastReadAt 加入日志判定。
- **闲置驱动接口存在内存释放错误。** [SCS.cpp:357–367](../firmware/stackchan/lib/StackChanMotionDrivers/SCS.cpp#L357) 以 `new u8[...]` 分配，却用 `delete` 而非 `delete[]` 释放。当前 HeadMotion 没有调用 syncReadBegin / syncReadEnd，因此不是当前头部异常的依据。若保留这套 vendored 接口，应修正并记录本地补丁；无需为此裁剪整个上游库。

## 无用逻辑与重复维护

| 位置 | 发现 | 建议 |
| --- | --- | --- |
| `server/sources/codex/events.ts:337` | `mapItemCompleted()` 所有分支都返回 undefined；读取 item type 没有作用 | 删除空函数；仍必须把 item/completed 通知交给 lifecycle 清理活动工具 |
| `server/sources/hooks/events.ts:46,133` | tools Map 保存的 `name` 从未读取；审批模块另有需要使用的 name | 只删除这个 Map 的冗余字段，不删除审批关联需要的工具名 |
| `scripts/indicator.mjs:123,126` | 连续动态 import 同一 `tsx/esm/api` | 一次 import 并保留友好的依赖错误提示；模块缓存使其不是双重初始化 bug |
| `scripts/install-codex-hooks.mjs:16` 与 `hooks/events.ts:7` | hooks 名称列表手工维护两份 | 建立共享清单或一致性检查，避免安装器和验证器逐渐不同步 |
| SessionStart 注册与处理 | 安装器每次运行通知脚本，但 publisher 不改变状态、不绑定新会话，仅可能更新诊断计数 | 明确是否需要此诊断；不需要则取消注册。安装器升级必须显式清理旧注册，不能只从名称数组删除 |
| `face_motion.h` 的 offline Pose 尺寸 | 离线绘制走 `FaceRenderer::offline()` 的独立几何，q.left / q.right 不控制离线眼睛 | 注明其仅参与状态过渡，避免把它当离线尺寸配置；不应误删过渡平滑逻辑 |

不建议当作“无用代码”删除的部分：

- `server/cli.ts` 仍是 `npm start` 的内部入口，强制使用 hooks 并提供局域网监听默认值。
- mock source 与 demoTimeline 仍服务于 `dev:mock` 和硬件回放，属于有用途的开发工具。
- 两套 Codex source 有不同接入语义，不宜为了减少文件数强行合并。
- TS 与 C++ 的事件映射在不同运行时使用，现有 parity 测试约束了事件与状态对应；不要求直接共用实现。
- vendored 舵机库的未调用 API 由链接器按构建规则处理，保留上游结构有利于维护。删除源码行数不等于必要优化。

## 测试仍缺什么

1. app-server 进程 / client 集成：stdin EOF、进程退出与待处理请求、请求超时后的迟到通知、主动 stop 时不发布新错误。
2. 采集器：默认监听与具体地址监听均能连接，断线退出和摘要记录可验证。
3. 安装器：重复安装幂等、保留其他 hooks、升级时删除弃用注册；当前没有 installer 的正式测试。
4. 持续诊断：observer 状态变化能被报告，单纯时间戳变化不刷屏。
5. 固件：默认构建环境断言；现有 120 条断言没有执行 HeadMotion 的真实总线错误路径。通信故障、实际断网重连与动画连续性仍需专门实机验收。

本轮还验证了一个并发边界：reset 只比较 sessionId，健康检查后同一会话进入下一轮，旧 reset 请求仍能清掉新轮。当前命令文档要求使用者确认要释放整个会话，因此此处列为保护措施改进，不计入三项确定缺陷。若要严格防止误清，应携带 turnId 或绑定代次。

## 状态覆盖与文档

继续使用现有六种工作表情及 offline，没有发现必须新增第八种表情的证据。审批缺少统一解决回调、公共 hooks 不能可靠识别 CLI 与 Desktop 等边界，仍以已有接入文档为准。本轮核对了 [官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)：默认 hook 同步执行，PermissionRequest 发生于询问审批前，PostToolUse 发生于工具输出后；不能仅靠人工排列不可能的回调顺序就宣布线上有 bug。transcript 仍是版本相关适配。

固件 README 的前半部分仍写“浅紫”“sleepy/sleep 半闭眼/闭眼”，与后文银色 motion-eyes-v5 和当前 `visual()` 把 sleep 别名映射 idle 不符。应让首页只说明当前实现，旧外观放入历史记录，防止再次误认为烧录错版。

优先顺序：先修三处实测缺陷并加入回归；再调整默认固件环境和诊断刷新；最后清理空函数、冗余字段和文档。保持已有表情、协议与抬头 20°不变。
