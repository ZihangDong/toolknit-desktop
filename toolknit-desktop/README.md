# ToolKnit Desktop 3.0

本目录是桌面应用与 CLI/MCP 的开发工作目录，包含 Vite 前端、Tauri / Rust 原生运行时、工具模块与测试。

完整产品介绍、68 项桌面工具、3.0 更新、下载入口和隐私说明统一维护在[仓库首页](../README.md)；英文介绍见 [English README](../README_EN.md)。

## 开发环境

- Windows 10 1803（内部版本 17134）及以上，或 Windows 11。
- 推荐 Node.js 24；Vite 8 要求 Node.js 20.19+ 或 22.12+。
- 构建原生应用需要 Rust stable 1.90+、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

从仓库根目录进入本目录后运行：

```powershell
Set-Location toolknit-desktop
npm ci
npm run tauri dev
```

仅预览前端可运行 `npm run dev`。浏览器预览不能代替依赖 Windows 原生能力的桌面测试。详细环境说明见[构建指南](../BUILD.md)。

## CLI / MCP

在本目录暂存本地运行资源，然后检查 CLI 环境：

```powershell
npm run stage:cli-resources
npm run --silent cli -- doctor --json
npm run --silent cli -- --help
```

CLI 使用说明、MCP 配置与输入输出契约见 [CLI / MCP 文档](docs/cli-agent.md)和[中文 Agent 手册](docs/agent-guide.zh-CN.md)。桌面端保存的 AI Key 不会自动共享给 CLI/MCP；凭据按各自文档配置，不应写入源码或提交记录。

## 验证

```powershell
npm run test:architecture
npm run test:security-release
npm run test:cli
npm run build
```

完整发布回归使用 `npm run test:release`；涉及原生运行时时追加 `cargo test --manifest-path src-tauri/Cargo.toml`。构建产物位于 `dist/` 与 `src-tauri/target/`，不进入源码提交。

## 维护文档

- [V3 维护规范](docs/V3_MAINTENANCE_GUIDE.zh-CN.md)
- [架构报告](docs/V3_ARCHITECTURE_REPORT.zh-CN.md)
- [AI 文档工程规范](docs/ai-document-project-spec.md)
- [贡献指南](../CONTRIBUTING.md)
- [安全报告](SECURITY.md)
- [更新日志](CHANGELOG.md)
- [代码签名政策](../CODE_SIGNING_POLICY.md)

源码采用 [Apache License 2.0](LICENSE)，品牌与第三方组件说明见 [NOTICE](NOTICE)。
