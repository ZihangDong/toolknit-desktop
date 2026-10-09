<div align="center">

<img src="assets/readme/hero-v2.webp" alt="ToolKnit Desktop — ToolKnit spider web hero" width="100%" />

<h1>ToolKnit Desktop 3.1</h1>

<p><strong>Local file workbench · Desktop, web, and AI Agent workflows</strong></p>

<p>
  Bring PDF, PPT, image, audio/video, Markdown, developer, and AI work into one clear, reliable, reusable tool system.
</p>

<p>
  <a href="https://toolknit.com"><img src="https://img.shields.io/badge/Primary%20entry-ToolKnit.com-0f766e?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Open ToolKnit.com" /></a>
  <a href="https://github.com/ZihangDong/toolknit-desktop/releases"><img src="https://img.shields.io/badge/Desktop-Windows%20download-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download the Windows desktop app" /></a>
  <a href="#cli--mcp--agent"><img src="https://img.shields.io/badge/CLI%20%2B%20MCP-Agent%20workflow-7c3aed?style=for-the-badge&logo=githubactions&logoColor=white" alt="CLI and MCP Agent workflow" /></a>
</p>

<p>
  <a href="README.md"><img src="https://img.shields.io/badge/Language-Simplified%20Chinese-475569?style=for-the-badge&labelColor=334155" alt="Simplified Chinese README" /></a>
  <img src="https://img.shields.io/badge/Version-3.1.0%20Preview-0f766e?style=for-the-badge&labelColor=115e59" alt="ToolKnit Desktop 3.1.0 preview" />
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/badge/Local--first-Files%20stay%20local-0f766e?style=for-the-badge" alt="Local-first" />
  <img src="https://img.shields.io/badge/Tauri-2.x-475569?style=for-the-badge" alt="Tauri 2.x" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-334155?style=for-the-badge" alt="Apache 2.0 license" /></a>
</p>

<p>
  <a href="https://github.com/ZihangDong/toolknit-desktop/stargazers"><img src="https://img.shields.io/github/stars/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=f59e0b" alt="GitHub stars" /></a>
  <a href="https://github.com/ZihangDong/toolknit-desktop/network/members"><img src="https://img.shields.io/github/forks/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=Forks&color=64748b" alt="GitHub forks" /></a>
  <a href="https://github.com/ZihangDong/toolknit-desktop/issues"><img src="https://img.shields.io/github/issues/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=Issues&color=ef4444" alt="GitHub issues" /></a>
  <a href="https://github.com/ZihangDong/toolknit-desktop/graphs/contributors"><img src="https://img.shields.io/github/contributors/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=Contributors&color=8b5cf6" alt="GitHub contributors" /></a>
</p>

</div>

<p align="center">
  <a href="#whats-new-in-30">What's new</a> ·
  <a href="#complete-tool-catalog">69 tools</a> ·
  <a href="#local-first-privacy-boundaries">Privacy</a> ·
  <a href="#run-from-source">Run from source</a> ·
  <a href="#cli--mcp--agent">CLI / MCP</a>
</p>

<table cellpadding="18" cellspacing="0">
  <tr>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/WEB-ToolKnit.com-0f766e?style=for-the-badge&logo=googlechrome&logoColor=white" alt="ToolKnit.com web version" /> <strong>Start with the web version</strong></p>
      <p>No installation required. Open the official web version in your browser.</p>
      <p><a href="https://toolknit.com"><strong>Open ToolKnit.com</strong></a></p>
      <sub>Ideal for a quick start, cross-platform access, or situations where a desktop install is not convenient.</sub>
    </td>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/DESKTOP-Windows-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows desktop" /> <strong>Use the desktop app</strong></p>
      <p>A local-first Windows app for long-running file work, offline processing, and visual editing.</p>
      <p><a href="https://github.com/ZihangDong/toolknit-desktop/releases"><strong>View desktop downloads</strong></a></p>
      <sub>Get Windows installers, SHA-256 checksums, and full release notes from GitHub Releases.</sub>
    </td>
  </tr>
</table>

## ToolKnit 3.1 Preview

ToolKnit Desktop 3.1 preview is a local file workbench for Windows. It brings everyday file processing, image and Markdown creation, developer tools, AI content production, professional document workflows, and IDE Agent automation into one product system. V3.1 is not released; V3.0 remains the latest public release.

The desktop app provides a visual workbench. Automation-ready capabilities are also available through the CLI and MCP Agents, while the web app offers access without installation. Each interface has its own documented feature catalog.

<table width="100%" cellpadding="14" cellspacing="0">
  <tr>
    <td align="center"><h3>69</h3><strong>Desktop tools</strong></td>
    <td align="center"><h3>12</h3><strong>Categories</strong></td>
    <td align="center"><h3>46</h3><strong>MCP capabilities</strong></td>
    <td align="center"><h3>3</h3><strong>Ways to work</strong></td>
    <td align="center"><h3>Windows</h3><strong>Launch platform</strong></td>
    <td align="center"><h3>Local-first</h3><strong>Privacy model</strong></td>
  </tr>
</table>

## What's new in 3.0

Compared with v2.3.1, V3.0 expands the desktop catalog from 65 to 68 tools, retaining 12 categories and 46 CLI/MCP capabilities. It also improves both themes, PDF/PPT workflows, cleanup safety, and startup behavior.

### New tools

- `PDF Text to Markdown`: extract selectable PDF text locally without an AI key, reconstruct basic structure, retain page references, and continue editing in the existing Markdown editor. Scanned documents are directed to the AI vision tool.
- `AI PDF to Markdown`: analyze pages with a vision model, assemble structured Markdown, and retain source-page references, a document summary, retry, and cancellation.
- `Windows Clipboard History`: explicitly enable monitoring to record subsequent text, PNG images, and file paths in a timeline with search, filters, favorites, image previews, and local encryption. Existing Win+V history is not imported, and monitoring stops when the app exits.

### Improvements across the app

- `Light and dark themes`: consistent empty, upload, processing, result, error, focus, and disabled states across tools, settings, and help. Startup and theme transitions reduce visible font and layout changes.
- `PDF and PPT workbenches`: shared previews, page selection, export controls, and result dialogs; PDF page editing and undo/redo; richer PPT outlines, editable drafts, and local image assets.
- `AI workflows`: clearer outline explanations, local image assets, and editable PPTX drafts, with shared key validation, error recovery, and output checks across writing, translation, documents, tables, and PPT tools.
- `Media and offline tools`: fixes for initial and continuous video preview playback, automatic preview expansion after uploading a video for GIF conversion, and on-demand FFmpeg, LibreOffice, Whisper, and local vision runtimes.
- `Cleanup safety`: AI large-file cleanup supports full C-drive scanning while excluding protected system directories, links, and system files, with fresh checks before deletion. C Drive Cleanup explains risk levels. Users still need to inspect results before choosing what to remove.
- `Color-space comparison`: HSV/HSL color wheels and HEX input, alongside linked color-space controls, gamut checks, and both themes.
- `Application stability`: closing or switching tools releases workers, canvases, listeners, tasks, and temporary resources; stale asynchronous results cannot update a new session.

The desktop app, Tauri bundle, Rust crate, and `@toolknit/cli` share version `3.0.0`. Desktop installers are available through [GitHub Releases](https://github.com/ZihangDong/toolknit-desktop/releases), and the command-line tool through [npm](https://www.npmjs.com/package/@toolknit/cli).

### Existing capabilities

The 2.1 series adds 11 desktop tools and delivers a broader upgrade across custom backgrounds, glass interactions, local dependency reuse, task lifecycle management, and failure recovery. Heavy editors and algorithm modules load on demand, while Workers, canvases, listeners, and temporary resources are released when a tool closes.

<table cellpadding="16" cellspacing="0">
  <tr>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/MARKDOWN-Document%20Studio-111827?style=for-the-badge&logo=markdown&logoColor=white" alt="Markdown Document Studio" /></p>
      <h3>Markdown Document Editor</h3>
      <p>Edit with split-screen GFM, Mermaid, and math previews, plus a heading outline, local drafts, and Markdown or self-contained HTML export.</p>
    </td>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/IMAGE-Crop%20%26%20Color-1473e6?style=for-the-badge&logo=imagemagick&logoColor=white" alt="Image crop and color tools" /></p>
      <h3>Image Crop and Smart Color Replace</h3>
      <p>Crop with ratio presets, composition guides, center snapping, and source-resolution export; replace colors with sampling, thresholds, feathering, and connected-region protection.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/COLOR-8%20Spaces-db2777?style=for-the-badge" alt="Eight color spaces" /></p>
      <h3>Color Space Compare</h3>
      <p>Inspect eight linked color spaces, test sRGB, Display P3, Adobe RGB, and Rec.2020 gamut membership, and adjust components on visual tracks.</p>
    </td>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/DEVELOPER-Local%20Toolbox-475569?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Local developer toolbox" /></p>
      <h3>Developer Tools Category</h3>
      <p>Adds JSON formatting, Base64 and URL codecs, batch UUID v4 generation, and local JWT inspection. Inputs and results remain in the current session.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/CRYPTO-17%20Modules-7c3aed?style=for-the-badge" alt="Hash and Crypto workbench" /></p>
      <h3>Hash &amp; Crypto</h3>
      <p>Covers 17 digest, file hash, HMAC, symmetric, and asymmetric modules. Legacy algorithms are marked for compatibility only, and sensitive data is never persisted to history.</p>
    </td>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/WORKSPACE-Custom%20Background-0f766e?style=for-the-badge" alt="Custom background workspace" /></p>
      <h3>Custom Background and Glass Workbench</h3>
      <p>Use image or video wallpapers across a unified glass interface, with restrained water-film card feedback and stronger readability on complex backgrounds.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/PDF-Safer%20Editing-ed1c24?style=for-the-badge&logo=adobeacrobatreader&logoColor=white" alt="Safer PDF editing" /></p>
      <h3>PDF Editing and Safe Output</h3>
      <p>Adds page duplication, blank pages, batch selection, repeatable text edits, and unsaved-change protection before close, replace, or reset actions.</p>
    </td>
    <td width="50%" valign="top">
      <p><img src="https://img.shields.io/badge/RUNTIME-Reuse%20Local%20Dependencies-2563eb?style=for-the-badge" alt="Reuse local dependencies" /></p>
      <h3>Dependency Reuse and Performance</h3>
      <p>Detects existing FFmpeg and LibreOffice installations first, downsamples preview work, discards stale tasks, and releases background resources when pages close.</p>
    </td>
  </tr>
</table>

<p align="center"><sub>Thanks to <a href="https://github.com/Joshua-Zion">Joshua-Zion</a>: the color-space core builds on <a href="https://github.com/ZihangDong/toolknit-desktop/pull/23">PR #23</a>, and V3.0 adapts color-wheel and input improvements from <a href="https://github.com/ZihangDong/toolknit-desktop/pull/67">PR #67</a>.</sub></p>

## Three ways to work

<table cellpadding="16" cellspacing="0">
  <tr>
    <td width="33%" valign="top">
      <p><img src="https://img.shields.io/badge/WEB-TOOLKNIT.COM-0f766e?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Web ToolKnit.com" /></p>
      <h3>Web</h3>
      <p>Ready immediately, with no installation. Good for quick processing and cross-platform access.</p>
      <a href="https://toolknit.com">Open ToolKnit.com</a>
    </td>
    <td width="33%" valign="top">
      <p><img src="https://img.shields.io/badge/DESKTOP-WINDOWS-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Desktop Windows" /></p>
      <h3>Desktop</h3>
      <p>Files stay on your device, with preview, drag-and-drop, batch processing, visual editing, and dependency management.</p>
      <a href="https://github.com/ZihangDong/toolknit-desktop/releases">View Releases</a>
    </td>
    <td width="33%" valign="top">
      <p><img src="https://img.shields.io/badge/CLI%20%2B%20MCP-AGENT-7c3aed?style=for-the-badge&logo=githubactions&logoColor=white" alt="CLI MCP Agent" /></p>
      <h3>CLI and Agent</h3>
      <p>For scripts, batch jobs, CI, and IDE Agents that call verifiable local capabilities in natural language.</p>
      <a href="#cli--mcp--agent">See the integration guide</a>
    </td>
  </tr>
</table>

## Complete tool catalog

The 12 desktop categories below contain all 69 tools in the current source, including PDF to Scanned PDF under V3.1 development. Released V3.0 contains 68 tools. Names correspond to in-app entries; CLI and MCP capabilities use the same input/output contracts as each tool becomes ready.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/PDF-Document%20Studio-ed1c24?style=for-the-badge&logo=adobeacrobatreader&logoColor=white" alt="PDF Document Studio" /></td><td align="right" style="border:0;"><h3 align="right">PDF tools · 14</h3></td></tr>
</table>

`PDF Merge` · `PDF Split` · `Add PDF Page Numbers` · `Crop PDF` · `PDF to Image` · `PDF to Scanned PDF` · `PDF Text to Markdown` · `PDF Editor` · `PDF Page Rotate` · `PDF Encrypt` · `PDF Decrypt` · `PDF Compress` · `PDF Enhance` · `Excel to PDF`

PDF to Scanned PDF rasterizes pages locally, with faithful, grayscale and natural effects, page selection and 150/200/300 DPI. Page dimensions and visible orientation are retained. Selectable text, links, forms and original digital signatures are not retained; OCR remains possible.

Supports drag sorting, page-by-page preview, selected-page export, page numbering, lossless cropping, rotation, text replacement, text and image insertion, append merge, password protection, scanned-document enhancement, multiple compression levels, and local workbook rendering. PDFs, workbooks, passwords, and exported results are processed locally by default.

PDF Text to Markdown extracts an existing text layer locally without an API key. AI PDF to Markdown sends selected page images to your configured vision model when you start conversion. Both workflows import results into the shared Markdown editor for preview, editing and export.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/PPT-Presentation%20Studio-d24726?style=for-the-badge&logo=microsoftpowerpoint&logoColor=white" alt="PPT Presentation Studio" /></td><td align="right" style="border:0;"><h3 align="right">PPT tools · 7</h3></td></tr>
</table>

`PPT to PDF` · `PPT to Image` · `PPT Image Extractor` · `PPT Text Extractor` · `PPT Compress` · `AI PPT Outline` · `AI PPT Draft / PPTX`

Supports page rendering, page selection, PNG/JPG/WebP output, duplicate asset filtering, title/body/notes extraction, Markdown/TXT/JSON export, media cleanup, and structured outlines plus editable PPTX drafts generated from a brief and source material. The PPT rendering runtime is downloaded on demand.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/IMAGE-Image%20Lab-1473e6?style=for-the-badge&logo=imagemagick&logoColor=white" alt="Image Lab" /></td><td align="right" style="border:0;"><h3 align="right">Image tools · 7</h3></td></tr>
</table>

`Image Crop` · `Smart Color Replace` · `Background Removal` · `Image Format Converter` · `Image Compressor` · `Long Image Stitcher` · `Icon Generator`

Supports ratio presets and composition guides for cropping, connected-region color replacement, local-model background removal, JPG/PNG/WebP/BMP/GIF/SVG conversion, batch compression, horizontal/vertical/seamless stitching of images or PDF pages, and multi-size PNG, ICO, and SVG icon generation with ZIP output.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/AUDIO-Sound%20Studio-007808?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="Sound Studio" /></td><td align="right" style="border:0;"><h3 align="right">Audio tools · 4</h3></td></tr>
</table>

`Audio Format Converter` · `BPM Detector` · `Audio Cutter` · `Audio Extractor`

Supports MP3, AAC, WAV, FLAC, ALAC, OGG, WMA, and other formats, offline BPM analysis, waveform-based cutting, and audio extraction from video. FFmpeg is installed on demand, and source files are never overwritten.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/VIDEO-Frame%20Studio-dc2626?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="Frame Studio" /></td><td align="right" style="border:0;"><h3 align="right">Video tools · 3</h3></td></tr>
</table>

`Video Format Converter` · `HD Video Frame` · `Video to GIF`

Supports MP4, AVI, MKV, MOV, WebM, FLV, WMV, TS, M4V, and other formats, exact-time PNG/JPG frame export, and palette-optimized GIF creation from clips up to 30 seconds.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/TEXT-Text%20Terminal-111827?style=for-the-badge&logo=markdown&logoColor=white" alt="Text Terminal" /></td><td align="right" style="border:0;"><h3 align="right">Text and transcription · 5</h3></td></tr>
</table>

`Markdown Document Editor` · `Audio/Video Transcription` · `Teleprompter` · `Text Statistics` · `Text Formatter`

The Markdown editor provides GFM, Mermaid, math, a heading outline, draft recovery, and offline export. After downloading a Whisper model locally, the app can transcribe Chinese and English audio/video offline and export TXT, SRT, and JSON; the same local recognition can drive teleprompter voice following. Text Statistics and Text Formatter help inspect and clean up plain text.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/UTILITY-Calculator-2563eb?style=for-the-badge" alt="Calculator utility" /></td><td align="right" style="border:0;"><h3 align="right">Calculator tools · 5</h3></td></tr>
</table>

`Body Fat Calculator` · `Timestamp Calculator` · `Mortgage Calculator` · `Interest Calculator` · `Password Generator`

Covers health estimates, Unix timestamp conversion, mortgage payments, simple/compound interest, and secure random password generation for quick desktop calculations.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/CREATIVE-Color%20%26%20Typing-db2777?style=for-the-badge&logo=figma&logoColor=white" alt="Color and typing tools" /></td><td align="right" style="border:0;"><h3 align="right">Creative tools · 3</h3></td></tr>
</table>

`Color Extractor` · `Color Space Compare` · `Typing Test`

Extract dominant image colors and palette shares, compare eight linked color spaces with common gamut checks, or practice Chinese and English typing with timing, speed, accuracy, and result statistics.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/SYSTEM-Cleanup-ea580c?style=for-the-badge&logo=windows11&logoColor=white" alt="System cleanup" /></td><td align="right" style="border:0;"><h3 align="right">Cleanup tools · 2</h3></td></tr>
</table>

`AI Large File Cleanup` · `C Drive Cleanup`

Large File Cleanup scans a selected directory or the C drive locally, then lets local rules and optional AI analyze only filenames, sizes, modification times, and directory clues. Protected paths, links, and system files are excluded. Confirmed large-file cleanup uses the Recycle Bin; C Drive Cleanup separately explains permanent removal of selected system caches and space items by risk level. File contents are not uploaded for AI review.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/AI-AI%20Workbench-10a37f?style=for-the-badge&logo=openai&logoColor=white" alt="AI Workbench" /></td><td align="right" style="border:0;"><h3 align="right">AI Workbench · 5</h3></td></tr>
</table>

`AI PDF to Markdown` · `AI Polish` · `AI Translate` · `AI Document Generation` · `AI Table Generation`

AI PDF analyzes rendered pages and assembles Markdown. AI Documents support multi-page PDFs, editable projects, preview, editing, and undo. AI Tables support CSV, XLSX, PDF, PNG, editable projects, formulas, and charts. Relevant text or page images are sent to your configured model service when you explicitly invoke AI.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/HARDWARE-System%20Inspector-0078d4?style=for-the-badge&logo=windows11&logoColor=white" alt="System Inspector" /></td><td align="right" style="border:0;"><h3 align="right">Hardware and system tools · 8</h3></td></tr>
</table>

`System Overview` · `CPU and Memory` · `GPU and Displays` · `Mainboard and Firmware` · `Storage Health` · `Network Devices` · `Power Sensors` · `Windows Clipboard History`

Read-only views cover Windows, device model, CPU, memory, graphics, displays, mainboard, BIOS, Secure Boot, TPM, virtualization, disks, network, and power sensors. The CPU and Memory page also provides live status refresh.

Clipboard History records subsequent copies of text, images and file paths after you enable monitoring. It provides a searchable timeline, filters, favorites and local encryption; existing Win+V history is not imported and monitoring stops when the app exits.

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td align="left" style="border:0;"><img src="https://img.shields.io/badge/DEVELOPER-Local%20Toolbox-475569?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Local Developer Toolbox" /></td><td align="right" style="border:0;"><h3 align="right">Developer tools · 6</h3></td></tr>
</table>

`JSON Formatter` · `Base64 Codec` · `URL Codec` · `UUID Generator` · `JWT Viewer` · `Hash & Crypto`

Validate, format, and minify JSON; process UTF-8 Base64; encode URL parameters; generate UUID v4 batches; inspect JWT Header and Payload; and run digest, file hash, HMAC, symmetric, and asymmetric workflows locally. Sensitive input is not persisted, and current-session data is cleared when the page closes.

## Local-first privacy boundaries

<img src="https://img.shields.io/badge/LOCAL-Local%20by%20default-0f766e?style=for-the-badge" alt="Local by default" /> **Local by default**: Desktop PDF, PPT, image, audio, video, text, calculator, hardware, and cleanup tools run on the device. Source files are not uploaded to ToolKnit servers.

<img src="https://img.shields.io/badge/AI-Explicit%20authorization-d97706?style=for-the-badge&logo=openai&logoColor=white" alt="AI requires explicit authorization" /> **Explicit authorization**: Relevant data is sent to your configured model service only when you actively use AI Polish, AI Translate, AI Documents, AI Tables, AI PDF to Markdown, PPT text AI organization, AI PPT Outline, AI PPTX Draft, AI large-file review, or transcription `refine`. AI PDF analysis sends page images; AI large-file review sends file metadata, not file contents.

<img src="https://img.shields.io/badge/RUNTIME-On--demand%20dependencies-2563eb?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="Runtime dependencies on demand" /> **On-demand dependencies**: Existing FFmpeg and LibreOffice installations are reused when possible. Missing runtimes and Whisper models are downloaded as needed, with dependency detection, verification, and mirror selection.

Desktop AI keys are encrypted with Windows DPAPI, and clipboard history stays on the device. Update checks, public version metadata, and dependency downloads still use the network; local-first does not mean the app never connects to the internet.

CLI and MCP require explicit input and output paths by default and do not overwrite existing files. Sensitive inputs such as passwords are not written to logs, JSON output, filenames, or Agent replies.

## Technology stack

ToolKnit 3.0 combines a lightweight desktop container with local file engines. The web app, desktop app, CLI, and MCP share clear input/output boundaries.

<table cellpadding="10" cellspacing="0">
  <tr>
    <td width="22%"><strong>Desktop container</strong></td>
    <td>
      <img src="https://img.shields.io/badge/Tauri-2.x-ffc131?style=for-the-badge&logo=tauri&logoColor=111827" alt="Tauri 2" />
      <img src="https://img.shields.io/badge/Rust-Desktop%20Runtime-dea584?style=for-the-badge&logo=rust&logoColor=111827" alt="Rust" />
      <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
    </td>
  </tr>
  <tr>
    <td><strong>Interface and build</strong></td>
    <td>
      <img src="https://img.shields.io/badge/Vite-Frontend-646cff?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
      <img src="https://img.shields.io/badge/JavaScript-UI%20Logic-f7df1e?style=for-the-badge&logo=javascript&logoColor=111827" alt="JavaScript" />
      <img src="https://img.shields.io/badge/HTML5%20%2B%20CSS3-Interface-e34f26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5 and CSS3" />
      <img src="https://img.shields.io/badge/Canvas%20%2B%20WebGL-Visual%20Effects-111827?style=for-the-badge" alt="Canvas and WebGL" />
    </td>
  </tr>
  <tr>
    <td><strong>Documents and data</strong></td>
    <td>
      <img src="https://img.shields.io/badge/PDF.js-PDF%20Rendering-f04b23?style=for-the-badge" alt="PDF.js" />
      <img src="https://img.shields.io/badge/pdf--lib-PDF%20Editing-334155?style=for-the-badge" alt="pdf-lib" />
      <img src="https://img.shields.io/badge/ExcelJS-XLSX%20Projects-217346?style=for-the-badge" alt="ExcelJS" />
      <img src="https://img.shields.io/badge/Chart.js-Data%20Charts-ff6384?style=for-the-badge" alt="Chart.js" />
      <img src="https://img.shields.io/badge/JSZip-Archive%20Output-475569?style=for-the-badge" alt="JSZip" />
    </td>
  </tr>
  <tr>
    <td><strong>Editing and algorithms</strong></td>
    <td>
      <img src="https://img.shields.io/badge/CodeMirror-6-111827?style=for-the-badge" alt="CodeMirror 6" />
      <img src="https://img.shields.io/badge/Markdown--it-GFM-111827?style=for-the-badge&logo=markdown&logoColor=white" alt="Markdown it" />
      <img src="https://img.shields.io/badge/Mermaid-Diagrams-ff3670?style=for-the-badge" alt="Mermaid" />
      <img src="https://img.shields.io/badge/KaTeX-Math-0f766e?style=for-the-badge" alt="KaTeX" />
      <img src="https://img.shields.io/badge/Noble-Crypto-7c3aed?style=for-the-badge" alt="Noble cryptography" />
    </td>
  </tr>
  <tr>
    <td><strong>Media and runtimes</strong></td>
    <td>
      <img src="https://img.shields.io/badge/FFmpeg-Audio%20%2F%20Video-007808?style=for-the-badge&logo=ffmpeg&logoColor=white" alt="FFmpeg" />
      <img src="https://img.shields.io/badge/Whisper-Offline%20Transcription-111827?style=for-the-badge" alt="Whisper" />
      <img src="https://img.shields.io/badge/LibreOffice-Office%20Rendering-18a303?style=for-the-badge&logo=libreoffice&logoColor=white" alt="LibreOffice" />
      <img src="https://img.shields.io/badge/Three.js-3D%20Effects-000000?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js" />
    </td>
  </tr>
  <tr>
    <td><strong>Automation interfaces</strong></td>
    <td>
      <img src="https://img.shields.io/badge/Node.js-CLI%20Runtime-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
      <img src="https://img.shields.io/badge/CLI-Batch%20processing-7c3aed?style=for-the-badge" alt="CLI" />
      <img src="https://img.shields.io/badge/MCP-Agent%20Tools-7c3aed?style=for-the-badge&logo=githubactions&logoColor=white" alt="MCP Agent tools" />
      <img src="https://img.shields.io/badge/JSON-Inspectable%20Contracts-475569?style=for-the-badge" alt="JSON contracts" />
    </td>
  </tr>
</table>

## Product previews

<p align="center">
  <img src="assets/readme/desktop-v21.png" alt="ToolKnit Desktop custom wallpaper and glass workbench" width="100%" />
</p>

<p align="center"><sub>ToolKnit workbench home · Custom wallpaper · Glass cards · Unified search and category navigation</sub></p>

<p align="center"><strong>ToolKnit.com web version · ready to use</strong></p>
<a href="https://toolknit.com"><img src="assets/readme/web-version.png" alt="ToolKnit.com web version" width="100%" /></a>

<details>
  <summary><strong>View category screenshots</strong></summary>

<p align="center"><sub>Category screenshots use a consistent 1400 x 900 canvas so the preview set stays aligned.</sub></p>

<table cellpadding="8" cellspacing="0">
  <tr>
    <td width="50%" valign="top"><strong>PDF</strong><br /><img src="assets/readme/categories/category-pdf.png" alt="PDF tools" width="100%" /></td>
    <td width="50%" valign="top"><strong>PPT</strong><br /><img src="assets/readme/categories/category-ppt.png" alt="PPT tools" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>AI and content workflows</strong><br /><img src="assets/readme/categories/category-ai.png" alt="AI and content tools" width="100%" /></td>
    <td width="50%" valign="top"><strong>Image</strong><br /><img src="assets/readme/categories/category-image.png" alt="Image tools" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Audio &amp; Video</strong><br /><img src="assets/readme/categories/category-audio-video.png" alt="Audio and video tools" width="100%" /></td>
    <td width="50%" valign="top"><strong>Text</strong><br /><img src="assets/readme/categories/category-text.png" alt="Text tools" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><strong>Hardware</strong><br /><img src="assets/readme/categories/category-hardware.png" alt="Hardware tools" width="100%" /></td>
    <td width="50%" valign="top"><strong>Calculators and other tools</strong><br /><img src="assets/readme/categories/category-calculator.png" alt="Calculator tools" width="100%" /></td>
  </tr>
</table>
</details>

## Download and run

### Use the web version

Open [ToolKnit.com](https://toolknit.com) to start using the web tools without installing anything.

### Install the Windows desktop app

Get Windows installers, release notes, and matching `.sha256` files from [GitHub Releases](https://github.com/ZihangDong/toolknit-desktop/releases). Download only from this repository's Release page and verify the SHA-256 checksum before running the installer.

**Code signing:** The applicable Release notes and [code-signing policy](CODE_SIGNING_POLICY.md) describe each installer's actual signing status and scope.

**System requirements:** Windows 10 1803 (build 17134) or later, or Windows 11, with Microsoft Edge WebView2 Runtime. The installer includes a WebView2 bootstrapper, which needs a network connection to download a missing runtime. Windows 7, 8, 8.1, and older Windows 10 builds are not supported.

### Run from source

```powershell
git clone --branch "ToolKnit-Desktop-V3.0-正式版" --single-branch https://github.com/ZihangDong/toolknit-desktop.git
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run tauri dev
```

Node.js 24 is recommended to match GitHub Actions; Vite 8 requires Node.js `20.19+` or `22.12+`. Native Windows builds also need Rust stable, Visual Studio C++ Build Tools, the Windows SDK, and WebView2. See the [Windows build guide](BUILD.md).

The repository includes source, required resources, tests, and third-party licenses. Local keys, signing credentials, browser sessions, test outputs, and installers must stay out of commits. Signing workflows obtain credentials through GitHub Actions Secrets.

## CLI / MCP / Agent

ToolKnit exposes automation-ready local file capabilities to command-line users, scripts, and MCP-capable IDE Agents. The desktop app handles visual preview and interaction, the CLI handles batch processing, and Agents orchestrate workflows in natural language.

### Install the CLI

```powershell
npm install --global @toolknit/cli
toolknit doctor --json
toolknit --help
```

### Configure MCP

Add the following entry to Trae, Cursor, VS Code, or another MCP-capable client:

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

Core file tools and non-AI PPT tools do not need an AI key. AI Documents, AI Tables, PPT text organization, AI PPT Outline, AI PPTX Draft, and transcription `refine` require `DEEPSEEK_API_KEY` or `TOOLKNIT_AI_API_KEY` in the CLI/MCP process environment.

Full documentation:

- [CLI and MCP contract](toolknit-desktop/docs/cli-agent.md)
- [Chinese Agent guide](toolknit-desktop/docs/agent-guide.zh-CN.md)
- [English Agent guide](toolknit-desktop/docs/agent-guide.en.md)
- [AI document project specification](toolknit-desktop/docs/ai-document-project-spec.md)

## Contributors

ToolKnit's code, documentation, tests, design, and issue reports are built through real collaboration. The avatar wall below reflects GitHub commit contributions; the list also thanks community members who helped with feature discussions, bug reports, reproduction, and planning.

<p align="center">
  <a href="https://github.com/ZihangDong/toolknit-desktop/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=ZihangDong/toolknit-desktop&max=48&columns=12" alt="ToolKnit contributors circular avatar wall" />
  </a>
</p>

<p align="center"><sub>The avatar wall comes from GitHub contribution records; the community list is maintained from public Issue records.</sub></p>

<p align="center"><strong>2.1.0 core contribution:</strong> Thanks to <a href="https://github.com/Joshua-Zion">Joshua-Zion</a> for the color-space conversion core and interaction ideas contributed through <a href="https://github.com/ZihangDong/toolknit-desktop/pull/23">PR #23</a>.</p>

<table cellpadding="12" cellspacing="0">
  <tr>
    <td width="25%" align="center" valign="top"><a href="https://github.com/qazk-lab"><img src="https://avatars.githubusercontent.com/u/295293290?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="qazk-lab" /><br /><sub><strong>qazk-lab</strong></sub></a><br /><sub>Feature ideas · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/1">#1</a> <a href="https://github.com/ZihangDong/toolknit-desktop/issues/2">#2</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/knightkun486"><img src="https://avatars.githubusercontent.com/u/302576851?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="knightkun486" /><br /><sub><strong>knightkun486</strong></sub></a><br /><sub>Feature ideas · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/13">Issue #13</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/lllll081926i"><img src="https://avatars.githubusercontent.com/u/118839342?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="lllll081926i" /><br /><sub><strong>lllll081926i</strong></sub></a><br /><sub>Bug report · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/14">Issue #14</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/xiaobai9009"><img src="https://avatars.githubusercontent.com/u/216056388?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="xiaobai9009" /><br /><sub><strong>xiaobai9009</strong></sub></a><br /><sub>Reproduction help · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/15">Issue #15</a></sub></td>
  </tr>
  <tr>
    <td width="25%" align="center" valign="top"><a href="https://github.com/nicemonkeyzh"><img src="https://avatars.githubusercontent.com/u/142147027?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="nicemonkeyzh" /><br /><sub><strong>nicemonkeyzh</strong></sub></a><br /><sub>Bug report and ideas · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/18">Issue #18</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/komhH12"><img src="https://avatars.githubusercontent.com/u/292717427?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="komhH12" /><br /><sub><strong>komhH12</strong></sub></a><br /><sub>CLI bug analysis · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/20">Issue #20</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/Moessif"><img src="https://avatars.githubusercontent.com/u/83865951?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="Moessif" /><br /><sub><strong>Moessif</strong></sub></a><br /><sub>Bug report and ideas · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/24">Issue #24</a></sub></td>
    <td width="25%" align="center" valign="top"><a href="https://github.com/chengwei69"><img src="https://avatars.githubusercontent.com/u/249917740?v=4&s=160" width="88" height="88" style="border-radius:50%;" alt="chengwei69" /><br /><sub><strong>chengwei69</strong></sub></a><br /><sub>Feature planning · <a href="https://github.com/ZihangDong/toolknit-desktop/issues/19">Issue #19</a></sub></td>
  </tr>
</table>

## Support the project

Keeping ToolKnit free and continuously updated currently costs the author more than CNY 500 per month for AI-assisted development and testing alone, paid out of pocket. Carrying that cost alone is becoming difficult. If ToolKnit helps your work, a one-time donation supports AI testing, compatibility devices, dependency mirrors, documentation maintenance, and future development.

After confirmation, supporters may join the ToolKnit preview group to test upcoming builds and submit feature ideas. The group is for discussion, testing, and collecting requirements; a donation is not a purchase of functionality and does not guarantee implementation or priority.

<p align="center">
  <img src="assets/readme/donation-support.webp" alt="Alipay and WeChat donation QR codes for ToolKnit" width="100%" />
</p>

## Thanks to supporters

<p align="center">
  <img src="assets/readme/supporters-thanks.webp" alt="Thanks to ToolKnit supporters" width="100%" />
</p>

## Star history

<p>The star history chart is provided by <a href="https://star-history.com/#ZihangDong/toolknit-desktop&Date">Star History</a>. Click the chart to open the official history page.</p>

<p align="center">
  <a href="https://star-history.com/#ZihangDong/toolknit-desktop&Date">
    <img src="https://api.star-history.com/chart?repos=ZihangDong/toolknit-desktop&amp;type=date&amp;legend=top-left&amp;sealed_token=EEoF4uyEt78cKNHZvUBEUdT5yBOuWINv90m_TWMMcy6U8sziyyBtrHlNdiHMyYXLcobnnBnywdq7HDcegwIk0Yz4IZQieMCISiRGhbR2JeweVhmBWpGlwQPb1EQB_6ZlH62IB9O1vzTDofo6dhca9fEGaXwNwNbOe5u4ZR4-McXwDHUCSiZ234AMgx3j" alt="ToolKnit GitHub star history from Star History" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/ZihangDong/toolknit-desktop/stargazers"><img src="https://img.shields.io/github/stars/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=GitHub%20Stars&color=f59e0b" alt="GitHub stars" /></a>
  <a href="https://github.com/ZihangDong/toolknit-desktop"><img src="https://img.shields.io/github/last-commit/ZihangDong/toolknit-desktop?style=for-the-badge&logo=github&logoColor=white&label=Last%20Commit&color=475569" alt="Last commit" /></a>
</p>

## Contributing

- Submit a reproducible [bug report](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=bug_report.yml).
- Submit a [feature request](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=feature_request.yml).
- Read the [contribution guide](CONTRIBUTING.md) for development, testing, and pull request workflows.
- Use the [build guide](BUILD.md) to run the desktop app locally.
- Review the [code-signing policy](CODE_SIGNING_POLICY.md) for signing requirements and scope.

## Web product and brand boundary

[ToolKnit.com](https://toolknit.com) is the companion web product, offering a no-install experience and continuously updated online capabilities. This open-source desktop repository focuses on Windows local file processing, CLI, and MCP. The web service, domains, accounts, hosted operations, and other brand assets are outside this repository's open-source license.

## License

ToolKnit Desktop and the CLI/MCP source code are released under the [Apache License 2.0](LICENSE).

The license does not grant rights to the ToolKnit name, logos, visual identity, domains, official website, hosted web services, service accounts, or other independently operated products. See [NOTICE](NOTICE).

<p align="center">
  <sub>ToolKnit Desktop 3.0 · Local-first tools for real work</sub>
</p>
