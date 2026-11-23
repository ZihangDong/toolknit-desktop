# ToolKnit 上游议题分析

核查日期：2026-11-20（Asia/Shanghai）。执行入口为根目录 [TODO.md](../TODO.md)。

## 来源与判断范围

- Git 远端：`hqyx2025/toolknit-desktop`；GitHub API 确认它是 `ZihangDong/toolknit-desktop` 的 fork，且未启用 Issues。
- 查询上游全部状态议题，分页读取并排除 PR：共 46 个 Issue，17 个开放、29 个关闭；另读取所有带评论的开放议题及 #137 的评论。
- [状态快照](issues/2026-11-20.json)保留来源地址、抓取时间、议题编号、状态和更新时间，便于后续重新核查。状态只代表抓取时点。
- 本地核对基于 `b651dc08bd48ce9a2ac8ce6a612bb93276c1b747` 加当前未提交工作区；这里有较多既有改动，本文的“已有实现”包含这些改动，不代表已发布版本或已通过本轮运行测试。
- 初次整理只做需求分析与文档整理；后续实现和验收见末尾执行记录。优先级、阶段边界和验收标准是本分支的建议；上游作者评论不作为本分支的交付期限。

## 优先排查与修复

### TK-001：模型和运行时下载可靠性（P0）

**来源**：[#137](https://github.com/ZihangDong/toolknit-desktop/issues/137)，已关闭。作者于 2026-11-18 的[最后回复](https://github.com/ZihangDong/toolknit-desktop/issues/137#issuecomment-6968319125)说明仍在寻找新的下载源，因此关闭状态不能作为恢复证明。

**本地证据**：`toolknit-desktop/src-tauri/src/platform/dependency_download.rs` 中 OCR 资源基址、FFmpeg、抠图、翻译等仍引用报告中的 CDN。`src-tauri/src/native_runtime/dependencies.rs` 中 FFmpeg 与 LibreOffice 下载候选仍指向该源。CLI 的 `cli/lib/model-download.mjs` 已有候选源循环和校验机制，应复用而不是另起下载器。本轮未对 CDN 做实时可用性探测，也没有确认新的分发源。

**解决的问题**：首次安装或补装模型失败，导致本地 OCR、转写及其他依赖功能无法使用。

**待办范围**：先核验各资源清单与实际请求；确认有分发权且可用的新来源和备用来源；统一桌面 / CLI 的源选择、校验和失败反馈。资源来源未落实时先记录外部阻塞，不编造备用地址。

**验收**：新安装无缓存时可下载、校验并使用；主源 503 / 超时后能切换可用备用源；取消、重试、已有模型和中断文件处理正确；至少覆盖 OCR 与 FFmpeg，并检查其他依赖是否同样受影响。

### TK-002：清理结果定位目录（P0）

**来源**：[#124](https://github.com/ZihangDong/toolknit-desktop/issues/124)。标签虽为 enhancement，内容属于定位行为错误。

**本地证据**：`src/features/cleanup-tools/large-file-controller.js` 的 `open-folder` 已调用 `open_path`；`src-tauri/src/native_runtime/office/files.rs` 已校验绝对路径，并在 Windows 调用 `platform::file_location` 选中文件。源码存在处理路径，暂不能判定当前工作区仍有原报告故障，也不能直接标为已解决。

**验收**：从 AI 大文件清理候选列表右键定位实际文件；覆盖中文、空格、长路径、不同磁盘及目录条目；文件移动或删除时明确报错，不跳到无关目录。先跑现有清理契约检查，再在 Windows 桌面环境验证原生定位。

## 第一批功能

### TK-003：XML 格式化（P1）

**来源**：[#48](https://github.com/ZihangDong/toolknit-desktop/issues/48)。范围小、依赖少，可在现有开发者工具中增量完成。

**本地证据**：`src/features/developer-toolbox/tool.js` 当前模式为 JSON、Base64、URL、UUID、JWT；`core.js` 提供 JSON 格式化，未看到 XML 模式。

**首版**：粘贴 XML，校验、缩进格式化、压缩、复制、清空，沿用输入大小限制及错误提示模式；添加工具搜索入口和中英文文案。

**验收**：普通嵌套、属性、命名空间、注释、CDATA、实体引用及混合文本语义保留；空白是否可删除有明确规则；错误标签与超限输入可恢复，不因解析触发外部资源请求。

### TK-004：PDF 批量解密队列（P1）

**来源**：[#86](https://github.com/ZihangDong/toolknit-desktop/issues/86)。作者于 2026-10-12 的回复提到批处理从 4.0 开始规划；这是上游意向，本地排期独立维护。

**本地证据**：`src/features/pdf-security/decrypt-tool.js` 使用 `shell.getFile()`，以单个 `inputPath` 调用 `decrypt_pdf`；可复用现有解密能力与 `src/app/task-center.js`。

**首版**：多文件队列、共享密码和逐文件覆盖、串行处理、进度、失败项重试、成功输出定位。取消停止后续文件，已完成结果保留，明确正在处理的单文件能否取消。

**验收**：不同密码混合、错误密码、非加密 / 损坏文件、文件大小 / 页数限制、同名输出与部分失败；密码不进入历史、日志或任务持久化，原文件不覆盖。

### TK-005：PDF 转 PPT（P1）

**来源**：[#138](https://github.com/ZihangDong/toolknit-desktop/issues/138)，只提出转换方向，未说明元素是否需可编辑。

**本地证据**：已有 PDF 页面渲染、图片导出和 PPTX 相关能力；`src/features/lazy-tools.js` 未提供独立 PDF 转 PPT 入口。优先复用页面渲染与已有 PPTX 依赖，具体依赖 API 在实施时验证。

**建议首版**：每页渲染成图片并写入一张幻灯片，支持页码范围、清晰度和导出 PPTX。界面明确说明页面图像可缩放、替换，原文和表格不可直接编辑；混合页面比例采用何种适配策略在实施时确定。

**验收**：页数、顺序、旋转和比例正确；中文、矢量图、扫描页、透明内容和大文件可处理或明确提示限制；在 PowerPoint / WPS 打开真实导出文件。若要文字 / 表格可编辑，应另立版式重建任务。

**2026-11-20 结果**：图片型首版已完成，真实浏览器转换及本机 WPS 打开 / 转存通过。实现、资源限制和验收边界见末尾 TK-005 执行记录；原文 / 表格重建不在首版范围。

### TK-006：会议录音、转写和纪要（P1）

**来源**：[#117](https://github.com/ZihangDong/toolknit-desktop/issues/117) 与 [#79](https://github.com/ZihangDong/toolknit-desktop/issues/79)，合并推进，避免重复建设转写工具。

**本地证据**：`src/features/transcription/controller.js` 已有文件选择、Whisper 模型、FFmpeg 检查和 refine AI 流程；`src/features/workbench/subtitle-controller.js` 可做本地转写及字幕编辑。未在这些入口看到麦克风采集和会议纪要完整工作流。已有音频文件转写应先验收。

**阶段**：先验收文件转写；再补麦克风开始 / 暂停 / 停止、录音本地保存、调用现有转写，以及用户主动触发的摘要 / 决议 / 待办纪要。实时分段转写、系统声音、说话人区分和外接语音 API 为后续独立范围。

**验收**：拒绝麦克风权限、设备断开、无模型、长录音、取消与失败恢复；本地转写无需 AI Key；纪要显式使用用户配置的 AI，未配置时转写仍可用；能导出文字和纪要，不把离线文件转写描述为实时转写。

**2026-11-20 结果**：录音、离线转写、按需 AI 纪要与导出首版完成，见末尾执行记录。真实设备 / AI 服务发布前补测和后续实时 / 混音 / 外接 API 阶段分别保留为 TK-006-A 至 TK-006-D；首版完成不表示这些阶段已实现。

## 已有实现的验收队列

### TK-007 / TK-008：截图与文件搜索（P1）

**来源**：[#125](https://github.com/ZihangDong/toolknit-desktop/issues/125) 拆为截图、文件搜索、磁盘分析三项。作者 2026-11-14 的[回复](https://github.com/ZihangDong/toolknit-desktop/issues/125#issuecomment-6869230626)明确文件搜索已开发。

**本地证据**：`src/features/quick-screenshot/` 和 `src-tauri/src/native_runtime/quick_screenshot/` 已包含截图及独立窗口；`src/features/file-search/`、`src-tauri/src/native_runtime/file_search/` 已包含文件搜索、结果与独立窗口，不需要再增加同类新工具。

**TK-007 验收**：`Alt+Q` 直达框选；标注、撤销、复制 / 保存；Esc 不残留遮罩；不同缩放比例与多屏；贴图、历史和关闭行为。是否有大窗口干扰需实际截图流程确认。

**TK-008 验收**：输入即时搜索、筛选排序、加载更多、路径复制及资源管理器定位；区分索引未就绪、目录无权限与无结果；桌面胶囊 / 主界面状态一致；用大目录检查响应速度，记录测量环境。缺失需求再拆子任务。

**可复用检查**：已有 `scripts/test-quick-screenshot-browser.mjs`、`test-file-search.mjs`、`test-file-search-context.mjs`；原生交互仍需桌面环境验证。

### TK-009：Word 转 PDF（P1）

**来源**：[#116](https://github.com/ZihangDong/toolknit-desktop/issues/116)。

**本地证据**：`src/features/word-to-pdf/`、`src-tauri/src/native_runtime/office/word.rs`、`src-tauri/resources/office/word-to-pdf.py` 和相关测试已存在。README 记载 DOC / DOCX、批量、取消、重试和转入编辑器。

**验收**：用真实 DOC / DOCX 验证页尺寸、边距、分页、字体、图片、表格、页眉页脚，检查批量部分失败、取消、重试、原名输出和目录定位。使用已有 `test:word-to-pdf`、`test:word-to-pdf-browser`、`test:word-to-pdf-native` 等匹配检查，按变更范围选取。

**需另核对的扩展需求**：ZIP 批量输入、目录 / 域更新、水印、加密权限和转换历史。逐项记录现状与缺口后另拆任务，不因基础转换存在而宣称整条议题完成。

**2026-11-20 核对结果与子任务：**

| 子任务 | 当前状态 | 后续范围 |
| --- | --- | --- |
| TK-009-A：基础转换 | 本轮通过；DOC / DOCX，20 个文件、每个 50 MiB | 真实文档回归见执行记录；任意字体及复杂版式不承诺完全一致 |
| TK-009-B：ZIP 输入 | 已完成；桌面逐项入队，CLI / MCP 批量 ZIP，29 项核心 / 19 份共用异常包、4 组 × 41 项浏览器、真实原生转换通过 | 正式安装版文件选择 / 拖放保留 B1 发布前验收；[证据](issues/tk009b-zip.json) |
| TK-009-C：目录 / 域刷新 | 首版完成；默认关闭，内部 ContentIndex 与六类内部域逐项更新，仍保持 `UpdateDocMode = 0` 与禁用宏；10 项规则、4 组 × 52 项浏览器及 9 组真实转换验收通过 | 日期 / 表达式 / 自定义属性及其他索引保留 C1 按需扩展；[证据](issues/tk009c-fields.json) |
| TK-009-C1：其他内部索引 | 基于题注的插图和表格目录已加入白名单。7 份真实输出独立验证 | 日期、表达式、自定义属性和其他索引继续逐类评估 |
| TK-009-D：转换水印 | 首版完成：中英文文字 / PNG / JPEG、透明度 / 大小 / 旋转 / 页范围、实际 PDF 层的 A4 位置预览，桌面 / CLI / MCP 同步 | 9 组核心、4 组 × 63 项浏览器、28 张布局截图、生产入口和 8 组真实验收 / 7 份 PDF 通过；[证据](issues/tk009d-watermark.json)。首版居中；安装版 WebView2 串联列 D1 发布前补测 |
| TK-009-E：转换加密 / 权限 | 首版完成：AES-256 打开密码与打印 / 复制 / 修改 / 注释 / 表单 / 组装权限，桌面 / CLI / MCP 同步，密码仅本次使用 | 7 组核心、CLI 传输隐私、4 组 × 75 项浏览器 / 44 张截图、生产入口与 8 组真实验收 / 6 份独立解密 PDF 通过；[证据](issues/tk009e-encryption.json)。200 页上限，正式安装版 / 发布状态保留 E1 |
| TK-009-F：历史恢复 | 2026-11-21 首版完成：任务中心恢复 Word 队列，逐项核对 SHA-256，保留有效结果、重建丢失项与显式重新生成全部 | 密码与水印内容不进入历史；源文件变化须确认，ZIP 须重加，转换前再校验；旧记录缺源信息须重选，安装版补测见 F1 |

保留主任务 TK-009 未完成；A 基础、B ZIP 输入、C 内部刷新、D 水印与 E 加密首版通过，C1 / F 及 B1 / D1 / E1 发布前验收仍保留。

## 第二批功能

### TK-010：本地 OCR 改字（P2）

**来源**：[#115](https://github.com/ZihangDong/toolknit-desktop/issues/115)。作者 2026-11-14 的[评论](https://github.com/ZihangDong/toolknit-desktop/issues/115#issuecomment-6872818583)预告后续版本可尝试，需要核对实际版本功能，不能把计划视为已交付。

**本地证据**：已有 `src/platform/local-ocr-runtime.js`、原生 OCR、扫描 PDF 转 Word 和 PDF 编辑器；本轮未在 PDF 编辑器入口查到完整的“识别框 → 修改 → 原字覆盖 / 重绘 → 导出”能力。文字识别、生成 DOCX 和扫描图片改字是不同的验收范围。

**阶段**：先检查上游版本和脱敏样例，确认识别框坐标及旋转 / 缩放关系；首版限定纯色背景，支持中英数字、文字框选择、替换、字体 / 字号 / 颜色、撤销与 PNG / PDF 输出；复杂背景修复和隐藏文字层另行推进。

**验收**：安装模型后断网完成全流程；缩放 / 旋转后定位正确，文字修改可撤销；导出实际覆盖原字，字体缺失有提示；隐藏 OCR 层只承诺搜索 / 复制，不能等同于任意 PDF 编辑器都能编辑扫描件原字。依赖 TK-001 的模型可用性。

**2026-11-20 结果**：纯色背景图片 / 扫描 PDF 改字首版完成，真实引擎与导出像素核验见末尾执行记录。复杂背景、可搜索层和完整 WebView2 实机验收分别保留 TK-010-A 至 TK-010-C。

**TK-010-B（首版完成）**：在 PDF 导出旁加入可搜索选项。按当前应用的文字框生成不可见文字层，已验证中英文提取、遮盖和擦除、旋转坐标、页面顺序及视觉一致性。见末尾执行记录。

### TK-011：磁盘空间分析（P2）

**来源**：[#125](https://github.com/ZihangDong/toolknit-desktop/issues/125) 的第三部分。

**本地证据**：有大文件与重复文件清理，未发现独立的磁盘树图分析入口。

**首版**：只读选盘 / 目录扫描，显示当前路径、已扫描大小和不确定总进度；树图和大小列表、逐级进入 / 返回、资源管理器定位；支持取消，保留部分结果。暂停 / 继续按扫描架构另行评估。

**验收**：权限不足和离线磁盘可跳过并展示错误；避免链接循环；明确逻辑大小与占用空间的统计口径，不重复计算硬链接；大目录不卡 UI，原始文件不受扫描影响。

**2026-11-20 实施范围**：独立只读入口；首版选择本机目录或盘符根目录，后台有界扫描，硬链接按身份去重并归于路径排序最前的一项。提供大小降序列表、当前层级矩形树图、逐级浏览和定位，取消保留部分结果；跳过链接 / 重解析点和离线占位项，显示权限或读取错误。统计文件逻辑长度，不承诺物理占用、空闲空间或快照一致性。

**2026-11-20 结果**：只读首版完成，真实临时目录扫描、权限 / 链接 / 离线处理与树图浏览检查通过，见末尾执行记录。完整 WebView2 实机串联和可移动磁盘拔出验收保留为 TK-011-A。

### TK-012：PDF 水印 / 重复对象移除（P2）

**来源**：[#51](https://github.com/ZihangDong/toolknit-desktop/issues/51)。

**推进条件**：先取得可用于开发的样例，按独立文字、图片、页面背景及扫描内容分类，检查现有 PDF 编辑器和导出能力。

**建议范围与验收**：从可分离的文字 / 图片对象着手，选择、预览、批量匹配并移除，支持撤销；导出后正文和页数不变，原文件保留。扫描内容中的水印需另外评估图像修复，不承诺一种方法覆盖所有文档。

**2026-11-20 结果**：可分离对象移除首版完成。文字改写完整 BT…ET 对象内的显示指令并保留文本状态；图像和简单 Form 只移除选定 Do 调用，不全局删除共享资源。实际前后预览、独立渲染与正文保留证据见末尾执行记录。扫描修复、复杂内容及原生 UI 补测分别保留 TK-012-A 至 TK-012-C。

**TK-012-B 部分完成**：支持边界明确的无压缩内联图像。独立对象可定位、预览、精确匹配和移除。其他图像编码、复杂 Form 和注释型图章等仍待评估。

**图章注释已完成首版**：独立、可见且有普通外观流的图章可预览、匹配和移除。锁定图章和带回复、弹窗、结构关联的图章保留。

**Form 内独立对象已完成首版**：可在使用本地资源的多对象 Form 中预览、匹配并移除独立文字或图片。编辑按实际调用隔离，透明组和结构化 Form 保留。

**ASCII 编码内联图像已支持**：验证了单一 ASCIIHex 或 ASCII85 过滤器的结束标记、像素长度以及移除后的正文保留。多级过滤器和其他编码继续评估。

**ASCII 包装的内容流已支持**：页面和 Form 内容流可使用单一 ASCIIHex、ASCII85 或两者各自后接 Flate 的组合。已验证每级边界、参数和解码预算。

**ASCII 包装的 Flate 内联图像已支持**：复用内容流解码器核对两级过滤器的边界和最终样本长度。验收覆盖跨页匹配、嵌套 Form、混合文档及损坏或截断的内层数据。

**单一 Flate 内联图像已支持**：在同一内容流内核对首个 `EI` 候选、完整 zlib 数据与最终样本长度。边界歧义或压缩数据有误时，保留该页内容，其他页可继续处理。

**预测编码内联图像已支持（TK-012-B-A）**：Flate 及 ASCII 包装链可使用 PNG 10–15（1 / 2 / 4 / 8 位）或 TIFF 2（8 位）。仅接受与图像实际宽度、通道、位深一致的直接 DecodeParms，核对 PNG 行标记与完整编码长度；参数加入精确匹配。页面和嵌套 Form 已分别验证。其他预测位深、过滤器和复杂对象仍按 B 评估。

**低位深 TIFF 与 16 位内联图像已支持（TK-012-B-B）**：TIFF 2 扩展到 1 / 2 / 4 位；普通和 PNG 预测图像支持 16 位 Gray / RGB / CMYK。非 8 位预测参数使用完整 BitsPerComponent，BPC 缩写仅在值为 8 时接受。16 位 TIFF 进位样例在 PDF.js / Poppler 间不一致，继续拒绝并保留原页；原始证据与探针可复跑。

**RunLength 已支持（TK-012-B-C）**：页面、嵌套共享 Form 与内联图像支持单一 RunLengthDecode，或 ASCIIHex / ASCII85 各自后接 RunLength；内联支持 RL 别名。按控制段核对字面量、重复字节和 EOD，分配前检查解码长度。内容流和 ASCII 解码后的内部数据必须恰好到 EOD；裸内联在 EOD 后仅接受分隔空白与 EI，并拒绝可能被提前识别的 EI。逆序、超过两级及非空 RunLength 参数继续跳过。

**LZW 首版已支持（TK-012-B-D）**：页面、嵌套 Form 与内联图像支持 LZWDecode 和 ASCII 外层包装，内联支持 LZW 别名；支持 EarlyChange=0/1，暂限 Predictor=1。要求初始 Clear、合法字典引用、显式 EOD、零尾部补位及精确流结束；设置必须与过滤器的名称 / 数组形式对应。96 组图像、长正文与嵌套调用已独立验收，预测组合继续保留。

**LZW 内联预测已支持（TK-012-B-E）**：内联图像及 Form 内的内联图像可使用 PNG 10–15（1 / 2 / 4 / 8 / 16 位）或 TIFF 2（1 / 2 / 4 / 8 位），兼容两种 EarlyChange 和两类 ASCII 包装。图像几何、行标记、完整参数名、解码预算、16 位 TIFF 与参数排列限制继续生效。页面 / Form 的正文绘制流预测仍单独保留。

### TK-013：OrcaRouter 兼容验证（P2）

**实施状态（2026-11-20）：配置与本地回归完成，真实服务待凭据。** 官方协议可通过现有自定义配置表达，无需新增预设。已完成公开目录访问、24 项本地协议、9 项 Edge 设置、17 项 Rust 检查及三组 AI 浏览器流程；[中英文指引](../toolknit-desktop/docs/orcarouter.zh-CN.md)已随 CLI 分发。[证据快照](issues/tk013-compat.json)。没有专用测试凭据，不发送真实生成请求、不复用其他服务密钥，父任务与实际服务验收保持未完成。

**来源**：[#53](https://github.com/ZihangDong/toolknit-desktop/issues/53)。这是提供商团队提出的可选接入建议；本轮只核对协议、公开目录与客户端本地链路，没有验证其全部服务能力或性能宣传。

**本地证据**：`src/ai-provider-core.js` 已支持兼容端点，设置页可配置 DeepSeek / OpenAI / 兼容提供商；CLI 已支持 API URL、模型及密钥覆盖。

**待办与验收**：先对照服务官方文档核对地址、模型和鉴权；在有测试凭据时验证桌面 / CLI / MCP 的成功、鉴权失败、限流、超时和取消。可用现有配置完成时优先补说明，仅在发现真实差距时新增适配；无需注册为默认平台或接入合作分成。无测试凭据时保持“未验证”。

## 前置工作与需求池

| 任务 | 议题 | 当前判断 | 可推进的下一步 / 验收门槛 |
| --- | --- | --- | --- |
| TK-014 | [#114 Windows 右键菜单](https://github.com/ZihangDong/toolknit-desktop/issues/114) | 待正式签名条件；议题记录 2026-10-28 决定暂不启动传统或现代菜单开发 | 条件具备后重新核对签名、安装身份与系统方案；分离菜单扩展、单实例请求队列和工具导入；覆盖冷启动、多选、中文路径、未保存编辑、升级卸载 |
| TK-015 | [#94 macOS](https://github.com/ZihangDong/toolknit-desktop/issues/94) | 待平台调研和真实测试设备；部分代码分支不等于完整客户端支持 | 建兼容性矩阵，选择首批跨平台文件工具；核对依赖、构建、签名、公证以及系统权限；在 Apple Silicon / Intel 的目标范围内验证 |
| TK-016 | [#136 PDF 转 DWG](https://github.com/ZihangDong/toolknit-desktop/issues/136) | 前置调研完成；[线稿原型](PDF_TO_DWG_PROTOTYPE.zh-CN.md)已验证，尚未接入桌面工具 | acad-ts 3.9.0 MIT 路线完成 35 项检查、19 份无原生引擎诊断的 DWG / DXF 验证、19 项 C# 库级修改保存及 6 组字体预览；中文缺字与段宽已修复。原始 LibreDWG 0.14 失败证据保留，真实图纸、交互式 CAD 字体识别与产品集成仍列 TK-016-A / B / C |
| TK-017 | [#19 Minecraft 材质迁移](https://github.com/ZihangDong/toolknit-desktop/issues/19) | 专用领域需求较大，先拆分 | 明确 Java / 基岩版版本、贴图与模型样例；先验证贴图 / 路径 / JSON 检查，模型资产来源、UV 预览与迁移规则另评估 |
| TK-018 | [#75 Web 样式组件](https://github.com/ZihangDong/toolknit-desktop/issues/75) | 正文只有占位内容，作者也在追问含义 | 明确给谁使用、需要哪些组件、输入与输出，补可验收场景后再排期 |
| TK-019 | [#76 vsr_windows_gpu_vxxx.zip](https://github.com/ZihangDong/toolknit-desktop/issues/76) | 无正文，无法判断功能或故障 | 需版本、操作步骤、期望行为和报错；暂不把标题推断为 GPU / 视频超分需求 |

## 全部开放议题覆盖表

每个开放 Issue 均有归属；#125 拆为三项，#117 与 #79 合并。另将已关闭但恢复证据不足的 #137 加入核验，因此形成 19 条待办。

| Issue | 归属 | 处理方式 |
| --- | --- | --- |
| #138 | TK-005 | 新增 PDF 转 PPT，先限定图片型输出 |
| #136 | TK-016 | DWG 可行性调研 |
| #115 | TK-010 | 先核对版本，再补 OCR 改字完整链路 |
| #125 | TK-007、TK-008、TK-011 | 截图 / 搜索验收，新增磁盘分析 |
| #124 | TK-002 | 定位目录复现与修复 |
| #117 | TK-006 | 与会议简记合并 |
| #116 | TK-009 | 已有实现验收，扩展需求拆分 |
| #114 | TK-014 | 保留签名前置条件 |
| #94 | TK-015 | macOS 平台调研 |
| #86 | TK-004 | 单文件扩展为批量队列 |
| #51 | TK-012 | 水印对象分类与技术验证 |
| #79 | TK-006 | 与录音转写合并 |
| #75 | TK-018 | 需求待明确 |
| #76 | TK-019 | 问题待明确 |
| #53 | TK-013 | 优先验证现有兼容配置 |
| #48 | TK-003 | 新增 XML 模式 |
| #19 | TK-017 | 专用需求拆分 |

## 已关闭议题的处理

29 个关闭议题的编号和状态均保存在快照中。除 #137 外，本轮未重新排为新增功能，也未因关闭就认定本分支已通过验收。

已有相关工具或修复记录的图片转 PDF（#96）、空白 PDF（#97）、PDF 转扫描件（#72）、开发者工具（#38）、浅色模式（#40）、截图浮窗（#93）、PDF 压缩（#52）、图片透明背景（#35）等，在对应工具后续回归时参考，避免重复建设。其他历史故障如单实例（#14）、窗口圆角（#1）、CLI 导图（#20）保留在状态快照中，出现新复现证据再进入执行队列。

## 完成记录

- 2026-11-20：完成全量议题状态查询、开放议题及 #137 评论核对、相关代码入口核对，建立 19 条待办。本轮仅新增待办与来源文档；未运行功能测试，未修改 GitHub 议题状态，未开始功能实现。

## 开发执行记录

### 2026-11-22：TK-012-B-N 多外观状态图章

支持直接或间接的正常外观字典；`/AS` 必须明确选中一个间接 Form 外观流。精确匹配同时比较状态名和外观引用，保留同一外观的不同状态别名及单流图章。缺失或无效状态、不支持的外观流和带鼠标悬停或按压外观的状态字典仍跳过。

五页样例包含五枚图章，只移除两枚正常外观和状态都匹配的图章，所有链接及正文保持原样。两份 qpdf 检查通过；Poppler 和 PDF.js 各通过五页逐像素比对，PDF.js 额外确认仅切换状态即可改变可见外观。9 种异常配置、447 项 Edge 检查、完整回归、生产构建和实际入口均通过。本轮未重新打包 NSIS。[验收快照](issues/tk012b-stamp-states.json)

### 2026-11-22：TK-012-B-M 带独占弹窗的图章

同页的图章与关闭弹窗在互相引用且各自只出现一次时可作为一项移除。精确匹配只选当前配对，避免连同外观相同但评论不同的图章移除。导出仅从所选页的批注列表移除两个条目；正文、其他批注和其他页保持原样。带回复、跨页、共享、锁定、开启的弹窗和带动作的弹窗仍跳过。

两页夹具包含外观和位置相同、评论不同的两个配对；仅移除第一页配对，保留两页正文和链接。12 种异常配对仍可保留原批注并编辑其他对象。两份 qpdf 检查，Poppler 和 PDF.js 各两页与独立参考逐像素一致。完整回归、438 项 Edge 检查、生产构建和实际入口均通过。本轮未重新打包 NSIS。[验收快照](issues/tk012b-stamp-popup.json)

### 2026-11-22：TK-012-B-L 普通非隔离透明组

普通非隔离组在未声明组色彩空间、页面和父 Form 都没有透明组、调用处使用默认合成状态时，可编辑内部独立对象。组内局部状态限定为普通或正片叠底混合及合法透明度；软蒙版、转移函数、内部 XObject 调用、图案和着色继续跳过。调用外可有普通 Form 包装。精确匹配绑定当前调用，保留原组字典和其他调用。

三页合成样例覆盖四处共享调用、不同背景和普通 Form 包装，只编辑两处。PDF.js 与 MuPDF 各通过三页隔离对照及三页编辑参考逐像素比对；Poppler 也通过三页编辑参考。11 种额外入口配置包含调用处透明度、混合模式、软蒙版、页面或父级透明组，以及显式默认状态和恢复后的默认状态。qpdf、432 项 Edge 检查、完整回归、生产构建及首页入口通过。本轮未重新打包 NSIS。[验收快照](issues/tk012b-transparency-ordinary.json)

### 2026-11-22：TK-012-B-K 非隔离挖空透明组

非隔离挖空组在未声明组色彩空间时可编辑内部的独立对象，支持显式关闭隔离或省略隔离标志。精确匹配绑定到当前调用，即使共享组引用、绘制指令和位置完全相同，也不会匹配背景可能不同的其他调用。克隆保留原组字典和未选调用。非挖空的非隔离组及显式声明色彩空间的非隔离组仍跳过。

三页合成样例覆盖四处共享调用、不同颜色的背景和嵌套调用；只移除其中两处。PDF.js 和 MuPDF 各三页区分隔离开关，各三页编辑结果与独立参考逐像素一致；Poppler 也通过三页编辑对照。qpdf、424 项 Edge 检查、完整回归、生产构建和首页入口通过。可在包目录运行 `node scripts/test-pdf-transparency-backdrop.mjs`，再用测试环境中的 PyMuPDF 运行 `python scripts/verify-pdf-knockout-mupdf.py tmp/pdf-transparency-group-backdrop --backdrop`。本轮未重新打包 NSIS。[验收快照](issues/tk012b-transparency-backdrop.json)

### 2026-11-21：TK-012-B-J 隔离挖空透明组

显式隔离的 DeviceGray、DeviceRGB、DeviceCMYK 组允许布尔型挖空标志为真。选中的直接或嵌套调用继续按调用克隆，保留原组字典、色彩空间及挖空标志；未选调用不变。非隔离组、未声明或自定义色彩空间以及异常标志仍跳过。

三组样例共九页，分别在重叠的半透明内容上核对挖空开关及移除结果。PDF.js 和 MuPDF 各通过九页开关对照及九页编辑参考逐像素比对。Poppler 也通过九页编辑参考对照，但它和本机 PDFium 在开关样例上未体现像素差异，因此没有将它们计作挖空效果验证。三份 qpdf 输出检查、416 项 Edge 检查、完整回归、生产构建及 CMYK 挖空样例的生产入口均通过。本轮未重新打包 NSIS。

可在包目录先运行 `node scripts/test-pdf-transparency-group.mjs`，再用独立环境中的 PyMuPDF 运行 `python scripts/verify-pdf-knockout-mupdf.py tmp/pdf-transparency-group-knockout`。[验收快照](issues/tk012b-transparency-knockout.json)

### 2026-11-21：TK-012-B-I 灰度与 CMYK 隔离透明组

隔离、无挖空的透明组现在也接受显式 DeviceGray 与 DeviceCMYK。编辑直接或嵌套调用时保留原组字典和色彩空间；非隔离、挖空、自定义或未声明色彩空间的组仍跳过。两种新增样例各三页，覆盖半透明绘制、不同背景、共享调用和嵌套调用。每份只改选中的两处，未选调用和正文保留。

两份新增输出通过 qpdf，Poppler 和 PDF.js 各六页与独立参考逐像素一致；加上 DeviceRGB 回归，两套渲染器各九页。12 种不支持的组配置仍被跳过。完整回归、392 项 Edge 检查、生产构建与 CMYK 样例的首页入口均通过。本轮未重新打包 NSIS。[验收快照](issues/tk012b-transparency-colors.json)

### 2026-11-21：TK-012-B-H 隔离透明组内对象移除

显式隔离、无挖空的 DeviceRGB 透明组可预览、匹配和移除内部独立对象，支持直接及嵌套调用。只在检查内部对象时开放，整组不作为单一对象。按调用克隆时保留原透明组字典，未选调用继续使用原资源。非隔离、挖空、其他颜色空间、异常组字典及结构化 Form 继续跳过。

三页合成夹具在半透明图形和不同颜色背景上放置同一组的四处调用，单独移除其中两处。qpdf 检查通过；Poppler 和 PDF.js 各三页与独立参考逐像素一致。另验证 12 种拒绝配置、默认无挖空，以及在编辑页内其他对象后被跳过的组字典和流字节不变。完整回归、378 项 Edge 检查、生产构建及首页入口均通过。本轮未重新打包 NSIS。[验收快照](issues/tk012b-transparency-group.json)

### 2026-11-21：TK-012-C 安装版验收通过

在同一份 NSIS 隔离安装版中从首页进入 PDF 对象移除，通过 Windows 文件选择器打开七页合成样例。安装包内的 Worker 分析出 15 个可分离对象，首个标记精确匹配六页，第七页单独加入 Form 内的标记。PDF.js 显示原页、移除后页面和变化范围，两处正文都保留。随后从界面写入 PDF 到本机默认输出目录并返回首页。

使用准备阶段的核验脚本直接检查安装版写出的文件：七处目标均已移除，七页正文和 Form 正文保留，源文件 SHA-256 不变。qpdf 检查通过，Poppler 和 PDF.js 各对七页与参考件完成逐像素比对。验收限定本机隔离安装版；无发布操作。[验收快照](issues/tk012c-native-acceptance.json)

### 2026-11-21：TK-012-C 安装版验收准备

从当前源码构建并安装 NSIS 隔离验收包，使用独立应用标识、可执行文件名和 WebView2 数据目录；已确认安装产物能启动桌面窗口和 WebView2 进程。系统文件选择对话框单独用合成 PDF 验证选取。安装版应用内的文件选择、Worker / 预览和原生导出尚未串联，TK-012-C 保持未完成。

在包目录运行 `npm exec tauri -- build --config scripts/fixtures/pdf-object-remove-native.conf.json --bundles nsis` 可重建无调试端口的验收包。使用 `node scripts/test-pdf-content-predictor.mjs` 生成合成样例。打开该样例的副本，在首页搜索水印并进入对象移除，匹配前六页的标记，第七页单独加入 Form 内的标记，再预览并导出。将所选样例及生成的文件路径传给 `node scripts/verify-pdf-object-remove-native-output.mjs <输入> <输出>`；脚本核对原件哈希、目标移除、正文保留、qpdf 语法及两套渲染器的七页像素。核验脚本已用核心回归生成的正确输出试跑通过。[验收快照](issues/tk012c-native-preflight.json)

### 2026-11-21：TK-012-B-G 绘制流多通道与位深

页面与 Form 的 Flate、LZW 绘制流新增 1–4 通道预测几何，兼容原有 ASCIIHex、ASCII85 包装和两种 LZW EarlyChange。PNG Predictor 10–15 接受 1 / 2 / 4 / 8 / 16 位，按每像素占用的字节数还原；TIFF Predictor 2 按通道恢复水平差分，每行重置，接受 1 / 2 / 4 / 8 位且整行无填充位。16 位 TIFF 和含填充位的 TIFF 绘制流继续跳过。行长度、PNG 行标记、解码预算和坏页保留规则继续生效。

专项通过 1,287 组逐字节对照，其中 1,224 组覆盖显式通道数和位深参数。七页夹具包含低位深 TIFF、16 位 PNG 及 4 位 TIFF 的 LZW Form；原件和编辑结果分别与无预测参考件对照，共通过 Poppler 和 PDF.js 各 14 页逐像素比较、1 份 qpdf 输出检查。完整对象移除回归、371 项 Edge 检查、生产构建和生产入口均通过。正式安装版 Tauri / WebView2 验收仍列 TK-012-C。[验收快照](issues/tk012b-content-geometry.json)

### 2026-11-21：TK-012-B-F 页面与 Form 绘制流预测

页面与 Form 绘制内容流新增 Flate、LZW 的 8 位单通道 PNG Predictor 10–15 和 TIFF Predictor 2，支持已有的单层 ASCIIHex、ASCII85 包装和两种 LZW EarlyChange。`content-stream.js` 核对过滤器与参数容器、预测器和列数。`content-predictor.js` 校验完整行和 PNG 行标记，将残差还原成绘制指令再分析。ASCII 中间数据、残差和还原字节分别计入原有解码预算。坏行所在页保留原始内容流，合法相邻页可编辑。其余位深、多通道与安装版实机仍待验证。

专项 `scripts/test-pdf-content-predictor.mjs` 完成 63 种编码组合的原始字节对照，覆盖参数错误、坏行及预算边界。7 页 PDF 样例包含一个预测编码 Form，原图和编辑结果共完成 14 页 Poppler 逐像素比较、2 次 PDF.js 首页对比和 1 份 qpdf 输出检查。完整对象移除回归及 371 项浏览器检查通过。生产构建的首页入口完成跨页匹配、Form 内目标选择、预览、下载和返回首页。证据见 [验收快照](issues/tk012b-content-predictors.json)。

### 2026-11-21：TK-012-B-E LZW 内联图像 PNG / TIFF 预测组合

**完成范围：** LZW 内联图像可叠加 PNG Predictor 10–15 或 TIFF Predictor 2，包括嵌套共享 Form 内的内联图像。支持 EarlyChange=0/1、单一 LZW 与 ASCIIHex / ASCII85 各自外层包装；位深沿用 PNG 1 / 2 / 4 / 8 / 16 位、TIFF 1 / 2 / 4 / 8 位和 Gray / RGB / CMYK。仅扩展内联图像；页面及 Form 正文绘制流保持 Predictor=1，未将残差字节直接作为正文解析。

**实现与约束：** `src/features/pdf-object-remove/lzw.js` 将码宽参数 EarlyChange 与预测字典分离，继续校验参数容器形态、重复键和整数；`lexer.js` 将预测部分交由既有 `inline-predictor.js` 校验，二进制 LZW 的 EOD 扫描输出改与预测前编码行长度（含 PNG 每行标记）比较。`validateInlineImageSamples` 复用已有 LZW 限量解码及 PNG 行标记检查，未添加新的图片重绘或重编码器。预测与 EarlyChange 已分别进入匹配指纹。Columns / Colors / BitsPerComponent 必须与图像一致，非 8 位 BPC 缩写、16 位 TIFF、PNG 非法标记、截断 / 尾随数据、跨流或提前 EI 继续拒绝；8 MiB 单级及 32 MiB 总预算计入 PNG 行标记和 ASCII 中间数据。

**夹具与复跑：** `scripts/lib/pdf-object-fixtures.mjs` 生成正确 LZW 预测参数与残差，并允许在既有嵌套 Form 夹具内放置 LZW 预测图像。新增 `scripts/test-pdf-lzw-predictor.mjs` 并串入 `npm run test:pdf-object-remove`；原 `test-pdf-lzw.mjs` 明确正文流预测仍不开放。专项 **8 组**包括默认 / 显式 EarlyChange、全部支持预测器、几何与别名重复、参数形态、非法 PNG 行标记、LZW 截断 / 尾随、逐级预算、指纹隔离、原字节不变和坏页保留。

**独立结果：** 共 **69 组**图像：42 组预测器 / EarlyChange / 包装组合、21 组选定的位深 / 通道组合、6 组会触发码宽切换和字典重置的长图；另 **4 组** TIFF / PNG × EarlyChange 嵌套 Form，验证仅移除目标调用。**73 份 qpdf**输出、**288 页 Poppler**原图 / 无预测参考及移除 / 干净参考逐像素比较、**142 次 PDF.js 首页**比较均通过。`npm run test:pdf-object-remove` 中既有 107 项核心、10 组 Flate 预测、8 组位深、9 组 RunLength 和 10 组 LZW 回归亦通过。

`npm run test:pdf-object-remove-browser` 通过 **357 项**真实 Edge 检查，新增 TIFF、PNG Paeth / adaptive、两种 EarlyChange、三类包装、长图、CMYK 16 位和 Gray 1 位的实际 Worker / PDF.js 预览与导出；嵌套图像移除保留所有共享文字，独立 Poppler 比较通过，非法 PNG 行标记页只读而相邻合法页可编辑。`npm run build` 与 `npm run test:pdf-object-remove-production` 通过，生产首页加载长图 PNG adaptive + EarlyChange=0 + ASCII85 / LZW，完成匹配、前后预览、下载和返回首页。既有 chunk 体积及 launcher 导入警告保留。

**证据与保留项：** [脱敏快照](issues/tk012b-lzw-predictors.json)，包目录 `tmp/pdf-lzw-predictor/report.json`、69 组源 / 参考 / 输出 PDF 与 PNG、四组 Form 及坏页样例，`tmp/pdf-lzw-predictor-regression.log`、`browser.log`、`build.log`、`production.log`（后三者完整名称均以 `pdf-lzw-predictor-` 开头）。勾选 B-E；正文绘制流预测、TIFF 16 位阅读器差异、其他过滤器与复杂对象继续保留。正式安装版原生文件选择 / 写入串联仍列 TK-012-C，浏览器原生传输是隔离夹具；未构建或发布安装包。

### 2026-11-21：TK-012-B-D LZW 页面、Form 与内联图像首版

**完成范围：** 单一 LZWDecode 或 ASCIIHex / ASCII85 各自后接 LZWDecode，覆盖页面内容流、嵌套共享 Form 及内联图像。内联支持 LZW / LZWDecode 名称及单元素数组，图像沿用 1 / 2 / 4 / 8 / 16 位 Gray / RGB / CMYK。EarlyChange 缺省为 1，可显式设 0 或 1；预测只接受缺省或 Predictor=1，其他参数 / 预测变换、逆序与超过两级的链继续跳过。

**解码边界：** 新增 `src/features/pdf-object-remove/lzw.js`，使用固定 4096 项字典；先只扫描词条长度与首字节，核对初始 Clear、字典重置、9–12 位码宽、特殊新词条、满表后保留已有词条、必需 EOD 及零补位，再按已核对长度分配输出并第二遍解码。严格拒绝未来或清空后的旧词条、截断码、EOD 后整字节数据和超限输出；每级 8 MiB、总计 32 MiB 预算继续计入 ASCII 中间数据。裸内联还要求同流明确边界、分隔符与 EI，并拒绝可能提前结束的 EI；包装数据按 ASCII 终止符限定，再核对内部 LZW 完整结束及样本长度。EarlyChange 加入图像指纹，避免相同短压缩数据跨参数误匹配。

**长样例发现的参数排列问题：** 单元素过滤器数组若搭配单个参数字典，短数据在码宽未切换时可能看似正确，而长 EarlyChange=0 图像会在阅读器中出现不同结果。夹具已改为对应的单元素参数数组；解析器对非空参数要求名称配字典、过滤器数组配对应参数数组，全 null 参数数组按缺省处理。原生与内联两条路径均有不匹配形态的拒绝检查，不再以短样例代替码宽切换验收。

**修改文件：** `content-stream.js` 读取 / 校验逐级 LZW 参数并接入限量解码；`lexer.js` 检查二进制 / 包装边界及内联设置；`processor.js` 扩展精确匹配指纹。`scripts/lib/pdf-object-fixtures.mjs` 增加独立词组编码器、码宽打包器及长图输入；新增 `scripts/test-pdf-lzw.mjs`，并提取独立阅读器比较为 `scripts/lib/pdf-removal-render-qa.mjs`。现有不支持组合的测试改用 ASCIIHex → DCT，保留未支持过滤器的拒绝覆盖。没有新增应用依赖、界面、CLI / MCP 工具或设置项。

**验证：** `npm run test:pdf-object-remove` 通过既有 **107 项核心、10 组预测、8 组位深、9 组 RunLength**回归，以及新增 **10 组 LZW**专项。字节级对照使用两种 EarlyChange、空流、重复词条、多个码宽边界、50000 字节确定性输入、满表冻结及重复 Clear，与 pdf-lib 解码结果一致；拒绝缺少 Clear / EOD、未来词条、非零补位、截断 / 尾随数据、非法参数、预算超限和不匹配参数形式。图像验收为 **90 种**位深 / 通道 / 包装 / EarlyChange 组合，加 **6 种**会切换码宽和重置字典的长图；正文有六页长注释流与真实可搜索内容，Form 混用两种 EarlyChange 并验证调用隔离。**98 份 qpdf**输出检查、**393 页 Poppler**逐像素比较和 **194 次 PDF.js 首页**比较全部通过，源字节不变，坏页保留且合法相邻页可编辑。

`npm run test:pdf-object-remove-browser` 通过 **299 项**真实 Edge 检查，包含两种 EarlyChange、三类包装的真实 Worker 候选、两份长图、六页长正文流、混合参数嵌套 Form、单项预览 / 精确匹配 / 导出、可搜索正文、原生写入夹具与独立 Poppler 核验。`npm run build` 与 `npm run test:pdf-object-remove-production` 通过，生产首页载入长图 EarlyChange=0 + ASCII85 / LZW，完成匹配、实际 PDF.js 预览、下载和返回首页。原有 chunk 体积与 launcher 导入警告保留。

**证据与余项：** [脱敏快照](issues/tk012b-lzw.json)；包目录 `tmp/pdf-lzw/report.json`、96 组原始 / 参考 / 编辑 PDF 与 PNG、`page-*` / `form-*` / `mixed.pdf`，以及 `tmp/pdf-lzw-regression.log`、`browser.log`、`build.log`、`production.log`（后三者完整名称均以 `pdf-lzw-` 开头）。勾选 B-D 首版，LZW 预测变换、TIFF 16 位阅读器差异、其他过滤器、复杂 Form / 图章 / 混合文字继续保留。浏览器原生传输仍是隔离夹具，正式 Tauri / WebView2 串联列 TK-012-C；未构建或发布安装包。

### 2026-11-21：TK-012-B-C RunLength 内容流与内联图像

**完成范围：** 页面内容流、嵌套共享 Form 及内联图像支持 RunLengthDecode；内联支持 RL / RunLengthDecode 和单元素数组别名，且保留精确跨页匹配。可单独使用或置于 ASCIIHex / ASCII85 之后，过滤器参数只接受缺省、null 或逐层匹配的全 null 数组。RunLength 不开放预测字典，逆序或超过两级的链继续跳过。内联图像覆盖现有 1 / 2 / 4 / 8 / 16 位 Gray / RGB / CMYK，未放开其他图像字典或复杂结构。

**边界与资源：** 新增 `src/features/pdf-object-remove/run-length.js`，先逐段扫描，不分配解码输出；控制值 0–127 的字面量段、129–255 的重复段必须完整，128 为必需的 EOD，累计长度先受预算约束。内容流或 ASCII 包装内的 RunLength 数据必须恰好在 EOD 结束，不接受尾随垃圾；裸内联数据在 EOD 后只接受分隔空白及 EI，不从其他内容流借字节，并拒绝数据内可能被阅读器提前解释的 EI。最终图像长度须与宽、高、通道及逐行位补齐一致。8 MiB 单级与 32 MiB 累计预算保留；外层 ASCII 的中间结果与内层输出分别计数。嵌套编辑仅克隆所选调用路径，原共享 Form 和其他调用保留；坏页保留，合法相邻页可继续编辑。

**修改文件：** `content-stream.js`、`lexer.js` 接入扫描 / 解码与对应编码指纹；`inline-predictor.js` 允许符合过滤器数量的全 null 参数数组，预测字典仍只用于 Flate。`scripts/lib/pdf-object-fixtures.mjs` 新增独立 RunLength 夹具编码器与图像变体；旧“不支持过滤器”样例改为阅读器可渲染、但顺序不受支持的 RunLength → ASCIIHex 链，继续验收跳过行为。原不支持内联组合断言改为 ASCIIHex → LZW，坏 RunLength 数据由新增专项覆盖。新增 `scripts/test-pdf-run-length.mjs` 并接入 `npm run test:pdf-object-remove`，扩展真实浏览器和生产入口脚本。

**验证：** `npm run test:pdf-object-remove` 通过既有 **107 项核心、10 组预测、8 组位深**回归及新增 **9 组 RunLength**专项。专项遍历全部字面量和重复控制值，以已知字节和 pdf-lib 独立解码对照，覆盖段边界、EOD 值作为样本、空流、截断 / 尾随字节、提前 EI、跨流边界、参数、单级与两级预算、坏页隔离、跨页匹配和源字节不变。**45 种**位深 / 颜色 / 编码组合、三种页面流编码与嵌套共享 Form 均通过；qpdf 接受 **47 份**编辑输出，Poppler 对原图 / 无编码参考及移除 / 干净参考做 **186 页**逐像素比较，PDF.js 完成 **92 次首页**比较，全部一致。

`npm run test:pdf-object-remove-browser` 通过 **232 项**真实 Edge 检查，新增三种 RunLength 内联图像、三页不同编码正文、嵌套共享 Form 的实际 Worker 列表、跨页匹配、PDF.js 前后预览、保留正文、隔离原生写入及 Poppler 导出检查；损坏内层数据页保持只读，合法相邻页仍可选择。`npm run build` 和 `npm run test:pdf-object-remove-production` 通过，生产首页载入 ASCII85 + RunLength 图像样例并完成匹配、预览、PDF 下载和返回首页。既有 chunk 体积与 launcher 导入警告保留。

**证据与保留项：** [脱敏快照](issues/tk012b-runlength.json)，包目录 `tmp/pdf-run-length/report.json`、PDF / PNG 样例、`tmp/pdf-run-length-regression.log`、`browser.log`、`build.log`、`production.log`（后三者完整名称均以 `pdf-run-length-` 开头）。勾选 B-C；TIFF 16 位阅读器差异、LZW / 其他过滤器、结构或透明组 Form、关联 / 锁定图章与混合文字继续保留。正式安装版 Tauri / WebView2 串联仍列 TK-012-C，浏览器原生传输为隔离夹具，未构建或发布安装包。

### 2026-11-21：TK-012-B-B 低位深 TIFF 与 16 位内联图像

**完成范围：** TIFF Predictor 2 新增 1 / 2 / 4 位 DeviceGray、DeviceRGB、DeviceCMYK；普通内联图像和 PNG 预测图像新增 16 位。继续沿用同流边界、首个 EI、完整 zlib、精确行长度、几何一致性及 8 MiB / 32 MiB 解码预算。预测参数已进入指纹，不因压缩字节相同就跨不同解释方式匹配。无新增界面、依赖或 CLI / MCP 入口。

**阅读器差异与保留限制：** 初轮真实比对发现，DecodeParms 内非 8 位 BPC 缩写在 PDF.js 与 Poppler 中会产生不同图像；非 8 位参数现在只接受完整 BitsPerComponent，BPC=8 仍可用。进一步以完整参数名生成 16 位 TIFF、包含跨字节进位 / 模回绕的样例：PDF.js 与无预测原图一致，Poppler 不一致。该类型继续拒绝，而普通 16 位及 PNG 16 位通过验证。探针不把不一致强行判为通过、不归因于已定位的引擎缺陷，也不改写原 PDF。两份复现样例在本轮分别有 26244 / 12774 个 Poppler 通道字节与参考不同；其 PDF.js 渲染均一致，运行报告保留双方结果。未来引擎变化时需重新评估。

**实现文件：** 包目录 `src/features/pdf-object-remove/lexer.js` 扩展允许位深到 16，`inline-predictor.js` 放开 TIFF 1 / 2 / 4 位并加入参数缩写与 TIFF 16 位限制。`scripts/lib/pdf-object-fixtures.mjs` 增加逐样本的 TIFF 打包编码、按通道差分、行重置和 16 位大端数值进位，保留未使用的行补位；图片夹具可选择位深、宽高和通道。新增 `scripts/test-pdf-inline-depths.mjs`，在 `npm run test:pdf-object-remove` 串联执行；浏览器与生产入口使用对应真实样例。

**验证：** 既有 **107 项**核心和 **10 组**预测检查回归通过。新增 **8 组**检查覆盖 1 / 2 / 4 位已知差分、16 位进位、PNG 行标记预算、非法位深、参数几何、截断 / 多余数据、跨页精确匹配、保留不同图像与可搜索正文、原字节不变，以及两类有阅读器差异样例的只读保护。合计 **45 种**位深 / 通道 / 过滤器组合：27 种低位深 TIFF、9 种 16 位 PNG adaptive、9 种 16 位 raw / ASCII。qpdf 检查 45 份移除输出通过；Poppler 对原图与无预测参考、移除结果与干净参考的 **180 页**逐像素比较通过；同一矩阵的 **90 次 PDF.js 首页**比较全部一致。测试随后单独记录被拒绝类型的阅读器差异，不混入通过计数。

`npm run test:pdf-object-remove-browser` 通过 **198 项**真实 Edge 检查，新增低位深 TIFF 三种通道、16 位 PNG CMYK 与 raw RGB 的 Worker 候选、实际差异预览、跨页匹配、导出、可搜索正文和独立 Poppler 核验；两类歧义样例显示不可编辑且保留原页。`npm run build` 与 `npm run test:pdf-object-remove-production` 通过，生产首页载入 16 位 CMYK PNG adaptive + ASCII85 / Flate，完成匹配、预览、下载和返回首页。既有 chunk 体积与 launcher 导入警告保留。

**证据与下一条件：** [脱敏快照](issues/tk012b-depths.json)，包目录 `tmp/pdf-inline-depths/report.json`、两类探针 PDF / PNG、45 组原始 / 参考 / 输出文件，`tmp/pdf-inline-depths-test.log`、`regression.log`、`browser.log`、`build.log`、`production.log`（后四份完整名称均以 `pdf-inline-depths-` 为前缀）。勾选 B-B；B 父项保留 TIFF 16 位、其他过滤器与复杂对象。正式 Tauri / WebView2 的文件选择、原生写入及安装版生命周期仍列 TK-012-C，浏览器原生传输为夹具；未构建或发布安装包。

### 2026-11-21：TK-012-B-A PNG / TIFF 预测编码内联图像

**完成范围：** 现有内联图像移除链新增 PNG Predictor 10–15，支持 1 / 2 / 4 / 8 位 DeviceGray、DeviceRGB、DeviceCMYK，以及 TIFF Predictor 2 的 8 位样本。适用于单一 Flate 和 ASCIIHex / ASCII85 各自后接 Flate，沿用现有首个 EI、同流边界、完整 zlib 校验和无尾随数据要求。页面与嵌套共享 Form 的独立调用均可定位、精确匹配、预览并移除。

**参数与字节核对：** 新增 `src/features/pdf-object-remove/inline-predictor.js`，只接受直接字典或与过滤器逐级对应的数组，ASCII 层参数必须为 null。支持 DP / DecodeParms、预测参数内 BPC / BitsPerComponent 的规范化，拒绝重复或别名重复键、未知键、非法数值和不匹配的 Columns / Colors / BitsPerComponent。默认参数按 PDF 规范为 Predictor=1、Colors=1、BitsPerComponent=8、Columns=1；启用预测时必须与图像几何相符。PNG 解压长度包含每行一字节行标记，行标记只能为 0–4；TIFF 使用无额外行标记的完整样本长度。这里只验证数据边界与可解释性，实际图片预览仍由 PDF.js 渲染，不重编码剩余图像。规范化预测参数进入对象指纹，防止同一压缩字节在不同预测语义下被误匹配。8 MiB 单流与 32 MiB 累计解码预算保留，并计入 PNG 行标记及 ASCII 解码中间数据。坏页保留，其他页可编辑。

**修改与复跑：** `lexer.js` 解析参数并检查几何，`content-stream.js` 核对预测行长度与标记，`processor.js` 扩展指纹；新增 `scripts/test-pdf-inline-predictor.mjs`，扩展 `scripts/lib/pdf-object-fixtures.mjs`、浏览器与生产入口脚本。`npm run test:pdf-object-remove` 串联既有 107 项核心回归和新增 10 组检查。新增检查覆盖 21 种预测器 / 过滤器组合、12 种位深 / 颜色组合、全部五类 PNG 行标记、参数和 zlib 损坏、预算、跨页匹配、源字节不变、坏页隔离及嵌套共享 Form。qpdf 接受 22 份编辑后输出；Poppler 将预测原图与无预测原图、移除结果与干净参考做 **99 页逐像素比较，全部一致**。

`npm run test:pdf-object-remove-browser` 通过 **166 项**真实 Edge 检查，包括 TIFF + ASCIIHex、PNG Paeth、PNG adaptive + ASCII85 的 Worker 列表、单项定位、跨页匹配、实际 PDF.js 差异预览、可搜索正文、原生写入夹具与 Poppler 输出比对；损坏 PNG 行标记页不可编辑，相邻合法页仍可编辑。`npm run build` 与 `npm run test:pdf-object-remove-production` 通过，生产首页真实加载 PNG adaptive + ASCII85 样例，完成匹配、预览、下载及返回首页；既有 chunk 体积及 launcher 导入警告保留。

**证据与余项：** [脱敏快照](issues/tk012b-predictors.json)，包目录 `tmp/pdf-inline-predictor/report.json`、样例 PDF / PNG、`tmp/pdf-object-remove-browser/report.json`、`tmp/pdf-inline-regression.log`、`tmp/pdf-inline-build.log` 和 `tmp/pdf-inline-production.log`。勾选 B-A；B 父项保留 TIFF 非 8 位、其他过滤器、结构 / 透明 Form、关联图章和混合文字。未运行正式安装版原生 UI，浏览器原生传输仍为隔离夹具；安装版串联列 TK-012-C，未构建或发布安装包。

### 2026-11-21：TK-012-B 单一 Flate 内联图像

边界明确的单一 Flate 内联图像可定位、预览、精确跨页匹配并移除。`/Fl` 和 `/FlateDecode` 视为同一过滤器。只检查同一内容流里的第一个 `EI` 候选，要求压缩数据解码完整、校验和正确、无尾随字节，且样本长度符合图像参数。歧义、损坏或截断的数据所在页保留，其他页仍可移除。预测变换和其他过滤器仍列 TK-012-B。

核心测试通过 107 项，包含跨内容流边界、疑似提前出现的 `EI`、尾随字节和解码预算；导出通过 qpdf，Poppler 对移除前后页面与参考逐像素比对。浏览器验收通过 146 项，覆盖真实 Worker、PDF.js 预览、跨页匹配、可搜索正文和坏页隔离。双语帮助检查、生产构建及首页下载验收通过。正式安装版仍列 TK-012-C。

### 2026-11-21：TK-012-B ASCII 包装的 Flate 内联图像

图像过滤器数组可为 ASCIIHex 或 ASCII85 后接 Flate，支持缩写与全名。外层编码必须在同一内容流内以明确的结束标记结尾，随后须有独立的 `EI`。每级解码计入累计预算，解压后的字节数必须与图像宽高、通道数、位深和行补位推导的长度一致。损坏数据所在页跳过绘制对象分析，其他页可继续。单独使用 Flate 的内联图像、预测变换和其他过滤器组合继续保留在待办。

`npm run test:pdf-object-remove` 通过 97 项。两种组合的移除前后页面均与 Poppler 无编码参考逐像素一致，导出通过 qpdf。嵌套 Form 样例覆盖组合编码的图像隔离移除。`npm run test:pdf-object-remove-browser` 通过 138 项，验证真实预览、跨页匹配和可搜索正文。生产构建从真实首页完成 ASCII85 后接 Flate 的目标图像移除及下载。正式安装版验收仍列 TK-012-C。

### 2026-11-21：TK-012-B ASCII 包装的内容流

PDF 水印／对象移除可分析使用 ASCIIHex、ASCII85，或分别以这两种编码包装 Flate 的页面与 Form 内容流。解码按照字典中的过滤器顺序执行。ASCII 阶段在解码前校验结束标记和输出长度，Flate 只接受无预测变换的参数。各级输出受单流与文档累计解码预算限制。其他过滤器、参数异常或损坏流所在页的绘制内容继续保留。内联图像仍限定原有的无编码或单一 ASCII 过滤器。

`npm run test:pdf-object-remove` 通过 82 项，涵盖四种过滤链和嵌套 Form，以及错误顺序、参数不匹配、截断数据、损坏的内层 Flate 和累计预算。四页样例导出通过 qpdf 检查，并与独立构造的 Poppler 参考页逐像素一致。`npm run test:pdf-object-remove-browser` 通过 126 项，验证实际选择、预览、跨页匹配和导出后正文仍可搜索。生产构建从真实首页完成匹配、预览和下载。正式安装版验收仍列 TK-012-C。

### 2026-11-21：TK-012-B ASCIIHex 和 ASCII85 内联图像

内联图像可使用单一 ASCIIHex 或 ASCII85 过滤器，两者支持缩写和单项过滤器数组。解析按图像参数核对解码后样本长度，并要求编码结束标记和紧随其后的 `EI` 都在同一个内容流内。缺少合法结束标记、样本数不符或使用其他过滤器的页面继续保留。跨页精确匹配以同一编码的数据和绘制状态为准，缩写与全名视为同一编码。

`npm run test:pdf-object-remove` 通过 72 项，覆盖异常标记、错误样本长度、ASCII85 部分分组和数据内的 `EI` 字符。两种编码的导出均通过 qpdf 检查，Poppler 将移除前后的对应页面与无编码参考逐像素比较。`npm run test:pdf-object-remove-browser` 通过 118 项，验证真实预览、跨页匹配和导出后正文仍可搜索。生产构建从首页完成 ASCII85 图像移除和下载。安装版仍列 TK-012-C。

### 2026-11-21：TK-012-B 嵌套 Form 内独立对象

对象列表标明 Form 内的独立文字和图片。若 Form 使用本地资源且绘制指令可解析，分析会沿调用路径最多深入四层。精确匹配比较 Form 资源身份、调用位置与进入时的绘制状态。轮廓有剪裁歧义时限制为当前实例。透明组、可选内容、语义结构和依赖外部资源的 Form 跳过。

导出仅复制所选对象的 Form 路径及需修改的资源字典。同一 Form 的其他调用保留，即使位于同页或共享资源字典。支持一次移除同一 Form 调用里的多个对象。复制受每流、累计解码和输出体积限制。

`npm run test:pdf-object-remove` 通过 58 项。三页合成 PDF 验证两层嵌套、同页重复调用、共享页面资源、同位置跨页匹配和同一次调用内的文字与图片组合移除。单次和跨页结果都通过 qpdf 检查和 Poppler 逐像素比对。`npm run test:pdf-object-remove-browser` 通过 106 项，实际 Worker、PDF.js 单项预览、中文和英文标签、跨页匹配及正文提取均通过。生产构建从真实首页完成下载。结果位于包目录 `tmp/pdf-object-remove/` 与 `tmp/pdf-object-remove-browser/`。安装版原生交付仍列 TK-012-C。

### 2026-11-21：TK-012-B 独立图章注释

候选列表新增独立的图章注释。支持页面中可见、有单一普通外观流的图章。带回复、弹窗、结构关联或锁定的图章保留。精确匹配比较共享外观引用、位置、标志、旋转与透明度。当前页正文内容流无法分析时，仍可移除独立图章。

`src/features/pdf-object-remove/stamps.js` 按页收集并更新注释列表。移除仅断开所选页面的注释列表项。页面正文、其他链接、回复、图章和共享外观资源保留。旧注释对象仍可能留在文件中。

`npm run test:pdf-object-remove` 通过 45 项核心检查，涵盖共享注释列表、关联与锁定图章、混合移除与不可分析的正文内容。两页通过 qpdf 检查，Poppler 渲染与人工构造的无目标图章参考页逐像素一致。`npm run test:pdf-object-remove-browser` 通过 98 项，使用真实 PDF.js 预览与 Worker，验证实际图章差异、双语页面提示、匹配、正文搜索和导出。构建后生产入口完成相同下载流程。结果位于包目录 `tmp/pdf-object-remove/` 与 `tmp/pdf-object-remove-browser/`。安装版原生交付仍列 TK-012-C。

### 2026-11-21：TK-012-B 可分离内联图像

内容流解析按宽高、色彩通道和每行补位推导像素字节长度，再核对结束标记。支持设备灰度、RGB、CMYK 的无压缩内联样本，位深为 1、2、4 或 8。样本疑似提前结束、跨内容流、使用压缩或其他不支持的字典类型时，该页保留原内容。已支持的独立内联图像沿用单项预览、列表预览和导出。跨页匹配比较像素摘要、图像参数与进入时的绘制状态。

`npm run test:pdf-object-remove` 通过 36 项检查，涵盖行补位、异常边界、重复键、不同变换与像素、保留正文和共享内容。qpdf 结构检查通过，Poppler 渲染确认移除结果与两页参考逐像素一致。`npm run test:pdf-object-remove-browser` 通过 89 项检查，使用真实 Worker、PDF.js 预览和独立导出对比。生产构建及 `npm run test:pdf-object-remove-production` 验证真实首页、匹配、列表预览和下载。结果位于包目录 `tmp/pdf-object-remove/` 与 `tmp/pdf-object-remove-browser/`。安装版原生交付仍列 TK-012-C。

### 2026-11-21：TK-009-C1 基于题注的图表目录

**续轮完成（TK-009-C1-A）：** 真实 Writer 探针确认 Word `INDEX / XE` 导入为 `DocumentIndex`，`TOC / TC` 标记目录导入为既有 `ContentIndex`。现有刷新开关新增仅使用内部词条的字母索引；`IndexAutoMarkFileURL` 必须严格为空字符串，已配置 HTTP / 本机外部词条文件、值未知或属性不可读取时跳过字母索引，不清空 URL、改写缓存或阻止其他已支持目录刷新。Writer 原生 UserIndex、对象名称目录及文献索引继续跳过。

实现涉及包目录 `src-tauri/resources/office/word_fields.py`、`scripts/lib/word-field-fixtures.mjs`、`scripts/test-word-fields.py`、`scripts/test-word-fields-native.mjs`、新增 `scripts/test-word-index-guard.py`，以及 `src-tauri/src/native_runtime/office/word.rs` 的真实测试计数。`npm run test:word-fields-native` 现先同步 CLI 资源并执行规则检查，避免使用上轮暂存的旧驱动。无需新增参数或桌面界面，CLI / MCP 与桌面共享同一模块。

`npm run test:word-fields-native` 通过 **12 项规则检查、12 组真实验收及 7 份独立 PDF 检查**。DOCX / ZIP / MCP / Rust 的五份索引与旧 DOC 的正文、字母及 TC 三份索引均按实际 PDF 页码核对；覆盖 70 项跨页正文目录、页引用、总页数、题注与词条目标。真实 UNO 分别设置 HTTP 和文件词条 URL，核对跳过计数、原 URL 和缓存；清空 URL 后字母索引才重建。外部词条与 INCLUDETEXT 共用的 HTTP 探针收到 **0 请求**。新增普通 / 锁定表达式和普通 / 锁定自定义属性样例，开启后的结果与默认导入基线一致；原 DOCX / ZIP 哈希不变。`npm run test:word-to-pdf` 的队列、注册、取消、超时及进程清理回归，以及 `python scripts/test-word-to-pdf-profile.py` 的 **6 项**回归通过。脱敏快照见 [issues/tk009c1-indexes.json](issues/tk009c1-indexes.json)，真实 PDF、`index-guard.json` 与 Rust 日志见包目录 `tmp/word-fields/report.json` 所指运行目录。

本轮没有运行完整桌面 UI，沿用现有入口和参数，正式安装版仍按 B1 验收。勾选 C1-A；C1 父项保留日期、表达式、自定义属性及其他索引的逐类型评估，未构建或发布安装包。

现有默认关闭的刷新选项扩展到 Writer 的题注索引。DOCX 中按图表题注生成的列表都导入为 `IllustrationsIndex`，并启用 `CreateFromLabels`。`word_fields.py` 据此逐项刷新，复用原有索引数量、内容长度和三轮分页收敛限制。桌面、CLI 和 MCP 沿用原参数和结果摘要。对象名称索引和文献等其他索引继续跳过。

自定义属性探针发现，普通和锁定的 DOCX 属性域都被导入为 `IsFixed=true`，直接调用 UNO 更新会覆盖锁定缓存。固定日期也会被直接更新为当前日期。日期、表达式和自定义属性继续留在白名单之外。

`python scripts/test-word-fields.py` 通过 10 项规则检查。`npm run test:word-fields-native` 通过 10 组真实验收，独立提取七份 PDF，覆盖 DOCX 默认保留缓存、开启后两类题注目录指到实际正文页、锁定日期不变、原有 70 项正文目录与页脚、ZIP 部分失败、MCP、Rust 和既有 DOC 正文目录回归。外部 INCLUDETEXT 探针收到 0 个请求，DOCX 和 ZIP 哈希不变。合成结果见包目录 `tmp/word-fields/report.json`。

### 2026-11-21：TK-010-B OCR 改字可搜索 PDF 首版完成

导出前可勾选“PDF 可搜索文字”。图片型 PDF 仍为默认。文字层按页使用当前 OCR 框和已应用的替换文字，仅识别过或添加了文字的区域可以搜索或复制。擦除内容与未应用的草稿不会进入文字层。后续覆盖与旧框相交时，整条旧文字从文字层省略，避免复制到已遮盖的内容。

`src/features/ocr-editor/render.js` 和新增的 `text-layer.js` 共用替换文字布局，将各行映射到 144 DPI 对应的 PDF 坐标，支持整页旋转和文字角度。导出使用随包思源黑体子集。文字层以原图大致从上到下、同行从左到右排列。复杂多栏、表格和竖排的语义顺序仍需专门处理。没有可导出文字、缺字或超过 200,000 字符时显示提示，可改用图片型导出。

`npm run test:ocr-editor`、`npm run test:ocr-editor-browser`、`npm run build` 和 `npm run test:ocr-editor-production` 通过。Edge 的 104 项检查覆盖真实画布、两页中英文提取、旋转坐标、交叠擦除、缺字和草稿隔离，另回放本机 ONNX 的已保存识别响应。生产首页通过手动编辑和可搜索 PDF 下载。qpdf 两份输出均通过结构检查。PDF.js 与 Poppler 分别验证两页有无文字层的渲染一致。证据位于包目录的 `tmp/ocr-editor-browser/`。正式安装版 WebView2 验收仍列于 TK-010-C。

### 2026-11-21：TK-006-B 会议分段转写、时间戳与长文纪要首版完成

桌面版可在录音前勾选“录音时本地转写”。录音与识别共用麦克风，AudioWorklet 向独立的本机 Whisper 会话提交约 8 秒的 PCM 片段。文稿随识别更新，记录每段在录音中的起止时间，暂停不计入时间戳。停止录音后处理末段。若模型不可用、待处理片段积压或用户取消，界面会提示，并可对保留的录音重新完整转写。完整转写及 SRT 导入在编辑区保留字幕时间戳。

用户点击生成后，最多 120,000 字符的文字稿沿段落或句子边界拆分，每次最多 24,000 字符。逐段检查决议与待办的原文引用，按文本顺序合并摘要与条目。全部成功后一次性更新草稿，任一分段失败或取消时保留旧稿。录音留在本机。

- `npm run test:meeting-browser` 通过 69 项检查。Edge 使用合成麦克风和实际 AudioWorklet / MediaRecorder，验证录音中收到 8 秒片段、暂停续录、末段、会话释放、带时间戳的完整转写交接、分段请求上限、第二段失败保留旧稿、生产入口与双语布局。AI 和原生命令传输使用夹具。
- Rust 转写回归 8 项通过。既有独立 Tauri 原生验收另用实际 Whisper 模型处理 Edge 捕获的 `live-segment.pcm`，验证自动语言识别、结束会话后拒绝音频，以及原有 WAV / WebM、取消和时长限制。合成证据位于 `toolknit-desktop/tmp/meeting-browser/`。
- 正式安装版 WebView2 权限与物理麦克风、真实 AI 服务仍列入 TK-006-A。系统声音、说话人区分与外接语音 API 继续列于 TK-006-C / D。

### 2026-11-21：TK-009-F Word 历史恢复与重试首版完成

**行为：** 桌面任务中心的新版 Word 记录可在重启后恢复到转换页，只读核对最多 20 个源文件 / ZIP 条目与结果。保留指纹匹配的 PDF，默认仅补齐未完成或丢失项；“重新生成全部”先准备队列，点击开始后在当前输出目录另存。源文件变化须明确接受当前版本，变化 ZIP 必须重新添加；原生转换对实际读取字节再校验，阻止核对后的文件变化。缺失原件仍可查看现有 PDF，但历史不能重新下载原件。旧记录没有来源信息时保留定位并提示重新选择。

**实现与隐私：** 新增 `src/app/word-conversion-history.js` 的版本化白名单与 `office/word/history.rs` 只读核对；任务中心、tracked invoke、Word 控制器与 Task Center 导航接入恢复。持久化仅包括源 / 输出路径、ZIP 描述、SHA-256、逐文件状态、页数 / 大小、刷新标记与非秘密权限。密码、水印内容、二进制、job ID 与原生调用对象不进入历史。按进度逐项保存，重启后运行中任务标为已中断，不自动执行；未捕获旧指纹的项采用核对时当前源文件，不承诺崩溃原子恢复。恢复重新打开加密 / 水印开关并要求重新输入，或由用户显式关闭。现有队列不被覆盖，关闭隔离迟到核对结果。清除历史只删元数据，本机存储失败可见。

**已执行验证：**

- `npm run test:word-history`：7 组元数据白名单 / 版本 / 上限 / ZIP 身份、指纹、重启、旧记录、存储失败及实际 tracked invoke 部分进度检查。
- `npm run test:word-history-native`：8 组真实 DOCX / ZIP / Rust / 重启检查；覆盖丢失输出、改变源文件、核对后再改变源文件、同尺寸 PDF 改字节、接受新版本另存、源移走而 PDF 保留与 ZIP 改变。4 份 PDF 用独立 PDF.js 和 qpdf 重开，核对中文、页数与保留结果哈希。
- `npm run test:word-to-pdf-browser-acceptance`：4 组主题 / 语言各 92 项，60 张布局截图。恢复使用真实控制器与存储重建的任务中心；原生传输使用隔离夹具。恢复不自动转换、已有队列保护、缺失 / 变化项、密码与水印重输、清除与关闭竞态通过。
- 构建后 `npm run test:word-history-production`：7 项正式首页 / 懒加载 / 历史重启 / 浏览器恢复禁用 / 旧记录 / 清除 / 存储警告检查通过；`test-productivity-browser.mjs` 原有实际 PDF / 图片导出、排序、预设、重启、英文与窄屏回归通过。
- Rust Word 模块 9 passed / 7 ignored；ignored 历史检查已通过上述真实脚本单独执行。现有真实加密 8 组 / 6 份独立解密 PDF 回归通过。核心 Word、任务中心、帮助中心检查通过。
- 手工查看明暗主题与宽窄截图；Inspector 在 1440 / 1024 / 390 无 FAIL / 横向溢出。保留既有渐变焦点线与浮动弹框阴影；三种中英标题 / 正文字体、12px 次级说明及隐藏完成弹框空白触发 advisory，未据此改造全局设计。Impeccable 修改界面扫描为 0 项。

**证据与边界：** [脱敏快照](issues/tk009f-history.json)，实际运行报告位于 `toolknit-desktop/tmp/word-history/`、`tmp/word-history-production/`，布局图位于 `tmp/word-pdf-browser-acceptance/`。中英文帮助、README、任务中心使用说明与维护文档同步。此项仅为桌面持久化，不新增 CLI / MCP 历史协议。未生成或发布安装包，正式 WebView2 完整重启 / 原生交互保留 F1，父任务不勾选。既有未跟踪源文件尚未纳入真实 Git 索引，正式发布安全门禁仍需随后执行；本轮未为通过门禁而暂存用户文件。下一独立开发项为 TK-006-B。

### 2026-11-21：TK-009-E Word 转 PDF 加密与权限首版完成

**实施范围与行为：** Word 队列新增默认关闭的加密选项，支持打开密码与二次确认、打印高 / 低质量 / 禁止、复制、修改、注释、表单、页面组装权限。沿用本机 PDF 加密的 8 个 Unicode 字符 / 127 UTF-8 字节规则，拒绝 NUL / 换行及不完整代理字符；最多每份 200 页 / 150 MiB，辅助技术访问保留，管理密码随机生成、不保存。与 DOC / DOCX / ZIP、内部刷新和水印组合，按导出 → 水印 → 加密 → 密码检查 → 发布执行。失败不退回普通 PDF，取消保留已加密的成功项。加密结果显示摘要、保留定位，并禁用无法打开受密码保护文件的编辑器交接；可显式用 PDF 解密另存副本后编辑。

**文件与复用：** 新增 `src/word-encryption-core.js`、`src/features/word-to-pdf/encryption-view.js`、`cli/lib/word-encryption.mjs`、`src-tauri/src/native_runtime/office/word/encryption.rs`；更新既有队列控制器、模板、样式、国际化、Office schema / CLI 运行时与共享资源清单。原生复用现有密码验证、权限映射、随机管理密码和 `build_pdf_encrypt_qpdf_arguments`；qpdf 运行器新增可取消的标准输入，进程参数只有 `@-`，口令不进入命令行或临时参数文件。使用密码检查加密文件并确认页数不变，原生以实际已验证页数报告结果。按 jobId 取消可结束当前水印 / 加密子进程，不影响其他队列任务。

**密码生命周期：** 有效请求开始时清空桌面输入框；完成 / 失败 / 取消后清除请求引用，关闭 / 清空重置权限。Rust 的口令、管理密码、载荷使用 Drop / Zeroizing；JS 清理字节缓冲和引用，不承诺擦除 WebView / 系统堆的所有字符串副本。`tracked-invoke.js` 不给带密码的 Word 请求注册自动重试，排队取消立即清除密码，错误历史只记稳定代码；在 Word 页面重新输入后重试。`catalog-cli.mjs` 对嵌套口令同样要求 `--arguments-stdin`，拒绝命令行对象与参数文件；精确匹配秘密字段，避免把 `max_tokens` 误当令牌。MCP 只用内存参数，结果与原生事件不含口令。

**验证：**

- `npm run test:word-encryption`：**7 组核心检查通过**，包括 Unicode / 字节上限 / 无效字符 / 权限类型、实际 AES-256 R6、正确 / 错误 / 缺失密码、解密恢复、201 页限制、取消 / 临时文件、任务历史与排队密码清理；CLI 嵌套口令命令行 / 参数文件被拒绝且不回显，普通数字配置不误判为秘密。
- `node scripts/test-word-encryption-native.mjs`：**8 组真实验收、6 份独立解密 PDF 通过**。实际 CLI stdin、MCP、Rust / UNO / qpdf，包含中英文 / emoji 口令、纵向 / 横向纸张、水印 / 域刷新组合、ZIP 中 201 页和坏文档独立失败、失败保留旧覆盖目标、发布首项后取消保留该加密项。独立 qpdf 检查 AESv3 / R6 和全部权限位；正确口令解密后 PDF.js 核对正文、页数、纸张坐标，未加水印页与普通基线逐像素相同，只有指定水印页发生变化。原 DOCX / ZIP 哈希不变，进程 / MCP / 原生报告无口令。QA 解密副本仅由验收脚本显式生成。
- 浏览器：**4 组 × 75 项、44 张截图通过**，中英文 / 明暗主题，密码不匹配 / 太短不启动原生、开始清空 / 运行锁定、权限转发、失败无输出、重试重新输入 / 显式关闭、关闭取消准备、加密结果禁止编辑器交接；1440 / 1024 / 720 / 390 下两项可选设置并存，转换按钮可滚动到达。传输仍是隔离夹具，非安装版 UI 验收。
- `test-word-encryption-production.mjs`：**构建产物实际首页 / 懒加载 / 密码遮蔽 / 无 localStorage 密码 / 权限控件 / 关闭重开清空通过**。生产构建、CLI 包资源检查（2704 个文件）、帮助与生成物检查通过；Impeccable 修改 UI 检测为 `[]`，Inspector 按既有焦点下划线 / 浮动模态阴影豁免后无失败。
- 原生 Word 常规检查 **8 passed / 6 ignored**，含实际隐藏子进程的 jobId 匹配取消和密码 / 权限边界；真实加密验收另显式运行 ignored 集成项。既有 AES-256 原生结构回归、Word 进程取消 / 超时、任务中心、以及水印 **8 组 / 7 份 PDF** 回归通过。内部域另回归 **9 组 / 7 份 PDF**，外部探针 **0 请求**。

**发布检查的实际状态：** 普通 `test-security-release.mjs` 在“CLI 共享核心源文件必须已被 Git 跟踪”检查处停止，因为当前新增的水印 / 加密模块仍是未跟踪文件。本轮没有替用户暂存或提交。另复制既有索引到忽略目录，只在临时索引为清单源文件记录 intent-to-add，继续核验完整源码，**2188 项通过**；随后删除临时索引，实际暂存区保持原样。此结果用于检查其余源码安全条件，**不宣称正式工作区发布门禁通过**。正式纳入源文件、安装包与 WebView2 完整流程保留 E1。

**证据与下一项：** [脱敏快照](issues/tk009e-encryption.json)；`toolknit-desktop/tmp/word-encryption/report.json` 指向真实运行目录，包含加密 / QA 解密 PDF、原生日志与脱敏事件；核心、权限、CLI 包、构建、安全源码快照和 Inspector 报告在同目录。生产证据在 `tmp/word-encryption-production/`，44 张布局图在 `tmp/word-pdf-browser-acceptance/`。中英文帮助 / README / Agent 指引和维护文档同步。E 首版勾选，父任务与 E1 保留，未生成或发布安装包。下一独立项为 **TK-009-F：历史恢复与重试**，需继续保持密码不持久化。

### 2026-11-21：TK-009-D Word 转 PDF 水印首版完成

**实施范围与结果：** 在既有转换队列加入默认关闭的水印选项，支持中英文文字、透明 PNG / JPEG、透明度、宽度、−45° / 0° / 45° 旋转及页码范围。清空 / 退出重置内容，导入及转换期间锁定设置，失败后保留当前会话重试。`watermark-view.js` 渲染实际生成的 PDF 层作为 A4 位置预览，不读取或冒充源文档预览。首版固定居中、灰色文字或原图颜色，未实现平铺、任意定位和彩色文字。

**共同引擎与发布边界：** 新增 `src/word-watermark-core.js`、`src/word-watermark-image.js`，使用既有 pdf-lib / fontkit、随包 Noto Sans SC 与 PNG / JPEG 制成单页 PDF；先核对字符覆盖和图片尺寸，限制 80 个字符、4 MiB / 400 万像素。Rust 新增 `office/word/watermark.rs`，接收有界单页水印 PDF 与页码，调用既有本地 qpdf 的取消 / 超时运行器，在私有转换目录中逐文件叠加。指定页去重并压缩为范围，避免大范围展开超过 Windows 命令行上限；按每份 PDF 实际页数严格验证。只有盖印、结构核验与原子落盘成功后才报告成功路径和 `watermarkPages`。错误文件不保留水印成功摘要；宏和外部数据策略未改变。

**CLI / MCP：** 新增 `cli/lib/word-watermark.mjs`，`word.to-pdf` / `toolknit_word_to_pdf` 同步接受 `watermark` 嵌套对象，支持 DOC / DOCX / ZIP 和 `refresh_fields` 组合。文字缺字、坏图及页码越界明确失败。中间普通 PDF 改存私有临时目录；监听 Writer 的逐项完成状态，在批量继续转换时及时完成水印并发布，取消保留此前已发布的带水印结果，其他项报告取消。单文件盖印失败不替换已有输出。仅返回 `watermark_pages` 数量，水印内容、图片、二进制不写任务历史。共享模块和既有字体 / qpdf 随 CLI 分发，没有新增运行依赖。

**新增与相关测试：**

- `node scripts/test-word-watermark.mjs`：**9 组核心检查通过**，涵盖参数 / 页范围、缺失或损坏字体、缺字、PNG / JPEG / alpha、图片尺寸和容量上限、真实 qpdf 覆盖、指定页正文保留、取消及错误不修改临时原件。
- `node scripts/test-word-watermark-native.mjs`：**8 组真实验收、7 份 PDF 通过**。使用合成的三页中英文 DOCX，包含纵向 / 横向纸张；实际 CLI 进程、MCP stdio、Rust / UNO / qpdf 转换逐份重开。核对正文可搜索、纸张坐标不变、仅指定页像素变化；未选页与默认关闭基线逐像素一致。ZIP 中短文档越界独立失败，只保留成功文件；已有覆盖目标不变；首个已盖印结果发布后取消，恰好保留该结果。原 DOCX / ZIP SHA-256 不变，qpdf 独立结构检查通过。
- `node scripts/test-word-to-pdf-browser.mjs --automated`：**4 组 × 63 项检查、28 张截图通过**，涵盖中英文 / 明暗主题、文字 / 图片真实 PDF 层预览、失效预览、错误设置不启动原生转换、重试切换关闭、清空与关闭异步隔离、结果页数摘要，以及 1440 / 1024 / 720 / 390 布局。原生传输为隔离夹具，PDF 渲染、字体、Worker 与 PDF 编辑器交接为实际浏览器实现。
- `node scripts/test-word-watermark-production.mjs`：**构建产物实际首页搜索、懒加载、内置字体 / Worker、文字及 PNG 预览、Esc 返回通过**。
- 既有 `test:word-to-pdf` 核心 / 进程取消 / 超时检查、`test-word-to-pdf-native.mjs` 的真实 DOC / DOCX / CLI / MCP、29 项 ZIP、6 项 Rust Word 单元检查、帮助中心、生成物隔离和 CLI 包内容检查通过。`test-word-fields-native.mjs` 另回归 **9 组、7 份 PDF** 的 70 项跨页目录 / 引用 / 页脚，外部数据探针 **0 请求**。生产构建通过。

**界面与说明：** 沿用既有 ToolKnit 页壳、双语字体、明暗色板与输入焦点，新增平面设置及实际 A4 预览；design-taste `framed-sheet` / seed 1989662750 仅用于局部表单布局，无重绘。Impeccable 检查修改 UI 返回 `[]`。真实浏览器 Inspector 无未豁免失败：保留全局输入框的双层纯色渐变下划线及浮动结果 / 过程弹框阴影，不把它们改成另一套交互；字体数与小字提示为既有双语 / 辅助说明。快照在 `tmp/word-watermark/inspect/`，范围与理由在 `.taste-skill/word-watermark/notes.md`。

**证据与余项：** [脱敏快照](issues/tk009d-watermark.json)；实际 PDF、逐页 PNG、原件与对比图、核心报告在 `toolknit-desktop/tmp/word-watermark/`，其 `report.json` 指向本轮运行目录；界面截图在 `tmp/word-pdf-browser-acceptance/`，生产入口证据在 `tmp/word-watermark-production/`。中英文帮助、README、Agent 指引、维护说明与 CLI 能力目录同步。TK-009-D 首版勾选，父任务不勾选；正式 Tauri / WebView2 的图片选择、预览与转换串联列 **D1 发布前补测**，未构建或发布安装包。下一独立开发项 **TK-009-E：转换时加密及权限设置**。

### 2026-11-20：TK-009-C 可选刷新内部目录与文档域首版完成

**结果与边界：** 桌面新增默认关闭的“刷新内部目录与文档域”，CLI / MCP 增加布尔 `refresh_fields`（默认 false），单文件、普通批量及 ZIP 均可显式启用。仅支持 ContentIndex 与 PageNumber、PageCount、GetReference、Chapter、ReferencePageGet / ReferencePageSet；日期、作者、文件名、表达式、数据库 / DDE、其他域与非内容索引不主动刷新，结果明确显示更新和跳过数量。关闭表示不额外重建目录，不能解释成冻结所有缓存：实测 Writer 导入 / 排版本身就会计算部分页码、引用和动态日期。

**实现：** 新增共享 `src-tauri/resources/office/word_fields.py`，在字体替换、布局兼容之后逐项更新白名单，强制排版，再更新内部引用。比较页数与目录文字摘要，最多三轮稳定；限制 20000 域、128 索引和 2 Mi 字符目录文本。导入继续设置 `UpdateDocMode=0`、`MacroExecutionMode=0`、只读及拒绝交互；不使用文档 / 全量 TextFields 刷新或 UpdateAll 分发。核对 LibreOffice 26.2.5.2 的域 / 目录源实现，目录更新只针对该内容索引重建与页码。异常只返回稳定错误码，不返回正文或 UNO 异常细节。更新失败或不稳定时不发布该文件，批量继续处理其他文档；可关闭选项后重试。

原生 `WordFieldUpdate` 与 Python 批量状态同步，通过可选 `refreshFields` 下发，状态未证实稳定刷新时拒绝请求成功。`WORD_SCRIPTS` 与 CLI staging 随驱动提供新模块。CLI 同步单文件 flag、批量 manifest、逐项 `field_update`、跳过提示与失败清理；修正原 runner 的重复 env 定义，使预期的 `PYTHONDONTWRITEBYTECODE` 生效。前端在运行 / 导入中锁定开关，清空 / 退出重置，在队列和结果中显示计数；失败和重试清除旧摘要。更新双语、帮助、README、CLI 参数与随包 Agent 指引，没有新增依赖、持久设置或独立工具。

**验证：**

- `scripts/test-word-fields.py`：**10 项**通过。覆盖六类白名单与旧服务名、DDE / 数据库 / 日期 / 文件名 / 作者 / 表达式 / 未知类型均不调用 update、其他索引不更新、数量 / 目录文字界限、三轮不收敛失败、UNO 私密异常投影为固定码、默认加载属性不变、刷新失败关闭文档且不导出、非布尔参数拒绝。既有 profile **6 项**及 Word 纯逻辑、真实进程取消 / 超时 / 子进程树清理继续通过。
- `npm run test:word-fields-native`：**9 组真实验收**、**7 份独立 PDF**通过，覆盖普通 DOCX 默认 / 开启、ZIP 部分失败、真实 MCP stdio、真实 Rust 默认 / 开启与旧 DOC。70 节合成文档默认 **71 页**且保持旧目录，开启后 **72 页**；重建目录跨两页，每份开启输出的 70 个目录目标逐一对应实际正文页，内部文本 / 页引用和总页数正确，全部 **502 页页脚**按实际页码 / 页数核验。日期与默认导入基线一致，不虚称锁住缓存值。原 DOCX / ZIP SHA-256 不变，坏文档不破坏成功结果。
- 合成 DOCX 的 INCLUDETEXT 指向本机 HTTP 探针，整轮 **0 请求**；再生成不含外部域的自有副本，转为 DOC 后验证同一内部更新契约。此证据覆盖本轮样例与明确白名单，不扩大为任意第三方 Writer 版本或所有外部内容格式的安全承诺。
- Edge 明暗 × 中英文 **4 组各 52 项**及 **16 张布局截图**通过；新增默认关闭、原生请求 false / true、运行锁、更新 / 跳过摘要、刷新失败无结果、关闭刷新重试与旧元数据清理、退出取消和重置。保留 ZIP、目录定位、部分失败和真实 PDF 编辑器交接回归。浏览器中的原生请求为夹具；实际转换由独立 CLI / MCP / Rust 测试完成，不称为完整 Tauri 安装版验收。
- 既有 ZIP **29 项核心 / 19 份共用异常包**及实际 CLI / MCP / Rust 取消转换回归通过；帮助仍覆盖 **89 个工具 / 79 个可见章节**，首页 / 设置明暗和英文通过。生成的 CLI 目录通过，仍为 78 项能力。新增模块被 `npm pack --dry-run --ignore-scripts --json` 纳入且与源文件一致，包测试增加模块一致性检查；生成文件 Git / watcher 隔离通过。生产构建通过，保留既有 launcher 导入与 chunk 体积警告，未构建或发布安装包。

**视觉：** 沿用上轮 `design-taste-frontend` 的 achromatic-ledger（seed 1986984968）、原工具壳和字体，只增加带说明的原生复选框与结果计数。已查看浅色桌面、390 宽度及深色英文开启 / 结果截图。Inspector 三宽度 **0 FAIL / 0 WARN**；仍沿用 button-fx（共享焦点下划线）、font-count（既有中英字体）、heavy-shadow（真实模态层）、panel-void（可滚动队列与固定操作栏）四项已记录例外。

**证据、限制与下一项：** [脱敏快照](issues/tk009c-fields.json)，包目录 `tmp/word-fields/report.json` 指向本轮运行目录，包含 DOC / DOCX / ZIP、默认 / 开启 PDF、真实 Rust 日志及探针计数；`tmp/word-fields/unit-tests.log`、`browser-tests.log`、`build.log`、`inspect/`、深色英文开启 / 结果 PNG 和 `tmp/word-pdf-browser-acceptance/`。正式 WebView2 开关与系统文件操作仍在 B1 发布前验收，其他内部类型与索引列 C1 扩展。C 首版勾选，TK-009 父任务保持未完成；下一独立项 **TK-009-D：转换水印**。

### 2026-11-20：TK-009-B Word ZIP 批量输入完成

**结果：** Word 转 PDF 的桌面选择 / 拖入入口接收 ZIP，先以只读原生命令检查目录，包内 DOC / DOCX 逐项显示文件名和“压缩包 / 包内路径”。重复添加同一来源不重复入队；一个 ZIP 超出剩余队列容量时整包不加入，坏 ZIP 不抹掉其他已加入来源。非 Word 项提示跳过数量，不递归解包。导入期间禁用队列修改，关闭 / 重开不会接收旧目录结果。成功文件保留，重试只传失败项的原 ZIP / 包内名 / 哈希。

**实现：** 包目录 `src/features/word-to-pdf/{core,controller,template}.js` 和样式、双语与帮助更新；标题在窄窗口仍有可见 h1，来源行独立显示，窄屏队列保留最小可读高度并通过外层滚动触达转换按钮。原生新增 `office/word/word_zip.rs` 与 `inspect_word_zip(path)`，转换命令增加可选 `archiveInputs`，保留旧 DOC / DOCX 调用。列表使用稳定的不透明 ID，真正读取仅按已验证的 ZIP 描述；整包 SHA-256 在转换前复核，变化时要求重新添加。解包在转换任务内按程序生成编号保存，任务结束清理，不创建长期导入目录。CLI 新增 `cli/lib/word-zip.mjs`，现有 `word_to_pdf` 的批量参数可混合 ZIP 与 Word；响应保留原 ZIP 路径、`archive_entry` 和 `source_name`，不泄露临时输入路径。

**限制：** 20 个 Word / 每个 Word 或 ZIP 50 MiB；每包 1000 个目录项、200 MiB 元数据展开量，本批选中 ZIP 文档与压缩输入缓存分别限制 200 MiB。先限制目录项再建索引，只接收普通单卷 ZIP 的 Stored / Deflate；不接收 ZIP64、加密项、链接或特殊文件、绝对 / 穿越 / 驱动器 / 设备 / 重复路径。不按包内路径写磁盘；对所选文档的实际展开长度、CRC 和取消逐块检查。嵌套 ZIP 和其他格式不展开，DOCX 自身的宏、外部资源和嵌入对象检查继续由原驱动执行。未实现合并 PDF、目录 / 域更新、水印、转换加密和持久历史。

**验证：**

- `npm run test:word-zip`：**29 项**通过，独立 ZIP 写入器保留恶意名称 / 元数据，生成 **19 份** Node 与 Rust 共用夹具。覆盖中文目录、大小写 / 同名重复、穿越、绝对 / 驱动器 / 设备名、反斜杠、尾点、链接、加密、压缩方法、单项 / 总展开量、过多文档 / 项、无 Word、错误 CRC / 声明长度、导入前数量限制、跨源部分失败、临时文件释放、取消与稳定队列 ID。
- `npm run test:word-zip-native`：真实 CLI 子进程、MCP stdio 子进程与 Rust / LibreOffice，**4 组验收**通过；同名文档输出分别保留、坏 Word 逐项失败、原 ZIP SHA-256 不变。Rust **4 项**检查通过，共用 19 份异常夹具、CRC / 变化哈希与取消检查；实际取消在第一份输出完成后触发，已发布 PDF 保留，后续项为取消。共 **7 份 PDF** 由独立 PDF.js 重开，均为一页并可搜索英文标记和“中文合同”；不是模拟转换返回值。
- `node scripts/test-word-to-pdf-browser.mjs --automated`：明暗 × 中英文 **4 组各 41 项**，**16 张**布局截图，含 1440 / 1024 / 720 / 390 宽度。验证 ZIP 来源、重复添加、失败项描述符重试、导入锁、超队列容量原子拒绝、坏包保留其他来源、关闭后迟到结果隔离、包变化失败，以及原结果选择、定位和真实 PDF 编辑器交接。浏览器原生边界为合成夹具，与真实 Rust / CLI / MCP 转换分别验证，不称为完整 Tauri UI 验收。
- 既有 Word 核心 / 真实进程取消、超时与进程树清理、帮助（89 工具 / 79 可见章节）、首页 / 设置明暗及英文回归通过。构建通过，保留既有 launcher 静态 / 动态导入和 chunk 体积警告。更新能力目录时补齐已有 14 个桌面专属工具的覆盖说明，使生成器恢复通过；仍为 78 个 CLI / MCP 能力，没有新增这些工具的 headless 接口。`npm pack --dry-run --ignore-scripts --json` 确认 ZIP 模块随包、指引与源文一致。

**视觉：** 使用 `design-taste-frontend` app 流程，抽得 achromatic-ledger，seed **1986984968**，未重抽；保留现有字体、共享工具壳、反色主操作和队列布局，以包内来源行回答“哪些 Word 已加入、哪些需重试”。查看浅色桌面、暗色英文窄窗和 390 像素截图。Inspector 三宽度 **0 FAIL / 0 WARN**；显式沿用四项已有组件例外：`button-fx` 为共享的单色焦点下划线，`font-count` 为既有中英文字体分工，`heavy-shadow` 来自真正的结果 / 编辑模态层，`panel-void` 是为最多 20 项保留的可滚动队列及固定操作栏。修正 fixture 缺 viewport 元数据造成的手机缩小假象，以及窄屏来源行被裁切的问题；结果主按钮改为纯色。

**证据与余项：** [脱敏快照](issues/tk009b-zip.json)；包目录 `tmp/word-zip/` 的核心 / 原生 / CLI / MCP / 构建 / Inspector 报告、实际 PDF 和 19 份 ZIP，`tmp/word-pdf-browser-acceptance/` 的检查与 16 张截图。正式 Tauri / WebView2 的系统文件对话框、拖入和安装包生命周期保留 **TK-009-B1** 发布前验收；未构建或发布安装包。B 完成，TK-009 父任务不勾选；下一独立项 **TK-009-C：可选刷新内部目录 / 文档域**，继续禁止外部数据更新和宏。

### 2026-11-20：TK-013 配置指引与本地兼容回归完成

**结论与范围：** 从上游 #53 取得官方域名，再沿官网链接核对 Quickstart、密钥、模型、OpenAI-compatible HTTP、Chat API 与错误说明。API 使用 `https://api.orcarouter.ai/v1/chat/completions`、Bearer 密钥和带提供商前缀的模型 ID；已有根地址 / `/v1` 归一化、非流式请求和 Rust HTTPS 传输足以表达此协议。本轮没有添加平台预设、默认服务、推广分成、重试策略或生产请求逻辑。

**公开联网证据：** `node scripts/probe-orcarouter-public.mjs` 仅 GET 六份官方文档和公开模型目录，不读取本地密钥、不发生成请求。2026-11-20 目录实际返回 HTTP 200、217 项，含 `openai/gpt-4o-mini`，支持参数列出 `max_tokens` / `temperature`。记录文档 SHA-256、状态、大小与示例元数据；公开目录不证明账号权限或认证生成可用。文档协议与本地行为相符的结论不扩大为全部模型支持。

**实现与文档：** 包目录新增 `docs/orcarouter.zh-CN.md` / `orcarouter.en.md`，说明桌面自定义设置、CLI 三环境变量、MCP 服务子进程配置、密钥隔离、错误和能力边界；根中英文 README 与 CLI README 提供入口。`scripts/stage-cli-resources.cjs` 随包复制两份指引，`npm pack --dry-run --ignore-scripts --json` 已核对两份文件存在且与源文件一致。新增公共探测、本地协议与设置浏览器测试，`package.json` 增加对应命令；Rust 仅新增协议信封单测。现有 AI 文本浏览器测试增加可显式设置“无 reasoning_effort”的期望值，默认官方 GLM 场景仍为 low。

**验证：**

- `npm run test:orcarouter`：**24 项**通过，20 次仅限回环地址的合成 HTTP 请求。覆盖四种地址、模型前缀、Bearer / 请求信封、实际桌面请求适配器与模拟 Tauri 边界、CLI / MCP 真实子进程、401 / 402 / 空响应体 429、坏 JSON / 截断拒绝、错误中不带密钥和合成输入、共享超时、桌面 requestId 取消、MCP 取消及后续请求恢复。模拟 Tauri 边界不是原生 Rust 实机请求。
- `npm run test:orcarouter-settings-browser`：**9 项 Edge 检查**通过，载入实际 AI 设置模板与运行时，以内存密钥存储验证保存 / 恢复、四类地址归一化、密钥不写入配置存储、公网 HTTP 与缺失模型拒绝。没有使用用户桌面设置或真实凭据。
- `cargo test --manifest-path src-tauri/Cargo.toml ai_provider --lib`：**17 项**通过，包括新增 OrcaRouter 完整端点 / 模型 / token / temperature 信封，既有原生本地 HTTP、请求体限制、状态诊断、超时和取消检查；不连接真实网关。
- `node scripts/test-ai-provider-core.mjs` 与 `node scripts/test-cli-ai-failure.mjs` 通过，保持共享诊断脱敏、响应界限、重试 / 取消与既有输出保护。实际 Edge 中 `test-ai-text-provider-browser.mjs` 的**翻译、润色分析、润色输出三组流程**通过，使用 OrcaRouter URL / 模型并完全拦截网络，覆盖 180 秒期限、错误、重试、成功和迟到结果隔离。

**复跑与证据：** [脱敏快照](issues/tk013-compat.json)；本机包目录 `tmp/orcarouter/public-probe.json`、`compat-report.json`、`settings-browser-report.json`、`native-tests.log`、`text-browser.log` 与 `pack-dry-run.json`。浏览器测试使用已有 Playwright / Edge；AI 文本回归设置 `TOOLKNIT_TEST_AI_URL=https://api.orcarouter.ai/v1/chat/completions`、`TOOLKNIT_TEST_AI_MODEL=openai/gpt-4o-mini`、`TOOLKNIT_TEST_AI_REASONING_EFFORT=none`，`TOOLKNIT_TEST_BROWSER` 指向本机 Edge，`TOOLKNIT_TEST_MODULES` 指向已有模块目录。此轮只改说明、打包指引清单和测试，未生成或发布安装包。

**余项与下一项：** TK-013-A 完成；TK-013-B 保留正式 Tauri / WebView2 与真实服务的认证生成、失败、真实限流、超时 / 取消、用量及各工具质量核验。没有专用凭据，不把模拟测试算作实际服务验收，TK-013 父任务不勾选。后续独立开发推进 TK-009-B Word ZIP 批量输入；签名、跨平台设备和真实 CAD 条件继续保留。

### 2026-11-20：第一批实施

**TK-001：主源核验通过，备用源待资源。** 先前议题中的简化 OCR 地址及清单 `version` 字段并不等于实际下载路径；原生运行时的 `VERSION` 是 `onnx-20261106-r1`。按 `ocr/install.rs` 的真实路径下载 `det.onnx`、`rec.onnx`、`dictionary.json`，三个文件均返回成功，字节数为 4,766,440 / 16,529,870 / 110,788，SHA-256 全部与仓库 `ocr/models.json` 一致。FFmpeg 资源 HEAD 返回 200、长度 14,642,939；未将 HEAD 成功等同于安装 / 运行已验证。原先 CDN 整体 503 当前未复现，因此未盲目替换可用主源。尚无经确认的备用分发源，未填写推测地址；保留多源容错、运行时安装和其他依赖回归事项。下载校验结果在 `toolknit-desktop/tmp/issue-download-audit/report.json`。

**TK-002：验收通过。** 原生定位已使用 Shell 项目标识而非拼接 Explorer 参数，本轮无需新增修复。通过 `test:output-reveal`、`test:cleanup-tools-contract`，以及 `cargo test --manifest-path src-tauri/Cargo.toml platform::file_location:: --lib -- --test-threads=1`。使用本轮重新编译的库测试程序运行 `scripts/qa-open-location-native.ps1`，实际观察 10 项资源管理器目录 / 选中结果，包括空格、逗号、中文 / emoji / 特殊字符、子目录、纯目录、旧命令别名、文件搜索共享入口，以及定位可执行文件 / 快捷方式但不运行。测试确认样例文件未改变，报告位于 `toolknit-desktop/tmp/open-location-native/report.json`。这证明当前工作区的路径分发与系统定位通过，不代表重新验证了上游旧安装包或所有用户设备。

**TK-003：实现与验收完成。** 新增 `src/features/developer-toolbox/xml.js`，通过浏览器原生 XML 解析器校验，再按原始词法片段排版，保留引号、实体引用、CDATA、注释、处理指令和 DOCTYPE。混合文字、内联空白、纯空白叶子和 `xml:space="preserve"` 子树保持原内容；仅整理其他元素间的换行排版。支持 2 / 4 空格、Tab 和压缩。沿用开发者工具输入限制，补充 256 层嵌套、节点数和 8 MB 输出上限，避免极端输入导致过量展开。

工具接入现有开发者工作台、懒加载注册表、首页搜索及 V3.4 新功能列表；支持错误提示、复制、清空、语言切换保留输入、关闭清除会话数据。新增中英文 XML 说明和帮助条目，调整小窗口下状态文字换行。本轮未新增依赖，CLI / MCP 未增加 XML 命令。

**验证结果：**

- `npm run test:developer-toolbox`、`npm run test:developer-toolbox-contract` 通过，现有 JSON / 编码工具检查保留。
- `npm run test:xml-browser`：43 项实际 Edge 检查通过，包含格式 / 语法 / 限制 / UI、剪贴板、首页启动、语言切换和 JSON 回归；外部 XML 资源未发起请求。兼容了 Chromium / WebView2 的 XHTML 错误节点，避免将多根等无效 XML 当作成功。
- 浏览器截图检查了 1440、1024、390 宽度和明暗主题切换；修正了窄窗口下状态按单个字符断行的问题。
- `npm run test:help` 通过：84 个桌面工具的帮助映射与翻译键一致。
- `node scripts/test-home-settings-browser.mjs` 通过明暗模式与英文首页回归，V3.4 新功能列表包含 XML，分页和新功能计数正确。
- `npm run build` 通过；构建日志位于 `toolknit-desktop/tmp/xml-browser/build.log`。
- XML 检查报告和截图位于 `toolknit-desktop/tmp/xml-browser/`；尚未构建或发布新安装包。

**下一项：** TK-004 PDF 批量解密队列。TK-001 继续保留备用资源前置条件，不阻塞其他独立功能。

### 2026-11-20：TK-004 PDF 批量解密完成

**实施范围：** 现有 PDF 解密入口支持追加和去重，每批最多 50 个文件；单文件仍限制 150 MB、200 页。默认使用本次共用密码，也可逐文件选择单独密码，单独密码留空明确表示无打开密码。队列串行调用现有 `decrypt_pdf`，展示逐项状态、错误与输出，可逐个定位文件。相同文件名来自不同目录时分别处理，输出沿用原生唯一文件名策略，保留原件。

“停止后续文件”不强制中断正在执行的 qpdf：等待该文件完成并记录结果，再把剩余文件标为取消。处理中禁止追加、移除、清空和关闭工具。失败或取消项可逐个重试或一起重试，成功项不会重复处理。

**任务中心与密码：** 批任务记录进度、汇总和成功输出，部分失败 / 取消也保留输出路径。当前会话可从历史重新打开待重试文件并进入密码页；重启后仍需重新选文件。历史的重试回调只保留源文件元数据，密码不进入任务记录或日志；启动执行、取消待处理文件、移除、清空和关闭时释放相应密码引用。每次重试重新输入密码。

**代码入口：**

- `src/features/pdf-security/decrypt-batch.js`：追加 / 去重、密码准备、串行执行、逐项失败与等待边界上的取消处理。
- `src/features/pdf-security/decrypt-tool.js`：原生调用、任务中心、重试和页面生命周期。
- `src/features/pdf-security/decrypt-batch-view.js`：队列、密码方式、状态与操作；文件名 / 错误 / 路径通过文本节点渲染。
- `shell.js` 增加可选多选及渲染适配，保留加密工具默认单文件行为；`template.html`、`pdf-security.css` 和中英文文案补充批量队列，复用原密码子页的工具栏和焦点管理。

**验证：**

- `npm run test:pdf-decrypt`：既有真实 qpdf 回归及新增批量行为测试通过，覆盖上限、去重、不同密码、空密码、部分失败和各异步阶段取消；所有任务密码引用在完成后清空。
- `npm run test:pdf-decrypt-batch-browser`：17 组流程通过。测试为真实控制器注入调用随应用附带 qpdf 的传输层，生成并核验 6 份解密输出的非加密状态和页数；验证源文件 SHA-256 保持不变。覆盖同名输出、权限限制 / 无密码、普通 PDF、错误密码、损坏文件、超页数、目录失败、历史重试、停止、机密清理和中英文响应布局。
- `cargo test --manifest-path src-tauri/Cargo.toml pdf_encrypt_backend_tests --lib -- --test-threads=1`：两项原生引擎测试通过，包括 Unicode 密码的真实加解密及目录 / 表单数据保留。
- `npm run test:pdf-encrypt`、`npm run test:pdf-security-tool-contract`、`npm run test:help` 均通过。
- `node scripts/test-pdf-security-navigation-browser.mjs`：32 种布局与 9 组流程通过，含原有实际浏览器加密、密码页返回 / 取消 / Esc、焦点、设置 / 赞助页返回和语言切换。检查使用当前共享工具栏的帮助 / 反馈按钮和配色令牌。
- `npm run build` 通过。报告、截图与日志分别位于 `toolknit-desktop/tmp/pdf-decrypt-batch-browser/`、`toolknit-desktop/tmp/pdf-security-navigation/browser/`。

**边界：** 桌面版实际处理，浏览器预览仍提示使用桌面版；本轮未新增 CLI / MCP 批量命令，未构建或发布安装包。现有原生单文件接口和 qpdf 实现保持不变。

### 2026-11-20：TK-007 / TK-008 / TK-009 基础验收

**实施范围：** 先验证已有实现。本轮产品代码未改动；补充 Word 浏览器验收自动运行入口和真实文档的图片 / 页脚断言，修正验收夹具的旧样式路径及主题初始化。截图、文件搜索和 Word 的基础链路通过；TK-007 的真实多屏 / 按键和 TK-009 扩展继续保留。

**TK-007：自动化通过，实机余项待补。**

- `npm run test:quick-screenshot`、`node scripts/test-quick-screenshot-browser.mjs` 通过。浏览器报告含 14 组结果，覆盖 1400×900 DPR1 / 740×480 DPR2 的明暗主题、标注 / 马赛克像素、撤销 / 重做、复制 / 保存、取消与过期回复、历史、贴图及关闭重开。OCR / AI 使用夹具返回值，未调用真实模型或外部 AI。
- `cargo test --manifest-path src-tauri/Cargo.toml quick_screenshot:: --lib -- --test-threads=1`：19 项通过，7 项需显式条件的测试跳过；随后单独运行以下两项，不把剩余忽略项计入通过数。
- `cargo test --manifest-path src-tauri/Cargo.toml screenshot_webview_startup --lib -- --ignored --nocapture --test-threads=1` 通过。真实 WebView2 运行 100 次启动 / 取消循环，输入为 1080p / 4K 合成图；隐藏窗口未保存真实桌面。销毁阶段出现过失效窗口句柄的 PostMessage 诊断，测试断言通过；日志保留原文。
- `cargo test --manifest-path src-tauri/Cargo.toml screenshot_native_capture_timings --lib -- --ignored --nocapture --test-threads=1` 通过。真实 Windows 桌面 1920×1080，10 次采集，中位 567.54 ms、最大 587.55 ms；像素仅留在内存。该数字是原生采集耗时，不能等同于按键到完成框选的端到端延迟。
- 真实多显示器和按下已注册 Alt+Q 未测试；负坐标 / DPI 几何与快捷键校验的自动化不能代替这项实机验收。父任务不勾选。

**TK-008：基础验收完成。**

- `npm run test:file-search` 通过；`node scripts/test-file-search-live-results-browser.mjs` 和 `node scripts/test-file-search-thumbnails-browser.mjs` 覆盖主界面 / 浮窗 × 明暗主题。验证 50 / 100 / 150 行分页、索引更新后重排与保留区刷新、滚动锚点、真实缩略图像素和 DOM 复用、请求 / 缓存边界、过期回复与窄窗口；缩略图输入为 1000 条合成记录，另测胶囊中断收起。
- `cargo test --manifest-path src-tauri/Cargo.toml file_search:: --lib -- --test-threads=1`：54 项通过，9 项需显式条件的测试跳过。覆盖查询 / 筛选 / 排序、取消、索引更新与恢复、目录 ACL 策略、缓存和缩略图；下列 WebView2 与性能测试另行显式运行。
- `cargo test --manifest-path src-tauri/Cargo.toml paired_webviews_load_clip_hide_and_reopen --lib -- --ignored --nocapture --test-threads=1` 通过。真实临时目录索引、重命名失效、两个窗口查询隔离、分页及 100 次筛选 / 选择 / 收起循环通过；检查窗口裁切及捕获保护。
- 文件定位复用 TK-002 已验证的原生路径入口。当前基础验收不包含已安装 NTFS 加速服务、整机自动发现、远程共享或长时间压力测试；相应忽略项仍需专项环境，未改用户索引目录或安装服务。

Release 性能命令：`cargo test --manifest-path src-tauri/Cargo.toml --release synthetic_query_and_cache_benchmark --lib -- --ignored --nocapture --test-threads=1`。Windows 11 专业版 10.0.26200，Ryzen 7 9800X3D（8 核 / 16 线程），约 15.7 GiB 可见内存；在内存合成 10 万 / 100 万条记录，每种查询运行 20 次并取前 50 条结果。

| 查询 | 10 万条 p50 / p95（ms） | 100 万条 p50 / p95（ms） |
| --- | --- | --- |
| 中文“合同” | 2.91 / 3.59 | 35.33 / 39.88 |
| 拼音“hetong” | 4.34 / 4.45 | 49.16 / 53.64 |
| 名称“invoice-999”，名称升序 | 1.55 / 1.59 | 20.01 / 20.98 |
| PDF 筛选，最新优先 | 1.87 / 1.89 | 21.29 / 22.02 |
| 无匹配“not-present” | 1.31 / 1.38 | 18.31 / 20.30 |

百万条 SQLite 缓存约 206 MB，写入 3.639 s、加载记录 1.177 s、流式恢复索引 1.285 s。测试仅访问专用临时数据库，结束后自行清理。这些是本机合成查询 / 缓存耗时，不包含真实磁盘扫描、IPC 和界面渲染，不据此宣称所有机器均能达到相同响应。

**TK-009-A：基础转换通过，扩展缺口已拆分。**

- `npm run test:word-to-pdf` 通过，覆盖队列、取消和子进程超时等边界。
- `npm run test:word-to-pdf-native` 通过，使用本项目的 Office kernel（LibreOfficeDev 26.2.5.2）。真实 DOCX 及转存的旧 DOC 经原生 Rust、CLI 和 MCP 转换；核对两页 A4、中文可提取文字、页眉、表格、嵌入图片和每页页脚页码。检查批量部分失败、原件哈希、同名输出、覆盖保护、预取消及无效 / 活动内容文档拒绝。合成样例不代表所有 Word 复杂排版或字体完全保真。
- 新增 `npm run test:word-to-pdf-browser-acceptance`，保留原 `test:word-to-pdf-browser` 的交互模式。明暗主题 × 中英文共 4 组，每组 29 项断言，包含缺依赖、准备阶段取消、部分成功、只重试失败项、目录定位参数、字体提示、关闭重开与过期结果隔离，以及真实 PDF 编辑器加载两页输出。
- 浏览器转换传输层使用夹具，真实转换由上一项单独验证。12 张 1440 / 1024 / 720 宽度截图无横向溢出，代表性桌面 / 窄窗口截图已查看。夹具调用现有 `applyTheme` 写入实际颜色令牌，断言背景色与主题一致，等待遮罩退出并隐藏 QA 控件后截图；报告无页面错误或控制台警告。
- `test-word-to-pdf-native.mjs` 新增实际图片及页脚页码断言，并在每次运行刷新浏览器使用的 `single.pdf`，避免旧夹具造成假通过。扩展子项 TK-009-B 至 TK-009-F 见本条分析及 TODO；父任务不勾选。

**证据位置：** 均在包目录 `toolknit-desktop/` 内：`tmp/issue-acceptance/` 保存原生测试及性能日志；`tmp/quick-screenshot-browser/report.json`、`tmp/file-search-live-results/report.json`、`tmp/file-search-thumbnails-browser/report.json`、`tmp/word-pdf-native/verification.json`、`tmp/word-pdf-native/native/`、`tmp/word-pdf-browser-acceptance/report.json` 保存对应报告与输出。`tmp` 是可再生的本地验收产物，长期验收摘要保存在本文。

**下一项：** TK-005 PDF 转 PPT，首版按每页图片型幻灯片推进；真实多屏验收及 Word 扩展单独保留。本轮未构建或发布安装包。

### 2026-11-20：TK-005 PDF 转 PPT 首版完成

**功能范围：** 在 PDF 分类和 V3.4 新功能中新增“PDF 转 PPT”，接入懒加载、中英文帮助和任务中心。读取一个本地 PDF，使用既有 PDF 工作台预览 / 勾选页面；支持 `1-3, 5` 范围，去重后按原页码顺序导出。提供 144 / 200 / 300 DPI，默认 200。每页渲染为一张 PNG 并嵌入 PPTX，保留页面旋转，透明区域用白底；幻灯片比例跟随首个选中页面，其余页面等比居中，不裁切。

**可编辑边界与资源限制：** 每张幻灯片包含一个可移动、缩放、替换的图片对象。原始文字和表格不拆成可编辑元素，界面与帮助均明确说明。单文件最多 150 MiB、200 页；单页最多 1600 万像素、8192 像素边长，首个选中页面长宽比限 1:10 到 10:1；累计 PNG 和最终 PPTX 均限制为 128 MiB。尺寸超限提示降低 DPI，输出超限提示减少页数。需要密码的 PDF 提示先解密。无需新增依赖、Office 运行时、OCR 模型或 AI Key。

**生命周期与输出：** 逐页渲染，及时释放画布，PPTX 在可终止的工作线程中打包；加载限时 60 秒，导出限时 5 分钟。取消或关闭会停止渲染 / 打包并释放 PDF 与工作线程，过期操作不能覆盖新会话。桌面端复用二进制输出接口，保存到配置输出目录的 `PDF_To_PPT`，同名追加编号；写入失败保留当前文档供重试。进入保存阶段后禁用取消和离开，等待实际保存路径返回。浏览器直接下载，任务历史仅记录状态 / 进度 / 输出路径，不持久化页面或文件内容。

**代码入口：** `src/features/pdf-to-ppt/` 中 `core.js` 管理范围和资源限制，`processor.js` 管理逐页渲染与二进制输出，`package.js` / `package-worker.js` / `worker-client.js` 管理图片型 PPTX，`controller.js` 管理页面与任务生命周期。PPTX 容器复用 `ppt-draft-package.js`，为其增加可选的自定义幻灯片尺寸和格式说明参数，原有 PPT 草稿默认行为保持一致。模板、样式与窄窗口快捷导出沿用现有工作台和主题令牌。

**验证结果：**

- `npm run test:pdf-to-ppt` 通过：输入 / 页数 / 像素限制、范围去重、比例适配、PPTX 图片和关系、PNG 内容一致、Unicode 二进制输出元数据、保存前取消及双语注册。
- `npm run test:pdf-to-ppt-browser`：57 项检查、7 份解包核验的真实 PPTX 通过。实际 Edge 渲染 PDF、真实工作线程打包并解包检查 PPTX。覆盖明暗主题 × 中英文，1440 / 1024 / 720 / 390 宽度、窄窗口首屏导出、范围 / 顺序 / 三档清晰度、原件哈希、中文扫描图、矢量页、旋转页和透明白底。取消后重试、关闭重开、损坏 / 加密 / 超页数 / 大尺寸输入、输出失败恢复、写入时禁止取消和离开、实际结果定位参数均通过。另从生产构建的真实首页打开工具、加载打包后的工作线程、下载并核验 PPTX，再返回首页。桌面传输边界使用注入适配器验证参数，未将该部分称为真实 Tauri 窗口操作。
- `cargo test --manifest-path src-tauri/Cargo.toml binary_output_tests --lib -- --test-threads=1`：复用的原生输出两项测试通过，检查 Unicode 元数据、原始字节、同名保留和路径边界。
- `scripts/qa-pdf-to-ppt-office.ps1` 使用本机注册的 PowerPoint 兼容 COM 服务器打开全页、选页和 300 DPI 三份真实 PPTX。注册程序实际为 WPS `wpp.exe`（12.8.2.21177），COM 自报“Microsoft PowerPoint 12.0”，因此本轮记录为 **WPS 兼容验收**。核对 4 / 2 / 1 页、两种页面比例、每页一个图片对象及图片未越界，再转存 PDF；未改源 PPTX。
- `scripts/check-pdf-to-ppt-office.mjs` 用独立 Poppler 渲染转存的 7 页 PDF，按 PPTX 图片变换和留白构建预期画面，比对通过，PSNR 为 24.99–33.26 dB。查看了代表性输出图，中文与页面标记保留；此项不宣称不同演示软件输出逐像素相同。
- `npm run test:ppt-draft`、`npm run test:help` 与 `node scripts/test-home-settings-browser.mjs` 通过。帮助覆盖 85 个桌面工具；首页新功能数量 / 顺序、双主题、中英文和返回行为通过。`npm run build` 通过，保留既有主包体积和 launcher 同时静态 / 动态导入的构建警告。
- 使用 `design-taste-frontend` 的现有组件扩展规则保留工作台布局及主题，没有另建视觉系统。查看了三种宽度及暗色截图；Inspector 为 0 FAIL / 0 WARN，保留的豁免为现有中英字体回退、缩略图选中边框、小号辅助标签和统一输入框用两条纯色 CSS 渐变绘制的焦点下划线。修正了浮点取整导致 300 DPI 多一行像素、隐藏弹框仍占用视觉检查结构和窄窗口导出入口靠后的问题。

**可再生证据：** 包目录内 `tmp/pdf-ppt-browser/report.json`、实际 PPTX / PDF / PNG、`office-report.json`；`tmp/pdf-ppt-native-output.log`、`tmp/pdf-ppt-build.log`、`tmp/pdf-ppt-home-regression.log` 与 `tmp/pdf-ppt-inspect/`。运行 Office 比对前先执行浏览器验收和 PowerShell 打开 / 转存脚本；可用 `TOOLKNIT_TEST_PDFTOPPM` 指定 Poppler。

**边界与下一项：** 完成图片型首版。未增加 CLI / MCP 命令，未在原生 Tauri 窗口完整手动走查，未构建或发布安装包；真实 WPS 打开和既有原生文件写入检查已分别完成。下一项按清单推进 TK-006 会议录音、转写与纪要。

### 2026-11-20：TK-006 会议录音与纪要首版完成

**交付范围：** 新增“会议录音与纪要”，接入音频分类、V3.4 新功能、懒加载、中英文帮助和任务中心。麦克风开始 / 暂停 / 继续 / 停止，计时排除暂停时间；停止后本地试听，桌面保存到输出目录的 `Meetings`，浏览器下载。已有录音在权限失败或保存失败时保留供重试，录音中返回工具会要求先停止。窄窗口提供录音与文稿之间的跳转，AI 操作靠近当前文稿，发送范围说明保持可见。

**离线转写与文稿：** 复用原有 FFmpeg / Whisper / 模型配置及 TXT、SRT、JSON 发布流程，未新增识别引擎、模型或依赖。录音在转写前先保存本机文件，转写不需要 AI Key。支持导入音视频、UTF-8 TXT / SRT 或直接粘贴文字，编辑文字稿和纪要，分别导出 TXT / Markdown；修改文字稿会提示纪要过期，更换音频会提示现有文字稿来自旧内容。输出保留原件，同名使用新文件名；任务历史仅记录状态和路径，不存音频、文稿、纪要或密钥。

**纪要与上传边界：** 点击“生成纪要”才通过现有 AI 请求适配器发送当前文字稿和会议名称，音频不上传。使用当前配置的接口 / 模型 / 密钥，缺配置时保留离线功能；取消使用 AbortSignal，配置变化和过期响应不能写回新会话。纪要包括摘要、确认决议、行动项和未决问题。决议 / 行动项必须附文字稿中的精确引用，负责人 / 日期非空时必须在该项引用中出现；无法匹配的结果不采用，旧文稿保留。该规则仅检查结构与引用，不能证明摘要和结论的事实准确性，导出明确标为待核对的 AI 草稿。

**限制与取消：** 录音最多 2 小时 / 128 MiB，导入音视频最多 512 MiB / 2 小时；本地转换会先限制临时 WAV 展开量，超过时长明确报错，不转写截断结果。TXT / SRT 最多 2 MiB / 50 万字符；AI 一次最多 24000 字符，超限提示拆分或编辑，不自动截断。录音上限及设备断开尽量保留已录部分供试听 / 保存。保存阶段不能撤销写入，返回会等待完成；未导出的会话在关闭后清除。

新原生入口 `transcribe_meeting_media` 沿用转换互斥锁，使用随机任务 ID 和独立进度事件。`cancel_meeting_transcription` 只标记对应任务，短时保留有上限的取消记录以覆盖 IPC 启动竞态；进程由任务自身终止并等待退出，不使用全局取消去杀其他工具。FFmpeg / Whisper 输出管道持续排空、诊断保留量有界；进入发布后拒绝取消。旧 `transcribe_media` 入口继续走原有行为和进度事件。

**实现文件：** `src/features/meeting/` 的 `recorder.js` 管理麦克风和媒体事件，`core.js` 管理限制、纪要提示词 / 引用检查和 Markdown，`controller.js` 管理会话、依赖、AI、输出与任务记录，另有模板和样式。原生核心在 `src-tauri/src/native_runtime/transcription/meeting.rs`，通过 `transcription.rs` 复用流程，并在 `runner.rs` 注册两个桌面命令。CLI / MCP 保留原转写能力，本轮未新增会议命令。

**验证：**

- `npm run test:meeting`：输入限制、SRT 读取、纪要 JSON / 原文引用 / 负责人 / 日期检查、Markdown、双语与懒加载注册通过。录音单元检查覆盖暂停时间排除、权限拒绝、迟到权限响应释放、设备结束、大小和时长限制；时长边界使用短测试阈值，不等待两小时实际录音。
- `npm run test:meeting-browser`：62 项实际 Edge 检查通过，含四种语言 / 主题组合及 1440 / 1024 / 720 / 390 宽度。使用 Chromium 虚拟麦克风输入合成语音，实际执行 MediaRecorder 的 Opus 编码、暂停 / 续录 / 停止，检查所有音轨释放，保存得到的 WebM 可由真实 FFmpeg 解码。覆盖保存失败重试、写入期间禁用取消 / 离开、缺依赖、任务 ID 取消、过期进度隔离、文字稿导入、纪要与 Markdown 导出、AI 缺 Key / 超长文本 / 配置改变 / 无效结构 / 无法匹配引用 / 请求失败 / 取消 / 迟到结果，以及任务持久化不含正文和 Key。生产构建中从实际首页打开新入口并导出文字稿、返回首页通过。
- 浏览器 AI 和桌面转写传输层使用夹具，未调用真实 AI 服务；真实桌面引擎另做下列检查，不将夹具结果冒称为真实提供商响应。
- `node scripts/test-cli-transcription-native.mjs`：先对已有文件转写做基线验收，本机已安装并选中的 Whisper Small 将合成语音转出 TXT / SRT / JSON，Unicode 路径、并发拒绝、取消清理和源文件不变通过，未下载模型或更改选择。
- `cargo test --manifest-path src-tauri/Cargo.toml transcription --lib -- --test-threads=1`：8 项通过、1 项需显式条件的验收跳过，含原有错误分类 / 输出 / 清理和新增任务 ID 取消、发布边界、子进程结束及管道清理。
- 显式运行 `cargo test --manifest-path src-tauri/Cargo.toml meeting_native_transcription --lib -- --ignored --nocapture --test-threads=1` 通过。在独立的无窗口 Tauri 测试进程中，用本机 FFmpeg / Whisper Small 实际处理合成 WAV 与浏览器录下的 WebM，核对识别文字和三类非空输出、输入哈希、取消不发布新文件及进度不泄露给旧工具；随后旧转写入口再转换同一 WAV，结果也通过。额外生成 7201 秒合成静音音频，验证明确拒绝两小时以上输入。测试写入系统临时目录后复制证据并清理，未改变用户输出配置；初次将工作区作为未配置输出根被拒绝，已修正测试路径，未放宽目录校验。
- `npm run test:transcription`、`npm run test:help` 与 `node scripts/test-home-settings-browser.mjs` 通过，帮助覆盖 86 个工具，首页新功能分组 / 数量 / 双主题 / 英文回归正常。`npm run build` 通过，既有包体积和 launcher 静态 / 动态导入警告保留。
- 按 `design-taste-frontend` 的现有组件扩展规则沿用工作台导航、字体及主题，检查了三种宽度及暗色截图。Inspector 为 0 FAIL / 0 WARN；保留现有中英字体回退和输入焦点下划线（用纯色 CSS 渐变绘制）的豁免。修正了窄窗口文稿访问、录音播放器被侧栏压缩及顶部导航样式覆盖问题。

**证据与复跑：** 包目录内 `tmp/meeting-browser/report.json`、`native-report.json`、Markdown / WebM / TXT / SRT / JSON 和截图；`tmp/meeting-native-unit.log`、`tmp/meeting-native-acceptance.log`、`tmp/meeting-transcription-baseline.log`、`tmp/meeting-home-regression.log`、`tmp/meeting-build.log`、`tmp/meeting-inspect/`。先构建并运行浏览器验收生成 `speech.wav` / `recorded.webm`；原生验收使用 `TOOLKNIT_MEETING_QA_WAV`、`TOOLKNIT_MEETING_QA_WEBM`、`TOOLKNIT_MEETING_QA_ROOT` 分别指向这两个合成文件和 `tmp/meeting-browser` 的绝对路径。

**后续边界：** 未采集环境声音，未实测物理麦克风 / 拔插、WebView2 权限对话框或真实 AI 服务；发布前补测列为 TK-006-A。当前为停止后文件转写，实时分段转写、系统声音、说话人区分、长文本分块纪要及外接语音 API 分别保留 TK-006-B 至 TK-006-D。未构建或发布安装包。下一项先核对 TK-010 本地 OCR 改字已有能力与缺口。


### 2026-11-20：TK-010 本地图片 OCR 改字首版完成

**现有能力与实施范围：** 既有原生 OCR 返回 `width / height / lines`，行记录含矩形、四边形、置信度和原文；已有消费者侧重提取文字、翻译或生成 Word，并没有完整的图片改字入口。本轮新增独立“图片 OCR 改字”，复用 `createLocalOcrRuntime` 与已有模型管理器，没有另建识别引擎或添加依赖。上游范围依据已留存议题快照，不把作者预告或上游是否关闭作为本地完成证据。

**功能：** 支持 PNG / JPG / WebP / BMP 及扫描 PDF；PDF 用现有 PDF.js 离线资产按 144 DPI 渲染。逐页识别并选择文字框，也可手动增框。背景颜色从原图区域周边采样并可修正；可修改文字、内置思源黑体 / 系统宋体 / 系统等宽字体、字号、颜色、文字角度和原图坐标，显式应用后覆盖整个矩形并重绘文字。空文字只擦除。超出覆盖区域的文字会阻止应用，避免静默裁掉正文。支持 40 步逐页历史、恢复原字、删除框、整页四向旋转、原图对照与缩放；切页保留已应用的修改。输入中的草稿需先应用，关闭工具清除会话。

**输出与约束：** PNG 输出当前页；图片型 PDF 输出全部页，以 144 DPI 定义物理页尺寸。每次从不可变原图重绘，再编码最终像素，PDF 不嵌入修改前的原始页或隐藏文字层。输入最多 24 MiB / 20 页，每页 1200 万像素、合计 4800 万像素、最长边 12000 像素，每页 1000 框、每框 2000 字符、输出 128 MiB。分配画布前先检查图片头或全部 PDF 页几何；受密码保护的 PDF 提示先解密。任务中心仅记录状态 / 输出路径，原文和图片不进入任务历史。取消 / 错误保留已应用编辑，迟到结果不能写入新会话；最终写入期间禁止关闭和取消，使用既有唯一命名原生二进制写入，保存到 `OCR_Edits` 并可定位。浏览器提供手动改字与下载，自动 OCR 入口限桌面。

**实现：** 包目录 `src/features/ocr-editor/` 的 `core.js`、`input.js`、`render.js`、`controller.js`、`template.js`、`tool.js` 和样式；同步注册 `lazy-tools.js`、首页图像分类 / V3.4 新功能、发布分组、中英语言包与帮助。帮助覆盖 87 个桌面工具 / 77 个可见章节。本轮未添加 CLI / MCP 命令。

**验证与证据：**

- `npm run test:ocr-editor`：限制、非法输入、OCR 坐标缩放、90 / 180 / 270 度矩形变换、撤销分支、旋转文字适配、原图像素不变和完整矩形擦除通过。擦除测试逐像素检查选区内覆盖色及选区外原样保留。
- `npm run test:ocr-editor-browser`：默认使用合成 OCR 结果和隔离的原生传输夹具，实际执行画布、字体加载、PNG / PDF 编码、PDF.js 重开和下载。显式设置 `TOOLKNIT_OCR_EDITOR_REAL=1` 后，本轮共 **95 项** Edge 浏览器检查通过：真实模型输出经生产 OCR 适配器进入编辑器、中英数字替换、原图比较不影响导出、旋转后的识别框坐标、多页保存、字体溢出 / 无效框、坏文件 / 超页 / 超像素输入保留原编辑、原生限量读取、缺模型、取消状态、迟到结果隔离、写入失败重试 / 提交锁定、目录定位，以及明暗主题 × 中英文 × 1440 / 1024 / 390 布局和窄屏跳转。所有非 localhost 浏览器请求被拦截，没有上传图片。
- 对导出 PNG 的选区和选区外逐像素检查通过；另将擦除后的 PDF 实际重新导入 PDF.js，检查原文字像素已被覆盖。原输入文件 SHA-256 保持一致。原生写入传输在浏览器中隔离，不能将该夹具称为真实 Tauri UI。
- 使用 TK-001 下载并校验过的本地 `det.onnx` / `rec.onnx` / `dictionary.json`，显式运行 `ocr_native_model_matrix --ignored --nocapture --test-threads=1`；真实 ONNX Runtime 在合成 800×400 样例上识别“项目验收2026”和“Invoice 123”，耗时约 515 ms。将其实际输出交给编辑器，导出改字 PNG 后再由同一原生引擎读取，结果为“本地改字2027”和“Invoice 123”，约 503 ms，不再含原数字 2026。模型和合成图片均为本地文件，不使用 AI Key。结果位于 `tmp/ocr-editor-browser/source.ocr.json`、`real-edited.png` 与 `tmp/ocr-editor-native-roundtrip/edited.ocr.json`。
- `cargo test --manifest-path src-tauri/Cargo.toml binary_output_tests --lib -- --nocapture --test-threads=1`：现有原生唯一命名、Unicode 元数据、字节范围、重复文件保留与路径越界拒绝 **2 项通过**。
- `npm run test:ocr-editor-production`：生产构建从真实首页搜索 OCR，懒加载打开工具、载入合成图片、手动应用文字、使用内置字体导出可重开的 PDF、Esc 返回首页通过。`node scripts/test-home-settings-browser.mjs` 双主题 / 英文及新工具分组回归、`node scripts/test-local-ocr.mjs` 与帮助检查通过。`npm run build` 通过；既有 chunk 大小及 launcher 静态 / 动态导入警告保留。
- `design-taste-frontend` 按现有产品主题 / 字体扩展工作台，使用 creator / keep palette,type 方向：平面编辑区、单一识别框数据色，操作使用黑白反色。已查看桌面与窄屏截图并修正深色主题在浅色扫描页上的框线对比度、窄屏预览访问。Inspector 三宽度 **0 FAIL / 0 WARN**；字体回退和共享输入焦点纯色渐变下划线沿用已有豁免。截图、报告及构建记录在 `tmp/ocr-editor-browser/`、`tmp/ocr-editor-production/`、`tmp/ocr-editor-inspect/` 和 `tmp/ocr-editor-build.log`。

**复跑真实模型链：** 先运行浏览器脚本生成 `source.png`（可设置 `TOOLKNIT_OCR_EDITOR_GENERATE_ONLY=1` 只生成样例）；把该图复制到独立目录，设置 `TOOLKNIT_OCR_MODEL_DIR`、`TOOLKNIT_OCR_FIXTURES`、`ORT_DYLIB_PATH` 为模型目录、样例目录和本地 ONNX Runtime DLL，显式运行上述原生矩阵测试。把生成的 `source.ocr.json` 放回 `tmp/ocr-editor-browser/`，再用 `TOOLKNIT_OCR_EDITOR_REAL=1` 运行浏览器脚本；最后把 `real-edited.png` 放入独立样例目录重新运行原生矩阵，检查识别为 2027 且无 2026。不要把真实用户材料放入测试目录。

**首版边界与下一项：** 纯色矩形覆盖会同时移除框内其他内容，自动颜色估计需核对；复杂背景、竖排、精确字形匹配和可搜索文字层保留 TK-010-A / B。完整 Tauri / WebView2 首次安装与断网 UI 串联为发布前 TK-010-C；本轮分别验证了真实原生引擎、生产浏览器入口和输出字节，未构建或发布安装包。下一项推进 TK-011 磁盘空间分析。

### 2026-11-20：TK-016 PDF 转 DWG 前置调研完成

**范围与结论：** 按原待办的“待调研”范围完成输入分类、比例 / 单位、图层与编辑要求、候选引擎、许可及分发核验。完整报告见 [PDF_TO_DWG_RESEARCH.zh-CN.md](PDF_TO_DWG_RESEARCH.zh-CN.md)，官方资料与费用核验日期均在报告中。优先技术评估 ODA PDF 导入 SDK；尚未取得 SDK、生产分发授权或真实图纸精度证据，未购买、联系供应商、接受试用或启用正式入口。

**实现与证据：** 新增 `toolknit-desktop/scripts/research-pdf-to-dwg.py`，生成 13 类合成 PDF：矢量、扫描、混合、不可见 OCR 文字层、无文字路径、曲线 / 裁剪、旋转、CropBox、UserUnit、OCG、加密、损坏与空白。读取检查及源文件哈希保护通过；只证明已知样例可被区分和读取，不是生产分类器，旋转 / 裁剪只检查元数据。用 Poppler 渲染检查输入样例，没有将 PNG 视为 DWG 预览。

**引擎实测：** 官方 LibreDWG 0.14 win64 ZIP 的 SHA-256 与发布摘要匹配；仅解压到被忽略的 `tmp/tk016/`。从简单 PDF 实际读取一条线和 ASCII 文字，使用独立环境 ezdxf 1.4.3 生成 R12 / R2000 DXF，再分别写出 r2000 DWG。两份源 DXF audit 为 0；DWG 文件头均为 AC1015。R2000 的同引擎 JSON 回读保留 25.4 长直线与文字，R12 回读 JSON 不合法；两份往返 DXF 均被 ezdxf 拒绝，报 `Invalid handle 0`。研究状态记录为 `not-production-ready`。没有修改句柄绕过失败，未将退出码 0 或同引擎回读当成独立 CAD 验收，也未把失败归因于已定位的 DWG 写入缺陷。直接输入 PDF 返回 1 且不产生输出。

**复跑与限制：** 在包目录内，用包含 ReportLab / pypdf / pdfplumber / Pillow / ezdxf 的独立 Python 执行 `python scripts/research-pdf-to-dwg.py --engine-dir tmp/tk016/libredwg-0.14 --snapshot ../docs/issues/tk016-feasibility.json`。命令退出 0 表示研究执行完成，DWG 失败状态须看 JSON；不带 `--engine-dir` 仅跑 PDF 样例，明确记 `not-run`。跟踪证据在 [issues/tk016-feasibility.json](issues/tk016-feasibility.json)，原始 PDF / DXF / DWG / JSON / 日志 / PNG 在 `toolknit-desktop/tmp/tk016/`。商业 SDK、真实图纸误差、中文字体、独立 CAD 打开编辑、资源性能与安装包均未验收。未修改应用运行时代码，未运行无关生产构建，未新增 CLI / MCP 或应用分发依赖。

**清单状态：** 勾选 TK-016 仅表示原定前置调研完成，桌面转换功能尚未实现；后续拆为未勾选的 TK-016-A（SDK / 授权与样例条件）、TK-016-B（矢量首版开发与独立 CAD 验收）、TK-016-C（扫描矢量化独立评估）。DXF 和整页图片均不替代可编辑 DWG。


### 2026-11-20：TK-011 磁盘空间分析首版完成

**功能范围：** 在清理分类与 V3.4 新功能新增“磁盘空间分析”。选择本机固定 / 可移动磁盘的根目录或其中的目录，在后台线程只读扫描目录与文件属性。显示已发现文件路径、目录、逻辑大小、当前扫描目录和时间；总工作量未知，任务中心保留不确定进度，不伪造完成百分比。完成或停止后按当前层级展示矩形树图与大小降序列表，支持选择、进入目录、双击目录、面包屑 / 上一级和资源管理器定位。列表每页 100 项；树图最多单独绘制 60 个正值子项，其余正值合为“其他”，零值 / 跳过项仍可在列表访问。

**统计口径：** 统计文件逻辑长度，不统计物理分配、目录元数据、压缩 / 稀疏分配差异、文件系统开销、备用数据流或磁盘空闲空间。Windows 通过只读属性句柄查询卷号与 128 位文件 ID；支持身份的文件系统按身份去重，硬链接只归入路径排序最前的已发现路径，其他副本显示计入 0 B 及原逻辑长度。不能查询稳定 ID 时仅接受已确认的单链接文件；无法确认身份的多链接文件跳过并报告。字节数经 IPC 传为十进制字符串，前端用 BigInt 解析，避免 2^53 以上的整数精度损失；图面积用浮点比例绘制。扫描不是文件系统快照，文件变化后需重扫。

**有界只读与生命周期：** 根路径限定绝对本机固定 / 可移动盘，拒绝 UNC / 映射网络盘、设备路径、链接和离线根目录。遍历不跟随符号链接、目录联接或其他重解析点，跳过离线 / recall 占位、特殊类型和无法访问项，不读取文件正文或召回云文件内容。最多 20 万条目录项、64 层、10 分钟和 64 MiB 路径文本；达到预算、取消或发生访问错误均显示不完整结果。错误明细最多 100 项，另外保留总数。未完成祖先目录标记为部分结果，大小按已知下界显示。

原生命令仅允许主窗口，按随机 job ID 隔离进度、取消、结果查询和释放；最多一个活动扫描与一份完成结果驻留。停止保留已扫描树，关闭工具会停止当前扫描并释放缓存，迟到的扫描和查询不能填充新会话。查询返回当前层级分页、面包屑和树图摘要，不把整棵树发送给产品界面。任务中心仅记录工具状态与摘要，不存文件名清单或目录树。首版没有删除操作、导出报告、暂停 / 继续或 CLI / MCP 扩展。

**实现文件：** 包目录内 `src-tauri/src/native_runtime/disk_space/engine.rs`（属性扫描 / 身份去重 / 汇总 / 分页）、`mod.rs`（主窗口命令 / 任务与缓存）、`tests.rs`；在 `native_runtime.rs` 和 `runner.rs` 注册状态 / 命令并于退出时取消。前端位于 `src/features/disk-space/`，包括字节 / 树图核心、控制器、模板、样式和工具入口；同步懒加载、首页分组、中英语言包及帮助。当前帮助覆盖 88 个工具、78 个可见章节。

**验证：**

- `npm run test:disk-space`：64 位精确字节解析、MiB / PiB 等单位与小比例显示；40 组确定性随机权重 / 尺寸下检查每个矩形的面积比例、边界、全平面覆盖和两两不重叠；无效原生响应、父子 ID、分页上限和空树图通过。
- `npm run test:disk-space-native`：**8 项通过**，另 1 项大目录验收默认显式跳过。使用真实系统临时目录与文件，验证硬链接去重和路径归属、目录汇总、大小顺序、分页 / 树图其他项对账、空文件、原文件内容 / 修改时间不变、预取消 / 进行中取消、条目 / 层级 / 时间 / 路径内存预算、无效根、并发拒绝、任务隔离、释放与失败重扫保留旧缓存。Windows 实际创建指回父目录的目录联接检查不循环，修改合成目录 DACL 模拟权限拒绝并还原，设置合成文件 Offline 属性检查跳过并还原，拒绝 UNC 和设备根；这些操作仅发生在测试创建的临时目录内。
- 显式运行 `disk_space_native_acceptance --ignored --nocapture --test-threads=1`：创建 40 个含中文名称的目录、5000 个文件、1 个硬链接副本和 1 个空目录，实际扫描 **5001 个文件路径 / 42 个目录 / 12,502,500 逻辑字节**；唯一逻辑长度与构造值一致。当前本机扫描约 **415 ms**，含样例创建约 1332 ms；这是合成目录本机数据，不代表整盘、所有存储设备或权限组合的耗时。输出 `tmp/disk-space-native/native-report.json` 供前端隔离验收使用，原合成目录随后清理。
- `TOOLKNIT_DISK_REAL=1 npm run test:disk-space-browser`：**81 项**实际 Edge 检查通过。树图实际 DOM 几何、最多 60 个独立正值块及余项、分页 100+25、面包屑、空目录、硬链接零值说明、原生真实扫描快照显示、选择与定位参数、权限部分结果、失败重扫保留结果、查询失败恢复、停止保留结果、取消传输失败可重试、任务不确定进度 / 取消状态、事件释放幂等、关闭重开与迟到响应隔离、坏响应拒绝及缓存释放、选择框取消不触发扫描，以及 1440 / 1024 / 390 × 明暗主题 × 中英文无横向溢出。所有展示和树图计算在真实浏览器执行，原生传输在浏览器中使用夹具；真实文件扫描由上述 Rust 验收独立执行，不冒称完整 Tauri UI 验收。
- `npm run test:disk-space-production`：实际生产首页搜索“磁盘”，从真实入口懒加载打开工具、显示浏览器需要桌面版且没有伪造扫描数据、Esc 回首页通过。`node scripts/test-home-settings-browser.mjs` 的明暗主题 / 英文、首页类别和 V3.4 13 个新工具分组回归通过。帮助、现有清理懒加载 / 生命周期 / 隐私契约和系统清理提权契约检查通过。
- `npm run build` 通过，沿用既有 launcher 静态 / 动态导入与 chunk 体积警告。没有新增依赖，也未构建或发布安装包。
- 使用 `design-taste-frontend` 的 analytics 方向并保留现有主题与字体：单一蓝色的浅色层级承载面积，沿用共享工具导航。已查看浅色桌面、暗色窄屏和真实原生数据截图；修正树图数值对比度，并将进入 / 定位操作移至图上方。Inspector 三种宽度 **0 FAIL / 0 WARN**；现有字体回退及全局输入焦点下划线纯色 CSS 渐变继续使用已有豁免。

**证据与复跑：** `tmp/disk-space-native.log`、`tmp/disk-space-native-acceptance.log`、`tmp/disk-space-native/native-report.json`、`tmp/disk-space-browser/report.json` 和布局 / 原生数据截图、`tmp/disk-space-production/`、`tmp/disk-space-inspect/`、`tmp/disk-space-build.log`。运行显式原生大目录验收前，将 `TOOLKNIT_DISK_QA_ROOT` 指向独立证据输出目录；Rust 测试自行创建并清理系统临时扫描目录。浏览器默认合成数据验收，`TOOLKNIT_DISK_REAL=1` 时同时读取上述原生快照；需要本机 Edge 和已配置的测试 Playwright 路径。

**首版边界与下一项：** 正式 Tauri / WebView2 窗口全流程和可移动磁盘实际拔出保留 TK-011-A。网络盘、物理占用、实时文件监控、暂停 / 恢复和跨扫描历史比较不在首版范围；资源限制保留部分结果，不静默宣称全盘扫描完成。下一项调研 TK-012 PDF 水印 / 重复对象移除，先区分可分离对象与扫描背景。

### 2026-11-20：TK-016-A 开源线稿转换原型与交叉验证

**实际交付：** 新增 `scripts/lib/pdf-to-dwg-prototype.mjs`、`scripts/convert-pdf-to-dwg-prototype.mjs`、`scripts/test-pdf-to-dwg-prototype.mjs` 与 `scripts/qa-pdf-to-dwg-acadsharp.ps1`。使用隔离目录的 acad-ts 3.9.0 将受支持的 PDF 线稿直接生成 DWG 2018，支持比例 / 单位、选页、旋转 / CropBox / UserUnit、仿射变换、直线、三次样条与文字；每页独立文件，任务目录全部成功后发布，取消 / 后页失败不留下前页半成品。严格拒绝图片、填充、虚线、裁剪路径、OCG、Form 和其他不支持内容，文字字体 / 字宽 / 颜色存在明确回退。未修改应用运行时代码、依赖锁或用户可见工具入口。

**修正与验证：** 初版缺少根字典默认集合，C# 引擎能读但保存时报缺少 Standard MLine 样式；显式初始化集合后修复。随后根据固定版本源码和原生诊断修正当前写入实例的容器分区计数，在引擎生成 CRC / 加密前填入实际映射条目数；未删除校验、过滤警告或事后改写字节。`node scripts/test-pdf-to-dwg-prototype.mjs --snapshot ../docs/issues/tk016-prototype.json` 现为 **27 项检查、14 份真实 DWG 的独立原生读写验证通过**：LibreDWG 0.14.9154 解码 / 转 DXF 无 Warning / ERROR，ezdxf audit 为 0 错误 / 0 修复。已知坐标、毫米 / 英寸 / 米、1:100、旋转、非零裁剪原点、UserUnit、曲线控制点、中文字符串和颜色均核对；另有 1200 条线的多分区文件、重复导出、原件哈希、取消及部分失败清理。损坏 PDF 拒绝时的 Indexing 提示属于输入解析负例，未视为 DWG 引擎警告。

**第二套库的修改保存：** `./scripts/qa-pdf-to-dwg-acadsharp.ps1 -Snapshot ../docs/issues/tk016-acadsharp.json` 使用 NuGet ACadSharp 3.8.35 的 net8.0 程序集，**14 份文件读取、实际修改端点 / 控制点、另存并重开通过**；几何、文字、单位一致，无通知，原 DWG 哈希不变。通过现有 PowerShell 加载，未安装 .NET SDK。acad-ts 源自该 C# 项目，因此未将二者称为完全独立的实现；独立 C++ 引擎的验证另列。

**来源与原始证据：** acad-ts / ACadSharp 保留原 MIT 许可，GNU 预发布验证器只解压于被忽略的临时目录。GNU 0.14.9154 win64 ZIP 的 SHA-256 与官方资产摘要一致；包 SRI、引擎 / 程序集哈希见两份新 JSON 快照。主测试每次建立新 `tmp/tk016/prototype-qa/run-*/`，`report.json` 的 artifactRun 指向当前运行，其中有 PDF / DWG / GNU JSON / DXF / 日志及 C# 另存工件。另用 Poppler、ezdxf SVG 与 Sharp 查看平面图、曲线、旋转和中文样例；目标字宽 / 字号外观有差异，回退字体显示中文缺字，故只确认字符串数据保留，不宣称字形保真。中文源 PDF 改为完整字体以消除子集字体的输入绘制缺字。原始 LibreDWG 0.14 的失败快照未改写。

**状态与剩余条件：** 详见 [PDF_TO_DWG_PROTOTYPE.zh-CN.md](PDF_TO_DWG_PROTOTYPE.zh-CN.md)。优先候选已从商业 SDK 更新为开源线稿路线，ODA 留作备选。用户确认没有可用 CAD / SDK / 真实 PDF 图纸；交互式 CAD 打开编辑、至少三份真实图纸、字体 / 字宽与资源性能仍待条件，TK-016-A 不勾选。TK-016-B 的桌面集成与 TK-016-C 的扫描矢量化仍未实现。程序化库级操作不冒称 CAD 界面验收，未构建或发布安装包，未运行无关生产构建。


### 2026-11-20：TK-012 PDF 水印 / 对象移除首版完成

**已有能力核对：** `pdf-editor-core.js` 的既有原文字编辑 / 删除通过白底遮盖再重绘实现，图片删除针对插入对象；这不能作为原内容流水印对象已删除的证据。本轮新增独立“PDF 水印 / 对象移除”，复用已安装 PDF.js / pdf-lib、共享工具壳、文件读取、输出目录与二进制写入，不更改原编辑器，也未添加依赖。

**首版工作流：** 本机选择 PDF 和页码，列出可独立处理的文字对象、图像绘制调用与简单文字 / 图片 Form。列表不自动判定水印语义，普通正文也可能列出。先对对象做“单项预览”定位，蓝框来自原页与实际改写结果的像素差异；单项预览不改变移除列表，也不能直接导出。确认后加入移除列表，或在明确页码范围内加入绘制指令、资源与进入状态完全一致的对象。同字不同位置、同图不同变换、不同资源或状态不做模糊匹配。支持 40 步撤销 / 重做、适合窗口 / 原生像素 / 200% 查看、切页保留选择。列表变更后必须重新生成列表预览，复核正文后才能导出。

**实际移除方式：** 有界词法器识别字符串嵌套 / 转义、十六进制、名称、数组、字典与注释，避免把文本里的 `q / Q / Do / Tj` 误当指令。对完整文字对象移除 `Tj / TJ` 等显示指令；`'` / `"` 的换行与字距副作用改写保留，保留字体、字号、行距和其他后续正文可能继承的状态。文字裁剪和外部 ActualText 等不适合显示指令单独删除的上下文不提供候选。图像只删除选定 `Do` 调用，简单 Form 也只移除该次调用；共享字体、图片和 Form 不被全局修改。每次从不可变原文件创建新文档，为修改页注册独立内容流，避免影响使用同一内容流的未选页。重复引用同一个页字典的异常结构整体拒绝，避免页局部编辑波及另一个页索引。

保留页数、CropBox、MediaBox 和旋转；不栅格化输出，不引入白色覆盖块。旧资源、未引用旧流及元数据可能仍保留，本工具不用于保密脱敏；它移除的是所选活动绘制指令，不承诺清除原文件所有历史数据。整页扫描图仍可能作为一个图像对象列出，删除它会删除整幅图，不能单独修复已经合并的水印。无法可靠直接解码的 CJK / Symbol 等字体只显示“字体编码文字”，由视觉预览定位，不把 glyph code 误作 Unicode。

**范围与限制：** 输入 24 MiB / 100 页 / 50000 个间接对象 / 1000 个候选，单页解码 8 MiB、文档累计 32 MiB、每页 10 万条指令 / 文档 50 万条，词法对象嵌套 32 层、图形状态 64 层、Form 检查 4 层；资源签名序列化同样有深度与长度界限。内容支持原始流和单一 FlateDecode / Predictor 1；内联图像、复杂 Form、部分过滤格式及不明确的流边界跳过并解释，其他支持页仍可处理，跳过页保留。受密码保护文件先使用现有解密工具处理，初次 PDF.js 载入负责识别加密，避免严格内容解析错误被误报为普通损坏。预览最多 400 万像素 / 最长边 6000 像素；Worker 每次请求 120 秒，文件分析 / 渲染操作另有 180 秒截止，输出 64 MiB。

**取消、恢复与输出：** 分析和改写在真实 Web Worker 中进行，取消实际终止处理 Worker；PDF.js 载入 / 渲染一并取消。迟到结果不能填充关闭后重开的会话。失败导入保留旧文件、列表和可用预览，下一次改写会重新载入旧 Worker 分析状态，避免工作线程和可见文档错配。导出只允许与当前移除列表一致的列表预览字节；桌面唯一命名保存到 `PDF_Objects` 并可定位，浏览器下载。最终写入禁用取消 / 离开，保存失败保留已核对字节供重试。任务中心只存状态与输出位置，不存正文、glyph 数据或移除列表。

**实现文件：** 包目录内 `src/features/pdf-object-remove/` 的 `lexer.js`、`processor.js`、`worker.js` / `worker-client.js`、`core.js`、`preview.js`、`controller.js`、模板 / 样式 / 工具入口；新增合成样例生成器 `scripts/lib/pdf-object-fixtures.mjs` 和核心、浏览器、生产入口测试及夹具。同步懒加载、PDF 分类、V3.4 新功能、中英文和帮助。当前帮助覆盖 89 个桌面工具 / 79 个可见章节。本轮没有新增 CLI / MCP 或 Rust 命令。

**验证：**

- `npm run test:pdf-object-remove`：**28 项**通过。创建三页有色背景、重叠正文、同字正文引用、共享 Logo、斜体 / 透明文字水印、半透明图片水印和复用文字 Form 的合成 PDF。精确匹配各三处共九个水印调用，另一个位置的相同文字和共用的正文 Logo 不匹配。移除后页数、裁切与旋转保留，活动文本 / 图像指令数符合预期；独立页改写不影响共享内容流的另一页。额外验证未被 q / Q 包裹的文字对象移除后，后续正文仍正确继承字距 / 行距，双引号的 Tw / Tc 参数不丢失。
- 核心检查还覆盖字符串 / 注释中的伪指令、坏字符串、内联图像拒绝、解码压缩炸弹超过 8 MiB 后拒绝、未知过滤与无效结构说明、裁剪文字 / ActualText 不提供候选、Artifact 可选、Symbol 不误标 Latin、重复页对象拒绝、页码范围与撤销分支。
- 使用真实捆绑 qpdf `--check` 验证输出结构。用独立 Poppler 按 96 DPI 将三页“移除后 PDF”与独立生成的“无水印参考 PDF”渲染，**三页逐像素完全一致**，包含 90 / 270 度和 CropBox 偏移；原有绿色底色、重叠正文与 Logo 恢复，不能由白块遮盖冒充。文本状态继承样例也与独立参考逐像素一致。本机原生渲染不是浏览器模拟器返回值。
- `npm run test:pdf-object-remove-browser`：**83 项**真实 Edge 检查通过。实际 Worker 分析 / 终止、PDF.js 前后渲染、单项与列表预览隔离、无预览禁止导出、范围精确匹配、文字 / 图片 / Form 九项列表、撤销重做、缩放和旋转页、变更后预览失效、多页选择保留、明暗主题 × 中英文 × 1440 / 1024 / 390 布局与窄屏跳转、实际像素差异范围、坏文件 / 超页 / 加密 / 超大输入、原生限量读取、保存失败重试 / 发布锁、原件 SHA-256 不变、任务不含正文、取消错误分类与迟到结果隔离通过。取消样例为 80 页、每页 5000 个文字显示操作的有界合成文档，记录处理 Worker 收到 load 后再取消，并确认 Worker 被 terminate；该检查没有等待完整长文档处理完成。
- 浏览器生成并经隔离原生字节传输写出的三页结果，再由真实 qpdf / Poppler 重开，与三页无水印参考逐像素一致。PDF.js 文字提取验证正文可搜索、正文中的合法 DRAFT 引用仍在，选中的水印活动文字和 Form 文字不再出现。另用嵌入思源黑体的中文样例，确认编码文字可视觉定位，导出仍可搜索“中文正文2026”且活动文本不含“内部水印”。浏览器中的原生读取 / 写入边界使用夹具，不冒称完整 Tauri UI 验收。
- `npm run test:pdf-object-remove-production`：生产首页搜索水印、懒加载入口、实际构建后的 Worker 和离线 PDF 资产、读入样例、生成移除预览、浏览器导出可重开的三页 PDF、返回首页通过。`node scripts/test-home-settings-browser.mjs` 明暗 / 英文和 V3.4 **14 项**新工具的发现 / 搜索回归通过。`test-pdf-editor-core.mjs`、`test-pdf-editor-exporter.mjs`、`test-pdf-editor-page-operations.mjs` 及帮助检查通过，既有编辑器行为保留。
- `npm run build` 通过；沿用已有 chunk 体积与 launcher 静态 / 动态导入警告，没有添加新依赖或发布安装包。按 `design-taste-frontend` 复用已有编辑工具壳、侧栏与双页预览。原随机 greeting 概览方向不适合此编辑任务，明确重抽一次 style，采用 flat / 黑白反色操作与单一蓝色差异标记，保留现有字体和主题。已查看暗色桌面及浅色窄屏截图；Inspector 三宽度 **0 FAIL / 0 WARN**，现有字体回退和纯色输入焦点渐变下划线沿用已有豁免。

**证据与复跑：** 包目录 `tmp/pdf-object-remove/report.json`、源 / 无水印参考 / 改写后 / 状态继承 / 不支持样例及 Poppler PNG；`tmp/pdf-object-remove-browser/report.json`、实际导出和布局截图、`tmp/pdf-object-remove-production/`、`tmp/pdf-object-remove-inspect/`、`tmp/pdf-object-remove-build.log`。先运行核心脚本生成样例和独立参考，再运行浏览器脚本；生产入口检查前先构建。原生核验需要捆绑 qpdf 与 Poppler，后者可由 `TOOLKNIT_PDFTOPPM` 指定；Playwright / Edge 使用现有测试运行环境。只使用本轮生成的合成材料，没有读取用户私人 PDF。

**余项与下一项：** TK-012-A 保留扫描合并水印修复；TK-012-B 保留复杂 Form 内部对象、内联图像、注释型图章、混合正文 / 水印的单一文字对象及更多过滤 / 语义格式。TK-012-C 为正式 Tauri / WebView2 文件选择、资产加载、预览和原生输出串联补测。下一项核验 TK-013 OrcaRouter 是否可通过已有兼容接口配置使用，缺测试凭据时明确保留实际服务未验证状态。

### 2026-11-20：TK-016-A 中文缺字与文字段宽修复

**原因与修改：** 原型引用了不存在的 `msyh.ttf`，还将 PDF em 字号直接用于 CAD cap-height。新增 `scripts/lib/pdf-dwg-font.mjs`，改用仓库已有的真实 Noto Sans SC TrueType 字体；逐 Unicode 检查目标 glyph，缺字明确失败。随结果原样复制字体、完整 OFL 许可与 FONT-README，字体元数据和 SHA-256 进入 conversion.json。PDF 内嵌字体仅用于读取字高度量，不复制其程序，不修改系统字体。提取源文字的前进宽度，按源 cap-height 换算字高，再用随附字体的实际 advance 校准可编辑 TEXT 的宽度因子；保留左对齐和基线，避免 FIT 在不同渲染器中拉伸墨迹边界。未知源字高度量仍有明确的近似提示，替代字体笔形 / 字重及复杂塑形不保证相同。

**验证：** `node scripts/test-pdf-to-dwg-prototype.mjs --snapshot ../docs/issues/tk016-prototype.json`：**35 项、19 份真实 DWG 独立原生验证通过**，无原生引擎 Warning / ERROR，DXF audit 为 0 错误 / 0 修复。新增压缩 / 拉伸、混合中英文、旋转中文和 Times cap-height 样例；FontTools / ezdxf 只加载实际随附字体，核对每段文字的字符覆盖、字高、宽度因子、字体哈希和前进宽度。缺字为 0，最大数值宽度误差约 6.82e-13 绘图单位（浮点一致性，非工程精度承诺）。缺字负例、纯几何无需字体、字体许可完整、重复导出和原件哈希均检查。

**保存与渲染：** `./scripts/qa-pdf-to-dwg-acadsharp.ps1 -Snapshot ../docs/issues/tk016-acadsharp.json`：**19 项修改 / 另存 / 重开通过**，新增比较宽度因子与字体引用，另存目录保留字体及许可。`tmp/tk016/python/Scripts/python.exe scripts/qa-pdf-dwg-font-render.py --snapshot ../docs/issues/tk016-font-render.json`：**6 组同页面比例预览核验通过**。3 组使用相同字体的中文 / 混排 / 旋转，1 px 边界容差内双向墨迹覆盖均为 100%，边界差不超过 1 px；3 组英文替代字体只核对段宽和字高，笔形差异如实保留。渲染时显式使用整页坐标，未按文字范围各自缩放；SVG 字体轮廓采用 TrueType nonzero 填充，修正通用 evenodd 渲染在交叠笔画处挖白缝的问题，只影响校验预览，不改 DWG。

**文件与边界：** 新增 `scripts/check-pdf-dwg-typography.py` 和 `scripts/qa-pdf-dwg-font-render.py`；现有转换、原型测试和 C# 检查脚本同步更新。新证据为 `docs/issues/tk016-font-render.json`，原型 / C# 快照同步刷新；实际字体、DWG、DXF、SVG、PNG 与文字对比图保留在 `tmp/tk016/prototype-qa/report.json` 的 artifactRun 对应目录。样例中文字形与整段字宽已修复；DWG 本身不嵌入 TTF，CAD 仍需识别随附字体，真实 CAD / 用户图纸和桌面接入保持待验收。更新 [原型说明](PDF_TO_DWG_PROTOTYPE.zh-CN.md)及 TODO 中相应状态，未修改生产运行时或构建安装包。
