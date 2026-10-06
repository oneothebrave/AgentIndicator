# StackChan 固件

目标设备 M5StackChan ESP32-S3，320×240 横屏、16MB Flash、Quad PSRAM。
当前源码和本机设备固件为 `2026.10.06-r1`，默认环境为 status-client。
USB 用于烧录/串口，日常状态通过 Wi-Fi WebSocket 获取；电脑端运行 `npm start` 和普通 Codex CLI。
本轮烧录与回归依据见 [2026-10-06 验收](../../docs/fix-validation-2026-10-06.md)。

## 正式行为

银色 motion-eyes-v5，联网六态加灰色离线。点击切换表情页和调试页。
网络在独立 core 0 任务中运行，UI 不等待同步 TCP 重连；快照通过单槽覆盖队列传递。

| 状态 | 表现 |
| --- | --- |
| idle | 银色胶囊眼，偶尔侧看和眨眼，头部水平 |
| thinking | 左右上方交替看，镜像思绪点，工作抬头 20° |
| running | 只写一行；银色笔迹，视线跟随，抬眼回正后重写 |
| waiting | 琥珀眼左右看，呼吸点，保持头部目标 |
| done | 左眼眨一次；笑眼 5 秒后展示 idle 并回平 |
| error | 深红 xx，轻摇一次后保持已有目标 |
| offline | 灰色插头眼、插座眼和心电图嘴巴，回平 |

editing/tool 使用执行造型，searching/speaking 使用思考，sleepy/sleep 使用空闲。
不进入芯片深睡眠，不启用扬声器。几何和调色板见 [设计规范](../../docs/design/expression-design.md)。

完成收尾只改变设备展示，不改 bridge 最近真实事件或会话绑定。
调试页大字显示当前展示，Last 保留原始状态与事件类型；完成收尾后为 idle / Last: done (done settled)。
新活动、等待、异常、真实 idle、断线抢占完成计时。最近 32 个完成 ID 去重。
重连首个完成若 at 不晚于 hello.at，或 ID 已庆祝，立即展示 idle；不会重播旧庆祝。
新实时完成可重置左眼庆祝。thinking/running/waiting/error 没有静默超时。

头部策略只控制 ID 2，水平基准本机为 591、工作为 655（约 20°）。
完成收尾后按现有 350ms 稳定门槛和 900ms 移动回平；无有效校准不运动。
限位、最多 3 次故障重试和串口命令见 [头部说明](../../docs/head-motion.md)。

## 配置与协议

仅消费版本 1 的 bridge.hello 与 agent.event；13 个事件和 TypeScript 映射一致。
连接 `ws://<电脑局域网IP>:8787/status`，不能填写 127.0.0.1 或 0.0.0.0。
Wi-Fi 每 15 秒重试，WebSocket 每 3 秒重连并检测心跳；须收到合法 hello 才接收事件。
网络掉线覆盖为 offline，不当成 Agent error。

若 include/config.local.h 不存在，复制 config.example.h 并在本地填写配置。
已有文件不覆盖。USE_SAVED_WIFI=true 优先复用设备配置；无保存配置时调试页显示
Wi-Fi not configured，改为 false 并本地填写 SSID/password。不要提交凭据或固件二进制。
常规烧录不擦除独立 indicator-head NVS，也不改原厂舵机零点。

仅支持不分片文本帧；超过 8KB、非法 JSON/事件、空 ID 或 ID 超过 256 字节被拒绝。
不显示任意 detail 内容。调试页最多每秒 10 次，动画上限约 30fps，实际帧率受绘制耗时影响。
分配失败时保留 8-bit/文字页降级。

## 构建与烧录

首次安装工具（已存在时复用）：

```powershell
python -m venv .tmp/hardware-venv
.tmp/hardware-venv/Scripts/python.exe -m pip install esptool==5.4.0 platformio==6.2.0 pyserial
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m serial.tools.list_ports -v
```

本机端口 COM3；更换设备先核对芯片并备份原始 Flash 到 .tmp/hardware-backups。
备份含配网信息，不提交或上传。本机原始备份记录保留在 [历史归档](../../docs/history/stackchan-readme-before-2026-10-06.md)。

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --seconds 5 --send v
```

串口版本、head level/target/raw/automatic/fault 可确认固件和姿态策略。
写入哈希校验不代替目视确认。screen-demo 只用于首轮屏幕 bring-up，须显式 -e screen-demo，
它显示标题、RGB 色块和 Uptime，不接日常状态。

## 固件回归

logic-test 在 ESP32 上运行纯头部策略、动画关键帧、协议解析和完成展示策略。
不初始化舵机、Wi-Fi、NVS。当前为 183 条断言，必须读取 failures=0；结束后恢复正式固件。

```powershell
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e logic-test -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --seconds 5 --expect 'failures=0'
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --seconds 5 --send v
```

完成计时覆盖 5 秒边界、抢占、去重、快照和 millis 回绕；头部策略仍保持 20°限位。
本轮受控 WebSocket 回放与串口实机验证不替代真实模型调用、路由器断网或机械故障注入。
有效 12 小时采样与专项物理验收仍列在 [开发计划](../../docs/development-plan.md)。

参考：[StackChan Core](https://docs.m5stack.com/en/core/StackChan_Core)、
[M5Unified](https://github.com/m5stack/M5Unified)、
[StackChan 官方资源](https://github.com/m5stack/StackChan)。
