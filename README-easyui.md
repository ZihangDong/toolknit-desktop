# ToolKnit Desktop — easyui

> 基于 [ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop) Fork 的极简 UI 改版

## 项目来源

本项目 Fork 自 [ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop)（ToolKnit Desktop 2.0），在此基础上进行了 UI 层的全面重构——将原来的暗色奢华 UI 替换为 Tkinter 风格的极简界面。

**原始项目的全部业务逻辑（`*-core.js`）、Tauri Rust 后端、CLI/MCP 均完整保留**，仅替换了 UI 表现层。

原始项目作者：[董子航 (Zihang Dong)](https://github.com/ZihangDong)

## 改动范围

| 改动 | 说明 |
|---|---|
| `index.html` | 9,806 行 → 29 行（-99%） |
| `src/styles.css` | 34,578 行 → 437 行（-99%） |
| `src/main.js` | 30,861 行 → 966 行（-97%） |
| 装饰模块 ×7 | 1,937 行 → 全部删除 |
| 旧 UI 模块 ×8 | ~7,000 行 → 全部删除 |
| 测试脚本 ×40+ | 全部删除 |
| 文档/截图/字体 | 全部删除 |
| **UI 代码总计** | **75,200 行 → 1,432 行（-98%）** |
| **仓库文件数** | **300 → 177（-41%）** |

## 功能

49 个工具全部保留，覆盖 PDF、PPT、图像、音频、视频、文本、计算器、创意、清理、AI 和硬件 11 个分类。

## 快速开始

```powershell
git clone <本仓库地址>
cd toolknit-desktop\toolknit-desktop
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`

## 构建桌面端

需要 Rust 工具链：

```powershell
npm run build
npm run tauri build
```

## 架构

- **保留**: 全部 `-core.js` 业务逻辑、Tauri 后端、CLI/MCP、i18n
- **替换**: index.html + styles.css + main.js（UI 层完全重写）
- **删除**: 7 个视觉装饰模块（plasma/darkveil/ferrofluid 等）
- **新增**: 通用工具渲染器（JSON Schema 驱动表单自动生成）

## 开源协议

本项目沿用原项目的 [Apache License 2.0](LICENSE)。
