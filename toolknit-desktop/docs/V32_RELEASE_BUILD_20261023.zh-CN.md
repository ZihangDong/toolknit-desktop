# V3.2 正式构建与验证

日期：2026-10-23。此次交付 Windows x64 无签名桌面安装器与 Git 源码快照；当时暂缓 npm 3.2.0 发布。后续于 2026-10-24 完成 npm 发布，见 [npm 发布验证](V32_NPM_PUBLICATION_20261024.zh-CN.md)；下文保留桌面打包时的记录。

## 安装器

- 文件：`toolknit-desktop_3.2.0_x64-setup.exe`。
- 大小：56,889,665 字节，约 54.25 MiB。
- SHA-256：`d3f01e7358d0bec52917a77ca4479f6b6e779646ae6d5cf62aa129537259059b`。
- 安装器与主程序 ProductVersion 均为 `3.2.0`；Authenticode 状态均为 `NotSigned`。
- 主程序 SHA-256：`4a9ff1d8749cb30d39ea362a28d9440e051951d8c319e0e5e516327dddcbc600`。

使用 `npm run build:release-package` 从当前源码重新构建，没有将测试安装器改名。Cargo 实际编译特性为 `custom-protocol`、`default`；无 `qa-devtools`，生产配置关闭 DevTools。资源审计核对 19 个 public 文件、540 个前端文件及 40 个原生资源，未发现私有 Skill、开发预览、source map 或缺失资源。

## 验证

- [GitHub Windows 干净环境检查](https://github.com/ZihangDong/toolknit-desktop/actions/runs/39891641016)通过：前端构建、完整发布套件、Rust 原生测试与依赖审计。对应代码已通过 PR #100 合并主分支。
- 本机完整发布套件 110 项脚本通过，含 1664 项安全检查；隔离安装后的 CLI/MCP、原生转写与最低支持 Node.js 22.13.0 验证通过。这些结果不表示 npm 已发布。
- 正式说明更新后的版本、许可与 QA/DevTools 契约通过；正式构建后再次通过资源和 Windows 安装器契约。
- 使用本次生产载荷生成独立身份的安装器，20 项原生场景全部通过。包括旧程序后台运行、旧安装目录缺失/回退、更换目标目录、WebView2 缺失补装、错误版本、引导器失败、3010 重启返回及卸载所有权。
- 安装后的主程序哈希与本次生产程序一致。测试使用独立目录和注册表项，没有替换用户当前安装，也没有卸载本机 WebView2。
- 当前许可头兼容 Git 的 LF/CRLF 检出，仍拒绝缺失或修改许可。隔离消费测试显式传递已验证 FFmpeg 路径，不依赖源码旁的开发目录。

## 发布内容与边界

- 安装器、干净源码 ZIP 和各自 SHA-256 校验文件随 Release 分发。源码 ZIP 由正式标签对应的 Git 提交生成，不纳入本机忽略或未跟踪文件。
- 更新说明保留旧版本记录；当前段落明确 73 项桌面工具、77 项 CLI/MCP 源码能力及 npm 暂缓状态。PDF 转 Word 独立许可与商业授权联系方式随源码和安装器保留。
- 官网下载页仍需作者同步新版本链接。按用户先发布仓库的安排执行；正式标签出现后，旧版客户端可能提示更新，下载目标仍为官网。
- 没有重新执行无 WebView2 全新虚拟机、真实重启或 Win10/GT730 实机验收。WebView2 失败/重启分支使用隔离桩，不能视为这些环境已经实测。
- 既有大 chunk、浏览器 crypto externalization、Windows linker 及 STATIC_VCRUNTIME 弃用提示保留，不影响此次构建结果。
