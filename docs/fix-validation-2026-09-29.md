# 维护修复验收 · 2026-09-29

已按 [本轮审查报告](code-review-2026-09-29.md) 完成代码修复、回归测试和文档整理。未创建提交、未发起额外模型测试任务。代码验收后，已按用户追加指令完成正式固件烧录，详见文末。

## 修复结果

| 项目 | 处理 | 验证 |
| --- | --- | --- |
| app-server 管道异步错误导致退出 | 监听 stdin/stdout/stderr 错误；统一终结传输并拒绝挂起请求；幂等报告，正常退出等 stdio 关闭后处理 | 本地子进程写入 EOF 与退出竞争、最终通知排空、挂起请求拒绝通过 |
| 启动超时后状态被迟到通知恢复 | 明确停止当前 app-server 来源，只报告一次来源错误；停用实例的回调不再发布事件 | 假 app-server 延迟回复/继续发送通知场景通过；主动停止及重启隔离通过 |
| 采集器忽略 HOST | 与启动器共享 bridge 地址与端口配置，IPv6 URL 加方括号；只读采集不依赖 hooks 端口配置 | 默认 IPv4、指定 127.0.0.2、IPv6、主动断线摘要和内容脱敏通过 |
| 默认固件选中 demo | 默认环境设为 status-client | 配置回归通过，未指定 `-e` 的实际编译选择正式环境 |
| watcher 降级未刷新诊断 | 比较 observer phase/error 和两端健康状态，不比较 lastReadAt | 失效、恢复、错误原因变化和避免刷屏通过 |
| 同会话新轮被旧 reset 清除 | reset 同时比较 sessionId/turnId；HTTP 必须提供两项 | 纯状态及 HTTP 的旧轮冲突、缺字段拒绝、正常重置通过 |
| 闲置同步读接口释放数组错误 | 改为 delete[]，在 vendored README 记录补丁 | 固件编译通过；该接口当前不在 HeadMotion 调用路径中，本轮没有硬件执行此接口 |
| 冗余代码与配置 | 删除无效果 mapItemCompleted 函数、未使用工具名字段、重复动态 import；统一 hooks 清单 | 类型检查与现有工具完成/并行审批回归通过 |
| 无作用 SessionStart 通知 | 共享清单标记为 false；安装器迁移时清理旧注册；旧客户端请求仅忽略 | 安装升级、幂等、保留其他 handlers/matchers、备份及无效配置保护通过 |
| 说明与外观版本混杂 | 固件首页更新银色/深红/灰色说明，sleep 别名明确显示 idle；区分源码版本与已烧录版本 | 文档与当前渲染映射核对 |

`mapItemCompleted()` 虽已删除，`item/completed` 通知仍进入 CodexLifecycle 清理工具，并恢复当前其他活动。没有删除完成事件处理。

启动超时的 error 表示“本 bridge 已停止该 app-server 来源”，不等同于已证明模型任务失败或所有外部命令被撤销。修复没有改变普通 CLI hooks 的状态语义。开发来源发生这类错误后，重新启动 bridge 恢复连接。

## 自动化结果

- `npm test`：**72 项通过，0 失败、0 跳过**，较修复前新增 18 项。
- `npm run build`：TypeScript 检查与 Vite 构建通过。
- `npm run test:contract`：与本机 Codex CLI 0.153.4 的 TurnStatus / ThreadActiveFlag 匹配；仍只验证这两个类型。
- `.tmp/hardware-venv/Scripts/python.exe -m platformio run -d firmware/stackchan`：通过，默认选中 `status-client`。RAM 52,424 字节，程序 1,081,337 字节。
- `git diff --check`：通过。

新固件源码版本为 `2026.09.29-r1`。本地编译产物 SHA-256：`99f4041f8560b77fd42f3f9f8d53eda88c30ba523d8c8c8a38d0016bc4122bab`。产物使用本地硬件配置，不提交或公开二进制。

开发回归使用本地假 app-server 和独立回环服务，没有把合成事件发给机器人。EOF 回归具体覆盖写管道与子进程退出的竞争；不声称已经验证所有平台的管道关闭顺序。

## 本机应用情况

已更新项目 `.codex/hooks.json`，备份为 `.codex/hooks.json.1790658155101.bak`。比对确认：本项目的 SessionStart 注册已移除，其余事件定义逐项一致。未修改用户级 hooks。已打开 CLI 是否缓存旧清单取决于其加载时机；新版 bridge 会安全忽略旧 SessionStart 通知。

检查时本机没有运行中的 bridge，因此没有重启或中断已有服务。日常启动仍为：

```powershell
cd E:\AgentIndicator
npm start
```

另一终端正常运行 `codex`。bridge 与启动脚本应一起使用本次代码；新版重置接口要求 expectedSessionId 和 expectedTurnId，避免旧请求误清新轮。

代码验收阶段未烧录；随后按用户指令升级了设备，当前串口确认版本为 `2026.09.29-r1`。本次固件未改变表情几何、颜色、动画时序或工作抬头 20°策略。

## 仍独立于本次代码修复的验收

ESP32 120 条逻辑断言、真实舵机通信故障、路由器断网、实屏帧率与 12 小时连续长测未在本轮重跑。既有 hooks 审批回调和 transcript 版本依赖等来源限制也仍存在，不能由这次 72 项测试推断消失。它们不影响本报告中代码修复的完成结论。

## 追加烧录验收（2026-09-29）

- COM3，ESP32-S3 revision v0.2，USB 标识/MAC 为 7c:4f:ad:ae:30:08，与此前设备一致。
- 显式选择 status-client 完成上传，1,081,696 字节，esptool 写入哈希校验通过并复位启动；没有擦除 Wi-Fi 或头部校准 NVS。
- 串口 `v` 确认 `firmware version=2026.09.29-r1`。头部水平基准 591，工作目标 655，稍后位置反馈 649，automatic=1、fault=0；这是位置读数，不替代实际角度和机械声音验收。
- 已在后台启动新版 CLI bridge（通过 scripts/indicator.mjs 日常启动器）。doctor 显示两端健康、1 个 WebSocket 客户端、终止错误监听正常；设备串口同步收到真实 `command.started`、origin=codex。没有注入 mock 事件或修改会话绑定。
- 串口证据：`.tmp/firmware-validation/flash-2026-09-29.log`、`flash-2026-09-29-head.log`。服务日志：`.tmp/bridge-flash-20260929.log`，错误日志为空。
- 本次未额外进行整套表情目视验收、断网和长测。
