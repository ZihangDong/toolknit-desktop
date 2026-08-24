# ToolKnit Desktop — v1.0-original 存档

> 这是 ToolKnit Desktop 2.0 UI 重构前的完整存档版本。

## 项目简介

ToolKnit Desktop 2.0 是一套面向 Windows 的本地文件工作台，提供 49 个桌面工具、CLI 批处理和 MCP Agent 能力。

## 快速开始

```powershell
cd toolknit-desktop
npm ci
npm run tauri dev
```

要求：Windows 10/11、Node.js 20.12.0+、Rust stable（构建原生端时需要）。

## 工具列表

49 个工具覆盖 PDF、PPT、图像、音频、视频、文本、计算器、创意、清理、AI 和硬件 11 个分类。

详见 [CHANGELOG-v1.0-original.md](CHANGELOG-v1.0-original.md) 中的完整功能清单。

## 构建

```powershell
npm run build
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/nsis/`。

## 后续计划

`easyui` 分支将把 UI 重构为 Tkinter 极简风格，保留全部业务逻辑。
