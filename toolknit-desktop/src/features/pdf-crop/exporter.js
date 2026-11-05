import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
import JSZip from 'jszip';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import {
  createPdfCropFileName,
  createPdfCropPageFileName,
  exportCroppedPdf,
  exportCroppedPdfPage,
  sanitizePdfCropBaseName,
  splitCroppedPdfPages
} from './core.js';

export function createPdfCropExporter({ isTauri, getOutputDir, getInvoke }) {
  const lifecycle = createLifecycleScope();
  const objectUrls = new Set();

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    lifecycle.timeout(() => {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1600);
  }

  async function writeOutput(bytes, directory, fileName, mimeType) {
    if (isTauri) {
      const invoke = await getInvoke();
      return writeUniqueBinaryFile(invoke, {
        directory,
        fileName,
        bytes
      });
    }
    downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
    return `${directory}/${fileName}`;
  }

  async function run({
    active,
    bytes,
    crops,
    currentIndex,
    pageCount,
    outputName,
    mode,
    target = 'all',
    assertOperation,
    setProgress,
    text
  }) {
    const baseName = sanitizePdfCropBaseName(outputName);
    const outputDir = await getOutputDir('PDF_Crop');
    assertOperation(active);
    let outputBytes;
    let outputFileName;
    let mimeType;
    let outputCount;
    let resultMode = mode;
    let exportedPageNumber = null;

    if (target === 'current') {
      const pageIndex = Number(currentIndex);
      outputBytes = await exportCroppedPdfPage({
        bytes,
        crop: crops?.[pageIndex],
        pageIndex,
        shouldCancel: () => active.cancelled || !active.isCurrent(),
        onProgress(update) {
          assertOperation(active);
          setProgress(8 + Math.round((update.completed / update.total) * 78), text('home.pdfCrop.croppingPage', update));
        }
      });
      outputFileName = createPdfCropPageFileName(baseName, pageIndex + 1, pageCount);
      mimeType = 'application/pdf';
      outputCount = 1;
      resultMode = 'current';
      exportedPageNumber = pageIndex + 1;
    } else if (mode === 'zip') {
      const split = await splitCroppedPdfPages({
        bytes,
        crops,
        baseName,
        shouldCancel: () => active.cancelled || !active.isCurrent(),
        onProgress(update) {
          assertOperation(active);
          setProgress(8 + Math.round((update.completed / update.total) * 62), text('home.pdfCrop.croppingPage', update));
        }
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
        setProgress(72 + Math.round(metadata.percent * 0.2), text('home.pdfCrop.packaging'));
      });
      outputFileName = createPdfCropFileName(baseName, 'zip');
      mimeType = 'application/zip';
      outputCount = pageCount;
    } else {
      outputBytes = await exportCroppedPdf({
        bytes,
        crops,
        shouldCancel: () => active.cancelled || !active.isCurrent(),
        onProgress(update) {
          assertOperation(active);
          setProgress(8 + Math.round((update.completed / update.total) * 78), text('home.pdfCrop.croppingPage', update));
        }
      });
      outputFileName = createPdfCropFileName(baseName);
      mimeType = 'application/pdf';
      outputCount = 1;
    }

    assertOperation(active);
    setProgress(94, text('home.pdfCrop.writingFile'));
    const outputPath = await writeOutput(outputBytes, outputDir, outputFileName, mimeType);
    assertOperation(active);
    outputBytes = null;
    return {
      target,
      mode: resultMode,
      outputCount,
      outputDir,
      outputFileName,
      outputPath,
      pageCount,
      exportedPageNumber
    };
  }

  function dispose() {
    lifecycle.dispose();
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
  }

  return { dispose, run };
}
