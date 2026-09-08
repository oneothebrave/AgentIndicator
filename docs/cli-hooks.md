# 正常使用 Codex CLI 同步硬件状态

## 日常启动

当前项目已在 Codex CLI 0.153.4 中安装并审核启用通知 hooks，包括 SubagentStart/SubagentStop。当前修复与测试结论见 [2026-09-09 验收](fix-validation-2026-09-09.md)。开两个终端：

终端一（保持运行）：

```powershell
cd E:\AgentIndicator
npm start
```

终端二：

```powershell
cd E:\AgentIndicator
codex
```

直接在 CLI 中输入问题、执行命令和修改文件，StackChan 会跟随状态变化。无需 `AGENT_INDICATOR_CODEX_PROMPT`。`bridge:cli` 强制选择 `codex-hooks`，因此旧的 `AGENT_INDICATOR_SOURCE=codex` 不会误启动 app-server 测试任务。它默认监听 `0.0.0.0:8787`；如设置了 `AGENT_INDICATOR_HOST`，则使用该值。

`npm start` 会检查端口、hooks 配置和局域网地址；若 CLI bridge 的两个健康检查均正常，则复用现有服务并退出，不创建第二个实例。新启动时保持前台运行，连接数量变化会打印诊断，按 Ctrl+C 停止。底层 `npm run bridge:cli` 仍可使用。

同一端口只能运行一个 bridge。若端口被 mock、app-server 或其他服务占用，启动器会说明冲突并返回失败，不结束占用进程；请在旧 bridge 的终端按 Ctrl+C 后再启动。硬件仍连接 `ws://<电脑局域网IP>:8787/status`，无需重新烧录。

## 一键诊断

```powershell
cd E:\AgentIndicator
npm run doctor
```

诊断只读取状态，不启动、停止或修改服务。它显示项目和用户级 hooks 是否包含通知脚本、候选局域网 IPv4 地址、bridge 与 hooks 接收端健康状态、WebSocket 客户端数量、最新事件类型和会话是否绑定。不会打印提示词、命令正文或 Wi-Fi 凭据。配置检查不等于 CLI 已信任 hooks，仍以 `/hooks` 和实际事件为准。

| 结果 | 处理方式 |
| --- | --- |
| 两个接收服务正常 | 退出码 0；另一终端运行 `codex` |
| 服务缺失或来源不匹配 | 退出码 1；用 `npm start` 启动，或检查旧服务占用 |
| 客户端数为 0 | 服务本身可能正常；检查机器人电源、Wi-Fi、固件电脑 IP 和专用网络防火墙 |
| 有连接但无状态变化 | 在 CLI 输入新任务，检查 hooks 信任与会话绑定；强制退出后残留绑定可通过重启 bridge 清除 |
| 仅监听 127.0.0.1 | 将 `AGENT_INDICATOR_HOST` 设为 `0.0.0.0` 后重启，才能供局域网硬件访问 |

现有协议不含设备身份，因此客户端数不能区分机器人和模拟器；连接存在也不证明 LCD 已正常绘制。bridge 每 30 秒发送 WebSocket ping；下一次检查仍未收到 pong 时清理连接，因此非正常断网约 30–60 秒后反映到连接数（受事件循环调度影响）。候选地址可能包含虚拟网卡，需选择与机器人可互访的网卡地址。

默认状态端口 8787、hooks 端口 8788；支持 `AGENT_INDICATOR_PORT` 与 `AGENT_INDICATOR_HOOK_PORT`，必须为不同的有效端口。更改 hooks 端口时，运行 Codex 的终端必须使用相同环境变量；更改状态端口也需要更新硬件连接配置。

启动器只管理本次前台启动的服务，不自动安装 hooks、修改信任配置、防火墙或开机自启。复用已有服务时，需要回到原启动终端停止该服务。

## 接入结构

交互式 Codex CLI → 生命周期 hook → `scripts/codex-hook.mjs` → `127.0.0.1:8788/hook` → `codexHooksSource` → 原有 `agent.event` WebSocket → 硬件。

接收端仅绑定电脑回环地址，拒绝浏览器 Origin 请求和非法 JSON。hook 只发送事件名、会话 ID、轮次 ID、工具名和工具调用 ID；不发送提示词、命令正文、文件内容、工具输出或 transcript 路径。采集过程不输出审批决定或额外模型上下文，始终返回 `{}` 和退出码 0。

hooks 采用同步短通知以减少乱序：HTTP 超时 300ms，脚本总时限 800ms（不含进程启动），Codex hook 超时配置为 2 秒。bridge 离线时，通知快速放弃。它不会重试历史事件，避免恢复连接后回放过时状态。

## 映射及边界

| Hook | 统一事件 / 硬件状态 |
| --- | --- |
| `UserPromptSubmit` | `turn.started` / thinking |
| `PreToolUse`，工具为 `Bash` | `command.started` / running |
| `PreToolUse`，工具为 `apply_patch` | `file.change` / editing |
| 其他本地工具开始 | `tool.started` / tool |
| `PermissionRequest` | `approval.requested` / waiting |
| `PostToolUse` | 有其他活动工具则保留对应状态；否则 thinking |
| `Stop` | `turn.completed` / done，表示响应停止，不保证任务成功 |
| `Interrupt`、`SessionEnd` | `thread.idle` / idle |
| 压缩上下文 | 无活动工具时 thinking |

`editing` 表示修改工具开始执行，不表示修改已经成功。thinking 是无活动工具时的处理阶段，并非读取内部推理。官方 hooks 不提供逐字输出和托管 WebSearch 的完整事件，因此本模式不伪造 speaking/searching，也不把命令失败等同于整轮失败。没有可靠的整轮错误 hook；模型/网络异常状态尚未完整覆盖。

官方 `PermissionRequest` 没有对应的 `tool_use_id`，无法可靠关联某个工具完成。因此缺少调用 ID 的 waiting 保守地保持到 Stop、Interrupt 或 SessionEnd，不会仅因同名工具结束就清掉等待。这意味着批准后可能继续显示 waiting，直到轮次结束。其他 Stop hooks 可能要求继续执行，后续新轮次将重新进入 thinking。源协议不变，所有 CLI hooks 事件的 `origin` 为 `codex`，`bridge.hello.source` 为 `codex-cli-hooks`。

## 会话选择

默认绑定第一个提交问题或产生工具/审批活动的会话，忽略其他会话，直到绑定会话正常退出（`SessionEnd`）。中断只结束当前轮次，不释放会话。按轮次丢弃迟到事件，工具调用 ID 用于处理并行工具完成。

如果 CLI 被强制结束，未收到 `SessionEnd`，可运行 `npm run session:reset` 清除当前轮次、显示 idle 并释放会话绑定。此命令会影响当前被绑定的会话，仅在确认它已结束或要切换目标时使用；它不停止 CLI、不批准命令。不会按无事件超时自动释放，以免中断真实长任务或等待审批。固定会话配置仍保留；已关闭轮次的迟到事件不能重新抢占绑定。也可重启 bridge。也可启动前设置 `AGENT_INDICATOR_HOOK_SESSION_ID` 固定会话 ID。诊断入口：

```powershell
Invoke-RestMethod http://127.0.0.1:8788/health
Invoke-RestMethod http://127.0.0.1:8787/health
```

前者显示绑定会话、轮次、最后 hook、接受/忽略计数；后者显示硬件连接数和最后的统一事件。桥接器重启后，不自动回放 CLI 历史，等待下一次可观察活动。

## 安装与卸载

```powershell
npm run hooks:install
```

安装器合并本项目 `.codex/hooks.json`，保留无关 hooks，修改已有文件前创建备份。生成配置使用本机 Node 和脚本绝对路径，已被 Git 忽略；移动项目或更换 Node 安装路径后应重新检查配置。新机器上重新运行安装器。

在 CLI 的 `/hooks` 中审核并信任新配置。项目也必须被 Codex 信任。更改 hook 定义后需要重新审核并重启 CLI。当前机器已完成此步骤，未关闭 hook 信任校验。

当前只在本项目生效。如需其他项目也生效，可迁移到用户级（不要同时安装两份）：

```powershell
npm run hooks:install -- --uninstall
npm run hooks:install -- --global
```

用户级 hooks 也可能由使用同一配置的其他 Codex 客户端触发；hook 公共输入不能可靠区分 CLI 与桌面客户端。需要时用会话 ID 固定目标。全局移除使用 `npm run hooks:install -- --global --uninstall`。

## 历史验证记录

- 一键启动与诊断：隔离端口验证全新启动、旧 SOURCE 环境变量不会启动 app-server、重复启动复用、错误服务占用不被终止、诊断离线返回失败、HTTP 卡住时在期限内结束。
- 模拟 WebSocket 客户端断开再连接、hooks 事件通过新启动器传播已通过自动化测试；这不替代物理 Wi-Fi 中断与长期运行验收。

- 21 项测试通过，包括原 app-server 映射、hooks 会话/轮次隔离、并行工具、审批状态、中断、通知数据裁剪和 bridge 离线/超时。
- TypeScript 检查和生产构建通过。
- 实际启动交互式 `codex --no-alt-screen`，未使用 app-server 测试 prompt：第一轮读取 package.json，捕获提交 → 命令开始 → 命令结束 → Stop。
- 同一 CLI 会话第二轮用 apply_patch 创建 `.tmp/cli-hooks-smoke/probe.txt`，捕获 editing；随后执行等待命令，按 Esc 中断，捕获 Interrupt → idle。
- `/exit` 发出 SessionEnd，bridge 释放会话。
- 用户确认 StackChan 跟随变化，并在中断后显示 Connected / idle。未重新烧录硬件。
- 2026-09-07 在 Codex CLI 0.153.4 中，以正常审批模式执行无副作用的 Write-Output 测试：真实审批页停留，bridge 收到 PermissionRequest，ESP32 串口收到 waiting；用户确认保持等待表情。批准后命令输出成功，Stop 后收到 done。参考官方 [PermissionRequest 说明](https://learn.chatgpt.com/docs/hooks)。
- 在测试 CLI 执行 Start-Sleep 时强制结束该测试进程，复现未发出 SessionEnd、旧会话及 running 残留。新增显式 session:reset 已通过 HTTP、发布器与实机连接服务验证；自动进程退出发现仍未实现。
- 当前 32 项测试通过，构建通过；长期运行与路由器断网恢复仍待验收。

参考：[官方 Codex Hooks 文档](https://learn.chatgpt.com/docs/hooks)。

## 长时间采样

保持 bridge 运行，在另一终端执行：

```powershell
npm run stability -- --minutes 720
```

每 5 秒读取健康状态并写入 `.tmp/stability/*.jsonl`；记录客户端数、bridge uptime、Node RSS/堆内存、事件类型和 hooks 计数，不记录提示词、命令正文或会话 ID。默认 5 分钟，可设 1–1440 分钟；Ctrl+C 提前结束会写入实际时长与中断标记。故障采样计数不是故障次数。检查内存是否持续增长、连接数是否恢复、uptime 是否意外归零，并结合实屏观察；该采样不提供 ESP32 内存数据。

脚本只观察，不自动重启服务；电脑必须保持唤醒、终端保持运行。完成后输出实际持续时间、采样数、服务不可用采样数与零客户端采样数。任何短测都不能作为 12 小时稳定性通过的证据。

## 终止错误补充检测（2026-09-07）

截图中的模型 404 回合仅收到 UserPromptSubmit，未收到 Stop；本地 transcript 存在 event_msg/task_complete，包含对应 turn_id 和 error.message。当前 terminalFailure.ts 每秒增量读取已绑定会话，按完整 JSONL 记录判断当前轮的显式终止错误，映射 turn.failed。首次绑定/切换回合从文件开头扫描，单轮读取预算 4MiB，单条记录上限 8MiB，支持跨读取边界和分段写入。不会向硬件输出错误正文、prompt 或模型回复。

[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks) 未列出终止错误 hook，并明确 transcript 格式不稳定。此适配针对 CLI 0.153.4；升级后需复测。缺失/歧义文件、未知格式、未写完的行和过大的记录不会被推测为失败；监听能力通过 hooks `/health` 的 terminalObserver 与 doctor 报告。路径消失后重新定位，超大记录被诊断并跳过，后续记录仍能处理。不以超时把思考判成错误。后续若有官方错误 hook，应迁移至该接口。

验证：34 项测试通过，生产构建通过。恢复此前失败会话的绑定后，读取原始 404 终止记录（未重新调用模型），实机串口依次显示 thinking → error，bridge 最新事件为 turn.failed。此次验证不证明所有 CLI 失败路径均已覆盖。

2026-09-07：修复终止失败后旧会话占用绑定。error 保持至下一条有效请求；未固定会话时，失败后新 CLI 的 UserPromptSubmit 可接管。迟到工具事件、旧回合重复提交、旧 SessionEnd 均不能覆盖新会话；显式 pinned session 保留约束。活动回合仍保持单会话所有权。36 项测试及构建通过。

## 当前关联规则与诊断

sender 只发送事件身份、会话/轮次、工具名/调用 ID、可选子代理 ID、观察时间与输入摘要。`tool_input_hash` 是限定在会话/轮次内的 SHA-256 指纹，不传命令/输入原文。Bash/apply_patch 使用 command 字段，避免审批说明影响关联。

审批没有调用 ID 时，通过输入指纹关联 PostToolUse，匹配完成后恢复剩余工具或 thinking；多个相同输入的并行调用会保守等待所有候选完成。既无 ID 又无可匹配输入的事件仍只能等回合关闭；不凭同名工具完成清空审批。hooks 没有统一的“用户已批准、命令刚开始”回调，因此耗时工具可能要等对应 PostToolUse 才退出 waiting；这是来源可观察性的边界。

明确的终止失败可以修正仍属于当前轮的 Stop 完成状态，不能覆盖中断或新轮。发送器观察时间用于拒绝已知更早的 prompt，重复 prompt 不会清空活动工具；它不提供跨进程启动的严格全序。CLI 无 SessionEnd 的突然消失仍使用 `npm run session:reset`，不猜测其他终端或 Desktop 的归属。

默认关闭逐事件日志。调试时在启动 bridge 的终端设置 `$env:AGENT_INDICATOR_DEBUG_EVENTS='1'`；只记录方法名、事件类型与关联标识，不打印原始 payload。`npm run events:capture -- 60` 只读采集 60 秒 WebSocket 状态到 `.tmp/events/`，不记录 detail、prompt 或命令原文。采集器本身算一个 WebSocket 客户端。
