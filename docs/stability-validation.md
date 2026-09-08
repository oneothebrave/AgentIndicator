# 稳定性验收记录

后续维护：motion-eyes-v3 动态设计替换期间重新烧录 ESP32，并临时使用 `motion-v3-check` source 播放六态动画。该窗口为主动维护，不能计为自然断线故障或连续稳定运行证据。

日期：2026-09-07。设备为现有 StackChan，表情固件 soft-companion-v2；真实交互式测试使用 Codex CLI 0.153.4。

## 真实审批

用独立测试 CLI 的正常 on-request 审批模式请求执行 `Write-Output 'agent-indicator-approval-probe'`，显式要求 shell escalation。没有修改文件、关闭审批或绕过 hooks 信任。测试期间临时使用 hooks 端口 8790，结束后已恢复日常 8788。

CLI 停在实际命令确认页；bridge 接收 `UserPromptSubmit → PreToolUse → PermissionRequest`，ESP32 串口报告 `approval.requested / waiting / origin=codex`。用户确认机器人保持琥珀色圆眼、小圆嘴的等待表情。选择仅批准本次后，命令输出成功，随后 `PostToolUse → Stop`，健康检查最新事件变为 `turn.completed`。

本机串口记录：`.tmp/approval-live-serial.log`，覆盖进入等待阶段。批准后与完成阶段由 CLI 输出和 bridge 健康检查确认。依据：[官方 PermissionRequest 文档](https://learn.chatgpt.com/docs/hooks)。

限制：缺少 tool_use_id 的审批不能可靠关联完成事件，显示端可能在批准后继续保持 waiting，直到轮次结束。这是保守映射，不代表正在运行的命令仍在请求批准。

## CLI 意外退出

同一测试 CLI 执行 `Start-Sleep -Seconds 60` 时，仅强制结束已核实身份的测试 CLI 进程。bridge 仍保留旧会话、最后 PreToolUse 和一个 active tool，复现 SessionEnd 缺失后的旧状态残留。

新增 `npm run session:reset`：显式清除活动轮次并发布 idle，释放当前会话；保留固定会话配置。重置采用预期 session ID 校验，目标变化则拒绝；已关闭轮次的迟到事件不能抢回绑定。此命令不终止 CLI、不改变审批决定。HTTP 与发布器测试、运行服务上的重置及 idle 结果均已验证。

自动检测 CLI 进程退出仍未实现。不会通过无事件超时推断任务结束。

## 设备连接恢复

用户将设备完全关机约 30 秒后再开机，确认自动联网并恢复表情。采样与 bridge 诊断观察到客户端数 1 → 0 → 1。已补上 bridge 每 30 秒主动 ping，下一周期未收到 pong 则清理失联连接；正常响应连接继续保留。桥接器关闭时最多给 WebSocket 对端 2 秒响应，然后终止残留连接。

模拟不响应 pong 客户端的自动化测试通过。此次物理测试是设备断电恢复，不替代路由器断电、Wi-Fi 信号中断或漫游验收。

## 回归和连续采样

32 项自动化测试及 TypeScript 检查、生产构建通过。

新增 `npm run stability -- --minutes 720`，每 5 秒只读采样健康状态、客户端数、bridge uptime、Node RSS/堆内存、事件类型和 hooks 计数，记录到 `.tmp/stability/`。不读取命令正文、提示词或 ESP32 内存。该终端需持续运行，电脑需保持唤醒。

首轮 60 秒采样共 13 个样本，服务不可用样本 0，零客户端样本 6，包含用户关机测试窗口。该记录用于验证采样与掉线观察，不能作为长期稳定性通过证据。RSS/堆内存指标在随后新版 bridge 中启用；旧版服务日志中的指标缺失不表示内存为零。

待完成：12 小时连续运行、路由器或 Wi-Fi 接入点中断恢复、真实审批拒绝路径、CLI 意外退出自动检测。

新版 bridge 的第二轮 60 秒采样为 13 个样本，服务不可用和零客户端样本均为 0。随后启动 720 分钟采样，结果尚未完成；只有日志中的实际时长与最终 summary 才能确认长测是否跑完，不能以配置时长代替完成时长。

采样期间维护说明：2026-09-07 为修复 done 被本地定时替换为 idle 的问题，重新烧录 ESP32，并临时将 CLI bridge 切换为 `done-hold-check` 测试 source 进行 20 秒保持验收，随后恢复。该窗口中的设备断连、bridge uptime 归零和 source 不匹配属于主动维护，不应直接计为自然故障；也不能把跨越该窗口的采样作为未中断运行证明。

2026-09-07 维护窗口：升级并重启设备至 motion-eyes-v4，COM3 写入校验通过；CLI bridge 保持运行，设备重新连接。此设备重启窗口不计入连续稳定运行验收。

2026-09-07 维护：升级 motion-eyes-v5 并重启验证版本、联网；设备重启窗口不计入连续稳定运行。CLI bridge 未切换为模拟源。

2026-09-07 离线停顿修复：原 socket.loop() 同步连接与绘制共用 Arduino loop，TCP 重连等待会暂停绘制。Wi-Fi/WebSocket 初始化、轮询和重连迁移至独立 FreeRTOS 网络任务（core 0，8 KiB 栈），屏幕及触摸保留在 UI 任务。网络状态通过长度为 1 的覆盖队列传递快照，避免绘制等待网络锁；WebSocket 对象仅由网络任务访问。

编译和 COM3 烧录哈希校验通过，程序 1,063,661 字节；串口确认 motion-eyes-v5-net-task、framebuffer=1，Wi-Fi 成功连接并尝试连接 bridge。当前 bridge 停止，实屏流畅度与触摸验收待用户确认。此维护重启不计入连续稳定运行采样。
