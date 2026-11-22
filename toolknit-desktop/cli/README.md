# ToolKnit CLI

ToolKnit CLI 是 ToolKnit Desktop 的命令行与 AI Agent/MCP 调用层。它把桌面端里已经沉淀好的 PDF、PPT、图片、音视频、文本、AI 文档、AI 表格处理能力暴露成稳定命令，方便在 PowerShell、脚本、Trae、Cursor、Claude Desktop 等 IDE Agent 工作流里调用。

> 桌面端仓库：[ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop)

当前源码版本为 3.4.0（未发布），与桌面端版本保持一致。npm 当前正式版为 3.3.0，安装命令不会获取尚未发布的源码版本。

## 安装

```bash
npm install -g @toolknit/cli
toolknit --help
toolknit doctor --json
```

如果国内镜像暂未同步新版本，安装时可能出现 `404 Not Found`。这不是包不存在，改用 npm 官方源即可：

```bash
npm install -g @toolknit/cli --registry=https://registry.npmjs.org
```

需要 Node.js `>= 22.13.0`。

## CLI / MCP 能力

当前开发源码版本为 **3.4.0**（未发布），提供 **78 项 CLI/MCP 能力**，沿用 V3.3 的 Word 转 PDF 等功能。下方安装命令对应已发布的 npm 3.3.0。

已发布 V3.3 提供 **78 项 CLI/MCP 能力**，可独立于桌面端使用。完整名称、参数和桌面覆盖边界见随包提供的 [能力清单](guides/CLI_CAPABILITIES.md)。

```powershell
toolknit tools list --json
toolknit tools coverage --json
toolknit tools describe toolknit_pdf_to_word --json
toolknit pdf to-word --input .\report.pdf --output .\result.docx --layout original --json
toolknit image to-pdf --input .\first.png --input .\second.jpg --output .\images.pdf --json
toolknit excel to-pdf --input .\book.xlsx --output .\book.pdf --json
toolknit run toolknit_image_crop --arguments-file .\crop-request.json --json
```

新增图像扫描 PDF、PDF 转 Word/文本/页码/裁剪/空白页、图像处理与图标包、文本整理、AI 润色/翻译、开发者和计算工具、Markdown HTML、只读文件扫描。历史命令保持兼容；所有 MCP 能力也可通过 `run` 和结构化 JSON 调用。

## 适合谁

- 想在 IDE 里用自然语言处理本地文件的 AI Agent 用户。
- 想批量处理 PDF、图片、音视频和文本文件的开发者。
- 想把文件留在本地、不希望上传到在线工具网站的办公与创作用户。

## 常用命令

```bash
# PDF：只拆出第 2 页
toolknit pdf split --input "D:\Backup\下载\朱自清-背影，荷塘月色.pdf" --pages 2 --output-dir ".\output"

# PDF：合并多个文件
toolknit pdf merge --input ".\a.pdf" --input ".\b.pdf" --output ".\output\merged.pdf"

# PDF：有损图像化压缩到不超过 500 KB（会移除文字搜索、链接和表单等结构）
toolknit pdf compress --input ".\report.pdf" --output ".\output\small.pdf" --mode raster --target-kb 500 --clarity readable --json

# PPT：提取内嵌图片素材，保留原始格式并生成清单
toolknit ppt images --input ".\demo.pptx" --output-dir ".\output\ppt-assets" --skip-duplicates --json

# PPT：提取标题、正文和备注，可选 AI 整理
toolknit ppt text --input ".\demo.pptx" --output-dir ".\output\ppt-text" --format all --json

# PPT：安全压缩，保留图片质量和版式
toolknit ppt compress --input ".\demo.pptx" --output-dir ".\output\ppt-compress" --level medium --json

# PPT：渲染为 PDF，需要本机 LibreOffice
toolknit ppt to-pdf --input ".\demo.pptx" --output-dir ".\output\ppt-pdf" --json

# PPT：按页导出高清图片，需要本机 LibreOffice
toolknit ppt to-image --input ".\demo.pptx" --output-dir ".\output\ppt-pages" --pages 1-3 --format png --clarity high --json

# PPT：根据文字需求生成结构化演示大纲
toolknit ppt outline --prompt-file ".\brief.txt" --output-dir ".\output\ppt-outline" --slide-count 8 --deck-type product-launch --json

# PPT：生成可编辑 PPTX 草稿
toolknit ppt draft --prompt-file ".\brief.txt" --output-dir ".\output\ppt-draft" --slide-count 8 --deck-type product-launch --theme minimal-mono --json

# PPT：直接把 outline.json 转成可编辑 PPTX 草稿
toolknit ppt draft --outline-file ".\output\ppt-outline\outline.json" --output-dir ".\output\ppt-draft" --theme minimal-mono --json

# 视频：截取高清单帧图
toolknit video frame --input ".\demo.mp4" --timestamp-ms 3500 --output-dir ".\output\frames" --format png

# 视频：截取 GIF
toolknit video gif --input ".\demo.mp4" --start-ms 2000 --end-ms 7000 --frame-rate 12 --width 720 --quality small --output-dir ".\output\gif"

# 音视频：离线提取字幕/文字
toolknit transcribe --input ".\meeting.mp4" --output-dir ".\output\transcribe" --language auto --refine

# AI 文档：生成可编辑工程、PDF、预览图、编号图
toolknit ai-doc create --prompt "生成一份产品发布复盘报告" --output ".\output\ai-doc\review.pdf" --page-count 3

# AI 表格：生成表格工程和导出文件
toolknit ai-table create --prompt "生成一份季度销售复盘表，包含图表" --output ".\output\ai-table\sales.xlsx"
```

## AI Agent / MCP

OrcaRouter 可沿用自定义 URL、模型与专用密钥配置，见随包提供的 [配置与验证边界](guides/orcarouter.zh-CN.md) · [English](guides/orcarouter.en.md)。真实服务认证生成仍待专用凭据验收。

启动 MCP server：

```bash
toolknit mcp serve
```

在 IDE 的 MCP 配置中指向：

```json
{
  "mcpServers": {
    "toolknit": {
      "command": "toolknit",
      "args": ["mcp", "serve"]
    }
  }
}
```

PDF、图片、音视频、文本和非 AI PPT 等本地工具不需要 AI Key。使用 AI 文档、AI 表格、PPT 文本 AI 整理、AI 生成 PPT 大纲、AI 生成 PPT 草稿 / PPTX 或转写后的 `refine` 二次校对时，请在 IDE 的 MCP 环境变量/密钥设置中为 `toolknit` 添加真实的 `DEEPSEEK_API_KEY`（也支持 `TOOLKNIT_AI_API_KEY`），再重启 IDE。不要把密钥写进 Agent 对话；桌面端保存的密钥不会自动共享给 CLI/MCP。

给 Agent 的自然语言示例：

```text
请使用 ToolKnit 把项目里的 demo.mp4 从第 2 秒到第 7 秒截成 GIF，宽度 720，帧率 12，输出到项目的 output/gif 文件夹。
```

```text
请使用 ToolKnit 把项目里的 demo.pptx 内嵌图片素材提取出来，跳过完全重复图片，输出到项目的 output/ppt-assets 文件夹。不要修改源 PPTX。
```

```text
请使用 ToolKnit 把项目里的 demo.pptx 转成逐页 PNG 图片，只导出第 1 到第 3 页，输出到项目的 output/ppt-pages 文件夹。不要修改源 PPTX。
```

```text
请用 ToolKnit 生成一份可编辑 AI 文档，主题是“ToolKnit 工具箱使用指南”，输出 PDF、预览图和控件编号图。生成后先检查编号图，如果版式空白或元素重叠，请继续调整工程文件并重新渲染。
```

查看完整中英文 Agent 手册：

```bash
toolknit agent guide --lang zh
toolknit agent guide --lang en
```

## 设计原则

- 写入操作必须显式指定输出位置。
- 已存在文件默认不会覆盖，需要显式传入覆盖参数。
- 密码不通过命令行参数传递，避免出现在历史记录里。
- FFmpeg 不随 npm 包内置；CLI 会依次使用 `TOOLKNIT_FFMPEG_PATH`、ToolKnit Desktop 设置页下载的共享运行时或系统 PATH。
- Word/PPT 转 PDF、PPT 转图片使用 LibreOffice。Windows 源码环境及常见 ToolKnit 桌面安装位置优先发现经过哈希校验的随包修复内核；也可通过 `TOOLKNIT_LIBREOFFICE_PATH` 显式指定运行时。独立 npm CLI 不重复携带大型内核，可使用桌面随包内核或完整 LibreOffice 安装。
- 文件处理默认本地执行；AI 文档/表格、AI 润色/翻译、PDF AI Markdown、显式开启的 Word 排版辅助、PPT AI 工作流和转写后的 `refine` 校对会调用你自己配置的 AI 服务。

## 许可证

V3.3 的作者自有代码（含 PDF 转 Word 引擎和派生适配器）采用 MIT 许可，允许商业及非商业使用、修改和分发，须保留版权与许可声明。推荐在项目介绍中注明 ToolKnit.com 并提供 DoFollow 外链，回链不是许可条件。第三方组件与既有 Apache-2.0 贡献保留原许可，详见 LICENSE、NOTICE 和 LICENSES。

### V3.3 新增：Word 转 PDF

V3.4 新增可选 `encryption` 对象，包含必需的 `password` 和可选 `permissions`，使用本地 AES-256。密码至少 8 个 Unicode 字符、最多 127 个 UTF-8 字节且不含 NUL / CR / LF；每份最多 200 页 / 150 MiB，可与 DOC / DOCX / ZIP、水印和内部域刷新组合。打印支持 false / lowResolution / highResolution，另可设置复制、修改、注释、表单和页面组装；辅助技术访问保留，权限由阅读器遵守。成功返回 `encrypted:true`，失败不发布普通 PDF，取消保留已完成的加密结果。带密码的完整请求通过 `toolknit run toolknit_word_to_pdf --arguments-stdin --json` 接收，拒绝将嵌套口令放进命令行或 `--arguments-file`；不要将口令写入文件、日志和结果路径。再次调用需要重新提供密码；桌面任务中心不保存密码或提供自动重试。

V3.4 增加可选 `watermark`：`{"type":"text","text":"内部资料 DRAFT","pages":"1,3-5","opacity":0.2,"angle":45,"width":60}`。图片使用 `type:"image"` 与本地 `image_path`，支持 PNG / JPEG（4 MiB、400 万像素以内）。文字上限 80 个 Unicode 字符；页码留空为全部，超出每份文档实际页数时仅该项失败。水印层按各页纸张等比缩放并居中，保留正文文字；成功结果返回 `watermark_pages`。中间 PDF 保留在私有临时目录，盖印验证成功后逐项发布，取消保留已发布文件。通过 `toolknit run toolknit_word_to_pdf --arguments-file request.json --json` 或 MCP 传嵌套参数，可与 ZIP 和 `refresh_fields` 组合。首版居中灰色文字或图片，不含平铺 / 自由定位；检查最终结果。

V3.4 增加可选 `--refresh-fields true`（MCP / JSON 为 `refresh_fields:true`），默认关闭。刷新正文目录、由题注生成的图表目录、页码、总页数、章节和内部引用，逐项返回更新与跳过数量。刷新可能改变分页，失败时可关闭选项重试。Writer 导入时仍可能计算动态域。

V3.4 开发源码新增 ZIP 批量输入：`input_paths` 可混合 DOC / DOCX / ZIP，并提供 `output_dir`；展开后最多 20 个 Word，每个文档或 ZIP 50 MiB。ZIP 限制 1000 项 / 200 MiB，拒绝不安全路径、链接与加密项；不展开嵌套 ZIP。逐项结果保留原包路径和 `archive_entry`，同名文档分开输出，临时副本自动清理。正式 npm 3.3.0 尚不含此新增 ZIP 能力，详见[随包 Agent 手册](guides/agent-guide.zh-CN.md#word-转-pdfv33-新增)。

开发源码支持 `toolknit word to-pdf --input source.docx --output result.pdf --json`。需要完整 LibreOffice + UNO/Python，一次最多 20 个 DOC/DOCX、每个 50 MiB。批量通过 `toolknit run toolknit_word_to_pdf --arguments-file request.json --json`，参数为 `input_paths`、`output_dir`。取消保留已完成结果；源文件不修改。正式 npm 3.2.0 不包含此功能。

转换全程使用 LibreOffice，不调用 WPS 或 Microsoft Word。对带中文行网格的 DOCX，导出前在内存中解析单行标题的自动行距、字符单位首行缩进，以及无字段、图形和边框的空页眉页脚的字体行框。行高依据源文档网格、字号和字体度量计算；保留正文固定行距、字体大小、页边距和页眉页脚内容，不保存改动到源文件。Windows 字体度量使用系统 GDI，无需安装其他 Office 软件。

兼容处理也遍历合并与嵌套表格中的段落，并使用单元格自身的文字范围判断换行。单倍行距的单行文字或空段落按源网格占一行，避免标题前留白被放大。表单类 DOCX 显式设置全局中文标点压缩且没有段落或样式级禁则、标点溢出与换行覆盖规则时，会恢复相应的 Writer 排版开关；有自然换行的普通中文正文时保留导入器的结果，避免全局压缩补偿使正文每页多容纳文字。此处理仍不保证 Word 与 Writer 的逐行换行完全一致。

导入前检查 DOCX 样式名称冲突，例如不同样式 ID 的 `toc 2` 和 `TOC 2`。存在冲突时，在临时副本中区分名称，保留样式 ID、属性、引用、目录缓存、扩展命名空间和其他 ZIP 部件，防止 LibreOffice 合并目录样式并覆盖字号、行距。没有冲突的文件直接导入；临时副本在成功或失败后均清理，原文件不修改，相对超链接仍以原文件位置为基准。

分页回归：在桌面项目目录执行 `python scripts/test-word-to-pdf-fidelity.py --source sample.docx --reference reference.pdf --soffice "C:\Office\program\soffice.com"`。QA Python 需要 `pdfplumber`；`reference.pdf` 是已有的正确排版对照件，测试不会启动其他 Office 软件。可用 `--office-python` 指定 UNO Python，用 `--output-dir` 保留结果。参考 PDF 模式严格检查逐行文字、换行位置及每行四边坐标（误差小于 1 pt），并分别检查表格各单元格内的逐行排版；总页数和每页文字相同不足以通过。还检查实际 PDF 生成引擎、表格边界、字体字号、单文件与批量部分失败，以及源文件完整性。仍需视觉复核图片、线条及文字渲染。

已有明确页末文字但没有参考 PDF 时，可将 `--reference reference.pdf` 换成 `--first-page-end "平台管理" --pages 5`。此模式验证指定页末、总页数以及源 DOCX 与输出 PDF 的文字数量完整性；它不替代其他页面的视觉复核。

长文档也可用 `--page-checks checks.json` 指定经源文档截图确认的检查点，包括总页数 `pages`、图片数 `images`，以及 `checks` 中的页末、段落行数、包含或排除文本；可按 PDF 点坐标 `crop` 排除页眉页脚。此模式同时检查源正文的字母、数字和汉字数量覆盖，支持运行中的重复表头、页码和脚注；检查点仅用于回归测试，不参与转换排版，也不表示全稿视觉完全一致。

严格验证截图中已确认的逐行文字时，使用 `paragraph.expectedLines` 字符串数组，例如 `{"page":7,"paragraph":{"expectedLines":["源文件的第一行","第二行结束。"]}}`。相同段落行数但换行位置不同会失败；只忽略提取产生的空白差异，标点和文字必须一致。执行 `test:word-to-pdf-fidelity-checks` 验证检查器确实能拒绝这些差异。当前 LibreOffice 兼容处理未实现对任意 Word/WPS 文档的逐行、逐像素等同；不得将页数或少量检查点通过描述成“所见即所得已验收”。

驱动源码位于 `src-tauri/resources/office/`：`word-to-pdf.py` 负责输入验证、Writer 会话、PDF 导出与批量状态；`word_layout.py` 负责 DOCX 排版兼容；`word_font_metrics.py` 负责字体度量。桌面端嵌入并释放三个文件，CLI 通过 `stage:cli-resources` 同步相同模块。缓存与会话测试为 `test:word-to-pdf-profile`，排版与字体测试为 `test:word-to-pdf-layout`。
