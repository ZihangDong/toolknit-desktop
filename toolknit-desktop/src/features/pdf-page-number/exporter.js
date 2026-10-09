import JSZip from 'jszip';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import {
  createPdfPageNumberFileName,
  exportPdfWithPageNumbers,
  sanitizePdfPageNumberBaseName,
  splitNumberedPdfPages
} from '../../pdf-page-number-core.js';

export function createPdfPageNumberExporter({
  isTauri = false,
  getInvoke,
  getOutputDir
} = {}) {
  const lifecycle = createLifecycleScope();
  const objectUrls = new Map();
  let fontBytesPromise = null;

  function revokeObjectUrl(url) {
    const timer = objectUrls.get(url);
    if (timer) clearTimeout(timer);
    objectUrls.delete(url);
    URL.revokeObjectURL(url);
  }

  lifecycle.use(() => {
    for (const url of objectUrls.keys()) revokeObjectUrl(url);
  });

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    objectUrls.set(url, setTimeout(() => revokeObjectUrl(url), 1600));
  }

  async function ensureFontBytes() {
    if (!fontBytesPromise) {
      fontBytesPromise = fetch('/assets/fonts/NotoSansSC-Regular.ttf')
        .then(response => {
          if (!response.ok) throw new Error('font fetch failed');
          return response.arrayBuffer();
        })
        .then(buffer => new Uint8Array(buffer))
        .catch(error => {
          fontBytesPromise = null;
          throw error;
        });
    }
    return fontBytesPromise;
  }

  async function writeOutput(bytes, directory, fileName, mimeType) {
    if (isTauri) {
      const invoke = await getInvoke();
      return invoke('write_unique_file_bytes', {
        directory,
        fileName,
        bytes: Array.from(bytes)
      });
    }
    downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
    return `${directory}/${fileName}`;
  }

  async function run({
    active,
    sources,
    pages,
    selectedIds,
    settings,
    outputName,
    mode,
    assertOperation,
    setProgress,
    text
  }) {
    const fontBytes = await ensureFontBytes();
    assertOperation(active);
    const numberedBytes = await exportPdfWithPageNumbers({
      sources: sources.map(source => ({ id: source.id, bytes: source.bytes })),
      pages,
      settings: { ...settings, selectedIds },
      fontBytes,
      shouldCancel: () => active.cancelled || !active.isCurrent(),
      onProgress: update => setProgress(
        6 + Math.round(update.percent * 0.6),
        text('home.pdfPageNumber.numberingPage', {
          current: update.completed,
          total: update.total
        })
      )
    });
    assertOperation(active);
    const baseName = sanitizePdfPageNumberBaseName(outputName || sources[0]?.name || 'document');
    const outputDir = await getOutputDir('PDF_Page_Number');
    assertOperation(active);
    let outputBytes = numberedBytes;
    let fileName = createPdfPageNumberFileName(baseName, 'pdf');
    let mimeType = 'application/pdf';
    if (mode === 'zip') {
      setProgress(68, text('home.pdfPageNumber.splittingPages'));
      const split = await splitNumberedPdfPages({
        bytes: numberedBytes,
        baseName,
        shouldCancel: () => active.cancelled || !active.isCurrent(),
        onProgress: update => setProgress(
          68 + Math.round((update.completed / update.total) * 18),
          text('home.pdfPageNumber.splittingProgress', update)
        )
      });
      assertOperation(active);
      const zip = new JSZip();
      split.forEach(file => zip.file(file.fileName, file.bytes));
      outputBytes = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, metadata => {
        assertOperation(active);
        setProgress(86 + Math.round(metadata.percent * 0.1), text('home.pdfPageNumber.packingZip'));
      });
      fileName = createPdfPageNumberFileName(baseName, 'zip');
      mimeType = 'application/zip';
    }
    assertOperation(active);
    setProgress(97, text('home.pdfPageNumber.writingOutput'));
    const outputPath = await writeOutput(outputBytes, outputDir, fileName, mimeType);
    assertOperation(active);
    return {
      outputDir,
      outputPath,
      count: mode === 'zip' ? pages.length : 1,
      mode
    };
  }

  return {
    dispose: () => lifecycle.dispose(),
    run
  };
}
