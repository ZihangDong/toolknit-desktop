# CHANGELOG — v1.0-original（原始 UI 存档）

> 此分支/tag 保存了 ToolKnit Desktop 2.0 在 UI 重构前的完整状态。
> 后续 easyui 分支将在此基础上进行 Tkinter 极简风格重写。

## 版本信息

- **版本号**: 2.0.0（代码版本）/ v1.0-original（UI 存档标记）
- **存档日期**: 2025-07-14
- **分支**: main（原始状态）
- **Tag**: `v1.0-original`

## 功能清单（49 个工具 · 11 个分类）

### PDF 文档工具（9 项）
PDF 合并 · PDF 拆分 · PDF 转图像 · PDF 编辑器 · PDF 页面旋转 · PDF 文件加密 · PDF 文件解密 · PDF 文件压缩 · PDF 文字增强

### PPT 演示文稿工具（7 项）
PPT 转 PDF · PPT 转图片 · PPT 图片提取 · PPT 文本提取 · PPT 压缩 · AI 生成 PPT 大纲 · AI 生成 PPT 草稿/PPTX

### 图像工具（5 项）
图片格式转换 · 图片压缩 · 长图拼接 · 图标生成器 · 配色提取器

### 音频工具（4 项）
音频格式转换 · BPM 节拍测速 · 音频剪辑 · 音频提取

### 视频工具（3 项）
视频格式转换 · 视频高清单帧图 · 视频截取 GIF

### 文本与转写（3 项）
音视频提取文字 · 文本统计器 · 文本格式化

### 计算器工具（5 项）
体脂率计算器 · 时间戳计算器 · 房贷计算器 · 利息计算器 · 密码生成器

### 创意工具（1 项）
打字测试器

### 清理工具（1 项）
AI 大文件清理

### AI 工作台（4 项）
AI 文字润色 · AI 智能翻译 · AI 文档生成 · AI 表格生成

### 硬件工具（7 项）
整机概览 · CPU 与内存 · GPU 与显示器 · 主板与固件 · 存储健康 · 网络设备 · 电源传感器

## UI 特征（本版本）

- 暗色主题（#060607 底色）
- Plasma WebGL 动态背景
- 毛玻璃光晕卡片效果
- Canvas 着色器动画（darkveil / ferrofluid / gradient-waves / lightrays）
- 自定义无边框窗口 + 圆角裁剪
- 屏幕取色器（全局快捷键 Ctrl+Shift+C）
- 全屏 overlay 工具页
- 完整 i18n（中文/英文 · 3300+ 翻译条目）
- 界面音效系统（3 种风格 · Web Audio API 合成）

## 代码规模

| 文件 | 行数 |
|---|---|
| `index.html` | ~700+（内联所有 overlay） |
| `src/styles.css` | 34,000+ |
| `src/main.js` | 29,893 |
| 装饰 JS 模块（7 个） | ~2,500 |
| `-core.js` 业务模块（~30 个） | ~8,000 |
| `src-tauri/src/lib.rs` | 13,222 |
| `cli/lib/`（MCP + runtime） | ~6,000 |

## 技术栈

- Tauri 2.x (Rust + WebView2)
- Vite 8.x + 原生 JS（无框架）
- pdf-lib / pdfjs-dist / ExcelJS / Chart.js / JSZip
- FFmpeg / Whisper / LibreOffice（按需运行时）
- DeepSeek / OpenAI 兼容 AI Provider
- Lucide 图标库

## 从此版本之后

`easyui` 分支将在此基础上进行 Tkinter 极简 UI 重构：
- 保留全部 49 个 `-core.js` 业务逻辑
- 保留 Tauri 后端 / CLI / MCP
- 替换 index.html + styles.css + main.js
- 删除全部装饰模块
- 窗口缩小至 900×650
