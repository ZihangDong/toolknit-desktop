import {
  assemblePdf,
  assemblePdfWithTextEdits,
  buildPdfName
} from '../../pdf-editor-core.js';
import { PdfEditorCancelledError } from './errors.js';
import { insertedTextLayout } from '../../core/pdf-inserted-text.js';

export { PdfEditorCancelledError };

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function createPdfEditorExporter({
  isTauri,
  getInvoke,
  getOutputDir,
  t,
  isDisposed,
  hasDocument,
  getActiveOperation,
  getSources,
  getPages,
  getTextEdits,
  getInsertedTexts,
  getInsertedImages,
  getInsertedShapes,
  getEditedTextVisualBox,
  getInsertedTextVisualBox,
  getMainSourceName,
  beginOperation,
  assertOperation,
  beginCommit,
  endOperation,
  showProcess,
  setLocalizedProgress,
  showToast,
  messageForError,
  showSuccess,
  captureEditorSnapshot,
  setSavedSnapshot
}) {
  let fontRegularBytes = null;
  let fontSemiboldBytes = null;

  function buildAssembleArgs(ids) {
    const sources = getSources();
    const pages = getPages();
    const sourceIndexById = new Map(sources.map((source, index) => [source.id, index]));
    const byId = new Map(pages.map(page => [page.id, page]));
    return {
      sources: sources.map(source => ({ name: source.name, bytes: source.bytes })),
      pages: ids
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(page => ({
          sourceIndex: sourceIndexById.get(page.sourceId),
          pageIndex: page.pageIndex,
          rotation: page.rotation
        }))
    };
  }

  async function writePdf(bytes, outputDir, fileName) {
    if (isTauri) {
      const invoke = await getInvoke();
      return invoke('write_unique_file_bytes', {
        directory: outputDir,
        fileName,
        bytes: Array.from(bytes)
      });
    }
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName);
    return `${outputDir}/${fileName}`;
  }

  async function ensureFontBytes() {
    if (fontRegularBytes && fontSemiboldBytes) return;
    try {
      const [regularResponse, semiboldResponse] = await Promise.all([
        fetch('/assets/fonts/NotoSansSC-Regular.ttf'),
        fetch('/assets/fonts/NotoSansSC-Semibold.ttf')
      ]);
      if (!regularResponse.ok || !semiboldResponse.ok) throw new Error('font fetch failed');
      const [regularBytes, semiboldBytes] = await Promise.all([
        regularResponse.arrayBuffer(),
        semiboldResponse.arrayBuffer()
      ]);
      if (new Uint8Array(regularBytes, 0, 1)[0] === 0x3C
        || new Uint8Array(semiboldBytes, 0, 1)[0] === 0x3C) {
        throw new Error('font fetch returned HTML');
      }
      fontRegularBytes = new Uint8Array(regularBytes);
      fontSemiboldBytes = new Uint8Array(semiboldBytes);
    } catch (error) {
      console.error('[PDF Editor] failed to load fonts:', error);
      fontRegularBytes = null;
      fontSemiboldBytes = null;
    }
  }

  function buildTextEditArgs(ids) {
    const pageIndexById = new Map(ids.map((id, index) => [id, index]));
    const edits = [];
    for (const [key, edit] of getTextEdits().entries()) {
      const pageId = String(key).split(':')[0];
      const pageIndex = pageIndexById.get(pageId);
      if (pageIndex == null || !edit?.segment) continue;
      edits.push({
        pageIndex,
        baselineX: edit.segment.baselineX,
        baselineY: edit.segment.baselineY,
        fontSize: edit.segment.fontSize,
        text: edit.newText,
        bold: edit.segment.bold,
        italic: edit.segment.italic,
        rotation: edit.segment.rotation,
        box: edit.baseSegment?.sourceBox
          || edit.baseSegment?.box
          || edit.segment.sourceBox
          || edit.segment.box,
        textBox: getEditedTextVisualBox(edit, edit.segment)
          || edit.segment.box
          || edit.segment.sourceBox
          || edit.baseSegment?.box,
        color: edit.segment.color
      });
    }
    return edits;
  }

  function buildInsertedTextArgs(ids) {
    const pageIndexById = new Map(ids.map((id, index) => [id, index]));
    return getInsertedTexts()
      .filter(object => pageIndexById.has(object.pageId))
      .map(object => {
        const visualBox = getInsertedTextVisualBox(object);
        return {
          pageIndex: pageIndexById.get(object.pageId),
          x: object.x,
          y: object.y,
          width: visualBox.width,
          height: visualBox.height,
          textBox: visualBox,
          lineHeight: insertedTextLayout(object).lineHeight,
          text: object.text,
          fontSize: object.fontSize,
          bold: object.bold,
          rotation: object.rotation,
          color: object.color
        };
      });
  }

  function buildInsertedImageArgs(ids) {
    const pageIndexById = new Map(ids.map((id, index) => [id, index]));
    return getInsertedImages()
      .filter(object => pageIndexById.has(object.pageId))
      .map(object => ({
        pageIndex: pageIndexById.get(object.pageId),
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        bytes: object.bytes,
        mimeType: object.mimeType
      }));
  }

  function buildInsertedShapeArgs(ids) {
    const pageIndexById = new Map(ids.map((id, index) => [id, index]));
    return getInsertedShapes()
      .filter(object => pageIndexById.has(object.pageId))
      .map(object => ({
        pageIndex: pageIndexById.get(object.pageId),
        shapeType: object.shapeType,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        fill: object.fill,
        stroke: object.stroke,
        strokeWidth: object.strokeWidth
      }));
  }

  async function assemble(ids, operation) {
    const args = buildAssembleArgs(ids);
    if (!args.pages.length) throw new Error('No pages to export');
    const textEditArgs = buildTextEditArgs(ids);
    const textObjectArgs = buildInsertedTextArgs(ids);
    const imageObjectArgs = buildInsertedImageArgs(ids);
    const shapeObjectArgs = buildInsertedShapeArgs(ids);
    const progressCallback = ({ done, total }) => {
      assertOperation(operation);
      setLocalizedProgress(10 + Math.round((done / total) * 68), 'assembling');
    };
    if (textEditArgs.length || textObjectArgs.length) await ensureFontBytes();
    if (textEditArgs.length || textObjectArgs.length || imageObjectArgs.length || shapeObjectArgs.length) {
      return assemblePdfWithTextEdits({
        ...args,
        textEdits: textEditArgs,
        textObjects: textObjectArgs,
        imageObjects: imageObjectArgs,
        shapeObjects: shapeObjectArgs,
        fontRegularBytes: fontRegularBytes || undefined,
        fontSemiboldBytes: fontSemiboldBytes || undefined,
        onProgress: progressCallback
      });
    }
    return assemblePdf({ ...args, onProgress: progressCallback });
  }

  async function exportPdf() {
    if (isDisposed() || !hasDocument() || getActiveOperation()) {
      if (getActiveOperation()) showToast(t('home.pdfEditor.busy'));
      return;
    }
    const operation = beginOperation('export');
    showProcess('exporting', 3);
    try {
      const pageIds = getPages().map(page => page.id);
      const bytes = await assemble(pageIds, operation);
      assertOperation(operation);
      const outputDir = await getOutputDir('PDF_Editor');
      assertOperation(operation);
      const fileName = buildPdfName(getMainSourceName(), 'edited');
      setLocalizedProgress(88, 'exporting');
      beginCommit(operation);
      const outputPath = await writePdf(bytes, outputDir, fileName);
      assertOperation(operation);
      setLocalizedProgress(100, 'exporting');
      setSavedSnapshot();
      showSuccess({ outputDir, outputPath, mode: 'export' }, operation.returnFocus);
    } catch (error) {
      const cancelled = operation.cancelled || error instanceof PdfEditorCancelledError;
      if (!isDisposed()) showToast(
        cancelled ? t('home.pdfEditor.cancelled') : messageForError(error, 'export'),
        cancelled ? 4500 : 9000
      );
    } finally {
      endOperation(operation);
    }
  }

  async function extractSelected(ids) {
    if (isDisposed() || !hasDocument() || getActiveOperation()) {
      if (getActiveOperation()) showToast(t('home.pdfEditor.busy'));
      return;
    }
    if (!ids.length) {
      showToast(t('home.pdfEditor.noSelection'));
      return;
    }
    const operation = beginOperation('extract');
    showProcess('extracting', 3);
    try {
      const bytes = await assemble(ids, operation);
      assertOperation(operation);
      const outputDir = await getOutputDir('PDF_Editor');
      assertOperation(operation);
      const fileName = buildPdfName(getMainSourceName(), `extracted_${ids.length}`);
      setLocalizedProgress(88, 'extracting');
      beginCommit(operation);
      const outputPath = await writePdf(bytes, outputDir, fileName);
      assertOperation(operation);
      setLocalizedProgress(100, 'extracting');
      showSuccess({ outputDir, outputPath, mode: 'extract', count: ids.length }, operation.returnFocus);
    } catch (error) {
      const cancelled = operation.cancelled || error instanceof PdfEditorCancelledError;
      if (!isDisposed()) showToast(
        cancelled ? t('home.pdfEditor.cancelled') : messageForError(error, 'extract'),
        cancelled ? 4500 : 9000
      );
    } finally {
      endOperation(operation);
    }
  }

  return {
    exportPdf,
    extractSelected,
    dispose() {
      fontRegularBytes = null;
      fontSemiboldBytes = null;
    }
  };
}
