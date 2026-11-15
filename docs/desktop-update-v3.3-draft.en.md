# ToolKnit Desktop 3.3.0

Release candidate notes. This version is not public yet; the release date and assets remain to be confirmed.

## What changed

- **75 desktop tools in 12 categories.** New file search and Word to PDF, with improved local OCR and scanned PDF conversion.
- **File search:** Chinese filenames, pinyin, extension filters, sorting and Explorer reveal. Choose the main window or desktop capsule. Image results show local thumbnails, including static SVG previews. Loading more and refreshing preserve your position. Indexing stops when the app fully exits.
- **Word to PDF:** convert DOC and DOCX files individually or in batches. Cancel, retry or send the result to PDF Editor.
- **Local OCR and translation:** screenshots and scanned PDFs share PP-OCRv5. Recognition works offline after the initial model download. Screenshot translation uses local OCR and local translation without an AI key.
- **PDF to Word:** improved text placement, fonts, tables and common math symbols. Complex diagrams remain images while surrounding text stays editable. Choose pages, edit the result and export DOCX.
- **PDF editing and splitting:** faster large-document previews and page switching. Fixed export failures after deleting, merging or splitting pages, including separate-page ZIP export. PDF Editor exports selected pages.
- **Screenshots and recording:** reduced startup work and repeated rendering. Fixed overlays remaining after Escape and conflicts during rapid reopen. Capturing keeps the main window visible. Shortcut conflicts no longer prevent recording mode from enabling.
- **UI and reliability:** improved file reveal, themes, status updates and floating-window recovery. Updated the first-run release notice, web shortcuts and support page.
- **Downloads and licensing:** optional runtimes and models use pinned Qicaiyun downloads with integrity checks. FFmpeg uses a traceable build. Author-owned code, including the PDF-to-Word Engine and CLI/MCP, uses MIT.

## Download and compatibility

- Windows x64 installer: `toolknit-desktop_3.3.0_x64-setup.exe`, with a SHA-256 file. This candidate is not Authenticode-signed.
- Windows 10 version 1803 / build 17134 or later, including Windows 11. Installing WebView2 requires a connection if the runtime is missing.
- The 3.3.0 source offers **78 CLI/MCP capabilities**. The latest published npm package remains **3.2.0**, published October 24, 2026. The 3.3.0 archive is prepared but not published. [Published npm version](https://www.npmjs.com/package/@toolknit/cli/v/3.2.0).
- Originals are preserved by default. Check complex equations, handwriting, vertical text and low-quality scans; some regions remain images.
- Tools process files locally where supported. Explicit AI actions send selected content to your configured model provider.
- Use [ToolKnit Web](https://toolknit.com/) for quick access and lightweight tasks, or [Desktop](https://toolknit.com/exe.html) for local files, system integration and offline workflows.

## Source license

Author-owned code uses MIT. Modification, redistribution and commercial use are permitted under its terms; retain copyright and permission notices. A ToolKnit.com credit and normal DoFollow link are appreciated, not required. Third-party components, earlier grants, branding and the hosted web service retain their own boundaries.

[Source and licenses](https://github.com/ZihangDong/toolknit-desktop) · [Full changelog](https://github.com/ZihangDong/toolknit-desktop/blob/main/changelog.md)
