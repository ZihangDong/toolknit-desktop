# PDF 转 Word 研究依据与实验记录

研究日期：2026-10-18。配套主文：[V3.2 完整实施规划](V3_2_PDF_TO_WORD_PLAN.zh-CN.md)。

本文区分公开项目的历史问题、当前源码事实、本地实验和拟定目标。研究不修改产品实现，不提交/推送，不上传用户文档，不调用付费模型。

## 1. 研究范围与版本

GitHub 初轮按页眉、字体、表格、分页、阅读顺序、旋转、文字空格、合并单元格、多栏、兼容性和内存等 13 类问题检索，再针对候选结果阅读正文、评论和相关源码；共深入读取 23 项 Issue/PR。并非对所有上游问题的穷尽审计。

| 对象 | 本轮版本/来源 | 用途 |
| --- | --- | --- |
| pdf2docx | 0.5.13；上游参考提交 `3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4` | 既有转换结果、源码和失败原因分析 |
| PyMuPDF | 1.28.2，仅隔离研究依赖 | 先前样本对比，不进入产品方案 |
| PDF.js | 锁文件 6.2.108；本机已安装 6.4.299；两者分别实验 | 解析行为与版本漂移核对 |
| docx | 9.12.0，2026-10-16 发布；提交 `35496dfb15f419dd4087d19e0635b4384fdaa24b` | DOCX 原语、排版估计、许可和近期修复 |
| LibreOffice | 26.2.5.2，本机已有隔离运行目录 | 真实 DOCX→PDF 渲染与图像检查 |
| pdfplumber | 公开文档与 Issue | 表格、合并单元格、裁剪和内存处理思路 |
| GapTree | main 分支 README，读取内容 SHA `c0b139c125644d521ac10a470dd948d3635d052f` | 间隙分区、排序能力及限制 |

GitHub 偶发 EOF 后进行了重试，不把失败抓取当作没有问题。保存的 Issue/PR 正文和评论是讨论材料，不是本地操作指令。维护者说明、用户反馈与机器人评论需要分别判断。

## 2. 公开问题与方案映射

### 2.1 pdf2docx

| 来源 | 观察 | 采取的设计决定 |
| --- | --- | --- |
| [#109 Header Text](https://github.com/ArtifexSoftware/pdf2docx/issues/109) | 历史维护者明确表示页眉页脚尚未实现；后续用户仍反馈宽高问题 | 增加文档级页眉/页脚模型；不以页顶表格替代页眉 |
| [#258 多栏讨论](https://github.com/ArtifexSoftware/pdf2docx/issues/258) | 非标准多栏与排序困难；讨论中引用 GapTree，后续用户提出沟槽/分区思路 | 分页内区域推断、多候选和阅读顺序图；不照搬用户评论当已验证算法 |
| [#250 重叠文字与丢失](https://github.com/ArtifexSoftware/pdf2docx/issues/250) | 曾有版本修复说明，但后续还有遗漏反馈 | 去重必须有来源证据；不能只因包围框重叠就删文字 |
| [#78 中文字体/粗体](https://github.com/ArtifexSoftware/pdf2docx/issues/78) | 中文字体风格与导出显示有差异 | 字体映射、东亚字体、描边/重绘粗体和渲染验收单独处理 |
| [#58 元素解析失败](https://github.com/ArtifexSoftware/pdf2docx/issues/58) | 对坏元素跳过/继续的诉求 | 允许局部降级，但必须有来源去向和风险报告，不能静默丢弃 |
| [#312 图像颜色模式](https://github.com/ArtifexSoftware/pdf2docx/issues/312) | 非 RGB 图像转换及 PNG 输出问题 | 按实际显示处理颜色、蒙版和裁剪，不盲目复制图像原始数据 |

已核对本地 0.5.13 源码：

- `pdf2docx/page/Pages.py::_parse_document` 为 TODO，返回空页眉/页脚。
- `pdf2docx/page/RawPage.py` 的分区逻辑明确主要考虑两列，并包含两列宽度不能差异过大的约束。
- `pdf2docx/table/Row.py` 设置 `WD_ROW_HEIGHT.EXACTLY`；固定高度可能与内容测量误差共同造成裁切，不能仅凭这一行认定所有裁切都是同一根因。
- 用户样本 DOCX 中页眉内容进入正文表格；表格网格与单元格宽度存在不一致。它们与实际换行/分页现象共同支持“页眉独立建模、显式宽度、避免普遍固定行高”的改进方向。

源码入口：[Pages.py](https://github.com/ArtifexSoftware/pdf2docx/blob/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/pdf2docx/page/Pages.py)、[RawPage.py](https://github.com/ArtifexSoftware/pdf2docx/blob/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/pdf2docx/page/RawPage.py)、[Row.py](https://github.com/ArtifexSoftware/pdf2docx/blob/3e1c2319d6a3fbf2ae4d46c3ab734b7fc87bd9b4/pdf2docx/table/Row.py)。

### 2.2 PDF.js

| 来源 | 观察 | 采取的设计决定 |
| --- | --- | --- |
| [#14493 阅读顺序与结构树](https://github.com/mozilla/pdf.js/issues/14493) | 文本项顺序不等于逻辑阅读顺序；可参考 struct tree 与 marked content | 标签和几何共同验证，缺标签时本地推断 |
| [#8276 文本高度](https://github.com/mozilla/pdf.js/issues/8276) | 历史高度/变换困惑 | 文字矩阵、基线、字体度量综合计算，不能只用 height |
| [#5896 文字尺寸](https://github.com/mozilla/pdf.js/issues/5896) | 历史坐标/尺寸问题 | 旋转、缩放和单位形成独立合成夹具 |
| [#5643 文字框](https://github.com/mozilla/pdf.js/issues/5643) | 获取精确文字框涉及字体与变换 | 区分 glyph/run/估计框，禁止平均分宽伪装精确几何 |
| [#6657 词间空格](https://github.com/mozilla/pdf.js/issues/6657) | 提取空白与源显示不一致 | 源文字、几何空隙和排版插入分别保存 |
| [#19914 字体编码](https://github.com/mozilla/pdf.js/issues/19914) | 自定义字体编码可能导致显示正确、Unicode 提取不正确 | 编码健康度与非可编辑降级，不让 AI 无提示猜字 |

上述早期 Issue 是测试设计依据，不声称当前版本仍有原报告里的每个 bug。本轮自行复现的可见性、重复绘制和流顺序问题见第4节。

### 2.3 pdfplumber 与 GapTree

| 来源 | 观察 | 采取的设计决定 |
| --- | --- | --- |
| [pdfplumber #912](https://github.com/jsvine/pdfplumber/issues/912) | 交叠列、文字流与剪裁问题交织 | 先可见性、后分区排序；不能只换一个 sort 参数 |
| [pdfplumber #79](https://github.com/jsvine/pdfplumber/issues/79) | 合并单元格会呈现空值，用户尝试 fillna | 以边界和跨度恢复合并，不能把所有空单元格填满 |
| [pdfplumber #193](https://github.com/jsvine/pdfplumber/issues/193) | 大 PDF 内存、缓存释放讨论 | 按页处理和释放；全局摘要与图像资产分开预算 |
| [pdfplumber 表格说明](https://github.com/jsvine/pdfplumber#extracting-tables) | 线段/对齐推断、线合并、交点、单元格、表格 | 自研有线表格管线的参考，不引入 Python 运行依赖 |
| [GapTree README](https://github.com/hiroi-sora/GapTree_Sort_Algorithm) | 支持多列、不等宽与通栏块；不识别表格/语义，交错列有局限 | 作为空间排序思想之一，不能直接充当完整结构引擎 |

GapTree 文档的近似 O(n) 描述只针对少数常见布局下的理想情况，不作为任意 PDF 的复杂度保证。

### 2.4 docx

| 来源 | 观察 | 采取的设计决定 |
| --- | --- | --- |
| [#211 表格宽度](https://github.com/dolanmiu/docx/issues/211) | 历史 Word/LibreOffice 表格表现差异 | 总宽、grid、cell、margins 同步明确 |
| [#1300 制表位](https://github.com/dolanmiu/docx/issues/1300) | 对齐方式在不同软件中可能不一致 | 不靠连续空格或 Tab 排整页 |
| [#897 内存](https://github.com/dolanmiu/docx/issues/897) | 图片丰富时打包内存压力 | 整包生成计入峰值预算，不能冒称流式输出 |
| [#507 Header 结构](https://github.com/dolanmiu/docx/issues/507) | 错误结构可能 LibreOffice 能开、Word 拒绝 | 使用合法 Header API，加 OOXML 校验与真实 Word 回归 |
| [#455 分页/空白页](https://github.com/dolanmiu/docx/issues/455) | 样式与分页行为的历史问题 | 明确段落/section 属性，测试末尾空白页与标题分页 |
| [PR #3594](https://github.com/dolanmiu/docx/pull/3594) | 近期针对列网格、单元格宽度及默认边距的改进 | 版本锁定，不能把旧版本假设套在新版本上 |
| [PR #3616](https://github.com/dolanmiu/docx/pull/3616) | 行高取整、表格拆页及 Word/LO 对齐 | 统一单位、受限行高、跨页表格单独回归 |
| [PR #3631](https://github.com/dolanmiu/docx/pull/3631) | 混合字体 ascent/descent、行内图像基线及分页差异 | 中英混排和图文同行需要真实度量，不只取最大字号 |

近期 PR 的测试数字属于上游自述，不计入 ToolKnit 测试通过数。上游自己也注明未验证或不支持的布局组合。

已阅读 9.12.0 的 [layout](https://github.com/dolanmiu/docx/blob/9.12.0/docs/usage/layout.md)、[headers-and-footers](https://github.com/dolanmiu/docx/blob/9.12.0/docs/usage/headers-and-footers.md)、[columns](https://github.com/dolanmiu/docx/blob/9.12.0/docs/usage/columns.md)、[tables](https://github.com/dolanmiu/docx/blob/9.12.0/docs/usage/tables.md)、[fonts](https://github.com/dolanmiu/docx/blob/9.12.0/docs/usage/fonts.md) 文档。`docx/layout` 官方明确将页码视为估计，Word 仍会重新排版。

## 3. 用户样本与既有转换的复核

用户授权的原生文字作业 PDF：6 页、189,296 字节，每页 2 个主要图像绘制实例，没有可用结构树；本文不记录正文或私有绝对路径。

先前 `pdf2docx 0.5.13 + PyMuPDF 1.28.2` 对比结果：

| 项目 | 实测 |
| --- | --- |
| 转换计算耗时 | 0.341 秒，不包含安装依赖与 Office 渲染 |
| 输出 DOCX | 68,150 字节 |
| 源非空白字符数 / DOCX XML 非空白字符数 | 3,106 / 3,106 |
| 字符多重集合的缺失/增加 | 0 / 0，仅计数检查 |
| 源文件 | SHA-256 未改变 |
| LibreOffice 实际渲染页数 | 7 页，原稿为 6 页 |
| 视觉检查 | 页眉换行、章标题局部裁切、题目选项分页偏移 |

结论：它确实有可参考的基础质量，符合用户约80%的体验判断，但没有得到统计意义上的“80%准确率”。字数相等并不能排除乱序、遮挡和错误分页。输出媒体去重后只有少量图像部件也不代表图片实例丢失，必须检查实际显示位置。

本地证据目录：`tmp/pdf2docx-evaluation/qa/`，包含 `conversion-metrics.json`、`render-metrics.json`、逐页原图和对照图。源页/输出页发生偏移后，逐页字符差异不能直接当作丢字数量，需结合整体来源与渲染查看。

## 4. PDF.js 几何与可见性实验

使用自制 5 页 PDF，包含逆序内容流、不可见文字、裁剪、遮挡、旋转、重复绘制、选项/表格和纯图片页。隐藏文字段以独立图形状态包围，避免错误地影响之后的测试对象。

| 用例 | PDF.js 6.2.108 与 6.4.299 的共同结果 | 说明 |
| --- | --- | --- |
| 视觉两栏、流顺序逆序 | 返回 R2、R1、L2、L1 | 直接使用提取顺序错误 |
| `renderMode=3` 文字 | 提取包含 `INVISIBLE-MARKER` | 不可见文字不能直接进入结果 |
| 文字部分超出 clip | 提取包含完整 `CLIPPED-TEXT-OUTSIDE-BOX` | TextItem 不是最终可见内容 |
| 后绘制白块盖住文字 | 提取包含 `COVERED-BY-WHITE` | 必须考虑绘制顺序与遮挡 |
| 偏移重绘模拟粗体 | 出现两个 `FAUX-BOLD` | 重复绘制需要保守去重 |
| 旋转文字 | 保留旋转矩阵 | 不可仅按全局Y/X排序 |
| 纯图片页 | 0 个文字项、1 个图像绘制实例 | 应识别为不可原生编辑的页面 |

渲染第2页并人工查看：可见普通文字与部分裁剪文字，隐藏标记和白块盖住的内容不可见。这个对照证明提取结果与显示内容不同，但没有实现或验证一套完整的可见性识别引擎。

锁定版本 6.2.108：5页合成样本解析报告约 73 ms，6页授权样本约 184 ms。这是本机的一次解析实验，不包含结构推断、Word 生成、AI 或真实完整转换，不能作为成品性能承诺。

两版本比较：每页报告的文字项数量、非空白字符数、图像次数、clip 数量、旋转项及测试标记完全一致。授权样本每页字符数为 487、768、680、178、696、297，总计 3,106。相同统计不意味着两版本所有图形能力完全一致，也不意味着可无回归升级全项目。

## 5. Word 原语与真实渲染实验

用 `docx@9.12.0` 创建受控的4页 DOCX，包含独立页眉/页脚、中文英文、无边框选项表、非等宽网格、横纵合并单元格、原生双栏以及混合字号。

| 项目 | 结果 |
| --- | --- |
| 构造、布局估计与打包 | 约 117 ms，18,772 字节，单次本机实验 |
| `docx/layout` 估计 | 4 页，`stoppedAt=null` |
| LibreOffice 26.2.5.2 渲染 | 4 页，已检查页面图像 |
| ZIP/XML 检查 | 33 个 XML/relationships 部件可以解析 |
| 主文档结构 | 4 sections、4 header references、2 个正文表格 |
| 显式网格 | `[5000,5000]` 和 `[1800,5200,3000]` twips |
| 双栏顶部 | 最终左右标题基线差 0 pt |

实验中发现：把 `ColumnBreak` 放在单独段落会在新栏留下一个额外段落高度；调整为与右栏首段内容放在同一段落后，顶端对齐。这是实际实验修正，不是对所有 Word 多栏的泛化保证。

页眉用 LOGO/QR 文字占位，因此没有验证真实图片定位、二维码清晰度或图像颜色。XML 可解析也不等于全面符合 OOXML 标准。尚未做 Word/WPS 实际打开、重新编辑或不同字体环境测试。

渲染辅助脚本出现了读取子进程输出的编码警告，但命令结束并生成非空 PDF/4张PNG；随后独立读取 PDF，确认4页及双栏位置。该警告属于本机 QA 工具日志，不当作产品功能通过或失败的依据。

## 6. AI 结构响应边界实验

纯本地构造有限来源 ID 和 JSON 候选，验证 8 种情况：

| 用例 | 预期 | 结果 |
| --- | --- | --- |
| 合法结构和完整顺序 | 接收 | 通过 |
| 返回额外改写文字字段 | 拒绝 | 通过 |
| 引用不存在的来源 | 拒绝 | 通过 |
| 重复来源 | 拒绝 | 通过 |
| 漏掉来源 | 拒绝 | 通过 |
| 旧任务/错误任务 ID | 拒绝 | 通过 |
| 顺序不完整或重复 | 拒绝 | 通过 |
| 未允许的角色/动作 | 拒绝 | 通过 |

网络请求数为0。该脚本是协议可行性草案，不是生产校验器；没有覆盖完整的表格跨度、几何、根级额外字段、巨大响应等安全条件，也没有验证任何模型的语义准确率或延迟。它支持的结论仅为：能够在接收端设置明确规则，拒绝若干常见不安全响应。

## 7. 依赖选择与许可判断

PDF.js npm 元数据为 Apache-2.0；docx 为 MIT。独立 docx 安装时记录了22个包的许可元数据，包含类型/开发辅助包，不能全部视为最终运行时依赖。

观察到的许可类型：MIT、ISC、BlueOak-1.0.0、MIT AND Zlib，以及 JSZip 的 MIT OR GPL-3.0-or-later。计划选择 JSZip 的 MIT 许可路径，并保留对应声明。元数据扫描不是完整法律或供应链审核；真实分发包、字体、WASM 和构建后资产还要形成 SBOM。

PyMuPDF 的 AGPL 不等于不能收费；问题在于其适用义务与用户未来闭源商业路线不匹配。选择不引入这条运行链，避免后续架构被它绑定。pdf2docx 自身 MIT 与其依赖许可必须分开看。

还发现较新的 [pdf2docx_pdfium](https://github.com/VitalyKalininSPB/pdf2docx_pdfium) 方向，观察时规模和历史很小；未将其当作成熟替代，也没有完成其来源/二进制审计。用户已选择自研 PDF.js 路线，因此本规划不引入该分支。

## 8. 可复查的本地产物

以下路径相对于 `toolknit-desktop`，研究目录位于忽略的 `tmp`，不是产品资产或默认提交内容。

| 产物 | 用途 |
| --- | --- |
| `tmp/pdf-word-research/research.mjs` | GitHub 检索、正文/评论与文档抓取 |
| `tmp/pdf-word-research/*-数字.json` | 23 项 Issue/PR 的本地证据快照 |
| `tmp/pdf-word-research/make-fixture.py` | 生成公开可描述的几何合成样本 |
| `tmp/pdf-word-research/geometry-fixture.pdf` | 5 页合成 PDF |
| `tmp/pdf-word-research/visibility-page.png` | 可见性实验的渲染图 |
| `tmp/pdf-word-research/inspect-pdf.mjs` | PDF.js 两版本解析检查 |
| `tmp/pdf-word-research/*-inspection.json` | 安装版本与锁定版本的实验报告 |
| `tmp/pdf-word-research/word-probe.mjs` | 4 页 docx 原语实验 |
| `tmp/pdf-word-research/word-probe.docx` | 受控可编辑 Word 文档 |
| `tmp/pdf-word-research/word-render-final/` | 最终 PDF 与4页PNG |
| `tmp/pdf-word-research/ai-contract-probe.mjs` | 有限 AI 响应验证实验 |
| `tmp/pdf-word-research/verify-research.mjs` | 版本结果比较、XML与渲染结果独立复核 |
| `tmp/pdf-word-research/research-verification.json` | 独立复核结果 |

复跑锁定版本解析的示例，需在隔离依赖已存在时执行：

```powershell
Set-Location 'D:\Toolknit EXE 8.30\toolknit-desktop'
$env:RESEARCH_PDFJS_ROOT='tmp/pdf-word-research/sandbox/node_modules/pdfjs-dist'
node tmp/pdf-word-research/inspect-pdf.mjs
node tmp/pdf-word-research/ai-contract-probe.mjs
node tmp/pdf-word-research/verify-research.mjs
```

后续进入正式研发，应把自制的必要夹具和精简回归脚本移入正式测试目录，记录来源并去除私人样本；不要把整个研究目录、第三方依赖副本和日志提交。

## 9. 本轮结论能支持到哪里

已经有证据支持：不依赖 PyMuPDF 的技术路线、独立页眉/表格/分栏的 Writer 基础、来源账本的必要性、可见性风险、受限 AI 响应协议和可量化测试方案。

没有证据支持：完整转换器已达到90%或100%准确率、任何PDF都能恢复所有文字、未来AI一定更快更准、Word/WPS已通过实测、成品安装包只增加固定MB、正式模型/资源许可证已经全部审计。上述内容已转成主规划的研发门槛，不能在后续宣传时把计划数字改成实测结果。
