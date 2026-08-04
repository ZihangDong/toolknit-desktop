# ToolKnit AI Agent 快速手册

本手册帮助普通用户在 Trae、Cursor 或其他支持 MCP 的 IDE 中，让 AI Agent 安全调用 ToolKnit 处理本地 PDF、转换音频和视频，并生成专业的多页 AI 文档与可编辑 AI 表格。

## 先完成连接

安装 CLI 后，在 IDE 的 MCP 设置中添加下列服务器。保存配置并重启 IDE。

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

若 IDE 找不到 `toolknit` 命令，请在其 MCP 配置中使用 Node.js 的绝对路径与 CLI 入口路径。Windows 安装后的默认入口是：

```text
C:\Users\<你的用户名>\AppData\Roaming\npm\node_modules\@toolknit\cli\toolknit.mjs
```

基础 PDF、图片、音视频和文本工具不需要 AI Key。使用 AI 文档、AI 表格或转写后的 `refine` 二次校对时，请在 IDE 的 MCP 环境变量/密钥设置中为 `toolknit` 添加真实的 `DEEPSEEK_API_KEY`（也支持 `TOOLKNIT_AI_API_KEY`），再重启 IDE。不要把密钥写进 Agent 对话、文档需求、输出路径或文件名；桌面端保存的密钥不会被 CLI/MCP 读取。

连接成功后，Agent 会显示 30 项 ToolKnit 工具：8 项 PDF 工具、4 项音频工具、4 项离线模型与转写工具、3 项视频工具、1 项文本工具、2 项图像工具、4 项 AI 文档工程工具，以及 4 项 AI 表格工程工具：

- `toolknit_ai_document`：创建 PDF、可编辑工程、干净预览、编号图和首个修订。
- `toolknit_ai_document_inspect`：只读查看全部稳定控件编号、文字、样式、位置和诊断。
- `toolknit_ai_document_edit`：按编号原子修改；支持试运行、样式、交换、移动、缩放、插图、锁定、分组、相对对齐、重叠整理和撤销。
- `toolknit_ai_document_render`：从工程确定性刷新 PDF 和预览，不增加修订。
- `toolknit_ai_table`：创建表格导出文件、可编辑工程、预览图和首个修订。
- `toolknit_ai_table_inspect`：只读查看全部稳定行号、列号、图表号、单元格、图表和输出路径。
- `toolknit_ai_table_edit`：按稳定行、列、图表编号原子修改；支持试运行、单元格、行列增删、交换、排序、图表更新和撤销。
- `toolknit_ai_table_render`：从工程确定性刷新导出文件和预览，不增加修订。
- `toolknit_audio_convert`：将 1 到 100 个本地音频转换为 MP3、AAC、WAV、FLAC、ALAC 或 OGG；结果以唯一文件名写入指定输出目录。
- `toolknit_audio_bpm`：在本机分析一个音频文件的 BPM、置信度和候选节拍；不上传、不修改也不生成音频文件。
- `toolknit_audio_clip`：按明确起止秒数裁切一个本地音频，保留原件并以唯一文件名发布结果。
- `toolknit_audio_extract`：从本地视频中提取指定音轨为 MP3、AAC、WAV、FLAC 或 OGG。
- `toolknit_model_list`：只读查看桌面端与 CLI 共用的离线转写模型状态。
- `toolknit_model_install`：从官方源或国内镜像下载并校验一个本地 Whisper 模型。
- `toolknit_model_use`：选择已经安装的本地转写模型。
- `toolknit_transcribe`：本地转写一个音频或视频，始终保留原始 JSON、SRT、TXT；可选二次润色只发送识别出的文字。
- `toolknit_video_convert`：将 1 到 30 个本地视频转换为 MP4、AVI、MKV、MOV、WebM、FLV、WMV 或 TS；原件不改写，结果使用唯一文件名。
- `toolknit_video_frame`：从一个本地视频的明确毫秒时点导出原始分辨率 PNG 或高质量 JPG；Agent 必须先确认时间点，不得猜测画面。
- `toolknit_video_gif`：从一个本地视频的明确起止毫秒生成最长 30 秒的调色板优化 GIF；支持 `quality: "high" | "balanced" | "small" | "tiny"` 控制体积，Agent 不得自行猜测精彩片段。
- `toolknit_text_stats`：统计一个本地 UTF-8 文本文件的字符、词、行、段落、句子与阅读时间；不回传正文、不写文件。
- `toolknit_color_extract`：从一张本地 PNG、JPEG 或 WebP 中提取主色板；不上传、不写文件。
- `toolknit_image_stitch`：按明确顺序把 2–100 张本地图片纵向或横向拼接；默认无缝 PNG，源文件不变，结果使用唯一文件名。

## 配色提取器

```text
请调用 ToolKnit MCP 的 toolknit_color_extract，提取当前项目 assets/cover.png 的 5 个主色。请从 IDE 文件树解析绝对路径，只在本地分析，不上传、不修改或创建文件。完成后按占比报告每种颜色的 HEX、RGB、HSL 和百分比；如果 cover.png 不唯一，请先询问我。
```

## 长图拼接

Agent 必须把 IDE 文件树中的图片解析为绝对路径，并严格保持用户给出的顺序。用户没有说明方向时使用上下拼接；没有说明间距时使用 0px；不要自行加背景、留白或改变顺序。输出目录必须是工作区内的明确绝对目录。用户指定文件名时传入不含路径和扩展名的 `output_name`；重名仍由 ToolKnit 自动追加序号。CLI/MCP 不会在内存中读取 PDF 预览页，PDF 应先明确导出为按页码排序的本地图片路径，再把这些路径原顺序传给拼接工具。

```text
请调用 ToolKnit MCP 的 toolknit_image_stitch，把当前项目 screenshots 文件夹中的 01.png、02.png、03.png 按这个顺序上下无缝拼接，统一到第一张图片的宽度，以 PNG 保存到当前项目的 toolknit-output 文件夹，文件名设为 release-walkthrough。请先从 IDE 文件树确认三个文件的绝对路径；不要上传、修改源图片或覆盖已有结果。完成后告诉我输出绝对路径和最终像素尺寸。
```

```text
请调用 toolknit_image_stitch，把 assets/left.png 和 assets/right.png 左右拼接，高度以较大图片为准，间距 16px，背景为不透明黑色，输出 JPG，质量 92。请严格保持 left 在前、right 在后，并把结果保存到当前项目的 toolknit-output 文件夹。
```

## 每次任务都说清楚

一条好指令包含四件事：输入文件路径、要执行的操作、明确的输出位置、是否允许覆盖旧文件。先让 Agent 检查文件，再让它写入结果。

## 音频格式转换

音频转换不需要上传文件，也不会修改原件。用户只要描述输入文件、目标格式、质量和输出目录；Agent 必须从 IDE 文件树取得输入的绝对路径，并把“保存到当前项目”解析为 `<工作区绝对路径>\\toolknit-output`。不要让 Agent 自己猜 MCP 工作目录。

可复制话术：

```text
请调用 ToolKnit MCP 的 toolknit_audio_convert，把当前项目 assets/访谈录音.m4a 转为高质量 MP3，输出到当前项目的 toolknit-output 文件夹。请先从 IDE 文件树解析输入与工作区的绝对路径；不要覆盖或改写原文件。完成后告诉我每个生成文件的绝对路径、大小，以及是否有任何文件转换失败。
```

Agent 应使用 `input_paths`、`output_dir`、`target_format: "mp3"` 和 `quality: "high"` 调用工具。工具会自动创建输出目录、保留已有文件并使用唯一名称；如果返回 `ENGINE_UNAVAILABLE`，说明此机器尚未提供 FFmpeg，Agent 应提示用户安装 FFmpeg 或设置 `TOOLKNIT_FFMPEG_PATH`，而不是声称已经转换成功。

## BPM 节拍测速

用户只需在 IDE 文件树中选定音频并提出测速需求。Agent 必须先把项目内相对路径解析为绝对路径，再调用 `toolknit_audio_bpm`；不能从文件名、歌曲名称或对话内容猜 BPM。这个工具仅分析前 120 秒，返回 BPM、0 到 1 的置信度和候选值，不写出新文件。

可复制话术：

```text
请调用 ToolKnit MCP 的 toolknit_audio_bpm，检测当前项目 assets/beat-demo.wav 的 BPM。请从 IDE 文件树解析它的绝对路径，只进行本地分析，不要上传、转换、修改或生成文件。完成后报告主 BPM、置信度、候选 BPM、实际分析了多少秒；如果没有可靠节拍，请明确说明，而不要猜测一个数字。
```

当用户说“检测当前项目里的这首歌节拍”时，Agent 应先确认对应文件唯一；若存在多个候选音频，应询问用户。遇到 `ENGINE_UNAVAILABLE` 时，提示配置 FFmpeg；遇到 `INPUT_INVALID` 时，解释格式、大小、时长或声道限制，不要伪造分析结果。

## 音频剪辑

用户可以自然地说“保留第 12.5 秒到第 47 秒”。Agent 必须先确认文件唯一，再把起止时间转换成明确的秒数；“前半段”“高潮部分”等没有精确边界的描述必须先追问，不能猜测。输出应放在当前工作区的 `toolknit-output` 并使用绝对路径。

```text
请调用 ToolKnit MCP 的 toolknit_audio_clip，把当前项目 assets/interview.m4a 从第 12.5 秒裁切到第 47 秒，输出到当前项目的 toolknit-output。请先从 IDE 文件树解析绝对路径，不要改动原件，也不要覆盖已有文件。完成后报告输出路径、实际片段时长、格式，以及是否保留了原编码；若回退为 MP3，请明确说明原因。
```

## 从视频提取音频

```text
请调用 ToolKnit MCP 的 toolknit_audio_extract，将当前项目 assets/demo.mp4 的第 0 条音轨提取为高质量 MP3，输出到当前项目 toolknit-output。请先从 IDE 文件树解析绝对路径，不要修改源视频，也不要覆盖已有文件。完成后报告输出文件、格式、音轨序号和任何失败原因。若视频有多条音轨而我没有指定，请先向我确认要使用的音轨序号，不要猜测。
```

## 视频格式转换

用户可直接说“把当前项目里的录屏转成 MP4”。Agent 必须从 IDE 文件树取得输入与工作区的绝对路径；目标格式和输出目录必须明确，不能依赖 MCP 的当前目录。单批多个文件时，需在结果中报告每个文件的输出或失败原因。

```text
请调用 ToolKnit MCP 的 toolknit_video_convert，把当前项目 recordings 目录中的 demo.mov 和 intro.webm 转换为 MP4，输出到当前项目 toolknit-output。请从 IDE 文件树解析全部绝对路径，不要改动原文件，也不要覆盖已有文件。完成后逐个报告输出路径、大小、所用视频/音频编码器和失败原因；若我没有明确目标格式或文件不唯一，请先询问，不要猜测。
```

Agent 应传入 `input_paths`、`output_dir` 和 `target_format: "mp4"`。转换全程在本机通过 FFmpeg 完成；结果的 `hardware_acceleration` 字段会如实说明是否使用硬件加速。遇到 `ENGINE_UNAVAILABLE` 时提示配置 FFmpeg，遇到部分失败时不能把整批描述成“全部成功”。

## 视频高清单帧图

用户可直接说“导出第 12.5 秒的画面”。Agent 必须先从 IDE 文件树解析唯一的视频绝对路径，再将时间明确转换为毫秒；“导出开头最好看的画面”这类描述必须要求用户在桌面预览中选定时间点，不能猜测。

```text
请调用 ToolKnit MCP 的 toolknit_video_frame，从当前项目 recordings/demo.mp4 的第 12500 毫秒导出一张 PNG 无损单帧图，输出到当前项目 toolknit-output。请从 IDE 文件树解析绝对路径，不要修改源视频，也不要覆盖已有图片。完成后报告输出路径、导出时间点、格式和文件大小；若视频文件不唯一或时间点不明确，先询问我。
```

Agent 应传入 `input_path`、`output_dir`、`timestamp_ms: 12500` 和可选 `format: "png"` 或 `"jpg"`。导出只在本机通过 FFmpeg 进行，结果保持解码后的原始画面分辨率，并采用唯一文件名。

## 视频截取 GIF

用户可以说“把第 5 秒到第 12.5 秒做成小一点的 GIF”。Agent 必须把起止时间转换为明确毫秒，并在用户要求“小一点/适合网页/别太大”时优先使用 `width: 360` 或 `480`、`frame_rate: 6` 或 `8`、`quality: "small"` 或 `"tiny"`；如果用户没有给起止点，必须先询问或让用户在桌面端预览确认。

```text
请调用 ToolKnit MCP 的 toolknit_video_gif，把当前项目 recordings/demo.mp4 从第 5000 毫秒到第 12500 毫秒导出为小体积 GIF，输出到当前项目 toolknit-output。请从 IDE 文件树解析绝对路径，不要修改源视频，也不要覆盖已有文件。使用 8 FPS、480px 宽度、quality small。完成后报告输出路径、时长、帧率、宽度、质量和文件大小。
```

Agent 应传入 `input_path`、`output_dir`、`start_ms`、`end_ms`，以及可选 `frame_rate`、`width`、`quality`。选区最多 30 秒，源视频不会被修改；遇到 FFmpeg 缺失时提示用户在设置中补齐依赖，而不是假装成功。

## 文本统计器

用户可自然地说“统计当前项目 README 的字数和段落数”。Agent 必须从 IDE 文件树解析唯一的 UTF-8 文本路径，再调用工具；不要把整篇正文放进 MCP 参数，也不要从聊天内容复制不完整文本。工具不创建文件且结果不回显正文。

```text
请调用 ToolKnit MCP 的 toolknit_text_stats，统计当前项目 README.md 的字符数、中文字符数、英文词数、行数、段落数、句子数和预计阅读时间。请先从 IDE 文件树解析其绝对路径；只在本地分析，不上传、不修改、不创建文件，也不要在结果中复述原文。如果项目中存在多个 README 候选文件，请先让我选择。
```

## 在 IDE 当前项目中生成（推荐）

用户不需要手动输入完整路径，可以直接说“保存到当前项目”。IDE Agent 应先取得当前工作区根目录，再把它转换为明确的绝对路径，例如：

```text
<当前工作区绝对路径>\toolknit-output\产品方案.pdf
```

`toolknit-output` 不存在时 ToolKnit 会自动创建。Agent 不得使用 MCP 进程当前目录代替 IDE 工作区，也不得猜测工作区之外的路径。输入文件已经位于项目内时，Agent 同样应从 IDE 文件树解析它的绝对路径，再传给 ToolKnit。

生成成功后，左侧文件树会显示以下内容：

```text
toolknit-output/
  产品方案.pdf
  产品方案.toolknit.json
  产品方案.toolknit/
    preview/page-01.png
    demo/controls-overview.png
    demo/page-01-controls.png
    demo/page-02-controls.png
```

修改时优先打开 `page-01-controls.png` 这类逐页高清编号图，而不是缩放总览图。然后可直接说“把 P1-03 和 P1-05 换位”或“把 P2-04 的背景改为黑色、文字改为白色”。Agent 仍须先 inspect 和 dry-run，不能只根据图片猜测控件。

可复制话术：

```text
请使用 ToolKnit MCP 把结果保存到当前 IDE 项目的 toolknit-output 文件夹。请先从 IDE 工作区取得绝对路径，不要使用 MCP 进程当前目录。生成后告诉我 PDF、工程文件和每一页高清编号图的路径，让我可以从左侧文件树直接打开编号图继续修改。
```

## 完整示例：先生成无图初稿，再插图和删除组件

这是推荐的完整工作流。自然语言由 IDE Agent 解释，ToolKnit 负责确定性的工程修改和 PDF 渲染。用户不需要手写 JSON，也不需要自己计算坐标。

### 第一步：生成明确无图的初稿

```text
请调用 ToolKnit MCP，在当前 IDE 项目的 toolknit-output 中生成一份 3 页中文 A4 PDF《项目执行方案》，不要覆盖已有文件。初稿不得包含图片、图片占位符或 image 控件。生成后检查真实页数，并 inspect 工程，确认 image 类型控件数量为 0。告诉我 PDF、工程文件和每一页高清编号图的绝对路径。
```

Agent 应解析工作区绝对路径，依次调用 `toolknit_ai_document`、`toolknit_pdf_inspect` 和 `toolknit_ai_document_inspect`。如果初稿仍出现 image 控件，Agent 应报告未满足要求，不得假装它是无图初稿。

### 第二步：从 IDE 文件树打开编号图

打开 `toolknit-output/项目执行方案.toolknit/demo/page-02-controls.png`。可以直接使用图上的编号，也可以用唯一的标题文字描述位置。例如以下两句话都有效：

```text
请在 P2-04 后面插入当前项目 assets/执行流程.png，显示宽 520、高 150。
```

```text
请在第二页“执行流程”标题后面插入当前项目 assets/执行流程.png，显示宽 520、高 150。如果这个标题不是唯一匹配，先问我，不要猜。
```

Agent 必须先 inspect。语义描述只匹配到一个控件时，可将项目内图片路径解析为绝对路径，并转换为以下操作；匹配到多个控件时必须让用户确认编号。

```json
[
  {
    "type": "insert_control",
    "after": "P2-04",
    "control": {
      "type": "image",
      "source_path": "<工作区绝对路径>\\assets\\执行流程.png",
      "label": "执行流程",
      "w": 520,
      "h": 150
    }
  }
]
```

图片必须是小于或等于 10 MB 的本地 PNG 或 JPEG。Agent 先以 `dry_run=true` 检查，再提交完全相同的操作。如果出现 `page_count_changed`、越界、重叠或低分辨率诊断，不得强行提交；应说明原因，并建议缩小图片、选择其他位置或在用户同意后删除不需要的内容。

### 第三步：用自然语言删除一个组件

```text
请删除第三页编号图里的 P3-06“补充说明”。先 inspect 确认编号和文字，再 dry-run；没有 error 后正式提交。不要删除其他控件，完成后告诉我新修订号和更新后的第三页编号图路径。
```

Agent 转换出的操作应只有一项：

```json
[
  { "type": "delete_control", "control": "P3-06" }
]
```

删除后该编号不会分配给新控件，其他控件编号也不会因为删除而重排。图片仍保存在工程资源中，以便修订历史和撤销继续工作。误删时直接说“撤销上一次修改”即可。

### 用户应看到的完成结果

- 初始工程中 image 控件为 0。
- 插图后修订号增加，目标位置出现新的稳定编号，原图被复制到工程资源目录。
- 删除后修订号再次增加，目标编号消失，其他编号保持稳定。
- 每次正式修改后 PDF、干净预览和逐页高清编号图都会一起刷新，真实 PDF 页数保持不变。

## 可复制话术

### 查看 PDF

```text
请使用 ToolKnit MCP 检查 <输入 PDF 路径>。告诉我页数和文件大小；不要修改文件。
```

### 提取第 2 页

```text
请使用 ToolKnit MCP，先检查 <输入 PDF 路径>，再只提取第 2 页，输出到 <输出文件夹>。不要覆盖已有文件。
```

### 提取多页

```text
请使用 ToolKnit MCP，先检查 <输入 PDF 路径>，再提取第 1、3 到 5 页，输出到 <输出文件夹>。不要覆盖已有文件。
```

### 合并 PDF

```text
请使用 ToolKnit MCP，先检查 <PDF 1 路径> 和 <PDF 2 路径>，再按这个顺序合并，输出为 <输出 PDF 路径>。不要覆盖已有文件。
```

### 旋转 PDF

```text
请使用 ToolKnit MCP，先检查 <输入 PDF 路径>，再将全部页面顺时针旋转 90 度，输出为 <输出 PDF 路径>。不要覆盖已有文件。
```

### 压缩 PDF

```text
请使用 ToolKnit MCP，先检查 <输入 PDF 路径>，再以 high 等级压缩，输出为 <输出 PDF 路径>。不要覆盖已有文件。
```

### 增强扫描件

```text
请使用 ToolKnit MCP，先检查 <扫描件 PDF 路径>，再以 medium 强度增强，输出为 <输出 PDF 路径>。我知道增强会重新栅格化页面，不要求保留可搜索文字、链接或表单。
```

### 生成多页 AI 文档

```text
请务必调用 ToolKnit MCP 的 toolknit_ai_document，不要只在对话中编写内容。

生成一份 4 页中文 A4 PDF《ToolKnit v1.2 开源版本产品方案》，输出到 D:\ToolKnit-Output\ToolKnit-v1.2-产品方案.pdf，不允许覆盖已有文件。

文档要求：
1. 第 1 页为执行摘要，包含项目背景、版本目标、目标用户和 5 项核心价值，并用信息表格展示版本号、发布形态、技术栈和开源定位。
2. 第 2 页介绍桌面版能力，按 PDF、图片、音视频、文本和 AI 工具分组，说明本地优先、隐私和性能策略；不要虚构未经提供的用户量或市场数据。
3. 第 3 页介绍 CLI 与 IDE Agent/MCP 架构，说明桌面端与 CLI 共用能力契约、显式输出路径、禁止静默覆盖、结构化进度和错误码，并用表格列出典型调用场景。
4. 第 4 页给出 v1.2 发布计划、风险、验收标准和后续路线，待办事项必须包含责任角色、优先级和验收结果。
5. 使用现代黑白商务版式，包含清晰章节、元信息表格、重点摘要、待办表格和克制的注释区域；不要使用彩色装饰、emoji、占位文字或虚假引用。
6. page_count 必须传 4，locale 传 zh-CN，overwrite 传 false。

生成完成后，报告 PDF、`.toolknit.json` 工程文件、干净预览目录、每一页 `page-XX-controls.png` 高清编号图以及 `controls-overview.png` 总览图的绝对路径。再调用 `toolknit_pdf_inspect`，确认真实 PDF 恰好为 4 页。如果生成或校验失败，原样报告 ToolKnit 的结构化错误，不要假装成功，也不要改用其他文档生成方式。
```

## 精确修改 AI 文档

ToolKnit 自己生成的 AI 文档是可编辑工程。`P1-01` 这类编号属于控件本身；交换位置后编号仍跟随原控件。不要直接改工程 JSON，也不要根据截图猜坐标。

Agent 必须遵循以下顺序：

1. 先调用 `toolknit_ai_document_inspect`，确认当前修订和目标控件。
2. 把用户要求转换为结构化 `operations`，先用 `dry_run=true` 检查。
3. 向用户报告将要修改的控件、变更清单以及越界、重叠、文字溢出、低对比度或低分辨率图片警告。
4. 用户已明确要求执行时，用相同操作和 `dry_run=false` 提交；不要悄悄增加其他修改。
5. 提交后报告新修订号以及 PDF、预览和编号图路径。需要回退时使用单独的 `undo` 操作。

### 交换位置并改变颜色

```text
请使用 ToolKnit MCP 修改 <工程文件.toolknit.json>。先 inspect，不要根据截图猜测。

把 P1-01 和 P1-02 交换位置；再把 P1-01 的背景设为 #000000、文字设为 #FFFFFF、字号设为 32。先以 dry_run=true 检查并告诉我变更清单和所有诊断；没有 error 后，再用完全相同的 operations 正式提交。不要修改其他控件。
```

### 修改表格样式

```text
请先 inspect <工程文件.toolknit.json>，确认 P2-04 是我要修改的表格行。将它的分隔线粗细设为 2、分隔线颜色设为 #111111、背景色设为 #F2F2F2。先 dry-run，确认没有越界、重叠和低对比度问题后提交，并报告新修订号。
```

### 在两个控件之间插入图片

```text
请使用 ToolKnit MCP，在 <工程文件.toolknit.json> 的 P1-02 后、P1-03 前插入图片控件，图片来源是 <本地 PNG 或 JPEG 绝对路径>，宽 320、高 180。先 inspect，再 dry-run；检查图片分辨率和页面溢出后提交。不要用 base64，也不要把原图内容写进对话。
```

### 修改文字并锁定

```text
请先 inspect <工程文件.toolknit.json>。将 P3-05 的文字改为“<新文字>”，字号设为 16，然后把该控件锁定。先 dry-run 后提交，不要改动它的位置或其他样式。
```

### 撤销或重新渲染

```text
请使用 toolknit_ai_document_edit 对 <工程文件.toolknit.json> 执行唯一操作 {"type":"undo","steps":1}，恢复上一次修改，但保留修订历史。完成后报告新的修订号。
```

```text
请使用 toolknit_ai_document_render 从 <工程文件.toolknit.json> 重新生成 PDF、干净预览和编号图。不要改变工程内容，也不要创建新修订。
```

### 生成可编辑表格

```text
请务必调用 ToolKnit MCP 的 toolknit_ai_table，不要只在对话里写表格。

请在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文 A4 表格《项目进度表》，导出为 xlsx，不要覆盖已有文件。表格需要包含状态图表；生成后告诉我导出文件、工程文件和预览图的绝对路径，并 inspect 一次确认行号、列号和图表号都存在。
```

### 按编号修改表格

```text
请使用 ToolKnit MCP 修改 <工程文件.toolknit-table.json>。先 inspect，不要根据预览图猜测。

把 R01 和 R02 交换位置；再把 C02 的标题改成“负责人”；把 R01 的 C02 列值改为“张三”；最后把 G01 的标题改成“完成率趋势”。先 dry-run 并报告诊断，没有 error 后再用完全相同的 operations 正式提交，并告诉我新的预览图路径。
```

### 表格修改规则

- `R01`、`C01`、`G01` 这类编号属于行、列和图表本身；交换顺序或删除后编号不会因为位置改变而重排。
- 修改表格时优先 inspect 和预览；如果语义描述匹配到多个目标，Agent 必须先问用户。
- 图表修改必须指向稳定的图表编号或 id，不能只靠预览图猜坐标。
- 输出路径应始终明确；没有明确授权时，Agent 不应覆盖任何已有文件。

## 离线音视频转写

音视频转写使用本地 Whisper 模型。Agent 不得假设模型已经安装，也不得未经用户确认下载大文件。

1. 先调用 `toolknit_model_list`。
2. 没有可用模型时，说明推荐 `small` 的下载大小并请求用户确认；确认后调用 `toolknit_model_install`，默认 `source=auto`。
3. 确认输入媒体与输出目录的绝对路径后，调用 `toolknit_transcribe`；默认 `language=auto`，仅当用户明确指定时使用 `zh` 或 `en`。
4. 报告原始 JSON、SRT、TXT 的绝对路径。不要声称模型能保证听清专有名词、数字或低质量音频。

```text
请使用 ToolKnit MCP。先列出本地离线识别模型；如果没有可用模型，告诉我推荐下载 Small 模型以及它的大小，等待我确认后再下载。确认后，将 <输入音频或视频绝对路径> 离线转写为中文，输出到 <项目内 toolknit-output 绝对路径>。完成后报告原始 JSON、SRT、TXT 的绝对路径；不要上传媒体文件，不要覆盖已有文件。
```

## 密码文件

PDF 加密和解密需要密码。不要将密码粘贴到 Agent 对话、共享记录或任务描述中。优先使用 ToolKnit 桌面端处理密码保护的 PDF；若确实需要使用 Agent，明确要求它不回显、不复述、不记录密码。

## 遇到问题

让 Agent 先检查文件路径；路径不存在、输出文件已存在、PDF 受密码保护，是最常见的失败原因。`toolknit doctor` 可检查 qpdf 引擎是否可用于压缩与解密。
