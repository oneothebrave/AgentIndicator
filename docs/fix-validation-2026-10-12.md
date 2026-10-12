# 事件驱动固件更新与烧录验收

日期：2026-10-12。基线提交为 `710bf9e`，烧录前设备运行 `2026.10.06-r1`。
当前正式源码及已烧录固件为 `2026.10.07-r1`，设备为现有 M5StackChan ESP32-S3、COM3、16MB Flash。

## 本轮改动

- 移除完成后 5 秒自动 idle 的计时与展示状态；所有 Agent 状态保持到下一条事件，连接断开覆盖为 offline。
- 保留最近 32 个完成 ID 的去重，重复完成不覆盖后续状态；重连的旧完成快照仍展示 done。
- 完成保持已有头部目标，真实 idle 或断线才回水平；保留工作抬头 20°、350ms 稳定门槛和 900ms 移动。
- 更新固件逻辑回归及相关文档。
- 将启动脚本新增的路径输出整理为启动诊断，消除被其他脚本导入时顶层打印项目路径的副作用。

## 自动回归

- `npm test`：84 项通过，0 失败，0 跳过。
- `npm run build`：TypeScript 检查与 Vite 生产构建通过。
- `npm run test:contract`：安装的 Codex app-server schema 契约通过。
- PlatformIO `status-client`、`logic-test`、`screen-demo` 三个环境编译通过。
- JavaScript 修改通过 Prettier 检查；导入 `indicator.mjs` 不产生顶层日志。

首次在受限沙箱中运行时，本机网络、文件实际路径和 ESP32 工具链访问受限；
相关测试与构建在允许本机访问的执行环境中重跑通过，没有修改测试以绕过失败。

## 备份、测试与正式烧录

1. esptool 确认设备为 ESP32-S3 revision v0.2、16MB Quad Flash。
2. 烧录前保存完整 16,777,216 字节 Flash 备份至本机忽略目录
   `.tmp/hardware-backups/stackchan-pre-20261012.bin`。
3. 烧录 `logic-test` 并读取 `LOGIC_TEST_RESULT checks=194 failures=0`。
   测试不初始化舵机、Wi-Fi 或 NVS。
4. 恢复并烧录正式 `status-client`，esptool 报告写入哈希校验通过。
   正式应用二进制为 1,082,800 字节。
5. 串口确认 `firmware version=2026.10.07-r1`，以及
   `head level=591 target=591 raw=591 automatic=1 fault=0`。
   帧缓冲初始化成功；本机舵机校准保留。

日志与备份保存在 `.tmp/`，不提交或上传；本地配网配置和固件二进制也不进入 Git。

## 联网状态与验收边界

日常 CLI bridge 已启动，`doctor` 确认 bridge 与 hooks 接收端正常。
设备在烧录前后均报告 Wi-Fi 重试 `status=1`，尚未连上已配置的网络；
bridge 客户端数量为 0。因此本轮没有完成联网事件回放、实际完成表情保持或头部事件运动的实机验收。

194 条设备逻辑断言验证了完成保持、新事件切换、去重、重连快照和完成期间头部策略。
这些结果与串口版本确认不能代替屏幕目视、联网回放、真实模型任务、路由器断网或机械故障验收。
12 小时连续采样及专项物理验收仍见 [开发计划](development-plan.md)。
