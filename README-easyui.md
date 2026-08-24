# ToolKnit Desktop — v2.0-easyui

> Tkinter 极简风格的 ToolKnit Desktop 2.0

## 项目简介

ToolKnit Desktop 2.0 的 UI 重构版本。将原来的暗色奢华 UI（34000+ 行 CSS、30000 行 JS）替换为 Tkinter 风格的极简界面：白底、系统字体、基础控件、零装饰。

## 代码规模

| 文件 | 行数 |
|---|---|
| `index.html` | 32 |
| `src/styles.css` | 338 |
| `src/main.js` | 1,310 |
| **合计** | **1,680** |

## 功能

49 个工具全部注册，覆盖 PDF、PPT、图像、音频、视频、文本、计算器、创意、清理、AI 和硬件 11 个分类。

## 快速开始

```powershell
cd toolknit-desktop
npm ci
npm run tauri dev
```

## 构建

```powershell
npm run build
npm run tauri build
```

## 架构

- **保留**: 全部 `-core.js` 业务逻辑、Tauri 后端、CLI/MCP
- **替换**: index.html + styles.css + main.js
- **删除**: 7 个装饰模块（plasma/darkveil/ferrofluid 等）

## 通用工具渲染器

每个工具用 JSON Schema 描述 UI 需求，渲染器自动生成：
- 文件选择（Tauri dialog）
- 选项控件（下拉框、输入框、复选框）
- 操作按钮
- 进度条
- 结果输出

## 版本历史

- `v1.0-original` — 原始暗色 UI 存档
- `v2.0-easyui` — Tkinter 极简 UI（当前）
