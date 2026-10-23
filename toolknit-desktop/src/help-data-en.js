export const HELP_CONTENT_EN = {
  'image-to-pdf': {
    title: 'Images to PDF',
    html: `<div class="help-doc"><h2>Images to PDF</h2><p>Combine images into one PDF, with optional scanned appearance. Processing stays local and requires no AI, Office or extra model.</p>
      <h3>Inputs and order</h3><p>JPG, PNG, BMP, WebP, GIF and TIFF are supported. Inputs are naturally sorted by name; later additions append without changing your order. Drag the page handle, or focus it and press Up/Down, to reorder. Rotate or delete the selected page. GIF and animated WebP use the first frame; the desktop app expands multi-page TIFF. Unreadable files must be removed before export so pages are not silently omitted.</p>
      <h3>Page size and appearance</h3><p>A4 follows image orientation or uses portrait or landscape. Images are centered without cropping, with 0, 8 or 15 mm margins. Original size reads valid physical resolution from PNG, JPEG, WebP, BMP and TIFF, falling back to 96 DPI. Transparent areas become white. Choose High, Balanced or Small quality; source resolution still limits detail. Color and Grayscale preserve the image; Scanned adds subtle paper color, noise and skew while retaining all edges. Results are image-only PDFs without OCR text.</p>
      <h3>Output and limits</h3><p>Desktop output uses a unique name under Image_PDF in the configured output directory. Open the PDF or reveal it in its folder after saving. Limits: 100 pages, 64 MiB per input, 256 MiB total, 40 million pixels per image, 32768 pixels per side, and 100 MiB output. Cancellation retains previously added images; final publication cannot be reversed. Browsers do not decode TIFF and export through browser downloads.</p></div>`
  },
  'pdf-to-word': {
    title: 'PDF to Word',
    html: `<div class="help-doc"><h2>PDF to Word</h2><p>Convert native Chinese, English and mixed PDFs into editable DOCX locally. No Python, Office or additional model is required. Originals are unchanged; desktop results use unique filenames in the PDF_Word output folder.</p><h3>Workflow</h3><p>Choose a PDF, enter its password if needed, select pages and layout, then analyze. Review structural overlays and warnings, optionally adjust a page to a single column or retain headers as body content, and export.</p><h3>Scope</h3><p>Paragraphs, headings, headers, footers, ruled tables, answer grids and columns are reconstructed. Scanned pages are not OCRed. Complex content requires confirmation before being retained as non-editable images. Font availability and Office applications can affect wrapping and pagination.</p><h3>Optional AI</h3><p>Selecting AI assisted export sends visible region crops and text to your configured image-capable service, prioritizing the current page and uncertain regions. Each export permits up to 8 requests within a 90-second budget. Validated regions can be reused during the current file session; results show reviewed, remaining and reused counts. AI cannot rewrite source text or cross existing table and column boundaries. Unreviewed formula proposals retain the original formula images. Errors are visible and local export remains available. The structure preview is not a Word renderer.</p><h3>Limits</h3><p>One PDF up to 64 MiB and 300 source pages; up to 100 selected pages and 64 MiB output per conversion. Additional image and text complexity limits apply. Cancellation or closing stops work and removes incomplete output; a file already atomically published remains. Complex clipping is retained as visible images. Signatures, active forms, attachments and external links are not preserved as active objects.</p></div>`
  },
  'recording-mode': {
    title: 'One-click Recording Mode',
    html: `<div class="help-doc"><h2>One-click Recording Mode</h2><p>Enable this mode from the home prompt or Settings to turn on Windows startup, live clipboard monitoring and floating screenshot history together. The mode is on only when all three actual settings are on. Pausing any one of them updates the mode status.</p>
      <h3>Enable, disable and launch</h3><p>Enabling saves your previous three settings. Disabling restores them without deleting clipboard records, screenshots or files. Without a saved snapshot, disabling turns all three off. If enabling fails, the app attempts to restore settings changed by that operation and reports the failure; check the actual state.</p><p>Windows startup uses the current user's configuration and normally needs no administrator access. Startup launches into the system tray; its menu can toggle startup and recording. Enabling clipboard monitoring also resumes it at the next launch; pausing disables resume. This mode does not change screenshot shortcuts, AI credentials or excluded applications.</p>
      <h3>Screenshots and history</h3><p>Alt+Q starts capture by default; change or disable it on the Quick Screenshot page in Creative tools. Floating history has a draggable round Logo: click to expand, then click a thumbnail to open a pinned viewer. The floating window shares encrypted clipboard history, with image, text and file filters and full timestamps. Defaults are 7 days, 2000 records and 256 MB. Monitoring captures copies from other applications; enabling the window alone does not enable monitoring. Right-click to hide until ToolKnit restarts or turn off the window.</p>
      <p>The floating window shows the first 20 records in its saved order. Search scans all retained content, sources, file paths and notes, returning the first 20 matches. Drag a card's small grip to save its position. New records enter at the top; the bottom record leaves the floating view but stays in full history. The bottom switch controls recording and the bar tracks scrolling. Right-click to edit a history note, view, copy or confirm deletion from shared history, never original files. The menu can restore the main app.</p>
      <p>Use the top-right switch beside the menu to open saved phrases. A phrase only needs a title and content. Search updates as you type; click to copy, right-click to edit or delete, and use the grip to reorder. Successful copies show a white capsule at the bottom center of the primary display. Phrase content, history text and original images can be dragged to applications that accept them. Image dragging supplies the original PNG file; acceptance depends on the target application and never sends a message automatically. Text history can be saved as a phrase, with duplicates detected. Phrases remain independent of history expiry, clearing and the 20-item view. Each mode keeps its search and scroll position. Phrases are encrypted locally, limited to 2000 items and 16 MiB, with 64 KiB per text. Capacity limits ask for manual cleanup instead of deleting old phrases.</p>
      <h3>Why can OCR be inaccurate?</h3><p>Local OCR uses installed Windows recognition language packs and needs no AI. Small text, blur, complex layouts and mixed languages can cause mistakes. Capture clear text and check your Windows OCR language packs. Review both recognition and translation results.</p><p>For AI extraction, configure the service URL, API key and an image-capable model under AI in Settings. Clicking AI extraction sends the selected region. Unsupported models produce an error; there is no extra vision-confirmation step.</p>
      <h3>Screenshot translation: OCR and AI paths</h3><p>Install the local Chinese/English translation models from Settings first. Targets are Chinese and English only. Missing or unavailable models block translation with an installation prompt.</p><p>Without configured AI: local OCR, then local translation. With configured AI and a key: local OCR locates text, AI corrects recognition, then local models translate it. AI may improve recognition but depends on the model and network; better accuracy or speed is not guaranteed. On AI failure, you must explicitly confirm using the original OCR result.</p><p>Translated text overlays the source text and supports undo. Double-click to edit or copy it. Local model installation does not configure AI, and recording mode never installs models, sends images or invokes AI automatically.</p>
      <h3>Home prompt and privacy</h3><p>The prompt is hidden while the mode is on and appears at each launch otherwise. Close dismisses it for this launch; Never show again persists. Settings always provides the mode switch.</p><p>Pause monitoring before copying passwords or private content, or exclude applications. Not all applications mark sensitive clipboard content. Local OCR and translation do not upload content; only explicit AI actions send necessary screenshot regions to your configured service.</p></div>`
  },
  'quick-screenshot': {
    title: 'Quick Screenshot',
    html: `<div class="help-doc"><h2>Quick Screenshot</h2><p>Find it in Creative tools. On Windows desktop, Alt+Q starts capture by default. Change or disable the shortcut on the tool page. Capture a detected window or drag a region, with green selection borders and a pixel/color magnifier.</p>
      <h3>Annotations and output</h3><p>Add rectangles, ellipses, arrows, freehand strokes, mosaics and text. Select, move or resize annotations; double-click text to edit. Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes; Delete removes; arrow keys move by one pixel, or 10 with Shift. Ctrl+S saves, Ctrl+C copies, Enter confirms and Escape cancels the current operation or capture.</p><p>PNG/JPG files use unique names in the Screenshots output subdirectory. The success dialog can reveal the result in Explorer. Pinned viewers support zoom, dragging, save and copy.</p>
      <h3>Floating history and saved phrases</h3><p>Off by default; click the draggable round Logo to expand. Images open at full quality in a pinned viewer. The first 20 records follow the saved order; drag a card grip to reorder. New records enter at the top, and the bottom record leaves the floating view while full history remains intact. Search scans retained content, sources, file paths and notes. Right-click to edit a history note, view, copy or confirm deletion from shared history, never original files. The bottom switch controls recording. The menu opens the main app or Clipboard History, hides until restart or turns off the window.</p><p>Saved phrases are an independent encrypted collection with just a title and content. Create, edit, search, copy, reorder or delete; only text history can be imported. Copies show a white capsule at the bottom center of the desktop. Drag text or a history image into an application that accepts it; images use the original PNG file and dropping never sends a message automatically. History expiry or clearing does not delete phrases. Each mode keeps its search and scroll position. Limits are 2000 phrases / 16 MiB, 64 KiB per text and 256 bytes per title. Over-limit writes preserve existing data. Searching history image notes does not run OCR.</p>
      <h3>OCR and AI</h3><p>Local OCR uses installed Windows OCR language packs and needs no API Key. AI extraction sends the selected region only when requested, using your configured image-capable model. Screenshot translation requires local Chinese/English models installed in Settings: configured AI and a key enable recognition correction before local translation; otherwise local OCR feeds local translation. AI failure requires confirmation to use OCR. Translation overlays support undo; double-click to edit or copy and review the results.</p>
      <h3>Limits</h3><p>System capture and global shortcuts require Windows desktop; the browser only previews the UI. Each image is limited to 32 million pixels and 32 MiB of encoded data. Viewers share a 64 MiB budget with at most 8 windows. History uses clipboard retention and capacity settings, with a 20 MiB limit for each image record. Protected or special GPU content may not capture. Native OCR, save and copy cannot be interrupted once dispatched; closing prevents late results from updating the UI.</p></div>`
  },
  'duplicate-file-cleanup': {
    title: 'Clean Duplicate Files',
    html: `<div class="help-doc"><h2>Clean Duplicate Files</h2><p>Choose one folder or all allowed folders on fixed drives. All 42 common document, image, audio, video and archive extensions are selected initially; adjust individual types or select/clear all. Scanning requires at least one type. Empty and unselected files are filtered before size grouping, head/tail sampling, full SHA-256 hashing and byte comparison. Only exact contents match, even across different names or selected extensions. No similar-image matching, AI or uploads.</p><h3>Review and recycle</h3><ol class="help-steps"><li>Choose scope and types, then start scanning. The loading animation has local quotes; status shows actual stages, read volume and elapsed time.</li><li>Groups are sorted by potential cleanup size. Expand groups to review files, search names or paths, browse pages, or reveal and select a file in Explorer.</li><li>All copies are kept initially. Click a file status button to toggle Kept / To recycle. Keep an entire group or keep one and select its extras; global actions cover all groups, including filtered or paginated results. Each group allows at most N-1 cleanup selections; selecting the last retained copy is blocked with a notification. The initial reference for bulk selection is the oldest modified copy, which is only a suggestion.</li><li>Confirm recycling. The native backend rechecks scan records, keepers and contents. Changed files are rejected; unsuccessful items appear in the result dialog.</li></ol><h3>Limits</h3><p>Windows desktop only. System/application folders, registered installation locations, AppData, caches, development dependencies, empty files, cloud placeholders, readonly/hidden/system files and links are skipped. Folder mode blocks the system drive root. Directory entries do not impose a cutoff. Scans record at most 100000 files matching selected types; result capacity is 100000 duplicate files. Limits show their specific reason and partial results after scanning ends; they do not mean all folders were scanned. Sessions expire after 30 minutes; rescan expired or changed files.</p><p>Browser preview cannot scan local disks. Closing or cancelling stops subsequent work; files already recycled remain in the Recycle Bin and can be restored there. Recycling does not immediately release disk space.</p></div>`
  },
  'pdf-to-scan': {
    title: 'PDF to Scanned PDF',
    html: `<div class="help-doc"><h2>PDF to Scanned PDF</h2><p>Render PDF pages into images and assemble a new scanned PDF entirely on your computer. No AI or API key is required, and the source stays unchanged.</p><h3>Select and preview</h3><ol class="help-steps"><li>Select or drop one PDF; unlock encrypted documents in the temporary password dialog</li><li>Select pages or apply ranges such as 1-3, 5; export keeps source order</li><li>Choose faithful, grayscale or natural scanning; compare original and effect previews or expand the preview</li><li>Choose 150, 200 or 300 DPI; natural mode offers grain, paper warmth and slight skew</li><li>Export, then inspect file details in the result dialog; desktop users can reveal and select the result in its folder</li></ol><h3>Limits and content changes</h3><p>Up to 64 MB and 100 pages per input, 16 million pixels and 8192 pixels per side per page, and 100 MB per output. Lower DPI, select fewer pages or split oversized inputs.</p><p>Conversion removes selectable text, interactive links, forms and existing digital signatures. A visible signature image does not retain signature validity. OCR can still recognize images; conversion is not redaction or copy protection. Faithful mode also rasterizes and JPEG-compresses content.</p><p>Visible page dimensions and orientation are preserved. Desktop results use unique names in the configured output directory under PDF_Scan; browsers download locally. Processing can be cancelled until final atomic publication; closing the tool during that final stage may still save a valid file.</p></div>`
  },
  'clipboard-history': {
    title: 'Clipboard History',
    html: `<div class="help-doc"><h2>Clipboard History</h2><p>Enable monitoring in the Windows desktop app to capture subsequent copies of text, images and file paths. Existing clipboard content and Win+V history are not imported.</p><h3>Timeline and reuse</h3><p>Search content or source apps and filter by type, date or favorites. Details show the observation timestamp, milliseconds, capture timezone, source and size. Unknown sources are not guessed. Files are stored as paths only; copying them never restores a cut operation.</p><h3>Background and privacy</h3><p>Recording continues on other pages and in the tray. Pausing or quitting stops it. Monitoring is off on first use. Enabling it automatically resumes it at the next launch; pausing also disables resume. Content is encrypted locally and is not uploaded.</p><p>Defaults: 7 days, 2000 records and 256 MB. Favorites do not expire; recording pauses when they fill the limit. Clearing history keeps favorites by default and does not clear the system clipboard or delete original files.</p><p>Application privacy markers and process-name exclusions are respected. Not all sensitive data is marked: pause before copying it. Rapid updates, busy clipboards and unsupported formats can be missed; skipped and failed counts remain visible. Browser previews cannot monitor the system clipboard.</p></div>`
  },
  'overview': {
    title: 'Overview',
    html: `<div class="help-doc">
      <h2>ToolKnit Overview</h2>
      <p>ToolKnit 3.2 is a <strong>local-first</strong> Windows toolbox with 73 desktop tools in the current test catalog across 12 categories and 77 capabilities exposed to IDE Agents through CLI / MCP. Basic file processing stays local; AI tools send the necessary content to your selected provider only when explicitly invoked.</p>
      <p>V3.1 has been released with PDF to Scanned PDF, Clean Duplicate Files and Quick Screenshot. This is the V3.2 development version; npm publication is planned with V3.2.</p>

      <h3>Tool Categories</h3>
      <div class="help-tool-grid">
        <div class="help-tool-card"><div class="help-tool-card-name">PDF Tools</div><div class="help-tool-card-desc">Create and edit, merge, split, add page numbers, export images or Word, create scanned PDFs, images to PDF, local text to Markdown, AI PDF to Markdown, rotate, encrypt, decrypt, compress, enhance text, and Excel to PDF</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">PPT Tools</div><div class="help-tool-card-desc">PDF/image export, asset and text extraction, compression, AI outlines and monochrome drafts</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Image Tools</div><div class="help-tool-card-desc">Conversion, compression, stitching, icon generation, image and screen color picking</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Audio Tools</div><div class="help-tool-card-desc">Format conversion, BPM detection, clipping, video audio extraction</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Video Tools</div><div class="help-tool-card-desc">Format conversion, full-resolution frame export, GIF clips up to 30 seconds</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Text Tools</div><div class="help-tool-card-desc">Audio/video transcription, teleprompter, text statistics, text formatting</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Calculator</div><div class="help-tool-card-desc">Body fat, timestamp, mortgage, interest, password generation</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Creative Tools</div><div class="help-tool-card-desc">Quick Screenshot, color extraction, color-space comparison, typing test</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Cleanup Tools</div><div class="help-tool-card-desc">Large-file scanning, AI metadata suggestions, Recycle Bin cleanup</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Hardware and System Tools</div><div class="help-tool-card-desc">Read-only system, CPU, memory, GPU, board, disk, network, and sensor info; opt-in clipboard history monitoring</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">AI Tools</div><div class="help-tool-card-desc">AI PDF to Markdown, polish, translate, editable documents and tables</div></div>
      </div>

      <h3>Key Features</h3>
      <ul>
        <li><strong>Local-first processing</strong>: Source files stay on the device; only an explicitly invoked AI tool sends the required text, metadata or page images to your selected provider</li>
        <li><strong>Batch Processing</strong>: Support for batch file processing to boost productivity</li>
        <li><strong>Drag & Drop</strong>: Drag files directly onto tool pages for instant processing</li>
        <li><strong>Bilingual Interface</strong>: Supports Chinese and English switching</li>
        <li><strong>Flexible delivery</strong>: Use the desktop UI, CLI, or IDE Agent for the task that fits your workflow</li>
        <li><strong>On-demand runtimes</strong>: FFmpeg, Whisper speech models, and LibreOffice are installed only when a related tool needs them</li>
      </ul>

      <div class="help-note">
        <p>AI polish, translation, documents, tables, PPT AI, and transcription refinement send required text to your configured provider. AI Cleanup sends candidate metadata only. Runtime downloads, public GitHub project data, and external links also need network access; other local processing can work offline.</p>
      </div>
    </div>`
  },

  'install': {
    title: 'Install & Launch',
    html: `<div class="help-doc">
      <h2>Install & Launch</h2>

      <h3>System Requirements</h3>
      <ul>
        <li>OS: Windows 10/11 (64-bit)</li>
        <li>RAM: 4GB or more recommended</li>
        <li>Disk Space: Reserve at least 200 MB for the base app; optional runtimes use additional space</li>
        <li>Web runtime: Microsoft Edge WebView2 (normally present on Windows 10/11)</li>
      </ul>

      <h3>Installation Steps</h3>
      <ol class="help-steps">
        <li>Download the ToolKnit installer (<code>.exe</code> setup program)</li>
        <li>Double-click the installer and choose the installation path</li>
        <li>Wait for installation to complete — a ToolKnit shortcut will appear on your desktop</li>
        <li>Double-click the shortcut to launch the app</li>
      </ol>

      <h3>First Launch</h3>
      <p>No optional component is forced on first launch. Related tools prompt for an on-demand install: FFmpeg is about 29 MB, the recommended Whisper Small model about 465 MB, and the LibreOffice download about 356 MB. After download reaches 100%, verification, extraction, or installation may still be running.</p>

      <div class="help-note">
        <p>FFmpeg, Whisper, and LibreOffice support Auto, Official, or China mirror sources. LibreOffice powers Excel to PDF, PPT to PDF, and PPT to Image. A rare offline Windows installation without WebView2 must go online once to install Microsoft Edge WebView2 Runtime.</p>
      </div>
    </div>`
  },

  'settings': {
    title: 'Settings & Preferences',
    html: `<div class="help-doc">
      <h2>Settings & Preferences</h2>
      <p>Use the <strong>Settings button</strong> on the right side of the top navigation bar from any page. These app-level settings do not alter source files.</p>

      <h3>Language Switching</h3>
      <p>Supports <strong>Chinese</strong> and <strong>English</strong>. The interface updates instantly upon switching.</p>

      <h3>AI Key</h3>
      <p>DeepSeek, OpenAI, Qwen, Moonshot, and custom OpenAI-compatible endpoints are supported. AI Document, AI Table, AI Polish, AI Translate, PPT AI, AI Cleanup review, and optional transcription refinement need a key. Keys stay on this device and are sent only to the selected provider.</p>

      <h3>Offline Transcription Models</h3>
      <p>Audio & Video to Text needs one local model before first use. <strong>Small</strong> is the default recommendation; Base is smaller and faster, while Medium prioritizes quality. Recognition works offline after download. Only optional AI refinement sends recognized text to your provider; media is never uploaded.</p>

      <h3>FFmpeg Runtime</h3>
      <p>Audio conversion, clipping, audio extraction, video conversion, frame export, GIF export, and transcription preparation require FFmpeg. It is no longer bundled into the installer. Install it from Auto, Official, or China mirror here, or accept the dependency prompt when entering a supported tool.</p>

      <h3>LibreOffice Runtime</h3>
      <p>LibreOffice powers Excel to PDF, PPT to PDF, and PPT to Image. Choose Auto, Official, or China mirror; after download, allow verification and extraction to finish. Conversion then works offline.</p>

      <h3>Window, Sound, and Shortcut</h3>
      <p>Configure resize behavior and small, large, or custom corner radius. Maximized windows remove rounding and cover the screen; rounding returns after restore. Global sounds have a master switch and three styles. Screen Color Picker defaults to <code>Ctrl+Shift+C</code>, can be customized or reset, minimizes the main window while picking, and returns the selected color to the Color Extractor.</p>

      <h3>Default Storage Location</h3>
      <p>The default is <strong>ToolKnit in Downloads</strong>. You can choose any existing folder. Outputs are grouped automatically under tool-specific subfolders such as <code>PDF_Merge</code>, <code>PDF_Split</code>, <code>Images</code>, <code>Videos</code>, <code>Transcripts</code>, <code>AI_Doc</code>, and <code>AI_Table</code>; source files are not overwritten.</p>

      <h3>Help & Feedback</h3>
      <p>Help Center includes tool guidance, FAQs, the Program Notice, and Usage Policy. Feedback opens the project's issue channel.</p>
    </div>`
  },

  'cli-guide': {
    title: 'CLI Basics',
    html: `<div class="help-doc">
      <h2>CLI Basics</h2>
      <p>Use the <strong>desktop app</strong> for visual selection and preview, the <strong>CLI</strong> for PowerShell and scripts, and an <strong>IDE Agent</strong> when you prefer natural language. The CLI does not need the desktop app to stay open.</p>
      <h3>Install and check</h3>
      <ol class="help-steps"><li>Install Node.js <code>22.13.0+</code>, then run <code>npm install --global @toolknit/cli</code>. Until V3.2 is published to npm, use its local test archive.</li><li>Run <code>toolknit doctor</code> to check the environment and optional runtimes.</li><li>Run <code>toolknit --help</code> for every command group.</li><li>Use <code>toolknit help &lt;group&gt; &lt;tool&gt;</code> for parameters and examples, such as <code>toolknit help video gif</code>.</li></ol>
      <h3>Command groups</h3>
      <ul><li><code>pdf</code>: inspect, merge, selected-page split, export images, rotate, encrypt, decrypt, compress, and scan enhancement.</li><li><code>ppt</code>: convert to PDF or images, extract assets or text, compress, generate an AI outline, and create an editable PPTX draft.</li><li><code>hardware</code>: read-only system, CPU/memory, GPU, board, storage, network/device, and power/sensor views.</li><li><code>audio</code>: format conversion, BPM, clipping, and audio-track extraction.</li><li><code>model</code> and <code>transcribe</code>: local speech-model management plus TXT, SRT, and JSON transcription.</li><li><code>video</code>: conversion, exact frame export, and GIF clips up to 30 seconds.</li><li><code>text stats</code>, <code>image colors</code>, and <code>image stitch</code>: local analysis and long-image stitching.</li><li><code>ai-doc</code> and <code>ai-table</code>: create, inspect, edit, undo, and render editable projects.</li></ul>
      <h3>Safe defaults</h3>
      <p>V3.2 adds <code>pdf to-word</code>, <code>image to-pdf</code>, <code>excel to-pdf</code>, PDF page/text operations, image processing, <code>text format</code>, <code>dev</code>, <code>calculate</code>, <code>color</code>, AI text/vision operations, read-only <code>files</code> scans and <code>markdown html</code>. Use <code>tools list</code>, <code>tools describe</code> and <code>tools coverage</code> for discovery; <code>run</code> accepts explicit JSON arguments.</p>
      <p>Every write command needs an explicit destination. Existing files are never replaced unless you pass <code>--overwrite</code>. Passwords are not accepted as command-line arguments. JSON, piped output, and MCP mode do not include the decorative CLI banner.</p>
      <h3>Connect an IDE Agent</h3>
      <p>Run the MCP server with <code>toolknit mcp serve</code>. Configure the V3.2 CLI in an MCP-compatible IDE to expose 77 capabilities; the desktop app does not need to remain open.</p>
      <div class="help-note"><p>Desktop and CLI/Agent use separate AI-provider configuration. AI documents/tables, AI PPT operations, polishing, translation, visual PDF Markdown and explicitly enabled Word layout assistance or transcription refinement require a key. Ordinary local tools do not require a key or silently switch to AI.</p></div>
    </div>`
  },

  'update': {
    title: 'Version Updates',
    html: `<div class="help-doc">
      <h2>Version Updates</h2>
      <p>Settings shows the installed desktop version. The current release flow does not silently download or force-install updates in the background.</p>
      <ol class="help-steps"><li>Check GitHub Releases or the project release page for the new installer and release notes.</li><li>Close the main window, then choose Exit from the ToolKnit tray menu.</li><li>Run the new installer to perform an in-place upgrade.</li><li>Restart ToolKnit and verify the version in Settings.</li></ol>
      <div class="help-note"><p>Desktop settings, downloaded FFmpeg, and offline models are stored in local app data. Whether they remain depends on whether you choose to clear app data during uninstall.</p></div>
    </div>`
  },

  'pdf-merge': {
    title: 'PDF Merge',
    html: `<div class="help-doc">
      <h2>PDF Merge</h2>
      <p>Merge multiple PDF files into one, in the order you specify.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Click "PDF Merge" in the PDF tools category</li>
        <li>Click "Upload PDF Files" or drag files onto the page</li>
        <li>Drag files to reorder the merge sequence</li>
        <li>Click the "Start Merge" button</li>
        <li>Wait for processing to complete — a success prompt appears and you can open the save folder</li>
      </ol>

      <h3>Notes</h3>
      <ul>
        <li>All files must be in PDF format</li>
        <li>Merge order follows the list arrangement</li>
        <li>After processing, files are saved to the default storage location</li>
      </ul>
    </div>`
  },

  'pdf-split': {
    title: 'PDF Split',
    html: `<div class="help-doc">
      <h2>PDF Split</h2>
      <p>Preview every PDF page, select the pages to export, and create a separate PDF for each page.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload the PDF file you want to split</li>
        <li>Click "Start Split" to generate page previews</li>
        <li>Click pages to select or deselect them, or export one page directly</li>
        <li>Click "Export Selected Pages" and find the files in the output folder</li>
      </ol>

      <div class="help-note">
        <p>Every output file contains one original page. Each run accepts up to 25 files, 150 MB of input, and 200 preview pages.</p>
      </div>
    </div>`
  },

  'pdf-page-number': {
    title: 'Add PDF Page Numbers',
    html: `<div class="help-doc">
      <h2>Add PDF Page Numbers</h2>
      <p>Expand one multi-page PDF or several PDFs into one page sequence, preview the final numbering, then export one merged PDF or a ZIP containing one PDF per page.</p>
      <h3>Manage Pages</h3>
      <ol class="help-steps">
        <li>Click “Add PDFs” or drag files onto the tool. One session accepts up to 25 files, 150 MB, and 200 pages</li>
        <li>Click a page to preview it and use checkboxes, Ctrl, or Shift to select multiple pages</li>
        <li>Drag the handle on a page to set final order, or remove individual and selected pages; at least one page always remains</li>
        <li>Use “Undo deletion” to restore the page sequence from immediately before the latest deletion</li>
      </ol>
      <h3>Numbering and Export</h3>
      <ul>
        <li>Apply numbering to all, odd, even, custom-range, or selected pages, with an option to skip cover pages</li>
        <li>Use continuous numbering or restart for each source file, then choose a start value, step, and text template</li>
        <li>Choose a nine-position anchor, fine offsets, and text, circle, pill, label, or bar styling</li>
        <li>Export one merged PDF in the order shown on the left, or create individual page PDFs in a ZIP archive</li>
      </ul>
      <div class="help-note"><p>Page numbers are written as vector PDF content, so source pages are not rasterized. Decrypt protected files first with PDF Decrypt. Source files stay unchanged and never leave this device.</p></div>
    </div>`
  },

  'pdf-crop': {
    title: 'PDF Crop',
    html: `<div class="help-doc">
      <h2>PDF Crop</h2>
      <p>Draw the area to keep on each page or enter exact margins, then export one multi-page PDF or a ZIP containing one PDF per page. The tool accepts one PDF at a time and never modifies the source file.</p>
      <h3>Crop Areas and Scope</h3>
      <ol class="help-steps">
        <li>Click “Choose PDF” or drag one PDF onto the tool, then use the bottom thumbnails to switch pages</li>
        <li>The default “All Pages” scope applies the same normalized crop rectangle to every page after you draw or adjust it</li>
        <li>Switch to “Current Page” when a drag, move, or eight-handle resize should affect only the page in the preview</li>
        <li>Draw directly on an uncropped page, or choose “Draw Again” before replacing an existing crop area</li>
      </ol>
      <h3>Exact Adjustments and Export</h3>
      <ul>
        <li>Enter top, right, bottom, and left margins in millimeters or PDF points, with optional linked values</li>
        <li>Reset only the current page or every page; Undo and Redo retain the most recent crop history</li>
        <li>Export one multi-page PDF in original order, or create individual page PDFs in a ZIP archive</li>
        <li>Zooming, fitting the preview, and changing pages never change crop state</li>
      </ul>
      <div class="help-note"><p>Cropping changes PDF page bounds without rasterizing page content. It is not secure redaction because out-of-bounds content may remain in the file structure. Use a true redaction tool for sensitive information. Each run supports one PDF up to 150 MB and 500 pages; decrypt protected PDFs first.</p></div>
    </div>`
  },

  'pdf-to-image': {
    title: 'PDF to Image',
    html: `<div class="help-doc">
      <h2>PDF to Image</h2>
      <p>Choose pages from one PDF and export them as individual images, or combine them into high-resolution long images in original page order. Reading, rendering, and writing all happen locally; the source file is never uploaded to a server.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Click "Upload PDF File", or drag one PDF onto the tool page</li>
        <li>Click real page thumbnails to select or clear pages, or use Select All</li>
        <li>Choose PNG, JPG, or WebP, then choose the required clarity preset</li>
        <li>Click "Export Images" to save every selected page as a separate image</li>
        <li>Click "Export Long Images" to combine selected pages in page-number order</li>
        <li>When the completion dialog appears, review the output count and path or click "Open Folder"</li>
      </ol>

      <h3>Clarity Presets</h3>
      <ul>
        <li><strong>Standard (144 DPI):</strong> smaller output for screen reading and everyday sharing</li>
        <li><strong>High (200 DPI):</strong> the default balance between detail and file size</li>
        <li><strong>Print (300 DPI):</strong> for enlarged text, detailed charts, and later printing</li>
      </ul>

      <h3>Long-image Grouping</h3>
      <p>A long-image export accepts up to 20 selected pages and prefers groups of five. For example, 16 selected pages normally produce four files containing pages 1-5, 6-10, 11-15, and page 16. If a group would exceed the safe dimension or memory limit at the chosen clarity, ToolKnit automatically uses smaller groups instead of shrinking the original pages simply to force them into one image.</p>

      <div class="help-note">
        <p>Each run accepts one PDF up to 150 MB and 200 pages. Use PDF Decrypt first for password-protected files. You can cancel an export while it is running; ToolKnit removes unfinished temporary files.</p>
      </div>
    </div>`
  },

  'pdf-text-markdown': {
    title: 'PDF Text Extraction / Markdown',
    html: `<div class="help-doc">
      <h2>PDF Text Extraction / Markdown</h2>
      <p>Read the embedded text layer from an electronic PDF, rebuild page reading order, and generate Markdown. Everything is parsed locally without modifying or uploading the source file.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Choose one PDF that contains selectable text</li>
        <li>Review the page and file details, then click “Extract Markdown”</li>
        <li>Wait while headings, paragraphs, lists, and basic tables are reconstructed page by page</li>
        <li>Choose “Open in Markdown Editor” to preview, edit, copy, or export the generated .md document</li>
      </ol>

      <h3>Output and Limits</h3>
      <ul>
        <li>Each page keeps a source-page comment so you can trace content back to the original PDF</li>
        <li>Switch source pages in the result preview, showing up to 2,000 characters per page. The editor receives the complete document. Reset clears the current result.</li>
        <li>Two-column layouts, rotated pages, and complex tables are reconstructed on a best-effort basis from PDF text coordinates</li>
        <li>Each run accepts one PDF up to 150 MB, 300 pages, and 2 million extracted characters</li>
      </ul>

      <div class="help-note">
        <p>Scanned or image-only PDFs have no text layer, so this tool will not create an empty Markdown document. Use the AI vision version for page-by-page recognition instead.</p>
      </div>
    </div>`
  },

  'pdf-rotate': {
    title: 'PDF Rotate',
    html: `<div class="help-doc">
      <h2>PDF Rotate</h2>
      <p>Rotate page orientation in a PDF. Supports single-page and bulk rotation.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload a PDF file</li>
        <li>Choose rotation angle: 90°, 180°, 270°</li>
        <li>Choose rotation scope: all pages or specific pages</li>
        <li>Click "Start Rotate", then download the result after completion</li>
      </ol>

      <div class="help-note">
        <p>Each run accepts one PDF up to 150 MB and 200 preview pages. Unlock password-protected PDFs with PDF Decrypt first.</p>
      </div>
    </div>`
  },

  'pdf-encrypt': {
    title: 'PDF Encrypt',
    html: `<div class="help-doc">
      <h2>PDF Encrypt</h2>
      <p>Add password protection and permission controls to a PDF file.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload the PDF file you want to encrypt</li>
        <li>Set an opening password with at least 8 characters</li>
        <li>Choose permissions for printing, copying, and modifying</li>
        <li>Click "Confirm Encrypt" and find the encrypted PDF in the output folder</li>
      </ol>

      <div class="help-note">
        <p>Each run accepts one PDF up to 150 MB and 200 pages. Keep the password safe because lost passwords cannot be recovered; unlock an already encrypted PDF with PDF Decrypt first.</p>
      </div>
    </div>`
  },

  'pdf-decrypt': {
    title: 'PDF Decrypt',
    html: `<div class="help-doc">
      <h2>PDF Decrypt</h2>
      <p>Remove password protection and usage restrictions from a PDF file.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload the encrypted PDF file</li>
        <li>Enter the correct password</li>
        <li>Click "Start Decrypt"</li>
        <li>Download the decrypted PDF after completion</li>
      </ol>

      <div class="help-note">
        <p>Decryption requires the original password. PDFs with unknown passwords cannot be cracked. Each run accepts one PDF up to 150 MB and 200 pages; leave the password blank if the file only has permission restrictions.</p>
      </div>
    </div>`
  },

  'pdf-compress': {
    title: 'PDF Compress',
    html: `<div class="help-doc">
      <h2>PDF Compress</h2>
      <p>Reduce PDF file size with three compression levels.</p>

      <h3>Compression Levels</h3>
      <ul>
        <li><strong>Low</strong>: Light compression, minimal quality loss</li>
        <li><strong>Medium</strong>: Balanced compression, recommended for most scenarios</li>
        <li><strong>High</strong>: Maximum compression, smallest size with some quality loss</li>
      </ul>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload one or more PDF files</li>
        <li>Select the compression level</li>
        <li>Click "Start Compress"</li>
        <li>View compression results after processing, with option to open the folder</li>
      </ol>
    </div>`
  },

  'pdf-enhance': {
    title: 'PDF Text Enhancer',
    html: `<div class="help-doc">
      <h2>PDF Text Enhancer</h2>
      <p>Improve the readability of blurry text in scanned and image-based PDFs with contrast and sharpening.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload the PDF file you want to enhance</li>
        <li>Choose light, medium, or strong enhancement</li>
        <li>Click "Start Enhancing" and wait for processing to finish</li>
        <li>Locate the enhanced PDF from the result</li>
      </ol>

      <div class="help-note">
        <p>This feature rasterizes pages, so searchable text, links, and forms are not preserved. Use it only for scanned or image-based PDFs; results depend on the original scan quality.</p>
      </div>
    </div>`
  },

  'pdf-editor': {
    title: 'PDF Editor',
    html: `<div class="help-doc">
      <h2>PDF Editor</h2>
      <p>A lightweight PDF editor: replace text, insert text, images or shapes, reorder, rotate, extract and append pages — all processed locally.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload a PDF or choose "New blank PDF" to create an A4 document. The sidebar blank-page action also works without an uploaded file</li>
        <li>Click "Edit Text" and select text to modify; click "Insert Text / Image / Shape" to add content</li>
        <li>Click "Select Component", then click any text, image or shape to move, resize, rotate or delete it</li>
        <li>Use the page tools to reorder, rotate, delete and extract pages</li>
        <li>Click "Export PDF" to save the result</li>
      </ol>

      <h3>Notes</h3>
      <ul>
        <li>Limits: 150 MB input, 500 pages. Added blank pages inherit the current page's visible dimensions</li>
        <li>A new document is unsaved until export. Undo, redo and reset do not change files already exported. Zooming or changing pages alone does not create unsaved changes</li>
        <li>Inserted text preserves line breaks and blank lines. Enter adds a line; Ctrl+Enter saves. Existing PDF text lines still use Enter to save. Escape closes only the current text dialog</li>
        <li>Reading and generation can be cancelled. Cancellation is disabled during document replacement and final saving so the reported result matches the actual outcome</li>
        <li>Text replacement requires an embedded text layer; scanned or image-only PDFs are not supported</li>
        <li>Files are processed locally and never uploaded</li>
      </ul>
    </div>`
  },

  'excel-to-pdf': {
    title: 'Excel to PDF',
    html: `<div class="help-doc">
      <h2>Excel to PDF</h2>
      <p>Use the local LibreOffice rendering runtime to convert Excel workbooks into PDFs for sharing, printing, and archiving. Source files are never modified or uploaded.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload or drop one or more <code>XLSX</code>, <code>XLS</code>, or <code>ODS</code> workbooks</li>
        <li>Choose all worksheets or visible worksheets only</li>
        <li>Set page orientation, paper size, and scaling</li>
        <li>Click "Start Conversion"; each workbook produces a separate PDF</li>
        <li>Open the output folder to view the PDF files and <code>manifest.json</code></li>
      </ol>

      <h3>Page and Worksheet Rules</h3>
      <ul>
        <li>"All worksheets" includes hidden sheets. Choose "Visible worksheets only" when hidden content must stay out of the PDF</li>
        <li>Orientation supports source settings, portrait, and landscape. Paper size supports automatic, A4, and US Letter</li>
        <li>"Fit to pages" scales content to reduce horizontal clipping, while "Original scale" stays closer to the workbook's print settings</li>
      </ul>

      <h3>Notes</h3>
      <ul>
        <li>Up to 20 files per batch and 200 MB per file</li>
        <li>First use installs the roughly 356 MB LibreOffice runtime on demand; conversion works offline afterward</li>
        <li>Missing local fonts can change pagination, row height, or text width</li>
        <li>Complex macros, external data connections, and interactive controls do not remain interactive in PDF output</li>
      </ul>
    </div>`
  },

  'ppt-tools': {
    title: 'PPT Tools Overview',
    html: `<div class="help-doc">
      <h2>PPT Tools Overview</h2>
      <p>PPT tools focus on presentation asset extraction and AI-assisted writing. The first stage supports <strong>.pptx</strong>. Files are parsed locally; only when you explicitly enable AI organization will the extracted text be sent to your configured AI provider. The PPTX file itself is never uploaded.</p>

      <h3>PPT to PDF</h3>
      <ul>
        <li>Renders PPTX through local LibreOffice / soffice into shareable, printable PDF files.</li>
        <li>The source file is never modified. The output folder contains the PDF and <code>manifest.json</code>.</li>
        <li>If LibreOffice is missing, the desktop app shows a clear dependency prompt. CLI/Agent users can set <code>TOOLKNIT_LIBREOFFICE_PATH</code>.</li>
      </ul>

      <h3>PPT to Images</h3>
      <ul>
        <li>Renders PPTX into an intermediate PDF locally, then opens the high-quality page-selection workspace.</li>
        <li>Exports selected pages as individual PNG / JPG / WebP images; PPT slides are not stitched into long images in this tool.</li>
        <li>Useful for short videos, image posts, documentation screenshots, or further Agent processing.</li>
      </ul>

      <h3>PPT Image Extractor</h3>
      <ul>
        <li>Extract embedded images, logos, screenshots, and background assets from PPTX files.</li>
        <li>Filter by slide pages, or export all assets in one run.</li>
        <li>Preserves original image formats whenever possible and writes a <code>manifest.json</code> with slide, filename, and size clues.</li>
      </ul>

      <h3>PPT AI Text Extractor</h3>
      <ul>
        <li>Extracts slide titles, body text, and speaker notes in true presentation order.</li>
        <li>Exports <code>Markdown</code>, <code>TXT</code>, <code>JSON</code>, or all formats at once.</li>
        <li>Supports page ranges such as <code>1,3-5</code> and skips low-value placeholders like footer, date, and slide number fields.</li>
        <li>Optional AI organization can create outlines, speaker scripts, meeting notes, or study notes; local extraction still works without an API key.</li>
      </ul>

      <h3>PPT Compress</h3>
      <ul>
        <li>Creates an optimized copy locally; the source PPTX is never modified.</li>
        <li>Supports both lossless cleanup and image compression: <code>low</code> preserves image quality, while <code>medium</code> / <code>high</code> recompress large image assets to reduce size.</li>
        <li>When an image does not become smaller, ToolKnit keeps the original image automatically. The source PPTX is never modified.</li>
        <li>Writes <code>manifest.json</code> with original size, compressed size, saved bytes, and cleanup actions.</li>
      </ul>

      <h3>AI PPT Outline</h3>
      <ul>
        <li>Generates a new presentation outline from a topic, source notes, target audience, and purpose.</li>
        <li>Supports deck presets such as product launch, investor pitch, work report, and training so AI can follow the right narrative shape.</li>
        <li>Visual direction is fixed to a reliable monochrome minimal system: large white fields with restrained black accents, rather than selectable visual styles.</li>
        <li>Does not read PPTX and does not generate a PPTX file. It writes <code>outline.md</code>, <code>outline.json</code>, and <code>manifest.json</code>.</li>
        <li><code>outline.json</code> is a stable structure with fact boundaries, slide roles, layout intent, and quality self-check fields for the later AI PPT draft / PPTX workflow.</li>
        <li>AI receives only the text you enter. Missing facts are placed in the confirmation fields and fact bank instead of being invented.</li>
      </ul>

      <h3>AI PPT Draft / PPTX</h3>
      <ul>
        <li>Generates a structured outline from source text, then writes an editable PPTX draft locally.</li>
        <li>Can also convert an existing <code>outline.json</code> directly into PPTX without calling AI again.</li>
        <li>It also supports the same <code>deck_type</code> presets as the outline tool, so the draft can follow launch, pitch, report, or training narratives.</li>
        <li>Every draft uses the monochrome minimal template. When real assets are unavailable, neutral light-gray rectangles and simple geometric blocks act as honest placeholders.</li>
        <li>Outputs <code>.pptx</code>, <code>outline.json</code>, <code>outline.md</code>, and <code>manifest.json</code>, without overwriting existing files.</li>
        <li>The first stage is a stable minimal draft, not animations, video, or pixel-perfect enterprise master reproduction.</li>
      </ul>

      <h3>CLI / Agent Examples</h3>
      <pre><code>toolknit ppt to-pdf --input demo.pptx --output-dir out
toolknit ppt to-image --input demo.pptx --output-dir out --pages 1,3-5 --format png --clarity print
toolknit ppt images --input demo.pptx --output-dir out --pages 1,3-5
toolknit ppt text --input demo.pptx --output-dir out --format all --ai-mode outline
toolknit ppt compress --input demo.pptx --output-dir out --level medium
toolknit ppt outline --prompt-file brief.txt --output-dir out --slide-count 8 --deck-type product-launch
toolknit ppt draft --prompt-file brief.txt --output-dir out --slide-count 8 --deck-type product-launch --theme minimal-mono
toolknit ppt draft --outline-file outline.json --output-dir out --theme minimal-mono</code></pre>

      <div class="help-note">
        <p>In an IDE Agent workflow, say: “Use ToolKnit to convert this PPT to PDF / export slides 1 and 3-5 as high-resolution PNG.” For new content, ask it to generate an 8-slide PPT outline from your notes. These are separate tools.</p>
      </div>
    </div>`
  },

  'img-convert': {
    title: 'Image Format Convert',
    html: `<div class="help-doc">
      <h2>Image Format Convert</h2>
      <p>Exports JPG, PNG, WebP, BMP, GIF, and SVG images with batch processing.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Click "Image Format Convert" in the Image tools category</li>
        <li>Upload one or more image files</li>
        <li>Select the target format (JPG / PNG / WebP / BMP / GIF / SVG)</li>
        <li>Click "Start Convert"</li>
        <li>A success prompt appears after processing — you can open the save folder</li>
      </ol>

      <div class="help-note">
        <p>Conversion preserves the original resolution — image dimensions are not changed.</p>
      </div>
    </div>`
  },

  'img-compress': {
    title: 'Image Compress',
    html: `<div class="help-doc">
      <h2>Image Compress</h2>
      <p>Reduce image file size with three quality levels and batch processing.</p>

      <h3>Compression Levels</h3>
      <ul>
        <li><strong>Low</strong>: High quality, larger file size</li>
        <li><strong>Medium</strong>: Balanced quality and size (recommended)</li>
        <li><strong>High</strong>: Maximum compression, smallest size</li>
      </ul>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload one or more image files</li>
        <li>Select the compression level</li>
        <li>Click "Start Compress"</li>
        <li>View compression results after processing, and open the folder to check</li>
      </ol>

      <p>Supported formats: JPG / PNG / WebP / BMP / GIF</p>
    </div>`
  },

  'image-stitch': {
    title: 'Long Image Stitch',
    html: `<div class="help-doc">
      <h2>Long Image Stitch</h2>
      <p>Combine 2–100 JPG, PNG, WebP, BMP, or static GIF images in an explicit order. Processing stays on this device and source files are never changed.</p>

      <h3>Recommended Workflow</h3>
      <ol class="help-steps">
        <li>Click “Add Images,” drag images onto the page, or use “Import PDF” to convert up to 100 pages into ordered local temporary images; animated GIF is explicitly rejected</li>
        <li>Drag rows to reorder, or use the move-up, move-down, and remove controls</li>
        <li>Choose vertical or horizontal mode and use the first, smallest, or largest reference size</li>
        <li>Check the live preview and estimated pixels, then set gap, scale, background, format, and an optional file name</li>
        <li>Click “Start Stitching”; use the completion dialog to open the output folder</li>
      </ol>

      <h3>Size Rules</h3>
      <ul>
        <li><strong>Vertical</strong>: every image gets the same width and proportional height</li>
        <li><strong>Horizontal</strong>: every image gets the same height and proportional width</li>
        <li><strong>0px gap</strong>: neighboring edges touch without inserted pixels</li>
        <li><strong>Scale</strong>: 10–100%; ToolKnit automatically lowers it with a clear notice when needed for safe dimensions</li>
      </ul>

      <h3>Output</h3>
      <p>PNG is lossless and can preserve transparency. JPG flattens transparent areas onto the selected RGB background; quality ranges from 60 to 100 and defaults to 92. Outputs go to <code>Images/Image Stitch</code> under the configured storage root. An optional safe file name is supported; name collisions receive a numeric suffix and never overwrite an existing file.</p>

      <div class="help-note"><p>Queue order is output order. Temporary PDF pages are removed after completion, cancellation, or the next app launch; existing user-exported pages are never deleted. Clearing, cancelling, or a failed operation leaves no partial output behind.</p></div>
    </div>`
  },

  'icon-gen': {
    title: 'Icon Generator',
    html: `<div class="help-doc">
      <h2>Icon Generator</h2>
      <p>Upload an image and generate a complete icon set (multi-size PNG + ICO + SVG), packaged as a ZIP download.</p>

      <h3>Generated Content</h3>
      <ul>
        <li><strong>PNG Icons</strong>: 16/24/32/48/64/96/128/144/152/167/180/192/256/384/512/1024px — 16 sizes total</li>
        <li><strong>ICO File</strong>: Multi-size ICO (16~256px), suitable for Windows application icons</li>
        <li><strong>favicon.ico</strong>: Classic website favicon (16/32/48px)</li>
        <li><strong>SVG File</strong>: Vector icon, lossless at any size</li>
      </ul>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload an image (JPG or PNG)</li>
        <li>Click "Start Generate"</li>
        <li>Wait for the progress overlay to show generation progress</li>
        <li>The <code>icons.zip</code> downloads automatically when complete</li>
        <li>Click "Open Folder" in the success dialog to view the files</li>
      </ol>

      <div class="help-note">
        <p>Images are automatically cropped to a square (center crop). Square or near-square images produce the best results.</p>
      </div>
    </div>`
  },

  'audio-convert': {
    title: 'Audio Convert',
    html: `<div class="help-doc">
      <h2>Audio Format Convert</h2>
      <p>Supports conversion between MP3, AAC, WAV, FLAC, ALAC, OGG, WMA and more, with batch processing.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Click "Audio Format Convert" in the Audio tools category</li>
        <li>Upload one or more audio files</li>
        <li>Select the target format</li>
        <li>Click "Start Processing" and follow the actual per-file progress</li>
        <li>Open the save folder after completion to find uniquely named outputs</li>
      </ol>

      <div class="help-note">
        <p>First-time audio conversion prompts for the FFmpeg runtime (about 29 MB). It works offline after verification and installation.</p>
      </div>

      <h3>Format Guide</h3>
      <ul>
        <li><strong>MP3</strong>: Most universal lossy format, best compatibility</li>
        <li><strong>AAC</strong>: High compression ratio lossy format</li>
        <li><strong>WAV</strong>: Lossless uncompressed format</li>
        <li><strong>FLAC</strong>: Lossless compressed format</li>
        <li><strong>OGG</strong>: Open-source lossy format</li>
      </ul>
    </div>`
  },

  'bpm-detect': {
    title: 'BPM Detector',
    html: `<div class="help-doc">
      <h2>BPM Detector</h2>
      <p>Upload an audio file to automatically detect the BPM (beats per minute).</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload an audio file</li>
        <li>Click "Start Detection"</li>
        <li>Wait for analysis to complete — the BPM result is displayed</li>
      </ol>

      <div class="help-note">
        <p>BPM detection works best with pure music/electronic music. Vocal-heavy songs may produce less accurate results.</p>
      </div>
    </div>`
  },

  'audio-clip': {
    title: 'Audio Clip',
    html: `<div class="help-doc">
      <h2>Audio Clip</h2>
      <p>Waveform-based visual clipping with region selection, playback preview, and precise trimming.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload an audio file</li>
        <li>Drag on the waveform to select the region to keep</li>
        <li>Click play to preview the selected segment</li>
        <li>After confirming, click the "Trim" button</li>
        <li>Export the clipped audio file</li>
      </ol>
    </div>`
  },

  'audio-extract': {
    title: 'Audio Extract',
    html: `<div class="help-doc">
      <h2>Audio Extract</h2>
      <p>Extract the audio track from a video file and save it as a standalone audio file.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Upload a video file (supports MP4 / MOV / MKV, etc.)</li>
        <li>Select the output audio format</li>
        <li>Click "Start Extract"</li>
        <li>Export the extracted audio file</li>
      </ol>
    </div>`
  },

  'video-convert': {
    title: 'Video Convert',
    html: `<div class="help-doc">
      <h2>Video Format Convert</h2>
      <p>Supports conversion between MP4, AVI, MKV, MOV, WebM, FLV, WMV, TS — eight formats, with batch processing.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Click "Video Format Convert" in the Video tools category</li>
        <li>Upload one or more video files</li>
        <li>Select the target format</li>
        <li>Click "Start Convert"</li>
        <li>A success prompt appears after processing</li>
      </ol>

      <div class="help-note">
        <p>Video conversion runs only in the desktop app and uses bundled FFmpeg locally. Each file can be up to 10 GB, with up to 30 files in one batch.</p>
      </div>
    </div>`
  },

  'video-frame': {
    title: 'High-resolution Video Frame',
    html: `<div class="help-doc"><h2>High-resolution Video Frame</h2><p>Locate any moment in a local video and export its decoded source resolution as lossless PNG or high-quality JPG.</p><h3>How to Use</h3><ol class="help-steps"><li>Open Video Tools and choose High-resolution Video Frame</li><li>Upload one local video and wait for its metadata</li><li>Use the timeline, milliseconds input, or previous/next controls for real frame-rate stepping</li><li>Choose PNG or JPG and select Export Current Frame</li></ol><div class="help-note"><p>FFmpeg runs locally and never uploads or changes the source. Existing images are preserved under unique names. CLI and IDE Agent calls require an explicit millisecond timestamp.</p></div></div>`
  },

  'video-gif': {
    title: 'Video to GIF',
    html: `<div class="help-doc"><h2>Video to GIF</h2><p>Select a start and end frame from a local video to create a palette-optimized looping GIF up to 30 seconds long.</p><h3>How to Use</h3><ol class="help-steps"><li>Open Video Tools, choose Video to GIF, and upload or drag in one video</li><li>After upload, the range defaults to the first up-to-30 seconds; adjust both points with the timeline or frame-step buttons. The solid white segment is the exported range</li><li>Choose FPS, width, and quality. For smaller files, try 6/8 FPS, 360/480px, and Small or Tiny quality</li><li>Use the preview-play button to loop only the selected clip; pause keeps the current frame. Then export the GIF</li></ol><div class="help-note"><p>The start and end must be explicit and no more than 30 seconds apart. FFmpeg runs locally and never changes the source. An IDE Agent must ask for exact times rather than guessing a highlight.</p></div></div>`
  },

  'teleprompter': {
    title: 'Teleprompter',
    html: `<div class="help-doc"><h2>Teleprompter</h2><p>Paste a script or read TXT, Markdown, DOCX, or PDF, then scroll it in a high-contrast prompt view. You can adjust speed, font size, horizontal/vertical mirroring, and Focus Mode.</p><h3>Standard scrolling</h3><ol class="help-steps"><li>Type or read a script; click any sentence to jump directly to it</li><li>Set the speed and font size, and enable mirroring when using a camera rig</li><li>Start playback; the guide panel folds away while the prompt is running</li></ol><h3>Sentence-level voice following</h3><ul><li><strong>Automatic</strong>: uses the reliable ToolKnit offline engine on desktop and system recognition on the web</li><li><strong>Windows System Recognition</strong>: depends on Windows speech services; ToolKnit switches to offline recognition if it never starts or returns no result</li><li><strong>ToolKnit Offline Recognition</strong>: microphone chunks stay on the device. If no model is installed, the dependency download dialog opens and resumes after verification</li></ul><p>Completing the current sentence advances to the next one. Identical consecutive lines move once per final result, and long unpunctuated scripts are split into followable chunks. Shortcuts: <code>Space</code> play/pause, <code>Left</code>/<code>Right</code> change sentence, <code>+</code>/<code>-</code> change speed, <code>R</code> reset, and <code>F</code> toggle Focus Mode.</p><div class="help-note"><p>If neither recognition engine can work, playback visibly falls back to standard auto-scrolling instead of freezing. Closing the tool, pausing playback, or switching engines stops the microphone, cancels unfinished inference, and releases the model session.</p></div></div>`
  },

  'text-stats': {
    title: 'Text Statistics',
    html: `<div class="help-doc"><h2>Text Statistics</h2><p>Type or paste text in the desktop app and see live counts. The text is not uploaded or saved by this tool.</p><h3>What it measures</h3><ul><li>Characters, non-space characters, spaces, Han characters, English words, letters, digits, and punctuation</li><li>Lines, paragraphs, sentences, longest line, average line length, and estimated reading time</li></ul><h3>How to use it</h3><ol class="help-steps"><li>Open Text Statistics and paste your text</li><li>Read the live statistic cards</li><li>Use Copy Statistics to share the summary, or Clear to start again</li></ol><div class="help-note"><p>CLI/IDE Agent can also inspect one explicit UTF-8 text file without returning its contents in the conversation or logs.</p></div></div>`
  },

  'text-format': {
    title: 'Text Format',
    html: `<div class="help-doc"><h2>Text Format</h2><p>Transform text with common casing, whitespace, line-order, and full-width/half-width actions. The result stays on the page until you choose to copy or reuse it.</p><h3>Available actions</h3><ul><li>Uppercase, lowercase, title case, sentence capitalization</li><li>Trim extra spaces, line edges, empty lines, and duplicate lines</li><li>Sort lines, add or remove line numbers, reverse lines or characters</li><li>Convert full-width and half-width characters</li></ul><h3>How to use it</h3><ol class="help-steps"><li>Type or paste text</li><li>Select one action and inspect the result</li><li>Copy the result or use it as input for the next action</li></ol><div class="help-note"><p>This visual tool is desktop-only for now, because reviewing each transformation is part of the workflow.</p></div></div>`
  },

  'bmi-calc': {
    title: 'Body Fat Calculator',
    html: `<div class="help-doc"><h2>Body Fat Calculator</h2><p>Estimate BMI, body-fat percentage, basal metabolic rate, and ideal-weight reference from sex, age, height, and weight. Precise mode also uses waist, neck, and, when relevant, hip measurements.</p><h3>How to use it</h3><ol class="help-steps"><li>Choose Simple or Precise mode</li><li>Enter your measurements within the accepted ranges</li><li>Review BMI, body-fat range, metabolism, and weight difference</li></ol><div class="help-note"><p>Results are for general wellness reference, not diagnosis, treatment, or professional medical advice.</p></div></div>`
  },

  'timestamp-calc': {
    title: 'Timestamp Calculator',
    html: `<div class="help-doc"><h2>Timestamp Calculator</h2><p>Convert between Unix seconds, Unix milliseconds, and date/time while showing local time, UTC, ISO 8601, and relative time.</p><h3>How to use it</h3><ol class="help-steps"><li>Copy the live seconds or milliseconds value when you need the current timestamp</li><li>Choose Timestamp to Date or Date to Timestamp</li><li>Enter a value, inspect the result, and copy it</li></ol><div class="help-note"><p>Local-time output depends on your computer timezone. Use UTC or ISO 8601 when diagnosing cross-timezone issues.</p></div></div>`
  },

  'mortgage-calc': {
    title: 'Mortgage Calculator',
    html: `<div class="help-doc"><h2>Mortgage Calculator</h2><p>Estimate monthly payments, total interest, and a repayment schedule from loan amount, annual rate, term, and repayment method.</p><h3>How to use it</h3><ol class="help-steps"><li>Enter the principal, annual rate, and term</li><li>Choose equal-payment or equal-principal repayment</li><li>Review the payment, interest, and schedule, then adjust inputs to compare</li></ol><div class="help-note"><p>This is an estimate only. Actual rates, taxes, fees, early repayment rules, and statements are defined by your lender.</p></div></div>`
  },

  'interest-calc': {
    title: 'Interest Calculator',
    html: `<div class="help-doc"><h2>Interest Calculator</h2><p>Quickly estimate interest and total amount from principal, annual rate, and term for basic saving or borrowing comparisons.</p><h3>How to use it</h3><ol class="help-steps"><li>Enter principal, annual rate, and term</li><li>Choose the supported interest method and time unit</li><li>Review interest, total amount, and details, then adjust as needed</li></ol><div class="help-note"><p>The result does not account for compounding, taxes, fees, or special contract rules. Use the signed agreement for real transactions.</p></div></div>`
  },

  'password-gen': {
    title: 'Password Generator',
    html: `<div class="help-doc"><h2>Password Generator</h2><p>Generate random passwords locally with a chosen length, character sets, and strength preset. Generated values stay only in the current page memory until you replace or clear them.</p><h3>How to use it</h3><ol class="help-steps"><li>Choose a strength preset or configure lowercase, uppercase, digits, and symbols</li><li>Generate and review the password</li><li>Copy it, then use Clear when you are done</li></ol><div class="help-note"><p>Passwords intentionally do not go through CLI or IDE Agent, keeping secrets out of command history, conversations, and logs.</p></div></div>`
  },

  'color-extractor': {
    title: 'Color Extractor',
    html: `<div class="help-doc"><h2>Color Extractor</h2><p>Extract dominant colors from a PNG, JPG, or WebP image, or pick a pixel from another desktop application with the global screen picker.</p><h3>Image palette</h3><ol class="help-steps"><li>Upload or drop an image</li><li>Wait for local analysis, then select a swatch</li><li>Review HEX, RGB, and other values, then copy what you need</li></ol><h3>Screen color picker</h3><ol class="help-steps"><li>Select Start Screen Picker or press the default <code>Ctrl+Shift+C</code> shortcut</li><li>The main window minimizes; drag the 21×21-pixel magnifier crosshair onto the target pixel</li><li>Confirm to return to Color Extractor with the captured color in the results</li></ol><div class="help-note"><p>The picker samples only the pixels around the crosshair in memory. It does not save screenshots or upload the screen. CLI/IDE Agent can also analyze one explicit image path locally.</p></div></div>`
  },

  'typing-test': {
    title: 'Typing Test',
    html: `<div class="help-doc"><h2>Typing Test</h2><p>Choose Chinese or English, a difficulty level, and a duration, then type against the prompt to measure speed and accuracy.</p><h3>How to use it</h3><ol class="help-steps"><li>Set language, difficulty, and duration</li><li>Select Start Test, then focus the input area to type</li><li>Review WPM and accuracy when it finishes; use Restart to try again</li></ol><div class="help-note"><p>This interactive tool is desktop-only and is not exposed to CLI or IDE Agents.</p></div></div>`
  },

  'pdf-ai-markdown': {
    title: 'AI PDF to Markdown',
    html: `<div class="help-doc">
      <h2>AI PDF to Markdown</h2>
      <p>For scans, image PDFs, tables and complex layouts. Pages are rendered locally; starting conversion sends images and recognized content to your configured AI service. Requires an OpenAI-compatible model with image input and an API key.</p>
      <ol class="help-steps"><li>Select one PDF, up to 150 MB and 120 pages. Decrypt protected files first.</li><li>Review the model and service address. Only process documents you may share. The provider may charge for image and text usage.</li><li>Recognize text, headings, lists, tables, image descriptions and formulas page by page, followed by a separate reading guide built from the entire document in batches.</li><li>Review page previews and notes, then open the Markdown editor to edit, copy or export .md.</li></ol>
      <h3>Results and recovery</h3><ul><li>Source page markers are preserved. Preview shows 3,000 characters per page; the editor receives the complete result.</li><li>Retry unfinished pages without requesting successful pages again. A failed guide does not discard recognized text.</li><li>Cancel stops further processing and preserves completed pages in this session. Closing, returning or choosing another file clears the session.</li><li>Charts are retained as descriptions. No remote images are downloaded or unreadable values invented. Review complex tables and formulas.</li></ul>
      <div class="help-note"><p>Text-only models cannot read images. Accuracy depends on image quality and model capabilities. For text-layer PDFs, consider the offline PDF Text Extraction / Markdown tool.</p></div>
    </div>`
  },
  'ai-polish': {
    title: 'AI Polish',
    html: `<div class="help-doc">
      <h2>AI Text Polish</h2>
      <p>Paste text, select a document, or drop a supported file, then refine its wording with a chosen direction.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Enter text or import a supported local document and inspect the parsed preview</li>
        <li>Select a polish direction (formal/concise/academic/conversational, etc.)</li>
        <li>Click "Start Polish"</li>
        <li>Compare the original and polished text</li>
        <li>Compare the result inside the app, then copy or export it</li>
      </ol>
      <div class="help-note"><p>The document is parsed locally and the source file is not uploaded. Only the text shown for submission is sent to your configured AI provider.</p></div>
    </div>`
  },

  'ai-translate': {
    title: 'AI Translate',
    html: `<div class="help-doc">
      <h2>AI Translate</h2>
      <p>Paste text, select a document, or drop a supported file, then preview a sentence-aligned translation inside the app.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Enter text or import a supported local document and inspect the parsed preview</li>
        <li>Select the source and target languages</li>
        <li>Click "Start Translate"</li>
        <li>Review sentence-aligned results, then copy or export them</li>
      </ol>
      <div class="help-note"><p>The source document is parsed locally and is not uploaded. Only the text prepared for translation is sent to the selected AI provider.</p></div>
    </div>`
  },

  'ai-doc': {
    title: 'AI Doc Generator',
    html: `<div class="help-doc">
      <h2>AI Document Generator</h2>
      <p>Generate polished multi-page PDFs from natural language while keeping an editable ToolKnit document project. The desktop app is best for visual generation and manual refinement; CLI/MCP lets an IDE Agent generate, inspect, insert images, delete components, and undo revisions inside a project folder.</p>

      <h3>Desktop workflow</h3>
      <ol class="help-steps">
        <li>Describe the topic, page count, language, required content, and forbidden content.</li>
        <li>Generate the document and wait for content planning, layout, and PDF rendering.</li>
        <li>Preview the page count, footers, tables, images, and text clipping before exporting.</li>
        <li>Open the editor, select one layer at a time, then move, resize, delete, reorder, or undo the previous edit.</li>
        <li>Export the PDF when the layout is correct. Keep the original brief if you want to regenerate later.</li>
      </ol>

      <h3>Write stronger briefs</h3>
      <ul>
        <li>Specify the exact page count, such as "create a 3-page A4 PDF".</li>
        <li>Describe page structure, table row limits, signature areas, and whether images are allowed.</li>
        <li>Ask the model to write "Not provided" for missing dates, names, versions, owners, or approval results.</li>
        <li>If an Agent will insert images later, explicitly request no images, no image placeholders, no image controls, and reserved space on the target page.</li>
      </ul>

      <div class="help-note"><p>AI document generation calls your configured AI provider. Files and rendered artifacts stay local. Do not put API keys, passwords, identity numbers, or other secrets into a document brief.</p></div>

      <h3>Agent / CLI workflow</h3>
      <p>When generated through CLI/MCP, ToolKnit writes the PDF, <code>.toolknit.json</code> project, clean previews, high-resolution per-page numbered maps, and revision history. Open <code>page-XX-controls.png</code> from the IDE file tree, then ask the Agent to edit by number.</p>

      <div class="help-agent-prompt">
        <h4>Create an image-free draft</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to create a 3-page English A4 PDF titled "Project Execution Plan" in the current IDE project's toolknit-output folder. Do not overwrite existing files. The initial draft must contain no images, image placeholders, or image controls. After generation, inspect the real page count and the project, confirm that image controls equal 0, and report the absolute PDF, project, and per-page numbered-map paths.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to create a 3-page English A4 PDF titled Project Execution Plan in the current IDE project's toolknit-output folder. Do not overwrite existing files. The initial draft must contain no images, image placeholders, or image controls. After generation, inspect the real page count and the project, confirm that image controls equal 0, and report the absolute PDF, project, and per-page numbered-map paths.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Edit by control number</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to edit &lt;project.toolknit.json&gt;. Inspect first; do not guess from the screenshot. Swap P1-01 and P1-02, then set P1-01 background to #000000 and text to #FFFFFF. Dry-run first and report diagnostics. If there is no error, submit the exact same operations.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to edit &lt;project.toolknit.json&gt;. Inspect first; do not guess from the screenshot. Swap P1-01 and P1-02, then set P1-01 background to #000000 and text to #FFFFFF. Dry-run first and report diagnostics. If there is no error, submit the exact same operations.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Insert a local image</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to insert an image control after P2-04 in &lt;project.toolknit.json&gt;. Read the image from &lt;absolute local PNG or JPEG path&gt; and size it to 520 by 150. Inspect first, dry-run, check image resolution, page overflow, and overlap diagnostics, then submit. Do not use base64.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to insert an image control after P2-04 in &lt;project.toolknit.json&gt;. Read the image from &lt;absolute local PNG or JPEG path&gt; and size it to 520 by 150. Inspect first, dry-run, check image resolution, page overflow, and overlap diagnostics, then submit. Do not use base64.">Copy prompt</button>
      </div>

      <div class="help-note"><p>An Agent must inspect first, dry-run the edit, then submit the same operations. It should not publish changes with <code>page_count_changed</code>, bounds errors, serious overlap, or invalid images.</p></div>
    </div>`
  },

  'ai-table': {
    title: 'AI Table Generator',
    html: `<div class="help-doc">
      <h2>AI Table Generator</h2>
      <p>Generate editable table projects from natural language. It is a good fit for reports, checklists, dashboards, and data pages with charts. The desktop app is best for quick generation and manual refinement; CLI/MCP lets an IDE Agent generate, inspect, edit rows and columns, adjust charts, and undo revisions inside a project folder.</p>

      <h3>Desktop workflow</h3>
      <ol class="help-steps">
        <li>Describe the table topic, column names, row count, data range, chart needs, and export format.</li>
        <li>Generate the table and wait for column design, rows, charts, and export output.</li>
        <li>Review the preview for column widths, numeric types, empty cells, and chart correctness.</li>
        <li>Use the desktop preview as a light editor: click the title or any cell to edit, click headers to sort, use + to add rows or columns, and undo the previous edit if needed.</li>
        <li>Export to CSV, XLSX, PDF, or PNG when the layout is correct.</li>
      </ol>

      <h3>Write stronger briefs</h3>
      <ul>
        <li>State the exact row and column counts, and specify each column type such as text, number, or date.</li>
        <li>Describe whether charts are needed, plus the chart type, label column, and value columns.</li>
        <li>Specify summary rows, empty values, units, sort rules, and export format.</li>
        <li>If an Agent will edit the table later, keep the column labels clear and avoid vague headings.</li>
      </ul>

      <div class="help-note"><p>AI table generation calls your configured AI provider. Files and rendered artifacts stay local. Do not put API keys, passwords, ID numbers, or other secrets into the request brief.</p></div>

      <h3>Agent / CLI workflow</h3>
      <p>When generated through CLI/MCP, ToolKnit writes the export file, the <code>.toolknit-table.json</code> project, and the preview image. Table projects use stable row, column, and chart numbers such as <code>R01</code>, <code>C01</code>, and <code>G01</code>; users can open <code>preview/preview.png</code> from the IDE file tree and continue editing by number.</p>
      <div class="help-note"><p>For a few quick cell edits, the desktop app is faster. For multi-step revisions such as “swap R01 and R02, insert a chart, change a column type, then undo a revision,” use the Agent/CLI project workflow.</p></div>

      <div class="help-agent-prompt">
        <h4>Create an editable table</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to create a 4-column, 6-row Chinese A4 table titled "Project Progress" in the current IDE project's toolknit-output folder. Export it as XLSX and do not overwrite existing files. The table must include a status chart. After generation, tell me the absolute paths of the export file, project file, and preview image, then inspect once to confirm that row, column, and chart numbers all exist.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to create a 4-column, 6-row Chinese A4 table titled Project Progress in the current IDE project's toolknit-output folder. Export it as XLSX and do not overwrite existing files. The table must include a status chart. After generation, tell me the absolute paths of the export file, project file, and preview image, then inspect once to confirm that row, column, and chart numbers all exist.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Edit by control number</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to edit &lt;project.toolknit-table.json&gt;. Inspect first and do not guess from the preview. Swap R01 and R02, rename C02 to "Owner", change the value in row R01, column C02 to "Alice", and rename G01 to "Completion Trend". Dry-run first and report diagnostics. If there is no error, submit the exact same operations and tell me the new preview path.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to edit &lt;project.toolknit-table.json&gt;. Inspect first and do not guess from the preview. Swap R01 and R02, rename C02 to Owner, change the value in row R01, column C02 to Alice, and rename G01 to Completion Trend. Dry-run first and report diagnostics. If there is no error, submit the exact same operations and tell me the new preview path.">Copy prompt</button>
      </div>

      <h3>AI table edit rules</h3>
      <ul>
        <li>Numbers such as <code>R01</code>, <code>C01</code>, and <code>G01</code> belong to the row, column, or chart itself. Swapping or deleting items does not renumber other items.</li>
        <li>Open the preview and inspect result first. If a semantic description matches multiple targets, the Agent must ask the user.</li>
        <li>Chart edits must reference a stable chart number or id; do not guess coordinates from the preview.</li>
        <li>Output paths must always be explicit. Without explicit authorization, the Agent must not overwrite any existing file.</li>
      </ul>
    </div>`
  },

  'agent-guide': {
    title: 'AI Agent Quick Guide',
    html: `<div class="help-doc">
      <h2>Use ToolKnit through an AI Agent</h2>
      <p>After connecting ToolKnit CLI to an MCP-capable IDE, you can ask an Agent in plain language to process local files from the project. The Agent calls real ToolKnit tools; it does not need the desktop app to stay open and should not claim a result without a tool call.</p>

      <h3>Current scope</h3>
      <div class="help-agent-scope"><p>V3.2 exposes <strong>77 capabilities</strong>. Use the local V3.2 test package until npm publication.</p><ul>
        <li><strong>PDF and Office</strong>: inspect, merge, split, rotate, encrypt/decrypt, compress, enhance, export images, convert to Word, extract text/Markdown, crop, number pages, create scan effects or blank PDFs, and render XLSX to PDF. Word defaults to local analysis; complex regions may remain images. Excel rendering needs LibreOffice.</li>
        <li><strong>PPT</strong>: PDF/image export, asset/text extraction, compression, AI outlines and editable drafts.</li>
        <li><strong>Images</strong>: PDF creation, format conversion, compression, crop/rotate/flip, color replacement, icon archives, palette extraction, stitching and color-space conversion.</li>
        <li><strong>Audio/video and transcription</strong>: conversion, BPM, clipping, audio tracks, frames, GIFs, local model management and TXT/SRT/JSON transcription.</li>
        <li><strong>Text, developer and calculation tools</strong>: statistics, formatting, JSON, Base64, URL, UUID, JWT decoding, checksums, timestamps, BMI, mortgage and interest estimates. JWT decoding does not verify signatures.</li>
        <li><strong>AI</strong>: polishing, source-aligned translation and visual PDF Markdown; AI document/table creation, inspection, editing, undo and rendering. Explicit PDF-to-Word AI mode only assists structure.</li>
        <li><strong>Files and hardware</strong>: read-only large/duplicate-file scans, Markdown HTML export and eight Windows hardware queries.</li>
      </ul><p>Use <code>toolknit tools list --json</code> and <code>toolknit tools describe &lt;name&gt; --json</code> for exact schemas; <code>tools coverage</code> shows desktop coverage.</p></div>

      <h3>Desktop-only tools</h3>
      <p>Quick Screenshot, clipboard monitoring, teleprompter, typing test, password generation, system-drive cleanup and background removal remain desktop-only. Freeform PDF editing and interactive Markdown editing still need the visual UI. File scans never delete data; cryptography exposes checksums only. Keep passwords and other secrets out of Agent conversations.</p>

      <h3>Connect once</h3>
      <ol class="help-steps">
        <li>Install V3.2 CLI with Node.js 22.13.0 or later, then run <code>toolknit doctor</code>. Local tools need no AI key; only explicitly requested AI operations or modes use independent provider configuration. Desktop credentials are not shared automatically.</li>
        <li>Search for <code>MCP</code> in your IDE settings. Add a server with command <code>toolknit</code> and arguments <code>mcp serve</code>, then reconnect or restart the Agent.</li>
        <li>State the input file, requested operation, destination, and overwrite decision. For “save to the current project”, the Agent should use the workspace <code>toolknit-output</code> folder rather than guessing a path.</li>
      </ol>

      <div class="help-note"><p>The safest request is “inspect first, process next, save under the current project's toolknit-output, and do not overwrite my source.” Always provide a destination. AI document and table edits must inspect first, dry-run, then submit the same operations.</p></div>

      <h3>Copy-ready prompts</h3>

      <div class="help-agent-prompt">
        <h4>Inspect a PDF</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;input PDF path&gt;. Tell me the page count and file size. Do not modify the file.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;input PDF path&gt;. Tell me the page count and file size. Do not modify the file.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Extract selected pages</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then extract page &lt;page number, for example 2 or 1,3-5&gt; into &lt;output folder&gt;. Do not overwrite existing files.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then extract page &lt;page number, for example 2 or 1,3-5&gt; into &lt;output folder&gt;. Do not overwrite existing files.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Merge PDFs</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;PDF 1 path&gt; and &lt;PDF 2 path&gt;, then merge them in this order into &lt;output PDF path&gt;. Do not overwrite an existing file.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;PDF 1 path&gt; and &lt;PDF 2 path&gt;, then merge them in this order into &lt;output PDF path&gt;. Do not overwrite an existing file.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Rotate a PDF</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then rotate all pages clockwise by &lt;90, 180, or 270&gt; degrees and save to &lt;output PDF path&gt;. Do not overwrite an existing file.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then rotate all pages clockwise by &lt;90, 180, or 270&gt; degrees and save to &lt;output PDF path&gt;. Do not overwrite an existing file.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Compress a PDF</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then compress it with &lt;low, medium, or high&gt; level and save to &lt;output PDF path&gt;. Do not overwrite an existing file.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;input PDF path&gt;, then compress it with &lt;low, medium, or high&gt; level and save to &lt;output PDF path&gt;. Do not overwrite an existing file.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Enhance a scanned PDF</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to inspect &lt;scanned PDF path&gt;, then enhance it with &lt;light, medium, or strong&gt; strength and save to &lt;output PDF path&gt;. Enhancement rasterizes pages, so do not expect searchable text, links, or forms to remain.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to inspect &lt;scanned PDF path&gt;, then enhance it with &lt;light, medium, or strong&gt; strength and save to &lt;output PDF path&gt;. Enhancement rasterizes pages, so do not expect searchable text, links, or forms to remain.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Process audio from the current project</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to convert current-project assets/interview.m4a to a high-quality MP3 under the current project's toolknit-output. Resolve the absolute path from the IDE file tree first. Do not modify the source or overwrite an existing file. Report the output path, actual format, and any failure.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to convert current-project assets/interview.m4a to a high-quality MP3 under the current project's toolknit-output. Resolve the absolute path from the IDE file tree first. Do not modify the source or overwrite an existing file. Report the output path, actual format, and any failure.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Transcribe audio or video offline</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to list local offline transcription models first. If none is ready, tell me the recommended Small-model download size and wait for confirmation; do not download it yourself. Then transcribe current-project assets/meeting.mp4 to English under toolknit-output as TXT, SRT, and JSON. Do not upload media or overwrite files.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to list local offline transcription models first. If none is ready, tell me the recommended Small-model download size and wait for confirmation; do not download it yourself. Then transcribe current-project assets/meeting.mp4 to English under toolknit-output as TXT, SRT, and JSON. Do not upload media or overwrite files.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Export a video frame or GIF</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to export a PNG frame from current-project recordings/demo.mp4 at 12500 milliseconds under toolknit-output. Do not modify the source. For a GIF, ask me for exact start and end milliseconds instead of guessing a highlight; the clip may not exceed 30 seconds.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to export a PNG frame from current-project recordings/demo.mp4 at 12500 milliseconds under toolknit-output. Do not modify the source. For a GIF, ask me for exact start and end milliseconds instead of guessing a highlight; the clip may not exceed 30 seconds.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Extract colors, count text, or stitch images</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to analyze six dominant colors from current-project assets/poster.png and report HEX, RGB, and percentage without writing a file. When stitching is requested, combine the named screenshots in the stated order into a PNG under toolknit-output, without modifying sources or overwriting an existing output.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to analyze six dominant colors from current-project assets/poster.png and report HEX, RGB, and percentage without writing a file. When stitching is requested, combine the named screenshots in the stated order into a PNG under toolknit-output, without modifying sources or overwriting an existing output.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Generate a multi-page AI document</h4>
        <p class="help-agent-prompt-text">You must call the ToolKnit MCP tool toolknit_ai_document. Do not merely draft the content in chat. Generate a 4-page English A4 PDF titled "ToolKnit v2.0 Product Plan" in the current IDE project's toolknit-output folder. Do not overwrite existing files. After generation, report the absolute paths of the PDF, .toolknit.json project, preview directory, every high-resolution numbered map, and overview map. Then call toolknit_pdf_inspect and confirm the real PDF has exactly 4 pages.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="You must call the ToolKnit MCP tool toolknit_ai_document. Do not merely draft the content in chat. Generate a 4-page English A4 PDF titled ToolKnit v2.0 Product Plan in the current IDE project's toolknit-output folder. Do not overwrite existing files. After generation, report the absolute paths of the PDF, .toolknit.json project, preview directory, every high-resolution numbered map, and overview map. Then call toolknit_pdf_inspect and confirm the real PDF has exactly 4 pages.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Edit an AI document after opening the map</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to edit &lt;project.toolknit.json&gt;. Inspect the current revision and controls first; do not edit JSON directly or guess coordinates from the screenshot. Swap P1-03 and P1-05, then set P1-03 background to #000000 and text to #FFFFFF. Dry-run first and report all diagnostics. If there is no error, submit the edit and report the new revision plus updated map paths.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to edit &lt;project.toolknit.json&gt;. Inspect the current revision and controls first; do not edit JSON directly or guess coordinates from the screenshot. Swap P1-03 and P1-05, then set P1-03 background to #000000 and text to #FFFFFF. Dry-run first and report all diagnostics. If there is no error, submit the edit and report the new revision plus updated map paths.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Delete or undo a component</h4>
        <p class="help-agent-prompt-text">Delete P3-06 from &lt;project.toolknit.json&gt;. Inspect first to confirm the number and text, then dry-run. If there is no error, delete only that control and no other content. If I say undo the last edit, call toolknit_ai_document_edit with the sole operation {"type":"undo","steps":1}.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Delete P3-06 from &lt;project.toolknit.json&gt;. Inspect first to confirm the number and text, then dry-run. If there is no error, delete only that control and no other content. If I say undo the last edit, call toolknit_ai_document_edit with the sole operation {&quot;type&quot;:&quot;undo&quot;,&quot;steps&quot;:1}.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Create an editable table</h4>
        <p class="help-agent-prompt-text">You must call ToolKnit MCP's toolknit_ai_table. Do not only write the table in chat. Create a 4-column, 6-row Chinese A4 table titled "Project Progress" in the current IDE project's toolknit-output folder, export it as XLSX, and do not overwrite existing files. The table must include a status chart. After generation, tell me the absolute paths of the export file, project file, and preview image, then inspect once to confirm that row, column, and chart numbers all exist.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="You must call ToolKnit MCP's toolknit_ai_table. Do not only write the table in chat. Create a 4-column, 6-row Chinese A4 table titled Project Progress in the current IDE project's toolknit-output folder, export it as XLSX, and do not overwrite existing files. The table must include a status chart. After generation, tell me the absolute paths of the export file, project file, and preview image, then inspect once to confirm that row, column, and chart numbers all exist.">Copy prompt</button>
      </div>

      <div class="help-agent-prompt">
        <h4>Edit a table by number</h4>
        <p class="help-agent-prompt-text">Use ToolKnit MCP to edit &lt;project.toolknit-table.json&gt;. Inspect first and do not guess from the preview. Swap R01 and R02, rename C02 to "Owner", change the value in row R01, column C02 to "Alice", and rename G01 to "Completion Trend". Dry-run first and report all diagnostics. If there is no error, submit the exact same operations and tell me the new preview path.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="Use ToolKnit MCP to edit &lt;project.toolknit-table.json&gt;. Inspect first and do not guess from the preview. Swap R01 and R02, rename C02 to Owner, change the value in row R01, column C02 to Alice, and rename G01 to Completion Trend. Dry-run first and report all diagnostics. If there is no error, submit the exact same operations and tell me the new preview path.">Copy prompt</button>
      </div>

      <h3>AI document edit rules</h3>
      <ul>
        <li>Open high-resolution per-page maps such as <code>demo/page-02-controls.png</code>; do not rely on the overview only.</li>
        <li>Control numbers such as <code>P1-01</code> belong to the control and are not renumbered after swaps or deletion.</li>
        <li>A semantic target can be mapped only when exactly one control matches; otherwise the Agent must ask the user.</li>
        <li>Image insertion requires an absolute local PNG/JPEG path. Do not use base64 and do not create silent placeholders.</li>
      </ul>

      <h3>AI table edit rules</h3>
      <ul>
        <li>Numbers such as <code>R01</code>, <code>C01</code>, and <code>G01</code> belong to the row, column, or chart itself. Swapping or deleting items does not renumber other items.</li>
        <li>Open the preview and inspect result first. If a semantic description matches multiple targets, the Agent must ask the user.</li>
        <li>Chart edits must reference a stable chart number or id; do not guess coordinates from the preview.</li>
        <li>Output paths must always be explicit. Without explicit authorization, the Agent must not overwrite any existing file.</li>
      </ul>

      <h3>Password-protected files</h3>
      <p>Encryption and decryption need a password. Do not paste passwords into Agent chats, shared transcripts, or task descriptions. Use ToolKnit Desktop for password-protected PDFs whenever possible; if an Agent must handle one, tell it never to echo, repeat, or record the password.</p>

      <h3>When something fails</h3>
      <p>Ask the Agent to run <code>toolknit doctor</code> or inspect the input path first. Typical causes are a missing path, an existing output file, or a password-protected PDF.</p>
    </div>`
  },

  'faq-general': {
    title: 'General',
    html: `<div class="help-doc">
      <h2>FAQ - General</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Is ToolKnit free?</div>
        <div class="help-faq-a">A: Yes, ToolKnit is completely free to use, with no ads or in-app purchases.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Are my files uploaded to a server?</div>
        <div class="help-faq-a">A: Local tools do not upload source files. Only explicitly invoked AI tools send required text or cleanup candidate metadata to your selected provider. Runtime downloads, public GitHub data, and external links also use the network.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Which operating systems are supported?</div>
        <div class="help-faq-a">A: Currently supports Windows 10/11 (64-bit). macOS and Linux versions are being planned.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: How do I switch languages?</div>
        <div class="help-faq-a">A: Use the Settings button on the right side of any page's top navigation bar, then choose Chinese or English under Language.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Where are my files saved?</div>
        <div class="help-faq-a">A: By default, files are saved under ToolKnit in Downloads and grouped into tool-specific subfolders such as PDF_Merge, Images, Videos, Transcripts, and AI_Doc. You can view, open, or change the root folder in Settings.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Is batch processing supported?</div>
        <div class="help-faq-a">A: Yes. Most tools (PDF merge, image conversion, audio conversion, etc.) support batch file processing.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Do I need an account or cloud sync?</div>
        <div class="help-faq-a">A: No. The desktop app has no account system or cloud favorites sync. Settings, favorites, keys, and downloaded runtimes stay on this device.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What if startup says WebView2 is missing?</div>
        <div class="help-faq-a">A: Windows 10/11 normally includes WebView2. On a stripped-down or offline installation, connect once and install Microsoft Edge WebView2 Runtime before launching ToolKnit.</div>
      </div>
    </div>`
  },

  'faq-ffmpeg': {
    title: 'FFmpeg',
    html: `<div class="help-doc">
      <h2>FAQ - FFmpeg</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What is the FFmpeg extension?</div>
        <div class="help-faq-a">A: FFmpeg is an open-source multimedia processing library. ToolKnit's audio conversion, video conversion, and other features depend on it. You'll be automatically prompted to download it on first use.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: How much space does FFmpeg need?</div>
        <div class="help-faq-a">A: The current Windows runtime download is about 29 MB. It is installed under ToolKnit local app data, not your output folder, and works offline after installation.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What if the FFmpeg download fails?</div>
        <div class="help-faq-a">A: In Settings > FFmpeg Runtime, switch between Auto, Official, and China mirror, then retry. The download is integrity-checked; do not replace the executable with one from an unknown website.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Can I install FFmpeg manually?</div>
        <div class="help-faq-a">A: For Desktop, use the managed runtime in Settings. CLI may use FFmpeg from PATH or TOOLKNIT_FFMPEG_PATH; that configuration is separate from Desktop.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What are Whisper and LibreOffice used for?</div>
        <div class="help-faq-a">A: Whisper models run local audio/video transcription; the recommended Small model is about 465 MB. LibreOffice powers Excel to PDF, PPT to PDF, and PPT to Image; its download is about 356 MB. Both are optional.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Why does installation continue after download reaches 100%?</div>
        <div class="help-faq-a">A: 100% means network transfer is complete. Hash verification, extraction, or installation may still be running. Wait until the UI explicitly reports completion.</div>
      </div>
    </div>`
  },

  'faq-privacy': {
    title: 'Privacy & Security',
    html: `<div class="help-doc">
      <h2>FAQ - Privacy & Security</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Are my files safe?</div>
        <div class="help-faq-a">A: Local PDF, PPT, image, media, text, and hardware processing does not upload source files. The UI explains any text or metadata an AI action needs before it is sent.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Do AI tools save my data?</div>
        <div class="help-faq-a">A: AI tools send required text to your selected DeepSeek, OpenAI, Qwen, Moonshot, or custom compatible endpoint. Provider retention follows that provider's policy. Keys are stored locally, and CLI/MCP never inherits the desktop key automatically.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Is PDF encryption secure?</div>
        <div class="help-faq-a">A: PDF encryption uses industry-standard encryption algorithms. Security depends on password strength. We recommend using passwords of 8+ characters with letters, numbers, and special characters.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Does the app collect usage data?</div>
        <div class="help-faq-a">A: ToolKnit has no built-in behavior analytics or advertising tracker. Support Author reads public GitHub project data such as stars; website, GitHub, and feedback actions open their corresponding external links.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Does Screen Color Picker save or upload my screen?</div>
        <div class="help-faq-a">A: No. Only after an explicit click or shortcut does it sample the 21×21 pixels around the crosshair in memory. It saves no screenshot and uploads no screen content.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Does AI Large File Cleanup read file contents?</div>
        <div class="help-faq-a">A: No. Scanning is local. AI review receives metadata such as name, size, type, time, relative folder hint, and risk reason, never file contents or a full absolute path.</div>
      </div>
    </div>`
  },

  'transcription': {
    title: 'Audio & Video to Text',
    html: `<div class="help-doc"><h2>Audio & Video to Text</h2><p>Use the bundled offline Whisper engine to recognize Chinese and English in local audio or video. Media files are never uploaded.</p><h3>First use</h3><ol class="help-steps"><li>Open Settings and choose Offline transcription models</li><li>Small is recommended; Base is faster and smaller, while Medium uses more disk space for higher quality</li><li>Choose automatic, official, or China mirror download. A verified model works offline afterwards</li></ol><h3>Outputs and refinement</h3><p>Every run keeps the original JSON, SRT, and TXT. When AI refinement is enabled, only recognized subtitle text is sent to your configured AI provider; subtitle IDs and timecodes cannot be added, removed, split, or merged.</p><div class="help-note"><p>AI can improve punctuation, grammar, and clear context mistakes, but cannot hear the source audio. Verify names, numbers, and unclear speech against the original recording.</p></div></div>`
  },

  'large-file-cleanup': {
    title: 'AI Large File Cleanup',
    html: `<div class="help-doc">
      <h2>AI Large File Cleanup</h2>
      <p>This tool scans a chosen folder for large files and moves confirmed items to the Windows Recycle Bin. It is designed for Downloads, temporary export folders, screen recordings, installers, and archives.</p>

      <h3>Recommended workflow</h3>
      <ol class="help-steps">
        <li>Choose a specific folder such as Downloads, Videos, Desktop temp, or an export folder. Do not scan an entire drive.</li>
        <li>Keep the default <strong>50MB</strong> threshold and start with Video-first or All large files.</li>
        <li>Review size, category, folder hint, and local risk notes in the table.</li>
        <li>If an AI key is configured, click AI analysis to get delete / keep / review suggestions from metadata only.</li>
        <li>Select only files you personally confirm, then click Move to Recycle Bin. Files can be restored from the Recycle Bin.</li>
      </ol>

      <h3>Privacy and safety</h3>
      <ul>
        <li><strong>Scanning is local and read-only</strong>: file contents are not opened and original files are not modified.</li>
        <li><strong>AI receives metadata only</strong>: name, size, category, modified time, relative folder hint, and local risk reason. File contents and absolute local paths are not sent.</li>
        <li><strong>High-risk protection</strong>: chat folders, project/source folders, and model/development packages are marked high-risk. Even if AI says delete, the desktop safety layer changes that to manual review.</li>
        <li><strong>No permanent deletion</strong>: cleanup moves files to the Windows Recycle Bin by default.</li>
      </ul>

      <div class="help-note"><p>The safest habit: scan Downloads and temporary export folders first. Project repositories, chat folders, model folders, and important document folders should always be reviewed manually.</p></div>
    </div>`
  },

  'c-drive-cleanup': {
    title: 'C-Drive Cleanup',
    html: `<div class="help-doc">
      <h2>C-Drive Cleanup</h2>
      <p>Clean system caches and temporary space in three risk tiers. Each tier runs independently, and a mask explains the impact before a 5-second confirmation countdown.</p>

      <h3>Three risk tiers</h3>
      <ul>
        <li><strong>Low risk</strong>: user / Windows temp files, browser cache, thumbnails, shader caches, crash reports, and network cache. The system rebuilds these automatically.</li>
        <li><strong>Medium risk</strong>: Windows Update cache, Delivery Optimization cache, Windows logs, and developer caches. Some update components may need to be re-downloaded.</li>
        <li><strong>High risk</strong>: hibernation file, system restore points, and Recycle Bin. This turns off hibernation / fast startup, deletes existing restore points, and empties the Recycle Bin.</li>
      </ul>

      <h3>Administrator rights</h3>
      <p>System-level caches require administrator rights. If the app is not elevated, opening this page prompts you to restart as administrator, which triggers UAC and relaunches automatically. You can also quit and run the app as administrator manually.</p>

      <h3>Privacy and safety</h3>
      <ul>
        <li><strong>Read-only scan</strong>: the scan only estimates space and never writes.</li>
        <li><strong>Permanent deletion</strong>: cache and system-space items are permanently deleted, not sent to the Recycle Bin. Downloads, Documents, Desktop, Pictures, Music, Videos, and chat history are never cleaned.</li>
        <li><strong>Whitelist and skip-locked</strong>: only fixed whitelist directories are touched; in-use and protected files are skipped, and symlinks / junctions are never followed.</li>
      </ul>

      <div class="help-note"><p>The high-risk tier changes system capabilities, so read the mask carefully before running. Hibernation can be re-enabled later, but deleted restore points and Recycle Bin contents cannot be recovered.</p></div>
    </div>`
  },

  'color-space-compare': {
    title: 'Color Space Compare',
    html: `<div class="help-doc">
      <h2>Color Space Compare</h2>
      <p>Link OKLCH, OKLab, CIELAB D65, CIELCH D65, RGB, HSL, HSV, and approximate CMYK in real time. Drag any track or enter an exact value to update every other model.</p>
      <h3>Exact values and track ranges</h3>
      <p>A converted channel may exceed its visual track. The numeric field keeps the exact value while the handle stays at the edge with a dashed outline; step controls move smoothly from the real value instead of snapping to the boundary.</p>
      <h3>Gamuts and preview</h3>
      <p>The page checks sRGB, Display P3, Adobe RGB, and Rec.2020. When a color exceeds sRGB, the screen preview is mapped to a displayable color while copied model values retain the original calculation.</p>
      <div class="help-note"><p>CIELAB / CIELCH use a D65 white point, unlike the common D50 Lab semantics in CSS Color 4. CMYK is device-independent approximation; production print work should use the target device's ICC profile.</p></div>
    </div>`
  },

  'developer-tools': {
    title: 'Developer Tools',
    html: `<div class="help-doc"><h2>Developer Tools in 3.2</h2><p>This release adds local-first tools that load on demand and release Workers, canvases, and temporary jobs when closed.</p><h3>Markdown Document Editor</h3><p>GFM, task lists, Mermaid, math, outline navigation, draft recovery, and offline Markdown/HTML export are supported. Local images are organized into an assets folder during export.</p><h3>Smart Color Replacement</h3><p>Sample source and target colors, tune perceptual tolerance, feathering, luminance preservation, and 8-connected smart protection. Preview work runs in a Worker; Rust exports at original resolution.</p><h3>Hash &amp; Crypto</h3><p>Includes common hashes, HMAC, SM algorithms, AES file encryption, RSA, and SM2. Legacy algorithms are compatibility-only, and sensitive inputs are not persisted.</p></div>`
  },
  'hardware-tools': {
    title: 'Hardware Tools Overview',
    html: `<div class="help-doc">
      <h2>Hardware Tools Overview</h2>
      <p>Hardware tools provide local, read-only system information for checking configuration, drivers, disk space, network devices, and power status. They are a lightweight system-info panel, not a hardware writer or optimizer.</p>

      <h3>Available pages</h3>
      <ul>
        <li><strong>System Overview</strong>: Windows version, device model, core hardware, firmware security, and disk-space summary.</li>
        <li><strong>CPU & Memory</strong>: CPU cores/threads, clocks, cache, virtualization flags, memory total, slots, brand, model, and configured clock.</li>
        <li><strong>GPU & Display</strong>: GPU name, memory, driver version, display resolution, refresh rate, and other fields Windows exposes.</li>
        <li><strong>Mainboard & Firmware</strong>: motherboard, BIOS/UEFI, Secure Boot, TPM, and PCI-device information.</li>
        <li><strong>Storage & Health</strong>: physical disks, volumes, capacity, free space, interface, and readable health status.</li>
        <li><strong>Network & Devices</strong>: network adapters, IP summary, Bluetooth, audio, camera, keyboard, mouse, and peripheral summaries.</li>
        <li><strong>Power & Sensors</strong>: power plan, battery, ACPI thermal zones, and fan fields when Windows exposes them.</li>
      </ul>

      <h3>Read limitations</h3>
      <p>Some hardware fields are restricted by Windows or by the device vendor. Memory SPD/XMP profiles, detailed SMART fields, and real-time GPU temperatures are not always available to a normal desktop app. ToolKnit shows what the system can safely return and marks missing data as unavailable.</p>

      <div class="help-note"><p>Hardware tools are viewers only. They do not change BIOS settings, power plans, registry values, or drivers.</p></div>
    </div>`
  },

  'faq-update': {
    title: 'Updates',
    html: `<div class="help-doc">
      <h2>FAQ - Updates</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: How do I check for updates?</div>
        <div class="help-faq-a">A: Check GitHub Releases or the project release page for new installers and release notes. Settings shows the installed version only; updates are never downloaded silently or forced in the background.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: How do I install a new version?</div>
        <div class="help-faq-a">A: Close the main window, choose Exit from the ToolKnit tray menu, then run the new installer over the existing installation. Restart ToolKnit and confirm the version in Settings.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Will an upgrade remove my settings or models?</div>
        <div class="help-faq-a">A: A normal in-place upgrade does not intentionally clear local app data. Settings, FFmpeg, Whisper models, and LibreOffice normally remain unless you choose to clear app data while uninstalling.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What if the update fails?</div>
        <div class="help-faq-a">A: Make sure the app has exited from the system tray, then run the installer again. If Windows reports a locked file, close any app previewing an output file and retry.</div>
      </div>
    </div>`
  }
};

HELP_CONTENT_EN['developer-tools'].html += `<h3>Common Developer Utilities</h3><ul><li>JSON formatter: validate, pretty-print, and minify.</li><li>Base64 codec: UTF-8 safe text encoding and decoding.</li><li>URL codec: encode and decode query parameters and path fragments.</li><li>UUID generator: batch RFC 4122 UUID v4 generation.</li><li>JWT viewer: decode Header and Payload locally without signature verification.</li></ul>`;

export default HELP_CONTENT_EN;
