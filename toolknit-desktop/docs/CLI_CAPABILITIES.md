# V3.2 CLI / MCP 能力清单

版本 3.2.0，77 项 MCP 能力；CLI 可通过对应命令或通用 run 入口调用同一能力。本文由 scripts/sync-cli-catalog.mjs 从注册表生成。V3.2 尚未发布 npm。

需要 Node.js >=22.13.0。本地工具不要求 AI Key；标有 AI 的操作仅在主动调用或明确开启 AI 模式时请求外部服务。

## 能力目录

| CLI（前缀 toolknit） | MCP 名称 | 参数与边界 |
| --- | --- | --- |
| `text format` | `toolknit_text_format` | Apply one explicit local text transformation. Returns text; writes no files. |
| `dev json` | `toolknit_json` | Format or compact UTF-8 JSON locally. Invalid inputs return no original text in diagnostics. |
| `dev base64` | `toolknit_base64` | Encode or decode UTF-8 Base64 locally. This is encoding, not encryption. |
| `dev url` | `toolknit_url_codec` | Encode or decode a URL component locally; does not visit the URL. |
| `dev uuid` | `toolknit_uuid` | Generate 1-100 UUID v4 identifiers. They are identifiers, not passwords. |
| `dev jwt` | `toolknit_jwt_decode` | Decode a caller-supplied JWT header and payload locally. Does not verify the signature, authorize a user or return the signature. |
| `dev hash` | `toolknit_hash` | Compute a local file or UTF-8 text checksum. MD5 and SHA-1 are legacy checksums, not authentication. No encryption keys are accepted. |
| `calculate timestamp` | `toolknit_timestamp` | Convert an explicit Unix timestamp or ISO date with timezone to UTC. No guessed timezone or clock-dependent output. |
| `calculate bmi` | `toolknit_bmi` | Calculate adult BMI and estimated body composition using the desktop formula. Informational estimates, not a diagnosis. Height/waist/neck/hip in cm, weight in kg. |
| `calculate mortgage` | `toolknit_mortgage` | Estimate a repayment schedule. Principal in currency units; annual_rate is percentage; term_years is years. Excludes fees and lender-specific rounding. |
| `calculate interest` | `toolknit_interest` | Estimate simple, compound or recurring investment interest; rate in percent and term in years. Recurring deposits occur at the beginning of each month. Excludes fees/tax. |
| `color convert` | `toolknit_color_convert` | Convert an explicit sRGB HEX color into RGB, HSL, HSV, CMYK, XYZ, Lab/LCH D65 and OKLab/OKLCH using the desktop engine. |
| `pdf to-word` | `toolknit_pdf_to_word` | Convert a text-based PDF to editable DOCX with the desktop layout engine. Default offline; ai_mode=true explicitly sends selected text/region images to the environment-configured vision AI for layout classification. Complex regions may remain images; no scanned OCR. Scoped engine license applies. |
| `pdf text` | `toolknit_pdf_text` | Extract selectable PDF text and reconstruct local Markdown reading order and tables. Does not perform OCR. Returns status and publishes UTF-8 .md or .txt; no network. |
| `pdf crop` | `toolknit_pdf_crop` | Crop selected PDF pages using a normalized rectangle in the rotated visible page: x/y at top-left, width/height in 0..1. Unselected pages remain. Cropping changes page boxes, NOT secure redaction. |
| `pdf page-number` | `toolknit_pdf_page_number` | Add page numbers locally. Reuses desktop position/rotation and font layout; source is unchanged. Form fields are flattened when copying pages. |
| `pdf to-scan` | `toolknit_pdf_to_scan` | Create an image-only PDF with faithful, grayscale or natural scan appearance. This removes searchable text, links, annotations and form behavior. Explicit local operation, no OCR and no network. |
| `pdf create` | `toolknit_pdf_create` | Create a blank PDF without uploading an existing file. A4 or letter, portrait or landscape; 1-100 pages. |
| `image to-pdf` | `toolknit_image_to_pdf` | Convert ordered local images into a PDF, optionally with grayscale/natural scan appearance. PNG/JPEG/WebP/BMP/GIF and multi-page TIFF supported. Animated images require explicit frame_policy=first. Uses desktop page-size, DPI and scan algorithms; no OCR. |
| `image convert` | `toolknit_image_convert` | Convert 1-100 local raster images to PNG, JPEG, WebP, BMP, static GIF or SVG with an embedded PNG (not vector tracing). Preserves displayed dimensions/orientation; JPEG/BMP use white for transparency. Animated/multi-page sources require frame_policy=first. Unique outputs. |
| `image compress` | `toolknit_image_compress` | Optimize PNG/JPEG/WebP images locally, preserving dimensions. PNG/WebP are lossless; JPEG quality high/medium/low uses 90/75/60. Only smaller results are published; no-reduction creates no file. Animated sources are rejected. |
| `image crop` | `toolknit_image_crop` | Crop a static local image with integer pixel coordinates after EXIF orientation, optional quarter-turn and flips. Rectangle must lie inside the transformed image; source is preserved. |
| `image replace-color` | `toolknit_image_color_replace` | Replace an explicit source color with a target using the desktop Lab-distance/edge-softness engine. Optional connected-region selection requires a pixel seed. Output is PNG and keeps alpha. |
| `image icons` | `toolknit_image_icons` | Create a ZIP with aspect-preserving transparent PNG icons, ICO/favicon and an embedded SVG wrapper from one static image. Reuses desktop ICO/SVG generation; no external assets. |
| `ai polish` | `toolknit_ai_polish` | Polish up to 12000 characters using an explicitly chosen style. Sends only the supplied text/style to the AI provider configured in process environment. Returns text without writing files; never reads desktop credentials. |
| `ai translate` | `toolknit_ai_translate` | Translate up to 12000 characters with the environment-configured AI provider. Validates aligned originals against caller input; returns translated text and pairs. Sends the supplied text to the configured endpoint. |
| `pdf ai-markdown` | `toolknit_pdf_ai_markdown` | Use the configured vision AI to transcribe up to 20 selected PDF pages and build a Markdown reading guide. Sends rendered page images and extracted model fragments to that provider. This is an explicit network operation; use pdf text for offline extraction. |
| `excel to-pdf` | `toolknit_excel_to_pdf` | Convert an explicit .xlsx workbook to PDF with an installed LibreOffice runtime in an isolated temporary profile. Preserves workbook print layout; rejects macros, embedded objects and external data connections. WPS/Microsoft Office are not substitutes. |
| `markdown html` | `toolknit_markdown_html` | Export local UTF-8 Markdown as standalone HTML with tables, task lists and MathML formulas. Raw HTML is escaped, images are represented by their alt text, Mermaid remains code; no browser or network is used. |
| `files large` | `toolknit_files_large` | Read-only bounded scan of one explicit directory for large files. Never deletes, follows links or scans implicit system locations. Reports truncated/skipped counts; sizes are bytes. |
| `files duplicates` | `toolknit_files_duplicates` | Read-only scan for byte-identical file duplicates using size then SHA-256. Does not delete anything. Skips symlinks, caps per-file hashing at 256 MiB and total hashing at 2 GiB, and reports incomplete scans. |
| `pdf inspect` | `toolknit_pdf_inspect` | Inspect a local PDF without writing files. Returns its absolute path, byte size, and page count. |
| `pdf merge` | `toolknit_pdf_merge` | Merge two or more local PDFs. Output is created only at output_path. page_selections is optional; omitted inputs contribute every page in source order. |
| `pdf split` | `toolknit_pdf_split` | Export selected pages from one local PDF as individual PDFs in output_dir. The input PDF is never modified. |
| `pdf rotate` | `toolknit_pdf_rotate` | Create a rotated PDF. Use rotation to rotate every page, or page_rotations for explicit per-page rotations. Rotation is a multiple of 90 degrees. |
| `pdf encrypt` | `toolknit_pdf_encrypt` | Create an encrypted PDF using a password of at least 8 characters. The password is handled in memory and is never included in result data or logs. |
| `pdf decrypt` | `toolknit_pdf_decrypt` | Create an unprotected copy of a local PDF. The optional password is handled only in memory and is never included in result data or logs. |
| `pdf compress` | `toolknit_pdf_compress` | Compress a PDF locally. structure preserves document objects; raster explicitly creates an image-only PDF and loses searchable text, links, forms and bookmarks. target_bytes is a strict upper limit. Already compliant, no-reduction and target-not-reached results create no output. |
| `pdf enhance` | `toolknit_pdf_enhance` | Render and enhance a scanned or image-based PDF locally. Output pages are rasterized; searchable text, links, and forms are not preserved. |
| `pdf to-image` | `toolknit_pdf_to_image` | Export one explicit local PDF as page images or as stitched long images. In images mode each selected page is exported separately; in long mode selected pages are stitched into one or more long images. Processing is local, the source PDF is never modified, and outputs are published with unique names only after successful rendering. Resolve paths from the IDE file tree; do not infer them from the MCP process directory. |
| `audio convert` | `toolknit_audio_convert` | Convert one to 100 local audio files with FFmpeg. Supports MP3, AAC, WAV, FLAC, ALAC, and OGG targets. AAC and ALAC produce .m4a. Output files are created only in output_dir, use unique names, and are published only after a successful encode. |
| `audio bpm` | `toolknit_audio_bpm` | Analyze BPM locally from one supported audio file. It uses only the first 120 seconds, never uploads, changes, or creates audio files, and returns the primary BPM, confidence, and up to five candidates. Resolve the input path from the IDE file tree; do not infer it from the MCP working directory. |
| `audio clip` | `toolknit_audio_clip` | Trim one local audio file between explicit start_seconds and end_seconds. The source is never changed. By default ToolKnit preserves its source container with stream copying when possible, otherwise it publishes a clearly reported MP3 fallback. Resolve paths from the IDE file tree; never infer times or paths from chat context. |
| `audio extract` | `toolknit_audio_extract` | Extract a selected local video audio track into an explicit output directory without modifying the source. |
| `model list` | `toolknit_model_list` | List the local offline transcription models shared by ToolKnit desktop and CLI. This does not download or modify files. |
| `model install` | `toolknit_model_install` | Download and integrity-verify one offline Whisper model. The model is installed locally and shared with ToolKnit desktop. Use small unless the user explicitly needs faster base or higher-quality medium. |
| `model use` | `toolknit_model_use` | Choose an already installed offline transcription model as the current ToolKnit model. |
| `transcribe` | `toolknit_transcribe` | Transcribe one explicit local audio or video file with the installed offline model. The source is never uploaded or changed. It creates original JSON, SRT, and TXT in output_dir with unique names. refine=true additionally sends recognized subtitle text, never the media, to the configured AI provider; timecodes and IDs are preserved. First call toolknit_model_list and, only if needed, ask the user before downloading a model. |
| `video convert` | `toolknit_video_convert` | Convert one to 30 explicit local video files with local FFmpeg processing. Supported inputs are MP4, AVI, MKV, MOV, WebM, FLV, WMV, TS, and M4V; targets are MP4, AVI, MKV, MOV, WebM, FLV, WMV, or TS. The source is never modified. Outputs are published with unique names only after a non-empty successful encode. Resolve paths from the IDE file tree; do not infer them from the MCP process directory. |
| `video frame` | `toolknit_video_frame` | Extract one frame from one explicit local video at timestamp_ms. PNG is lossless; JPG uses high quality. The source is never changed, and the output is published with a unique name only after FFmpeg produces a non-empty image. In an IDE, resolve the requested timestamp explicitly from the user or video preview; never guess it. |
| `video gif` | `toolknit_video_gif` | Create one palette-optimized GIF from an explicit start_ms to end_ms segment of one local video. The selection must be 30 seconds or shorter. The source is never changed; the GIF is first verified as non-empty and then published under a unique name. In an IDE, resolve the video path and both frame times from the file tree and user preview. Do not infer a highlight or guess a range; use quality small or tiny when the user asks for a smaller GIF. |
| `text stats` | `toolknit_text_stats` | Calculate deterministic local statistics for one explicit UTF-8 text file without writing files or returning its text content. Returns Unicode character, word, line, paragraph, sentence, punctuation, and reading-time counts. Rejects symbolic links, invalid UTF-8, binary data, and text above 1,000,000 UTF-16 code units. |
| `image colors` | `toolknit_color_extract` | Extract a deterministic dominant palette from one explicit local PNG, JPEG, or WebP image without writing files. Returns ordered HEX, RGB, HSL, population, and percentage values; the source image is not uploaded or returned. |
| `image stitch` | `toolknit_image_stitch` | Stitch 2 to 100 explicit local images vertically or horizontally. Processing is local, source files are never modified, animated GIF is rejected, and a completed PNG/JPG is published with a unique name in output_dir. Preserve the user or IDE file-tree order exactly unless they explicitly request reordering. |
| `ppt images` | `toolknit_ppt_images` | Extract embedded image assets from one local PPTX without modifying the presentation. It preserves original image bytes, assigns stable item numbers, can filter by slide pages or image item numbers, can skip exact duplicates, and writes a manifest.json plus manifest.md into a unique output folder. Resolve paths from the IDE file tree; do not infer them from chat context. |
| `ppt text` | `toolknit_ppt_text` | Extract titles, body text, and speaker notes from one local PPTX without modifying it. Writes Markdown, TXT, JSON, or all formats into a unique output folder. Optional ai_mode sends only extracted text, never the PPTX file, to the configured AI provider for outline, speaker-notes, meeting-notes, or study-notes organization. |
| `ppt compress` | `toolknit_ppt_compress` | Create an optimized copy of one local PPTX without modifying the source. It repacks the PPTX, removes safe redundant package data, removes unused media, deduplicates exact duplicate media, and can recompress large images for medium/high levels. It writes a manifest.json into a unique output folder and keeps original images when recompression does not reduce size. |
| `ppt to-pdf` | `toolknit_ppt_to_pdf` | Render one local PPTX to PDF with LibreOffice headless. ToolKnit pre-validates the PPTX package, writes a PDF plus manifest.json into a unique output folder, never modifies the source PPTX, and reports dependency_missing when LibreOffice/soffice is unavailable. |
| `ppt to-image` | `toolknit_ppt_to_image` | Render selected PPTX slides to per-page images. It uses LibreOffice headless to create a temporary PDF, then ToolKnit renders selected pages to PNG/JPG/WebP; the temporary PDF is removed and the source PPTX is never modified. |
| `ppt outline` | `toolknit_ppt_outline` | Generate a structured presentation outline from a text brief. It writes outline.md, outline.json, and manifest.json into a unique output folder. This tool does not read or upload a PPTX and does not generate a PPTX file; it sends only the supplied brief text to the configured AI provider. The outline includes deck type presets, fact boundaries, slide roles, layout intent, and a self-check score for the later PPTX draft workflow. |
| `ppt draft` | `toolknit_ppt_draft` | Generate an editable PPTX draft from a text brief or an existing ToolKnit outline JSON. Prompt mode sends only the supplied brief to the configured AI provider, then ToolKnit writes the PPTX locally. Outline mode does not call AI. It outputs a PPTX, outline.json, outline.md, and manifest.json into a unique folder. Deck type presets from the outline flow are accepted here too. |
| `hardware overview` | `toolknit_hardware_overview` | Inspect local system and core hardware information on Windows without writing files. Returns a read-only overview of the device, OS, CPU, memory, GPU, storage, firmware, and battery state. |
| `hardware cpu-memory` | `toolknit_hardware_cpu_memory` | Inspect local CPU and memory information on Windows without writing files. Returns processor specs, memory topology, per-module details, and current usage. |
| `hardware cpu-memory-live-stats` | `toolknit_hardware_cpu_memory_live_stats` | Inspect the current CPU and memory live statistics on Windows without writing files. Returns usage and available memory counters only. |
| `hardware gpu-display` | `toolknit_hardware_gpu_display` | Inspect local GPU and display information on Windows without writing files. Returns graphics adapters, drivers, VRAM, and connected displays. |
| `hardware mainboard-firmware` | `toolknit_hardware_mainboard_firmware` | Inspect local mainboard and firmware information on Windows without writing files. Returns motherboard, BIOS/UEFI, security, chassis, and PCI device information. |
| `hardware storage-health` | `toolknit_hardware_storage_health` | Inspect local storage and health information on Windows without writing files. Returns physical disks, volumes, capacity, and reliability counters when available. |
| `hardware network-devices` | `toolknit_hardware_network_devices` | Inspect local network and connected device information on Windows without writing files. Returns adapters, Bluetooth, audio, USB, and camera devices. |
| `hardware power-sensors` | `toolknit_hardware_power_sensors` | Inspect local power and sensor information on Windows without writing files. Returns the active power plan, battery state, thermal zones, and fans when exposed. |
| `ai-doc create` | `toolknit_ai_document` | Generate a polished A4 document project from a natural-language brief. Returns the PDF, editable .toolknit.json project, clean previews, a high-resolution numbered map for every page, an overview, and revision history. For IDE requests such as "save in this project", resolve the workspace root and pass an absolute output_path inside it. |
| `ai-doc inspect` | `toolknit_ai_document_inspect` | Inspect an editable ToolKnit AI document without changing files. Returns every stable control number, type, text, style, position, lock state, artifact path, and diagnostic. |
| `ai-doc edit` | `toolknit_ai_document_edit` | Atomically edit a ToolKnit AI document by stable control number. Resolve a natural-language target by inspecting exact control text/type first; ask the user when multiple controls match. Supports single-control text/style changes, document-wide typography/color/alignment rules, position swaps, move/resize, image or content insertion, deletion, locking, grouping, relative alignment, overlap resolution, and undo. Use update_document_style only for explicit global requests; it skips images, dividers, headers, footers, and locked controls unless types is supplied. Image insertion requires an absolute local PNG/JPEG source_path. A successful non-dry-run edit creates a new revision and refreshes all artifacts. |
| `ai-doc render` | `toolknit_ai_document_render` | Deterministically regenerate the bound PDF, clean previews, and numbered control maps from an existing ToolKnit AI document project without creating a new revision. |
| `ai-table create` | `toolknit_ai_table` | Generate an editable ToolKnit AI table project from a natural-language brief. Returns the export file, editable .toolknit-table.json project, preview, and revision history. For IDE requests such as "save in this project", resolve the workspace root and pass an absolute output_path inside it. |
| `ai-table inspect` | `toolknit_ai_table_inspect` | Inspect an editable ToolKnit AI table project without changing files. Returns stable row, column, and chart numbers plus the export and preview artifact paths. |
| `ai-table edit` | `toolknit_ai_table_edit` | Atomically edit a ToolKnit AI table by stable row, column, or chart reference. Supports cell updates, row and column inserts or deletes, swaps, reordering, sorting, chart updates, and undo. A successful non-dry-run edit creates a new revision and refreshes all artifacts. |
| `ai-table render` | `toolknit_ai_table_render` | Deterministically regenerate the export file and preview from an existing ToolKnit AI table project without creating a new revision. |

运行 `toolknit tools describe <MCP名称> --json` 查看精确参数；结构化参数推荐 `toolknit run <MCP名称> --arguments-file request.json --json`，密码仅从 `--arguments-stdin` 传入。不要把 AI Key 写入参数、文件路径或 Agent 对话。

## 桌面覆盖

73 个桌面工具：60 项支持、6 项按明确范围部分支持、7 项保留桌面。MCP 另有 PDF 检查、模型管理和工程编辑等辅助接口，因此数量与桌面卡片数不同。

| 桌面工具 ID | 覆盖 | MCP 接口 / 说明 |
| --- | --- | --- |
| `quick-screenshot` | 保留桌面 |  Interactive selection, annotations and pinned windows require a visible desktop session. |
| `clipboard-history` | 保留桌面 |  Background monitoring and encrypted personal history stay behind the desktop user controls. |
| `excel-to-pdf` | 部分支持 | `toolknit_excel_to_pdf` XLSX only; uses LibreOffice and workbook print layout. Legacy XLS, desktop parameter UI and external workbook connections are excluded. |
| `pdf-rotate` | 支持 | `toolknit_pdf_rotate` |
| `pdf-split` | 支持 | `toolknit_pdf_split` |
| `pdf-merge` | 支持 | `toolknit_pdf_merge` |
| `pdf-to-image` | 支持 | `toolknit_pdf_to_image` |
| `image-to-pdf` | 支持 | `toolknit_image_to_pdf` |
| `pdf-to-scan` | 支持 | `toolknit_pdf_to_scan` |
| `pdf-to-word` | 支持 | `toolknit_pdf_to_word` Original/A4 output and explicit AI layout assistance; no scanned OCR. Complex regions may remain images. |
| `pdf-text-markdown` | 支持 | `toolknit_pdf_text` |
| `pdf-ai-markdown` | 支持 | `toolknit_pdf_ai_markdown` |
| `pdf-page-number` | 支持 | `toolknit_pdf_page_number` |
| `pdf-crop` | 支持 | `toolknit_pdf_crop` |
| `pdf-encrypt` | 支持 | `toolknit_pdf_encrypt` |
| `pdf-decrypt` | 支持 | `toolknit_pdf_decrypt` |
| `pdf-enhance` | 支持 | `toolknit_pdf_enhance` |
| `pdf-compress` | 支持 | `toolknit_pdf_compress` |
| `pdf-editor` | 部分支持 | `toolknit_pdf_create`, `toolknit_pdf_crop`, `toolknit_pdf_page_number`, `toolknit_pdf_rotate`, `toolknit_pdf_merge`, `toolknit_pdf_split` Blank pages and explicit page operations; freeform visual object editing is desktop-only. Crop is not redaction. |
| `ppt-text` | 支持 | `toolknit_ppt_text` |
| `ppt-compress` | 支持 | `toolknit_ppt_compress` |
| `ppt-outline` | 支持 | `toolknit_ppt_outline` |
| `ppt-to-pdf` | 支持 | `toolknit_ppt_to_pdf` |
| `ppt-to-image` | 支持 | `toolknit_ppt_to_image` |
| `ppt-images` | 支持 | `toolknit_ppt_images` |
| `ppt-draft` | 支持 | `toolknit_ppt_draft` |
| `teleprompter` | 保留桌面 |  Real-time scrolling, microphone-following and overlay positioning are interactive presentation functions. |
| `transcription` | 支持 | `toolknit_transcribe`, `toolknit_model_list`, `toolknit_model_install`, `toolknit_model_use` |
| `audio-extract` | 支持 | `toolknit_audio_extract` |
| `convert` | 支持 | `toolknit_audio_convert` |
| `audio-clip` | 支持 | `toolknit_audio_clip` |
| `bpm-detect` | 支持 | `toolknit_audio_bpm` |
| `large-file-cleanup` | 部分支持 | `toolknit_files_large` Explicit bounded directory scanning only; no deletion. |
| `duplicate-file-cleanup` | 部分支持 | `toolknit_files_duplicates` Read-only size/SHA-256 duplicate detection; no deletion or arbitrary keep/delete decisions. |
| `c-drive-cleanup` | 保留桌面 |  System cleanup retains desktop risk review and per-item confirmation; no destructive headless entry. |
| `color-extractor` | 支持 | `toolknit_color_extract` |
| `video-convert` | 支持 | `toolknit_video_convert` |
| `video-frame` | 支持 | `toolknit_video_frame` |
| `video-gif` | 支持 | `toolknit_video_gif` |
| `bg-removal` | 保留桌面 |  Current model/DirectML/CPU lifecycle belongs to the Rust desktop runtime. This standalone npm package does not launch the desktop or ship a second unverified inference/download stack. |
| `markdown-editor` | 部分支持 | `toolknit_markdown_html` Standalone safe HTML and MathML; Mermaid remains code and images are not embedded. Interactive editor/drafts are excluded. |
| `image-color-replace` | 支持 | `toolknit_image_color_replace` |
| `image-convert` | 支持 | `toolknit_image_convert` |
| `image-compress` | 支持 | `toolknit_image_compress` |
| `image-crop` | 支持 | `toolknit_image_crop` |
| `image-stitch` | 支持 | `toolknit_image_stitch` |
| `icon-gen` | 支持 | `toolknit_image_icons` |
| `hardware-overview` | 支持 | `toolknit_hardware_overview` |
| `hardware-cpu-memory` | 支持 | `toolknit_hardware_cpu_memory`, `toolknit_hardware_cpu_memory_live_stats` |
| `hardware-gpu-display` | 支持 | `toolknit_hardware_gpu_display` |
| `hardware-mainboard` | 支持 | `toolknit_hardware_mainboard_firmware` |
| `hardware-storage` | 支持 | `toolknit_hardware_storage_health` |
| `hardware-network-devices` | 支持 | `toolknit_hardware_network_devices` |
| `hardware-power-sensors` | 支持 | `toolknit_hardware_power_sensors` |
| `color-space-compare` | 支持 | `toolknit_color_convert` |
| `hash-crypto` | 部分支持 | `toolknit_hash` Checksums only. Encryption/decryption keys and private plaintext are not placed into Agent transcripts through a new crypto API. |
| `password-gen` | 保留桌面 |  Generated passwords must not enter shell history or Agent/MCP transcripts. |
| `timestamp-calc` | 支持 | `toolknit_timestamp` |
| `bmi-calc` | 支持 | `toolknit_bmi` |
| `mortgage-calc` | 支持 | `toolknit_mortgage` |
| `interest-calc` | 支持 | `toolknit_interest` |
| `typing-test` | 保留桌面 |  Timing and keystroke practice depend on interactive UI. |
| `text-stats` | 支持 | `toolknit_text_stats` |
| `text-format` | 支持 | `toolknit_text_format` |
| `ai-polish` | 支持 | `toolknit_ai_polish` |
| `ai-translate` | 支持 | `toolknit_ai_translate` |
| `ai-doc` | 支持 | `toolknit_ai_document`, `toolknit_ai_document_inspect`, `toolknit_ai_document_edit`, `toolknit_ai_document_render` |
| `ai-table` | 支持 | `toolknit_ai_table`, `toolknit_ai_table_inspect`, `toolknit_ai_table_edit`, `toolknit_ai_table_render` |
| `json-tools` | 支持 | `toolknit_json` |
| `base64` | 支持 | `toolknit_base64` |
| `url-codec` | 支持 | `toolknit_url_codec` |
| `uuid` | 支持 | `toolknit_uuid` |
| `jwt` | 支持 | `toolknit_jwt_decode` |

## 运行边界

- Windows 硬件能力取决于系统查询权限；其他平台不宣称具有完整硬件数据。
- 音视频需要 FFmpeg；PPT/Excel 渲染需要 LibreOffice；离线转写需要已安装的 Whisper 模型。缺少依赖返回结构化错误，不自动下载大模型。
- PDF 转 Word 默认离线，AI 模式只辅助结构；复杂图形/公式可保留图像，扫描件 OCR 不在其转换范围。引擎遵循独立授权，联系 info@toolknit.com。
- 只读文件扫描不删除内容。剪贴板监控、密码生成、系统清理和交互型悬浮窗口没有 headless 入口。
- 直接调用 AI 文本/PDF 图像识别或开启 PDF-to-Word ai_mode 会发送相关文字/区域图像；桌面 Key 不与 CLI/MCP 共享。
- 文件输出显式指定，默认拒绝覆盖。工具若返回 partial/no-reduction 等状态，应检查 outputs、warnings 和逐项结果。
