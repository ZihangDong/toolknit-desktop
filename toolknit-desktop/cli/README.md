# ToolKnit CLI

ToolKnit CLI 是 ToolKnit Desktop 的命令行与 AI Agent/MCP 调用层。它把桌面端里已经沉淀好的 PDF、图片、音视频、文本、AI 文档、AI 表格处理能力暴露成稳定命令，方便在 PowerShell、脚本、Trae、Cursor、Claude Desktop 等 IDE Agent 工作流里调用。

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

需要 Node.js `>= 20.12.0`。

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

PDF、图片、音视频和文本等本地工具不需要 AI Key。使用 AI 文档、AI 表格或转写后的 `refine` 二次校对时，请在 IDE 的 MCP 环境变量/密钥设置中为 `toolknit` 添加真实的 `DEEPSEEK_API_KEY`（也支持 `TOOLKNIT_AI_API_KEY`），再重启 IDE。不要把密钥写进 Agent 对话；桌面端保存的密钥不会自动共享给 CLI/MCP。

给 Agent 的自然语言示例：

```text
请使用 ToolKnit 把项目里的 demo.mp4 从第 2 秒到第 7 秒截成 GIF，宽度 720，帧率 12，输出到项目的 output/gif 文件夹。
```

```text
请用 ToolKnit 生成一份可编辑 AI 文档，主题是“开源工具箱 v1.2 发布说明”，输出 PDF、预览图和控件编号图。生成后先检查编号图，如果版式空白或元素重叠，请继续调整工程文件并重新渲染。
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
- 文件处理默认本地执行；只有 AI 文档、AI 表格和转写后的可选 `refine` 校对会调用你自己配置的 AI 服务。

## 许可证

Apache-2.0
