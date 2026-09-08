# StackChan 硬件 bring-up

目标设备：M5StackChan AI Desktop Robot（ESP32-S3）。USB 用于烧录和日志，后续状态连接使用现有 Wi-Fi WebSocket 协议。

## 屏幕 demo

`screen-demo` 使用 M5Unified 的 StackChan 支持。底层编译目标为 ESP32-S3 DevKitC，覆盖为 16MB Flash、Quad PSRAM；板载屏幕和电源由 M5Unified 探测与初始化，fallback 为 `board_M5StackChan`，不使用 CoreS3 专用编译宏。

从仓库根目录执行（工具保存在 `.tmp`，无需全局安装）：

```powershell
python -m venv .tmp/hardware-venv
.tmp/hardware-venv/Scripts/python.exe -m pip install esptool==5.4.0 platformio==6.2.0
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e screen-demo
```

烧录前先用 `esptool --port <端口> flash-id` 核对芯片，再将原固件完整备份到 `.tmp/hardware-backups/`。备份可能包含设备配网信息，不提交 Git 或上传。

```powershell
.tmp/hardware-venv/Scripts/python.exe -m esptool --port COM3 --baud 460800 read-flash 0 ALL .tmp/hardware-backups/stackchan-original.bin
```

备份完成后烧录。此操作会替换设备正在运行的出厂应用：

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e screen-demo -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe -m platformio device monitor -p COM3 -b 115200
```

验收：屏幕显示 `Agent Indicator`、红绿蓝色块和每秒变化的 Uptime；串口持续输出 `screen-demo`、板型、显示尺寸和运行时间。烧录成功不能替代屏幕目视验收。

端口可能在重新插拔或烧录后改变，先用 `python -m serial.tools.list_ports -v` 查看；命令中的 Python 应使用上面的项目虚拟环境。

## Wi-Fi/WebSocket 客户端

`status-client` 连接 `ws://<电脑局域网IP>:8787/status`，消费版本 1 的 `bridge.hello` 与 `agent.event`。13 个事件的状态和颜色映射以 `src/domain/agentStatus.ts` 为准，硬件映射表位于 `include/event_states.h`。

复制 `include/config.example.h` 为 `include/config.local.h`（若本地文件已存在，不覆盖它）。填写电脑局域网 IP。优先尝试旧 Wi-Fi 配置时设 `USE_SAVED_WIFI=true`；屏幕显示 `Wi-Fi not configured` 表示驱动未找到旧配置，此时设为 `false`，并在本地填写 `WIFI_SSID` 和 `WIFI_PASSWORD`。配置文件已被 Git 忽略；不要提交含凭据的固件二进制。

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
```

电脑启动 bridge：

```powershell
$env:AGENT_INDICATOR_HOST = "0.0.0.0"
$env:AGENT_INDICATOR_SOURCE = "mock"
npm run bridge:mock
```

固件默认显示浅紫胶囊眼动态表情和底部连接点，隐藏状态文字。点击屏幕切换调试页，查看连接状态、Agent 状态、事件类型、来源和计数，再次点击返回表情。Wi-Fi 每 15 秒重试，WebSocket 每 3 秒重连，并使用 WebSocket ping/pong 检测断线；不会因 Agent 沉默而推断网络已断开。断线显示连接中的表情，调试页显示 Offline，收到有效 `bridge.hello` 后才接收事件。

当前仅接收 bridge 使用的不分片文本帧；超过 8KB、解析失败或非法事件会被忽略，不显示事件 detail 的任意长文本。调试页刷新最多每秒 10 次，表情按约 30 帧/秒的上限本地更新（实际帧率取决于绘制和网络耗时）。`sleepy`/`sleep` 显示半闭眼/闭眼，不进入芯片深睡眠。

### 动态表情

当前版本为 `motion-eyes-v5`，以 [正式动态设计规范](../../docs/design/expression-design.md) 和 [最新预览](../../docs/design/video-motion-review-v5.html) 为准，取代此前柔软伙伴造型。

- 空闲：浅紫胶囊眼、偶尔侧看和眨眼。
- 思考：左右上方交替看，小点随方向镜像。
- 执行：只写一行，眼睛跟笔移动，写完清除；抬眼、回正后重写。
- 等待：琥珀眼左右张望，底部单点缓慢呼吸。
- 完成：笑眼轻抬，只有左眼眨一次，再保持笑眼直到新状态。
- 异常：柔红 xx，轻摇一次后保持。

editing/tool 显示执行；searching/speaking 显示思考；sleepy/sleep 显示空闲。原始协议和调试页状态保留。联网六态没有嘴巴或腮红；离线为插头眼、插座眼和心电图嘴巴。后文旧版验证记录为历史记录。

所有动画只在屏幕上绘制，不控制舵机或扬声器。

联网验收流程：先确认 Source 为 mock、Events 持续增加；再停止/重启 bridge 检查离线和自动恢复；最后切换真实 Codex 事件。当前以上流程已通过（见下方记录）。真实 approval 等待仍沿用项目既有未解决项，不将 mock 的 waiting 当作真实 approval 验证。

先停止占用 8787 的 mock bridge，再运行：

```powershell
$env:AGENT_INDICATOR_HOST = "0.0.0.0"
$env:AGENT_INDICATOR_SOURCE = "codex"
$env:AGENT_INDICATOR_CODEX_SANDBOX = "read-only"
$env:AGENT_INDICATOR_CODEX_PROMPT = "请执行一次只读命令，读取当前目录的 package.json，然后用一句中文概括这个项目的用途。"
npm run bridge:codex
```

此命令通过 app-server 发起一次真实任务；不是监听 Codex Desktop 中任意正在进行的任务。任务完成后，屏幕保留最后的 done 状态。首次联调若在沙箱内遇到 TLS 错误，需在获准的沙箱外进程运行 bridge。

## 当前验证记录（2026-09-06）

- COM3：ESP32-S3 revision v0.2，16MB Flash。
- 原固件备份：`.tmp/hardware-backups/stackchan-original-20260906.bin`，16,777,216 字节；SHA-256 保存在同目录 `.sha256` 文件。
- `screen-demo` 编译通过，固件 468,048 字节；烧录成功并通过 esptool 写入校验。
- 串口连续输出 `screen-demo board=27 display=320x240 uptime=11` 至 `uptime=19`；M5GFX 枚举 27 对应 `board_M5StackChan`。
- 用户已确认屏幕文字、RGB 色块和递增秒数正常。
- `status-client` 已编译并烧录；13 个事件及颜色与 TypeScript 定义逐项一致。
- 用户填写本地 Wi-Fi 配置后，`status-client` 重新烧录并通过校验；设备 IP 为 `192.168.3.44`，电脑 bridge 为 `192.168.3.30:8787`。
- 实机收到 mock 事件，显示状态正确；停止 mock bridge 后报告 `Bridge connecting`，启动 Codex bridge 后自动恢复为 `Awaiting hello` → `Connected`，重新收到 `hello version=1`。
- 真实只读 Codex 任务完成，实机串口收到 `reasoning.started`、`turn.started`、`command.started`、`message.delta`、`thread.idle`、`turn.completed`，均为 `origin=codex`。串口记录位于本机 `.tmp/hardware-reconnect.log`。
- bridge 健康检查返回 `source=codex-app-server`、`clients=1`、最新事件 `turn.completed`。用户确认实屏为 Connected、done、Source codex。
- 尚未实测 Wi-Fi 接入点中断、长时间稳定性、硬件端全部异常输入和全部真实状态；首轮仅验证上述路径。

## 官方参考

2026-09-07 表情固件验证：`status-client` 编译成功，固件 1,060,176 字节，COM3 烧录与哈希校验通过。12 种模拟状态演示完成，串口确认状态切换及触摸切页；用户确认表情和点击切换正常。演示后已恢复 CLI hooks bridge，设备自动重连，健康检查 `source=codex-cli-hooks`、`clients=1`。真实 approval 和长期动画稳定性仍待验证。

- [StackChan Core 硬件参数](https://docs.m5stack.com/en/core/StackChan_Core)
- [M5Unified](https://github.com/m5stack/M5Unified)
- [StackChan 官方资源](https://github.com/m5stack/StackChan)

2026-09-07 v4：`motion-eyes-v4` 编译通过（程序 1,062,369 字节），COM3 烧录成功且写入哈希校验通过。烧录后健康检查为 `source=codex-cli-hooks`、`clients=1`。未切换模拟源；新版实屏视觉效果待用户确认。

2026-09-07 v5 验证：程序 1,063,305 字节，COM3 烧录及写入哈希校验通过。重启串口确认 `face design=motion-eyes-v5 framebuffer=1`，320×240 屏幕、Wi-Fi 自动连接、bridge hello version=1 正常，并恢复接收真实来源的 turn.failed。未播放模拟演示，实屏视觉验收待用户确认。

2026-09-07 离线停顿修复：原 socket.loop() 同步连接与绘制共用 Arduino loop，TCP 重连等待会暂停绘制。Wi-Fi/WebSocket 初始化、轮询和重连迁移至独立 FreeRTOS 网络任务（core 0，8 KiB 栈），屏幕及触摸保留在 UI 任务。网络状态通过长度为 1 的覆盖队列传递快照，避免绘制等待网络锁；WebSocket 对象仅由网络任务访问。

编译和 COM3 烧录哈希校验通过，程序 1,063,661 字节；串口确认 motion-eyes-v5-net-task、framebuffer=1，Wi-Fi 成功连接并尝试连接 bridge。当前 bridge 停止，实屏流畅度与触摸验收待用户确认。此维护重启不计入连续稳定运行采样。

头部运动已启用：水平 raw=591，工作抬头 10°至 raw=623，900ms 定时移动。用户确认小幅抬头回平测试正常。详见 [头部姿态](../../docs/head-motion.md)。
