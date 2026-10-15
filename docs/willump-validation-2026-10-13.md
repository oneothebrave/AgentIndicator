# 威朗普表情固件烧录验收

日期：2026-10-13。设备为现有 M5StackChan ESP32-S3 revision v0.2，COM3，16MB Quad Flash；MAC 尾号 30:08。

## 改动与结果

正式固件已更新为 `2026.10.13-r1`，设计标识 `willump-led-v2`，造型依据用户确认的 study 02 预览和六张游戏截图。空闲与完成保持威朗普笑脸；思考改为矩形嘴开合，执行改为双板击球，等待改为方眼平嘴，异常改为红底尖括号眼，离线改为白框红芯电池。

只更换表情绘制和动画时序，保留既有协议、联网配置、完成去重/保持和头部策略。启动日志现在在 Serial.begin 后输出版本及设计标识。

## 编译与设备逻辑测试

- PlatformIO `status-client` 与 `logic-test` 编译通过。
- `npm test`：84 项通过，0 失败、0 跳过；`npm run build` 与 `npm run test:contract` 通过。
- ESP32 实机运行 `LOGIC_TEST_RESULT checks=373 failures=0`。
- 新增动画回归覆盖矩形嘴开/闭与循环、两板 40 次碰撞及水平反向、2000 帧球/板边界、等待眨眼和离线呼吸。
- 既有协议解析、事件展示、完成保持/去重、重连快照与头部策略仍通过。
- 网页预览与旧威朗普方案在空闲、完成的 18 个关键帧绘制操作一致；网页击球及嘴部逻辑检查通过。

## 备份与正式烧录

烧录前保存完整 Flash 到本机 Git 忽略目录：

- 路径：`.tmp/hardware-backups/stackchan-before-willump-20261013-01.bin`
- 大小：16,777,216 字节。
- SHA-256：`72180EB829B6F8A439CB992F0947244642202676B350CF0ADAFC2C60F64A602A`。

先烧录 logic-test 并读取上述通过结果，再恢复正式 status-client。正式应用二进制大小 1,079,008 字节，esptool 报告写入哈希校验通过。最终固件二进制 SHA-256 为 `99E40FDE2DFF327DED9F2289B7A62E211FE1E88D81B30A640CAF6D25B5C9801A`。

烧录后串口确认：

```text
firmware version=2026.10.13-r1 design=willump-led-v2 rise=20deg
face design=willump-led-v2 framebuffer=1
head ready raw=589 factory-zero=599 level=591 automatic=1 rise=20deg
firmware version=2026.10.13-r1 head level=591 target=591 raw=589 automatic=1 fault=0
status-client boot board=27 display=320x240 saved-wifi=0
status-client wifi-retry status=1 saved-wifi=0
```

本机 level=591、原厂 zero=599 和自动模式保留，fault=0；位置反馈 raw=589 与目标 591 略有差异，不表示外部测量过实际角度。没有擦除 NVS 或修改原厂零点。

## 验收边界

USB 烧录成功、版本及帧缓冲均已确认。Wi-Fi 仍未连接，当前由离线电池造型覆盖；尚未完成本版联网七态回放、物理屏幕目视或真实任务联动验收。

编译、上传、设备测试与串口日志保存在 `.tmp/firmware-validation/willump-*-20261013.log`。备份、凭据和固件二进制不提交或上传。
