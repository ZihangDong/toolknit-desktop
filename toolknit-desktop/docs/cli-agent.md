# ToolKnit CLI and IDE Agent

ToolKnit Desktop and `@toolknit/cli` are separate v1.2 deliverables. The CLI runs file operations directly and never starts, drives, or depends on the desktop UI.

## Installation and checks

The CLI requires Node.js 20.12 or later. The Windows release artifact carries the qpdf runtime and qpdf license notices for PDF decrypt and compress operations. On another platform, install qpdf separately or set `TOOLKNIT_QPDF_PATH` to its executable. Audio/video operations and local transcription preparation require FFmpeg. The CLI resolves, in order, an absolute `TOOLKNIT_FFMPEG_PATH`, the managed runtime downloaded by ToolKnit Desktop, the development repository fixture, and finally `ffmpeg` from `PATH`.

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
npm install --global --no-audit --no-fund --prefer-offline .\toolknit-cli-1.2.8.tgz
```

## Command help

The installed command includes a Chinese help system. Start with the complete command index, then drill into the PDF category or one operation:

```powershell
toolknit --help
toolknit pdf --help
toolknit pdf merge --help
toolknit help pdf merge
```

Each operation help describes its required parameters, optional parameters, examples, output behavior, and relevant safety constraints. This document contains the same contract for IDE and release integration.

Inside this repository, maintainers can use `npm run cli -- doctor --json` (or replace `doctor --json` with any documented CLI command) to test the source tree directly.

`doctor` reports both `qpdf.available` and `ffmpeg.available`. `qpdf` is required for decrypt/compress; FFmpeg is required for audio and video processing. A custom qpdf executable can be selected with `TOOLKNIT_QPDF_PATH`; `TOOLKNIT_FFMPEG_PATH` overrides the managed desktop runtime and system `PATH` when an explicit executable is required.

## CLI contract

Every file-writing command requires an explicit destination. ToolKnit only accepts regular `.pdf` input files (symlinks are rejected), never overwrites an existing file unless `--overwrite` is explicitly supplied, and always refuses to write over one of its input files. Each output is written to a same-directory temporary file and published atomically only after processing succeeds.

```powershell
toolknit pdf inspect --input .\report.pdf --json
toolknit pdf merge --input .\part-a.pdf --input .\part-b.pdf --output .\merged.pdf --json
toolknit pdf split --input .\report.pdf --pages 1,3-5 --output-dir .\pages --json
toolknit pdf rotate --input .\report.pdf --output .\rotated.pdf --rotation 90 --json
toolknit pdf compress --input .\report.pdf --output .\report-smaller.pdf --level high --json
toolknit pdf enhance --input .\scan.pdf --output .\scan-enhanced.pdf --strength medium --json
toolknit audio convert --input .\\meeting.m4a --output-dir .\\toolknit-output --format mp3 --quality high --json
toolknit audio bpm --input .\\beat.wav --json
toolknit audio clip --input .\\meeting.m4a --start 12.5 --end 47 --output-dir .\\toolknit-output --json
toolknit audio extract --input .\\lesson.mp4 --output-dir .\\toolknit-output --format mp3 --track-index 0 --quality high --json
toolknit video convert --input .\\recording.mov --output-dir .\\toolknit-output --format mp4 --json
```

The command result is JSON when `--json` is supplied. Success has exit code `0`; usage errors use `2`; invalid or missing inputs use `3`; unsafe output paths and overwrite refusals use `4`; missing engines use `5`; and processing failures use `6`.

Interactive CLI output includes ToolKnit's supplied ASCII artwork when the terminal is wide enough. Use `--banner=auto` (default), `--banner=always`, or `--banner=never` to control it. Artwork is permanently disabled for `--json`, redirected/piped output, and `toolknit mcp serve`; therefore it cannot corrupt scripts or the MCP JSON-RPC stream.

For a subset of pages during a merge, use the zero-based input index and one-based PDF pages:

```powershell
toolknit pdf merge --input .\first.pdf --input .\second.pdf --output .\selected.pdf --page-selections '[{"input_index":0,"pages":[1,3]}]' --json
```

`pdf encrypt` and `pdf decrypt` accept secrets only through `--password-stdin`, never a command-line argument. Use a password manager's secure pipe or another protected stdin source. ToolKnit never writes passwords to command output, result JSON, logs, temporary files, or output names.

## IDE Agent / MCP

End-user quick guides with copy-ready Agent prompts are available in [Simplified Chinese](agent-guide.zh-CN.md) and [English](agent-guide.en.md). The installed CLI includes both: `toolknit agent guide --lang zh` (default) and `toolknit agent guide --lang en`.

The MCP server uses newline-delimited JSON-RPC over stdio. It writes no diagnostic output to stdout or stderr, so it is safe for IDE integration.

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

Local file tools do not need an AI credential. AI documents, AI tables, and transcription with `refine=true` require a real `DEEPSEEK_API_KEY` or `TOOLKNIT_AI_API_KEY` in the IDE's MCP environment/secret settings. Restart the IDE after setting it. Never leave explanatory placeholder text or place the key in an Agent message; the desktop application's stored credential is not shared with CLI/MCP.

The current MCP tools are:

- `toolknit_pdf_inspect`
- `toolknit_pdf_merge`
- `toolknit_pdf_split`
- `toolknit_pdf_rotate`
- `toolknit_pdf_encrypt`
- `toolknit_pdf_decrypt`
- `toolknit_pdf_compress`
- `toolknit_pdf_enhance`
- `toolknit_audio_convert`
- `toolknit_audio_bpm`
- `toolknit_audio_clip`
- `toolknit_audio_extract`
- `toolknit_model_list`
- `toolknit_model_install`
- `toolknit_model_use`
- `toolknit_transcribe`
- `toolknit_video_convert`
- `toolknit_video_frame`
- `toolknit_video_gif`
- `toolknit_text_stats`
- `toolknit_color_extract`
- `toolknit_image_stitch`
- `toolknit_ai_document`
- `toolknit_ai_document_inspect`
- `toolknit_ai_document_edit`
- `toolknit_ai_document_render`
- `toolknit_ai_table`
- `toolknit_ai_table_inspect`
- `toolknit_ai_table_edit`
- `toolknit_ai_table_render`

Tools reject unknown arguments and return structured success or error data. When an IDE sends `_meta.progressToken`, ToolKnit emits standard `notifications/progress` events at start and completion. An IDE Agent should first inspect a file, propose explicit output paths, and only pass `overwrite: true` after the user clearly authorizes replacement. Password parameters are in-memory secrets and must not be repeated in messages, filenames, or logs.

`toolknit_pdf_enhance` is intended for scanned or image-based PDFs. It rasterizes output pages, so searchable text, links, forms, and native vector data are not preserved.

## AI document contract

`toolknit_ai_document` accepts a natural-language `prompt`, an explicit PDF `output_path`, an exact `page_count` from 1 through 8, a `zh-CN` or `en` locale, and an optional explicit `overwrite` decision. Its default page count is 3. The tool validates the model layout, renders the document with bundled MiSans fonts, verifies the actual PDF page count, and only then publishes the output atomically.

The MCP process reads its provider credential from `DEEPSEEK_API_KEY` or `TOOLKNIT_AI_API_KEY`. Optional OpenAI-compatible overrides are `TOOLKNIT_AI_API_URL` and `TOOLKNIT_AI_MODEL`. These values are process configuration, never tool arguments. The desktop application's provider key remains isolated in desktop-local storage and is never read by CLI/MCP. ToolKnit rejects known placeholder values before contacting a provider.

Progress covers request validation, generation, layout validation, A4 rendering, and publication. Missing provider configuration, provider timeouts, invalid or oversized model layouts, page-count mismatches, unsafe paths, existing outputs, and failed writes return structured errors. Retryable provider, response, content-grounding, and layout failures receive up to five bounded attempts; configuration, authorization, unsafe-path, existing-output, and local-write failures do not retry. ToolKnit never publishes a PDF whose real page count differs from `page_count`.

An IDE Agent, not the edit runtime, translates natural-language revisions into structured operations. It must call `toolknit_ai_document_inspect`, resolve a target by stable number or one unique text/type match, ask when a semantic target is ambiguous, and call `toolknit_ai_document_edit` with `dry_run=true` before submitting the exact same operations. Every committed edit creates a revision and refreshes the bound PDF, clean previews, and per-page numbered maps.

For an image-free-first workflow, the creation prompt explicitly forbids images, placeholders, and `image` controls, and the Agent verifies that inspection returns zero image controls. A later `insert_control` image operation requires an absolute regular PNG/JPEG `source_path` no larger than 10 MB. Relative paths and base64 are rejected. A standalone `delete_control` removes only the referenced stable control; remaining controls are not renumbered. `page_count_changed` and other error diagnostics block publication.

## AI table contract

`toolknit_ai_table` and the matching `toolknit ai-table create` command accept a natural-language table brief, an explicit output path with `csv`, `xlsx`, `pdf`, or `png` extension, a `zh-CN` or `en` locale, and an explicit overwrite decision. They return the primary export, a `.toolknit-table.json` editable project, a PNG preview, and a first revision. `inspect`, `edit`, `undo`, and `render` operate on that project by stable `R01`, `C01`, and `G01` identifiers.

The provider is instructed with an exact JSON schema: every column is `{key,label,type}`, every row is an array, and charts use zero-based `labelColumn` / `valueColumns` indexes. ToolKnit also recognizes the unambiguous provider aliases commonly returned by OpenAI-compatible models, such as string column labels and chart `xAxis` / `yAxis`, then applies the same strict bounded validation. The accepted table contract permits only text, number, and date columns; primitive cell values; and bar, line, or pie charts. It is capped at 200 rows, 20 columns, and 4 charts. CSV and Excel outputs protect text beginning with formula characters, so a response from an AI provider cannot turn into an executable spreadsheet formula when opened.

AI table publication is atomic across the export, editable project, preview, and revision data. If Excel, an IDE preview, or another process holds an output file open, ToolKnit leaves the previous artifacts intact and reports the exact blocked path. Close the application using that file and retry the same operation; do not delete a locked artifact to force an update.

## Planned AI polish contract

AI text polish is not registered as a CLI command or MCP tool in current v1.2. Its future interface will accept one bounded UTF-8 text input, an explicit style instruction, and a separately configured provider credential; it will return polished text only and never write a file by default. It will report `analyze` and `polish` phases, reject missing credentials, inputs above 12,000 UTF-16 code units, provider timeouts, malformed direction data, malformed text responses, and responses above 30,000 characters.

The desktop application may offer provider-suggested styles, but a future headless caller must supply the chosen style explicitly. It must not read the desktop application's local storage or expose provider error bodies, prompts, API keys, or text content in diagnostics.

## Planned AI translation contract

AI translation is not registered as a CLI command or MCP tool in current v1.2. Its future interface will accept one bounded UTF-8 text input, an explicit target language, and a separately configured provider credential; it will return translated text plus optional aligned sentence pairs, without writing a file by default. It will report `translate` and `validate` phases, reject missing credentials, inputs above 12,000 UTF-16 code units, unknown target languages, provider timeouts, malformed responses, and responses above 60,000 characters.

A later headless implementation must treat the caller's original input as authoritative: model-supplied source sentence fields may be used only after equivalence validation and can never replace the supplied source. It must not infer a Latin-script source language as English, read desktop-local credentials, or include prompts, API keys, or provider error bodies in logs.

## Password generator scope

Password generation is intentionally desktop-only and has no future CLI/MCP contract. A generated secret would otherwise pass through terminal history, IDE Agent transcripts, MCP messages, logs, and model context, which is incompatible with the tool's security purpose. The desktop implementation keeps generated values in memory until the user copies or replaces them and must never persist or report them through usage telemetry.

## Color extraction contract

`toolknit image colors` and MCP's `toolknit_color_extract` analyze one explicit local PNG, JPEG, or WebP image and return a deterministic palette without writing an output file. `count` is optional from 2 through 9 (default 9, matching the desktop clustering pass). The palette is sorted by sampled population and each entry includes HEX, RGB, HSL, pixels, and percentage.

The source must be a non-symbolic regular file below 20 MB and 40 megapixels. Image headers are validated before decoding, then the image is downsampled to a 200-pixel longest edge; fully transparent pixels are excluded from fixed-initialization K-means clustering. No image bytes are uploaded, persisted, or returned. IDE Agents must resolve a unique image path from the file tree and ask rather than select an ambiguous asset.

## Planned image conversion contract

Image format conversion is being hardened for a later CLI/MCP release. It is **not** registered as a CLI command or MCP tool in the current v1.2 package, so an IDE Agent must not claim it is available yet.

The future interface will accept one to 100 local JPG/JPEG, PNG, WebP, BMP, or GIF files, a validated target format, and one explicit output directory. It will reject non-regular files, files over 20 MB, images over 40 megapixels, unsupported target formats, duplicate inputs, concurrent conversion jobs, and failed writes. It will never overwrite an existing output and will report per-file success or failure, output paths, progress, cancellation, and a nonzero processing error when no file succeeds.

The current desktop encoder preserves image dimensions. JPEG output is RGB because JPEG cannot contain transparency. Static GIF sources are supported, but animated GIF inputs are rejected instead of silently discarding frames. A future headless interface must extend this explicit preservation policy to every animated source format before it accepts one; it must never promise to preserve animation unless an animation-capable encoder is explicitly added and tested.

## Planned image compression contract

Image compression is also **not** registered as a CLI command or MCP tool in the current v1.2 package. The future interface will accept one to 100 local JPG/JPEG, PNG, or WebP files, a `high`, `medium`, or `low` quality policy, and one explicit output directory. It will apply the same 20 MB per-file and 40-megapixel limits as image conversion, run one conversion job at a time, and report each file's result without overwriting an existing output.

An output is published only when it is strictly smaller than its source. BMP and GIF are intentionally outside the contract: the bundled encoder cannot safely provide a smaller BMP, and GIF handling can discard animation frames. JPEG and PNG quality policies affect their encoders. WebP is explicitly lossless in the desktop implementation, so the selected quality policy has no effect on WebP files and clients must report it as lossless optimization rather than imply lossy quality control.

## Planned icon generator contract

The icon generator is not registered as a CLI command or MCP tool in current v1.2. Its future interface will accept one local PNG/JPEG/WebP image and one explicit ZIP output path. It will reject non-regular files, input files above 20 MB, images above 20 megapixels, generated archives above 32 MB, canceled jobs, and unsafe or pre-existing output paths. A successful archive contains fixed-size PNG icons, `icon.ico`, `favicon.ico`, and an SVG wrapper; progress covers decoding, raster generation, archive creation, and atomic publication.

It intentionally excludes BMP and GIF sources because static icon output cannot preserve GIF animation and these formats do not provide a useful, deterministic headless contract. It must never reuse a desktop-local provider key or depend on the desktop application being visible.

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

## Planned text formatting contract

Text formatting is not registered as a CLI command or MCP tool in current v1.2. Its future interface will accept one explicit UTF-8 text file or UTF-8 standard input, one declared action, and one explicit UTF-8 output file. It will reject binary or undecodable input, input and output over 1,000,000 UTF-16 code units, more than 100,000 lines for line-oriented actions, unknown actions, unsafe paths, same-path writes, and unapproved output overwrites. Output is written to a temporary file and atomically published only after transformation succeeds.

The action set is `uppercase`, `lowercase`, `titlecase`, `capitalize`, `trim-spaces`, `trim-lines`, `remove-empty-lines`, `remove-duplicate-lines`, `sort-asc`, `sort-desc`, `add-line-numbers`, `remove-line-numbers`, `reverse-lines`, `reverse-text`, `to-half-width`, and `to-full-width`. Sorting uses the fixed `zh-Hans-u-co-pinyin` collator with numeric comparison. `remove-line-numbers` only removes an initial sequence of at least two consecutive line numbers beginning at 1, preventing an ordinary year or numeric heading from being silently deleted. A headless caller must receive structured progress and errors without echoing text content into logs.

Calculator-category tools and the typing test are intentionally excluded from the CLI/MCP roadmap because a headless interface would not provide useful value for their interaction model.

## Release procedure

Before publishing, `npm pack` automatically stages the licensed qpdf runtime, exact shared PDF core snapshot, and bilingual Agent guides. Run the staging command explicitly before the complete contract suite when reviewing release contents:

```powershell
npm run stage:cli-resources
npm run test:cli-agent
```

The test suite creates temporary PDFs outside the repository and validates CLI output, no-overwrite protection, encrypt/decrypt, compression behavior, MCP initialization, tool discovery, structured tool results, and rejection of undeclared arguments.
