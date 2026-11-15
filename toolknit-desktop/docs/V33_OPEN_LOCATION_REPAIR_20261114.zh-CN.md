# V3.3 文件定位修复（Issue #124）

2026-11-14。[用户反馈](https://github.com/ZihangDong/toolknit-desktop/issues/124)：AI 大文件清理的候选项右键“打开所在目录”，有时进入“文档”。

## 定位与实现

前端传入的是完整 `candidate.path`，问题在通用原生打开逻辑。旧实现把规范化后的文件路径拼成一个 `/select,...` 参数；Rust 的 Windows 参数编码会为含空格的整个参数加引号，Explorer 的解析规则不同。实机对照中普通文件可定位，空格文件进入“文档”，逗号文件无法正确选中。进程创建成功不足以证明目标已定位。

- `src-tauri/src/native_runtime/office/files.rs`：`open_path`、`reveal_in_folder` 保留名字、参数及返回契约，转入后台执行现有路径校验及系统定位，避免等待 Shell 时占用界面线程。
- `src-tauri/src/platform/file_location.rs`：复用文件搜索已有的 Shell/PIDL 边界。文件使用 `SHOpenFolderAndSelectItems` 精确选中；目录以验证过的目录 PIDL 调用 `ShellExecuteExW` 打开自身。保留 COM/PIDL 清理及规范化路径、UNC、Unicode、NUL 和长度边界。
- 空选择的 `SHOpenFolderAndSelectItems` 会打开父目录并选中该目录，不能用于“进入此文件夹”。实测发现这一差异后改为目录专用调用，补充独立空目录用例。
- 文件搜索仍按原结果租约及范围检查后定位；权限、索引、服务和缓存策略不变。PDF、图片、PPT 等调用通用命令的结果入口同步获得修复。

仍只接受已存在的绝对文件/文件夹路径。不存在、相对路径、Shell 协议及无效输入报错，不回退到用户的默认目录；文件定位不启动该文件。

## 验证

- `test-output-reveal-contract.mjs`：检查各工具继续传真实结果路径，并统一经原生边界，禁止恢复 Explorer 参数拼接或误用空选择。
- `test-cleanup-large-file-browser.mjs`：真实控制器、文件名按钮和右键入口均传完整中文/空格/逗号路径；原主题、AI、取消、重开等回归通过。
- Rust 路径单测：本地及 UNC 前缀、中文/非 BMP 字符、空格/标点、相对路径、NUL、超长与缺失路径。
- `scripts/qa-open-location-native.ps1`：显式运行隔离合成文件测试，以资源管理器实际文件夹及选中项作为判据，不只检查 API 返回。10 项通过：普通文件、空格、逗号、中文及特殊标点、嵌套路径、目录自身、旧命令别名、文件搜索共用边界、脚本及快捷方式。文件哈希不变，脚本未执行，测试窗口及临时文件已清理。

- `test:architecture`、桌面集成与双语审计、`git diff --check` 通过。
- `test:release` 全部 115 个脚本通过，含前端构建、2,017 项安全检查、CLI/MCP 回归及发布资源审计；独立安装测试加载 213 个纯模块并验证 78 个 MCP 工具。
- 完整 Rust 测试 329 通过、31 忽略。新增 Explorer 交互用例默认忽略，已通过上述显式原生 QA 单独执行；保留既有 Windows linker 提示。

本机 Windows 实测通过；UNC 为格式单测，未在本轮建立真实共享或验证反馈用户的电脑。macOS/Linux 打开策略沿用既有实现，未做这些系统的实机验证。

本轮无新工具、界面、存储、事件、Tauri 命令、CLI/MCP 参数或依赖。更新 V3.3 未发布日志及简短维护规则；未改版本、打安装包或发布修复。
