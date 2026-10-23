# ToolKnit AI Agent Quick Guide

This guide helps users connect ToolKnit to Trae, Cursor, or another MCP-capable IDE so an AI Agent can safely process local PDFs, convert them into images or stitched long images, extract embedded PPTX image assets and text, convert audio and video, and generate polished multi-page AI documents and editable AI tables.

## Connect once

After installing the CLI, add this server in your IDE's MCP settings. Save the configuration and restart the IDE.

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

If the IDE cannot find `toolknit`, configure the absolute Node.js path and CLI entry file instead. The default Windows entry after installation is:

```text
C:\Users\<your-user-name>\AppData\Roaming\npm\node_modules\@toolknit\cli\toolknit.mjs
```

Local PDF, image, audio/video, text, and non-AI PPT tools do not need an AI key. AI documents, AI tables, PPT text AI organization, AI PPT outline generation, AI PPT draft/PPTX generation, and transcription with `refine` require a real `DEEPSEEK_API_KEY` (or `TOOLKNIT_AI_API_KEY`) in the IDE's MCP environment/secret settings; restart the IDE after setting it. Never place the key in an Agent message, document brief, output path, or filename. CLI/MCP does not read the credential stored by ToolKnit Desktop.

V3.2 CLI exposes 77 ToolKnit tools and requires Node.js >=22.13.0. Install it independently of the desktop app. See the [complete capability catalog](CLI_CAPABILITIES.md) or run `toolknit tools list --json`; the following list describes the existing tools.

- `toolknit_pdf_inspect` inspects page counts, sizes, and page-by-page details.
- `toolknit_pdf_merge` merges multiple local PDFs in order into one file.
- `toolknit_pdf_split` splits one PDF by explicit page numbers.
- `toolknit_pdf_rotate` rotates PDF page orientation.
- `toolknit_pdf_encrypt` adds passwords and permissions to a PDF.
- `toolknit_pdf_decrypt` unlocks a password-protected PDF.
- `toolknit_pdf_compress` defaults to structure-preserving optimization; explicit `mode=raster` creates a lossy image-only PDF. `target_bytes` is a strict cap. Inspect `status` and `outputs`; unmet targets produce no file.
- `toolknit_pdf_enhance` improves scanned-page readability.
- `toolknit_pdf_to_image` exports PDF pages as individual images or a stitched long image.
- `toolknit_ai_document` creates the PDF, editable project, clean previews, numbered control maps, and first revision.
- `toolknit_ai_document_inspect` reads every stable control number, text, style, position, lock state, and diagnostic without writing files.
- `toolknit_ai_document_edit` applies atomic numbered edits, including dry runs, styling, swaps, movement, resizing, image insertion, locking, grouping, relative alignment, overlap resolution, and undo.
- `toolknit_ai_document_render` deterministically refreshes the PDF and previews without adding a revision.
- `toolknit_ai_table` creates the export file, editable project, preview image, and first revision.
- `toolknit_ai_table_inspect` reads every stable row, column, and chart number plus cells, charts, and output paths without writing files.
- `toolknit_ai_table_edit` applies atomic numbered edits to tables, including dry runs, cell updates, row and column inserts or deletes, swaps, sorting, chart updates, and undo.
- `toolknit_ai_table_render` deterministically refreshes the export file and preview without adding a revision.
- `toolknit_audio_convert` converts 1 to 100 local audio files to MP3, AAC, WAV, FLAC, ALAC, or OGG and writes unique result names into an explicit output directory.
- `toolknit_audio_bpm` analyzes one local audio file for BPM, confidence, and candidate tempos without uploading, modifying, or creating audio files.
- `toolknit_audio_clip` trims one local audio file between explicit timestamps while preserving the source and publishing a uniquely named result.
- `toolknit_audio_extract` extracts a selected local video audio track as MP3, AAC, WAV, FLAC, or OGG.
- `toolknit_model_list` reads the status of the offline transcription models shared by desktop and CLI.
- `toolknit_model_install` downloads and integrity-verifies one local Whisper model from the official source or a China mirror.
- `toolknit_model_use` selects an installed local transcription model.
- `toolknit_transcribe` transcribes one local audio or video file and always keeps original JSON, SRT, and TXT; optional refinement sends recognized text only.
- `toolknit_video_convert` converts one to 30 local videos to MP4, AVI, MKV, MOV, WebM, FLV, WMV, or TS while preserving sources and publishing unique result names.
- `toolknit_video_frame` extracts one original-resolution PNG or high-quality JPG from one explicit millisecond timestamp in a local video. The Agent must ask for the timestamp and never guess the intended frame.
- `toolknit_video_gif` creates one palette-optimized GIF from an explicit start and end millisecond range in a local video, up to 30 seconds. It supports `quality: "high" | "balanced" | "small" | "tiny"` for file-size control. The Agent must never guess a highlight range.
- `toolknit_text_stats` calculates character, word, line, paragraph, sentence, and reading-time counts for one local UTF-8 text file without returning its content or writing files.
- `toolknit_color_extract` extracts a dominant palette from one local PNG, JPEG, or WebP without uploading or writing files.
- `toolknit_image_stitch` stitches 2–100 local images vertically or horizontally in an explicit order. It defaults to seamless PNG, preserves sources, and publishes a unique output name.
- `toolknit_ppt_images` extracts embedded image assets from one local PPTX, preserves original formats, and writes a manifest. It supports slide-page filters, image item numbers, and skipping exact duplicates.
- `toolknit_ppt_text` extracts each slide's title, body text, and speaker notes from one local PPTX. It can export Markdown / TXT / JSON and can optionally ask AI to organize the extracted text into an outline, script, meeting notes, or study notes. AI mode sends extracted text only, never the PPTX file.
- `toolknit_ppt_compress` safely compresses one local PPTX, writes an optimized copy plus a manifest, preserves image quality in the first stage, and never modifies the source file.
- `toolknit_ppt_to_pdf` renders one local PPTX to PDF with LibreOffice headless. It never modifies the source and writes the PDF plus manifest into a unique output folder.
- `toolknit_ppt_to_image` renders a temporary PDF with LibreOffice, then exports selected slides as per-page PNG / JPG / WebP images. It supports slide-page filters and removes the temporary PDF after success.
- `toolknit_ppt_outline` generates a new structured PPT outline from a text brief and writes outline.md, outline.json, and a manifest. It does not read PPTX and does not generate PPTX.
- `toolknit_ppt_draft` generates an editable PPTX draft from a text brief, or converts an existing outline.json directly into PPTX. Prompt mode sends text only; outline mode does not call AI.
- `toolknit_hardware_overview` inspects the system, device model, CPU, memory, GPU, storage, firmware, and battery state without writing files.
- `toolknit_hardware_cpu_memory` inspects CPU specs, memory topology, memory modules, and current usage without writing files.
- `toolknit_hardware_cpu_memory_live_stats` reads current CPU usage, available memory, and committed memory counters without writing files.
- `toolknit_hardware_gpu_display` inspects graphics adapters, drivers, VRAM, and connected displays without writing files.
- `toolknit_hardware_mainboard_firmware` inspects motherboard, BIOS/UEFI, Secure Boot, TPM, chassis, and PCI device details without writing files.
- `toolknit_hardware_storage_health` inspects physical disks, volumes, capacity, bus type, and available health/reliability counters without writing files.
- `toolknit_hardware_network_devices` inspects network adapters, Bluetooth, audio, USB, and camera device lists without writing files.
- `toolknit_hardware_power_sensors` inspects the active power plan, battery state, thermal zones, and available fan/sensor data without writing files.

## V3.2 additions

The catalog adds PDF-to-Word, local PDF text, crop, page numbers, scan appearance and blank creation; image-to-PDF, conversion/compression/crop/color replacement/icons; XLSX-to-PDF and safe Markdown HTML; text formatting, AI polish/translation, JSON/Base64/URL/UUID/JWT/checksums; timestamp/BMI/mortgage/interest/color calculations; and read-only large/duplicate-file scans.

PDF-to-Word is offline by default. Only explicit `ai_mode=true` sends region text/images to the environment-configured vision provider. PDF AI Markdown sends selected page images; AI polish/translate send supplied text. Do not switch a local operation to AI without the user's request. Desktop credentials are never read.

Image-to-PDF preserves the explicit input order and supports multipage TIFF. Animated sources need explicit first-frame permission. Compression with no reduction publishes no file; inspect the result status and outputs. Excel accepts XLSX and requires LibreOffice. Cropping PDF page boxes is not secure redaction.

```text
Use toolknit_pdf_to_word to convert this project's report.pdf locally, with original-page layout, to toolknit-output/report.docx. Resolve absolute paths and preserve existing outputs. Report the actual result path and regions that remain images.
```

```text
Use toolknit_image_to_pdf to combine first.png and second.jpg in exactly that order, A4 paper and faithful mode, into toolknit-output/images.pdf in this project. Do not upload images or overwrite existing files.
```

Read-only file scans never delete data. Password generation, clipboard monitoring, system cleanup and real-time overlay interaction remain desktop-only. Background removal has no independent npm native inference adapter and is not advertised as callable.

## Color extraction

```text
Call ToolKnit MCP's toolknit_color_extract to extract five dominant colors from this project's assets/cover.png. Resolve its absolute path from the IDE file tree and analyze locally only: do not upload, modify, or create files. Report HEX, RGB, HSL, and percentage for each color in population order. If the image reference is ambiguous, ask me first.
```

## Long image stitching

The Agent must resolve images from the IDE file tree to absolute paths and preserve the user's order exactly. Default to vertical mode and a 0px gap when those choices are not specified. Never invent a background, gap, or new order. Use an explicit absolute output directory inside the active workspace. When the user names the file, pass a path-free, extension-free `output_name`; ToolKnit still adds a numeric suffix on collision. CLI/MCP does not consume in-memory PDF previews: first create durable page images in page-number order, then pass those paths to the stitch tool unchanged.

```text
Call ToolKnit MCP's toolknit_image_stitch. Stitch screenshots/01.png, screenshots/02.png, and screenshots/03.png vertically and seamlessly in exactly that order, normalize to the first image width, and save a PNG named release-walkthrough in this workspace's toolknit-output directory. Resolve and verify all three absolute paths from the IDE file tree first. Do not upload or modify sources and do not overwrite an existing result. Report the absolute output path and final pixel dimensions.
```

```text
Call toolknit_image_stitch to place assets/left.png and assets/right.png side by side, normalize to the larger image height, use a 16px gap with an opaque black background, and export JPG quality 92. Keep left before right and save the result in this workspace's toolknit-output directory.
```

## PDF to image / stitched long image

When the user drops a PDF into the IDE chat and asks for “convert this PDF to images” or “make it into a stitched long image,” the Agent must first resolve the PDF to an absolute path from the IDE file tree and translate “save it in this project” into `<absolute-workspace-path>\\toolknit-output`. It must not guess the output directory or rewrite the source PDF.

Copy-ready request:

```text
Call ToolKnit MCP's toolknit_pdf_to_image to export this project's assets/demo.pdf as per-page images into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first. Do not replace the source file; if I say “stitched long image,” switch to long mode and keep the pages in order. When complete, report every output absolute path, page number, format, and byte size.
```

```text
Call ToolKnit MCP's toolknit_pdf_to_image to export pages 1 through 5 of this project's assets/demo.pdf as a stitched long image into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first and do not guess the page range. Report the long-image path, page range, and byte size when finished.
```

## PPT image asset extraction

When the user drops a PPTX into the IDE and asks to “extract the images from this deck,” the Agent must resolve the PPTX to an absolute path and save into this workspace's `toolknit-output` folder. Do not modify the source PPTX and do not treat whole slides as rendered images; this tool extracts the original embedded image assets inside the PPTX package.

```text
Call ToolKnit MCP's toolknit_ppt_images to extract the embedded image assets from this project's decks/demo.pptx into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first. Do not modify the PPTX and do not overwrite existing outputs. Report the output folder, manifest.json, image count, duplicate count, and each exported file's slide number, format, and byte size.
```

```text
Call toolknit_ppt_images to extract only images from slides 2 through 5 of decks/demo.pptx, skipping exact duplicate images. Save into this workspace's toolknit-output folder and report how many images were exported and which duplicates were skipped.
```

## PPT AI text extraction

When the user drops a PPTX into the IDE and asks to “extract this deck's text” or “turn this into an outline/script/meeting notes,” the Agent must resolve the PPTX to an absolute path and save into this workspace's `toolknit-output` folder. Basic extraction is fully local. Only when the user explicitly asks for AI organization should extracted text and notes be sent to the configured AI provider; the PPTX file itself is never uploaded.

```text
Call ToolKnit MCP's toolknit_ppt_text to extract every slide title, body text, and speaker note from this project's decks/demo.pptx. Export Markdown, TXT, and JSON into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first. Do not modify the PPTX and do not overwrite existing outputs. Report the output folder, slide count, note-slide count, and manifest.json path.
```

```text
Call toolknit_ppt_text to extract text from slides 1 through 8 of decks/demo.pptx and use ai_mode=outline to organize it into a structured outline. Send extracted text only; do not upload the PPTX file. Save outputs into this workspace's toolknit-output folder.
```

## PPT compression

When the user drops a PPTX into the IDE and asks to “compress this deck” or “make this presentation smaller,” the Agent must resolve the PPTX to an absolute path and save into this workspace's `toolknit-output` folder. Compression never modifies the source file. `low` is lossless cleanup; `medium` / `high` recompress large image assets for smaller files, and images are kept unchanged when recompression does not reduce size.

```text
Call ToolKnit MCP's toolknit_ppt_compress to safely compress this project's decks/demo.pptx into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first, use level=medium, do not modify the source PPTX, and do not overwrite existing outputs. Report the output folder, original size, compressed size, saved space, and manifest.json path.
```

```text
Call toolknit_ppt_compress to run a dry_run compression analysis on decks/demo.pptx with level=high. Return only the estimated saved space, cleanup counts, and whether the deck is already close to optimized; do not write files.
```

## PPT to PDF

When the user drops a PPTX into the IDE and asks to “convert this PPT to PDF,” the Agent must resolve the PPTX to an absolute path and save into this workspace's `toolknit-output` folder. This tool requires LibreOffice / soffice. If the dependency is missing, tell the user to install LibreOffice or configure `TOOLKNIT_LIBREOFFICE_PATH`; do not claim conversion succeeded.

```text
Call ToolKnit MCP's toolknit_ppt_to_pdf to convert this project's decks/demo.pptx into a PDF in this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first. Do not modify the PPTX and do not overwrite existing outputs. Report the output PDF, manifest.json, page count, and byte size.
```

## PPT to images

When the user drops a PPTX into the IDE and asks to “convert this PPT to images” or “export slides 1-3 as images,” call `toolknit_ppt_to_image`. Default to `format=png`, `clarity=high`, and all slides. If the user gives pages, pass explicit page numbers and do not guess.

```text
Call ToolKnit MCP's toolknit_ppt_to_image to export slides 1 through 3 of this project's decks/demo.pptx as PNG images with clarity=high into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree first. Do not modify the PPTX and do not overwrite existing outputs. Report the output folder, each image path, slide number, format, and byte size.
```

## AI PPT outline generation

When the user asks “make a PPT outline from these notes” or “plan an 8-slide talk,” the Agent should call `toolknit_ppt_outline`. This tool does not read PPTX and does not generate PPTX. It generates `outline.md`, `outline.json`, and `manifest.json` from the supplied text. If the source notes come from project files, read and summarize the text first, then pass the concise brief as `prompt`. Never put API keys in the prompt.

```text
Call ToolKnit MCP's toolknit_ppt_outline to generate an 8-slide Chinese PPT outline from the product notes I provided. The audience is new users, and the purpose is to help them understand ToolKnit's local-first and AI Agent capabilities. Save into this workspace's toolknit-output folder. Resolve the output directory to an absolute path first and do not overwrite existing outputs. Report the outline.md, outline.json, manifest.json paths and missing-info list.
```

```text
Dry-run toolknit_ppt_outline first. Topic: “Explain a local-first file processing platform to investors.” slide_count=6, audience=investors, purpose=get a follow-up meeting. Return only the generation plan; do not call AI and do not write files.
```

## AI PPT draft / PPTX generation

When the user asks “generate a PPTX draft” or “turn these notes into an editable presentation,” call `toolknit_ppt_draft`. If the user already has `outline.json`, prefer `outline_path` so the tool does not call AI again. If the user only provided text notes, pass a concise `prompt`; the tool creates a structured outline first, then writes the PPTX locally. The first stage is an editable minimal draft, not animations, video, or pixel-perfect enterprise master reproduction.

```text
Call ToolKnit MCP's toolknit_ppt_draft to generate an 8-slide Chinese PPTX draft from the product notes I provided. The audience is open-source users, theme=minimal-mono (the default black-and-white minimal theme), and the output directory is this workspace's toolknit-output. Resolve the output directory to an absolute path first and do not overwrite existing outputs. Report the PPTX, outline.json, outline.md, and manifest.json paths.
```

```text
Call toolknit_ppt_draft to convert this workspace's toolknit-output/outline.json into an editable PPTX. Use theme=minimal-mono for a monochrome minimal style, do not call AI again, and do not overwrite existing outputs.
```

## State four things in every request

A useful instruction names the input file, operation, explicit output location, and whether an existing file may be replaced. Ask the Agent to inspect the file before it writes output.

## Audio format conversion

Audio conversion is local and never modifies the original. The user names the input file, target format, quality, and output directory; the Agent resolves the input from the IDE file tree and maps “save it in this project” to `<absolute-workspace-path>\\toolknit-output`. It must not guess the MCP process working directory.

Copy-ready request:

```text
Call ToolKnit MCP's toolknit_audio_convert to convert this project's assets/interview.m4a into a high-quality MP3. Save it in this project's toolknit-output folder. Resolve the input and workspace to absolute paths from the IDE file tree; do not replace or modify the source file. When complete, report every generated absolute path, byte size, and any per-file failure.
```

The Agent calls the tool with `input_paths`, `output_dir`, `target_format: "mp3"`, and `quality: "high"`. ToolKnit creates the output directory, preserves existing files, and allocates unique names. If the tool returns `ENGINE_UNAVAILABLE`, FFmpeg is unavailable on the machine: the Agent must ask the user to install FFmpeg or configure `TOOLKNIT_FFMPEG_PATH`, not claim that conversion succeeded.

## BPM beat detection

The user only needs to identify an audio file in the IDE file tree and ask for its tempo. The Agent must resolve a project-relative file to an absolute path before calling `toolknit_audio_bpm`; it must never guess BPM from a filename, track title, or chat context. The tool analyzes at most the first 120 seconds and returns BPM, a 0-to-1 confidence value, and candidates. It never writes a result file.

Copy-ready request:

```text
Call ToolKnit MCP's toolknit_audio_bpm to detect the BPM of this project's assets/beat-demo.wav. Resolve the absolute path from the IDE file tree. Analyze it locally only; do not upload, convert, modify, or create any file. Report the primary BPM, confidence, candidate BPM values, and analyzed seconds. If there is no reliable beat pattern, say so instead of inventing a number.
```

For a request such as “detect the tempo of this song in the current project,” the Agent must first confirm that the file reference is unique. If multiple audio files fit, it must ask the user which one to use. On `ENGINE_UNAVAILABLE`, explain how to configure FFmpeg; on `INPUT_INVALID`, explain the format, size, duration, or channel restriction and never fabricate an analysis result.

## Audio clipping

Users may naturally say “keep 12.5 seconds through 47 seconds.” The Agent must first resolve a unique file and translate the boundaries into explicit seconds. For an ambiguous request such as “the first half” or “the chorus,” it must ask for timestamps rather than guess. Save output inside the current workspace's `toolknit-output` using an absolute path.

```text
Call ToolKnit MCP's toolknit_audio_clip to trim this project's assets/interview.m4a from 12.5 seconds to 47 seconds. Save it in this project's toolknit-output folder. Resolve all paths from the IDE file tree, do not modify the source, and do not replace an existing file. Report the output path, actual clip duration, format, and whether the original stream was preserved. If it falls back to MP3, explain that explicitly.
```

## Extract audio from video

```text
Call ToolKnit MCP's toolknit_audio_extract to extract audio track 0 from this project's assets/demo.mp4 as a high-quality MP3 into this project's toolknit-output folder. Resolve absolute paths from the IDE file tree, do not modify the source video, and do not replace existing files. Report the output file, format, track number, and any failure reason. If the video has multiple audio tracks and I have not named one, ask me for the track number instead of guessing.
```

## Video format conversion

Users may naturally ask to “turn this recording into MP4.” The Agent resolves every input and the workspace to absolute paths from the IDE file tree; target format and output directory must be explicit and never depend on the MCP process directory. For batches, report each output or failure separately.

```text
Call ToolKnit MCP's toolknit_video_convert to convert this project's recordings/demo.mov and recordings/intro.webm to MP4 in this project's toolknit-output folder. Resolve all absolute paths from the IDE file tree. Do not modify sources or replace existing files. Report the output path, byte size, video/audio encoders, and failure reason for each input. If a target format or file reference is ambiguous, ask before calling the tool.
```

The Agent sends `input_paths`, `output_dir`, and `target_format: "mp4"`. Conversion is local through FFmpeg. The returned `hardware_acceleration` field is authoritative; on `ENGINE_UNAVAILABLE`, guide the user to configure FFmpeg, and on partial failure do not report the batch as fully successful.

## High-resolution video frame capture

Users may say “export the picture at 12.5 seconds.” The Agent must resolve exactly one absolute video path from the IDE file tree and convert the requested time to explicit milliseconds. For requests such as “the best opening shot,” it must ask the user to choose a time in the desktop preview rather than guessing.

```text
Call ToolKnit MCP's toolknit_video_frame to export a lossless PNG frame at 12500 milliseconds from this project's recordings/demo.mp4. Save it in this project's toolknit-output folder. Resolve absolute paths from the IDE file tree; do not modify the source video or replace an existing image. Report the output path, timestamp, format, and byte size. If the video or timestamp is ambiguous, ask me first.
```

The Agent sends `input_path`, `output_dir`, `timestamp_ms: 12500`, and optional `format: "png"` or `"jpg"`. Extraction runs locally through FFmpeg, preserves the decoded source resolution, and publishes a unique result name.

## Video to GIF

Users may say “make a smaller GIF from 5s to 12.5s.” The Agent must convert the start and end into explicit milliseconds. If the user asks for a smaller, web-friendly, or lightweight GIF, prefer `width: 360` or `480`, `frame_rate: 6` or `8`, and `quality: "small"` or `"tiny"`. If the user did not provide exact bounds, ask them to choose the range in the desktop preview instead of guessing.

```text
Call ToolKnit MCP's toolknit_video_gif to export recordings/demo.mp4 from 5000 ms to 12500 ms as a smaller GIF into this project's toolknit-output folder. Resolve the absolute path from the IDE file tree, do not modify the source, and do not replace existing files. Use 8 FPS, 480px width, and quality small. Report the output path, duration, frame rate, width, quality, and byte size.
```

The Agent sends `input_path`, `output_dir`, `start_ms`, `end_ms`, and optional `frame_rate`, `width`, and `quality`. The selected range must be 30 seconds or shorter; the source video is never modified. If FFmpeg is missing, tell the user to install/configure the dependency instead of claiming success.

## Text statistics

Users may say “count words and paragraphs in this project's README.” The Agent resolves one unambiguous UTF-8 text path from the IDE file tree before calling the tool. It must not put the whole text into MCP arguments or reconstruct incomplete text from chat. The tool creates no files and never returns source text.

```text
Call ToolKnit MCP's toolknit_text_stats to report character count, Han character count, English word count, lines, paragraphs, sentences, and reading time for this project's README.md. Resolve its absolute path from the IDE file tree. Analyze locally only: do not upload, modify, create files, or quote the source text in the result. If multiple README candidates exist, ask me to choose first.
```

## Generate inside the current IDE project (recommended)

The user does not need to type a full path and may simply say "save it in this project." The IDE Agent must resolve the active workspace root and convert that request into an explicit absolute path, for example:

```text
<absolute-workspace-path>\toolknit-output\product-plan.pdf
```

ToolKnit creates the `toolknit-output` directory when it does not exist. The Agent must not substitute the MCP process working directory or guess a path outside the workspace. When an input file is already in the project, resolve its absolute path from the IDE file tree before passing it to ToolKnit.

After generation, the IDE file tree contains:

```text
toolknit-output/
  product-plan.pdf
  product-plan.toolknit.json
  product-plan.toolknit/
    preview/page-01.png
    demo/controls-overview.png
    demo/page-01-controls.png
    demo/page-02-controls.png
```

For edits, open a high-resolution per-page map such as `page-01-controls.png` instead of zooming the overview. The user can then say "swap P1-03 and P1-05" or "make P2-04 black with white text." The Agent must still inspect and dry-run; it must not infer controls only from the image.

Copy-ready request:

```text
Use ToolKnit MCP and save the result in the current IDE project's toolknit-output folder. Resolve the absolute path from the IDE workspace; do not use the MCP process working directory. After generation, report the PDF, editable project, and every high-resolution per-page control-map path so I can open them from the IDE file tree and continue editing.
```

## Complete example: create without images, then insert an image and delete a component

This is the recommended end-to-end workflow. The IDE Agent interprets natural language; ToolKnit performs deterministic project edits and PDF rendering. The user does not need to write JSON or calculate coordinates.

### Step 1: create an explicitly image-free draft

```text
Use ToolKnit MCP to create a three-page English A4 PDF titled "Project Execution Plan" in the current IDE project's toolknit-output folder. Do not overwrite an existing file. The initial draft must contain no images, image placeholders, or image controls. After generation, inspect the real PDF page count and the editable project, confirm that the number of image controls is zero, and report the absolute PDF, project, and per-page control-map paths.
```

The Agent resolves the absolute workspace path and calls `toolknit_ai_document`, `toolknit_pdf_inspect`, and `toolknit_ai_document_inspect` in that order. If the draft contains an image control, it must report that the request was not satisfied instead of calling the draft image-free.

### Step 2: open a numbered map from the IDE file tree

Open `toolknit-output/Project Execution Plan.toolknit/demo/page-02-controls.png`. You may use a visible number or describe a uniquely named heading. Both requests below are valid:

```text
Insert the current project's assets/workflow.png after P2-04, displayed at 520 by 150.
```

```text
Insert the current project's assets/workflow.png after the "Execution workflow" heading on page 2, displayed at 520 by 150. If that heading is not a unique match, ask me instead of guessing.
```

The Agent must inspect first. When the semantic description matches exactly one control, it resolves the project image to an absolute path and maps the request to this operation. When multiple controls match, it asks the user for a number.

```json
[
  {
    "type": "insert_control",
    "after": "P2-04",
    "control": {
      "type": "image",
      "source_path": "<absolute-workspace-path>\\assets\\workflow.png",
      "label": "Execution workflow",
      "w": 520,
      "h": 150
    }
  }
]
```

The image must be a local PNG or JPEG no larger than 10 MB. The Agent calls edit with `dry_run=true`, then submits the exact same operation. It must not commit a `page_count_changed`, bounds, overlap, or low-resolution error; it should explain the issue and offer a smaller image, another location, or removal of unnecessary content with the user's approval.

### Step 3: delete one component in natural language

```text
Delete P3-06, the "Supplementary note" shown on the page 3 control map. Inspect and confirm its number and text first, then dry-run and submit only when there is no error. Do not delete any other control. Report the new revision and updated page 3 control-map path.
```

The translated operation contains exactly one item:

```json
[
  { "type": "delete_control", "control": "P3-06" }
]
```

The deleted number is never reassigned, and the remaining controls are not renumbered. Project assets remain available for revision history and undo. If the wrong component was removed, the user can simply say "undo the last edit."

### What successful completion looks like

- The initial project contains zero image controls.
- Image insertion increments the revision, creates a new stable control number at the requested location, and copies the source into project assets.
- Deletion increments the revision again, removes only the requested number, and preserves every other stable number.
- Every committed edit refreshes the PDF, clean previews, and high-resolution per-page maps while preserving the physical PDF page count.

## Copy-ready prompts

### Inspect a PDF

```text
Use ToolKnit MCP to inspect <input PDF path>. Tell me the page count and file size. Do not modify the file.
```

### Extract page 2

```text
Use ToolKnit MCP to inspect <input PDF path>, then extract only page 2 into <output folder>. Do not overwrite existing files.
```

### Extract multiple pages

```text
Use ToolKnit MCP to inspect <input PDF path>, then extract pages 1 and 3 through 5 into <output folder>. Do not overwrite existing files.
```

### Merge PDFs

```text
Use ToolKnit MCP to inspect <PDF 1 path> and <PDF 2 path>, then merge them in this order into <output PDF path>. Do not overwrite an existing file.
```

### Rotate a PDF

```text
Use ToolKnit MCP to inspect <input PDF path>, then rotate every page clockwise by 90 degrees and save to <output PDF path>. Do not overwrite an existing file.
```

### Compress a PDF

```text
Use ToolKnit MCP to inspect <input PDF path>, then compress it with high level and save to <output PDF path>. Do not overwrite an existing file.
```

### Enhance a scanned PDF

```text
Use ToolKnit MCP to inspect <scanned PDF path>, then enhance it with medium strength and save to <output PDF path>. I understand that enhancement rasterizes pages and does not preserve searchable text, links, or forms.
```

### Generate a multi-page AI document

```text
You must call the ToolKnit MCP tool toolknit_ai_document. Do not merely draft the content in chat.

Generate a four-page English A4 PDF titled "ToolKnit v2.0 Open Source Product Plan" at <absolute output PDF path>. Do not overwrite an existing file.

Page 1 must contain an executive summary, project context, release goals, target users, and five core values, plus a compact metadata table. Page 2 must organize desktop capabilities into PDF, image, audio/video, text, and AI groups and explain the local-first privacy and performance strategy without inventing usage metrics. Page 3 must explain the CLI and IDE Agent/MCP architecture, shared capability contracts, explicit output paths, overwrite protection, progress, and structured errors, with a table of representative calls. Page 4 must present the release plan, risks, acceptance criteria, and roadmap, including an action table with owner roles, priorities, and expected evidence.

Use a modern monochrome business layout with clear sections, metadata tables, one restrained emphasis block, action tables, and concise notes. Do not use colorful decoration, emoji, placeholders, or fabricated citations. Pass page_count=4, locale=en, and overwrite=false.

After generation, report the absolute paths of the PDF, `.toolknit.json` project, clean-preview directory, every high-resolution `page-XX-controls.png`, and the `controls-overview.png` index. Then call `toolknit_pdf_inspect` and confirm that the real PDF has exactly four pages. If generation or validation fails, report ToolKnit's structured error and do not substitute another document generator.
```

## Precisely edit an AI document

AI documents created by ToolKnit are editable projects. A number such as `P1-01` belongs to its control and follows that control when positions are swapped. Never edit project JSON directly and never guess coordinates from a screenshot.

The Agent must use this sequence:

1. Call `toolknit_ai_document_inspect` first to confirm the current revision and target controls.
2. Translate the request into structured `operations` and call edit with `dry_run=true`.
3. Report the exact change set and all out-of-bounds, overlap, text-overflow, low-contrast, or low-resolution-image diagnostics.
4. Once the user has requested execution, submit the same operations with `dry_run=false`. Do not add unrequested changes.
5. Report the new revision and the PDF, preview, and control-map paths. Use a standalone `undo` operation when a rollback is requested.

### Swap positions and change colors

```text
Use ToolKnit MCP to edit <project.toolknit.json>. Inspect it first; do not infer controls from the screenshot.

Swap the positions of P1-01 and P1-02. Then set P1-01 background to #000000, text to #FFFFFF, and font size to 32. First call edit with dry_run=true and report the change set and every diagnostic. If there is no error, submit exactly the same operations. Do not modify any other control.
```

### Restyle a table

```text
Inspect <project.toolknit.json> and confirm that P2-04 is the intended table row. Set its divider width to 2, divider color to #111111, and background to #F2F2F2. Dry-run first, then submit only if there is no bounds, overlap, or contrast error. Report the new revision.
```

### Insert an image between controls

```text
Use ToolKnit MCP to insert an image control after P1-02 and before P1-03 in <project.toolknit.json>. Read the image from <absolute local PNG or JPEG path> and size the control to 320 by 180. Inspect first, then dry-run and check image resolution and page overflow before submitting. Do not use base64 or paste image data into chat.
```

### Edit and lock text

```text
Inspect <project.toolknit.json>. Change P3-05 to "<new text>", set its font size to 16, then lock that control. Dry-run and submit without changing its position or any unrelated style.
```

### Undo or re-render

```text
Call toolknit_ai_document_edit on <project.toolknit.json> with the sole operation {"type":"undo","steps":1}. Restore the previous content while preserving revision history, then report the new revision.
```

```text
Call toolknit_ai_document_render for <project.toolknit.json> to regenerate its PDF, clean previews, and numbered maps. Do not change project content or create a revision.
```

### Create an editable table

```text
You must call ToolKnit MCP's toolknit_ai_table. Do not only write the table in chat.

Create a 4-column, 6-row Chinese A4 table titled "Project Progress" in the current IDE project's toolknit-output folder, export it as XLSX, and do not overwrite existing files. The table must include a status chart. After generation, tell me the absolute paths of the export file, project file, and preview image, then inspect once to confirm that row, column, and chart numbers all exist.
```

### Edit a table by number

```text
Use ToolKnit MCP to edit <project.toolknit-table.json>. Inspect first and do not guess from the preview.

Swap R01 and R02, rename C02 to "Owner", change the value in row R01, column C02 to "Alice", and rename G01 to "Completion Trend". Dry-run first and report diagnostics. If there is no error, submit the exact same operations and tell me the new preview path.
```

### Table edit rules

- Numbers such as `R01`, `C01`, and `G01` belong to the row, column, or chart itself. Swapping or deleting items does not renumber other items.
- Open the preview and inspect result first. If a semantic description matches multiple targets, the Agent must ask the user.
- Chart edits must reference a stable chart number or id; do not guess coordinates from the preview.
- Output paths must always be explicit. Without explicit authorization, the Agent must not overwrite any existing file.

## Offline Audio and Video Transcription

Audio and video transcription uses a local Whisper model. An Agent must not assume a model is installed or download a large model without the user's confirmation.

1. Call `toolknit_model_list` first.
2. When no model is usable, explain that `small` is recommended and state its download size. Wait for confirmation, then call `toolknit_model_install` with `source=auto`.
3. Confirm absolute media input and output directory paths, then call `toolknit_transcribe`. Use `language=auto` unless the user explicitly requests `zh` or `en`.
4. Report the original JSON, SRT, and TXT absolute paths. Never claim that the model can guarantee names, numbers, or unclear audio.

```text
Use ToolKnit MCP. First list local offline transcription models. If no usable model is installed, tell me that Small is recommended and its download size; wait for my confirmation before installing it. Then transcribe <absolute audio or video path> locally into <absolute workspace toolknit-output path>, use Chinese, do not upload the media or overwrite existing files, and report the original JSON, SRT, and TXT paths.
```

## Password-protected PDFs

PDF encryption and decryption require a password. Do not paste passwords into Agent chats, shared transcripts, or task descriptions. Prefer ToolKnit Desktop for password-protected PDFs. If an Agent must handle one, explicitly instruct it never to echo, repeat, or record the password.

## When a task fails

Ask the Agent to inspect the file path first. The most common causes are a missing input path, an existing output file, or a password-protected PDF. Run `toolknit doctor` to verify the qpdf engine used by compression and decryption.
