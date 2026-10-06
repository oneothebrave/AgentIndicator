# 完成收尾、CLI 退出恢复与文档整理验收

日期：2026-10-06。对应用户选择的事项 1、2、5。设备为现有 M5StackChan ESP32-S3，COM3。
本轮正式固件 `2026.10.06-r1`，保持 motion-eyes-v5 银色造型及工作抬头 20°。

## 完成后的设备收尾

新增纯展示策略 `presentation_policy.h`：实时完成保持 5 秒后展示 idle，保留最近真实 done。
新活动/审批/错误/真实 idle/断线抢占计时；非完成状态没有静默超时。
最近 32 个完成 ID 去重；首个旧完成快照用 ID 或 bridge 的 hello/event 时间判断。
新实时完成重启左眼眨眼。头部读取展示状态，经过原有 350ms 稳定门槛和 900ms 移动回平。

ESP32 `logic-test` 实际烧录运行，串口读取 **183 条断言、0 失败**。
覆盖 5 秒边界、重复事件、新任务与等待/异常抢占、断线、重连/重启旧快照、
新完成重启、millis 回绕、真实事件与展示分离以及头部收尾。
测试固件不初始化舵机、Wi-Fi 或 NVS；测试结束已恢复正式 status-client。

正式设备受控 WebSocket 回放验证：

- 两次未被抢占的完成分别在约 **5044ms、5016ms** 观察到 renderer 转为空闲。
- 重复完成只接受一次，不延长第一轮停留。
- 第二轮完成被执行状态抢占；超过旧 5 秒计时后仍保持工作，没有低头。
- 等待和异常各保持约 6 秒，没有自动切换 idle。
- 头部两次工作目标 655、两次收尾目标 591，串口报告 900ms 移动；未记录 fault。
- 断开后设备自动重连，收到旧完成时记录 `state=done display=idle settled=1`，不重播庆祝。

这是模拟事件驱动的真实固件/舵机验证，不是本轮真实模型任务或用户目视验收。
USB 日志来自两个任务，个别文本行可能缺失或交织；收尾证据采用 UI 的状态切换与头部反馈，
不将每条调试文字必达作为运行状态依据。日志在本机忽略目录：
`.tmp/completion-hardware-serial.jsonl`、`.tmp/completion-hardware-result.json`。

## Windows CLI 意外退出恢复

通知脚本加入本机进程分类及 PID/创建时间；bridge 校验原生交互 CLI 并持有进程句柄。
每 500ms 检查句柄退出信号，不依据无事件时长。确认退出后释放当前会话、清除工具/审批/子代理、
发布 idle。固定会话仍保留，迟到的旧进程通知不能清除已恢复的新会话。
已确认的非交互客户端通知被忽略，避免 desktop/app-server 抢占日常 CLI 状态。

回归覆盖进程真实退出、创建时间不匹配、重复关闭、非 CLI 拒绝、长任务与等待不误判、
监测未知/失败不释放、新轮次复用句柄、错误后会话接管、同会话换进程、旧 SessionEnd、
固定会话、停止监听与通知隐私裁剪。诊断会显示 cliObserver 降级原因。

另启动本轮专用交互式原生 Codex CLI，在隔离 HTTP 来源注入受控提问/工具/审批通知，
确认阶段为 watching 后只结束这个测试 CLI。约 **435ms** 后绑定释放，工具和审批清零，
最后事件为 thread.idle。未调用模型、修改账号或审批策略；此项验证实际进程身份/退出与来源集成，
不宣称完整真实模型回合已经重跑。结果：`.tmp/cli-exit-acceptance.json`。

自动检测目前只支持 Windows；参数查询使用版本相关 NT 适配器。
无法识别或没有权限时保持绑定，仍可显式 session:reset。详见 [CLI hooks](cli-hooks.md)。

## 回归、烧录与运行状态

- `npm test`：**84 项全部通过**，无跳过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `npm run test:contract`：本机 Codex app-server schema 契约通过。
- PlatformIO status-client、logic-test、screen-demo 三个环境编译通过。
- 正式 status-client 经 COM3 写入并通过 esptool 哈希校验，应用二进制 1,091,312 字节。
- 串口读取 `firmware version=2026.10.06-r1`，level=591、target=591、raw=591、automatic=1、fault=0。
- 演示来源已关闭，日常 CLI bridge 已恢复；doctor 显示两服务正常、一个 WebSocket 客户端、
  最近事件 thread.idle，CLI 监听等待活动。串口与连接共同证明本设备已恢复日常链路。

## 文档和剩余工作

开发计划、CLI 接入、表情规范、头部说明与固件 README 统一当前行为。
旧开发计划和固件说明移入 docs/history 并标注为历史；历史验收文件保留当时结论。
网页设计预览继续用于造型审核，其手动选中 done 的持续展示与固件的事件收尾规则已明确区分。

本轮没有完成 12 小时有效连续采样、路由器断网、真实审批拒绝或机械故障注入。
烧录和临时切换来源属于主动维护，不能当作连续稳定运行或自然故障证据。
剩余工作见 [开发计划](development-plan.md)。
