# Word 转 PDF：V3.3 维护说明

2026-10-31；关联 [Issue #116](https://github.com/ZihangDong/toolknit-desktop/issues/116)。本功能属于 V3.3 开发源码，尚未发布；正式 V3.2 和 npm 3.2.0 不变。

## 用户行为

- 首页 PDF 分类与「新功能」中的 V3.3 分组进入 Word 转 PDF；V3.2 的六项原有新功能保留在 V3.2 分组。版本组最新在前，卡片仍沿用原工具入口。当前目录为 74 桌面工具、12 分类、78 CLI/MCP 能力。
- 选择或拖入 DOC/DOCX，最多 20 个，每个 50 MiB。队列去重，原文件不修改。
- 使用现有 Office 运行时检测/下载门禁；需要完整 LibreOffice Writer 和 Python UNO。WPS/Microsoft Office 不替代此依赖。
- 按文件处理，部分失败不阻断其他文件；仅重试失败或取消项，已完成结果保留。取消/返回会停止未完成工作。
- 转换页采用与 PDF 转图像一致的说明/队列布局，仅负责转换。点击开始后立即显示准备遮罩，运行时检查与转换均可取消。
- 完成弹框显示实际输出文件、页数、大小与路径；批量结果可切换选择。三个按钮分别定位并选中文件、导入 PDF 编辑器、关闭并清空本轮状态。重置不删除磁盘结果。
- 导入编辑器通过注入的 `openLazyTool('pdf-editor')` 与已有 `openWithFile({ path, name, size })`；转换页关闭并释放数据。编辑器负责加载、查看及修改，加载失败仍可从已保存文件恢复。部分失败留在队列供单独重试，结果按钮可查看已完成文件。
- 桌面每个文件独立创建 `Word-PDF-<pid>-<sequence>/原名.pdf`；CLI 批量创建唯一目录，对同名输入加序号。默认不覆盖已有输出。

## 责任边界与契约

| 层 | 文件与职责 |
| --- | --- |
| 入口 | `src/features/lazy-tools.js`、`index.html`、`app/home-explorer-runtime.js`；工具 ID `word-to-pdf` |
| 页面 | `features/word-to-pdf/template.js`、`tool.js`、`controller.js`、专属 CSS；使用共享 topbar、空状态、处理遮罩、结果弹框、模态会话 |
| 纯逻辑 | `features/word-to-pdf/core.js`；队列、限制、逐项结果、稳定错误码 |
| 编辑交接 | 转换页不加载 PDF.js；复用 `features/pdf-editor/controller.js` 的 `openWithFile`，返回是否成功导入 |
| 原生 | `src-tauri/src/native_runtime/office/word.rs`；有界读取、临时副本、任务取消、结果校验与唯一输出 |
| 驱动 | `src-tauri/resources/office/word-to-pdf.py`；共享 DOCX 检查与 UNO Writer 导出，独立 profile、命名管道、不启动监听 TCP 端口 |
| CLI/MCP | `cli/lib/word-runtime.mjs`、`office-tools.mjs`、`desktop-coverage.mjs`；独立无 DOM 调用、有界 Worker 验证 PDF、取消清理与打包驱动 |

页面 DOM：`wordToPdfOverlay`；保留 `wordPdf` 前缀的导入、队列、转换、处理遮罩与结果控件。移除内置预览相关节点；结果使用 `SuccessFolder/SuccessEditor/Done`，批量选择使用 `ResultChoice/ResultSelect`。没有外部调用依赖被删除的预览节点，契约与浏览器夹具同步调整。

Tauri 命令保持 `convert_word_to_pdf(inputPaths, outputDir, jobId)`、`cancel_word_to_pdf(jobId)`，定位文件复用 `open_path`。事件 `word-to-pdf-progress` 只按 jobId 接收，字段为 `jobId/index/total/phase/file`。返回 `jobId/files/cancelled`，逐项含 `inputPath/sourceName/outputPath/outputBytes/pageCount/status/error`。弹框使用原生输出元数据；编辑器加载时读取实际 PDF 页数。

没有新增 storage key 或原生命令。转换队列在关闭结果/退出工具时释放，不是长期历史记录。

## CLI/MCP

```powershell
node cli/toolknit.mjs word to-pdf --input source.docx --output result.pdf --json
node cli/toolknit.mjs run toolknit_word_to_pdf --arguments-file batch.json --json
```

`batch.json` 示例：

```json
{"input_paths":["C:/Documents/a.docx","C:/Documents/b.doc"],"output_dir":"C:/Documents/exports"}
```

单个文件使用 `input_path/output_path` 和可选 `overwrite`；批量使用 `input_paths/output_dir`，不允许混用参数。MCP 名称 `toolknit_word_to_pdf`。批量返回 `success/partial/failed` 与逐项 `files/outputs`；取消请求抛出 `CANCELLED`，已经发布的文件仍留在本批次输出目录。CLI 最多同时两个 Word 任务，单文件 180 秒超时，PDF 输出上限 150 MiB。

## 文件与运行时边界

DOCX 拒绝宏、嵌入 OLE、外部非超链接关系、ZIP 路径穿越/重复项/加密项和 XML 实体声明；限制 10,000 项和 200 MiB 展开量。不执行宏，不主动更新外部链接/目录，拒绝交互式密码提示。损坏、加密或不支持的文件返回稳定错误码，不输出文件正文、运行时 stderr 或密钥。旧 DOC 由 Writer 导入，沿用禁用宏与外部更新策略。

源文件读取限制、输出路径、独立 profile、临时目录与取消资源由各层明确持有。Windows 取消和超时等待完整子进程树退出再清理临时目录；任务守卫归原生工作线程所有。成功输出先暂存并验证，再发布到唯一目录；取消前已经发布的结果保留。

不添加 AI Key、不上传文档、不引入付费 API、NPM 依赖或随包 Office 二进制。新代码沿用仓库默认许可；本工具不调用受单独条约约束的 PDF 转 Word 引擎。

## 验证方法

- `npm run test:word-to-pdf`：队列、去重、逐项失败、稳定错误、命令注册，以及真实进程取消/超时/子进程清理。
- `npm run test:word-to-pdf-native`：真实 LibreOffice DOCX/DOC → CLI/MCP/原生 PDF；检查中文、文字层、页眉、表格、A4、两页分页、损坏文件、同名文件、源文件哈希、覆盖拒绝和主动内容拒绝。样本由脚本生成，证据保留在忽略目录 `tmp/word-pdf-native/`。
- `TOOLKNIT_WORD_QA_FILES='["C:/docs/a.docx","C:/docs/b.doc"]' npm run test:word-to-pdf-native-batch`：对用户本机文件运行桌面 Rust 原生批量路径，汇总输出耗时、页数、文字量和绘制操作，不打印文档内容；输出只写临时目录并在验证后清理。
- `npm run test:word-to-pdf-browser`：打开本地地址并点击 Run regression。模拟原生转换，使用真实 PDF 编辑器加载生成 PDF；验证遮罩立即显示、准备阶段取消、部分失败/重试、结果选择、文件定位、编辑交接、清空/重开、迟到结果隔离和双语。转换页不再创建 PDF 预览。视觉检查双主题与低高度；真实转换单独验证。
- 架构、构建、发布、安全、CLI 包与 Rust 全套门禁按项目维护规范执行；最终结果记录于下方。

## 本轮优化记录（2026-11-01）

- 批量转换复用同一个隔离的 LibreOffice Writer 会话，避免每个文件都重新启动 Office。6 个真实 DOC/DOCX 样本均成功，输出页数为 5、3、1、1、4、8；原生批量耗时约 14.7 秒，CLI/MCP 批量约 17.3 秒。总计 22 页，检查到约 11,228 个可提取文字字符和 10,342 个绘制操作；结果均为有效 PDF。
- 当时结果弹框与页内预览已验证；2026-11-02 改为下述转换/编辑分工。
- 原生和 CLI 返回字段统一兼容 camelCase 与 snake_case，避免成功文件的字节数或页数在列表/完成弹框中显示为 0。
- `TT: undefined function: 21` 属于 PDF.js 字体 hinting 诊断，不单独证明转换失败。原转换页预览已在 2026-11-02 移除；没有把共享 PDF.js 改为全局静默。
- CLI 和桌面端继续分别校验 PDF 头、EOF、大小和页数；只发布校验通过的临时结果，不把空或截断 PDF 推送到最终输出目录。

## 转换页精简与启动优化（2026-11-02）

- 删除 Word 页内预览模块与画布相关控件，结果通过已有 lazy registry 交接 PDF 编辑器。处理遮罩在依赖/目录/原生调用之前打开；预检查使用现有运行时缓存，取消与关闭按会话隔离，旧任务不写回新队列。
- 原生耗时拆分确认启动占主要时间：本机两页小文档正文处理约 0.4–0.7 秒，旧的隔离 Writer 启动约 10–11 秒。复用生成的扩展注册后，缓存就绪的总耗时约 8.4 秒；建立缓存的首次仍约 13.6 秒，不能据此承诺所有设备都达到相同速度。
- 缓存位于用户临时目录，只包含 Writer 启动后、加载用户文件前的 `extensions` 与 `uno_packages` 注册数据。按运行时路径、版本文件与可执行文件指纹隔离，限制文件数量/大小；不复制完整 profile、历史、用户文档或宏配置，每批仍使用独立安全配置。缓存缺失可重新生成。
- 六份用户样本原生批量复测成功，共 22 页（5/3/1/1/4/8），耗时 10.686 秒，提取文字和绘制操作均非空。生成样本另验证中文、页眉、表格、A4 分页、损坏文件、源文件不变、覆盖拒绝与取消；CLI/MCP 使用同一驱动通过真实转换验证。
- 浏览器 24 项交互回归通过，包含真实 PDF 编辑器交接、准备阶段取消、批量结果/重试、关闭清空和迟到结果隔离。手工检查深浅主题、中文/英文及 900×600 窗口；修正公共响应式布局导致操作区被挤出、结果按钮断字的问题。文件定位验证为复用 `open_path` 的文件路径契约；安装版窗口仍需下一测试包验收。
- 用户测试后完成布局收尾：空态占满队列剩余空间并居中；底部说明与按钮同排，无状态时隐藏空占位。简化双语提示，低高度窗口压缩标题/间距；1400×920、1100×720、720×480 检查通过，最小窗口空态与上传后主按钮均可见。原生转换算法未变；重新通过 24 项交互、focused、架构、构建与双语集成检查。
- focused、架构、构建与发布门禁均完成；独立 CLI 安装审计首次遇 npm `ECONNRESET`，重跑通过后继续剩余门禁。安全检查 1693 项，完整 Rust 267 passed / 14 ignored，CLI 包隔离安装与 MCP 通过。末尾文案/样式调整追加帮助、构建与视觉复查。检查日志在忽略目录 `tmp/word-*.log`；没有新增安装器或进行发布。

## 限制

本轮真实 Office 环境为 Windows + LibreOffice 26.2.5.2，未宣称覆盖所有 Office 版本或其他操作系统的 UNO 安装布局。安装包原生窗口/文件对话框仍需下一次测试包人工验收。

字体缺失、浮动图形、复杂分节、目录域和不同排版引擎可能改变版面。没有宣称与 Microsoft Word 逐像素一致。第一版不提供 ZIP 导入、水印、合并结果、密码解锁或长期转换历史。

## 门禁发现的依赖修补

完整独立安装测试发现现有 ExcelJS 归档树受 GHSA-g3hv-75wg-m249 影响。锁定 glob/readdir-glob 调用的 minimatch 11.0.3；glob 7 的 Matcher 元数据和匹配调用由 `scripts/patch-office-glob.cjs` 做受版本与源码形状校验的兼容修补。没有修改 minimatch 算法或安全上限。桌面正常 `npm ci` 通过 postinstall 应用，若显式忽略安装脚本，需手动运行该脚本。CLI prepare 对随包依赖同步修补源码和声明，NOTICE 保留上游许可说明。

`test:office-dependencies` 验证 sync/callback 匹配、忽略规则、隐藏文件、中文 ZIP 与 Excel 读写；独立消费包执行相同测试和 npm audit。没有降低安全门禁，也没有将 Word 转 PDF 与 PDF 转 Word 的单独许可混用。

开发链路的完整安装审计另外发现 body-parser 2.3.0 压缩请求解析告警，已按现有 semver 范围更新至 2.4.0；不改动应用功能或额外对外开放 HTTP 服务。
