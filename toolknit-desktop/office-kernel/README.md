# ToolKnit LibreOffice 内核

此目录保存固定版本的 LibreOffice 补丁和可重复执行的 Windows 构建流程。源码与构建输出放在独立目录中，不提交到应用仓库，不覆盖已安装的运行时。

当前锁定 `libreoffice-26.2.5.2`，提交 `cd7284b4cbbfeb507e630c1aac019f4157393acb`。补丁和引导工具的 SHA-256 记录在 `kernel.lock.json`。

## 当前实现范围

第一批内核补丁修复 DOCX `characterSpacingControl` 导入缺口：

- `doNotCompress` → `CharacterCompressionType::NONE`。
- `compressPunctuation` → `PUNCTUATION_ONLY`。
- `compressPunctuationAndJapaneseKana` → `PUNCTUATION_AND_KANA`。
- 未声明或无效值保留原有默认，不为 RTF 注入新的全局设置。
- 5 个无个人信息的最小 DOCX 和 C++ 原生导入测试包含在补丁中；测试连续打开不同设置的文档，检查设置不会串到下一个文档。

第二个补丁修复 `noPunctuationKerning` 导入：显式开启禁用标点字距调整，显式关闭及 DOCX 省略该元素时允许标点字距调整。它只影响已启用 `w:kern` 的文本；RTF 的既有默认保持不变。测试覆盖显式真、显式假、空元素、DOCX 默认及 RTF 默认，按顺序导入以检查状态隔离。

第三个补丁修正 `overflowPunct` 的反向导入，覆盖空元素、显式开关、缺省值、样式继承和局部覆盖。

第四个补丁修复 PDF 绘制循环在右边界提前结束、漏画悬挂标点的问题。悬挂标点保留原有布局宽度，绘制时使用其实际宽度，并将允许的悬挂区域纳入绘制范围。

第五个补丁实现普通中文正文中按整行限制标点留白压缩的规则，并处理行末闭合标点的留白。它使用原有字形度量与两端对齐流程，字体大小和页面几何不变。范围限于 Word 兼容模式下的中文横排、两端对齐、标点压缩正文；表格、竖排、字段及多行合并等仍使用原有路径。表格适用规则尚待独立验证。最小样例检查无标点对照、不同标点数量、不同行宽及格式片段拆分，18 个首行断点由 Windows C++ 测试验证；PDF 回归同时检查所有字符和文字边界。

第六个补丁分别导入和导出 `autoSpaceDE`（中西文）及 `autoSpaceDN`（中文与数字），新增独立 UNO 属性，同时保留原有合并布尔接口。原生测试覆盖样式继承、局部覆盖及 DOCX 保存重载；Word 兼容路径使用四分之一 em 自动间距。

第七个补丁修复禁用表格网格调整时提前返回、跳过固定/最小段落行距的问题。启用网格的 Word 兼容表格中，固定行距使用已有普通固定行距的基线规则；同时允许表格内声明的悬挂标点。任务书普通单行标签纵向位置改善，多行标签仍存在差异。

第八个补丁将无注音的 Word 兼容表格网格基线扩展到自动行距，并修正开启标点压缩时闭合括号的半字悬挂。只让实际越界部分悬挂，其余部分计入居中/右对齐。第九个补丁累计中西文四分之一 em 间距的小数余量，避免每个 52.5 twip 间距单独截断；从仍存在的字距片段恢复余量，兼容行末回退重排。第十个补丁处理中文禁则中的开引号与后一个字：在实际可压缩宽度足够时，只拉入所需的一字，不扩展到后续词。

共享转换层另在临时 DOCX 中明确通用标点的字体绑定，按 `rFonts` 的缺省提示选择 `hAnsi`，保留脚本分类。覆盖样式继承、局部字体、主题字体与故事部件，明确的 `eastAsia`/`cs` 提示及复杂文字保持原路径。原文件不变。这是导入语义兼容，不是缩放字体或替换引号字符；范围和限制见最新验证记录。

第十一个补丁保留显式段前分页后的段前间距，继续折叠自然换页的段前间距。论文表 6-4 已恢复到源文档的第 31 页。第十二个补丁修正英文词间距测量：在双字节空格平衡开启时，十个连续空格会触发半角表意空格规则，不能用来代表英文单词之间的单个空格。使用当前物理字体的原始空格前进量计算收缩预算，修复任务书英文参考文献从三行缩成两行的问题，不关闭源文档的平衡设置。

第十三个补丁保留中文悬挂标点在行内的半字宽，修复格式片段边缘的空格测量上下文，并正确读取双字节空格平衡的显式关闭值。第十四个补丁单独保存原始字体度量，修复自动网格段落的基线，保留原有行高和分页。共享转换层通过只读能力属性 `SupportsWordAutoGridBaseline` 识别新内核，并用带类型的 UNO 属性保留原始自动行距语义；旧内核不启用新增比例网格解析。

第十五个补丁在保持原有断点和禁则的条件下，优先使用闭合标点的自然悬挂空间，避免先压缩行内其他标点。测量包含此前格式片段的压缩量，保留原有的自然悬挂路径。第十六个补丁保留已经放入本行的 Word 中西文/数字自动间距，防止换行时清零后被两端对齐重新分配；普通字符字距仍按原有规则处理。

论文绪论 26 行截图基准及目录、表 6-4 分页检查通过，任务书多行标签及英文文献断行也已改善；其他文字坐标仍未全部通过。不能将上述测试通过视为全稿所见即所得验收通过。发布状态固定为开发中，`visualFidelityApproved=false`。

## Windows 构建

需要 Visual Studio 2022 C++ Build Tools（包含 x64/x86 C++ 工具和 `Microsoft.VisualStudio.Component.VC.ATL`）、Windows SDK、Git for Windows、7-Zip 和已有的 WSL Ubuntu。引导脚本提前检查 VS 组件，并下载、验证和解包固定版本的 LLVM 20.1.8；不执行 LLVM 安装程序，也不要求修改 VS 的 Clang 组件。使用短的、不带空格和中文的绝对目录，例如 `D:\tk-lo`。开发配置启用内部 Python，保留该版本 Windows 必需的 Skia 后端，关闭旧 .NET CLI 绑定、Java、PDF 导入、附加字体、画廊和额外数据库后端；保留 Windows 表单模块链接所需的基础数据库库，Word/PPT/Excel 的 PDF 导出仍保留。这是验证内核补丁的开发配置，尚不是生产运行时的打包配置。

以下命令在桌面项目目录运行，PowerShell 使用 7.x。QA/准备脚本的 Python 需要 3.10+；`probe-import.py` 必须使用对应 LibreOffice 自带的 UNO Python。

```powershell
python office-kernel/kernel.py prepare --work-root D:\tk-lo

# 在已有 WSL 发行版中安装编译工具，不更改全局 Git 或系统安全设置。
.\office-kernel\bootstrap-windows.ps1 -WorkRoot D:\tk-lo -InstallWslPackages
.\office-kernel\build-windows.ps1 -WorkRoot D:\tk-lo -Stage Configure

# 下载经过上游 SHA-256 校验的依赖。重复运行会复用已验证下载。
.\office-kernel\build-windows.ps1 -WorkRoot D:\tk-lo -Stage Fetch -Jobs 8

# 编译与运行第一批原生导入测试；首次执行会构建所需运行时依赖。
.\office-kernel\build-windows.ps1 -WorkRoot D:\tk-lo -Stage Test

# 编译完整开发运行时，不执行全部上游测试。
.\office-kernel\build-windows.ps1 -WorkRoot D:\tk-lo -Stage Build
```

`-Python` 可指定准备脚本所用的 Python；`-WslDistro` 可指定已有发行版；`-Jobs` 控制并行度。脚本只在进程内设置 PATH、MSYS 环境和 MSVC UTF-8 源码选项，不修改系统语言、区域或持久环境变量。引导工具来自上游固定版本的构建配置，下载后验证哈希；无论是补丁冲突还是源码提交不匹配，都不会 reset 或删除已有源码。

状态检查：

```powershell
python office-kernel/kernel.py status --work-root D:\tk-lo
```

配置成功不会标记为编译成功。构建脚本仅在 make 成功退出后记录阶段结果；源码提交、补丁列表、配置哈希、测试选择或本地源码修改发生变化会使旧结果失效。补丁叠加状态在独立 Git 索引中核验，保留用户暂存内容。`-Stage Compile -CompileTargets Library_sw` 仅进行增量编译，不记录完整构建或测试成功。即使导入测试通过，视觉验收状态也不会自动变为通过。

## 不经过兼容补偿的运行时测试

下列测试直接读取 Writer 导入后的文档属性，不调用 `apply_docx_layout_compatibility`，避免 Python 层掩盖内核导入缺陷。

```powershell
D:\tk-lo\build\instdir\program\python.exe office-kernel/probe-import.py `
  --soffice D:\tk-lo\build\instdir\program\soffice.com `
  --source-root D:\tk-lo\src `
  --report D:\tk-lo\kernel-import.json
```

默认套件包含 36 项属性断言：压缩 5 项、标点字距调整 5 项、行末溢出及继承 10 项、独立中西文/数字间距 16 项。可用 `--suite compression`、`--suite kerning`、`--suite overflow` 或 `--suite spacing` 分别核验。报告记录 `swlo.dll`、`sw_writerfilterlo.dll`、`mswordlo.dll`、`vcllo.dll` 和 `editenglo.dll` 的哈希，避免遗漏导入模块变化。通过只代表导入设置正确，报告始终保留 `visualFidelityApproved=false`。

最小排版回归使用含 `pdfplumber` 的 QA Python 执行：

```powershell
python office-kernel/test-cjk-layout.py --source-root D:\tk-lo\src `
  --soffice D:\tk-lo\build\instdir\program\soffice.com `
  --office-python D:\tk-lo\build\instdir\program\python.exe `
  --output-dir D:\tk-lo\cjk-regression-1
```

该回归使用真实应用转换驱动，包含 23 个通用样例：原有 18 份加悬挂行内宽度、空格上下文开关、闭合标点优先级及行末自动间距共 5 份。检查全部字符保留、字号/字体、首行断点、实际间距、格式片段拆分不变性、表格网格/基线和闭合括号正常字宽。英文样例核对三个行宽及开关前后每个字形位置不变。行末自动间距用相对于行起点的文字前进量检查保留的四分之一 em，不把页面原点量化误差当成间距变化。分数间距样例累计误差须小于 0.051 pt（先量化为 Writer 使用的整数 twip，排除 PDF 字体表的小数进位差异）。字体绑定样例只验字体及片段不变性，其全部引号断行尚未验收；通用最小样例不代表所有宽度与语种的 Word 排版规则。输出目录必须全新。Windows 原生断行测试要求实际安装 SimSun。

## 逐行版式诊断

`probe-layout.py` 使用明确指定的运行时和独立用户配置导出，只在 PDF 已生成后启动独立 QA Python 读取外部截图基准。默认不使用应用兼容层；`--compatibility current` 可核对与应用现有预处理组合后的结果。两个模式都保留源文件哈希、引擎版本和 Writer 模块哈希，失败时保留 PDF 与逐段错误，避免只看到第一个断行问题。输出目录必须全新。

```powershell
D:\tk-lo\build\instdir\program\python.exe office-kernel/probe-layout.py `
  --soffice D:\tk-lo\build\instdir\program\soffice.com `
  --source D:\samples\sample.docx `
  --page-checks D:\samples\approved-lines.json `
  --qa-python D:\qa\python.exe `
  --output-dir D:\tk-lo\layout-run-1
```

QA Python 需要 `pdfplumber`。返回 0 只代表声明的检查点通过；返回 1 代表检查失败。这些检查点和源截图不参与转换，也不能代表整份文档视觉一致。实测结果与剩余问题见 [第一轮记录](validation-20261116.md)、[第二轮记录](validation-cjk3-20261116.md)、[第三轮记录](validation-cjk4-20261117.md)、[第四轮记录](validation-cjk5-20261117.md)、[第五轮记录](validation-cjk6-20261117.md) 和 [最新记录](validation-cjk7-20261117.md)。

本机开发复测可使用 `run-desktop-dev.ps1 -WorkRoot D:\tk-lo -Python <QA-Python>`。它核验源码、补丁、完整构建及原生测试回执后，启动已编译桌面程序，只为子进程指定开发内核；不更改系统环境或已安装运行时。`-CheckOnly` 只检查启动条件。普通启动现优先使用随安装包携带的固定内核，无需该开发入口或环境变量。该变更不表示整稿视觉验收通过。

## 随安装包携带的默认内核

用户已明确要求替换默认运行时。Windows 安装包现携带 `resources/office-kernel`，完整保留程序、共享数据、Python/UNO、应用本地 MSVC 库、上游许可、固定源码信息及全部补丁。普通启动先检查随包内核，再考虑旧的下载运行时和系统安装；显式环境变量仍供开发诊断使用。随包核心文件校验失败时报告错误，不静默退回旧内核。

首次准备构建资源：

```powershell
python office-kernel/package-runtime.py --work-root D:\tk-lo `
  --msvc-runtime C:\path\to\verified-msi\System64
python office-kernel/package-runtime.py --verify
npm run build:release-package
```

打包脚本要求完整构建及原生测试回执、与实际 Writer 模块匹配的通用 PDF 回归。`office-kernel/runtime.lock.json` 固定清单与核心文件哈希；生成的大型运行时目录不提交。已有暂存目录必须先验证，脚本不会覆盖。桌面打包前使用 Node 校验全部文件并清理本地 QA 产生的 Python 缓存，发现其他未声明文件立即失败。

Windows 正式入口为 `npm run build:release-package`。干净检出可使用已通过上文校验的内核 ZIP，ZIP 根目录包含 `manifest.json`、`runtime/` 和 `source/`。本机通过 `TOOLKNIT_OFFICE_KERNEL_ARCHIVE` 指定 ZIP。GitHub Release 工作流从仓库变量 `TOOLKNIT_OFFICE_KERNEL_URL` 指定的 HTTPS 地址下载同一内核。准备脚本先校验 ZIP 中的清单摘要与逐项大小，再核验全部文件哈希并安装到打包资源目录。更新内核时需同时更新固定清单与归档。

安装后普通 exe 从自身旁的 `resources/office-kernel/runtime/program/soffice.com` 读取内核。CLI/MCP 在源码环境及常见桌面安装位置发现同一随包内核，使用相同固定清单校验。CLI npm 包只携带校验代码和清单，不重复携带大型内核。版本和验证记录见 [默认内核替换记录](deployment-cjk7-20261117.md)。

## 后续内核工作与交付条件

1. 先验证上述 C++ 原生测试和 UNO 直接导入测试。
2. 保持 `autoSpaceDE` / `autoSpaceDN` 的分别控制、继承、局部覆盖和保存重载回归；继续解决真实文档中的混排断行。
3. 用最小字体、标点和混排样例验证 Writer 断行、压缩及网格右缩进行为，再修改排版内核。不能使用论文正文、页码、截图转录或固定缩放比例作为转换规则。
4. 使用 `scripts/test-word-to-pdf-fidelity.py` 的严格逐行与坐标比较；外部截图基准只用于测试，不能传给转换驱动改变排版。
5. 当前按用户授权将固定修复内核设为安装包默认，已生成包含 commit、补丁、文件哈希和测试结果的清单。`visualFidelityApproved=false` 保持，继续完成论文整份、任务书及开题报告的全稿视觉与逐行验收，再评估生产配置优化和下载更新。

本目录的测试可用 `python scripts/test-office-kernel.py` 执行。LibreOffice 补丁保留上游 MPL-2.0 代码声明；上游许可随固定源码和后续运行时分发，应用自身许可不替代它。
