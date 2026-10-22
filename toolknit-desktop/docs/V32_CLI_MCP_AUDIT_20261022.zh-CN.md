# V3.2 CLI / MCP 能力补齐与验收

后续补充：同日用户另行提供模型配置，已完成[真实 AI 验证与修复](V32_CLI_AI_LIVE_20261022.zh-CN.md)。最新本地归档与实测结论以该报告为准，下文保留此前阶段的时间点和验证范围。

开始：2026-10-22 15:32，完成：18:42（Asia/Shanghai），累计约 3 小时 10 分钟，满足用户要求的至少 3 小时、最多 5 小时。本轮实现与验收完成；V3.2 与 npm 均保持未发布。

结果：CLI/MCP 从 46 项扩展到 77 项，新增 31 项；73 个桌面工具逐项明确覆盖与限制。最终 108 项发布脚本、1,648 项安全检查、Node 22.13/24.19 独立安装与官方 MCP SDK 验证通过；Rust 为 260 passed / 11 ignored。最终本地 npm 归档和校验值见下文。

## 基线与边界

- Git 分支 V3.2，桌面与 CLI 内部版本 3.2.0，均未发布；当前 73 个桌面工具、12 个分类、46 项 MCP 能力。
- 现有 Windows 安装器修复保留。本任务不推 GitHub、不发布 npm、不创建 Release，不操作真实用户剪贴板或安装数据。
- 当前 `test:cli` 基线通过，证据 `tmp/v32-cli-baseline-20261022.log`。旧文档仍有 V2.3 / Node 20.12 等过时描述，须按实际依赖修订。
- CLI/MCP 复用导出的纯逻辑或无界面运行时，不调用桌面窗口或读取桌面 AI 密钥。输出显式指定，默认不覆盖源文件；外部 AI 仅在主动调用相关能力并提供独立环境配置时使用。

## 工作顺序

1. 对全部桌面工具建立覆盖表，区分现有、新增、部分支持和保留桌面；每项说明实际限制。
2. 统一能力发现、参数校验与 CLI 入口，修复消息边界、取消、异常和文件写出问题。
3. 优先补齐 PDF 转 Word、图像转 PDF、PDF 文本/页面处理，再补图像、文本、开发者与计算工具。依赖外部模型或平台原生引擎的能力单独评估，不把不能独立运行的接口列为可用。
4. 为新增工具加入真实小文件成功、非法参数、路径/覆盖拒绝、损坏文件和取消验证；复测现有能力。
5. 打出本地 npm 归档，在独立消费目录安装并验证 CLI/MCP；检查包内容、许可、依赖最低版本、可选平台依赖和离线资源。
6. 同步中英文指南、能力计数、更新日志、维护规范和已验证的私有 Skill 经验，运行发布门禁，形成最终报告。

## 验收约定

成功退出或 `tools/list` 中出现名称不等于能力验证通过。文件类能力核对输出格式、内容/页数/尺寸、源文件哈希和失败后残留；AI 结构测试与真实联网验证分开记录；Windows 实测不冒充 macOS/Linux 实测。需要 GPU/模型、GUI 实时交互、隐私监听或系统破坏性操作的能力不能为了数量硬凑。

最终清单、实际改动、测试证据和未覆盖环境将在实施过程中补充。

## 阶段记录

### 17:05 首轮实现与独立包验证

- 已接通 31 项新增能力，共 77 项。73 个桌面工具的覆盖表已生成，见 [CLI_CAPABILITIES.md](CLI_CAPABILITIES.md)。新增接口使用独立 headless 模块，不把业务加入应用组合根或 GUI。
- PDF 转 Word复用同一来源分析、图像资产、版式和 DOCX 引擎；AI 布局复用同一范围/响应验证。重计算最多两个 Worker，输出在主进程检查取消后原子发布。
- 已通过新能力真实 PDF/DOCX/图片/像素/页数/Excel/Markdown 验证。LibreOffice 使用本机真实运行时；AI 使用本地模拟 OpenAI-compatible 服务，已覆盖完整调用/结构校验/取消与错误，不称为真实远端模型效果验收。
- 新协议测试覆盖初始化、超大消息尾部、输出上限、重复 ID、并发、进度、取消、EOF 清理。统一 JSON Schema 检查暴露并补全了原有 AI 表格撤销、文档整体样式、图表列参数等漏项。
- 独立 npm 归档安装发现并补齐 `@pdf-lib/fontkit` 依赖。当前源码快照消费测试随后通过，实际运行 CLI DOCX、MCP 图像 PDF、77 项枚举；日志 `tmp/v32-cli-clean-consumer.log`。
- 官方 npm audit 查到初选 Sharp/Yauzl 版本的已知问题，已调整至 Sharp 0.35.5 / Yauzl 3.4.0；当前 CLI shrinkwrap 生产依赖 audit 为 0 项，日志 `tmp/v32-cli-audit-patched.json`。后续还将核对消费安装后的实际依赖。
- 继续进行最低 Node 版本、官方 SDK、原有 46 项回归和全量发布门禁；尚未完成最终验收，不发布 npm/GitHub。

## 已实现范围

当前注册表为 **77 项，较 46 项增加 31 项**。桌面清单核对了全部 73 个 ID：60 项支持、6 项部分支持、7 项保留桌面。接口数量包含工程编辑、检查和模型管理，不等于桌面工具卡片数量。

| 新增组 | 数量 | 实际能力 |
| --- | ---: | --- |
| PDF | 6 | 转 Word（原版式/A4、可选 AI 布局）、本地文本/Markdown、裁剪、页码、扫描效果、新建空白 PDF |
| 图像 | 6 | 图像转 PDF、格式转换、压缩、裁剪、颜色替换、图标 ZIP |
| AI | 3 | 文本润色、原文对齐翻译、视觉 PDF 转 Markdown |
| Office/Markdown | 2 | XLSX 转 PDF、安全独立 HTML |
| 文本/开发者/计算 | 12 | 文本整理、JSON、Base64、URL、UUID、JWT 解析、校验和、时间戳、BMI、房贷、利息、颜色空间 |
| 文件扫描 | 2 | 大文件与重复文件只读扫描 |

部分支持的六项：Excel 仅 XLSX；PDF 编辑器提供空白页与页面操作；Markdown 提供导出；两个清理工具只扫描；加密工具只开放校验和。保留桌面的七项：快速截图、剪贴板历史、提词器、打字测试、密码生成、系统盘清理、抠图。抠图目前依赖桌面 Rust 的模型/推理生命周期，独立 npm 包没有第二套未经验证的推理栈；本轮不假装已开放。

## 本轮查出的实际问题

1. 独立 npm 安装缺少 `@pdf-lib/fontkit`，导致 Word 转换失败；已声明依赖，并在独立消费目录加载全部 123 个纯模块。
2. ExcelJS 的 UUID override 只在开发项目生效，用户安装仍得到旧依赖；现捆绑锁定 ExcelJS 树，仅修正其 UUID 依赖元数据至 11.1.1，保留 MIT 许可并在 NOTICE 明示。消费项目实际 audit 为零，不再只看源码 shrinkwrap。
3. 原有 Schema 漏掉文档整体样式、表格撤销和图表列参数；已补全，未知字段仍拒绝，原 `operationIndex` 错误契约保留。
4. MCP 超大消息可能残留尾部；大结果输出未统一走断连/背压保护。现分别限制输入/响应、丢弃超大行到换行、取消 EOF 活动任务，并使用官方 SDK 验证。
5. 旧 PDF 合并/拆分/旋转/加密/增强和硬件注册适配存在取消信号未透传；已接通取消、发布前检查和增强画布清理。拆分已完成的页会明确保留，取消不会继续提交后续文件。
6. Windows 中文模型路径导致原有 CLI Whisper 实际失败；现沿用桌面端思路，将原生引擎参数映射到 ASCII 工作区。单独工作区限制当前用户 ACL；结果仍写用户明确目录，源文件/原模型不修改。真实合成语音已通过识别与取消测试。
7. 模型安装缺少同目标互斥及续传位置核验；新增跨 CLI 进程锁、死进程锁恢复、Content-Range/大小/SHA-256 校验、每来源 15 分钟超时，失败保留旧模型。CLI 使用独立 `.cli.part`，不覆盖桌面下载的 `.part`。
8. CPU/内存兜底条件写反，系统查询不可用时没有填入 Node 基础数据；已修复，并在隔离 PATH、缺少 PowerShell 的子进程验证实际字段。
9. 时间戳会接受 2 月 30 日并自动顺延；现按闰年和日期范围拒绝。开发者/计算分组帮助遗漏新命令，也已补齐。
10. 桌面帮助中心仍宣称 46 项、Node 20.12，以及多项新能力“桌面专用”；中英文概览、CLI 与 Agent 章节已同步，帮助测试直接对照真实 MCP 注册表数量，防止再次遗漏。

## 文件与契约

- `cli/lib/tool-definitions.mjs`、`extended-tools.mjs`、各分类 `*-tools.mjs`、`schema-validation.mjs`：注册与校验；`catalog-cli.mjs`：直接命令、帮助和通用 JSON 调用。`tools list/describe/coverage` 与 `run` 共用同一注册表。
- `document-worker*.mjs`、`document-engine.mjs`、`image-engine.mjs`、`pdf-word-engine.mjs`：重计算和现有核心适配；最多两个文档 Worker，10 分钟任务上限。原 GUI、Tauri command 和桌面存储没有变化。
- `safe-files.mjs` / `fs-safety.mjs`：输入大小、符号链接/目录连接、硬链接别名、原子发布和取消保护；输出失败保留旧结果。
- `model-download.mjs`、`transcription-workspace.mjs`、`transcription-runtime.mjs`、`hardware-runtime.mjs`：旧原生能力的可靠性修补。
- `prepare-cli-package.cjs`、`stage-cli-resources.cjs`、`test-cli-current-package.mjs`：资源、许可、锁定捆绑、当前源码快照、独立安装和实际调用。
- `scripts/sync-cli-catalog.mjs` 生成双格式能力表并核对桌面 ID；README、双语 Agent 指南、维护规范、架构报告、根 changelog 同步。私有 Skill 只更新用户技能目录。
- `src/help-data.js` / `help-data-en.js` 更新桌面帮助正文；复用既有帮助组件，不改布局、主题或导航，新增/移除工具边界与 CLI 清单一致。
- 原有 CLI/MCP 名称保留。PDF-to-image 额外支持横向长图和 4/9 页田型；`doctor` 增补 Node、能力数、LibreOffice 字段，原 qpdf/FFmpeg 退出状态保持兼容。

## 验证证据

| 检查 | 证据/实际边界 |
| --- | --- |
| 新增功能与旧 PDF 取消 | `tmp/v32-cli-final-focused.log`、`tmp/v32-cli-pdf-cancel-final.log`；真实文件、像素、ZIP/XML、页数、源文件哈希、异常/取消与覆盖保护 |
| AI 与 Office | `tmp/v32-cli-office-final.log`；本地模拟 AI 服务，真实 LibreOffice XLSX 渲染；外部模型未调用 |
| MCP | 自建边界测试 + 官方 SDK 1.32.1 stdio；初始化、77 项发现、错误、进度、取消后继续调用 |
| 安装消费项目 | `tmp/v32-cli-node22-final.log`、发布日志中的 clean-worktree；npm archive 安装后运行原有完整 CLI/MCP 测试及新增 DOCX/图像 PDF/转写验证 |
| 最低 Node | 实际 Node 22.13.0；同时使用当前 Node 24.19.0，非仅声明 engines |
| 硬件 | `tmp/v32-cli-hardware-native.log`，8 项本机查询返回结构；`tmp/v32-cli-hardware-final.log` 验证缺少 PowerShell 的兜底及注册层取消 |
| 离线转写 | `tmp/v32-cli-transcription-native.log`，使用本机已选 Small 模型与合成测试语音，中文路径、JSON/SRT/TXT、并发拒绝及取消均通过；未下载真实模型 |
| 真实文档样本 | `tmp/v32-cli-corpus-results/report.json`，七类样本各取前 1–3 页，原版式/A4 共 14 项转换及 LibreOffice 渲染通过；7 项 Markdown 提取通过，源文件哈希不变 |
| Rust | `tmp/v32-cli-rust-final.log`：260 passed / 0 failed / 11 ignored；忽略项保持原有环境限制 |
| 全量发布门禁 | `tmp/v32-cli-release-final.log`：108 个 npm 脚本全部通过，含 architecture/build、1,648 项 security 检查、旧/新 CLI 和资源审计 |
| 连续会话 | `tmp/v32-cli-soak-report.json`：同一官方 SDK 会话 120 次文档/图片转换、12 次取消及后续调用通过；无临时残留，60 轮处理后的主进程 RSS 采样 140–168 MiB，耗时约 53 秒；这不是所有文档的处理峰值或长时内存保证 |
| npm 命令入口 | `tmp/v32-cli-shim-final.log`：最终 tarball 再次安装后通过 npm exec/bin shim，验证版本、覆盖表、MCP 初始化/77 项发现和实际 JSON 操作，stdout/stderr 无污染 |
| 包内容 | 2,536 个归档文件逐一与准备好的 CLI 源码/依赖树做 SHA-256 比较；1,889 个文本文件未发现密钥模式，无 SKILL.md/.codex/.env；64 个本地文档链接全部存在 |
| Skill | 私有 Skill 新增 CLI/MCP 包验证参考，skill-creator validator 通过；没有进入公开包 |
| 桌面帮助 | `tmp/v32-cli-help-final.log`、`tmp/v32-cli-help-architecture.log`；双语内容、实际注册表数量、Node 版本及现有帮助/架构契约通过；最终 108 项发布门禁已包含帮助资源重建 |

样本渲染证明文件可打开、保有可编辑文本和合理页结构，不等于全部复杂 PDF 达到某个视觉还原百分比。A4 重新排版可以改变页数；复杂表格、图形和公式仍可能包含图像区域。样本第一次重跑遇到已存在的验证 PDF，输出保护正常拒绝，改用唯一验证文件名后补验通过。

## 本地 npm 验收归档

- 文件：`toolknit-desktop/tmp/v32-cli-artifacts/toolknit-cli-3.2.0.tgz`。
- 大小：26,411,098 字节，约 25.2 MiB；包文件解压合计约 68.6 MiB，不包含安装时另外解析的平台依赖。
- SHA-256：`ef5361781edd4612661d6614878c19841d85313760ecd1ae01ed68c206770912`。
- 同目录包含 `verification.json`、`SHA256SUMS.txt` 和 `pack.json`。这些验收产物保留在忽略目录，不加入源码提交。
- 该归档可用于本地 npm 安装测试；它不是桌面 EXE，也没有上传 npm。发布前若继续改 CLI 源码、依赖或公开指南，应重新准备并验收归档，不沿用这份校验值。

## 发布与剩余限制

- **未执行 npm publish、Git 提交、GitHub push、Release 或桌面安装包构建。** V3.2 尚未发布，现有 V3.1 发布信息保留。
- npm 包需要 Node >=22.13.0；PDF/图片可选原生依赖必须正常安装，不能用 `--omit=optional` 后仍宣称所有引擎可用。FFmpeg、LibreOffice 与 Whisper 模型仍按能力单独检测。
- 本轮本机为 Windows x64；不把这一结果写成 macOS/Linux 全功能实机通过。硬件接口尤其依赖 Windows 查询；无 Windows 查询时仅基础概览/CPU/内存有 Node 兜底。
- 本轮没有新建桌面 EXE 或做新安装后的 GUI 回归；桌面帮助只改正文，使用既有组件，已通过契约、架构和生产构建检查。
- AI 仅验证本地模拟服务的完整协议、错误和取消，真实中转站/模型效果未在本轮重测；没有使用历史对话密钥。
- npm 仍会显示部分 ExcelJS 上游包的 deprecated 提示；消费依赖 audit 的零问题只代表本次查询结果，不掩盖这些维护提示。已知 Vite 大 chunk/crypto externalization 与 Windows linker 提示没有当作新故障。
- 模型下载验证使用小型本地 fixture 和模拟响应，覆盖流式失败路径；未重新下载 148 MB–1.5 GB 的真实公开模型，也不声称所有地区下载源实时测速通过。
