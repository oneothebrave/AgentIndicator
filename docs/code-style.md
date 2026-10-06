# 代码阅读与排版约定

本项目优先保证逐行 review 时能看清分支、状态变化和资源生命周期。

## 排版

- TypeScript、JavaScript、C++、PowerShell 使用 2 个空格缩进；Python 使用 4 个空格。
- TypeScript / JavaScript 使用双引号、分号和尾随逗号，普通代码以 100 列为排版目标。
- 判断和循环始终使用大括号，包括只有一条 `return` 的分支。保留自然的 `else if`。
- 一行只写一条操作；每个变量单独声明，状态赋值分别展开。
- 参数、对象字段和长条件按结构换行；函数之间、校验和执行阶段之间留空行。
- 长文本、正则、固定坐标表不为了列宽拆成难以阅读的片段。

## 组织与命名

- 回调负责接收事件；较长的路由、校验和处理逻辑使用具名函数。
- 输入先校验，用提前返回减少嵌套。多状态优先级使用具名中间变量或明确分支。
- 协议字段保持协议原名；局部变量表达含义，避免 `v`、`r`、`n` 等模糊名称。
- 图形坐标可以使用 `x`、`y`，其他动画变量应说明时间、进度、目标或透明度。
- 注释解释原因和边界条件，避免逐句复述代码。
- 测试遵循同样排版；保持输入、动作和断言清晰可见。

## 格式化与验证

运行 `npm run format` 整理前端、bridge、Node 脚本和当前设计预览。配置见仓库根目录
`.prettierrc.json`；检查可运行：

```powershell
npx --no-install prettier --check server src scripts shared "docs/design/*.html" index.html package.json tsconfig.json vite.config.ts .prettierrc.json
```

固件使用 clang-format，配置位于 `firmware/stackchan/.clang-format`。
仅整理项目自有头文件和源文件：

```powershell
$firmwareFiles = @(rg --files firmware/stackchan/include firmware/stackchan/src -g '*.h' -g '*.cpp' -g '!config.local.h')
clang-format -i @firmwareFiles
```

Python 和 PowerShell 脚本按上述约定人工维护。第三方库、生成代码、本地配置、
构建输出及历史设计预览不批量格式化。

完成整理后运行 `npm test`、`npm run build`、`npm run test:contract`；
涉及固件源文件时编译相关 PlatformIO 环境。格式整理不应改变状态映射、动画、
网络行为、舵机参数或开发计划中的功能范围。

## 当前核查范围（2026-10-06）

已按本约定核查 58 个 TS/JS 源码、脚本与测试文件、5 个当前 HTML 预览、
12 个项目自有 C++ 头文件/源文件，以及 Python 和 PowerShell 脚本。
本轮补齐测试/动画中的含糊局部命名、连续赋值及嵌套状态判断，坐标仍可使用 x/y。
格式检查和结构检查覆盖排版、大括号、单独声明与单独状态赋值；命名、
函数组织和注释是否易读仍需要人工 review，格式化工具不能代替这部分判断。

第三方固件库、生成代码、本地配置、构建输出、临时诊断文件和历史设计预览
属于上述排除范围，不能将它们描述为已全部按本约定重写。
