#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { normalizeBannerMode, renderToolKnitBanner } from './lib/banner.mjs';
import { errorPayload, EXIT_CODES, ToolKnitError, toToolKnitError } from './lib/errors.mjs';
import { startMcpServer } from './lib/mcp-server.mjs';
import { checkQpdfAvailability, compressPdfFile, decryptPdfFile, encryptPdfFile, enhancePdfFile, inspectPdf, mergePdf, rotatePdf, splitPdf } from './lib/pdf-runtime.mjs';
import { convertPdfToImages } from './lib/pdf-to-image-runtime.mjs';
import { checkFfmpegAvailability, convertAudioBatch } from './lib/audio-runtime.mjs';
import { detectAudioBpm } from './lib/bpm-runtime.mjs';
import { clipAudio } from './lib/audio-clip-runtime.mjs';
import { extractAudio } from './lib/audio-extract-runtime.mjs';
import { convertVideoBatch } from './lib/video-runtime.mjs';
import { extractVideoFrame } from './lib/video-frame-runtime.mjs';
import { extractVideoGif } from './lib/video-gif-runtime.mjs';
import { analyzeTextFile, analyzeTextStats, readUtf8Stdin } from './lib/text-stats-runtime.mjs';
import { extractColorPalette } from './lib/color-extract-runtime.mjs';
import { stitchImages } from './lib/image-stitch-runtime.mjs';
import { extractPptImages } from './lib/ppt-image-extract-runtime.mjs';
import { extractPptText } from './lib/ppt-text-extract-runtime.mjs';
import { compressPpt } from './lib/ppt-compress-runtime.mjs';
import { convertPptToPdf } from './lib/ppt-to-pdf-runtime.mjs';
import { convertPptToImages } from './lib/ppt-to-image-runtime.mjs';
import { generatePptOutline } from './lib/ppt-outline-runtime.mjs';
import { generatePptDraft } from './lib/ppt-draft-runtime.mjs';
import {
  inspectCpuMemoryInfo,
  inspectCpuMemoryLiveStats,
  inspectGpuDisplayInfo,
  inspectHardwareOverview,
  inspectMainboardFirmwareInfo,
  inspectNetworkDevicesInfo,
  inspectPowerSensorsInfo,
  inspectStorageHealthInfo
} from './lib/hardware-runtime.mjs';
import { editAiDocumentProject, inspectAiDocumentProject, renderAiDocumentProject } from './lib/ai-document-project-runtime.mjs';
import { generateAiDocument } from './lib/ai-document-runtime.mjs';
import { editAiTableProject, generateAiTableProject, inspectAiTableProjectFile, renderAiTableProject } from './lib/ai-table-project-runtime.mjs';
import { installTranscriptionModel, listTranscriptionModels, setCurrentTranscriptionModel, transcribeMedia } from './lib/transcription-runtime.mjs';
import { TaskRunner } from './lib/shared/task-runtime.mjs';

const VERSION = '3.1.0';
const CLI_ABORT_CONTROLLER = new AbortController();
let CLI_SIGNAL_COUNT = 0;

function requestCliCancellation(signal) {
  CLI_SIGNAL_COUNT += 1;
  if (!CLI_ABORT_CONTROLLER.signal.aborted) {
    process.stderr.write(`\nToolKnit received ${signal}. Cancelling the current task...\n`);
    CLI_ABORT_CONTROLLER.abort(`Received ${signal}.`);
    return;
  }
  if (CLI_SIGNAL_COUNT > 1) {
    process.stderr.write('\nToolKnit received a second termination signal. Exiting now.\n');
    process.exitCode = 130;
  }
}

process.once('SIGINT', () => requestCliCancellation('SIGINT'));
process.once('SIGTERM', () => requestCliCancellation('SIGTERM'));
const HELP = `ToolKnit CLI ${VERSION}

用法：
  toolknit pdf <工具> [参数]
  toolknit audio <convert|bpm|clip|extract> [参数]
  toolknit transcribe --input <audio-or-video> --output-dir <directory> [--language auto|zh|en] [--refine]
  toolknit model <list|install|use> [参数]
  toolknit video <convert|frame|gif> [参数]
  toolknit text stats [参数]
  toolknit image <colors|stitch> [参数]
  toolknit ppt <images|text|compress|to-pdf|to-image|outline|draft> [参数]
  toolknit hardware <overview|cpu-memory|cpu-memory-live-stats|gpu-display|mainboard-firmware|storage-health|network-devices|power-sensors> [参数]
  toolknit ai-doc <create|inspect|edit|undo|render> [参数]
  toolknit ai-table <create|inspect|edit|undo|render> [参数]
  toolknit agent guide [--lang zh|en]
  toolknit doctor [--json]
  toolknit mcp serve

PDF 工具：
  inspect   查看 PDF 页数、名称和大小
  merge     合并两个或更多 PDF，可选择每个文件中的页码
  split     将指定页拆分为独立 PDF
  rotate    旋转全部页或逐页指定旋转角度
  encrypt   使用密码加密 PDF
  decrypt   使用密码解密 PDF
  compress  通过 qpdf 压缩 PDF
  enhance   增强扫描件的视觉效果
  to-image  将 PDF 页面导出为逐页图像或拼接长图

音频工具：
  convert   将一个或多个本地音频文件转换为 MP3、AAC、WAV、FLAC、ALAC 或 OGG

视频工具：
  convert   将一个或多个本地视频转换为 MP4、AVI、MKV、MOV、WebM、FLV、WMV 或 TS
  frame     从本地视频按精确毫秒导出一张原始分辨率 PNG 或 JPG
  gif       从本地视频的明确起止时间生成最长 30 秒 GIF

文本工具：
  stats     统计一个 UTF-8 文本文件或标准输入，不写出文件

图像工具：
  colors    提取 PNG、JPEG 或 WebP 的主色板，不写出文件
  stitch    将 2–100 张图片纵向或横向拼接为 PNG/JPG

PPT 工具：
  images    提取 PPTX 内嵌图片素材，支持页码、素材编号和跳过重复项
  text      提取 PPTX 标题、正文和备注，可选 AI 整理
  compress  安全压缩 PPTX，保留图片质量并输出 manifest
  to-pdf    使用 LibreOffice 将 PPTX 渲染为 PDF
  to-image  使用 LibreOffice + PDF 渲染链路将 PPTX 页面导出为图像
  outline   根据文字资料生成结构化 PPT 大纲
  draft     根据文字资料或 outline.json 生成可编辑 PPTX 草稿

硬件工具：
  overview               查看整机、系统、核心硬件和固件概况
  cpu-memory             查看 CPU 规格、内存拓扑和内存条信息
  cpu-memory-live-stats  查看当前 CPU 与内存实时状态
  gpu-display            查看显卡、驱动和显示器信息
  mainboard-firmware     查看主板、BIOS/UEFI、安全启动、TPM 和 PCI 设备
  storage-health         查看磁盘、卷、容量和可读健康状态
  network-devices        查看网卡、蓝牙、音频、USB 和摄像头
  power-sensors          查看电源计划、电池、温区和风扇等传感器

查看说明：
  toolknit pdf --help
  toolknit pdf merge --help
  toolknit audio --help
  toolknit audio convert --help
  toolknit audio bpm --help
  toolknit audio clip --help
  toolknit audio extract --help
  toolknit transcribe --help
  toolknit model --help
  toolknit video --help
  toolknit video convert --help
  toolknit video frame --help
  toolknit video gif --help
  toolknit text --help
  toolknit text stats --help
  toolknit image colors --help
  toolknit image stitch --help
  toolknit ppt images --help
  toolknit ppt text --help
  toolknit ppt compress --help
  toolknit ppt to-pdf --help
  toolknit ppt to-image --help
  toolknit hardware --help
  toolknit hardware overview --help
  toolknit hardware cpu-memory --help
  toolknit hardware cpu-memory-live-stats --help
  toolknit hardware gpu-display --help
  toolknit hardware mainboard-firmware --help
  toolknit hardware storage-health --help
  toolknit hardware network-devices --help
  toolknit hardware power-sensors --help
  toolknit help hardware
  toolknit pdf to-image --help
  toolknit ai-doc --help
  toolknit ai-table --help
  toolknit help pdf merge
  toolknit help audio convert
  toolknit help audio bpm
  toolknit help audio clip
  toolknit help audio extract
  toolknit help transcribe
  toolknit help model
  toolknit help mcp
  toolknit help video convert
  toolknit help video frame
  toolknit help video gif
  toolknit help text stats
  toolknit help image colors
  toolknit help image stitch
  toolknit help ppt images
  toolknit help ppt text
  toolknit help ppt compress
  toolknit agent guide [--lang zh|en]

安全默认值：所有写入操作都必须显式指定输出位置；已有文件必须附加 --overwrite 才会被替换；CLI 密码只从标准输入读取，绝不接受命令行密码。

显示控制：--banner auto|always|never。JSON、管道输出和 MCP 模式不会输出横幅或 ANSI 色彩。`;

const PDF_OVERVIEW = `ToolKnit PDF 工具

用法：
  toolknit pdf <工具> [参数]

工具：
  inspect   查看 PDF 页数、名称和大小
  merge     合并两个或更多 PDF，可选择每个输入文件的页码
  split     将指定页面拆分为独立 PDF
  rotate    旋转整个 PDF，或按页面单独旋转
  encrypt   使用标准输入中的密码加密 PDF
  decrypt   使用标准输入中的密码解密 PDF
  compress  使用 qpdf 压缩 PDF
  enhance   增强扫描件；输出会被重新栅格化
  to-image  将 PDF 页面导出为逐页图像或拼接长图

示例：
  toolknit pdf inspect --input .\\report.pdf --json
  toolknit pdf merge --input .\\part-a.pdf --input .\\part-b.pdf --output .\\merged.pdf
  toolknit pdf split --input .\\report.pdf --pages 1,3-5 --output-dir .\\pages
  toolknit pdf to-image --input .\\report.pdf --output-dir .\\toolknit-output --mode long --pages 1-5 --json

详细参数：
  toolknit pdf <工具> --help
  toolknit help pdf <工具>`;

const PDF_COMMAND_HELP = {
  inspect: `PDF 查看（inspect）

用法：
  toolknit pdf inspect --input <file.pdf> [--json] [--banner auto|always|never]

输出 PDF 的规范路径、文件名、字节大小和页数，不修改文件。

示例：
  toolknit pdf inspect --input .\\report.pdf --json`,

  merge: `PDF 合并（merge）

用法：
  toolknit pdf merge --input <a.pdf> --input <b.pdf> [--input <more.pdf>] --output <merged.pdf> [--page-selections <json>] [--overwrite] [--json]

默认按输入顺序合并所有页面。--page-selections 仅列出需要部分选择的文件；input_index 从 0 开始，pages 从 1 开始。

示例：
  toolknit pdf merge --input .\\first.pdf --input .\\second.pdf --output .\\merged.pdf
  toolknit pdf merge --input .\\first.pdf --input .\\second.pdf --output .\\selected.pdf --page-selections '[{"input_index":0,"pages":[1,3]}]'

安全：至少需要两个输入文件；输出路径必须明确，已有文件需附加 --overwrite。`,

  split: `PDF 拆分（split）

用法：
  toolknit pdf split --input <file.pdf> --pages <1,3-5> --output-dir <directory> [--overwrite] [--json]

--pages 使用逗号分隔的页码或范围，页码从 1 开始；每个选中的页面会生成一个独立 PDF。

示例：
  toolknit pdf split --input .\\report.pdf --pages 1,3-5 --output-dir .\\pages

安全：输出目录内已有同名文件时会拒绝写入，除非附加 --overwrite。`,

  rotate: `PDF 旋转（rotate）

用法：
  toolknit pdf rotate --input <file.pdf> --output <rotated.pdf> [--rotation <90|180|270>] [--page-rotations <json>] [--overwrite] [--json]

未指定 --page-rotations 时，所有页面按 --rotation 旋转，默认 90 度。逐页旋转 JSON 的页面从 1 开始。

示例：
  toolknit pdf rotate --input .\\report.pdf --output .\\rotated.pdf --rotation 90
  toolknit pdf rotate --input .\\report.pdf --output .\\rotated.pdf --page-rotations '[{"page":1,"rotation":90},{"page":2,"rotation":180}]'`,

  encrypt: `PDF 加密（encrypt）

用法：
  <安全密码来源> | toolknit pdf encrypt --input <file.pdf> --output <encrypted.pdf> --password-stdin [--overwrite] [--json]

密码只能从标准输入读取，不能写入命令行历史。请使用密码管理器或受控输入程序提供密码；ToolKnit 不会将密码写入结果、日志、临时文件或输出文件名。`,

  decrypt: `PDF 解密（decrypt）

用法：
  <安全密码来源> | toolknit pdf decrypt --input <file.pdf> --output <decrypted.pdf> --password-stdin [--overwrite] [--json]
  toolknit pdf decrypt --input <file.pdf> --output <decrypted.pdf> [--overwrite] [--json]

未加密 PDF 不需要 --password-stdin。受密码保护的 PDF 必须由受控的标准输入提供密码；密码不会出现在结果、日志或文件名中。

注意：不要把密码作为命令行参数传入。`,

  compress: `PDF 压缩（compress）

用法：
toolknit pdf compress --input <file.pdf> --output <compressed.pdf> [--mode structure|raster] [--level low|medium|high] [--target-kb N | --target-mb N] [--clarity readable|compact] [--overwrite] [--json]

structure 默认保留文字、链接、表单等结构。raster 显式进行有损图像化，不保留文字搜索、链接、表单、书签及无障碍标签。
目标范围为 50 KB 至 50 MB（1 KB = 1024 字节），未达标不生成文件；原文件已达标时不重新编码。
raster 指定目标时自动搜索参数，level 仅用于不指定目标的情况。readable 最低 72 DPI，compact 最低 36 DPI；均不保证文字可读性。

压缩等级默认为 medium。此功能依赖 qpdf；请先运行 toolknit doctor 确认 qpdf 可用。

示例：
  toolknit pdf compress --input .\\report.pdf --output .\\report-smaller.pdf --level high`,

  enhance: `PDF 增强（enhance）

用法：
  toolknit pdf enhance --input <file.pdf> --output <enhanced.pdf> [--strength <light|medium|strong>] [--overwrite] [--json]

增强等级默认为 medium，适用于扫描件或以图像为主的 PDF。此功能会重新栅格化页面，因此不保留可搜索文本、链接、表单和原生矢量内容。

示例：
  toolknit pdf enhance --input .\\scan.pdf --output .\\scan-enhanced.pdf --strength medium`,

  'to-image': `PDF 转图像（to-image）

用法：
  toolknit pdf to-image --input <file.pdf> --output-dir <directory> [--pages <1,3-5>] [--mode images|long] [--format png|jpg|webp] [--clarity standard|high|print] [--output-name <name>] [--json]

--mode images 会把每一页单独导出为图像；--mode long 会把所选页面按顺序拼接成长图，默认每 5 页生成一张。未指定 --pages 时，images 会导出全部页面，long 会在页面数不超过 20 时导出全部页面。

示例：
  toolknit pdf to-image --input .\\report.pdf --output-dir .\\toolknit-output --json
  toolknit pdf to-image --input .\\report.pdf --output-dir .\\toolknit-output --mode long --pages 1,2,3,4,5 --format webp --clarity print --output-name report-walkthrough`
};

const AUDIO_OVERVIEW = `ToolKnit 音频工具

用法：
  toolknit audio convert --input <file> [--input <more-files>] --output-dir <directory> --format <mp3|aac|wav|flac|alac|ogg> [--quality <low|medium|high>] [--json]
  toolknit audio bpm --input <file> [--json]
  toolknit audio clip --input <file> --start <seconds> --end <seconds> --output-dir <directory> [--format mp3] [--json]
  toolknit audio extract --input <video> --output-dir <directory> --format <mp3|aac|wav|flac|ogg> [--track-index <0-31>] [--quality <low|medium|high>] [--json]
  toolknit transcribe --input <audio-or-video> --output-dir <directory> [--language auto|zh|en] [--refine] [--json]

说明：
  转换会逐个处理最多 100 个本地常见音频文件。AAC 与 ALAC 输出为 .m4a；WAV 和 ALAC 为固定无损编码，质量档位不改变其编码。
  每个结果先写入同目录临时文件，确认 FFmpeg 成功后再以唯一名称发布；不会覆盖输入文件或已有输出。

示例：
  toolknit audio convert --input .\\demo.wav --output-dir .\\toolknit-output --format mp3 --quality high
  toolknit audio convert --input .\\voice.m4a --input .\\music.flac --output-dir .\\converted --format ogg --json
  toolknit audio bpm --input .\\beat.wav --json
  toolknit audio clip --input .\\meeting.m4a --start 12.5 --end 47 --output-dir .\\toolknit-output
  toolknit audio extract --input .\\lesson.mp4 --output-dir .\\toolknit-output --format mp3 --track-index 0 --quality high
  toolknit transcribe --input .\\meeting.mp4 --output-dir .\\toolknit-output --language zh

运行时：
  音频转换需要 FFmpeg。CLI 会依次使用 TOOLKNIT_FFMPEG_PATH、ToolKnit Desktop 设置页下载的共享运行时、开发仓库资源或系统 PATH。

详细参数：
  toolknit audio <convert|bpm|clip|extract> --help
  toolknit help audio <convert|bpm|clip|extract>`;

const TRANSCRIBE_HELP = `音视频提取文字（transcribe）

用法：
  toolknit model install <base|small|medium> [--source auto|official|china]
  toolknit model use <base|small|medium>
  toolknit transcribe --input <audio-or-video> --output-dir <directory> [--language auto|zh|en] [--refine] [--json]

首次使用先下载一个模型。推荐 small：中英文识别质量和体积更平衡。模型下载到当前用户的 ToolKnit 数据目录，桌面端和 CLI 共用，不需要 Python、CUDA 或 Hugging Face CLI。

转写始终在本地进行，输出始终包含原始 JSON、SRT、TXT。识别支持 MP3、M4A、WAV、FLAC、OGG 以及 MP4、MKV、MOV、AVI、WebM 等常见音视频。可选 --refine 只把已识别文字发送给配置的 AI 服务进行标点和语法校对，不上传媒体文件，并保留原始结果、分段编号与时间码。

示例：
  toolknit model install small --source auto
  toolknit transcribe --input .\\interview.mp4 --output-dir .\\toolknit-output --language zh --refine --json`;

const MODEL_HELP = `离线模型管理（model）

用法：
  toolknit model list [--json]
  toolknit model install <base|small|medium> [--source auto|official|china] [--json]
  toolknit model use <base|small|medium> [--json]

下载源：auto 先使用 Hugging Face 官方源，失败时自动切换至 hf-mirror 国内镜像；每次安装均校验 SHA-256。模型只存放在本机。`;

const MCP_HELP = `ToolKnit MCP 服务

用法：
  toolknit mcp serve

此命令通过标准输入和标准输出提供 MCP 服务，供 Trae、Cursor 等 IDE Agent 调用。不要在终端中手动输入处理请求；请在 IDE 的 MCP 配置里将 command 设为 toolknit，并将 args 设为 ["mcp", "serve"]。

离线转写：Agent 应先调用 toolknit_model_list。模型未安装时，必须先说明下载体积并征得用户同意，才能调用 toolknit_model_install。转写会始终保留原始 JSON、SRT、TXT；开启 refine 时只发送识别出的文字给已配置的 AI 平台，绝不上传媒体文件。

完整中英文自然语言示例和 IDE 配置请运行：
  toolknit agent guide
  toolknit agent guide --lang en`;

const AUDIO_COMMAND_HELP = {
  convert: `音频格式转换（convert）

用法：
  toolknit audio convert --input <file> [--input <more-files>] --output-dir <directory> --format <mp3|aac|wav|flac|alac|ogg> [--quality <low|medium|high>] [--json] [--banner auto|always|never]

输入：
  支持 mp3、aac、m4a、wav、flac、alac、ogg、wma。输入必须是非空普通文件，不能是符号链接；单个文件最大 10 GB，单批最多 100 个。

输出：
  --output-dir 必须明确指定。MP3、WAV、FLAC、OGG 各输出对应扩展名，AAC、ALAC 输出 .m4a。已有同名结果保留，新结果自动使用 _1、_2 等唯一后缀。

质量：
  默认 medium。low、medium、high 分别适用于有损和可压缩格式；WAV 与 ALAC 始终使用固定无损编码。

示例：
  toolknit audio convert --input .\\meeting.m4a --output-dir .\\toolknit-output --format mp3 --quality high
  toolknit audio convert --input .\\a.wav --input .\\b.flac --output-dir .\\converted --format aac --json

安全：
  不会改写源文件，不会覆盖已有输出。失败不会发布命名的临时或空文件；部分文件失败时会返回已完成输出和每个失败原因。`,

  bpm: `BPM 节拍测速（bpm）

用法：
  toolknit audio bpm --input <file> [--json] [--banner auto|always|never]

输入：
  支持 mp3、wav、flac、aac、ogg、m4a。输入必须是非空普通文件，不能是符号链接，最大 50 MB、最长 5 分钟、仅支持单声道或双声道。

分析：
  仅在本机使用 FFmpeg 解码和分析前 120 秒音频；不会上传、改写或输出音频文件。结果包含主 BPM、0 到 1 的置信度与最多 5 个候选 BPM。没有可靠节拍时，命令仍成功并返回 bpm: null 与警告。

示例：
  toolknit audio bpm --input .\\song.wav --json

运行时：
  此功能需要 FFmpeg。CLI 会依次使用 TOOLKNIT_FFMPEG_PATH、ToolKnit Desktop 设置页下载的共享运行时、开发仓库资源或系统 PATH。`
,

  clip: `音频剪辑（clip）

用法：
  toolknit audio clip --input <file> --start <seconds> --end <seconds> --output-dir <directory> [--format mp3] [--json] [--banner auto|always|never]

输入：
  支持 mp3、wav、flac、aac、ogg、m4a、wma。输入必须是非空普通文件，不能是符号链接，最大 100 MB、最长 20 分钟、仅支持单声道或双声道。选区从 0 秒开始，结束必须大于起点至少 0.1 秒。

输出：
  默认尽力保留原容器与编码；当流复制不可用时自动回退为 MP3，并在 JSON 结果中标记 stream_copy: false 和 warning。--format mp3 可主动指定 MP3。--output-dir 必须明确，已有文件不会覆盖，结果使用唯一名称。

示例：
  toolknit audio clip --input .\\song.m4a --start 15.2 --end 42 --output-dir .\\toolknit-output
  toolknit audio clip --input .\\song.wav --start 0 --end 30 --output-dir .\\clips --format mp3 --json

运行时：
  此功能需要 FFmpeg。不会上传或改写源文件；失败不会发布部分输出。`
,
  extract: `音频提取（extract）

用法：
  toolknit audio extract --input <video> --output-dir <directory> --format <mp3|aac|wav|flac|ogg> [--track-index <0-31>] [--quality <low|medium|high>] [--json]

输入：
  支持 mp4、mkv、avi、mov、webm、flv、wmv、ts、m4v。输入必须为非空普通文件，不能是符号链接，最大 10 GB。--track-index 是 0 到 31 的音轨序号；未提供时选择首条音轨。

输出：
  --output-dir 和 --format 必须明确指定。输出会先写入同目录临时文件，确认非空且 FFmpeg 成功后才以唯一名称发布，不会修改源视频或覆盖已有结果。

示例：
  toolknit audio extract --input .\\lesson.mp4 --output-dir .\\toolknit-output --format mp3 --track-index 0 --quality high --json

运行时：
  此功能需要 FFmpeg。若不确定应使用哪条音轨，请先在桌面端查看视频音轨，或让 IDE Agent 询问你，不要猜测。`
};

const VIDEO_OVERVIEW = `ToolKnit 视频工具

用法：
  toolknit video convert --input <file> [--input <more-files>] --output-dir <directory> --format <mp4|avi|mkv|mov|webm|flv|wmv|ts> [--json]
  toolknit video frame --input <file> --output-dir <directory> --timestamp-ms <milliseconds> [--format png|jpg] [--json]
  toolknit video gif --input <file> --output-dir <directory> --start-ms <milliseconds> --end-ms <milliseconds> [--frame-rate 1-20] [--width 160-1920] [--quality high|balanced|small|tiny] [--json]

说明：
  支持 mp4、avi、mkv、mov、webm、flv、wmv、ts、m4v 作为输入；每批最多 30 个、每个最大 10 GB。所有处理在本机完成，原文件不会修改。
  每个结果先写入同目录临时文件，确认 FFmpeg 成功且非空后才以唯一名称发布；已有文件不会覆盖。

示例：
  toolknit video convert --input .\\recording.mov --output-dir .\\toolknit-output --format mp4 --json
  toolknit video convert --input .\\a.mkv --input .\\b.webm --output-dir .\\converted --format mp4
  toolknit video frame --input .\\recording.mov --output-dir .\\toolknit-output --timestamp-ms 12500 --format png --json
  toolknit video gif --input .\\recording.mov --output-dir .\\toolknit-output --start-ms 5000 --end-ms 12500 --frame-rate 12 --width 640 --quality small --json

详细参数：
  toolknit video convert --help
  toolknit video frame --help
  toolknit video gif --help
  toolknit help video convert`;

const VIDEO_COMMAND_HELP = {
  convert: `视频格式转换（convert）

用法：
  toolknit video convert --input <file> [--input <more-files>] --output-dir <directory> --format <mp4|avi|mkv|mov|webm|flv|wmv|ts> [--json] [--banner auto|always|never]

输入：
  支持 mp4、avi、mkv、mov、webm、flv、wmv、ts、m4v。输入必须是非空普通文件，不能是符号链接；单个文件最大 10 GB，单批最多 30 个。

输出：
  --output-dir 与 --format 必须明确指定。输出使用 FFmpeg 的可移植 CPU 编码器；JSON 中会明确报告每个输出的编码器与 hardware_acceleration: false。已有同名结果保留，新结果自动使用 _1、_2 等唯一后缀。

示例：
  toolknit video convert --input .\\recording.mov --output-dir .\\toolknit-output --format mp4 --json

安全：
  不会改写源文件，不会覆盖已有输出。单个输入失败不会影响同批其他文件；若至少一个文件成功，结果中会包含 outputs、errors 与 warnings。`
,
  frame: `视频高清单帧图（frame）

用法：
  toolknit video frame --input <file> --output-dir <directory> --timestamp-ms <milliseconds> [--format png|jpg] [--json] [--banner auto|always|never]

输入：
  支持 mp4、avi、mkv、mov、webm、flv、wmv、ts、m4v。输入必须是非空普通文件，不能是符号链接，最大 10 GB。--timestamp-ms 是从视频开头起算的准确毫秒数，不能超出视频时长。

输出：
  默认 PNG 无损；--format jpg 使用高质量 JPG。输出保持视频解码后的原始画面分辨率。结果先写入同目录临时文件，确认非空后才以唯一名称发布；不会改写源视频或覆盖既有图片。

示例：
  toolknit video frame --input .\\recording.mov --output-dir .\\toolknit-output --timestamp-ms 12500 --format png --json

运行时：
  此功能需要 FFmpeg。IDE Agent 必须先向用户确认所需时点，不得自行猜测画面。`
,
  gif: `视频转 GIF（gif）

用法：
  toolknit video gif --input <file> --output-dir <directory> --start-ms <milliseconds> --end-ms <milliseconds> [--frame-rate 1-20] [--width 160-1920] [--quality high|balanced|small|tiny] [--json] [--banner auto|always|never]

输入：
  支持 mp4、avi、mkv、mov、webm、flv、wmv、ts、m4v。起止时间必须是准确毫秒数，结束大于开始，选区最多 30 秒且不能超出视频时长。

输出：
  默认每秒 12 帧、输出宽度 640 像素；可用 --frame-rate、--width 与 --quality 调整。quality 可选 high（清晰）、balanced（均衡）、small（小体积）、tiny（极小）。ToolKnit 使用调色板优化生成循环 GIF，超过 500 MB 的临时结果会被删除并明确报错。源视频不变，输出采用唯一文件名。

示例：
  toolknit video gif --input .\\recording.mov --output-dir .\\toolknit-output --start-ms 5000 --end-ms 12500 --frame-rate 12 --width 640 --quality small --json

运行时：
  此功能需要 FFmpeg。IDE Agent 必须先取得用户明确的起止画面，不得以“精彩片段”等模糊描述自行选择。`
};

const TEXT_OVERVIEW = `ToolKnit 文本工具

用法：
  toolknit text stats --input <utf8-text-file> [--json]
  <utf8-text> | toolknit text stats --stdin [--json]

说明：
  统计 Unicode 字符、中英文词、行、段落、句子、标点和阅读时间。文本只在本机内存中计算，不上传、不写出新文件，也不会把正文放入诊断信息。
  --input 与 --stdin 二选一；输入必须是有效 UTF-8，最大 1,000,000 个 UTF-16 代码单元。

详细参数：
  toolknit text stats --help
  toolknit help text stats`;

const TEXT_COMMAND_HELP = {
  stats: `文本统计（stats）

用法：
  toolknit text stats --input <utf8-text-file> [--json] [--banner auto|always|never]
  <utf8-text> | toolknit text stats --stdin [--json] [--banner auto|always|never]

输入：
  必须在 --input（一个普通 UTF-8 文本文件）与 --stdin（UTF-8 标准输入）之间选择一个。符号链接、无效 UTF-8、二进制内容和超过 1,000,000 个 UTF-16 代码单元的文本会被拒绝。

输出：
  不创建或改写文件。JSON 仅返回统计值及输入来源/字节数，绝不回显原始正文。

示例：
  toolknit text stats --input .\\notes.txt --json
  Get-Content .\\notes.txt -Raw | toolknit text stats --stdin --json`
};

const IMAGE_OVERVIEW = `ToolKnit 图像工具

用法：
  toolknit image colors --input <png|jpg|jpeg|webp> [--count <2-9>] [--json]
  toolknit image stitch --input <image> --input <more-images> --output-dir <directory> [参数]

colors 在本机提取确定性主色板，不写出文件。stitch 按 --input 顺序拼接 2–100 张图片，默认上下无缝拼接并输出 PNG；源文件不会被修改。`;

const IMAGE_COMMAND_HELP = { colors: `配色提取（colors）

用法：
  toolknit image colors --input <png|jpg|jpeg|webp> [--count <2-9>] [--json]

返回按像素占比排序的 HEX、RGB、HSL、像素数和百分比，不写出文件或回显图像数据。`,

  stitch: `长图拼接（stitch）

用法：
  toolknit image stitch --input <first.png> --input <second.jpg> --output-dir <directory> [--output-name <安全文件名>] [--mode vertical|horizontal] [--reference first|smallest|largest] [--spacing <0-500>] [--scale <10-100>] [--background <#RRGGBBAA>] [--format png|jpg] [--jpeg-quality <60-100>] [--json]

--input 的先后顺序就是最终拼接顺序。上下拼接统一宽度，左右拼接统一高度；默认第一张为尺寸基准、0px 间距、100% 比例、透明度完整的白色背景和 PNG 无损输出。--output-name 只接收不含扩展名的安全文件名；动态 GIF 会被拒绝，已有输出不会被覆盖。

示例：
  toolknit image stitch --input .\\01.png --input .\\02.png --output-dir .\\toolknit-output
  toolknit image stitch --input .\\left.png --input .\\right.png --output-dir .\\toolknit-output --mode horizontal --reference largest --spacing 12 --background "#111111FF" --format jpg --jpeg-quality 92` };

const PPT_OVERVIEW = `ToolKnit PPT 工具

用法：
  toolknit ppt images --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--images <1,3-5>] [--skip-duplicates] [--dry-run] [--json]
  toolknit ppt text --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--format markdown|txt|json|all] [--ai-mode none|outline|speaker-notes|meeting-notes|study-notes] [--dry-run] [--json]
  toolknit ppt compress --input <file.pptx> --output-dir <directory> [--level low|medium|high] [--dry-run] [--json]
  toolknit ppt to-pdf --input <file.pptx> --output-dir <directory> [--dry-run] [--json]
  toolknit ppt to-image --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--format png|jpg|webp] [--clarity standard|high|print] [--dry-run] [--json]
  toolknit ppt outline (--prompt <brief> | --prompt-file <brief.txt>) --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--audience <text>] [--purpose <text>] [--locale zh-CN|en] [--dry-run] [--json]
  toolknit ppt draft (--prompt <brief> | --prompt-file <brief.txt> | --outline-file <outline.json>) --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--dry-run] [--json]

说明：
  images 会解析 PPTX 的 ZIP/XML 结构，提取内嵌图片、Logo、截图、背景素材等原始图片文件。第一阶段只支持 .pptx，不依赖 Office 或 LibreOffice，不会修改源文件。
  text 会本地提取每页标题、正文和备注，可导出 Markdown、TXT、JSON；启用 --ai-mode 时只把提取出的文本发送给你配置的 AI 服务做整理，PPT 文件不会上传。
  compress 会本地重打包 PPTX，并按等级处理图片素材。low 为无损清理；medium 会适度压缩大图；high 更偏体积优先。源 PPTX 不会被修改，压缩后如果没有变小会自动保留原图。
  to-pdf 会先校验 PPTX 包结构，再调用本机 LibreOffice headless 渲染为 PDF；源文件不修改，输出到独立文件夹并生成 manifest。
  to-image 会先通过同一 LibreOffice 链路渲染临时 PDF，再复用 PDF 转图像引擎导出逐页 PNG/JPG/WebP；源文件和临时 PDF 不会保留。
  outline 会根据主题、受众、场景和资料生成结构化 PPT 大纲，输出 outline.md、outline.json 和 manifest.json；新版会加入 PPT 类型预设、事实边界、页面角色、布局意图和质量自检，不会生成 PPTX 文件，适合后续继续交给 AI 草稿/PPTX 工具使用。
  draft 会先生成或读取结构化大纲，再用本地模板写出可编辑 PPTX 草稿，同时保留 outline.json、outline.md 和 manifest.json。第一阶段不做动画和复杂企业母版。

详细参数：
  toolknit ppt images --help
  toolknit ppt text --help
  toolknit ppt compress --help
  toolknit ppt to-pdf --help
  toolknit ppt to-image --help
  toolknit ppt outline --help
  toolknit ppt draft --help
  toolknit help ppt images
  toolknit help ppt text
  toolknit help ppt compress
  toolknit help ppt to-pdf
  toolknit help ppt to-image
  toolknit help ppt outline
  toolknit help ppt draft`;

const PPT_COMMAND_HELP = {
  images: `PPT 图片提取（images）

用法：
  toolknit ppt images --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--images <1,3-5>] [--skip-duplicates] [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]

输入：
  当前仅支持 .pptx。工具会先校验 ZIP 包、[Content_Types].xml、ppt/presentation.xml 和幻灯片关系文件，避免把伪装文件当作 PPT 处理。

选择：
  --pages 按幻灯片页码筛选；--images 按扫描出的图片素材编号筛选。二者同时提供时取交集。--skip-duplicates 会跳过完全相同 SHA-256 的重复素材。

输出：
  输出到指定目录下的独立子文件夹，保留原始图片格式，并生成 manifest.json 与 manifest.md。已有输出文件夹不会覆盖，会自动追加序号。--dry-run 只返回扫描清单，不写出图片。

示例：
  toolknit ppt images --input .\\demo.pptx --output-dir .\\toolknit-output --json
  toolknit ppt images --input .\\demo.pptx --output-dir .\\toolknit-output --pages 1-3 --images 1,3-6 --skip-duplicates --json`
,
  text: `PPT AI 文本提取（text）

用法：
  toolknit ppt text --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--format markdown|txt|json|all] [--ai-mode none|outline|speaker-notes|meeting-notes|study-notes] [--dry-run] [--output-name <name>] [--locale zh-CN|en] [--json] [--banner auto|always|never]

输入：
  当前仅支持 .pptx。工具会先校验 ZIP 包和 PowerPoint 关键结构；基础标题、正文和备注提取完全本地完成，不依赖 Office 或 LibreOffice。

输出：
  输出到指定目录下的独立子文件夹。--format markdown 会生成 slides.md；txt 生成 slides.txt；json 生成 slides.json；all 同时生成三种格式。manifest.json 始终生成。已有输出文件夹不会覆盖，会自动追加序号。

AI 整理：
  --ai-mode none 默认不调用 AI。outline 会整理成大纲；speaker-notes 生成讲稿；meeting-notes 生成会议纪要；study-notes 生成学习笔记。AI 只接收提取出的文字和备注，不会上传 PPTX 文件。CLI/Agent 需配置 DEEPSEEK_API_KEY 或 TOOLKNIT_AI_API_KEY。

示例：
  toolknit ppt text --input .\\demo.pptx --output-dir .\\toolknit-output --format all --json
  toolknit ppt text --input .\\demo.pptx --output-dir .\\toolknit-output --pages 1-8 --ai-mode outline --format markdown --json`,
  compress: `PPT 压缩（compress）

用法：
  toolknit ppt compress --input <file.pptx> --output-dir <directory> [--level low|medium|high] [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]

输入：
  当前仅支持 .pptx。工具会校验 ZIP 包和 PowerPoint 关键结构，源文件不会被修改。

压缩等级：
  low：无损清理，不降低图片质量。
  medium：推荐压缩，清理结构并适度压缩大图。
  high：强力压缩，额外清理打印设置元数据，并更偏向体积优先。

输出：
  输出到指定目录下的独立子文件夹，生成 <name>_compressed.pptx 和 manifest.json。已有输出文件夹不会覆盖，会自动追加序号。若重新打包结果反而更大，会保留原始字节作为输出，并在 manifest 中标记 already_optimized。

示例：
  toolknit ppt compress --input .\\demo.pptx --output-dir .\\toolknit-output --level medium --json
  toolknit ppt compress --input .\\demo.pptx --output-dir .\\toolknit-output --level high --dry-run --json`,
  'to-pdf': `PPT 转 PDF（to-pdf）

用法：
  toolknit ppt to-pdf --input <file.pptx> --output-dir <directory> [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]

输入：
  当前仅支持 .pptx。工具会先校验 ZIP 签名、[Content_Types].xml、ppt/presentation.xml 和幻灯片数量，避免把伪装文件交给 LibreOffice 渲染。

依赖：
  需要本机可用的 LibreOffice。可安装 LibreOffice，或设置 TOOLKNIT_LIBREOFFICE_PATH 指向 soffice.com / soffice.exe / soffice。缺失时会返回明确的 DEPENDENCY_MISSING，不会生成空结果。

输出：
  输出到指定目录下的独立子文件夹，生成 <name>.pdf 和 manifest.json。已有输出文件夹不会覆盖，会自动追加序号。源 PPTX 不会被修改。

示例：
  toolknit ppt to-pdf --input .\\demo.pptx --output-dir .\\toolknit-output --json
  toolknit ppt to-pdf --input .\\demo.pptx --output-dir .\\toolknit-output --output-name demo-slides --dry-run --json`,
  'to-image': `PPT 转图片（to-image）

用法：
  toolknit ppt to-image --input <file.pptx> --output-dir <directory> [--pages <1,3-5>] [--format png|jpg|webp] [--clarity standard|high|print] [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]

输入：
  当前仅支持 .pptx。工具先校验 PPTX 包结构，再调用 LibreOffice 渲染临时 PDF，最后复用 ToolKnit PDF 转图像引擎导出逐页图片。

选择：
  --pages 按幻灯片页码筛选；未指定时导出全部页面。--format 默认 png；--clarity 默认 high，print 更清晰但文件更大。

输出：
  输出到指定目录下的独立子文件夹，导出一页一张图片并生成 manifest.json。中间 PDF 只用于渲染，成功后不会保留。源 PPTX 不会被修改。

示例：
  toolknit ppt to-image --input .\\demo.pptx --output-dir .\\toolknit-output --pages 1-3 --format png --clarity high --json
  toolknit ppt to-image --input .\\demo.pptx --output-dir .\\toolknit-output --format webp --clarity print --output-name demo-pages --json`,
  outline: `AI 生成 PPT 大纲（outline）

用法：
  toolknit ppt outline --prompt <主题或资料> --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--audience <text>] [--purpose <text>] [--tone <text>] [--style <text>] [--locale zh-CN|en] [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]
  toolknit ppt outline --prompt-file <brief.txt> --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--json]

输入：
  根据文字需求生成一套新 PPT 的结构化大纲，不读取 PPTX，也不会生成 PPTX 文件。推荐使用 --prompt-file 承载较长资料，避免终端转义问题。

类型预设：
  --deck-type 默认 auto，会自动判断。也可以指定 product-launch、investor-pitch、work-report、training、industry-research、competitive-analysis、short-video-demo、project-review，让 AI 按对应场景规划叙事。

输出：
  输出到指定目录下的独立子文件夹，生成 outline.md、outline.json 和 manifest.json。outline.json 是稳定结构，会包含事实边界、页面角色、布局意图和质量自检，后续可继续用于 AI 生成 PPT 草稿 / PPTX。已有输出文件夹不会覆盖，会自动追加序号。

AI：
  需要配置 DEEPSEEK_API_KEY 或 TOOLKNIT_AI_API_KEY。dry-run 只校验参数和返回生成计划，不调用 AI，也不写文件。

示例：
  toolknit ppt outline --prompt-file .\\brief.txt --output-dir .\\toolknit-output --slide-count 8 --deck-type product-launch --audience \"开源项目用户\" --purpose \"介绍 ToolKnit 2.0 路线\" --json
  toolknit ppt outline --prompt \"给一场 10 分钟产品发布演示生成大纲\" --output-dir .\\toolknit-output --slide-count 6 --dry-run --json`,
  draft: `AI 生成 PPT 草稿 / PPTX（draft）

用法：
  toolknit ppt draft --prompt <主题或资料> --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--audience <text>] [--purpose <text>] [--tone <text>] [--locale zh-CN|en] [--dry-run] [--output-name <name>] [--json] [--banner auto|always|never]
  toolknit ppt draft --prompt-file <brief.txt> --output-dir <directory> [--slide-count 8] [--deck-type auto|product-launch|investor-pitch|work-report|training|industry-research|competitive-analysis|short-video-demo|project-review] [--json]
  toolknit ppt draft --outline-file <outline.json> --output-dir <directory> [--json]

输入：
  prompt/prompt-file 会调用 AI 先生成结构化大纲，再本地写出可编辑 PPTX；outline-file 会直接把已有 ToolKnit 大纲 JSON 转成 PPTX，不再调用 AI。

输出：
  输出到指定目录下的独立子文件夹，生成 <name>.pptx、outline.json、outline.md 和 manifest.json。已有输出文件夹不会覆盖，会自动追加序号。

视觉：
  统一使用黑白极简模板：白色大面积、黑色点缀，配灰色几何色块与图片占位。不接受其它主题或配色偏向，保证每次生成都能稳定可用。

边界：
  第一阶段生成的是稳定可编辑的极简草稿，不包含复杂动画、视频、企业母版继承或像素级排版还原。适合继续在 PowerPoint 中二次美化。

AI：
  prompt 模式需要配置 DEEPSEEK_API_KEY 或 TOOLKNIT_AI_API_KEY。dry-run 只校验参数和返回生成计划，不调用 AI，也不写文件。

示例：
  toolknit ppt draft --prompt-file .\\brief.txt --output-dir .\\toolknit-output --slide-count 8 --json
  toolknit ppt draft --outline-file .\\outline.json --output-dir .\\toolknit-output --json
  toolknit ppt draft --prompt \"给 ToolKnit 2.0 做 6 页发布演示\" --output-dir .\\toolknit-output --slide-count 6 --dry-run --json`,
  'extract-text': null
};
PPT_COMMAND_HELP['extract-text'] = PPT_COMMAND_HELP.text;

const HARDWARE_OVERVIEW = `ToolKnit 硬件工具

用法：
  toolknit hardware <overview|cpu-memory|cpu-memory-live-stats|gpu-display|mainboard-firmware|storage-health|network-devices|power-sensors> [参数]

说明：
  硬件工具只读查看本机信息，不写入、不上传。CLI 默认输出结构化 JSON；加 --json 时返回标准 ToolKnit JSON 包装。

详细参数：
  toolknit hardware overview --help
  toolknit hardware cpu-memory --help
  toolknit hardware cpu-memory-live-stats --help
  toolknit hardware gpu-display --help
  toolknit hardware mainboard-firmware --help
  toolknit hardware storage-health --help
  toolknit hardware network-devices --help
  toolknit hardware power-sensors --help`;

const HARDWARE_COMMAND_HELP = {
  overview: `硬件总览（overview）

用法：
  toolknit hardware overview [--json]

返回系统、机型、CPU、内存、显卡、磁盘、固件和电池的只读总览。`,
  'cpu-memory': `CPU 与内存（cpu-memory）

用法：
  toolknit hardware cpu-memory [--json]

返回处理器规格、内存拓扑、内存条信息与当前使用情况。`,
  'cpu-memory-live-stats': `CPU 与内存实时状态（cpu-memory-live-stats）

用法：
  toolknit hardware cpu-memory-live-stats [--json]

返回当前 CPU 使用率、可用内存和提交内存等实时数据。`,
  'gpu-display': `显卡与显示器（gpu-display）

用法：
  toolknit hardware gpu-display [--json]

返回显卡、驱动、显存和连接显示器信息。`,
  'mainboard-firmware': `主板与固件（mainboard-firmware）

用法：
  toolknit hardware mainboard-firmware [--json]

返回主板、BIOS/UEFI、安全启动、TPM 和 PCI 设备信息。`,
  'storage-health': `磁盘与健康（storage-health）

用法：
  toolknit hardware storage-health [--json]

返回物理磁盘、分区卷、容量、接口和可读可靠性状态。`,
  'network-devices': `网络与设备（network-devices）

用法：
  toolknit hardware network-devices [--json]

返回网卡、蓝牙、音频、USB 和摄像头等设备清单。`,
  'power-sensors': `电源与传感器（power-sensors）

用法：
  toolknit hardware power-sensors [--json]

返回电源计划、电池状态、温区和风扇等可读传感器信息。`
};

const AI_DOC_OVERVIEW = `ToolKnit AI 文档工程

用法：
  toolknit ai-doc create (--prompt <brief> | --prompt-file <brief.txt>) --output <document.pdf> [--page-count 3] [--locale zh-CN|en] [--json]
  toolknit ai-doc inspect --project <document.toolknit.json> [--json]
  toolknit ai-doc edit --project <document.toolknit.json> --operations-file <operations.json> [--dry-run] [--json]
  toolknit ai-doc undo --project <document.toolknit.json> [--steps 1] [--json]
  toolknit ai-doc render --project <document.toolknit.json> [--json]

工作流：
  1. 先用 inspect 获取稳定控件编号和当前修订。
  2. 用 edit --dry-run 检查操作、越界、重叠和对比度。
  3. 确认后去掉 --dry-run，生成新修订并刷新 PDF、预览图和编号图。
  4. 修改不满意时使用 undo；旧修订始终保留。

IDE 工作区：
  Agent 应把“保存到当前项目”解析为 <工作区绝对路径>\\toolknit-output\\<文件名>.pdf。
  不要依赖 MCP 进程当前目录。生成后优先打开 demo\\page-01-controls.png 等逐页高清编号图。
  “在执行流程后插图”这类自然语言由 IDE Agent 先通过 inspect 定位唯一控件，再转换为结构化操作；CLI edit 本身不猜测语义目标。

推荐使用 --operations-file，避免 PowerShell 或其他终端对 JSON 引号进行二次解析。`;

const AI_DOC_COMMAND_HELP = {
  create: `AI 文档创建（create）

用法：
  toolknit ai-doc create --prompt-file <brief.txt> --output <document.pdf> [--page-count 3] [--locale zh-CN|en] [--overwrite] [--json]
  toolknit ai-doc create --prompt '<document brief>' --output <document.pdf> [--page-count 3] [--locale zh-CN|en] [--overwrite] [--json]

通过 DEEPSEEK_API_KEY 或 TOOLKNIT_AI_API_KEY 调用已配置的 AI 服务，输出 PDF、可编辑 .toolknit.json 工程、干净预览、逐页高清编号图、总览图和修订历史。推荐使用 --prompt-file，避免终端转义长需求。`,

  inspect: `AI 文档检查（inspect）

用法：
  toolknit ai-doc inspect --project <document.toolknit.json> [--json]

返回工程修订、全部页面、稳定控件编号、文字、类型、位置、样式、锁定状态、资源及诊断，不写入文件。`,

  edit: `AI 文档编辑（edit）

用法：
  toolknit ai-doc edit --project <document.toolknit.json> --operations-file <operations.json> [--dry-run] [--json]
  toolknit ai-doc edit --project <document.toolknit.json> --operations '<json-array>' [--dry-run] [--json]

支持 update_text、update_style、update_document_style、swap_positions、move、resize、insert_control、delete_control、lock_control、group_controls、ungroup_controls、align_controls 和 resolve_overlaps。
成功编辑会原子写入新修订，并刷新 PDF、干净预览和带编号 Demo 图。--dry-run 不写任何文件。

插入本地图片的 operations.json 示例（source_path 必须是 PNG/JPEG 绝对路径）：
  [{"type":"insert_control","after":"P2-03","control":{"type":"image","source_path":"D:\\\\项目\\\\assets\\\\流程图.png","label":"执行流程","w":520,"h":150}}]

删除单个控件的 operations.json 示例：
  [{"type":"delete_control","control":"P3-06"}]

全文对齐示例（默认会跳过图片、分隔线、页眉、页脚和锁定控件）：
  [{"type":"update_document_style","style":{"align":"center"}}]
  可额外传入 types，例如 ["body","list-item","table-row"]，只改指定类型。

请先 inspect，再用完全相同的 operations 依次执行 --dry-run 和正式提交。自然语言目标由 IDE Agent 解析，CLI 不会根据“第二段”或“流程图下面”自行猜测控件。`,

  undo: `AI 文档撤销（undo）

用法：
  toolknit ai-doc undo --project <document.toolknit.json> [--steps 1] [--json]

恢复较早修订的内容，但仍创建一个新的修订，不删除历史。`,

  render: `AI 文档重新渲染（render）

用法：
  toolknit ai-doc render --project <document.toolknit.json> [--json]

从工程文件确定性刷新 PDF、干净预览和带编号 Demo 图，不创建新修订。`
};

const AI_TABLE_OVERVIEW = `ToolKnit AI 表格工程

用法：
  toolknit ai-table create (--prompt <brief> | --prompt-file <brief.txt>) --output <table.xlsx> [--format csv|xlsx|pdf|png] [--locale zh-CN|en] [--json]
  toolknit ai-table inspect --project <table.toolknit-table.json> [--json]
  toolknit ai-table edit --project <table.toolknit-table.json> --operations-file <operations.json> [--dry-run] [--json]
  toolknit ai-table undo --project <table.toolknit-table.json> [--steps 1] [--json]
  toolknit ai-table render --project <table.toolknit-table.json> [--json]

工作流：
  1. 先生成项目与主导出文件，再打开 .toolknit-table.json 查看稳定行、列和图表编号。
  2. 用 inspect 读取完整表格结构和输出路径。
  3. 用 edit --dry-run 检查单元格、行、列、排序或图表修改。
  4. 确认后去掉 --dry-run，生成新修订并刷新导出文件与预览。

IDE 工作区：
  Agent 应把“保存到当前项目”解析为 <工作区绝对路径>\\toolknit-output\\<文件名>.<ext>。
  不要依赖 MCP 进程当前目录。生成后优先打开 preview\\preview.png。

推荐使用 --operations-file，避免 PowerShell 或其他终端对 JSON 引号进行二次解析。`;

const AI_TABLE_COMMAND_HELP = {
  create: `AI 表格创建（create）

用法：
  toolknit ai-table create --prompt-file <brief.txt> --output <table.xlsx> [--format csv|xlsx|pdf|png] [--locale zh-CN|en] [--overwrite] [--json]
  toolknit ai-table create --prompt '<table brief>' --output <table.xlsx> [--format csv|xlsx|pdf|png] [--locale zh-CN|en] [--overwrite] [--json]

通过 DEEPSEEK_API_KEY 或 TOOLKNIT_AI_API_KEY 调用已配置的 AI 服务，输出主导出文件、可编辑 .toolknit-table.json 工程、预览和修订历史。推荐使用 --prompt-file，避免终端转义长需求。`,

  inspect: `AI 表格检查（inspect）

用法：
  toolknit ai-table inspect --project <table.toolknit-table.json> [--json]

返回工程修订、稳定行列图表编号、单元格、图表、输出路径和预览路径，不写入文件。`,

  edit: `AI 表格编辑（edit）

用法：
  toolknit ai-table edit --project <table.toolknit-table.json> --operations-file <operations.json> [--dry-run] [--json]
  toolknit ai-table edit --project <table.toolknit-table.json> --operations '<json-array>' [--dry-run] [--json]

支持 update_cell、update_row、update_column、insert_row、delete_row、swap_rows、move_row、sort_rows、insert_column、delete_column、swap_columns、move_column、insert_chart、update_chart、delete_chart。成功编辑会原子写入新修订，并刷新导出文件和预览。--dry-run 不写任何文件。

示例：
  [{"type":"update_cell","row":"R01","column":"C02","value":"已完成"}]
  [{"type":"swap_rows","first":"R01","second":"R03"}]
  [{"type":"insert_chart","chart":{"type":"bar","title":"销量对比","labelColumnId":"C01","valueColumnIds":["C02"]}}]`,

  undo: `AI 表格撤销（undo）

用法：
  toolknit ai-table undo --project <table.toolknit-table.json> [--steps 1] [--json]

恢复较早修订的内容，但仍创建一个新的修订，不删除历史。`,

  render: `AI 表格重新渲染（render）

用法：
  toolknit ai-table render --project <table.toolknit-table.json> [--json]

从工程文件确定性刷新导出文件和预览，不创建新修订。`
};

const CLI_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const AGENT_GUIDE_HELP = `ToolKnit AI Agent guide

Usage:
  toolknit agent guide [--lang zh|en]

Languages:
  zh  Simplified Chinese (default)
  en  English`;

function normalizeAgentGuideLanguage(value) {
  const language = (value || 'zh').trim().toLowerCase();
  if (language === 'zh' || language === 'zh-cn') return 'zh-CN';
  if (language === 'en' || language === 'en-us') return 'en';
  throw new ToolKnitError('USAGE', '--lang must be zh or en.');
}

function parseAgentGuideLanguage(tokens) {
  let language = 'zh-CN';
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '--help') return null;
    if (token === '--lang') {
      language = normalizeAgentGuideLanguage(tokens[++index]);
      continue;
    }
    if (token.startsWith('--lang=')) {
      language = normalizeAgentGuideLanguage(token.slice('--lang='.length));
      continue;
    }
    throw new ToolKnitError('USAGE', `Unknown agent guide option: ${token}`);
  }
  return language;
}

async function writeAgentGuide(language) {
  const normalizedLanguage = normalizeAgentGuideLanguage(language);
  const filename = normalizedLanguage === 'en' ? 'agent-guide.en.md' : 'agent-guide.zh-CN.md';
  try {
    const guide = await readFile(path.join(CLI_DIRECTORY, 'guides', filename), 'utf8');
    process.stdout.write(`${guide.trimEnd()}\n`);
  } catch {
    throw new ToolKnitError('ENGINE', `Agent guide resource is unavailable: ${filename}`);
  }
}

function parsePageRanges(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolKnitError('USAGE', '--pages must be a comma-separated page list such as 1,3-5.');
  }
  const pages = [];
  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new ToolKnitError('USAGE', `Invalid page range: ${part}`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      throw new ToolKnitError('USAGE', `Invalid page range: ${part}`);
    }
    for (let page = start; page <= end; page++) pages.push(page);
  }
  if (new Set(pages).size !== pages.length) {
    throw new ToolKnitError('USAGE', '--pages cannot contain duplicate page numbers.');
  }
  return pages;
}

function parseOptions(tokens) {
  const values = { input: [] };
  const flags = new Set(['json', 'overwrite', 'password-stdin', 'stdin', 'help', 'dry-run', 'refine', 'skip-duplicates']);
  const options = new Set(['input', 'output', 'output-dir', 'output-name', 'pages', 'images', 'ai-mode', 'rotation', 'level', 'strength', 'quality', 'clarity', 'banner', 'page-selections', 'page-rotations', 'project', 'operations', 'operations-file', 'steps', 'prompt', 'prompt-file', 'outline-file', 'page-count', 'slide-count', 'audience', 'purpose', 'tone', 'style', 'deck-type', 'theme', 'locale', 'format', 'start', 'end', 'start-ms', 'end-ms', 'frame-rate', 'width', 'track-index', 'timestamp-ms', 'count', 'language', 'source', 'mode', 'reference', 'spacing', 'scale', 'background', 'jpeg-quality', 'target-kb', 'target-mb']);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new ToolKnitError('USAGE', `Unexpected argument: ${token}`);
    const option = token.slice(2);
    const separator = option.indexOf('=');
    const name = separator === -1 ? option : option.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : option.slice(separator + 1);
    if (flags.has(name)) {
      if (inlineValue !== undefined) throw new ToolKnitError('USAGE', `Option --${name} does not accept a value.`);
      values[name] = true;
      continue;
    }
    if (!options.has(name)) throw new ToolKnitError('USAGE', `Unknown option: ${token}`);
    const value = inlineValue === undefined ? tokens[++index] : inlineValue;
    if (value === undefined || value.startsWith('--')) throw new ToolKnitError('USAGE', `Option ${token} requires a value.`);
    if (name === 'input') values.input.push(value);
    else values[name] = value;
  }
  return values;
}

function parseBannerMode(value) {
  try {
    return normalizeBannerMode(value);
  } catch (error) {
    throw new ToolKnitError('USAGE', String(error?.message || error));
  }
}

function requireOption(options, key) {
  if (options[key] === undefined || options[key] === '') {
    throw new ToolKnitError('USAGE', `--${key} is required.`);
  }
  return options[key];
}

async function passwordFromStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw.replace(/\r?\n$/, '');
}

function renderSuccess(result, json, bannerMode) {
  if (json) return JSON.stringify({ ok: true, result });
  const outputs = result.outputs || [];
  const lines = [`${result.tool} completed.`];
  if (outputs.length > 0) {
    lines.push(...outputs.map(output => `Created: ${output.path}`));
  }
  if (typeof result.output_path === 'string' && result.output_path) {
    lines.push(`Created: ${result.output_path}`);
  }
  if (result.project?.path) {
    const revision = result.project.revision ?? result.project.current_revision;
    lines.push(`Project: ${result.project.path}${revision ? ` (revision ${revision})` : ''}`);
  }
  if (Array.isArray(result.project?.pages)) {
    const controls = result.project.pages.reduce((sum, page) => sum + (page.controls?.length || 0), 0);
    lines.push(`Controls: ${controls} across ${result.project.pages.length} page(s)`);
  }
  if (Array.isArray(result.changes)) lines.push(`Changes: ${result.changes.length}`);
  if (Array.isArray(result.diagnostics)) lines.push(`Diagnostics: ${result.diagnostics.length}`);
  if (result.warnings?.length) lines.push(...result.warnings.map(warning => `Warning: ${warning}`));
  const banner = renderToolKnitBanner({ mode: bannerMode });
  return banner ? `${banner}\n\n${lines.join('\n')}` : lines.join('\n');
}

function createCliProgressReporter(options) {
  if (options.json || process.stderr.isTTY !== true) {
    return { report() {}, finish() {} };
  }
  let active = false;
  return {
    report(progress, message) {
      active = true;
      const percent = Math.max(0, Math.min(100, Math.round(progress)));
      const width = 24;
      const filled = Math.round(width * percent / 100);
      const bar = `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
      process.stderr.write(`\rToolKnit [${bar}] ${String(percent).padStart(3, ' ')}% ${message}`);
    },
    finish() {
      if (active) process.stderr.write('\n');
      active = false;
    }
  };
}

async function runCliTask(tool, options, work) {
  const progress = createCliProgressReporter(options);
  const runner = new TaskRunner({
    tool,
    onEvent(event) {
      if (event.state === 'queued' || event.state === 'running' || event.state === 'cancelling') {
        progress.report(event.progress, event.message);
      }
    }
  });
  try {
    return await runner.run(async context => work({
      reportProgress: context.report,
      signal: context.signal,
      taskId: context.id,
      throwIfCancelled: context.throwIfCancelled
    }), { signal: CLI_ABORT_CONTROLLER.signal });
  } finally {
    progress.finish();
  }
}

function renderFailure(error, json) {
  const payload = errorPayload(error);
  return json ? JSON.stringify(payload) : `Error [${payload.error.code}]: ${payload.error.message}`;
}

async function runPdfCommand(action, options, runtimeOptions = {}) {
  const overwrite = options.overwrite === true;
  if (action === 'inspect') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf inspect requires exactly one --input.');
    return inspectPdf({ input_path: options.input[0] });
  }
  if (action === 'merge') {
    let pageSelections;
    if (options['page-selections']) {
      try { pageSelections = JSON.parse(options['page-selections']); } catch { throw new ToolKnitError('USAGE', '--page-selections must contain valid JSON.'); }
    }
    return mergePdf({ input_paths: options.input, output_path: requireOption(options, 'output'), page_selections: pageSelections, overwrite });
  }
  if (action === 'split') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf split requires exactly one --input.');
    return splitPdf({ input_path: options.input[0], output_dir: requireOption(options, 'output-dir'), pages: parsePageRanges(requireOption(options, 'pages')), overwrite });
  }
  if (action === 'rotate') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf rotate requires exactly one --input.');
    let pageRotations;
    if (options['page-rotations']) {
      try { pageRotations = JSON.parse(options['page-rotations']); } catch { throw new ToolKnitError('USAGE', '--page-rotations must contain valid JSON.'); }
    }
    return rotatePdf({ input_path: options.input[0], output_path: requireOption(options, 'output'), rotation: options.rotation === undefined ? 90 : Number(options.rotation), page_rotations: pageRotations, overwrite });
  }
  if (action === 'encrypt') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf encrypt requires exactly one --input.');
    if (!options['password-stdin']) throw new ToolKnitError('USAGE', 'pdf encrypt requires --password-stdin; passwords are never accepted as command-line arguments.');
    return encryptPdfFile({ input_path: options.input[0], output_path: requireOption(options, 'output'), password: await passwordFromStdin(), overwrite });
  }
  if (action === 'decrypt') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf decrypt requires exactly one --input.');
    return decryptPdfFile({ input_path: options.input[0], output_path: requireOption(options, 'output'), password: options['password-stdin'] ? await passwordFromStdin() : '', overwrite }, runtimeOptions);
  }
  if (action === 'compress') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf compress requires exactly one --input.');
    if (options['target-kb'] !== undefined && options['target-mb'] !== undefined) throw new ToolKnitError('USAGE', 'Use either --target-kb or --target-mb.');
    const target = options['target-kb'] !== undefined ? Math.floor(Number(options['target-kb']) * 1024)
      : options['target-mb'] !== undefined ? Math.floor(Number(options['target-mb']) * 1024 * 1024) : undefined;
    return compressPdfFile({ input_path: options.input[0], output_path: requireOption(options, 'output'), level: options.level,
      mode: options.mode, clarity: options.clarity, target_bytes: target, overwrite }, runtimeOptions);
  }
  if (action === 'enhance') {
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf enhance requires exactly one --input.');
    return enhancePdfFile({ input_path: options.input[0], output_path: requireOption(options, 'output'), strength: options.strength, overwrite });
  }
  if (action === 'to-image') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'pages', 'mode', 'format', 'clarity', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'pdf to-image requires exactly one --input.');
    const pages = options.pages === undefined ? undefined : parsePageRanges(options.pages);
    const mode = options.mode || 'images';
    const format = options.format || 'png';
    const clarity = options.clarity || 'high';
    if (!['images', 'long'].includes(mode)) throw new ToolKnitError('USAGE', '--mode must be images or long.');
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(format)) throw new ToolKnitError('USAGE', '--format must be png, jpg, or webp.');
    if (!['standard', 'high', 'print'].includes(clarity)) throw new ToolKnitError('USAGE', '--clarity must be standard, high, or print.');
    return convertPdfToImages({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      pages,
      mode,
      format,
      clarity,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  throw new ToolKnitError('USAGE', `Unknown PDF action: ${action}`);
}

function assertOnlyCommandOptions(options, allowed) {
  for (const [key, value] of Object.entries(options)) {
    const present = Array.isArray(value) ? value.length > 0 : value !== undefined;
    if (present && !allowed.has(key)) {
      throw new ToolKnitError('USAGE', `Option --${key} is not supported by this command.`);
    }
  }
}

async function runAudioCommand(action, options, runtimeOptions = {}) {
  if (action === 'convert') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'format', 'quality', 'json', 'banner']));
    if (options.input.length === 0) throw new ToolKnitError('USAGE', 'audio convert requires at least one --input.');
    const format = requireOption(options, 'format').trim().toLowerCase();
    if (!['mp3', 'aac', 'wav', 'flac', 'alac', 'ogg'].includes(format)) {
      throw new ToolKnitError('USAGE', '--format must be mp3, aac, wav, flac, alac, or ogg.');
    }
    if (options.quality !== undefined && !['low', 'medium', 'high'].includes(options.quality.trim().toLowerCase())) {
      throw new ToolKnitError('USAGE', '--quality must be low, medium, or high.');
    }
    return convertAudioBatch({
      input_paths: options.input,
      output_dir: requireOption(options, 'output-dir'),
      target_format: format,
      quality: options.quality
    }, runtimeOptions);
  }
  if (action === 'bpm') {
    assertOnlyCommandOptions(options, new Set(['input', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'audio bpm requires exactly one --input.');
    return detectAudioBpm({ input_path: options.input[0] }, runtimeOptions);
  }
  if (action === 'clip') {
    assertOnlyCommandOptions(options, new Set(['input', 'start', 'end', 'output-dir', 'format', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'audio clip requires exactly one --input.');
    const start = Number(requireOption(options, 'start'));
    const end = Number(requireOption(options, 'end'));
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ToolKnitError('USAGE', '--start and --end must be finite seconds.');
    const format = options.format?.trim().toLowerCase();
    if (format !== undefined && format !== 'mp3') throw new ToolKnitError('USAGE', '--format currently supports only mp3. Omit it to preserve the source when possible.');
    return clipAudio({ input_path: options.input[0], output_dir: requireOption(options, 'output-dir'), start_seconds: start, end_seconds: end, target_format: format }, runtimeOptions);
  }
  if (action === 'extract') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'format', 'track-index', 'quality', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'audio extract requires exactly one --input.');
    const trackIndex = options['track-index'] === undefined ? undefined : Number(options['track-index']);
    if (trackIndex !== undefined && (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex > 31)) throw new ToolKnitError('USAGE', '--track-index must be an integer from 0 to 31.');
    return extractAudio({ input_path: options.input[0], output_dir: requireOption(options, 'output-dir'), target_format: requireOption(options, 'format'), track_index: trackIndex, quality: options.quality }, runtimeOptions);
  }
  throw new ToolKnitError('USAGE', `Unknown audio action: ${action}`);
}

async function runVideoCommand(action, options, runtimeOptions = {}) {
  if (action === 'convert') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'format', 'json', 'banner']));
    if (options.input.length === 0) throw new ToolKnitError('USAGE', 'video convert requires at least one --input.');
    const format = requireOption(options, 'format').trim().toLowerCase();
    if (!['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts'].includes(format)) {
      throw new ToolKnitError('USAGE', '--format must be mp4, avi, mkv, mov, webm, flv, wmv, or ts.');
    }
    return convertVideoBatch({ input_paths: options.input, output_dir: requireOption(options, 'output-dir'), target_format: format }, runtimeOptions);
  }
  if (action === 'frame') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'timestamp-ms', 'format', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'video frame requires exactly one --input.');
    const timestampMs = Number(requireOption(options, 'timestamp-ms'));
    if (!Number.isInteger(timestampMs) || timestampMs < 0) throw new ToolKnitError('USAGE', '--timestamp-ms must be a non-negative integer.');
    const format = options.format === undefined ? 'png' : options.format.trim().toLowerCase();
    if (!['png', 'jpg'].includes(format)) throw new ToolKnitError('USAGE', '--format must be png or jpg.');
    return extractVideoFrame({ input_path: options.input[0], output_dir: requireOption(options, 'output-dir'), timestamp_ms: timestampMs, format }, runtimeOptions);
  }
  if (action === 'gif') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'start-ms', 'end-ms', 'frame-rate', 'width', 'quality', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'video gif requires exactly one --input.');
    const startMs = Number(requireOption(options, 'start-ms'));
    const endMs = Number(requireOption(options, 'end-ms'));
    const frameRate = options['frame-rate'] === undefined ? undefined : Number(options['frame-rate']);
    const width = options.width === undefined ? undefined : Number(options.width);
    const quality = options.quality === undefined ? undefined : options.quality.trim().toLowerCase();
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) throw new ToolKnitError('USAGE', '--start-ms and --end-ms must be non-negative integer milliseconds with end after start.');
    if (endMs - startMs > 30_000) throw new ToolKnitError('USAGE', 'GIF duration cannot exceed 30 seconds.');
    if (frameRate !== undefined && (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 20)) throw new ToolKnitError('USAGE', '--frame-rate must be an integer from 1 to 20.');
    if (width !== undefined && (!Number.isInteger(width) || width < 160 || width > 1920)) throw new ToolKnitError('USAGE', '--width must be an integer from 160 to 1920.');
    if (quality !== undefined && !['high', 'balanced', 'small', 'tiny'].includes(quality)) throw new ToolKnitError('USAGE', '--quality must be high, balanced, small, or tiny.');
    return extractVideoGif({ input_path: options.input[0], output_dir: requireOption(options, 'output-dir'), start_ms: startMs, end_ms: endMs, frame_rate: frameRate, width, quality }, runtimeOptions);
  }
  throw new ToolKnitError('USAGE', `Unknown video action: ${action}`);
}

async function runTextCommand(action, options, runtimeOptions = {}) {
  if (action !== 'stats') throw new ToolKnitError('USAGE', `Unknown text action: ${action}`);
  assertOnlyCommandOptions(options, new Set(['input', 'stdin', 'json', 'banner']));
  if (options.input.length > 1 || (options.stdin === true) === (options.input.length === 1)) {
    throw new ToolKnitError('USAGE', 'text stats requires exactly one of --input or --stdin.');
  }
  if (options.stdin) {
    const value = await readUtf8Stdin();
    return analyzeTextStats(value.text, value.input, runtimeOptions);
  }
  return analyzeTextFile({ input_path: options.input[0] }, runtimeOptions);
}

async function runImageCommand(action, options, runtimeOptions = {}) {
  if (action === 'colors') {
    assertOnlyCommandOptions(options, new Set(['input', 'count', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'image colors requires exactly one --input.');
    const count = options.count === undefined ? undefined : Number(options.count);
    if (count !== undefined && (!Number.isInteger(count) || count < 2 || count > 9)) throw new ToolKnitError('USAGE', '--count must be an integer from 2 to 9.');
    return extractColorPalette({ input_path: options.input[0], count }, runtimeOptions);
  }
  if (action === 'stitch') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'output-name', 'mode', 'reference', 'spacing', 'scale', 'background', 'format', 'jpeg-quality', 'json', 'banner']));
    if (options.input.length < 2 || options.input.length > 100) throw new ToolKnitError('USAGE', 'image stitch requires 2 to 100 --input values.');
    const mode = options.mode || 'vertical';
    const reference = options.reference || 'first';
    const spacing = options.spacing === undefined ? 0 : Number(options.spacing);
    const scale = options.scale === undefined ? 100 : Number(options.scale);
    const format = options.format || 'png';
    const jpegQuality = options['jpeg-quality'] === undefined ? 92 : Number(options['jpeg-quality']);
    if (!['vertical', 'horizontal'].includes(mode)) throw new ToolKnitError('USAGE', '--mode must be vertical or horizontal.');
    if (!['first', 'smallest', 'largest'].includes(reference)) throw new ToolKnitError('USAGE', '--reference must be first, smallest, or largest.');
    if (!Number.isInteger(spacing) || spacing < 0 || spacing > 500) throw new ToolKnitError('USAGE', '--spacing must be an integer from 0 to 500.');
    if (!Number.isInteger(scale) || scale < 10 || scale > 100) throw new ToolKnitError('USAGE', '--scale must be an integer from 10 to 100.');
    if (!['png', 'jpg'].includes(format)) throw new ToolKnitError('USAGE', '--format must be png or jpg.');
    if (!Number.isInteger(jpegQuality) || jpegQuality < 60 || jpegQuality > 100) throw new ToolKnitError('USAGE', '--jpeg-quality must be an integer from 60 to 100.');
    return stitchImages({
      input_paths: options.input,
      output_dir: requireOption(options, 'output-dir'),
      output_name: options['output-name'],
      mode,
      reference,
      spacing_px: spacing,
      scale_percent: scale,
      background_rgba: options.background || '#FFFFFFFF',
      format,
      jpeg_quality: jpegQuality
    }, runtimeOptions);
  }
  throw new ToolKnitError('USAGE', `Unknown image action: ${action}`);
}

async function runPptCommand(action, options, runtimeOptions = {}) {
  if (action === 'images') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'pages', 'images', 'skip-duplicates', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'ppt images requires exactly one --input.');
    const pages = options.pages === undefined ? undefined : parsePageRanges(options.pages);
    const images = options.images === undefined ? undefined : parsePageRanges(options.images);
    return extractPptImages({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      pages,
      images,
      skip_duplicates: options['skip-duplicates'] === true,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'text' || action === 'extract-text') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'pages', 'format', 'ai-mode', 'locale', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', `ppt ${action} requires exactly one --input.`);
    const pages = options.pages === undefined ? undefined : parsePageRanges(options.pages);
    const format = options.format === undefined ? 'markdown' : options.format.trim().toLowerCase();
    const aiMode = options['ai-mode'] === undefined ? 'none' : options['ai-mode'].trim().toLowerCase();
    const locale = options.locale || 'zh-CN';
    if (!['markdown', 'md', 'txt', 'text', 'json', 'all'].includes(format)) throw new ToolKnitError('USAGE', '--format must be markdown, txt, json, or all.');
    if (!['none', 'off', 'false', 'no', 'outline', 'speaker-notes', 'notes', 'script', 'meeting-notes', 'meeting', 'study-notes', 'study'].includes(aiMode)) throw new ToolKnitError('USAGE', '--ai-mode must be none, outline, speaker-notes, meeting-notes, or study-notes.');
    if (!['zh-CN', 'en'].includes(locale)) throw new ToolKnitError('USAGE', '--locale must be zh-CN or en.');
    return extractPptText({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      pages,
      format,
      ai_mode: aiMode,
      locale,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'compress') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'level', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'ppt compress requires exactly one --input.');
    const level = options.level === undefined ? 'medium' : options.level.trim().toLowerCase();
    if (!['low', 'safe', 'light', 'medium', 'balanced', 'standard', 'normal', 'high', 'strong', 'aggressive'].includes(level)) {
      throw new ToolKnitError('USAGE', '--level must be low, medium, or high.');
    }
    return compressPpt({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      level,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'to-pdf' || action === 'pdf') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', `ppt ${action} requires exactly one --input.`);
    return convertPptToPdf({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'to-image' || action === 'images-export') {
    assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'pages', 'format', 'clarity', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.input.length !== 1) throw new ToolKnitError('USAGE', `ppt ${action} requires exactly one --input.`);
    const pages = options.pages === undefined ? undefined : parsePageRanges(options.pages);
    const format = options.format === undefined ? 'png' : options.format.trim().toLowerCase();
    const clarity = options.clarity === undefined ? 'high' : options.clarity.trim().toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(format)) throw new ToolKnitError('USAGE', '--format must be png, jpg, or webp.');
    if (!['standard', 'high', 'print'].includes(clarity)) throw new ToolKnitError('USAGE', '--clarity must be standard, high, or print.');
    return convertPptToImages({
      input_path: options.input[0],
      output_dir: requireOption(options, 'output-dir'),
      pages,
      format,
      clarity,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'outline') {
    assertOnlyCommandOptions(options, new Set(['prompt', 'prompt-file', 'output-dir', 'slide-count', 'deck-type', 'audience', 'purpose', 'tone', 'style', 'locale', 'dry-run', 'output-name', 'json', 'banner']));
    if (options.prompt && options['prompt-file']) {
      throw new ToolKnitError('USAGE', 'Use either --prompt or --prompt-file, not both.');
    }
    const prompt = options['prompt-file']
      ? await readPromptFile(options['prompt-file'])
      : requireOption(options, 'prompt');
    const slideCount = options['slide-count'] === undefined ? 8 : Number(options['slide-count']);
    if (!Number.isSafeInteger(slideCount) || slideCount < 3 || slideCount > 30) {
      throw new ToolKnitError('USAGE', '--slide-count must be an integer from 3 to 30.');
    }
    const deckType = options['deck-type'] === undefined ? 'auto' : String(options['deck-type']).trim();
    if (!['auto', 'product-launch', 'investor-pitch', 'work-report', 'training', 'industry-research', 'competitive-analysis', 'short-video-demo', 'project-review'].includes(deckType)) {
      throw new ToolKnitError('USAGE', '--deck-type must be auto, product-launch, investor-pitch, work-report, training, industry-research, competitive-analysis, short-video-demo, or project-review.');
    }
    const locale = options.locale || 'zh-CN';
    if (!['zh-CN', 'en'].includes(locale)) throw new ToolKnitError('USAGE', '--locale must be zh-CN or en.');
    return generatePptOutline({
      prompt,
      output_dir: requireOption(options, 'output-dir'),
      slide_count: slideCount,
      deck_type: deckType,
      audience: options.audience,
      purpose: options.purpose,
      tone: options.tone,
      style: options.style,
      locale,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  if (action === 'draft') {
    assertOnlyCommandOptions(options, new Set(['prompt', 'prompt-file', 'outline-file', 'output-dir', 'slide-count', 'deck-type', 'audience', 'purpose', 'tone', 'style', 'theme', 'locale', 'dry-run', 'output-name', 'json', 'banner']));
    const promptInputs = [options.prompt ? 'prompt' : '', options['prompt-file'] ? 'prompt-file' : '', options['outline-file'] ? 'outline-file' : ''].filter(Boolean);
    if (promptInputs.length !== 1) {
      throw new ToolKnitError('USAGE', 'Use exactly one of --prompt, --prompt-file, or --outline-file.');
    }
    const prompt = options['prompt-file']
      ? await readPromptFile(options['prompt-file'])
      : options.prompt;
    const slideCount = options['slide-count'] === undefined ? undefined : Number(options['slide-count']);
    if (slideCount !== undefined && (!Number.isSafeInteger(slideCount) || slideCount < 3 || slideCount > 30)) {
      throw new ToolKnitError('USAGE', '--slide-count must be an integer from 3 to 30.');
    }
    const deckType = options['deck-type'] === undefined ? 'auto' : String(options['deck-type']).trim();
    if (!['auto', 'product-launch', 'investor-pitch', 'work-report', 'training', 'industry-research', 'competitive-analysis', 'short-video-demo', 'project-review'].includes(deckType)) {
      throw new ToolKnitError('USAGE', '--deck-type must be auto, product-launch, investor-pitch, work-report, training, industry-research, competitive-analysis, short-video-demo, or project-review.');
    }
    const locale = options.locale || 'zh-CN';
    if (!['zh-CN', 'en'].includes(locale)) throw new ToolKnitError('USAGE', '--locale must be zh-CN or en.');
    // Single-template product decision: legacy --theme hints are accepted for
    // backward compatibility but always normalized to the black/white minimal
    // template so the CLI and desktop output stay identical.
    const theme = 'minimal-mono';
    return generatePptDraft({
      prompt,
      outline_path: options['outline-file'],
      output_dir: requireOption(options, 'output-dir'),
      slide_count: slideCount,
      deck_type: deckType,
      audience: options.audience,
      purpose: options.purpose,
      tone: options.tone,
      style: options.style,
      theme,
      locale,
      dry_run: options['dry-run'] === true,
      output_name: options['output-name']
    }, runtimeOptions);
  }
  throw new ToolKnitError('USAGE', `Unknown PPT action: ${action}`);
}

async function runHardwareCommand(action, options, runtimeOptions = {}) {
  assertOnlyCommandOptions(options, new Set(['json']));
  const handlers = {
    overview: inspectHardwareOverview,
    'cpu-memory': inspectCpuMemoryInfo,
    'cpu-memory-live-stats': inspectCpuMemoryLiveStats,
    'gpu-display': inspectGpuDisplayInfo,
    'mainboard-firmware': inspectMainboardFirmwareInfo,
    'storage-health': inspectStorageHealthInfo,
    'network-devices': inspectNetworkDevicesInfo,
    'power-sensors': inspectPowerSensorsInfo
  };
  const handler = handlers[action];
  if (!handler) throw new ToolKnitError('USAGE', `Unknown hardware action: ${action}`);
  return handler(runtimeOptions);
}

function renderHardwareSuccess(result, json, bannerMode) {
  if (json) return renderSuccess(result, true, bannerMode);
  return JSON.stringify(result, null, 2);
}

async function readOperationsFile(filePathValue) {
  const filePath = path.resolve(requireOption({ value: filePathValue }, 'value'));
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new ToolKnitError('USAGE', `Operations file cannot be read: ${filePath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 2 || metadata.size > 1024 * 1024) {
    throw new ToolKnitError('USAGE', 'Operations file must be a regular JSON file no larger than 1 MB.');
  }
  return readFile(filePath, 'utf8');
}

async function readPromptFile(filePathValue) {
  const filePath = path.resolve(requireOption({ value: filePathValue }, 'value'));
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new ToolKnitError('USAGE', `Prompt file cannot be read: ${filePath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1 || metadata.size > 128 * 1024) {
    throw new ToolKnitError('USAGE', 'Prompt file must be a regular UTF-8 text file no larger than 128 KB.');
  }
  return (await readFile(filePath, 'utf8')).trim();
}

async function parseEditOperations(options) {
  if (options.operations && options['operations-file']) {
    throw new ToolKnitError('USAGE', 'Use either --operations or --operations-file, not both.');
  }
  const source = options['operations-file']
    ? await readOperationsFile(options['operations-file'])
    : requireOption(options, 'operations');
  try {
    const operations = JSON.parse(source);
    if (!Array.isArray(operations)) throw new Error('not-array');
    return operations;
  } catch {
    throw new ToolKnitError('USAGE', 'Edit operations must be a valid JSON array.');
  }
}

async function runAiDocCommand(action, options, runtimeOptions = {}) {
  if (action === 'create') {
    if (options.prompt && options['prompt-file']) {
      throw new ToolKnitError('USAGE', 'Use either --prompt or --prompt-file, not both.');
    }
    const prompt = options['prompt-file']
      ? await readPromptFile(options['prompt-file'])
      : requireOption(options, 'prompt');
    const pageCount = options['page-count'] === undefined ? 3 : Number(options['page-count']);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 8) {
      throw new ToolKnitError('USAGE', '--page-count must be an integer from 1 to 8.');
    }
    const locale = options.locale || 'zh-CN';
    if (!['zh-CN', 'en'].includes(locale)) throw new ToolKnitError('USAGE', '--locale must be zh-CN or en.');
    return generateAiDocument({
      prompt,
      output_path: requireOption(options, 'output'),
      page_count: pageCount,
      locale,
      overwrite: options.overwrite === true
    }, runtimeOptions);
  }
  const projectPath = requireOption(options, 'project');
  if (action === 'inspect') return inspectAiDocumentProject({ project_path: projectPath });
  if (action === 'edit') {
    return editAiDocumentProject({
      project_path: projectPath,
      operations: await parseEditOperations(options),
      dry_run: options['dry-run'] === true
    }, runtimeOptions);
  }
  if (action === 'undo') {
    const steps = options.steps === undefined ? 1 : Number(options.steps);
    if (!Number.isSafeInteger(steps) || steps < 1) throw new ToolKnitError('USAGE', '--steps must be a positive integer.');
    return editAiDocumentProject({ project_path: projectPath, operations: [{ type: 'undo', steps }] }, runtimeOptions);
  }
  if (action === 'render') return renderAiDocumentProject({ project_path: projectPath }, runtimeOptions);
  throw new ToolKnitError('USAGE', `Unknown AI document action: ${action}`);
}

async function runAiTableCommand(action, options, runtimeOptions = {}) {
  if (action === 'create') {
    if (options.prompt && options['prompt-file']) {
      throw new ToolKnitError('USAGE', 'Use either --prompt or --prompt-file, not both.');
    }
    const prompt = options['prompt-file']
      ? await readPromptFile(options['prompt-file'])
      : requireOption(options, 'prompt');
    const locale = options.locale || 'zh-CN';
    if (!['zh-CN', 'en'].includes(locale)) throw new ToolKnitError('USAGE', '--locale must be zh-CN or en.');
    const outputPath = requireOption(options, 'output');
    const format = options.format || path.extname(outputPath).slice(1).toLowerCase();
    if (!['csv', 'xlsx', 'pdf', 'png'].includes(format)) {
      throw new ToolKnitError('USAGE', '--format must be csv, xlsx, pdf, or png.');
    }
    if (!path.extname(outputPath)) {
      throw new ToolKnitError('USAGE', '--output must end with .csv, .xlsx, .pdf, or .png.');
    }
    if (options.format && options.format !== format) {
      throw new ToolKnitError('USAGE', '--format must match the output extension.');
    }
    return generateAiTableProject({
      prompt,
      output_path: outputPath,
      format,
      locale,
      overwrite: options.overwrite === true
    }, runtimeOptions);
  }
  const projectPath = requireOption(options, 'project');
  if (action === 'inspect') return inspectAiTableProjectFile({ project_path: projectPath });
  if (action === 'edit') {
    return editAiTableProject({
      project_path: projectPath,
      operations: await parseEditOperations(options),
      dry_run: options['dry-run'] === true
    }, runtimeOptions);
  }
  if (action === 'undo') {
    const steps = options.steps === undefined ? 1 : Number(options.steps);
    if (!Number.isSafeInteger(steps) || steps < 1) throw new ToolKnitError('USAGE', '--steps must be a positive integer.');
    return editAiTableProject({ project_path: projectPath, operations: [{ type: 'undo', steps }] }, runtimeOptions);
  }
  if (action === 'render') return renderAiTableProject({ project_path: projectPath }, runtimeOptions);
  throw new ToolKnitError('USAGE', `Unknown AI table action: ${action}`);
}

async function runModelCommand(action, tokens) {
  if (!['list', 'install', 'use'].includes(action)) throw new ToolKnitError('USAGE', `Unknown model action: ${action}`);
  if (action === 'list') {
    const options = parseOptions(tokens);
    assertOnlyCommandOptions(options, new Set(['json', 'banner']));
    return { options, result: { tool: 'model.list', models: await listTranscriptionModels() } };
  }
  const modelId = tokens[0];
  if (!modelId || modelId.startsWith('--')) throw new ToolKnitError('USAGE', `model ${action} requires one of: base, small, medium.`);
  const options = parseOptions(tokens.slice(1));
  if (action === 'install') {
    assertOnlyCommandOptions(options, new Set(['source', 'json', 'banner']));
    return { options, result: await installTranscriptionModel({ model_id: modelId, source: options.source || 'auto' }) };
  }
  assertOnlyCommandOptions(options, new Set(['json', 'banner']));
  return { options, result: await setCurrentTranscriptionModel({ model_id: modelId }) };
}

async function runTranscribeCommand(options, runtimeOptions = {}) {
  assertOnlyCommandOptions(options, new Set(['input', 'output-dir', 'language', 'refine', 'json', 'banner']));
  if (options.input.length !== 1) throw new ToolKnitError('USAGE', 'transcribe requires exactly one --input.');
  return transcribeMedia({
    input_path: options.input[0],
    output_dir: requireOption(options, 'output-dir'),
    language: options.language || 'auto',
    refine: options.refine === true
  }, runtimeOptions);
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'mcp') {
    if (argv.length === 1 || argv[1] === '--help' || (argv[1] === 'serve' && argv[2] === '--help')) {
      process.stdout.write(`${MCP_HELP}\n`);
      return null;
    }
    if (argv[1] === 'serve') {
      if (argv.length !== 2) throw new ToolKnitError('USAGE', 'toolknit mcp serve does not accept additional options.');
      startMcpServer();
      return null;
    }
    throw new ToolKnitError('USAGE', 'Use: toolknit mcp serve');
  }
  if (argv.length === 0 || argv[0] === '--help') {
    process.stdout.write(`${HELP}\n`);
    return null;
  }
  if (argv[0] === 'help') {
    if (argv.length === 1) {
      process.stdout.write(`${HELP}\n`);
      return null;
    }
    if (argv[1] === 'pdf' && argv.length === 2) {
      process.stdout.write(`${PDF_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'pdf' && argv.length === 3 && PDF_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${PDF_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'audio' && argv.length === 2) {
      process.stdout.write(`${AUDIO_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'audio' && argv.length === 3 && AUDIO_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${AUDIO_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'transcribe' && argv.length === 2) { process.stdout.write(`${TRANSCRIBE_HELP}\n`); return null; }
    if (argv[1] === 'model' && argv.length === 2) { process.stdout.write(`${MODEL_HELP}\n`); return null; }
    if (argv[1] === 'mcp' && argv.length === 2) { process.stdout.write(`${MCP_HELP}\n`); return null; }
    if (argv[1] === 'video' && argv.length === 2) {
      process.stdout.write(`${VIDEO_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'video' && argv.length === 3 && VIDEO_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${VIDEO_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'text' && argv.length === 2) {
      process.stdout.write(`${TEXT_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'text' && argv.length === 3 && TEXT_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${TEXT_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'image' && argv.length === 2) { process.stdout.write(`${IMAGE_OVERVIEW}\n`); return null; }
    if (argv[1] === 'image' && argv.length === 3 && IMAGE_COMMAND_HELP[argv[2]]) { process.stdout.write(`${IMAGE_COMMAND_HELP[argv[2]]}\n`); return null; }
    if (argv[1] === 'ppt' && argv.length === 2) { process.stdout.write(`${PPT_OVERVIEW}\n`); return null; }
    if (argv[1] === 'ppt' && argv.length === 3 && PPT_COMMAND_HELP[argv[2]]) { process.stdout.write(`${PPT_COMMAND_HELP[argv[2]]}\n`); return null; }
    if (argv[1] === 'hardware' && argv.length === 2) { process.stdout.write(`${HARDWARE_OVERVIEW}\n`); return null; }
    if (argv[1] === 'hardware' && argv.length === 3 && HARDWARE_COMMAND_HELP[argv[2]]) { process.stdout.write(`${HARDWARE_COMMAND_HELP[argv[2]]}\n`); return null; }
    if (argv[1] === 'ai-doc' && argv.length === 2) {
      process.stdout.write(`${AI_DOC_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'ai-doc' && argv.length === 3 && AI_DOC_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${AI_DOC_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'ai-table' && argv.length === 2) {
      process.stdout.write(`${AI_TABLE_OVERVIEW}\n`);
      return null;
    }
    if (argv[1] === 'ai-table' && argv.length === 3 && AI_TABLE_COMMAND_HELP[argv[2]]) {
      process.stdout.write(`${AI_TABLE_COMMAND_HELP[argv[2]]}\n`);
      return null;
    }
    if (argv[1] === 'agent') {
      const language = parseAgentGuideLanguage(argv.slice(2));
      if (language === null) process.stdout.write(`${AGENT_GUIDE_HELP}\n`);
      else await writeAgentGuide(language);
      return null;
    }
    throw new ToolKnitError('USAGE', 'Help is available as: toolknit help, toolknit help pdf, toolknit help audio, toolknit help transcribe, toolknit help model, toolknit help mcp, toolknit help video, toolknit help text, toolknit help image, toolknit help ppt, toolknit help hardware, toolknit help ai-doc, toolknit help ai-table, or toolknit help agent.');
  }
  if (argv[0] === '--version' || argv[0] === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return null;
  }
  if (argv[0] === 'doctor') {
    const options = parseOptions(argv.slice(1));
    const bannerMode = parseBannerMode(options.banner);
    const result = {
      version: VERSION,
      node: process.version,
      qpdf: await checkQpdfAvailability(),
      ffmpeg: await checkFfmpegAvailability()
    };
    const banner = renderToolKnitBanner({ mode: bannerMode });
    const output = options.json
      ? JSON.stringify({ ok: result.qpdf.available && result.ffmpeg.available, result })
      : `${banner ? `${banner}\n\n` : ''}ToolKnit CLI ${VERSION}\nqpdf: ${result.qpdf.available ? 'available' : 'unavailable'}\nffmpeg: ${result.ffmpeg.available ? 'available' : 'unavailable'}`;
    process.stdout.write(`${output}\n`);
    return result.qpdf.available && result.ffmpeg.available ? EXIT_CODES.OK : EXIT_CODES.ENGINE;
  }
  if (argv[0] === 'agent') {
    if (argv[1] === '--help') {
      process.stdout.write(`${AGENT_GUIDE_HELP}\n`);
      return null;
    }
    if (argv[1] === 'guide') {
      const language = parseAgentGuideLanguage(argv.slice(2));
      if (language === null) process.stdout.write(`${AGENT_GUIDE_HELP}\n`);
      else await writeAgentGuide(language);
      return null;
    }
    throw new ToolKnitError('USAGE', 'Use: toolknit agent guide [--lang zh|en]');
  }
  if (argv[0] === 'audio') {
    if (argv.length === 1 || argv[1] === '--help') {
      process.stdout.write(`${AUDIO_OVERVIEW}\n`);
      return null;
    }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!AUDIO_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown audio action: ${action}`);
      process.stdout.write(`${AUDIO_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`audio.${action}`, options, runtime => runAudioCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'transcribe') {
    if (argv.length === 1 || argv[1] === '--help') { process.stdout.write(`${TRANSCRIBE_HELP}\n`); return null; }
    const options = parseOptions(argv.slice(1));
    if (options.help) { process.stdout.write(`${TRANSCRIBE_HELP}\n`); return null; }
    const result = await runCliTask('transcribe', options, runtime => runTranscribeCommand(options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'model') {
    if (argv.length === 1 || argv[1] === '--help') { process.stdout.write(`${MODEL_HELP}\n`); return null; }
    const action = argv[1];
    if (argv[2] === '--help') { process.stdout.write(`${MODEL_HELP}\n`); return null; }
    let options;
    let result;
    if (action === 'install') {
      const modelId = argv[2];
      if (!modelId || modelId.startsWith('--')) throw new ToolKnitError('USAGE', 'model install requires one of: base, small, medium.');
      options = parseOptions(argv.slice(3));
      assertOnlyCommandOptions(options, new Set(['source', 'json', 'banner']));
      result = await runCliTask('model.install', options, runtime => installTranscriptionModel({ model_id: modelId, source: options.source || 'auto' }, runtime));
    } else {
      ({ options, result } = await runModelCommand(action, argv.slice(2)));
    }
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'video') {
    if (argv.length === 1 || argv[1] === '--help') {
      process.stdout.write(`${VIDEO_OVERVIEW}\n`);
      return null;
    }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!VIDEO_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown video action: ${action}`);
      process.stdout.write(`${VIDEO_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`video.${action}`, options, runtime => runVideoCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'text') {
    if (argv.length === 1 || argv[1] === '--help') {
      process.stdout.write(`${TEXT_OVERVIEW}\n`);
      return null;
    }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!TEXT_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown text action: ${action}`);
      process.stdout.write(`${TEXT_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`text.${action}`, options, runtime => runTextCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'image') {
    if (argv.length === 1 || argv[1] === '--help') { process.stdout.write(`${IMAGE_OVERVIEW}\n`); return null; }
    const action = argv[1]; const options = parseOptions(argv.slice(2));
    if (options.help) { if (!IMAGE_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown image action: ${action}`); process.stdout.write(`${IMAGE_COMMAND_HELP[action]}\n`); return null; }
    const result = await runCliTask(`image.${action}`, options, runtime => runImageCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`); return EXIT_CODES.OK;
  }
  if (argv[0] === 'ppt') {
    if (argv.length === 1 || argv[1] === '--help') { process.stdout.write(`${PPT_OVERVIEW}\n`); return null; }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!PPT_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown PPT action: ${action}`);
      process.stdout.write(`${PPT_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`ppt.${action}`, options, runtime => runPptCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'hardware') {
    if (argv.length === 1 || argv[1] === '--help') { process.stdout.write(`${HARDWARE_OVERVIEW}\n`); return null; }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!HARDWARE_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown hardware action: ${action}`);
      process.stdout.write(`${HARDWARE_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`hardware.${action}`, options, runtime => runHardwareCommand(action, options, runtime));
    process.stdout.write(`${renderHardwareSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'ai-doc') {
    if (argv.length === 1 || argv[1] === '--help') {
      process.stdout.write(`${AI_DOC_OVERVIEW}\n`);
      return null;
    }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!AI_DOC_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown AI document action: ${action}`);
      process.stdout.write(`${AI_DOC_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`ai-doc.${action}`, options, runtime => runAiDocCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] === 'ai-table') {
    if (argv.length === 1 || argv[1] === '--help') {
      process.stdout.write(`${AI_TABLE_OVERVIEW}\n`);
      return null;
    }
    const action = argv[1];
    const options = parseOptions(argv.slice(2));
    if (options.help) {
      if (!AI_TABLE_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown AI table action: ${action}`);
      process.stdout.write(`${AI_TABLE_COMMAND_HELP[action]}\n`);
      return null;
    }
    const result = await runCliTask(`ai-table.${action}`, options, runtime => runAiTableCommand(action, options, runtime));
    process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
    return EXIT_CODES.OK;
  }
  if (argv[0] !== 'pdf') throw new ToolKnitError('USAGE', `Unknown command: ${argv[0]}`);
  if (argv.length === 1 || argv[1] === '--help') {
    process.stdout.write(`${PDF_OVERVIEW}\n`);
    return null;
  }
  const action = argv[1];
  const options = parseOptions(argv.slice(2));
  if (options.help) {
    if (!PDF_COMMAND_HELP[action]) throw new ToolKnitError('USAGE', `Unknown PDF action: ${action}`);
    process.stdout.write(`${PDF_COMMAND_HELP[action]}\n`);
    return null;
  }
  const result = await runCliTask(`pdf.${action}`, options, runtime => runPdfCommand(action, options, runtime));
  process.stdout.write(`${renderSuccess(result, options.json, parseBannerMode(options.banner))}\n`);
  return EXIT_CODES.OK;
}

try {
  const exitCode = await main();
  if (typeof exitCode === 'number') process.exitCode = exitCode;
} catch (error) {
  const json = process.argv.includes('--json');
  const normalized = toToolKnitError(error);
  process.stderr.write(`${renderFailure(normalized, json)}\n`);
  process.exitCode = normalized.exitCode;
}
