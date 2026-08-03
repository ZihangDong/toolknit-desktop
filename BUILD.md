# ToolKnit Desktop 构建指南

本文档面向希望从源码运行或构建 ToolKnit 桌面端的开发者。

## 环境要求

- Windows 10/11
- [Node.js](https://nodejs.org/) `20.12.0` 或更高版本
- [Rust](https://www.rust-lang.org/tools/install) stable
- 稳定网络连接，用于下载 npm、Rust 依赖，以及按需下载 FFmpeg/离线识别模型

## 项目位置

仓库根目录用于 README、素材、协议和发布文档；桌面端源码位于内层目录：

```text
toolknit-desktop/
└── toolknit-desktop/
    ├── src/
    ├── src-tauri/
    ├── cli/
    ├── docs/
    └── package.json
```

## 开发模式

```powershell
git clone https://github.com/ZihangDong/toolknit-desktop.git
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run tauri dev
```

开发服务器启动后会自动打开应用窗口。前端代码修改后会热更新；Rust/Tauri 后端代码修改后通常需要重新编译。

## CLI 本地测试

```powershell
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run cli -- doctor
npm run cli -- help
npm run cli -- help pdf split
```

MCP/Agent 说明见：

- [toolknit-desktop/docs/cli-agent.md](toolknit-desktop/docs/cli-agent.md)
- [toolknit-desktop/docs/agent-guide.zh-CN.md](toolknit-desktop/docs/agent-guide.zh-CN.md)
- [toolknit-desktop/docs/agent-guide.en.md](toolknit-desktop/docs/agent-guide.en.md)

## 生产构建

```powershell
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run build
npm run tauri build
```

构建产物位于：

- 可执行文件：`toolknit-desktop/src-tauri/target/release/toolknit-desktop.exe`
- NSIS 安装包：`toolknit-desktop/src-tauri/target/release/bundle/nsis/`

## FFmpeg 与离线模型

v1.2 不要求把 FFmpeg 或 Whisper 模型提交进仓库。桌面端会在进入相关功能时提示用户去设置中按需下载，支持官方源和镜像源。

如果你正在开发音视频相关能力，可先在桌面端设置页下载依赖；也可以使用 CLI 的依赖检查能力确认状态：

```powershell
npm run cli -- doctor
```

不要提交以下内容：

- `ffmpeg.exe`
- Whisper 模型文件
- 构建产物
- 用户输出文件
- API Key、Token、密码或个人凭据

## 常见问题

### 构建时提示依赖缺失

先执行：

```powershell
npm ci
npm run cli -- doctor
```

如果是音视频工具缺少 FFmpeg，请进入桌面端设置页下载，或按 CLI 提示补齐依赖。

### Rust 编译很慢

首次编译需要下载和构建较多依赖，时间会比较久。后续增量编译会明显变快。

### 提示 exe 正在运行无法覆盖

关闭 ToolKnit 窗口后它可能仍在系统托盘后台运行。请从 Windows 右下角托盘菜单显式退出，或在开发机上执行：

```powershell
taskkill /F /IM toolknit-desktop.exe
```

### 网络问题导致依赖下载失败

可以在桌面端设置页选择镜像源。Rust crates 下载慢时，可按需配置国内镜像，例如 rsproxy 或中科大镜像。

## 需要帮助

- [README.md](README.md)
- [GitHub Issues](https://github.com/ZihangDong/toolknit-desktop/issues)
- [toolknit.com](https://toolknit.com)
