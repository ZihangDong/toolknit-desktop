# ToolKnit Desktop V3.0 维护规范

## V3.2 发布前验证补充（2026-10-23）

构建前运行 `check-dependency-lock.mjs`，直接读取实际依赖包的 `package.json`，不把 npm 隐藏锁文件或 `npm ls` 当作实际安装版本的唯一证据。桌面干净安装用 `npm run test:desktop-clean-install -- --browser` 在仓库外消费当前源码和锁文件，避免沿父目录借用旧依赖。已存在的 Vite 服务不会因磁盘依赖更新自动使用新模块，浏览器专项应启动自己的受控服务。

源码构建最低 Rust 版本为 1.90，与当前锁定的 Windows Tauri 依赖图及中英文 README 对齐。`test:rust-toolchain` 使用 Cargo 结构化元数据检查目标依赖的最低要求，纳入发布门禁；再用 Clippy 检查源码 API 的最低版本。单个库支持 1.88 不代表整个应用也支持，发布二进制运行不要求用户安装 Rust。

Excel 全部工作表导出必须检查实际 PDF 正文。LibreOffice 在只读文档上可静默忽略 `IsVisible` 修改；原生链路先沿用只读导入，只有“全部工作表”需要展开隐藏表时重新以可编辑模式打开临时副本，保留旧 XLS 兼容、禁用宏/外链更新及源文件不变约束。变更后运行 `npm run test:excel-to-pdf-native`，实测 XLSX/XLS/ODS 的全部/可见工作表、隐藏内容、公式、纸张方向和临时文件清理。该专项需要本机真实 LibreOffice，不以接口返回的 `exportedSheetCount` 代替 PDF 内容验证。

`app/settings-navigation-runtime.js` 持有设置页的 Escape 入口，复用既有关闭/过渡函数。在懒加载工具安装文档级监听前接入，只有设置为当前页面且无子弹框接管时消费事件，避免同一次按键关闭后台工具。模型弹框、下拉菜单和快捷键录入继续优先处理自身 Escape，监听由生命周期 scope 在 pagehide 释放。

共享 `createModalSession` 打开时检查指定焦点是否禁用、隐藏或处于 inert 区域；不能聚焦时选可用控件，必要时临时令容器可聚焦，关闭后清理。Escape 仍限于自身焦点或事件目标，不因为 `body` 接到按键就关闭后台可见工作台。测试应包含默认安装按钮禁用、子弹框关闭、设置正文失焦以及原工作区数据保留的连续操作。

持续浏览器检查使用不可变的构建目录；不能边重建 dist 边将旧页面的动态 import 失败归为产品缺陷。`test-navigation-soak-browser.mjs` 覆盖跨工具、设置、返回与 Escape，记录 GC 后堆、DOM、监听和 Worker/Object URL；它不代替原生 HWND 或实际旧机安装验收。最终范围、证据与网络限制见[发布前报告](V32_RELEASE_PREFLIGHT_20261023.zh-CN.md)。

## V3.2 双主题状态审计（2026-10-21）

主题覆盖以实际展开/生成的 DOM 为准。PPT 提取正文是 `div.ppt-text-detail-line`，仅覆盖 `span/p` 会漏正文；生成后的事实、页码和标签同样须实测。PPT 独立 portal 与页面是兄弟节点，主题 token 必须在两处可见；portal 的 `pointer-events:none` 也会被子编辑器继承，完整编辑层需明确接管输入，使用 `createModalSession` 和 `prepareToolPageChrome` 处理背景、焦点及导航。

组合输入的外层负责底线，内层包括聚焦状态保持透明；属性存在不等于没有被覆盖，应核对输入文字列和单位列的底线像素。下拉使用现有组件，隐藏原生 select 离开 Tab 顺序，菜单 Tab/Shift+Tab 回到表单顺序，dispose 恢复原属性。不要依赖会被 `background` 简写清掉的装饰箭头。

颜色巡检等待过渡稳定，识别 RGB 与 `color(srgb ...)` 的不同数值范围；渐变、透明层、文档内容和禁用状态须看截图复核。PPT 生成、真实本地 PPTX 提取、编辑导出与测试服务响应分开记录。详情见 [双主题审计记录](V32_THEME_AUDIT_20261021.zh-CN.md)。

空输入另检查 `::placeholder`；正文颜色正确不代表占位文字可读。透明字段可采集截图中无字的内边距背景，与占位颜色及透明度计算对比度，避免把仅按祖先背景色估算的结果当成确定故障。保留正常输入后的正文色、光标及文档内容色。

## V3.2 PDF 预览与共享输入（2026-10-21）

PDF 文档画布的普通滚轮由 `shared/preview-viewport.js` 管理鼠标锚点、RAF 合并、中键/空格平移和迟到工作失效；各 feature 持有实际缩放状态与 PDF.js 任务。已有编辑器保留自己的临时变换与高清提交机制，按当前可见变换反算锚点，避免连续输入中换锚点后漂移。侧栏、缩略图和 Markdown 文本不是文档画布，不接管其滚轮。裁剪和页码使用 `shared/pdf-preview-canvas.js` 私有画布完成绘制后才提交，保留旧帧并限制像素预算。

纯缩放/尺寸重绘不应调用整页 update 重建编辑选区。PDF 转 Word 保留现有 region 节点，只有文档/编辑状态变化才更新交互层；适应宽度只观察外框宽度，不能因为选择操作栏出现导致高度变化就反复重绘。浏览器测试需等待启动遮罩完成，并以命中测试排除被工具页遮挡的首页输入，避免错误统计与焦点丢失的假失败。

文本输入统一接入 `styles/components/input-focus.css`；组合输入由外层拥有底线，内层不得重复绘制。该共享边界用集中且有说明的优先级覆盖历史 feature/theme 外扩轮廓，新增字段不再新增竞争样式。减少动态效果规则的选择器优先级必须覆盖基础规则；截图辅助 WebView 需要显式导入样式。按钮、复选框、色板和滑块保留原语义。

上传空状态通过 `shared/upload-empty-state.js` 传入静态配置，运行时文件名不进入模板。成功提示沿用 `audio-clip-success-*` 组件与 `tk-file-result` 主题/溢出适配，`modal-runtime` 继续管理焦点、inert 和关闭。禁止将“调用 modal-runtime”作为外观已复用的证据。范围、契约和回归证据见 [本轮验证报告](V32_PDF_UI_UNIFICATION_20261021.zh-CN.md)。

## V3.2 图像 PDF 与空白文档（2026-10-21）

图像转 PDF 的入口、容量、格式及分层验证见 [图像 PDF 维护说明](IMAGE_TO_PDF.zh-CN.md)。共享像素算法与 Writer 位于 core/shared，旧 PDF 扫描入口保留转发；图像格式尺寸读取不应引入 PPT/ZIP 依赖。实际纸张尺寸要核对图像元数据、方向和最终 PDF 的 MediaBox；高清指标应分别记录嵌入像素与阅读器渲染，不能把渲染器重采样误判为源图被压缩。

PDF 编辑器的新建空白文档走既有文件会话，初始 saved snapshot 为空；新增空白页复用不可变源字节而保留独立页面编号。图片资源的 owner 是当前、撤销历史、基线和已保存快照的引用并集，不能在用户点击删除时提前释放原图字节。新插入的多行文字通过 `core/pdf-inserted-text.js` 共用行高与选框，保留原单行编辑和 core 导出的兼容接口。

文件读取必须在 operation 建立之后进行，并在每个异步边界检查是否仍有效；追加文件和原生文件选择同样适用。进入不可撤回的文档替换或文件保存阶段后禁止取消；此前的取消必须阻止后续写入。模态输入处理 Escape 时停止事件继续冒泡，中文输入法确认不能触发保存。PDF.js 6 的失败加载、迟到 getPage 和快速重开都需要独立回收验证。

浏览器操作压力检查、正式构建桥接、真实 Rust 解码及 Windows 发布分开记录；它们不能替代完整安装版 WebView2 验收。测试脚本与本轮证据见 [实施与验证记录](V32_PDF_CREATION_PLAN_20261021.zh-CN.md)。

## V3.2 PDF 转 Word（2026-10-18）

2026-10-19 用户已将当前目标收敛为大众日常使用，验收见 [交付收尾记录](V3_2_PDF_WORD_DELIVERY.zh-CN.md)。原生公式全面兼容与更大真值语料延后，不作为本轮交付阻断，也不标为已经完成。

表格背景与可编辑文字分层仅移除可独立绘制的完整文字组。`getOperatorList()` 与实际 display 列表的索引可能不同，须验证绘字内容、顺序和分组后建立映射；固定 PDF.js 内部接口不可用时保留图像回退，第二次渲染仍须核对同一 display 列表。恢复的文字不能重复进入背景，隐藏/遮盖内容仍不可输出；AI 区域规划跳过与固定背景重叠的文字，保留其他正文审查。真实优化指令夹具、背景像素、来源覆盖、取消和最终 DOCX 均有专项测试。

2026-10-20常见文档适配补充：规则表格按单元格组行，来源冲突的嵌套边框不能重复建表；条纹/透明底色必须验证旧文字从背景中移除，不能把完整截图藏在可编辑文字下。`core/aligned-tables.js`仅处理有明确稳定列和数值证据的无框表格，实际Writer装不下时保留原文字。`graphic-text-layers.js`与表格恢复共用集中背景层上限16，同页只附加渲染一次；32 MiB资产和其他容量边界不变。字体笔画同时尊重PDF.js的实际绘制标记，已知字体映射及Win行度量校准须核对目标字体，不能把泛型标记当作可靠字体身份。

常见文档的来源、冻结划分、真实阅读器、编辑性及阶段限制见[V3.2常见PDF适配进展](V3_2_GENERAL_PDF_WORD_PROGRESS.zh-CN.md)。测试资料留在本机忽略目录；独立样本经修补后不再算未见样本，缓存布局回放不代替原PDF重转。Node/浏览器、WPS/LibreOffice的结果分开记录，验证脚本复制PDF失败与工具转换失败分开。

PDF.js在Node与浏览器的系统字体默认策略不同。PDF转Word单独关闭系统字体优先替代，使用随包标准字体提供可分析轮廓；不能将这一设置扩散到其他PDF工具，也不能据此声称特殊字体或坏编码已还原。真实UI导出后检查实际OOXML和Office渲染；字号错位的普通字既要保持正确文字顺序，也要保留独立坐标，Writer的分帧规则与预算估计同步。

A4连续排版是否采用固定片段需在整个文档组行前统一决定，避免普通页先丢弃精确字形位置，随后又被强行固定排版。分析和导出复用同一纸面检查；不适合A4的文档提示改用保留原页，不扩大尺寸或图片容量。空白页保留来源书签，独立评分必须确认原页确实无可见前景，不能靠空白标记掩盖缺页。

表格背景可以连着有界页尾装饰，但恢复只认完整归属的单元格和独立文字绘制组。多个恢复阶段对同一背景合并移除指令，不重复计层或互相跳过；必须回归原有图文样本，防止新增表格判定反而减少可编辑内容。白字恢复需要可证明的深色实心矩形底色和绘制次序，白底隐形字、半透明字和遮盖不能恢复成正文。复杂裁剪仅在匹配的保存/恢复范围内、没有文字/未知状态操作时局部保真，裁剪内含文字仍需完整解析或原保护策略。

编辑性验证要在实际阅读器中修改、保存并重新渲染，核对旧字消失、替换字出现、其他字符及页数保持。检查原生表格删除后的像素时，单独识别并记录未变的通栏边框，不能把它当旧字重影，也不能笼统排除所有相同像素。非连续选页的原稿页码与输出页码必须分别传给图像对照工具。

独立数值检查只在同一物理位置匹配重复金额/零值；别处有相同值不能直接算“移位”。源字体声明的字符边界与实际可见笔画可能不同，异常坐标需回到局部图像复核，保留原始异常记录，不能用总体视觉高分代替字段核验。

文本序列对比遇到重复词时，删除/插入片段可能跨词边界。必须核对实际DOCX完整单词和前后文，再判定文字重排；不能仅凭差异片段或几何提取器的顺序修改已经正确的输出。

新工具由 `features/pdf-to-word/` 独立持有。PDF.js 操作列表必须在渲染前快照，因为渲染会把数字 path 改为 Path2D；重复分析先停止预览并清理页缓存。原始来源、可见性与输出覆盖分开，AI 仅返回有界结构建议，不能改写文字。DOCX 表格使用显式 grid/cell/total 宽度；段落与换行 run 明确字体/行高，空页眉页脚不占整页高度。不同 Office 渲染结果分别报告，不能用 XML 字数替代视觉验收。容量、协议与复跑入口见 [PDF 转 Word 维护记录](PDF_TO_WORD.zh-CN.md)。

内部原生公式必须分别通过整页、独立公式局部和实际OOXML语义审计；求和可用来源符号与原生上下限等价分组，但不能只改标签检查来放过主体或上下限错误。积分以括号外的明确微分项界定主体，上下限不能吞入被积函数自己的下标；来源完整但把后文并入积分的模型建议同样拒绝。根号与嵌套分数线使用有界来源几何校准，横线、底部、基线和字号共同核对；公式盒在分式参数及script中的样式行为分别验证。实验固定字号与样本ID不能进入产品。当前WPS样本通过不代表LibreOffice或手机通过，默认仍为局部公式图像，完整验收状态见专项进展。

矩阵括号先验证完整字形或拼件轮廓/连接，单字形元数据不覆盖多字形文本run；先证明矩阵结构再扩张区域，保留普通分式与缺字周围的编辑性。圆括号两行单列与二项式系数有歧义，不凭外形直接接受。矩阵校验覆盖行列、单元格/括号来源各一次，原生验证同时检查局部矩阵与完整等式；只生成`m:m`或整页高分都不能证明矩阵语义、编辑性及跨阅读器通过。

大彩图统一PNG可能先耗尽资产预算。可对有证据的纯彩图使用高质量JPEG，但只编码最终可见裁切，保持公式、含来源文字和不确定区域无损；编码格式须贯通Worker、DOCX媒体类型和Rust保存白名单，不能只测浏览器下载。Node画布和浏览器同名API可能使用不同参数，分别验证格式签名。阅读器探针除页数还应核对每页案例归属，节属性不得附着在最后一个公式段落；LibreOffice忽略公式字号/矩阵行距的事实不能通过修改WPS几何补偿解决。

## V3.2 历史数据与悬浮窗（2026-10-16）

2026-10-18 提示/菜单修补：透明辅助窗须设置共享 `--tk-window-bg`，同时验证计算背景与截图外围 alpha，不能只看原生 transparent 配置。菜单提前隐藏创建与字体加载，不创建有效会话或抢焦点；复用控制器时用 token/render revision 隔离旧选择结果与 finally。文字 OLE 载荷规范化 CRLF 但保留原有逻辑分行；不能从 DOM 视觉换行取正文。具体契约与验证见截图/剪贴板领域文档。

2026-10-18 补充：当前 schema 3 的 `ordering.rs` 维护独立浮窗排序，主历史时间线和存储保留策略不变，20 条淘汰只退出视图。常用语表单仅标题/正文，旧备注兼容保留。`drag.rs` 只允许浮窗通过有限集合和 ID 读取完整文字/原图，交给 Windows OLE，临时 PNG 有 64 个/128 MiB 与过期清理边界，不在 Drop 后立即删。`history-drag.js` 区分排序柄、单击和正文外拖，处理取消、更新隔离与失败恢复；不冒充目标应用已发送。桌面胶囊提示由截图域 `feedback.rs` 和 `feedback-window.js` 持有，主屏底部、穿透、不激活、最小事件权限，主线程核对 revision 后显示/隐藏，复用真实 HWND 隐藏路径。新 action/DOM/event 和验证证据见领域文档及 V3.2 历史改进报告。

2026-10-17 可见性修补：原生显示不能与仅依赖框架缓存的隐藏混用。截图域的 `window_visibility::hide` 在主线程核对实际 HWND 隐藏结果，菜单/设置关闭与截图前隐藏统一调用；状态写入失败或隐藏失败恢复先前偏好。菜单 hide/close 不恢复父窗口焦点，排队焦点动作也检查当前允许显示和实际可见性。隐藏的迟到请求返回 expired，不把正常过期当成红点错误。原生窗口回归使用屏幕外隔离进程复现缓存差异；浏览器调用计数不等于 Windows 窗口已消失。

2026-10-17 补充：悬浮窗新增完整历史搜索、加密备注和独立常用语；当前细节以 `CLIPBOARD_HISTORY.zh-CN.md`、`QUICK_SCREENSHOT.zh-CN.md` 为准。`library.rs` 持有 schema 2 的新增表、容量、查询与正文去重；历史过期/清空不触碰常用语。密钥样本校验覆盖仅剩常用语的数据库。`history-editor.js` 复用辅助弹框，失败保留草稿；主历史通过无正文事件按 ID 刷新备注。菜单触发需同时验证 native blur、pointerdown/click、token 和失焦延迟；主窗导航复用托盘恢复链。新增 DOM 为 `shotHistoryTitle/Mode/SearchForm/Search`、`shotPhraseCreate`，新增 action 和事件数据见对应文档；没有新增命令名称、工具数量或 CLI/MCP 能力。

- 当前开发版本 3.2.0，V3.1 已发布；`docs/desktop-update.md` 保留正式版内容，版本契约允许正式说明落后于有未发布日志的开发版本。CLI 源码版本同步，npm 未发布。
- 历史密钥由 `clipboard_history/key.rs` 管理。打开时先检查文件、DPAPI 与数据库样本，只有验证成功才保存受当前账户保护的 `key_backup`。备份写入 SQLite 后再原子发布密钥文件；初始化锁避免并发创建。旧库缺少密钥和备份时不替换密钥，不删除数据；主窗口 `restart` 仅在可恢复提示对应的密钥故障下，经确认完整保留旧目录并建立新库。
- 本次只读定位发现旧库仍在、密钥文件缺失；用户确认清理过且无备份。没有证据定位具体删除程序，也没有恢复旧记录的原密钥。本轮未重建用户实际历史库。
- 悬浮窗改用 `clipboard_history` 的列表、详情、复制与置顶接口，图片只在列表读取缩略图；删除原生截图的第二份历史缓存。两窗口查询互不取消，事件仅传 revision。开启监控收录其他应用，悬浮窗本身不自动开启监控；用户明确确认的本程序截图在悬浮历史开启、监控关闭时仍写入同一库，图片分类开关及容量校验继续有效。
- `quick_screenshot/history_actions.rs` 持有会话隐藏与边界回退；“隐藏到下次重启 ToolKnit”不修改历史偏好，关闭则写入关闭状态。截图前的可见窗口快照不覆盖当前开关；Destroyed 不修改偏好。展开/收起只调整一次原生尺寸，拖动松手后仅位置动画，必要时一次缩小到目标屏幕可用范围。
- 自绘圆角菜单由 `shared/context-menu.js` 和 `history-menu-window.js` 渲染；原生 `history_menu.rs` 提供独立透明窗口，按 token 约束就绪、选择与关闭。菜单不读取剪贴板正文，不为菜单反复扩大悬浮球窗口。菜单位置限制在工作区，失焦、关闭、截图均清理，旧会话不能关闭新菜单。辅助窗口复用弹框时必须挂载模板、样式及焦点 owner。
- 悬浮窗请求 `Query.limit=20`，本地筛选且不分页，不影响完整历史保留。普通列表默认 50 条保持兼容；悬浮窗权限仅允许单 ID 确认删除，删除同步主库，不触碰原文件。记录开关隔离旧状态，写入期间禁用；滚动/尺寸事件合并到 RAF，关闭释放观察器和帧回调。
- `app/auxiliary-tool-navigation.js` 复用各页面 owner 关闭设置/帮助/反馈/密钥/捐赠层，再打开剪贴板历史。新 DOM 包括 `clipboardRestart`、`shotHistoryFilters/Recording/RecordingLabel/Scroll/Detail/DetailBody`、`shotMenu/MenuError`；移除 `shotHistoryMore`。新增截图 action 和菜单事件详见 `QUICK_SCREENSHOT.zh-CN.md`；没有新增命令名称或 CLI/MCP 能力。快速截图归创意分类，创意 4 项、AI 5 项、总计 71 项，tool ID 与用户偏好不变。

## 抠图运行库与显卡兼容（2026-10-15）

- `src-tauri/src/onnx_segmenter.rs` 区分 DLL 加载、后端初始化和模型推理三个阶段。`LoadLibraryExW failed` 不能直接归因为显卡；CPU 同样依赖 ONNX Runtime 与传递 DLL。现有受控目录预加载、VC 依赖分发和进程期句柄保留继续生效，预加载失败不永久缓存失败状态。
- DirectML 显式关闭 memory patterns 与并行执行，后端注册失败必须报错，避免实际运行 CPU 却标记为 DML。自动模式覆盖初始化和推理失败：销毁故障会话，重试 CPU 一次，并在本进程后续请求中沿用 CPU；显式 CPU 模式直接绕过 GPU，不改变自动模式的降级标记。会话缓存同时按模型与后端区分。
- 初始化和推理的 Rust panic 在持锁期间捕获，清除故障会话；历史中毒锁可恢复。用户取消不触发重试，也不被 CPU 错误覆盖；两种后端均失败时保留两段诊断。原生访问冲突、进程 abort 与驱动挂死不属于 `catch_unwind` 的恢复范围。
- `segment_image` 新增可选 `force_cpu`（JS `forceCpu`），省略保持自动模式；结果新增 `used_cpu_fallback`，`execution_provider` 返回实际建立的后端。未改 CLI/MCP。`features/bg-removal` 复用共享下拉，新增 `bgRemovalExecutionMode` / `data-bgr-execution-mode`；既有 `toolknit.bgremoval.preferences.v2` 增加校验后的 `executionMode` 字段，旧偏好默认自动。处理时禁用、关闭时收起、销毁时释放菜单；中英文同步。
- 回归入口：`node scripts/test-bg-removal-core.mjs`；`cargo test --manifest-path src-tauri/Cargo.toml matting_tests --lib`；`node scripts/test-bg-removal-browser.mjs`（需要 Playwright，可用 `TOOLKNIT_TEST_BROWSER` 指定浏览器）。原生测试覆盖初始化/推理失败、有限重试、取消、显式 CPU、重复请求与 panic/锁恢复；浏览器测试用正式 Tauri mock 验证双主题、中英文、偏好持久化、真实控件与 native 参数、忙碌状态、失败反馈和菜单释放，不代表真实显卡验收。
- 本机真实模型冒烟：设置 `TOOLKNIT_TEST_MATTING_MODEL` 为本机 MODNet 文件后运行 `cargo test --manifest-path src-tauri/Cargo.toml cpu_inference_runs_with_optional_local_model --lib -- --nocapture`。使用生成图形，首次 CPU 约 1.98 秒、复用会话约 0.64 秒，尺寸与透明度断言通过；这不是人像质量或 Windows 10 / GT730 实机证明。日志与浏览器截图保存在忽略目录 `tmp/matting-*`。
- 本轮验证：完整发布门禁 103 个脚本通过（含架构/构建、1373 项安全检查、CLI/MCP 与资源审计），Rust 全量 223 passed / 9 ignored，浏览器 5 组检查通过；`git diff --check` 通过。修正版本契约对旧版 README HTML 标题/统计卡片的断言，使其校验已获用户批准的漫画版 Markdown 标题与实际数量；未修改产品版本、发布配置或 README 内容。

## 窗口与预览稳定性复盘（2026-10-13）

- 窗口控制由 `app/window-runtime.js` 统一串行并合并同类待处理动作，原生回复等待必须有上限与可见失败反馈；恢复窗口复用已有焦点/可见性事件同步状态，不另设每个工具的恢复入口。`test:window-radius` 包含顺序、重复、超时、失败重试与销毁测试。
- 页面动画等待不能仅依赖 `Animation.finished`；异常时释放当前遮罩并允许下一次导航。`test-page-transition-runtime.mjs` 覆盖永不完成的动画，浏览器转场检查双主题、快速切换、降低 CPU 与减少动画。
- 查询结果与主动操作/进度通知共享 revision，迟到的状态不能覆盖进行中的下载。`test-local-translation-browser.mjs` 显式重放查询晚于进度返回的顺序。
- 缩略图仅用于列表；原图独立保留给查看/导出/OCR。缓存随截图 owner 释放，既有历史上限保持；列表更新复用节点，图片成功解码后才提交，失败保留现有内容。测试同时验证解码次数、原图尺寸与销毁。
- 高频指针读取合并到一个 RAF，隐藏/销毁取消；低成本过滤不使用固定延时或页面转场。`node scripts/test-home-interaction-browser.mjs` 验证 100 次输入合并和即时搜索。
- 导航增加操作后用语义选择器定位控件，保留来源页返回断言。模拟平台测试不代替真实 Windows 托盘恢复、长期驻留或固定帧率验收。

## 发布源码与产物检查

Windows 升级链路由 `src-tauri/windows/installer.nsi` 与 `upgrade.nsh` 维护。旧安装目录从旧卸载程序定位，不用新版 `$INSTDIR` 判断卸载结果；`ExecWait` 紧邻清错与取错，版本比较使用独立变量。传入明确安装范围，升级使用 `/UPDATE` 保留数据与自启动，文件占用失败先停止再清理注册表。验证入口为 `test:windows-installer`、`test:windows-upgrade-native` 和 `test:windows-installer-native`，说明见 [升级修复记录](WINDOWS_UPGRADE_REPAIR_20261022.zh-CN.md)。

正式构建入口为 `npm run build:release-package`，默认不启用 QA feature，生产能力清单仅含
主窗口与截图辅助窗口；`build:test-package` 保留为独立 F12 测试入口，测试安装包不能改名发布。
发布审计同时排除私有 Skill、内部备份/维护文档、调试配置与 source map；Skill 仅在用户目录维护，
其私有属性不改变应用授权协议。根目录 `changelog.md` 只维护用户说明；源码路径、门禁结果与
打包记录放维护报告，整理前的完整日志保存在 Git 忽略的本地备份中。

`scripts/lib/source-inventory.mjs` 从工作区清单枚举实际存在的源码，包含未提交的新文件，
跳过已删除文件和 Git 忽略的生成物。安全检查不能只读取 Git 索引，否则会遗漏新代码，
并在历史字体删除后因读取不存在的文件而中断。

构建后运行 `npm run test:release-artifacts`；完整 `test:release` 已在末尾接入此检查。
干净依赖验证使用当前源码和锁文件的隔离快照，不沿用旧 `node_modules` 或 `dist`。
Tauri 原生测试的 `generate_context!` 也会读取前端产物，发布测试入口先构建再执行原生测试。
JS API/插件必须与 Rust crate 兼容并经过实际生产编译；不能绕过版本检查。
全新依赖安装、共享 Rust 编译缓存与全新 Windows 安装验收分别记录，不互相代替。
检查生产 DevTools 配置、静态资源重复、旧字体/解码器残留、开发演示数据、调试文件、
PDF.js 资源版本路径及原生依赖完整性，报告写入 `tmp/v3-release-artifact-audit.json`。
依赖名称引用仅用于发现候选项，不足以证明可删除；兼容转发、字体授权和原生库需追踪实际消费者。

清理素材前须追踪 CSS `url()`、静态模板、运行时拼接路径、默认背景、懒加载页面及
README/帮助文档中的引用；没有 JavaScript import 不代表素材无用。发现本地缺失时先核对
Git 原件和消费者，不把未确认来源的删除归因于用户。默认背景、蜘蛛及捐赠素材由产物
审计核对源文件非空、构建文件存在且字节一致；涉及素材时还需验证图片解码和双主题实际页面。

AI 文档与表格的开发演示常量保留供开发预览和测试使用，纯初始化标注允许构建器剔除生产未使用数据。
提词器的 QA 标志读取保留，由原生 `qa-devtools` feature 控制启用；正式配置不注入该标志或 F12 钩子。
双主题页面过渡回归可设置 `TOOLKNIT_TEST_THEME=light` 或 `dark`，截图按主题分别保存。

## 首页启动遮罩

`index.html` 在首屏绘制前读取已有主题，并提供不依赖字体或图标库的全屏圆环加载器。
白天白底黑环，深色黑底浅色环；屏幕取色窗口不参与。`app/startup-runtime.js` 负责等待
`fontSettingsRuntime.ready`、`backgroundRuntime.whenHomeReady()`、CSS 字体和可见首页图片解码，
再经两帧布局稳定后按共享页面过渡的 `DEFAULT_REVEAL_MS`（350ms）淡出。
更新检查、AI 服务和工具依赖下载不纳入启动等待。加载时首页 inert，退出后释放输入监听和定时器。

新增 DOM ID `appStartupMask`、根节点 `data-tk-startup` 状态和中英文 `app.loading` 文案；
不新增持久化配置、native command 或 CLI/MCP 协议。入口脚本未能执行时，内联 15 秒 watchdog
负责解除遮罩；运行时接管后清除该 watchdog，并以 12 秒资源等待上限防止字体/原生请求卡死。
这是异常兜底上限，不是固定启动延时。启动遮罩不复用页面导航的活动 DOM，不会在返回首页时重播。

验证入口：`npm run test:startup`、`npm run test:startup-browser`、`npm run test:theme`。
浏览器专项实际延迟入口脚本、字体和壁纸，检查第一帧覆盖、居中、渐隐中间帧、字体失败、
低高度/窄窗口、减少动画设置、键盘锁定与释放、返回首页和缓存重载；结果在 `tmp/startup-browser/`。

## 首页弹框、设置导航与 Windows 自启动

- 一键记录模式由 `app/recording-mode-state.js` 统一组合自启动、剪贴板与截图历史，平台 adapter 读取原生真实状态，不新增一套独立“模式已开”偏好。先保存原设置快照，再串行修改、核验；失败回滚，关闭恢复快照，跨重启保留。独立入口变更通过原生事件重新读取状态；UI 事务忙碌时保护相关设置操作。浏览器禁用原生模式开关。
- 首页记录提示归 `.app`，共享 modal 锁定其输入；会话关闭与永久关闭分开，设置页始终保留开关。跨容器使用开关类名时检查计算尺寸与伪元素，原设置页选择器并不自动适用于首页。验证入口为 `npm run test:recording-mode` 和构建后 `node scripts/test-recording-mode-browser.mjs`；浏览器桥接只验证交互与状态契约，实际系统登录/重启需桌面验收。
- 首页定制弹框复用 `createModalSession` 与现有成功弹框布局；说明性长文不要套用结果摘要的两行截断类。关闭应恢复背景原先的交互状态与触发按钮焦点，不能用 `.visible` 推断首页是否可交互。新增页面分别检查白天/深色配色、图标文字间距和完整说明。
- 首页网站 CTA 复用 `prepareWebButton`，外链统一注册在 `external-links-runtime.js`；不要复制动画或平台 opener。图标变换要覆盖反复悬停及减少动态效果。
- 密钥页复用 `toolTopbarMarkup`；从设置进入后，返回、Escape 和导航设置按钮统一退出密钥页并恢复设置。异步读取和延迟关闭使用 revision 防止跨会话写回，关闭后清空密码输入。
- Windows 自启动状态只以原生命令为准，不维护独立 localStorage 偏好。`autostart.rs` 只操作 HKCU Run 的 `ToolKnitDesktop` 值；路径必须是当前 exe，参数为 `--autostart`。设置与托盘状态同步，原生失败可见反馈，浏览器禁用开关。
- 共享设置开关样式同时识别 `.active` 与 `aria-pressed="true"`；新开关沿用语义状态，不复制视觉状态逻辑。验证真实状态之外也要检查双主题滑块位置，不能只验证 Toast 或属性值。
- 支持作者页复用 `createModalSession`，打开时以当前背景页的计算层级提升自身层级，关闭后还原；背景页暂时不可交互，返回与 Escape 恢复背景及触发按钮焦点。共享导航传入当前 overlay，不能固定假设背景是首页。
- 首页工具分批显示由 `home-explorer-runtime.js` 维护，复用 settings controller 读取 `toolknit_home_lazy_load`（默认开启、每批 12 项）；关闭显示全部卡片，不改变 feature 模块按需加载。`homeLazyLoadToggle` / `homeLazyLoadStatus` 是新增设置契约，需覆盖刷新、筛选、搜索和语言切换。
- 首页网页图标复用 `.tk-nav-morph`，文字子元素样式须排除图标容器，保持双 SVG 网格重叠。检查最终计算样式和反复悬停后的居中，避免页面 CSS 覆盖共享布局。
- 自启动只改变应用启动方式，不独立开启剪贴板记录。剪贴板工具页与托盘复用原生 start/stop：开启监控同时保存启动恢复，关闭则取消恢复；设置弹框不再提供第二个恢复开关。保留旧配置字段兼容存储，其他设置保存不得覆盖实时监控的恢复状态；窗口隐藏不应停止用户已开启的后台记录。
- 删除旧模板前核对首页入口、懒加载注册、内部/全局调用和素材消费者；只删除已经确认无消费者的模板及绑定，不连带删除真实工具、兼容转发或图片。

验证：`node scripts/test-app-runtimes.mjs`、构建后 `node scripts/test-home-settings-browser.mjs`、
`node scripts/test-tool-page-chrome-browser.mjs` 与原生 `autostart` 测试。浏览器可用
`TOOLKNIT_TEST_BROWSER` 指定 Edge；实际登录/重启与托盘操作需桌面环境验证，不能以浏览器 mock 代替。

## 新增工具的标准结构

每个工具必须放在 `src/features/<tool-id>/`，至少包含：

```text
tool.js          懒加载入口和依赖注入
template.js      工具页面模板或模板导出
controller.js    DOM、交互、异步流程和生命周期组合
core.js          纯计算、解析和校验，不依赖 DOM/Tauri
<tool>.css       工具专属样式
```

简单工具可以合并文件，但必须保持下面的依赖方向和可测试边界，不得把新工具逻辑追加到 `src/application-runtime.js`。

当前 V3.0 基线：桌面工具 65 项、12 个分类；Tauri command 133 个实现、
132 个唯一名称；CLI/MCP 能力 46 项；`src/application-runtime.js` 为 1,975
行；native runtime 共 38 个 Rust 文件，最大文件为 1,872 行。行数只是风险
信号，不得为了数字进行无意义拆分；超过 2,000 行的业务文件必须拆分或在
架构报告中记录保留原因。

## 生命周期要求

工具 initializer 必须返回：

```js
{ open(), close(), dispose() }
```

- `open()` 只创建当前会话资源，并重置 transient state。
- `close()` 失效旧异步请求、停止任务、撤销 object URL 并隐藏 overlay。
- `dispose()` 额外移除工具生命周期 listener，并保证幂等。
- 所有事件和定时器优先通过 `createLifecycleScope()` 注册。
- Tauri `listen()` 返回的 unlisten 必须注册到 lifecycle scope。
- 动态 import 完成后必须检查工具实例仍然有效，禁止旧工具结果写入新工具。

## 平台边界

- 浏览器/Tauri 判断和 `invoke`、`listen`、`convertFileSrc` 统一经过 `src/platform/tauri-runtime.js` 或注入 adapter。
- 工具不得直接读取 Tauri 内部全局，不得在 feature 中复制路径、URL、下载大小或密钥校验。
- 文件输出必须使用 `output-runtime.js` 或 feature 注入的 `getOutputDir`，禁止静默覆盖已有文件。
- 外部 URL 只允许经白名单校验的 HTTP(S) 地址，禁止携带用户名、密码或控制字符。

## 模板与安全渲染

- 固定模板可使用 trusted template registry 挂载。
- 用户文件名、路径、模型返回文本和网络内容必须使用 `textContent` 或 `escapeHtml`。
- 只有经过严格校验的固定 HTML 才允许 `innerHTML`，并应在契约测试中说明来源。
- 新增 DOM ID、`data-tool`、事件名、storage key 或 Tauri command 前，先更新对应契约测试和架构报告。

## 样式复用

硬件工具与剪贴板历史共用 `src/styles/components/hardware-workbench.css` 和
`hardware-workbench-light.css`，原 `features/hardware-inspector/` 样式路径保留 import
兼容入口。剪贴板的时间线与详情布局归其 feature CSS，导航不另建一套。
后台监控是应用级资源，工具页关闭只清理前端会话；退出软件异步收尾，不能在 UI 线程
join 可能更新托盘的工作线程。完整契约与测试边界见 `CLIPBOARD_HISTORY.zh-CN.md`。

- 通用按钮、弹层、导航、进度、窗口控制放在 `src/styles/components/`。
- 页面布局放在 `src/styles/pages/`；工具专属状态和控件放在 feature CSS。
- 不把工具样式重新塞回全局入口，不通过新增无理由 `!important` 或竞争性 `z-index` 修补布局。
- 关闭态 overlay 必须脱离布局，返回按钮、分类标签和窗口圆角要复用既有组件规则。

AI 文档和 AI 表格的白天聊天控件统一使用 `src/styles/components/ai-workbench-light.css`，
由两个工具的懒加载入口在基础样式之后引入。气泡、示例按钮、输入、发送和主次按钮在此维护；
文档编辑器与表格单元格、图表外围样式仍归各自 feature 的 light CSS。
图表画布及文件导出保留独立内容配色；宽表格和图表各自承担横向滚动，不能撑宽整个预览区。
改动共享主题后运行 `scripts/test-ai-document-theme-browser.mjs` 和
`scripts/test-ai-table-theme-browser.mjs`，覆盖两种主题、窗口尺寸、编辑与导出状态。

开发者工具的五合一工作台与 Hash & Crypto 共用
`src/styles/components/developer-workbench-light.css`，由各自懒加载入口引入。
返回按钮通过 `tool-page-v2-light` 复用公共主题，其静态轮廓和悬停描边由共享导航维护，不能只覆盖普通 `border-color`。
工作区外壳、输入输出、模块导航和按钮状态在此维护；JWT/UUID 与文件加密、密钥、警告、日志
分别归 `developer-toolbox` 和 `crypto` 的 feature CSS。高度与滚动修复适用于两种主题，
浅色规则仅在 `html[data-theme="light"]` 下生效。回归需覆盖五种工具模式、17 个算法模块、
AES 文本/文件切换和 File Hash 条件密钥，并检查低高度及窄窗口的操作栏与日志分隔。

PPT 图片提取、转 PDF、转图片、文本提取与压缩共用
`src/styles/components/ppt-workbench.css` 的 `ppt-file-workspace/upload/panel/cta` 布局。
上传栏、文件名、内容区固定为三行；空状态填满内容行，小窗口由工作区或外层正文滚动。
白天模式的白色空状态背景通过 `ppt-tools-light.css` 中的 `--ppt-empty-background` 统一设置，
不要再为单个空状态添加 ID 覆盖。各工具保留既有 DOM ID、选择文件、处理和导出契约。
修改后运行 `scripts/test-ppt-file-layout-browser.mjs`，检查深浅主题、中英文、窄窗口和上传后状态；
转图片交接与拼图导出另由 `scripts/test-ppt-render-workspace-browser.mjs` 验证。

## 性能与主题边界

- 以 60Hz 设备稳定交互为目标，以 16.7ms 帧预算检查长任务；高刷新率设备不得被代码锁定为 60FPS。
- 页面隐藏或工具切换时暂停背景 RAF；连续动画使用共享 animation policy，并合理限制 DPR。
- 滚动、resize、wheel 和 pointermove 使用单帧合并；优先 transform/opacity，避免读写布局交错。
- PDF.js、Canvas、媒体、Object URL、Worker 和预览任务必须在 close/dispose 释放。
- 颜色、间距、阴影、圆角和背景使用 tokens，为后续白天模式预留变量；维护任务不直接实现白天模式。

## 测试门槛

窗口表层改动必须增加实际四角像素回归，不能只检查圆角设置值与原生调用。
运行 `node scripts/test-window-radius-browser.mjs`；根因、范围和隔离原生验证方法见
[窗口圆角刷新与滚动修复](WINDOW_RADIUS_REPAIR.zh-CN.md)。先完成构建，再执行浏览器检查，
避免并发构建清空测试正在读取的 dist。

Office 托管依赖需保留 MSI 中的 `System64` 来源和部署到 `program` 的 app-local VC++ DLL。
不得把开发机预装的微软运行库视为跨机器验证证据。安装、重试和错误码专项见
[LibreOffice 运行时安装修复](LIBREOFFICE_RUNTIME_REPAIR.zh-CN.md)。

首页双主题共用的织网视觉由 `src/app/home-weaving.js`、`src/app/assets/home-weaving.svg`
和 `src/styles/themes/home-weaving-light.css` 管理，生命周期归 `home-controller`。
SVG 以仓库内可信静态模板挂载；动画离开视口、隐藏文档或被工具/弹层覆盖时暂停，
低功耗及减少动态效果模式显示静态完整图案。胶囊按钮复用 `data-home-link="website"`
及现有中英文文案；蜘蛛双主题均为石墨色主体，深色使用银灰腿部与边缘，白天使用深灰线条。
蛛网使用细线层次，文字周围用 SVG 透明遮罩渐隐，不绘制背景色块或粗描边。
`homeWeavingTypeClearance` / `homeWeavingTypeFade` 是内联 SVG 专用 ID，只挂载一份，主题切换不重新挂载。
旧截图模块及其资源已移除，导航栏入口保留。运行
`node scripts/test-home-weaving-browser.mjs` 验证构建产物的主题、导航、动画及窄窗口布局。

`src/app/custom-background-default.js` 管理首次安装的内置山景壁纸。
启动时仅在壁纸与 V3 主题偏好均不存在时写入既有 `toolknit.customBackground.v1`，
并写入一次性标记 `toolknit.customBackground.defaultInitialized.v1`；已有偏好不被覆盖。
首次主题仍是白天，切到深色才加载图片。用户清除后不再次初始化；设置页继续负责预览、更换、清除。
`public/assets/backgrounds/default-dark-mountain.jpg` 随包发布，背景运行时仅额外允许该固定本地资源路径，
不放开其他相对路径或外部 URL。新旧配置、清除持久化和主题切换运行 `npm run test:theme`。

每个新工具至少需要：

独立辅助 WebView 复用主窗口组件时需检查实际挂载点、样式和可见层级；例如共享 Toast 仍需页面拥有 `toastContainer`，不能仅凭创建 manager 判断反馈可见。多窗口事件明确消费角色，配置桥接不携带密钥。模拟原生返回按序列化语义复制对象，AI 失败回归检查可见提示、遮罩关闭、控件恢复和迟到结果隔离。截图绘图测试避开 Toast 遮挡，用纹理夹具验证马赛克与撤销，视觉截图等待过渡完成；具体入口见 [快速截图维护说明](QUICK_SCREENSHOT.zh-CN.md)。

OCR 识别、排版和模型转录分别验收，去掉中文空格不代表纠正错字；缩放预处理后的行/词坐标必须映射回原图。截图翻译先检查本地中英文模型；有 AI 配置及密钥才复用共享图像校正，否则直接 OCR，然后交给本地翻译。识别失败显示原因，用户确认后才能用原 OCR；不能静默回退。校正截断先增预算再拆批，并限制总时间/请求次数；回归缓存与替换、标注保护、完整文本兜底、实时复制和跨 WebView 目标语言。真实本地引擎与 OCR 单独计时，不用模拟响应承诺外部 AI 全程延迟。

可选模型安装复用设置与依赖弹层，原生域持有固定来源/大小/哈希、staging、验证试译后发布、取消与互斥、旧版本回滚；引擎/模型不随主包分发。进程仅本地回环鉴权，应用拥有启动、空闲释放与退出清理，详见[截图维护说明](QUICK_SCREENSHOT.zh-CN.md)。新增管理弹层复用样式须检查白天/深色的实际按钮尺寸、`hidden` 可见性及按钮禁用/隐藏后的焦点；CSS 成功加载不代表状态正确。

1. `core` 纯逻辑测试。
2. tool contract 测试：模板、入口、生命周期和平台注入。
3. 失败、取消、重复打开/关闭和异步过期场景测试。
4. `npm run test:architecture`、`npm run build` 和 `git diff --check`。
5. 影响共享边界时追加 `npm run test:security-release`、CLI/MCP 或 Rust 对应测试。

浏览器回归至少检查：首次打开、重复打开、返回、Escape、语言切换、控制台、焦点、残留遮罩和输出目录按钮。

## Rust 维护

- `lib.rs` 只做 builder、插件、状态和 command 汇总。
- 新 command 放入对应 `native_runtime`/`commands` 领域，保留原名称、参数和返回结构。
- 路径、URL、密钥、下载大小和输出发布逻辑必须复用现有 helper，禁止复制一份“相似校验”。
- 跨领域 helper 通过明确的 `pub(super)` 或平台模块暴露；避免把 Tauri 状态泄漏到纯 core 逻辑。
- 修改 native command 后必须跑对应 Rust 单测，并重新核对 133 实现、132 唯一名称和前端 invoke 清单。大文件清理安全策略与扫描会话契约见 `AI_LARGE_FILE_CLEANUP.zh-CN.md`。

PDF 压缩的保结构/图像化、目标字节、写入和共享核心边界见 `PDF_COMPRESSION_V3.zh-CN.md`。
不允许用未达标输出、原文件副本或估计大小代替严格目标验证。

## CLI / MCP 维护

- CLI 只能依赖明确导出的 core/runtime，不得导入页面或 Tauri 模块。
- V3.2 当前 77 项能力，桌面覆盖 60 项支持、6 项部分支持、7 项保留桌面。`tool-definitions.mjs` 与 `desktop-coverage.mjs` 是目录来源；`sync-cli-catalog.mjs --check` 核对全部桌面 ID、工具名和公开清单，不能只修改 README 数字。
- 保持 8 MiB 消息/响应限制、最多 4 个 MCP 调用、2 个重计算 Worker、重复 request id 拒绝和结构化错误；取消、EOF、断流和背压统一释放任务，超大行剩余部分不能作为新请求执行。
- 新增能力同时补 schema、CLI/MCP 调度、help/能力发现、staging、资源/许可、真实输出和失败路径验证。未知参数不默默忽略，错误不回显正文或密钥。
- `test:cli-clean-worktree` 现为兼容名称：复制当前 tracked 与非忽略 untracked 源码到隔离目录，准备/打包并安装到独立消费项目；检查实际依赖树、audit、全部纯模块加载、CLI/MCP 真正转换。禁止用旧 HEAD 或开发仓库 node_modules 代替待发布代码。
- CLI Node 最低 22.13.0，发布前在该版本和当前版本实跑。`prepare-cli-package.cjs` 安装 CLI shrinkwrap，捆绑 ExcelJS 及锁定依赖；库自身 overrides 不会传递给消费项目，UUID 修正必须在实际安装包内验证。NOTICE 保留第三方许可和唯一依赖元数据补丁说明。
- `test:cli-v32` 包含官方 MCP SDK stdio 客户端互操作；AI 使用本地模拟服务的验证只能证明协议、校验、取消和错误链路，不能写成远端模型效果验收。
- `test:cli-ai-live -- --live` 是需明确授权的远端付费验收，默认跳过，使用合成资料与环境变量密钥。覆盖十类 AI 入口、四种 PPT 文本整理以及生成工程的编辑、撤销和渲染；不纳入自动发布门禁。`test-cli-ai-failure.mjs` 则离线验证超时、取消不落盘、配置错误与目标已存在时不调用 AI。
- Office 转换的临时 profile 不放进用户的深层输出目录；使用短工作目录、中性输入名称，并验证真实产物与页数。Windows MCP 宿主缺少 `APPDATA` 时模型发现使用当前用户 Roaming 目录兜底，不能因此要求重复下载。
- 转写复用桌面模型，但 whisper.cpp 的 Windows 参数需映射到 ASCII 路径；独立临时目录限制当前用户 ACL，结果回到明确输出目录。真实验证使用已有模型与合成语音，不自动下载大模型。模型下载的 `.cli.part` 与桌面 `.part` 分离。
- 注册表的 `(arguments, options)` 不能直接映射到只接收 `(options)` 的硬件函数；必须通过适配器透传 signal。旧 PDF 操作也需把 signal 传至最终原子发布；进度测试检查起点/终点和单调性，不固定为只有两个通知。

## 安全与生产门禁

- 用户文件名、路径、网络内容和模型返回值使用 `textContent` 或安全转义；禁止未经审计的动态 HTML。
- 外部 URL、文件路径、输出目录、下载大小和密钥必须复用现有校验 helper；密钥只能进入受保护存储，不得写日志。
- 生产构建必须关闭 F12/DevTools、调试面板和调试日志，并检查未捕获 Promise 与敏感字符串。
- 大 chunk 和 crypto externalization 警告可暂不阻断，但必须记录依赖来源、启动影响和后续计划，且不得新增同类 warning。

## 提交与发布

- 版本检查、强制更新弹框与许可变更按 [版本与许可维护说明](UPDATE_AND_LICENSE_MAINTENANCE.zh-CN.md) 核对；准备好官网安装包后再发布正式标签，保留既有 Apache-2.0 和第三方授权。

- 每个独立阶段使用一个语义明确的本地 Git checkpoint。
- 提交前检查 `git status`、`git diff --check`、测试结果和生成物是否被忽略。
- V3.0 架构阶段不得自动推送 GitHub、发布 npm、创建 Release 或修改版本号；这些动作必须由用户单独确认。
- 大 chunk 和浏览器 crypto externalization 警告目前非阻断，但不得新增同类 warning；来源和后续优化方向必须记录在架构进度文档。

## PDF 工作台白天主题基准（2026-09-12）

- PDF 裁剪是用户已验收的预览型 PDF 工作台标杆。PDF 加页码沿用其配色和控件状态，保留自己的三栏布局、位置九宫格、样式示例和颜色设置。
- `src/styles/themes/pdf-workbench-light.css` 是裁剪、加页码、编辑器共用的白天样式入口，负责面板、预览底色、主按钮、导出底栏、自定义下拉菜单、禁用状态和处理/成功弹框。各工具只接入实际存在的控件，修改共同视觉必须在这里维护，不能再复制到单页覆盖文件。
- `pdf-crop-light.css` 只负责裁剪特有控件；`pdf-page-number-light.css` 负责页码队列、位置/样式选择、滑块、颜色输入等特有控件；`pdf-editor-light.css` 负责页面缩略图状态、对象工具条、选中手柄、形状属性和文字编辑弹框。专属布局尺寸仍由各 feature CSS 管理。公共样式明确限定这三个工具，避免影响其他工具。
- 禁用状态优先于选中和悬停：背景 `#e2e3e6`、文字和图标 `#92959b`，不叠加整体透明度。透明的原生 radio 保持隐藏，只给可见选项面板着色；颜色和滑块控件需保留自身语义。
- 界面主题不得覆盖 `pdf-page-number-live-text` / `pdf-page-number-live-background` 的实际页码样式，也不得修改颜色输入的值或导出设置。
- 编辑器的透明文字命中层、原文覆盖层、插入文字和图片、SVG 形状填充/描边属于文档内容，不得通过主题统一改色；主题仅改变对象选择轮廓和手柄。保持浮层的 `hidden` / `visible` / `inert` 生命周期，不通过主题规则强制显示浮层。
- 修改公共主题后，必须同时回归三页的空状态、上传、禁用/选中/悬停、下拉、低高度滚动、深色模式和输出；编辑器额外检查文字/形状编辑、颜色隔离、撤销重做、旋转和关闭重开。浏览器检查入口为 `node scripts/test-pdf-workbench-theme-browser.mjs`，使用已构建的 `dist`，测试产物写入忽略目录 `tmp/pdf-workbench-theme/`。

## PDF 专用工作台首个模板：拆分（2026-09-12）

- `src/shared/pdf-workbench.js` 只管理共享导航、三栏视图、当前页/勾选状态、缩放、可见缩略图队列和画布清理。沿用编辑器 CSS 类与公共主题，不导入编辑器 feature 或编辑业务；工具通过页面模型、加载回调、文案 key 和右侧 actions 接入。
- `features/pdf-split/preview.js` 拥有 PDF.js 文档和工作台 modal 会话。回到上传页保留输入文件，关闭工作台释放画布与文档；重开重新加载，旧异步结果不得覆盖新会话。
- 工作台动态导航由 `createPdfWorkbench` 在最终挂载后执行 `prepareToolPageChrome`；兄弟 Workspace 不在 lazy registry 的主 overlay 准备范围内。文字刷新定位 `data-i18n` 标签，不覆盖 `.tk-nav-morph`，返回按钮的 title/aria-label 随语言同步。双主题几何、帮助/反馈/设置返回与既有导出验证见 [PDF 工作台导航维护记录](PDF_WORKBENCH_NAVIGATION.zh-CN.md)。
- `workbench-export.js` 构建当前页 PDF、所选页合成 PDF、独立页 ZIP；`export-runtime.js` / `export-worker.js` 负责任务隔离、取消、五分钟超时及 Worker 销毁；`exporter.js` 仍走原有输出目录与 `write_unique_file_bytes` 发布结果。CLI/MCP 的 `splitPdfPages` 语义不变。
- 当前页导出独立于勾选状态；全部页按钮在选择子集时改名为“导出所选页”。ZIP 同样以勾选页为范围，条目带顺序前缀以避免不同源文件的同名页覆盖。没有勾选时仅禁用合成/ZIP，当前预览页仍可导出。
- 新增 DOM 契约：`pdfSplitWorkbenchActions`、`pdfSplitDownloadCurrentBtn`、`pdfSplitDownloadZipBtn`、`pdfSplitProcessCancel`；旧 Workspace/PageStrip/PageStage、返回和主导出 ID 保留。没有新增原生命令、storage 或 CLI/MCP 参数。
- 测试入口：`npm run test:pdf-split`、`npm run test:pdf-split-tool-contract`、`node scripts/test-pdf-split-workbench-browser.mjs`。浏览器产物在忽略目录 `tmp/pdf-split-workbench/`。仅拆分迁移，旋转、转图像、合并须逐个验收后再接入，不自动批量改动。

### V3.2 范围选择（2026-10-22）

- 用户确认载入及重开工作台时默认空选；全选仍可手动触发。`selection.js` 按缩略图全局编号验证完整输入后才修改选择，支持单页、闭区间、重叠去重；错误输入不改变任何已选页。
- `range-dialog.js` 使用 `createModalSession` 暂停兄弟工作台，选中后保持打开、清空输入并恢复输入焦点；完成、关闭、遮罩和 Escape 返回触发按钮。父工作台关闭、开始导出及 dispose 时先关闭子弹框，监听归属 lifecycle scope。
- 输入说明、可选范围、错误与成功反馈均位于 `home.pdfSplit` 双语字典；语言切换有既有过渡，浏览器测试等待译文实际更新。独立弹框显式提供主题 token，输入沿用共享内收底线，不更改共享 modal/workbench 或输入样式。
- 新增 DOM ID：`pdfSplitSelectionTitle`、`pdfSplitRangeBtn`、`pdfSplitRangeDialog`、`pdfSplitRangeTitle`、`pdfSplitRangeInput`、`pdfSplitRangeLimit`、`pdfSplitRangeHelp`、`pdfSplitRangeError`。原有选择、当前页和导出 ID 保留；原生、CLI/MCP、事件和存储契约不变。
- `test-pdf-split-selection.mjs` 随 `test:pdf-split` 运行；契约检查同时验证中英文 key 的实际归属。浏览器以两个源文件共 26 页检验 `1-10` + `15-20` 的真实 16 页输出，覆盖跨文件范围、手动取消后的累加、空选禁用、Tab/Escape/焦点、双主题三种弹框尺寸、中英文、取消及重开；页面与控制台错误均为零。
- 同日用户授权测试打包：`npm run build:test-package -- --bundles nsis` 成功，产物 `src-tauri/target/release/bundle/nsis/toolknit-desktop_3.2.0_x64-F12-test-20261022-232503-setup.exe`，56,861,259 字节（54.23 MiB），SHA-256 `B6647D902420985E1DCA56CA52785079DF1EEC707BFBD31A023C27FE8D93C794`，旁置校验文件。程序和安装器版本均为 3.2.0，程序为 x64，无签名，测试配置开启主窗 F12，生产配置保持关闭；版本、QA、许可与产物审计通过，私有 Skill 未进入资源。安装后交互待用户验收；未自动安装或发布。

## PPT 图片预览与压缩等级控件（2026-09-18）

- `features/ppt-images/controller.js` 分别管理素材勾选与缩略图按钮。保留 `.ppt-images-check` 和原有导出选择语义；圆形勾选只改变呈现，白天黑底白勾、深色白底黑勾。点击缩略图不改变勾选集合。
- 图片放大复用已加载的预览 Object URL，使用 `createModalSession` 管理背景 inert、Tab、Escape 与返回焦点。新增 `pptImagesPreviewOverlay`、`pptImagesPreviewImage`、`pptImagesPreviewTitle`、`pptImagesPreviewMeta`、`pptImagesPreviewClose`；对话框为 840×600 上限的固定尺寸，小窗口按视口收缩，图片使用 contain，关闭按钮位于图片下方。关闭移除大图 src；重新上传、重绘列表和退出时销毁缩略图监听并释放 URL。
- `features/ppt-workflows/compress-controller.js` 复用 `enhanceToolSelect`。保留 `pptCompressLevel`、low/medium/high 与 change 契约，原生 select 作为隐藏状态源；分析期间禁用，重置和语言切换后刷新，关闭工具收起菜单，dispose 销毁组件。Escape 优先关闭菜单。
- 样式留在对应 feature，不更改共享下拉、共享弹层、压缩算法、原生命令、storage 或 CLI/MCP。中英文新增键位于 `home.pptImagesPage`。
- 回归入口：`test:ppt-images-tool-contract`、`test:ppt-workflows-tool-contract`、`test:ppt-image-extract`、`test:ppt-compress`。构建后运行 `node scripts/test-ppt-image-controls-browser.mjs`，验证两种主题、中英文、选择集合、不同纵横比预览、小窗口、关闭焦点、URL 清理及真实压缩档位重算；报告和截图输出到忽略目录 `tmp/ppt-image-controls/`。

## PPT AI 表单白天主题（2026-09-18）

- 大纲与草稿的预设标题、说明、图标、悬停和选中配色统一归属 `styles/themes/ppt-tools-light.css`，不再各自维护重复规则。选中态使用 `setPptAiPresetActive` 实际设置的 `.active`；说明文字显式使用 muted token，避免继承历史白色。
- 两页 `.ppt-outline-field` 中的控件聚焦仅将现有边框改为黑色，移除叠加阴影与偏移 outline，尺寸和间距保持不变；按钮的键盘焦点提示保留。
- 两页空状态的提示标签由 `ppt-workbench.css` 统一放入底部行，图标和说明保持居中；白天主题额外为现有 kicker 保留一行。底部行按内容高度分配空间，英文换行不覆盖说明，较矮窗口可滚动查看，原有 DOM 与隐藏状态不变。
- 大纲页空状态提示使用模板真实类名 `.ppt-outline-v2-empty-hints`。其窄窗口布局由 `ppt-workflows.css` 按内容高度排列表单与预览，解除桌面裁切 containment，防止预览覆盖输入框。深色配色、AI 请求与 DOM 契约不变。
- 本轮双主题、中英文、1400×920 与 720×480 共 16 组浏览器检查通过，覆盖预设填充/选中、鼠标和 Tab 聚焦、返回/重开/Escape，截图与报告位于忽略目录 `tmp/ppt-ai-theme/`。focused、architecture、build、security、CLI 与 Rust 检查通过；完整 release 仍因已有 `common.remove` 中文翻译缺失停止。

## 新功能提交前命令

### PDF 旋转工作台接入（2026-09-12）

- 旋转与拆分共用 `shared/pdf-workbench.js`、工具导航与两套主题。新增可选 `getRotation(page)` 和 `refreshPages(indices)`；默认旋转为零，现有拆分调用不变。主预览叠加 PDF 原始方向，缩略图复用原像素进行变换，不重新渲染整份文档。
- `features/pdf-rotate/preview.js` 拥有原始文档、每页相对旋转、勾选与操作范围。当前页、所选页、全部页决定下次旋转的范围；切换范围本身不修改页面。恢复原方向将相对旋转归零，保留源 PDF 自带方向。
- 导出当前页不受勾选影响；全部/所选 PDF 与独立页 ZIP 按勾选范围输出。旋转核心仍为 `pdf-rotate-core.js`；ZIP 复用已旋转文档拆页，避免每页重新打开完整源文件。
- `shared/pdf-export-job.js` 统一拆分和旋转 Worker 的取消、五分钟超时、消息失败与销毁；各 feature 继续拥有自己的 Worker 工厂、输入校验与文件格式逻辑。
- 保留旋转 Workspace、PageStrip、PageStage、RotateAllBtn、DownloadAllBtn 等旧 ID；新增 `data-rotate-actions/scope/turn/select/export/cancel/angle/label` 私有 UI 契约，契约测试已覆盖。未改原生命令、storage、CLI/MCP 或版本。
- 测试入口：`npm run test:pdf-rotate`、`npm run test:pdf-rotate-tool-contract`、`node scripts/test-pdf-rotate-workbench-browser.mjs`；截图与结果在忽略目录 `tmp/pdf-rotate-workbench/`。转图像和合并仍等待单独迁移与验收。

至少执行 `npm run test:architecture`、`npm run build` 和 `git diff --check`。
涉及共享边界、Rust、CLI、MCP 或安全逻辑时，追加
`npm run test:release`、`npm run test:security-release`、`npm run test:cli`
和 `cargo test --manifest-path src-tauri/Cargo.toml`，并完成首次打开、关闭、
重开、Escape、语言切换、控制台和资源释放回归。
