# CHANGELOG — v2.0-easyui（Tkinter 极简 UI）

> Fork 自 [ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop)，将 UI 从暗色奢华风格彻底重构为 Tkinter 极简风格。
> 原始项目作者：董子航 (Zihang Dong)

## 版本信息

- **版本号**: v2.0-easyui
- **上游**: [ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop) v2.0.0
- **基于**: v1.0-original 存档（main 分支 tag）
- **分支**: easyui
- **日期**: 2025-07-14

## UI 重构概述

### 替换的文件

| 文件 | 重构前 | 重构后 | 变化 |
|---|---|---|---|
| `index.html` | ~9,800 行（内联所有 overlay） | **29 行** | -99% |
| `src/styles.css` | 34,578 行 | **437 行** | -99% |
| `src/main.js` | 30,861 行 | **966 行** | -97% |
| **合计** | ~75,200 行 | **1,432 行** | **-98%** |

### 删除的装饰模块

- `src/plasma.js` — WebGL Plasma 动态背景
- `src/plasmawave.js` — 波浪 Plasma 效果
- `src/darkveil.js` — 暗色面纱动画
- `src/dither.js` — 抖动效果
- `src/ferrofluid.js` — 铁流体动画
- `src/gradient-waves.js` — 渐变波浪
- `src/lightrays.js` — 光线效果

### 新 UI 特征

- **Tkinter 风格**: 白色/浅灰背景、系统字体、基础控件、微圆角
- **布局**: 侧栏导航（带图标）+ 内容区（分类网格 / 工具表单）
- **通用工具渲染器**: 每个工具用 JSON Schema 描述，渲染器自动生成表单
- **i18n**: 集成完整国际化系统，中英文实时切换
- **微交互**: hover 蓝色边框 + 阴影、focus 高亮、过渡动画
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

1. **UI**: 暗色奢华 → Tkinter 极简（带微圆角和 hover 效果）
2. **代码量**: 75,200 行 → 1,432 行（-98%）
3. **视觉效果**: Plasma/毛玻璃/动画 → 7 个装饰模块全部删除
4. **国际化**: 完整 i18n 集成，中英文实时切换
5. **窗口控制**: 自定义标题栏保留（Tauri decorations=false）
6. **文件选择**: Tauri dialog API 集成
7. **工具页面**: 全屏 overlay → 内联表单 + 通用渲染器
8. **设置页**: 简化为基本表单（语言、AI Key、存储路径）
