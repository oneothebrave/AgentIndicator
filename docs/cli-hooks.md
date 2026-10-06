# 正常使用 Codex CLI 同步硬件状态

## 日常使用

终端一保持运行，终端二正常使用 CLI：

```powershell
cd E:\AgentIndicator
npm start
# 另一终端：
codex
```

本机已安装并审核项目通知 hooks。无需测试 prompt。
`npm start` 强制选择 codex-hooks，旧 SOURCE 环境变量不会误启动 app-server。
状态服务默认监听 0.0.0.0:8787，hooks 只监听 127.0.0.1:8788。
机器人连接 `ws://<电脑局域网IP>:8787/status`。

启动器检查端口、hooks 配置和网络地址；健康的既有 CLI bridge 会被复用。
端口被其他来源/服务占用时返回失败，由使用者在原终端停止旧服务。
不自动修改信任、防火墙、账户配置或开机自启。

## 接入与隐私

CLI 生命周期 hook → `scripts/codex-hook.mjs` → loopback HTTP → Node bridge →
既有 `agent.event` → 硬件。协议仍只有 `bridge.hello` 和 `agent.event`。

通知仅携带事件名、会话/轮次/工具身份、时间、工具输入摘要，以及可识别 CLI 的
PID/创建时间和客户端分类。提示词、命令正文、输出、文件内容、transcript 路径和
进程命令行均不进入通知或硬件事件。进程命令行只在本机内存中用于客户端分类。
HTTP 监听拒绝 Origin 请求及非法 JSON，消息上限 4096 字节。

hooks 为同步短通知：HTTP 超时 300ms，脚本总期限 800ms（不含 Node 启动），
CLI hook 超时配置为 2 秒。Windows 本地身份查询是同步适配器，无法中途取消，
总期限也依赖系统调用返回。异常时始终返回 `{}` 和退出码 0，不输出审批决定或模型上下文。
不重试旧通知；这避免恢复后播放过时工作状态。

## 状态映射

| Hook / 信号 | 统一事件 / 状态 |
| --- | --- |
| UserPromptSubmit | turn.started / thinking |
| PreToolUse：Bash | command.started / running |
| PreToolUse：apply_patch | file.change / editing |
| 其他工具开始 | tool.started / tool |
| PermissionRequest | approval.requested / waiting |
| PostToolUse | 保留其他审批/工具活动，否则 thinking |
| SubagentStart / SubagentStop | 保留审批/工具优先级；仍有子代理时 tool，否则 thinking |
| PreCompact / PostCompact | 按当前活动恢复，无工具时 thinking |
| Stop | turn.completed / done |
| Interrupt / SessionEnd | thread.idle / idle |
| 本地 transcript 的显式整轮终止错误 | turn.failed / error |
| 绑定 CLI 真实进程退出 | thread.idle / idle，释放会话 |

thinking 表示当前处理阶段，不读取内部推理。editing 表示工具开始，不保证写入成功。
Stop 仅表示响应停止，不保证任务成功。CLI 没有托管搜索或逐字输出的完整 hook，
本来源不伪造 speaking/searching。命令非零退出不直接等同于整轮 error。

审批优先使用调用 ID，缺少 ID 时用会话、轮次、工具和规范化输入的 SHA-256 摘要关联。
同名工具或不同输入不能解除另一条审批；相同输入的并行调用有歧义时保守保持等待。
无法关联的审批保持到轮次结束，不依据静默超时清除，也不替用户批准。

## 完成后的设备收尾

新的实时 done 在设备上左眼眨一次，保持笑眼 5 秒后展示 idle、头部回平。
bridge 最近真实事件仍是 done，CLI 会话继续绑定。新活动/错误/等待/断线抢占旧计时；
重复完成不延长时间，重连旧完成快照不重播庆祝。见 [设计规范](design/expression-design.md)。

## 会话选择与意外退出

默认绑定首个提问或工具/审批活动会话。中断只关闭当前轮次，不释放会话。
正常 SessionEnd 释放绑定；错误后新的提问可接管未固定的会话。

Windows 自动恢复由 `shared/windows-process.mjs` 和 `hooks/cliExit.ts` 负责：

1. 通知脚本沿最多 16 层父进程寻找原生 codex.exe，解析参数排除 app-server/exec 等
   非交互客户端；这些已确认的非交互通知被忽略，无法识别的旧通知保留兼容行为。
2. 附带 PID 与 GetProcessTimes 创建时间。bridge 再校验身份和交互参数，持有只读进程句柄。
   句柄指向原进程，PID 重用不会把新进程当成旧 CLI。
3. 每 500ms 用 WaitForSingleObject 的零超时查询检查退出信号。
   确认退出后清理当前工具、审批、子代理与轮次，发布 idle 并释放绑定。
   迟到通知和旧进程的 SessionEnd 不能清除已恢复的新会话。

不会把“长时间没有事件”当成退出：长任务和等待审批可一直保持。
500ms 是检查周期，并非受系统调度影响之外的硬性响应上限。
不终止用户 CLI，不读取模型内容，不更改审批策略。

此适配器当前仅支持 Windows。原生参数读取使用 NtQueryInformationProcess 的
ProcessCommandLineInformation（class 60），它是版本相关适配，不能视为稳定 Codex API。
权限、原生运行库缺失、查询不支持、祖先已退出/超过深度等情况都会降级。
仅识别名为 codex.exe 的原生 CLI；保守排除非交互参数可能让同名文字的提示词无法识别。
未知来源不保证 CLI 专属，需时可使用固定会话 ID。

降级时保持绑定，`doctor` 显示 unidentified / unsupported / degraded，使用显式恢复：

```powershell
npm run session:reset
```

该命令校验预期会话和轮次，只释放当前绑定，不停止 CLI。固定会话环境变量
`AGENT_INDICATOR_HOOK_SESSION_ID` 仍生效；旧轮次不能重新抢占。
若身份通知在新 bridge 运行前已丢失，需下一次 CLI 提问/工具活动才能建立进程监听。

## 只读诊断

```powershell
npm run doctor
Invoke-RestMethod http://127.0.0.1:8788/health
Invoke-RestMethod http://127.0.0.1:8787/health
```

诊断输出服务来源、候选 IPv4、客户端数、最新事件、绑定与两类监听器状态。
cliObserver 显示 unbound（待活动）、watching（进程已验证）、unidentified、unsupported
或 degraded。terminalObserver 单独描述 transcript 错误补充监听。
本轮验证见 [2026-10-06 记录](fix-validation-2026-10-06.md)。

客户端数不含设备身份，不能区分浏览器和机器人，也不能证明 LCD 已绘制。
bridge 每 30 秒 ping，未回应连接通常在 30–60 秒清理。
固件 Wi-Fi 每 15 秒重试，WebSocket 每 3 秒重连；连接失效显示 offline。
使用回环 HOST 时机器人无法访问；状态端口和 hooks 端口须为不同的 1–65535 整数。
更改 hooks 端口后，CLI 终端须设置同样的 AGENT_INDICATOR_HOOK_PORT。

## 终止错误补充监听

官方没有可靠的整轮错误 hook。本地 watcher 增量读取当前绑定会话的 transcript，
只接受对应 turn_id 的显式终止错误，不把重试、工具输出或自然语言当成失败。
已完成但随后记录明确错误的同一轮次可改为 error；不会覆盖中断或新的轮次。
文件缺失/有歧义/过大/读取失败时由诊断报告，不猜测结果。

该 transcript 格式是版本适配，不是稳定公共协议；更换 Codex 后需核对。
error 不因 5 秒超时退回；新任务或 CLI 真实退出才能改变它。

## 安装、采集与历史

`npm run hooks:install` 合并项目 .codex/hooks.json 并备份变化，保留无关处理器。
在 CLI 的 /hooks 审核信任；本机原有通知命令路径不变，本轮无需重新安装定义。
移动项目或更换 Node 路径后重新检查。用户级安装使用 --global，不能同时保留两份。
卸载使用 --uninstall，用户级卸载加 --global。

`AGENT_INDICATOR_DEBUG_EVENTS=1` 启用脱敏逐事件诊断。
`npm run events:capture -- 60` 采集统一流。
`npm run stability -- --minutes 720` 每 5 秒只读采样，电脑须保持唤醒；
只有完整 summary 和实际连续时长能证明 12 小时跑完，短测不能代替。

历史实测见 [2026-09-07 稳定性记录](stability-validation.md)、
[2026-09-09 修复记录](fix-validation-2026-09-09.md) 与
[2026-09-29 维护记录](fix-validation-2026-09-29.md)。历史中的“自动退出未实现”
和“缺少 ID 审批必保持到 Stop”已由后续实现更新。

参考：[官方 Codex Hooks](https://learn.chatgpt.com/docs/hooks)、
[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)、
[WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)。
