export const HELP_CONTENT_EN = {
  'overview': {
    title: 'Overview',
    html: `<div class="help-doc">
      <h2>ToolKnit Overview</h2>
      <p>ToolKnit is a <strong>fully local</strong> multi-functional toolbox desktop app, covering eight tool categories: PDF, Image, Audio, Video, Text, Calculator, Creative, and AI. All file processing is done locally — no uploads to servers.</p>

      <h3>Tool Categories</h3>
      <div class="help-tool-grid">
        <div class="help-tool-card"><div class="help-tool-card-name">PDF Tools</div><div class="help-tool-card-desc">Merge, split, rotate, encrypt, decrypt, compress, text enhance</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Image Tools</div><div class="help-tool-card-desc">Format conversion, compression, long-image stitching, icon generator</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Audio Tools</div><div class="help-tool-card-desc">Format conversion, BPM detection, clipping, video audio extraction</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Video Tools</div><div class="help-tool-card-desc">Format conversion, full-resolution frame export, GIF clips up to 30 seconds</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Text Tools</div><div class="help-tool-card-desc">Audio/video transcription, text statistics, text formatting</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Calculator</div><div class="help-tool-card-desc">Body fat, timestamp, mortgage, interest, password generation</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">Creative Tools</div><div class="help-tool-card-desc">Color extraction, typing test</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">AI Tools</div><div class="help-tool-card-desc">AI polish, translate, editable documents, editable tables</div></div>
      </div>

      <h3>Key Features</h3>
      <ul>
        <li><strong>100% Local Processing</strong>: All file operations are done on your device — no files uploaded to any server</li>
        <li><strong>Batch Processing</strong>: Support for batch file processing to boost productivity</li>
        <li><strong>Drag & Drop</strong>: Drag files directly onto tool pages for instant processing</li>
        <li><strong>Bilingual Interface</strong>: Supports Chinese and English switching</li>
        <li><strong>Flexible delivery</strong>: Use the desktop UI, CLI, or IDE Agent for the task that fits your workflow</li>
        <li><strong>On-demand media runtime</strong>: Audio/video tools prompt you to install FFmpeg when it is needed</li>
      </ul>

      <div class="help-note">
        <p>Some tools (such as audio conversion, video conversion) require the FFmpeg extension. You'll be prompted to download it on first use, after which it works offline.</p>
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
        <li>Disk Space: At least 200MB (≈300MB with FFmpeg extension)</li>
      </ul>

      <h3>Installation Steps</h3>
      <ol class="help-steps">
        <li>Download the ToolKnit installer (<code>.exe</code> setup program)</li>
        <li>Double-click the installer and choose the installation path</li>
        <li>Wait for installation to complete — a ToolKnit shortcut will appear on your desktop</li>
        <li>Double-click the shortcut to launch the app</li>
      </ol>

      <h3>First Launch</h3>
      <p>If you use audio/video tools, the app asks you to install the FFmpeg runtime when it is needed. The current Windows download is about 30 MB and is verified before it is used.</p>

      <div class="help-note">
        <p>In Settings you can choose Auto, Official, or China mirror for the FFmpeg and offline-model downloads.</p>
      </div>
    </div>`
  },

  'settings': {
    title: 'Settings & Preferences',
    html: `<div class="help-doc">
      <h2>Settings & Preferences</h2>
      <p>Click the <strong>settings icon</strong> at the bottom of the sidebar. These are app-level settings; they do not alter your source files.</p>

      <h3>Language Switching</h3>
      <p>Supports <strong>Chinese</strong> and <strong>English</strong>. The interface updates instantly upon switching.</p>

      <h3>AI Key</h3>
      <p>AI Document, AI Table, AI Polish, AI Translate, and optional transcription refinement need an AI-provider key here. The key is kept locally. Local PDF, image, audio, and video tools do not need a key.</p>

      <h3>Offline Transcription Models</h3>
      <p>Audio & Video to Text needs one local model before first use. <strong>Small</strong> is the default recommendation; Base is smaller and faster, while Medium prioritizes quality. Recognition works offline after download. Only optional AI refinement sends recognized text to your provider; media is never uploaded.</p>

      <h3>FFmpeg Runtime</h3>
      <p>Audio conversion, clipping, audio extraction, video conversion, frame export, GIF export, and transcription preparation require FFmpeg. It is no longer bundled into the installer. Install it from Auto, Official, or China mirror here, or accept the dependency prompt when entering a supported tool.</p>

      <h3>Default Storage Location</h3>
      <p>The default is <strong>ToolKnit in Downloads</strong>. You can choose any existing folder. Outputs are grouped automatically under tool-specific subfolders such as <code>PDF_Merge</code>, <code>PDF_Split</code>, <code>Images</code>, <code>Videos</code>, <code>Transcripts</code>, <code>AI_Doc</code>, and <code>AI_Table</code>; source files are not overwritten.</p>

      <h3>Custom Background</h3>
      <p>Upload an image or video for the home and category pages. A contrast layer remains above it so content stays readable. Use Clear to return to the ToolKnit default animated background immediately.</p>

      <h3>Help & Feedback</h3>
      <p>Click "Help Center" to open this help page; click "Feedback" to submit bug reports or suggestions.</p>
    </div>`
  },

  'cli-guide': {
    title: 'CLI Basics',
    html: `<div class="help-doc">
      <h2>CLI Basics</h2>
      <p>Use the <strong>desktop app</strong> for visual selection and preview, the <strong>CLI</strong> for PowerShell and scripts, and an <strong>IDE Agent</strong> when you prefer natural language. The CLI does not need the desktop app to stay open.</p>
      <h3>First checks</h3>
      <ol class="help-steps"><li>After installing ToolKnit CLI, run <code>toolknit doctor</code>.</li><li>Run <code>toolknit --help</code> for every command group.</li><li>Use <code>toolknit help &lt;group&gt; &lt;tool&gt;</code> for parameters and examples, such as <code>toolknit help video gif</code>.</li></ol>
      <h3>Command groups</h3>
      <ul><li><code>pdf</code>: inspect, merge, split, rotate, encrypt, decrypt, compress, and scan enhancement.</li><li><code>audio</code>: format conversion, BPM, clipping, and audio-track extraction.</li><li><code>model</code> and <code>transcribe</code>: local speech-model management plus TXT, SRT, and JSON transcription.</li><li><code>video</code>: conversion, exact frame export, and GIF clips up to 30 seconds.</li><li><code>text stats</code>, <code>image colors</code>, and <code>image stitch</code>: local analysis and long-image stitching.</li><li><code>ai-doc</code> and <code>ai-table</code>: create, inspect, edit, undo, and render editable projects.</li></ul>
      <h3>Safe defaults</h3>
      <p>Every write command needs an explicit destination. Existing files are never replaced unless you pass <code>--overwrite</code>. Passwords are not accepted as command-line arguments. JSON, piped output, and MCP mode do not include the decorative CLI banner.</p>
      <div class="help-note"><p>Desktop and CLI/Agent use separate AI-provider configuration. The desktop key is never copied into CLI/MCP automatically; only AI document, AI table, and optional AI refinement need a CLI/MCP key.</p></div>
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
        <p>First-time use of audio conversion requires downloading the FFmpeg extension (~80-100MB). After download, it works offline.</p>
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
    html: `<div class="help-doc"><h2>Color Extractor</h2><p>Extract the main colors from one PNG, JPG, or WebP image and copy the color information you need.</p><h3>How to use it</h3><ol class="help-steps"><li>Upload or drop an image</li><li>Wait for local analysis and review the color circles</li><li>Open a color for details or copy its HEX value; select another image at any time</li></ol><div class="help-note"><p>CLI/IDE Agent can inspect one explicit image path and return its palette without uploading the image or writing an output file.</p></div></div>`
  },

  'typing-test': {
    title: 'Typing Test',
    html: `<div class="help-doc"><h2>Typing Test</h2><p>Choose Chinese or English, a difficulty level, and a duration, then type against the prompt to measure speed and accuracy.</p><h3>How to use it</h3><ol class="help-steps"><li>Set language, difficulty, and duration</li><li>Select Start Test, then focus the input area to type</li><li>Review WPM and accuracy when it finishes; use Restart to try again</li></ol><div class="help-note"><p>This interactive tool is desktop-only and is not exposed to CLI or IDE Agents.</p></div></div>`
  },

  'ai-polish': {
    title: 'AI Polish',
    html: `<div class="help-doc">
      <h2>AI Text Polish</h2>
      <p>Intelligently analyze and optimize text expression with multiple polish directions.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Enter the text you want to polish</li>
        <li>Select a polish direction (formal/concise/academic/conversational, etc.)</li>
        <li>Click "Start Polish"</li>
        <li>Compare the original and polished text</li>
        <li>Copy the satisfactory result</li>
      </ol>
    </div>`
  },

  'ai-translate': {
    title: 'AI Translate',
    html: `<div class="help-doc">
      <h2>AI Translate</h2>
      <p>Sentence-by-sentence translation with highlighted correspondences.</p>

      <h3>How to Use</h3>
      <ol class="help-steps">
        <li>Enter the text you want to translate</li>
        <li>Select the source and target languages</li>
        <li>Click "Start Translate"</li>
        <li>View the sentence-by-sentence translation results</li>
      </ol>
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
      <div class="help-agent-scope"><p>The MCP server currently exposes <strong>30 capabilities</strong>. In everyday terms:</p><ul><li><strong>PDF (8)</strong>: inspect, merge, selected-page split, rotate, encrypt, decrypt, compress, and scan enhancement.</li><li><strong>Audio (4)</strong>: convert, BPM detection, clip by exact times, and extract a selected video track.</li><li><strong>Audio/video transcription (4)</strong>: list, install, and choose local models, then create TXT, SRT, and JSON. Optional AI refinement sends recognized text only, never media.</li><li><strong>Video (3)</strong>: convert, export a frame at an exact millisecond, and create a GIF from an explicit range up to 30 seconds.</li><li><strong>Text and images (3)</strong>: UTF-8 file statistics, dominant-color extraction, and 2-100 image stitching.</li><li><strong>AI document (4)</strong>: create a PDF, inspect its editable project, edit numbered controls, and render again.</li><li><strong>AI table (4)</strong>: create CSV/XLSX/PDF/PNG, inspect its project, edit stable row/column/chart IDs, and render again.</li></ul></div>

      <h3>Desktop-only tools</h3>
      <p>Image format conversion, image compression, icon generation, text formatting, calculators, password generation, typing test, AI Polish, and AI Translate are intentionally desktop-only today. Some are unsafe or impractical to run through a terminal or an Agent conversation.</p>

      <h3>Connect once</h3>
      <ol class="help-steps">
        <li>After installing ToolKnit CLI, run <code>toolknit doctor</code> in PowerShell. Local file tools need no AI key; AI documents, AI tables, and optional AI refinement do.</li>
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
        <p class="help-agent-prompt-text">You must call the ToolKnit MCP tool toolknit_ai_document. Do not merely draft the content in chat. Generate a 4-page English A4 PDF titled "ToolKnit v1.2 Product Plan" in the current IDE project's toolknit-output folder. Do not overwrite existing files. After generation, report the absolute paths of the PDF, .toolknit.json project, preview directory, every high-resolution numbered map, and overview map. Then call toolknit_pdf_inspect and confirm the real PDF has exactly 4 pages.</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="You must call the ToolKnit MCP tool toolknit_ai_document. Do not merely draft the content in chat. Generate a 4-page English A4 PDF titled ToolKnit v1.2 Product Plan in the current IDE project's toolknit-output folder. Do not overwrite existing files. After generation, report the absolute paths of the PDF, .toolknit.json project, preview directory, every high-resolution numbered map, and overview map. Then call toolknit_pdf_inspect and confirm the real PDF has exactly 4 pages.">Copy prompt</button>
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
        <div class="help-faq-a">A: No. All file processing is done locally. Files are never uploaded to any server. AI tools only send text content to the AI API for processing.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Which operating systems are supported?</div>
        <div class="help-faq-a">A: Currently supports Windows 10/11 (64-bit). macOS and Linux versions are being planned.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: How do I switch languages?</div>
        <div class="help-faq-a">A: Click the settings icon at the bottom of the sidebar, then select Chinese or English in the "Language" section.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Where are my files saved?</div>
        <div class="help-faq-a">A: By default, files are saved under ToolKnit in Downloads and grouped into tool-specific subfolders such as PDF_Merge, Images, Videos, Transcripts, and AI_Doc. You can view, open, or change the root folder in Settings.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Is batch processing supported?</div>
        <div class="help-faq-a">A: Yes. Most tools (PDF merge, image conversion, audio conversion, etc.) support batch file processing.</div>
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
        <div class="help-faq-a">A: The current Windows runtime download is about 30 MB. It is installed under ToolKnit local app data, not your output folder, and works offline after installation.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What if the FFmpeg download fails?</div>
        <div class="help-faq-a">A: In Settings > FFmpeg Runtime, switch between Auto, Official, and China mirror, then retry. The download is integrity-checked; do not replace the executable with one from an unknown website.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Can I install FFmpeg manually?</div>
        <div class="help-faq-a">A: For Desktop, use the managed runtime in Settings. CLI may use FFmpeg from PATH or TOOLKNIT_FFMPEG_PATH; that configuration is separate from Desktop.</div>
      </div>
    </div>`
  },

  'faq-privacy': {
    title: 'Privacy & Security',
    html: `<div class="help-doc">
      <h2>FAQ - Privacy & Security</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Are my files safe?</div>
        <div class="help-faq-a">A: Yes. All file processing (PDF, image, audio, video, etc.) is done locally and never uploaded to any server.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Do AI tools save my data?</div>
        <div class="help-faq-a">A: AI tools (polish, translate, chat, etc.) send text content to the AI API for processing, but do not save your input locally.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Is PDF encryption secure?</div>
        <div class="help-faq-a">A: PDF encryption uses industry-standard encryption algorithms. Security depends on password strength. We recommend using passwords of 8+ characters with letters, numbers, and special characters.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: Does the app collect usage data?</div>
        <div class="help-faq-a">A: ToolKnit does not collect any user privacy data and contains no tracking code or analytics tools.</div>
      </div>
    </div>`
  },

  'transcription': {
    title: 'Audio & Video to Text',
    html: `<div class="help-doc"><h2>Audio & Video to Text</h2><p>Use the bundled offline Whisper engine to recognize Chinese and English in local audio or video. Media files are never uploaded.</p><h3>First use</h3><ol class="help-steps"><li>Open Settings and choose Offline transcription models</li><li>Small is recommended; Base is faster and smaller, while Medium uses more disk space for higher quality</li><li>Choose automatic, official, or China mirror download. A verified model works offline afterwards</li></ol><h3>Outputs and refinement</h3><p>Every run keeps the original JSON, SRT, and TXT. When AI refinement is enabled, only recognized subtitle text is sent to your configured AI provider; subtitle IDs and timecodes cannot be added, removed, split, or merged.</p><div class="help-note"><p>AI can improve punctuation, grammar, and clear context mistakes, but cannot hear the source audio. Verify names, numbers, and unclear speech against the original recording.</p></div></div>`
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
        <div class="help-faq-a">A: A normal in-place upgrade does not intentionally clear local app data. Settings, downloaded FFmpeg, and offline models remain unless you chose to clear app data while uninstalling the old version.</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q: What if the update fails?</div>
        <div class="help-faq-a">A: Make sure the app has exited from the system tray, then run the installer again. If Windows reports a locked file, close any app previewing an output file and retry.</div>
      </div>
    </div>`
  }
};

export default HELP_CONTENT_EN;
