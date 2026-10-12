# Agent Indicator 接力说明

更新日期：2026-10-12。本文供迁移电脑后的使用者及后续开发者接力。
日常安装见 [README](README.md)，功能待办见 [开发计划](docs/development-plan.md)。

## 1. 先看当前结论

| 项目 | 当前状态 |
| --- | --- |
| 仓库 | [oneothebrave/AgentIndicator](https://github.com/oneothebrave/AgentIndicator)，分支 `main` |
| 功能基线 | `ffe7102`：移除完成后的自动 idle，已提交并推送；本次交接整理只改文档 |
| 正式固件 | 源码及现有机器人均为 `2026.10.07-r1`，2026-10-12 已烧录 |
| 硬件 | 现有 M5StackChan ESP32-S3 rev v0.2，16MB Flash，320×240，Quad PSRAM；旧电脑端口 COM3 |
| 表情/运动 | 银色 motion-eyes-v5，六种工作表情加 offline；工作抬头约 20° |
| 当前阻碍 | 机器人未连接已配置 Wi-Fi，最新串口为 `wifi-retry status=1 saved-wifi=0`；联网回放未完成 |
| 电脑端运行 | 迁移前交接检查未检测到可用日常 bridge；新电脑需执行 `npm start` |
| 下一步 | 配置新电脑地址及 Wi-Fi，恢复真实 CLI → bridge → 机器人链路，再做联网验收 |

USB 用于烧录和串口，日常事件通过 Wi-Fi 传输。把 USB 接到新电脑不会自动修改固件中的 bridge 地址。
未确认当前 Wi-Fi 失败原因；不能直接归因为代码缺陷、密码错误或设备故障。

## 2. 离开旧电脑前，单独带走这些本地文件

以下文件被 Git 忽略，**clone 仓库不会带走它们**：

| 文件/目录 | 用途 | 迁移方式 |
| --- | --- | --- |
| `firmware/stackchan/include/config.local.h` | Wi-Fi 凭据和电脑地址 | 私下传输，或按模板重新填写；更新 `BRIDGE_HOST` |
| `.tmp/hardware-backups/stackchan-original-20260906.bin` 及同名 `.sha256` | 原厂完整 Flash 备份 | 单独保留，以便以后回退原厂固件 |
| `.tmp/hardware-backups/stackchan-pre-20261012.bin` | 本次升级前的完整 Flash 备份 | 单独保留，当前核对大小及摘要见下表 |
| `.tmp/firmware-validation/`、`.tmp/events/`、`.tmp/stability/` 及烧录/串口日志 | 需要追溯时的本地证据 | 按需单独转移；Git 中仅保留验收结论 |

两份 Flash 备份均为 **16,777,216 字节**；交接时已重新核对 SHA-256：

| 备份 | SHA-256 |
| --- | --- |
| 原厂 `stackchan-original-20260906.bin` | `CF4A70019A92946C7D2DE370A002789FF9302C48CA09CFD148D5DCD4C1BD811C` |
| 升级前 `stackchan-pre-20261012.bin` | `4EA6AA26CE7FA814151F595E56545EAE4B2DFDF74A7F1FAEDAE617A56339AACD` |

本地配置、Flash 备份和编译二进制可能含配网信息，不要加入 Git 或上传 GitHub。
`node_modules/`、`dist/`、`.pio/`、旧 Python 虚拟环境和 PlatformIO 缓存在新电脑重建即可。
Codex 的账号登录、配置和 hooks 信任需要在新电脑单独确认。

## 3. 新电脑恢复步骤

以下命令以 **Windows / PowerShell** 为例，这是目前实际验收的平台。
旧环境为 Node.js **24.13.0**、npm **11.6.2**、Python **3.13.12**、Codex CLI **0.162.0**。
先复用这些版本更容易复现结果；升级 Codex 后重新核对 hooks、transcript 和契约。
非 Windows 的自动 CLI 退出监测会降级，`test:contract` 脚本也依赖 PowerShell，不能照搬为已验收平台。

### 3.1 克隆和安装

```powershell
git clone https://github.com/oneothebrave/AgentIndicator.git
cd AgentIndicator
git status --short
npm ci
codex --version
```

检查分支为 `main`，并包含本次交接提交。项目目录可自行选择，无需复用 `E:\AgentIndicator`。

### 3.2 在新电脑重新安装 hooks

只选择一种范围：

- 仅在本项目使用 CLI：`npm run hooks:install`。
- 在其他项目使用 CLI 时也驱动机器人：`npm run hooks:install -- --global`。

项目级文件是 `<项目>/.codex/hooks.json`；用户级文件是
`<CODEX_HOME>/hooks.json`，未设置 `CODEX_HOME` 时为 `<用户目录>/.codex/hooks.json`。
它们由安装脚本生成，不随 Git 迁移。定义包含 Node 和 `scripts/codex-hook.mjs` 的绝对路径，
不要直接复制旧 hooks 文件。若迁移了用户级 Codex 配置，先检查并移除本项目的旧路径条目，保留其他 hooks；
安装器只匹配当前命令，不能保证自动识别另一台电脑的旧路径。

若误装了项目级而希望改为用户级：

```powershell
npm run hooks:install -- --uninstall
npm run hooks:install -- --global
```

然后在目标项目打开 Codex CLI，通过 `/hooks` 审核并信任本项目通知定义。
文件存在、安装成功与 CLI 已信任是三个不同条件。
跨项目使用时，Node bridge 仍从 AgentIndicator 目录启动；用户级 hook 将其他项目的通知发到本机 bridge。

### 3.3 启动 bridge，再确认真实事件

终端一：

```powershell
npm start
```

终端二，进入已安装并信任 hooks 的项目：

```powershell
codex
```

第三个终端诊断：

```powershell
npm run doctor
```

默认状态服务为 `0.0.0.0:8787/status`，hooks 接收端为 `127.0.0.1:8788/hook`。
先确认来源是 `codex-cli-hooks`、两个健康检查正常，并通过真实 CLI 的只读提问观察事件增加。
单会话默认绑定首个有效活动；需要改绑时用 `npm run session:reset`，它不终止 CLI。
端口冲突时在原终端停止相应旧服务；mock/app-server 与日常 bridge 不能占用同一个端口。

### 3.4 改为新电脑地址，连接机器人

旧配置：`BRIDGE_HOST=192.168.3.30`、`BRIDGE_PORT=8787`、`USE_SAVED_WIFI=false`。
`npm start` / `doctor` 会列出候选 IPv4，可能包含虚拟网卡；选择机器人可访问的实际局域网地址。

检查或创建 `firmware/stackchan/include/config.local.h`：

- 文件不存在时，从 [config.example.h](firmware/stackchan/include/config.example.h) 复制。
- `BRIDGE_HOST` 改为新电脑局域网 IPv4，仅填 IP，不带 `ws://` 或 `/status`。
- 机器人连接 2.4GHz Wi-Fi；更新本地 SSID/password，或在确认有设备保存配置时使用 `USE_SAVED_WIFI=true`。
- 电脑与机器人必须可互访，防火墙允许机器人访问 TCP 8787；hooks 8788 保持回环监听。

地址或配网配置变化需要重新构建并烧录 `status-client`。若新电脑保留相同可达 IP 且原 Wi-Fi 可用，
现有固件可继续使用；这仍需通过连接与事件确认。
烧录命令见下一节。连接成功须看到有效 `hello version=1` 及设备收到实际事件；
`clients=1` 可能只是浏览器，不能代替串口或屏幕确认。

## 4. 固件工具与已有校准

新电脑重新创建工具环境，所有命令在仓库根目录执行：

```powershell
python -m venv .tmp/hardware-venv
.tmp/hardware-venv/Scripts/python.exe -m pip install esptool==5.4.0 platformio==6.2.0 pyserial
$env:PLATFORMIO_CORE_DIR = "$PWD/.tmp/platformio"
.tmp/hardware-venv/Scripts/python.exe -m serial.tools.list_ports -v
```

以下 COM3 是旧电脑示例，**上传和读取都要改为新电脑核实的端口**；关闭其他占用串口的监视器。

```powershell
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client
.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan -e status-client -t upload --upload-port COM3
.tmp/hardware-venv/Scripts/python.exe scripts/read-device.py --port COM3 --seconds 5 --send v --expect 'firmware version=2026.10.07-r1'
```

本项目只控制 ID 2 俯仰舵机。现有机器人的原厂 zero=599，人工水平 level=591，
工作目标=655（水平 +64 原始单位，约 20°），稳定门槛 350ms，移动时长 900ms。
等待、完成和异常保持已有目标；真实 idle 或断线回水平。
常规上传保留 `indicator-head` NVS；**不要用擦除全部 Flash 来处理普通迁移**。
搬到另一台电脑不需要重新校准同一个机器人；更换机器人则需人工校准，不能复用 591。
串口命令、限位、最多 3 次故障重试与显式恢复见 [头部说明](docs/head-motion.md)。

`screen-demo` 只是屏幕调试；`logic-test` 不初始化舵机、Wi-Fi 或 NVS，
运行后必须恢复 `status-client`。默认环境已是正式 `status-client`。
完整逻辑测试上传/恢复流程见 [固件 README](firmware/stackchan/README.md)。

## 5. 已验证什么，尚未验证什么

最近一次代码及烧录验收为 **2026-10-12**，详见 [验收记录](docs/fix-validation-2026-10-12.md)：

| 验证 | 结果和范围 |
| --- | --- |
| `npm test` | 84 项通过，0 失败、0 跳过；Node/脚本及状态生命周期回归 |
| `npm run build` | TypeScript 检查与 Vite 生产构建通过 |
| `npm run test:contract` | 安装的 app-server schema 中 TurnStatus、ThreadActiveFlag 两个类型匹配；不是完整协议验证 |
| PlatformIO 编译 | status-client、logic-test、screen-demo 三个环境通过 |
| 设备 logic-test | `LOGIC_TEST_RESULT checks=194 failures=0`；完成保持、新事件、去重、重连快照、头部策略等 |
| 正式烧录 | 已恢复 status-client；应用 1,082,800 字节，写入哈希校验通过 |
| 串口 | `2026.10.07-r1`，level/target/raw=591，automatic=1，fault=0，帧缓冲初始化成功 |
| 联网行为 | Wi-Fi 未连上，bridge 客户端为 0；当前版本实屏事件回放未通过验收 |

此前已经验证过的能力仍有参考价值，但不能当作当前固件完成联网验收：

- 2026-09-09：真实 CLI 工作与头部目标 655、真实审批批准后 waiting→thinking→done、
  终止错误后新会话接管、同目标 `x→e` 恢复扭矩。
- 2026-10-06：专用原生交互 CLI 加隔离受控通知，进程退出约 435ms 后释放绑定并发布 idle。
  验证的是实际进程观察和来源集成，不是完整真实模型回合。
- 旧版的完成 5 秒后 idle 已于 2026-10-07 移除；旧规则、183 条断言及其运动回放不能作为新规则验收。

新电脑先运行 `npm test`、`npm run build`、`npm run test:contract` 确认环境；
需要固件修改时再运行相关编译及设备逻辑回归。
迁移文档本身没有再次烧录，也没有重新运行模型或开展长测。

## 6. 按这个顺序继续

1. **恢复网络和实际事件。** 确认新电脑 hooks 信任、bridge、设备 Wi-Fi、固件里的 IP；
   采集串口及 `npm run events:capture -- 60` 的脱敏事件，先确认真实 CLI 可驱动设备。
2. **当前固件联网回放和目视验收。** 检查完成左眼眨一次后长期保持，新事件接管、
   重复完成不覆盖新状态、重连旧完成快照、真实 idle/断线回平，以及点击调试页。
   mock 仅用于受控回放；实机使用 `dev:mock` 前需设置 `AGENT_INDICATOR_HOST=0.0.0.0`，
   开发入口默认只监听 `127.0.0.1`。结束后恢复日常 CLI bridge。
3. **专项实机验收。** 路由器/Wi-Fi 中断恢复、真实审批拒绝、舵机通信/机械故障保护；
   设备断电恢复、模拟审批和纯策略断言不能替代这些场景。
4. **有效连续采样。** `npm run stability -- --minutes 720`；电脑保持唤醒，结束后检查
   summary 中 `elapsedSeconds`、`interrupted`、`failures`、`zeroClients` 和实际记录。
   旧长采样约 10 小时 24 分钟且没有最终 summary，不能记为 12 小时通过。
   烧录、重启或切换来源属于维护窗口，不计为连续稳定运行。
5. **拓展真实 CLI 场景。** 上下文压缩、图像操作、子代理已有映射及代码测试，仍需更广的真实使用验收。

## 7. 接力时要保留的设计边界

- 所有 Agent 状态保持到新事件；不以静默时间推断空闲、完成、失败或 CLI 退出。
- done 左眼庆祝一次并保持笑眼和头部目标；最近 32 个完成 ID 去重；断线覆盖为 offline。
- Stop 表示响应结束，不保证任务成功；同轮明确终止错误可以把 done 更正为 error。
- 审批缺少统一解决回调：按 ID 或输入摘要关联 PostToolUse；无法关联时保守等待到轮次结束。
  相同输入的并行审批存在歧义，不能误清其他等待，也不能替用户批准。
- transcript 是版本相关的本地兼容适配，超过 8MiB 的单条记录会跳过并报告诊断。
- Windows CLI 退出检测使用 PID、创建时间和只读句柄，500ms 检查周期；身份不明或权限不足时降级，
  使用 `doctor` / `session:reset`，不以“没有活动”猜测退出。已识别的 Desktop/app-server/exec 通知不抢占交互 CLI。
- app-server 开发来源创建/管理自己的任务，不监听现有 Desktop 或另一终端里的 CLI。
- 继续使用 v5 银色造型与六态加离线，不恢复旧候选设计、完成计时、前端手动 mock 控制或 legacy 协议分支。

## 8. 代码与文档入口

| 要看什么 | 入口 |
| --- | --- |
| 命令和日常启动 | [package.json](package.json) → [indicator.mjs](scripts/indicator.mjs) → [cli.ts](server/cli.ts) → [index.ts](server/index.ts) |
| hooks 安装与通知 | [install-codex-hooks.mjs](scripts/install-codex-hooks.mjs)、[codex-hook.mjs](scripts/codex-hook.mjs)、[hook-events.json](shared/hook-events.json) |
| CLI 状态与生命周期 | [codexHooksSource.ts](server/sources/codexHooksSource.ts)、[events.ts](server/sources/hooks/events.ts)、[approvals.ts](server/sources/hooks/approvals.ts) |
| 补充观察器 | [terminalFailure.ts](server/sources/hooks/terminalFailure.ts)、[cliExit.ts](server/sources/hooks/cliExit.ts)、[windows-process.mjs](shared/windows-process.mjs) |
| 统一事件与广播 | [agentStatus.ts](src/domain/agentStatus.ts)、[statusProtocol.ts](src/domain/statusProtocol.ts)、[statusBroadcaster.ts](server/statusBroadcaster.ts) |
| app-server 开发接入 | [codexSource.ts](server/sources/codexSource.ts)、`server/sources/codex/` |
| 固件概览 | [固件 README](firmware/stackchan/README.md)：网络任务接收事件，单槽队列传递快照，UI 本地绘制，独立头部策略驱动舵机 |
| 当前规范 | [CLI hooks](docs/cli-hooks.md)、[表情规范](docs/design/expression-design.md)、[v5 预览](docs/design/video-motion-review-v5.html)、[代码样式](docs/code-style.md) |

本次删除已被替代的审查/验收记录、旧阶段归档以及候选、v3/v4、配色审核预览，
必要的现状、来源限制、验收边界和备份信息已整理到当前文档。需要追溯原文时查看 Git 历史 `ffe7102`。
第三方驱动的来源说明、补丁记录和许可证保留。
