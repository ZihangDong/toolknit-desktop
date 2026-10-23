# ToolKnit CLI

ToolKnit CLI 是 ToolKnit Desktop 的命令行与 AI Agent/MCP 调用层。它把桌面端里已经沉淀好的 PDF、PPT、图片、音视频、文本、AI 文档、AI 表格处理能力暴露成稳定命令，方便在 PowerShell、脚本、Trae、Cursor、Claude Desktop 等 IDE Agent 工作流里调用。

> 桌面端仓库：[ZihangDong/toolknit-desktop](https://github.com/ZihangDong/toolknit-desktop)

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

## V3.2 能力

V3.2 提供 **77 项 CLI/MCP 能力**，可独立于桌面端使用。完整名称、参数和桌面覆盖边界见随包提供的 [能力清单](guides/CLI_CAPABILITIES.md)。

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
- PPT 转 PDF / PPT 转图片依赖 LibreOffice；可安装 LibreOffice，或设置 `TOOLKNIT_LIBREOFFICE_PATH` 指向 `soffice.com` / `soffice.exe` / `soffice`。
- 文件处理默认本地执行；AI 文档/表格、AI 润色/翻译、PDF AI Markdown、显式开启的 Word 排版辅助、PPT AI 工作流和转写后的 `refine` 校对会调用你自己配置的 AI 服务。

## 许可证

PDF 转 Word 引擎及派生适配器遵循独立源码观摩许可；普通使用官方 CLI 按官方应用例外执行，提取、集成、修改或商用授权请联系 info@toolknit.com。其余新授权自有代码遵循 PolyForm Noncommercial 1.0.0：新授权的作者代码仅限非商业用途；商业使用需联系作者另行授权。旧 Apache-2.0 授权及第三方许可不变，详见 LICENSE、NOTICE 和 LICENSES。
