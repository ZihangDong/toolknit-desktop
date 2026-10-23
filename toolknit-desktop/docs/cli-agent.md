# ToolKnit CLI and IDE Agent

ToolKnit Desktop and `@toolknit/cli` are separate V3.2 deliverables. The V3.2 npm package is prepared in source and not published yet. The CLI runs file operations directly and never starts, drives, or depends on the desktop UI.

## Installation and checks

The CLI requires Node.js 22.13 or later. The Windows release artifact carries the qpdf runtime and qpdf license notices for PDF decrypt and compress operations. On another platform, install qpdf separately or set `TOOLKNIT_QPDF_PATH` to its executable. Audio/video operations and local transcription preparation require FFmpeg. The CLI resolves, in order, an absolute `TOOLKNIT_FFMPEG_PATH`, the managed runtime downloaded by ToolKnit Desktop, the development repository fixture, and finally `ffmpeg` from `PATH`.

```powershell
npm install --global @toolknit/cli
toolknit doctor --json
```

If a regional npm mirror has not synced the newest release yet, install from the official npm registry:

```powershell
npm install --global @toolknit/cli --registry=https://registry.npmjs.org
```

For a local release archive, install with npm's optional network checks disabled. The first installation still needs to resolve the CLI dependencies; npm does not provide a reliable per-package percentage, so ToolKnit does not show a misleading progress bar during installation.

```powershell
npm pack .\cli
npm install --global --no-audit --no-fund --prefer-offline .\toolknit-cli-3.2.0.tgz
```

## Command help

The installed command includes a Chinese help system. Start with the complete command index, then drill into the PDF category, including PDF to image, or one operation:

```powershell
toolknit --help
toolknit pdf --help
toolknit pdf merge --help
toolknit pdf to-image --help
toolknit help pdf merge
toolknit help pdf to-image
```

Each operation help describes its required parameters, optional parameters, examples, output behavior, and relevant safety constraints. This document contains the same contract for IDE and release integration.

Inside this repository, maintainers can use `npm run --silent cli -- doctor --json` (or replace `doctor --json` with any documented CLI command) to test the source tree directly. `--silent` is required when a caller needs pure JSON because npm otherwise prefixes its own script header on stdout. `npm run test:cli` runs the package and MCP contract checks together.

`doctor` reports both `qpdf.available` and `ffmpeg.available`. `qpdf` is required for decrypt/compress; FFmpeg is required for audio and video processing. A custom qpdf executable can be selected with `TOOLKNIT_QPDF_PATH`; `TOOLKNIT_FFMPEG_PATH` overrides the managed desktop runtime and system `PATH` when an explicit executable is required.

## CLI contract

Every file-writing command requires an explicit destination. PDF operations accept regular `.pdf` input files; other tools use their documented formats (symlinks are rejected), never overwrites an existing file unless `--overwrite` is explicitly supplied, and always refuses to write over one of its input files. Each output is written to a same-directory temporary file and published atomically only after processing succeeds.

```powershell
toolknit pdf inspect --input .\report.pdf --json
toolknit pdf merge --input .\part-a.pdf --input .\part-b.pdf --output .\merged.pdf --json
toolknit pdf split --input .\report.pdf --pages 1,3-5 --output-dir .\pages --json
toolknit pdf rotate --input .\report.pdf --output .\rotated.pdf --rotation 90 --json
toolknit pdf compress --input .\report.pdf --output .\report-smaller.pdf --level high --json
toolknit pdf compress --input .\report.pdf --output .\image-only.pdf --mode raster --target-kb 500 --clarity readable --json
toolknit pdf enhance --input .\scan.pdf --output .\scan-enhanced.pdf --strength medium --json
toolknit pdf to-image --input .\report.pdf --output-dir .\toolknit-output --mode images --pages 1,3-5 --format png --clarity high --json
toolknit pdf to-image --input .\report.pdf --output-dir .\toolknit-output --mode long --pages 1-5 --format webp --clarity print --output-name report-walkthrough --json
toolknit audio convert --input .\\meeting.m4a --output-dir .\\toolknit-output --format mp3 --quality high --json
toolknit audio bpm --input .\\beat.wav --json
toolknit audio clip --input .\\meeting.m4a --start 12.5 --end 47 --output-dir .\\toolknit-output --json
toolknit audio extract --input .\\lesson.mp4 --output-dir .\\toolknit-output --format mp3 --track-index 0 --quality high --json
toolknit video convert --input .\\recording.mov --output-dir .\\toolknit-output --format mp4 --json
```

The command result is JSON when `--json` is supplied. Success has exit code `0`; usage errors use `2`; invalid or missing inputs use `3`; unsafe output paths and overwrite refusals use `4`; missing engines use `5`; and processing failures use `6`.

PDF compression defaults to `mode: "structure"`. Explicit `mode: "raster"` creates an image-only PDF and loses searchable text, links, forms, bookmarks and accessibility tags. Optional `target_bytes` is a strict 51,200–52,428,800 byte cap (CLI: `--target-kb` or `--target-mb`, using 1024-byte units). Inspect `status` and `outputs`: `already-within-target`, `target-not-reached` and `no-reduction` are handled results with no output file, not processing exceptions. Only `compressed` publishes a newly compressed file. Raster target search ignores `level` and searches up to six candidates; `clarity: "readable"` has a 72 DPI floor, `compact` 36 DPI. Neither guarantees readability. Each attempt reports the complete PDF byte count. Originals are never modified.

Interactive CLI output includes ToolKnit's supplied ASCII artwork when the terminal is wide enough. Use `--banner=auto` (default), `--banner=always`, or `--banner=never` to control it. Artwork is permanently disabled for `--json`, redirected/piped output, and `toolknit mcp serve`; therefore it cannot corrupt scripts or the MCP JSON-RPC stream.

For a subset of pages during a merge, use the zero-based input index and one-based PDF pages:

```powershell
toolknit pdf merge --input .\first.pdf --input .\second.pdf --output .\selected.pdf --page-selections '[{"input_index":0,"pages":[1,3]}]' --json
```

`pdf encrypt` and `pdf decrypt` accept secrets only through `--password-stdin`, never a command-line argument. Use a password manager's secure pipe or another protected stdin source. ToolKnit never writes passwords to command output, result JSON, logs, temporary files, or output names.

## IDE Agent / MCP

End-user quick guides with copy-ready Agent prompts are available in [Simplified Chinese](agent-guide.zh-CN.md) and [English](agent-guide.en.md). The installed CLI includes both: `toolknit agent guide --lang zh` (default) and `toolknit agent guide --lang en`.

The MCP server uses newline-delimited JSON-RPC over stdio. stdout contains protocol messages only. It negotiates supported protocol versions, bounds requests/responses to 8 MiB, limits active tool calls to four, handles cancellation, and aborts active jobs on transport EOF. Heavy new document/image operations use at most two worker threads, with bounded budgets and timeouts.

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

Local file tools and non-AI PPT tools do not need an AI credential. AI documents, AI tables, PPT text AI organization, AI PPT outline generation, AI PPT draft/PPTX generation, and transcription with `refine=true` require a real `DEEPSEEK_API_KEY` or `TOOLKNIT_AI_API_KEY` in the IDE's MCP environment/secret settings. Restart the IDE after setting it. Never leave explanatory placeholder text or place the key in an Agent message; the desktop application's stored credential is not shared with CLI/MCP.

The current registry exposes **77 MCP capabilities**. The generated [complete catalog](CLI_CAPABILITIES.md) maps every desktop tool to its actual headless scope, and [JSON schemas](CLI_CAPABILITIES.json) describe exact parameters. Run `toolknit tools list --json`, `toolknit tools coverage --json`, or `toolknit tools describe <toolknit_name> --json` for the installed version. Every listed capability can also be called through `toolknit run <toolknit_name> --arguments-file request.json --json`; use `--arguments-stdin` for passwords, never command-line secrets.
Tools reject unknown arguments and return structured success or error data. When an IDE sends `_meta.progressToken`, ToolKnit emits standard `notifications/progress` events at start and completion. An IDE Agent should first inspect a file, propose explicit output paths, and only pass `overwrite: true` after the user clearly authorizes replacement. Password parameters are in-memory secrets and must not be repeated in messages, filenames, or logs.

`toolknit_pdf_enhance` is intended for scanned or image-based PDFs. It rasterizes output pages, so searchable text, links, forms, and native vector data are not preserved.

## AI document contract

`toolknit_ai_document` accepts a natural-language `prompt`, an explicit PDF `output_path`, an exact `page_count` from 1 through 8, a `zh-CN` or `en` locale, and an optional explicit `overwrite` decision. Its default page count is 3. The tool validates the model layout, renders the document with bundled Noto Sans SC fonts, verifies the actual PDF page count, and only then publishes the output atomically.

The MCP process reads its provider credential from `DEEPSEEK_API_KEY` or `TOOLKNIT_AI_API_KEY`. Optional OpenAI-compatible overrides are `TOOLKNIT_AI_API_URL` and `TOOLKNIT_AI_MODEL`. These values are process configuration, never tool arguments. The desktop application's provider key remains isolated in desktop-local storage and is never read by CLI/MCP. ToolKnit rejects known placeholder values before contacting a provider.

Progress covers request validation, generation, layout validation, A4 rendering, and publication. Missing provider configuration, provider timeouts, invalid or oversized model layouts, page-count mismatches, unsafe paths, existing outputs, and failed writes return structured errors. Retryable provider, response, content-grounding, and layout failures receive up to five bounded attempts; configuration, authorization, unsafe-path, existing-output, and local-write failures do not retry. ToolKnit never publishes a PDF whose real page count differs from `page_count`.

An IDE Agent, not the edit runtime, translates natural-language revisions into structured operations. It must call `toolknit_ai_document_inspect`, resolve a target by stable number or one unique text/type match, ask when a semantic target is ambiguous, and call `toolknit_ai_document_edit` with `dry_run=true` before submitting the exact same operations. Every committed edit creates a revision and refreshes the bound PDF, clean previews, and per-page numbered maps.

For an image-free-first workflow, the creation prompt explicitly forbids images, placeholders, and `image` controls, and the Agent verifies that inspection returns zero image controls. A later `insert_control` image operation requires an absolute regular PNG/JPEG `source_path` no larger than 10 MB. Relative paths and base64 are rejected. A standalone `delete_control` removes only the referenced stable control; remaining controls are not renumbered. `page_count_changed` and other error diagnostics block publication.

## AI table contract

`toolknit_ai_table` and the matching `toolknit ai-table create` command accept a natural-language table brief, an explicit output path with `csv`, `xlsx`, `pdf`, or `png` extension, a `zh-CN` or `en` locale, and an explicit overwrite decision. They return the primary export, a `.toolknit-table.json` editable project, a PNG preview, and a first revision. `inspect`, `edit`, `undo`, and `render` operate on that project by stable `R01`, `C01`, and `G01` identifiers.

The provider is instructed with an exact JSON schema: every column is `{key,label,type}`, every row is an array, and charts use zero-based `labelColumn` / `valueColumns` indexes. ToolKnit also recognizes the unambiguous provider aliases commonly returned by OpenAI-compatible models, such as string column labels and chart `xAxis` / `yAxis`, then applies the same strict bounded validation. The accepted table contract permits only text, number, and date columns; primitive cell values; and bar, line, or pie charts. It is capped at 200 rows, 20 columns, and 4 charts. CSV and Excel outputs protect text beginning with formula characters, so a response from an AI provider cannot turn into an executable spreadsheet formula when opened.

AI table publication is atomic across the export, editable project, preview, and revision data. If Excel, an IDE preview, or another process holds an output file open, ToolKnit leaves the previous artifacts intact and reports the exact blocked path. Close the application using that file and retry the same operation; do not delete a locked artifact to force an update.

## AI polish contract

`toolknit ai polish` / `toolknit_ai_polish` accept exactly one `text` or UTF-8 `input_path` and an explicit `style`. Up to 12,000 characters are sent to the independently environment-configured AI provider. Results contain polished text, bounded to 30,000 characters; no file is written by default. Missing credentials, cancellation, timeout, invalid content and HTTP failures produce structured errors without provider bodies or credentials.

## AI translation contract

`toolknit ai translate` / `toolknit_ai_translate` accept exactly one `text` or UTF-8 `input_path` plus `target_language`. The runtime validates all original sentence fields against the complete caller source before returning translated text and aligned pairs. A provider cannot silently replace or omit the original. Source input is capped at 12,000 characters; supported target codes and response bounds are in the schema. Only this explicitly requested operation sends the text to the configured provider.

## Password generator scope

Password generation is intentionally desktop-only and has no future CLI/MCP contract. A generated secret would otherwise pass through terminal history, IDE Agent transcripts, MCP messages, logs, and model context, which is incompatible with the tool's security purpose. The desktop implementation keeps generated values in memory until the user copies or replaces them and must never persist or report them through usage telemetry.

## Color extraction contract

`toolknit image colors` and MCP's `toolknit_color_extract` analyze one explicit local PNG, JPEG, or WebP image and return a deterministic palette without writing an output file. `count` is optional from 2 through 9 (default 9, matching the desktop clustering pass). The palette is sorted by sampled population and each entry includes HEX, RGB, HSL, pixels, and percentage.

The source must be a non-symbolic regular file below 20 MB and 40 megapixels. Image headers are validated before decoding, then the image is downsampled to a 200-pixel longest edge; fully transparent pixels are excluded from fixed-initialization K-means clustering. No image bytes are uploaded, persisted, or returned. IDE Agents must resolve a unique image path from the file tree and ask rather than select an ambiguous asset.

## Image conversion contract

`toolknit image convert` / `toolknit_image_convert` process 1-100 regular local inputs, with an explicit `output_dir` and `format` (`png`, `jpg`, `webp`, `bmp`, `gif`, `svg`). JPEG/BMP flatten alpha onto white; SVG embeds a PNG and is not vector tracing. Displayed orientation/dimensions are preserved. Inputs are capped at 20 MiB and 40 megapixels each. Animated or multipage sources require explicit `frame_policy: "first"`; default behavior rejects them. Completed outputs get unique names; partial batches report each failure, and all-failed batches return a processing error.

## Image compression contract

`toolknit image compress` / `toolknit_image_compress` accept 1-100 static PNG/JPEG/WebP files and an explicit output directory. JPEG quality high/medium/low maps to 90/75/60; PNG and WebP use lossless optimization, so quality is not a lossy knob for those formats. Only strictly smaller outputs are published. `no-reduction` creates no file; inspect `results` and `outputs`. Dimensions are preserved, source files are never overwritten, and metadata is removed.

## Icon generator contract

`toolknit image icons` / `toolknit_image_icons` take one static raster image and an explicit ZIP output. The archive contains PNG icons at 16/32/48/64/128/256/512/1024, multi-resolution ICO/favicon and an embedded PNG SVG wrapper. The source is fitted with transparent padding rather than distorted. Input and output budgets use the desktop icon core; no remote content is fetched.

## Audio conversion contract

`toolknit audio convert` and MCP's `toolknit_audio_convert` accept one to 100 explicit local input paths, one explicit output directory, one of `mp3`, `aac`, `wav`, `flac`, `alac`, or `ogg` as the target, and an optional `low`, `medium`, or `high` quality policy. WMA is accepted only as a source. AAC and ALAC produce `.m4a`; WAV and ALAC use fixed lossless encoders, so the quality option does not change their encoding.

The runtime rejects empty batches, duplicate or symbolic-link inputs, non-regular or empty files, inputs above 10 GB, unsupported targets, unsafe output directories, unavailable FFmpeg, and concurrent ToolKnit batches. It processes files sequentially, reports progress at validation, per-file preparation/encoding, and completion, and returns a structured record for each success or failure. A partial batch is successful when at least one file completes and includes warnings for failed files; a batch with no successful outputs returns a processing error.

Every encode writes into a newly created temporary directory inside the requested output directory. Only a non-empty successful FFmpeg output is published through an exclusive same-volume link, so it cannot replace an existing file or leave a named partial result. Existing names receive `_1`, `_2`, and so on. The input is never modified. An installed CLI can reuse the managed FFmpeg downloaded by ToolKnit Desktop, resolve it from `PATH`, or use `TOOLKNIT_FFMPEG_PATH`; `doctor --json` exposes availability and the selected executable before a job starts.

## Audio clip contract

`toolknit audio clip` and MCP's `toolknit_audio_clip` accept exactly one supported regular local audio input, explicit `start_seconds`, `end_seconds`, and an explicit output directory. The source is never uploaded or changed. The input limit is 100 MB and 20 minutes, mono or stereo only; the selection starts at zero or later, ends within source duration, and must last at least 0.1 seconds.

The default attempts stream copying in the original container. If that fails, ToolKnit re-encodes as MP3 and returns `stream_copy: false` plus a warning; callers may explicitly request `target_format: "mp3"`. Outputs are staged inside the requested directory, checked as non-empty, and published with a unique name only after FFmpeg succeeds. The runtime rejects symbolic links, invalid timestamps, unsupported formats, unavailable FFmpeg, unsafe output directories, concurrent jobs, and leaves no published partial output. Progress identifies validation, probe, trim/encode, publication, and completion.

## BPM detection contract

`toolknit audio bpm` and MCP's `toolknit_audio_bpm` accept exactly one explicit local `mp3`, `wav`, `flac`, `aac`, `ogg`, or `m4a` path. They reject symbolic links, non-regular or empty files, files above 50 MB, files longer than 5 minutes, non-mono/stereo streams, decoded PCM above 192 MB, unavailable FFmpeg, and concurrent analysis. The source is never uploaded, changed, or copied into an output directory.

The runtime uses FFmpeg to decode only the first 120 seconds as mono 11,025 Hz PCM, then performs local onset/autocorrelation analysis. The result contains `bpm` (or `null` when no reliable beat pattern exists), `confidence` from 0 to 1, up to five candidate BPM values, original duration/channel metadata, and analyzed duration. Progress reports validation, metadata probe, decoding, beat estimation, and completion. The headless contract intentionally excludes the desktop waveform, visual peak rendering, and optional beat playback.

## Audio extraction contract

`toolknit audio extract` and MCP's `toolknit_audio_extract` extract exactly one explicit local video audio track as `mp3`, `aac`, `wav`, `flac`, or `ogg` into one explicit output directory. Inputs may be `mp4`, `mkv`, `avi`, `mov`, `webm`, `flv`, `wmv`, `ts`, or `m4v`; they must be non-empty regular files, not symbolic links, and no larger than 10 GB. `track_index` is optional and ranges from `0` to `31`; omission deliberately selects the first audio track. An Agent must ask before choosing among multiple tracks rather than infer intent.

The source video is never uploaded or changed. The runtime probes duration, runs FFmpeg with the selected audio stream, validates a non-empty staged output, then atomically publishes a unique final filename in the requested directory. It rejects invalid formats/indexes, missing audio streams, unavailable FFmpeg, unsafe output directories, concurrent jobs, and failed encodes without publishing a partial result. Progress distinguishes validation, track probing, extraction, publication, and completion. A headless caller must always provide `output_dir`; it must not rely on desktop-local output configuration.

## Video conversion contract

`toolknit video convert` and MCP's `toolknit_video_convert` accept one to 30 explicit local video inputs, one explicit output directory, and one target from `mp4`, `avi`, `mkv`, `mov`, `webm`, `flv`, `wmv`, or `ts`. Source files may also be `m4v`. The runtime rejects duplicate or symbolic-link inputs, non-regular or empty files, files above 10 GB, invalid target formats, unsafe output directories, unavailable FFmpeg, and concurrent jobs. The source files are never uploaded or changed.

The CLI processes the batch locally and independently: one failed input does not invalidate completed peers, while an all-failed batch returns a processing error. Each output is staged in its requested output directory, verified non-empty, and atomically published under a unique name only after FFmpeg succeeds. The structured result reports every output, per-file error, and the selected video/audio encoder; the portable CLI currently reports `hardware_acceleration: false` rather than making an unsupported GPU claim. Progress distinguishes validation, per-file preparation/encode, failures, and completion. An IDE Agent must resolve all paths from the file tree and ask rather than guess when its target file or desired format is ambiguous.

## Text statistics contract

`toolknit text stats` accepts exactly one UTF-8 source: a regular local file through `--input`, or standard input through `--stdin`. The two modes are mutually exclusive. MCP's `toolknit_text_stats` intentionally accepts only an explicit file path resolved from the IDE file tree, so source text is not repeated in Agent arguments. Neither interface writes files, uploads content, or includes the text itself in result data, progress messages, or diagnostics.

Inputs above 1,000,000 UTF-16 code units, files above the corresponding UTF-8 size bound, symbolic links, invalid UTF-8, and binary NUL content are rejected. The deterministic shared core reports Unicode code-point characters, non-whitespace characters, literal U+0020 spaces, Han-script characters, ASCII Latin letters, digits, declared punctuation, English word runs, sentences, lines, paragraphs, longest line, average line length, and estimated reading time. An Agent must resolve a unique file reference before it calls the tool and ask when a reference is ambiguous.

## Text, developer and calculation contracts

`toolknit text format` / `toolknit_text_format` apply an explicit action to `text`, a UTF-8 input file, or CLI `--stdin`, and return the transformed text without automatic file writes. Actions reuse the desktop core, including stable line deduplication, natural sorting, numbered-line removal and grapheme-aware reversal. Exact action identifiers use the schema's camelCase names.

JSON/Base64/URL encoding, UUID v4, JWT decode and file/text checksums are local. JWT decoding does not verify signatures; it does not return the signature. Password generation and secret-key encryption are intentionally not exposed. Timestamp conversion requires an explicit unit or ISO timezone; BMI and financial schedules are bounded estimates, not diagnoses or lender guarantees. File scans only inspect an explicit directory and never delete data.

## Release procedure

### Optional live AI verification

`npm run test:cli-ai-live -- --live` tests the configured relay/model through the CLI entry and official MCP SDK with synthetic text, PDF, PPTX and speech. Set `TOOLKNIT_AI_API_KEY`, `TOOLKNIT_AI_API_URL` and `TOOLKNIT_AI_MODEL` in the process environment; never put credentials in command arguments or files. Omit `--live` to skip all network calls. This opt-in script is outside the automatic release gate because requests can incur provider charges. Evidence and synthetic outputs stay under ignored `tmp/cli-ai-live-*` directories. `--only=<case-prefix>` selects a failed case for a focused repeat.

It checks text polishing/translation, PDF vision Markdown and Word layout, all four PPT text modes, outline/draft generation, editable document/table generation-inspect-edit-undo-render workflows, and subtitle refinement using an already installed offline model. LibreOffice is needed for the generated PPTX rendering check. The script never downloads missing runtimes or models. Provider timing varies; a passing sample does not guarantee arbitrary document accuracy or latency.

AI table and subtitle refinement requests have a 120-second deadline including response-body reading. Cancellation remains distinct from timeout. Document/table creation, editing and rendering check cancellation before final publication; an atomic commit already started completes or rolls back. Existing table output is checked before paid AI requests. Windows model lookup falls back to the user's Roaming directory if an MCP host omits `APPDATA`. Office conversion uses an isolated short temporary workspace so deep output directories do not break its profile.

Treat the final tool result as authoritative completion. SDK 1.32.1 can drop its final `onprogress` callback when a progress notification and the result arrive in one stdio chunk; the server sends 100% before the response. Interop tests inspect wire order separately from this SDK callback limitation.

### Package checks

Before publishing, `npm pack` stages the licensed runtimes, exact shared engine snapshot and public guides, then installs the CLI shrinkwrap for its bundled ExcelJS tree. Library overrides do not apply in consumer projects; ExcelJS 4.4.0 is bundled with UUID 11.1.1 and its dependency metadata correction, retaining the upstream MIT license (see NOTICE). Native canvas/image optional dependencies remain platform-selected by npm. Run the complete package and behavior checks:

```powershell
npm run test:cli
npm run test:cli-clean-worktree
```

The test suite creates temporary PDFs outside the repository and validates CLI output, no-overwrite protection, encrypt/decrypt, compression behavior, MCP initialization, tool discovery, structured tool results, and rejection of undeclared arguments.

## V3.2 document and packaging details

- `pdf to-word`: same restricted desktop engine; original layout or A4 flow. Default offline. `ai_mode=true` sends region text/images to the configured provider and returns review counts. Complex regions may remain images; scanned OCR is excluded.
- `image to-pdf`: ordered inputs, multipage TIFF, A4/original dimensions, faithful/grayscale/natural modes, explicit first-frame permission for animation. Output is image-only.
- `pdf text`: local selectable-text Markdown/TXT; reports empty/scanned pages. `pdf ai-markdown` explicitly sends up to 20 selected page images and builds a reading guide. It is not a silent fallback.
- `pdf crop`, `pdf page-number`, `pdf to-scan`, `pdf create`: explicit geometry and file output. Crop is not redaction; scan output loses searchable text and interactive document objects.
- `pdf to-image`: supports images, vertical `long`, `long-horizontal`, and `grid` with exactly 4 or 9 pages. Pages follow source PDF order.
- `excel to-pdf`: validated XLSX only, rejects active/external workbook content, uses an isolated LibreOffice profile and preserves workbook print setup. No WPS fallback.
- `markdown html`: desktop Markdown tables/tasks and MathML formulas, escaped raw HTML, strict standalone CSP, no remote images/scripts. Mermaid remains code.

The npm archive contains only the staged pure engines, headless runtimes, runtime resources, notices and public guides. Private Skills, test fixtures and internal maintenance reports are excluded. The PDF-to-Word engine and its headless adapter keep their scoped source-viewing license; using the unmodified official CLI follows the official-application exception. Other author-owned code retains PolyForm terms and third-party materials retain their licenses. Commercial/reuse authorization: info@toolknit.com.

Validation includes the current working-source snapshot, an actual packed archive installed in an isolated consumer directory, CLI invocations, MCP calls, and real output inspection. `test:cli-clean-worktree` is a compatibility script name; it now verifies current uncommitted source as well as tracked code rather than testing an older HEAD.

`doctor --json` additionally reports the supported Node version, MCP tool count and optional LibreOffice availability. Its existing exit status remains based on qpdf/FFmpeg availability for compatibility; inspect `libreoffice` before Office rendering. Model installation serializes the same destination across CLI processes, verifies resume Content-Range and SHA-256, has a 15-minute limit per source, keeps resumable partial files and preserves the previous model on failure. It does not download models during doctor or tool discovery.

On Windows, transcription stages model/audio paths for whisper.cpp in an ASCII-path workspace and copies results back to the explicit destination. When a separate workspace is needed, its ACL is restricted to the current user; it is removed after success/failure/cancellation. The installed model is read only and no second model download is required. One transcription job runs per process. Native transcription regression uses synthesized test speech only when a local model is already selected; missing models are an explicit skip, not an automatic download.
