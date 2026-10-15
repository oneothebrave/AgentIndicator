# 离线叉眼笑脸更新与烧录验收

日期：2026-10-15。目标仓库为 [oneothebrave/Willump](https://github.com/oneothebrave/Willump)，设备为现有 COM3 M5StackChan ESP32-S3 revision v0.2、16MB Quad Flash。

## 最终行为

固件 `2026.10.15-r1`、设计标识 `willump-led-v3`：连接断开或未收到合法 hello 时，显示用户确认的青蓝叉眼与弧形笑嘴。图案固定显示，沿用深蓝底、4 px 点阵间距和 3×3 px 亮芯；底部保留暗色连接点。原白框红芯电池及呼吸动画已移除，避免把离线误解为低电量。

其他六态、协议映射、完成去重/保持、网络配置与头部策略沿用前版。七态预览已同步更新，确认图见 [离线示意图](design/offline-cross-eyes-preview.png)。

## 自动与设备验证

- PlatformIO `status-client`、`logic-test` 编译通过。
- ESP32 实机：`LOGIC_TEST_RESULT checks=371 failures=0`。从前版 373 条移除两条已不存在的电池呼吸断言，其他动画、协议、完成展示与头部策略回归仍通过。
- `npm test`：84 项通过、0 失败、0 跳过；`npm run build` 与 `npm run test:contract` 通过。
- 当前网页离线绘制与用户确认的示意图逐像素一致，比较排除底部连接点的浏览器抗锯齿差异。

## 备份、烧录及串口

烧录前完整 Flash 备份保存在本地 Git 忽略目录：

- `.tmp/hardware-backups/stackchan-before-offline-20261015-01.bin`
- 大小：16,777,216 字节。
- SHA-256：`FACE11B1C8685607A9B021CE76ACA853CFD0A30F47C8795540D8DC9D0FBA5A48`。

先运行逻辑测试固件，再恢复正式 status-client。应用二进制为 1,078,960 字节，写入哈希校验通过；最终二进制 SHA-256 为 `EE028957F718F4D55E4256B4861F50E9371C1D2FD0C72462387CA348FC506D4E`。

启动串口确认：

```text
firmware version=2026.10.15-r1 design=willump-led-v3 rise=20deg
face design=willump-led-v3 framebuffer=1
head ready raw=590 factory-zero=599 level=591 automatic=1 rise=20deg
head target=591 from=590 duration=900ms
```

本机水平 level=591、原厂 zero=599、自动模式保留，fault=0。没有擦除 NVS，也没有重新校准舵机。

## 验收边界与本地证据

串口版本与帧缓冲初始化已确认。设备仍未连接 Wi-Fi，因此固件按离线状态绘制叉眼笑脸；物理屏幕观感、联网六态回放及真实任务联动仍待目视/联网验收。

构建、备份、上传与串口日志保存在 `.tmp/firmware-validation/offline-*-20261015.log`。凭据、Flash 备份、构建二进制和本地日志不提交到 GitHub。
