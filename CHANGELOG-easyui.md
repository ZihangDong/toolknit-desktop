# CHANGELOG — v2.0-easyui（Tkinter 极简 UI）

> 基于 v1.0-original 存档，将 UI 从暗色奢华风格彻底重构为 Tkinter 极简风格。

## 版本信息

- **版本号**: v2.0-easyui
- **基于**: v1.0-original (v2.0.0 代码)
- **分支**: easyui
- **日期**: 2025-07-14

## UI 重构概述

### 替换的文件

| 文件 | 重构前 | 重构后 | 变化 |
|---|---|---|---|
| `index.html` | ~700+ 行（内联所有 overlay） | **32 行** | -95% |
| `src/styles.css` | 34,000+ 行 | **338 行** | -99% |
| `src/main.js` | 29,893 行 | **1,310 行** | -96% |
| **合计** | ~64,600 行 | **1,680 行** | **-97%** |

### 删除的装饰模块

- `src/plasma.js` — WebGL Plasma 动态背景
- `src/plasmawave.js` — 波浪 Plasma 效果
- `src/darkveil.js` — 暗色面纱动画
- `src/dither.js` — 抖动效果
- `src/ferrofluid.js` — 铁流体动画
- `src/gradient-waves.js` — 渐变波浪
- `src/lightrays.js` — 光线效果

### 新 UI 特征

- **Tkinter 风格**: 白色/浅灰背景、系统字体、基础控件
- **布局**: 侧栏导航 + 内容区（左侧分类列表，右侧工具页面）
- **通用工具渲染器**: 每个工具用 JSON Schema 描述，渲染器自动生成表单
- **零装饰**: 无动画、无毛玻璃、无 Plasma、无图标
- **窗口**: 保持 1400×900（可在 Tauri 配置中调整）

### 保留不变的模块

- 所有 `src/*-core.js` 业务逻辑模块（~30 个）
- `src-tauri/` Rust 后端
- `cli/` CLI + MCP
- `shared/` task-runtime
- `src/i18n.js` + `src/locales/`
- `package.json` + Vite 构建

## 工具注册状态

### Phase 1 已注册（49/49）

全部 49 个工具已在注册表中定义，包括：
- PDF 工具（9 项）
- PPT 工具（7 项）
- 图像工具（5 项）
- 音频工具（4 项）
- 视频工具（3 项）
- 文本工具（3 项）
- 计算器工具（5 项）
- 创意工具（1 项）
- 清理工具（1 项）
- AI 工具（4 项）
- 硬件工具（7 项）

### 部分工具限制

以下工具在极简 UI 中功能受限，需要完整 UI 支持：
- PDF 编辑器（需要可视化编辑界面）
- PDF 文字增强（需要渲染引擎）
- 打字测试器（需要交互式计时界面）

## 从 v1.0-original 到 v2.0-easyui 的变化

1. **UI**: 暗色奢华 → Tkinter 极简
2. **代码量**: 64,600 行 → 1,680 行（-97%）
3. **视觉效果**: Plasma/毛玻璃/动画 → 零
4. **窗口控制**: 自定义标题栏保留（Tauri decorations=false）
5. **文件选择**: Tauri dialog API 集成
6. **工具页面**: 全屏 overlay → 内联表单
7. **设置页**: 简化为基本表单（语言、AI Key、存储路径）
