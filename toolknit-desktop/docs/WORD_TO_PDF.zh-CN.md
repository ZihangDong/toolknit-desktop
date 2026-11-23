# Word 转 PDF：维护说明

更新：2026-11-21；关联 [Issue #116](https://github.com/ZihangDong/toolknit-desktop/issues/116)。当前源码 V3.4 尚未发布，正式版本为 V3.3 / npm 3.3.0。下方保留 V3.3 实施历史。

## V3.4：转换时加密与权限（TK-009-E）

默认关闭。开启后输入并确认打开密码，规则沿用本机 PDF 加密工具：至少 8 个 Unicode 字符、最多 127 个 UTF-8 字节，拒绝 NUL / CR / LF 和不完整的 UTF-16 代理字符。支持高质量 / 低质量 / 禁止打印，以及复制、修改、注释、填写表单、页面组装权限；辅助技术访问始终允许。管理密码每次随机生成、不返回、不保存。权限由阅读器遵守，不承诺阻止所有软件提取内容。

每份加密 PDF 限制 200 页 / 150 MiB，可与 DOC / DOCX / ZIP、内部域刷新和水印组合。顺序是 Writer 导出 → 水印 → AES-256 加密 → 使用打开密码重开检查 → 发布。普通中间文件只在私有工作目录，取消 / 失败 / 退出由既有生命周期清理。逐文档失败不影响其他项；已成功发布的文件保留加密状态，单文件覆盖失败保留旧结果。超过 200 页时该项失败，不退回普通 PDF。

桌面密码在有效请求开始后立即从输入框清除，完成或失败时释放请求引用；关闭 / 清空重置开关与权限。再次重试必须输入密码，也可明确关闭加密后重试。任务中心仍记录进度和结果路径，但此类任务不注册自动重试回调，排队取消会立即清除密码引用；原生错误不直接写入历史。加密结果显示 AES-256 提示并禁用直接导入 PDF 编辑器；先用 PDF 解密工具另存副本后再编辑。

原生端复用现有密码规则、权限映射、随机管理密码和 `build_pdf_encrypt_qpdf_arguments`；扩展既有带取消 / 超时的 qpdf 运行器以支持标准输入，命令行只有 `@-`，不创建密码参数文件。Rust 使用 Zeroizing / Drop 清理口令和载荷。JS 清除输入、请求引用和字节缓冲；不宣称可保证擦除 JavaScript / WebView / 系统堆的所有字符串副本。取消按 jobId 匹配，能停止当前加密 / 水印 qpdf 子进程。

CLI / MCP 可传 `encryption` 对象，含必需的 `password` 与可选 `permissions`。权限键与现有 PDF 加密一致：`printing:false|"lowResolution"|"highResolution"`、`copying`、`modifying`、`annotating`、`fillingForms`、`documentAssembly`，可选 `contentAccessibility:true`。默认全部允许。密码需要通过受控内存来源提供；CLI 使用 `toolknit run toolknit_word_to_pdf --arguments-stdin --json` 接收完整请求 JSON。嵌套密码同样拒绝通过 `--encryption` 命令行或 `--arguments-file` 传入；不要写入脚本、文件名或日志。MCP 通过内存参数传入，不回显到结果。成功文件增加 `encrypted:true`，不返回密码；普通文件维持原有结果格式。

检查入口：`npm run test:word-encryption`（边界、实际加密、任务隐私、CLI 口令传输）；`npm run test:word-encryption-native`（实际 Word / ZIP / CLI / MCP / Rust，使用独立 qpdf 解密与 PDF.js 比较）；`npm run test:word-encryption-production`（先构建，实际首页 / 懒加载 / 控件 / 清空密码）；既有 `test:word-to-pdf-browser-acceptance` 同时覆盖加密交互。正式安装版 WebView2 的完整原生 UI 串联列 E1 发布前走查。

## V3.4：历史恢复与重试（TK-009-F）

桌面任务中心的新版 Word 记录可在当前会话或重启后“恢复到 Word 队列”。只读核对最多 20 个源文件 / ZIP 条目与 PDF，不会自动开始转换，也不会覆盖当前已有队列。逐文件进度到达时即保存完成信息；重启后活动记录标为已中断。

已有且指纹匹配的 PDF 保留，未完成或丢失结果设为待转换。源文件缺失时仍可查看保留 PDF；原件与结果均丢失则无法重新生成。历史没有下载缓存，不能“重新下载”。普通 Word 变化须显式点击“使用当前版本”，变动 ZIP 须移除并重新添加；转换前对实际读入字节再次校验 SHA-256，核对后发生变化同样拒绝发布。没有捕获旧指纹的未完成项会采用核对时当前文件，不能据此保证恢复崩溃前的原始字节。

“重新核对文件”刷新状态；“重新生成全部”只准备待转换队列，仍须点击开始。重新生成使用当前输出目录的新目录与名称，原 PDF 不覆盖。若定位时结果已移动或删除，会提示核对并重新生成。旧版记录缺少源元数据，保留输出定位，但必须重新添加来源才能建立可恢复历史。

仅持久化版本化、有数量与路径长度限制的源 / 输出元数据：SHA-256、状态、页数、大小、内部刷新开关、加密权限及需要水印 / 加密的标记。不保存密码、水印文字 / 图片、PDF 二进制、原生调用参数或 job ID。恢复会打开此前使用的加密 / 水印开关，但内容留空，必须重新输入或明确关闭。清除任务历史只删除元数据；存储不可用时显示警告。最多保留 100 条已结束任务。

新增 `inspect_word_history` 只读原生命令，拒绝不安全路径、链接 / 重解析点和超界文件；只允许一个核对任务。桌面转换增加可选 `expectedHashes`，旧调用仍兼容。此功能仅为桌面历史，不增加 CLI / MCP 的持久化历史或恢复协议。

检查入口：`npm run test:word-history`（7 组元数据 / 隐私 / 重启 / 进度）；`npm run test:word-history-native`（8 组真实 DOCX / ZIP / 指纹 / 变化拦截，4 份 PDF 独立重开）；先构建再运行 `npm run test:word-history-production`（正式首页、历史重启 / 旧记录 / 浏览器禁用 / 存储警告）；`npm run test:word-to-pdf-browser-acceptance`（中英文与明暗主题交互、60 张布局截图）。正式 Tauri / WebView2 完整重启与原生恢复串联保留 TK-009-F1 发布前验收；本轮未生成或发布安装包。

## V3.4：转换时添加水印（TK-009-D）

默认关闭，可叠加文字或 PNG / JPEG 水印，不修改源 Word 或把正文栅格化。文字使用随包 Noto Sans SC，限制为 1–80 个 Unicode 字符、单行；缺少字形会明确失败。图片上限 4 MiB、400 万像素、边长 8192，支持 PNG 透明通道。透明度 5%–100%，占 A4 纸宽 20%–80%，旋转 −45° / 0° / 45°；文字字号上限 96 pt，极高图片及旋转边界会等比收缩以完整保留。

页码留空为全部，也可填 `1,3-5`；从 1 开始，重复页去重。以每份转换后 PDF 的实际页数校验，任何越界页使该文件失败，其他文件可继续。预览渲染实际生成的 A4 水印 PDF，只展示位置而不包含正文；qpdf 在各输出页上等比缩放并居中，横向 / 小纸张上的水印比例会随之变化。首版为居中、固定灰色文字；没有平铺、自定义定位、彩色文字或逐文件独立水印。

桌面 / CLI / MCP 共用 `src/word-watermark-core.js`，嵌入字体子集或图像制成单页 PDF；Rust / CLI 用本地 qpdf 覆盖在转换后 PDF 上。仅水印成功并检查 PDF 后才发布。CLI 的普通中间 PDF也进入私有临时目录，并在 Writer 继续转换时逐项发布已验证的结果；取消会保留此前已完成的带水印 PDF，其他项标记取消。单文件覆盖失败保留旧输出。水印内容、图片和 PDF 二进制不写入任务历史，当前会话重试仍保留设置；清空或退出工具会重置。

CLI 通用入口使用 JSON 参数文件：`toolknit run toolknit_word_to_pdf --arguments-file request.json --json`。MCP 使用同一个参数对象；可与 `refresh_fields:true`、DOC / DOCX / ZIP 输入组合：

```json
{
  "input_paths": ["C:/Documents/资料.zip"],
  "output_dir": "C:/Documents/exports",
  "watermark": {
    "type": "text", "text": "内部资料 DRAFT", "pages": "1,3-5",
    "opacity": 0.2, "angle": 45, "width": 60
  }
}
```

图片类型改为 `"type":"image", "image_path":"C:/Documents/stamp.png"`，省略 text。成功文件增加 `watermark_pages`，桌面原生为 `watermarkPages`，只返回实际盖印页数；水印失败不返回该文件的输出路径。qpdf、字体与共享模块沿用现有随包资源，不增加 Python / npm 运行时依赖。

检查命令：`npm run test:word-watermark`、`npm run test:word-watermark-native`、`npm run test:word-to-pdf-browser-acceptance`、`node scripts/test-word-watermark-production.mjs`、`cargo test --manifest-path src-tauri/Cargo.toml native_runtime::office::word:: --lib -- --test-threads=1`。浏览器脚本需要通过 `TOOLKNIT_TEST_MODULES` 指向已安装的 Playwright；生产入口先构建。真实 Rust 验收与前端构建顺序执行，避免 Tauri 嵌入 dist 时文件被替换。正式安装版 WebView2 的图片文件选择、预览 Worker 和转换串联仍列 TK-009-D1 发布前补测，未发布安装包。

## V3.4：可选刷新内部目录与文档域（TK-009-C）

桌面“刷新内部目录与文档域”默认关闭。主动更新的范围包括正文目录及 TC 标记自定义目录（ContentIndex）、基于题注的图表目录（Writer 导入为启用 CreateFromLabels 的 IllustrationsIndex）、仅使用内部 XE 词条的字母索引（DocumentIndex），以及 PageNumber、PageCount、GetReference、Chapter、ReferencePageGet、ReferencePageSet 六类域。队列、结果与 CLI / MCP 显示更新与跳过数量。清空、完成关闭或退出工具后重置开关，运行与导入期间不可更改。失败后可取消勾选并重试未完成文件。

字母索引要求文档的 `IndexAutoMarkFileURL` 严格为空字符串。若配置 HTTP / 本机外部词条文件、属性不可读取或值未知，则仅跳过此索引，保持其原缓存和外部来源；其余已支持目录仍可刷新。不会为了启用更新而清空该属性。TC 标记目录由实际导入类型识别，没有放开 Writer 原生 UserIndex、对象名称索引或文献索引。

Writer 导入和排版本身仍可能计算页码、引用和动态日期。开启后会重排版，目录长度、正文页码和总页数可能改变。日期、文件名、作者、表达式、自定义属性、数据库、DDE 和外部内容继续跳过。索引只按白名单调用单个对象的更新方法，导入继续使用 `UpdateDocMode=0`、禁用宏并拒绝交互提示。文献索引与其他类型继续跳过。

新模块 `src-tauri/resources/office/word_fields.py` 在字体替换与布局兼容处理之后、导出之前执行。目录与字段按白名单逐项更新，强制重新排版，再更新内部页码 / 引用；比较页数与目录内容摘要，最多三轮达到稳定。每文档最多 20000 个域、128 个索引、目录文本合计 2 Mi 字符；稳定状态只有计数和布尔值，不返回正文。数量超限、UNO 更新失败或三轮仍不稳定时，该文件失败且不发布 PDF，其他批量文件继续；仍受现有取消、180 秒进程截止和临时目录清理约束。

CLI 单文件示例：

```powershell
toolknit word to-pdf --input source.docx --output refreshed.pdf --refresh-fields true --json
```

MCP / 通用批量参数增加可选布尔 `refresh_fields`（默认 false），可同时用于 DOC / DOCX / ZIP：

```json
{"input_paths":["C:/Documents/资料.zip"],"output_dir":"C:/Documents/exports","refresh_fields":true}
```

仅成功开启刷新时，逐项返回 `field_update`（桌面原生为 `fieldUpdate`），含 enabled、indexes、fields、skippedFields、skippedIndexes、passes、stabilized，以及排版后的 pages（如有）。原生命令增加可选 `refreshFields`，旧调用保持默认关闭；缺少“已稳定刷新”的状态不视为请求成功。CLI / 原生均随驱动提供新模块，不依赖额外 Python 或 NPM 包。

验证：`npm run test:word-fields` 的 12 项白名单 / 限制 / 失败与导入属性检查；`npm run test:word-fields-native` 会先同步 CLI 资源并运行规则检查，再执行 12 组真实验收、7 份独立 PDF 重开，包括 DOC、DOCX、ZIP、CLI、MCP 和 Rust。70 节合成 DOCX 默认 71 页且保留旧目录；包含正文、两类题注、字母和 TC 五份索引的刷新结果为 73 页，逐项比较 70 个目录目标、题注及 XE / TC 词条与实际正文页、内部文本 / 页引用、总页数及每页页脚。独立真实 UNO 流程核对 HTTP / 文件词条来源被跳过且 URL 和缓存不变，空 URL 才刷新。外部 INCLUDETEXT 和 HTTP 词条来源均指向本机探针，整轮 0 请求；日期、表达式及普通 / 锁定自定义属性均比较开启前后与导入器基线一致，不把“未主动刷新”解释为缓存日期冻结。原 DOCX 和 ZIP SHA-256 不变。字母与 TC 续轮证据见根目录 `docs/issues/tk009c1-indexes.json`，原 C 首版快照保留。

浏览器四组主题 / 语言各 52 项及 16 张布局截图通过，覆盖默认关闭、参数捕获、运行时禁用、更新 / 跳过摘要、刷新失败、关闭选项重试和退出重置。该浏览器原生边界为夹具，真实转换另测；正式安装版的开关 / 选择 / 拖放串联验收仍保留发布前条件。证据在 `tmp/word-fields/report.json` 指向的合成运行目录、`tmp/word-pdf-browser-acceptance/` 和根目录 `docs/issues/tk009c-fields.json`。其他内部域与索引扩展另列 TK-009-C1，尚未发布安装包。

参考：[LibreOffice XDocumentIndex](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1text_1_1XDocumentIndex.html)、[26.2.5.2 原生域实现](https://github.com/LibreOffice/core/blob/libreoffice-26.2.5.2/sw/source/core/unocore/unofield.cxx)、[26.2.5.2 目录实现](https://github.com/LibreOffice/core/blob/libreoffice-26.2.5.2/sw/source/core/unocore/unoidx.cxx)。实测为本项目捆绑内核对应版本，不承诺所有第三方 Writer 版本结果完全一致。

## V3.4：ZIP 批量输入（TK-009-B）

桌面可选择或拖入 DOC / DOCX / ZIP。ZIP 先检查目录并列出 Word 项，显示“压缩包 / 包内路径”，之后按文档转换和重试；重复添加同一来源不重复入队。部分来源导入失败保留其他已加入文件，超出队列上限的 ZIP 整包不加入；非 Word 项计数提示，不递归展开嵌套 ZIP。导入期间禁用队列修改，关闭后忽略迟到列表；导入只读目录，不创建解包文件。

限制：展开后最多 20 个 Word；每个 Word 或 ZIP 最多 50 MiB；每 ZIP 最多 1000 个目录项、元数据展开量 200 MiB；转换任务选中的 ZIP 文档合计最多 200 MiB，压缩输入缓存也限定 200 MiB。只接收常规单卷 ZIP 的 Stored / Deflate，拒绝 ZIP64、加密项、链接、特殊文件、路径穿越 / 绝对路径 / 驱动器或设备名 / 重复路径与大小异常。只把选定 Word 项解压到程序生成的编号文件，不以 ZIP 路径创建磁盘目录；验证实际展开长度和 CRC。DOCX 自身继续接受现有主动内容检查。

原生新增只读 `inspect_word_zip(path)`，返回真实来源、包内文件名、大小、跳过数量和整包 SHA-256。`convert_word_to_pdf` 增加可选 `archiveInputs`，以原 ZIP 和包内项描述输入，原 DOC / DOCX 签名仍兼容。转换重新读取并校验包哈希；添加后变化的包返回 `archive-changed`，需移除对应行后重新添加。临时副本仅属于当前转换，结束、失败或取消后释放；失败项可按原包重新读取，成功 PDF 保留。

CLI / MCP 使用已有批量参数，单文件 `input_path/output_path` 仍限定 Word：

```json
{"input_paths":["C:/Documents/资料.zip","C:/Documents/补充.docx"],"output_dir":"C:/Documents/exports"}
```

CLI 返回原 ZIP 的 `input_path`、包内 `archive_entry` 和 `source_name`，不暴露临时输入路径。同名文档分别输出，坏文档或坏 ZIP 逐项报告，取消保留已发布输出。桌面与 CLI 限制、异常 ZIP 判定一致，CLI 通过流式展开校验长度和 CRC，所有解包副本由本次调用在 finally 清理。

验证：`npm run test:word-zip` 29 项，生成 19 份共用 ZIP 夹具供 Node / Rust 判定；`npm run test:word-zip-native` 运行真实 CLI、MCP、Rust / LibreOffice，4 组验收、7 份独立重开可搜索中文 PDF，含同名文件、损坏 Word、CRC / 哈希变化、取消与源包哈希不变。`node scripts/test-word-to-pdf-browser.mjs --automated` 四组主题 / 语言各 41 项及 16 张布局截图通过，含 390 宽度的来源行空间和滚动触达转换按钮；原生边界使用合成夹具，真实转换另由前述原生验收覆盖。正式安装版 WebView2 的系统文件对话框与拖放还需发布前验收；未构建安装包。

证据：`tmp/word-zip/`、`tmp/word-pdf-browser-acceptance/` 与根目录 `docs/issues/tk009b-zip.json`。

## 用户行为

- 首页 PDF 分类或搜索 Word 转 PDF 进入；沿用原工具入口和 V3.3 分组。
- 选择或拖入 DOC / DOCX / ZIP，展开后最多 20 个 Word，每个 Word 或 ZIP 50 MiB。队列去重，原文件不修改。
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
| 驱动 | `src-tauri/resources/office/word-to-pdf.py`、`word_fields.py`；共享 DOCX 检查、可选内部域更新与 UNO Writer 导出，独立 profile、命名管道、不启动监听 TCP 端口 |
| CLI/MCP | `cli/lib/word-runtime.mjs`、`office-tools.mjs`、`desktop-coverage.mjs`；独立无 DOM 调用、有界 Worker 验证 PDF、取消清理与打包驱动 |

页面 DOM：`wordToPdfOverlay`；保留 `wordPdf` 前缀的导入、队列、转换、处理遮罩与结果控件。移除内置预览相关节点；结果使用 `SuccessFolder/SuccessEditor/Done`，批量选择使用 `ResultChoice/ResultSelect`。没有外部调用依赖被删除的预览节点，契约与浏览器夹具同步调整。

Tauri 命令 `convert_word_to_pdf(inputPaths, outputDir, jobId, archiveInputs?, refreshFields?)`、`cancel_word_to_pdf(jobId)`，ZIP 预检使用 `inspect_word_zip(path)`；定位文件复用 `open_path`。事件 `word-to-pdf-progress` 只按 jobId 接收，字段为 `jobId/index/total/phase/file`。返回 `jobId/files/cancelled`，逐项含 `inputPath/sourceName/outputPath/outputBytes/pageCount/status/error` 和可选 `fieldUpdate`。ZIP 项 inputPath 为稳定的不透明队列标识，真正输入由 archiveInputs 描述；弹框使用原生输出元数据，编辑器读取实际 PDF 页数。

没有新增 storage key。转换队列在关闭结果 / 退出工具时释放，不是长期历史记录。

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

DOCX 拒绝宏、嵌入 OLE、外部非超链接关系、ZIP 路径穿越/重复项/加密项和 XML 实体声明；限制 10,000 项和 200 MiB 展开量。不执行宏、不主动更新外部链接 / 数据，拒绝交互式密码提示。默认不额外重建目录，V3.4 可显式开启上述内部目录 / 域白名单。损坏、加密或不支持的文件返回稳定错误码，不输出文件正文、运行时 stderr 或密钥。旧 DOC 由 Writer 导入，沿用禁用宏与外部更新策略。

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

字体缺失、浮动图形、复杂分节、目录域和不同排版引擎可能改变版面。没有宣称与 Microsoft Word 逐像素一致。V3.3 首版未提供 ZIP，V3.4 的有界 ZIP、水印、加密与桌面历史恢复见本文上方；合并结果与 Word 密码解锁仍未提供。

## 门禁发现的依赖修补

完整独立安装测试发现现有 ExcelJS 归档树受 GHSA-g3hv-75wg-m249 影响。锁定 glob/readdir-glob 调用的 minimatch 11.0.3；glob 7 的 Matcher 元数据和匹配调用由 `scripts/patch-office-glob.cjs` 做受版本与源码形状校验的兼容修补。没有修改 minimatch 算法或安全上限。桌面正常 `npm ci` 通过 postinstall 应用，若显式忽略安装脚本，需手动运行该脚本。CLI prepare 对随包依赖同步修补源码和声明，NOTICE 保留上游许可说明。

`test:office-dependencies` 验证 sync/callback 匹配、忽略规则、隐藏文件、中文 ZIP 与 Excel 读写；独立消费包执行相同测试和 npm audit。没有降低安全门禁，也没有将 Word 转 PDF 与 PDF 转 Word 的单独许可混用。

开发链路的完整安装审计另外发现 body-parser 2.3.0 压缩请求解析告警，已按现有 semver 范围更新至 2.4.0；不改动应用功能或额外对外开放 HTTP 服务。
