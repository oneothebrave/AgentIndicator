# 状态与固件修复验收 · 2026-09-09

已按用户指令修复审查中确认的缺陷、更新本机 hooks/bridge，并通过 COM3 烧录正式固件 **2026.09.08-r1**。继续使用银色 motion-eyes-v5、六态＋离线、工作抬头 20°。本次跨午夜完成，因此固件版本日期与验收日期相差一天。

## 修复结果

| 审查问题 | 当前处理 | 验证 |
| --- | --- | --- |
| app-server 失败/中断误判 done | 按官方字符串 TurnStatus 读取，failed→error、interrupted→idle，未知状态不宣布成功 | 类型契约与映射回归通过 |
| 等待标记和重试误判 | activeFlags 保持 waiting；willRetry=true 不进入最终 error；工具失败不等于整轮失败 | 等待/并行工具/终态保护序列通过 |
| CLI 无调用 ID 的审批卡住 | 用会话/轮次内工具输入指纹关联 PostToolUse，保留相同工具并行保护 | 真实审批后 waiting→thinking→done；等待计数归零 |
| 长终止记录漏报 | 按完整 JSONL 记录增量读取；支持跨块 UTF-8、部分行、文件替换/截断，提供监听诊断 | 长记录、分段写入、路径消失、停止与绑定切换用例通过 |
| Stop 后明确错误被忽略 | 当前轮允许完成→明确失败纠正，禁止覆盖中断或更新轮 | 正反顺序回归通过 |
| 重复/迟到 prompt 清空工作 | 重复 prompt 不再清空工具，拒绝已知观察时间更早的 prompt | 回归通过；严格全序边界见后文 |
| 舵机 x/e 同目标不恢复 | 分离目标位置与扭矩状态，重新启用会恢复同一目标 | 实机 x→e：torque-off=1，随后重新发送 target=591 |
| 舵机通信失败密集重试 | 1 秒最小间隔，最多 3 次，之后锁定至显式恢复；检查舵机状态位 | ESP32 纯策略断言通过；未做物理堵转 |
| 动画多轮覆盖式计算 | 最终尺寸/时序/颜色集中到 face_motion.h，去掉旧版覆盖计算 | 关键尺寸、视线、笔迹路径与眨眼时序断言通过 |
| 连接层与调试页刷新 | 离线快照在潜在阻塞断开操作前发布；握手改变事件/来源也刷新文字页 | 最终固件编译、烧录与自动重连通过 |

补充了 contextCompaction、imageView/imageGeneration 和 hooks 子任务生命周期，仍映射到既有表情。子任务停止不会直接让父任务 done。硬件仍只认识 `bridge.hello` 与 `agent.event`，未加入 legacy approval 方法。

## 自动化结果

- `npm test`：54 项通过，0 失败。包含实际协议状态、并行审批、错误恢复、文件 watcher、TS/固件 13 个事件映射一致性。
- `npm run test:contract`：本机 Codex 0.153.4 生成的 TurnStatus/ThreadActiveFlag 与消费契约一致。
- `npm run build`：TypeScript 与 Vite 构建通过。
- ESP32 `logic-test`：120 条断言，0 失败。使用真实 ESP32 编译器和芯片执行纯逻辑/协议解析，**测试固件不初始化舵机、Wi-Fi 或 NVS**。
- 正式 `status-client`：RAM 52,424 字节，程序 1,081,337 字节，二进制文件 1,081,696 字节。烧录写入哈希校验通过。测试固件已被正式固件替换。

最终本地二进制 SHA-256：`30815ac103eadd2683c9016520a748c553fa7557b0c48d8e555236578a6c4c4a`。最终串口复核版本正确，level/target/raw 均为 591、automatic=1、fault=0；doctor 显示 thread.idle、1 个客户端、等待 CLI 活动。

没有通过硬件测试来推断模型工作成功，也没有用模拟审批代替下面的真实 CLI 记录。

## 真实 CLI 与设备验证

1. 交互式 CLI 执行只读 `Write-Output`，硬件收到工作与完成事件，head target=655、反馈 raw=653、fault=0。
2. 使用仅限测试会话的 `approvals_reviewer="user"`，让无副作用的测试命令停在真实审批页。bridge 的最新事件为 approval.requested。一次性批准后，采集到 approval.requested→reasoning.started→turn.completed；设备串口显示 thinking→done；没有保存命令自动批准规则或修改用户全局审批配置。
3. 用仅限测试会话的无效模型名产生真实接口失败，bridge 进入 turn.failed。保持该错误 CLI 打开，再启动正常模型的新 CLI：新会话成功接管、执行只读命令并完成。
4. 退出旧错误 CLI 后，新会话的 done 没有被旧 SessionEnd 覆盖。再退出当前 CLI，恢复 idle 与水平；串口确认 level=591、target=591、raw=591、automatic=1、fault=0。
5. 本项目新增的两个子任务 hook 已在 CLI 的 hooks 页面检查来源/命令并启用；已有 hooks 保留。更新前已备份 `.codex/hooks.json`。

本地证据保存在 [.tmp/firmware-validation](../.tmp/firmware-validation/) 和 [审批事件采集](../.tmp/events/2026-09-08T16-00-51.683Z.jsonl)。`.tmp` 证据不进 Git。事件采集只保存类型、来源与时间，不包含提示词、工具输入或输出原文。

用户的新版实屏目视确认仍待回复；串口/事件流通过不能代替像素观感与机械声音验收。

## 仍有的来源限制与独立验收

- hooks 没有统一的审批已解决回调：关联成功的 PostToolUse 会恢复工作，但耗时命令在执行期间仍可能保持 waiting。若审批既无 ID 又无可匹配输入，只能保守保持到回合关闭；相同输入的并行调用需等全部候选完成。不能为退出 waiting 而误清其他审批。
- 发送器观察时间只能拒绝已知更早的事件，不能保证跨进程启动或丢失事件的严格顺序。闭合轮次、会话隔离与重复事件保护仍生效。
- 没有 SessionEnd、没有明确错误记录的 CLI 突然消失，继续使用 `npm run session:reset`。公共 hooks 字段不足以可靠区分 Desktop 与 CLI，自动改绑不能凭猜测实现。
- transcript 是版本相关的兼容适配。超过 8MiB 的单条记录会被跳过并报告诊断；官方格式变化需重新适配。参见 [CLI hooks 说明](cli-hooks.md)。
- 新增子任务/图片/压缩映射已通过代码测试；本轮没有额外付费调用这些功能做真实任务验收。
- 12 小时完整采样、路由器物理断网、真实舵机通信断开/机械故障注入尚未完成。它们是独立验收，不记作本轮通过。

## 日常使用

电脑端新版 bridge 已在后台运行；ESP32 继续连接原局域网地址。正常使用 Codex CLI 即可。`npm run doctor` 检查 bridge、hooks、绑定与错误监听；`npm run events:capture -- 60` 采集一分钟状态流。

调试页底部或串口 `v` 可确认固件版本。不要把 `logic-test` 当作日常固件；重新运行硬件测试后，按 [固件 README](../firmware/stackchan/README.md) 恢复 `status-client`。
