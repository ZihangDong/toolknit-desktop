import { createRequire } from 'node:module';
import path from 'node:path';
import { ToolKnitError } from './errors.mjs';

const nodeRequire = createRequire(import.meta.url);
const SOURCE_WIDTH = 794;
const SOURCE_HEIGHT = 1123;
const PAGE_SCALE = 2.5;

function standardFontDataUrl() {
  try {
    const fontFile = nodeRequire.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb');
    return `${path.dirname(fontFile).replaceAll('\\', '/')}/`;
  } catch {
    throw new ToolKnitError('ENGINE_UNAVAILABLE', 'PDF preview font resources are unavailable. Reinstall ToolKnit CLI.');
  }
}

function controlsForPage(renderedControls, pageIndex) {
  return renderedControls.filter(control => control.pageIndex === pageIndex && control.controlNumber);
}

function drawControlOverlay(context, control, scaleX, scaleY) {
  const x = control.x * scaleX;
  const y = control.y * scaleY;
  const width = control.w * scaleX;
  const height = control.h * scaleY;
  const label = `${control.controlNumber}  ${control.type}`;
  context.save();
  context.strokeStyle = '#111111';
  context.lineWidth = Math.max(2, scaleX * 1.5);
  context.setLineDash([Math.max(6, scaleX * 4), Math.max(4, scaleX * 3)]);
  context.strokeRect(x, y, width, height);
  context.setLineDash([]);
  context.font = `600 ${Math.max(18, Math.round(12 * scaleX))}px sans-serif`;
  const labelWidth = Math.ceil(context.measureText(label).width) + 18;
  const labelHeight = Math.max(28, Math.round(22 * scaleY));
  const labelY = Math.max(0, y - labelHeight);
  context.fillStyle = '#111111';
  context.fillRect(x, labelY, Math.min(labelWidth, Math.max(width, 80)), labelHeight);
  context.fillStyle = '#FFFFFF';
  context.textBaseline = 'middle';
  context.fillText(label, x + 9, labelY + labelHeight / 2, Math.max(40, width - 18));
  context.restore();
}

function renderOverview(createCanvas, demoCanvases) {
  const thumbnailWidth = SOURCE_WIDTH;
  const thumbnailHeight = Math.round(thumbnailWidth * SOURCE_HEIGHT / SOURCE_WIDTH);
  const gutter = 56;
  const top = 96;
  const columns = 1;
  const rows = demoCanvases.length;
  const width = gutter + columns * (thumbnailWidth + gutter);
  const height = top + rows * (thumbnailHeight + 86) + gutter;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#F2F2F0';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#111111';
  context.font = '600 34px sans-serif';
  context.fillText('ToolKnit Controls Overview', gutter, 54);
  demoCanvases.forEach((pageCanvas, pageIndex) => {
    const column = pageIndex % columns;
    const row = Math.floor(pageIndex / columns);
    const x = gutter + column * (thumbnailWidth + gutter);
    const y = top + row * (thumbnailHeight + 86);
    context.fillStyle = '#FFFFFF';
    context.fillRect(x - 2, y - 2, thumbnailWidth + 4, thumbnailHeight + 4);
    context.drawImage(pageCanvas, x, y, thumbnailWidth, thumbnailHeight);
    context.fillStyle = '#111111';
    context.font = '500 22px sans-serif';
    context.fillText(`Page ${String(pageIndex + 1).padStart(2, '0')}`, x, y + thumbnailHeight + 34);
  });
  return canvas.toBuffer('image/png');
}

export async function renderAiDocumentPreviews(pdfBytes, renderedControls = []) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length === 0) {
    throw new ToolKnitError('PROCESSING_FAILED', 'The PDF renderer did not provide bytes for preview generation.');
  }
  let loadingTask;
  try {
    const [pdfjsLib, canvasModule] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas')
    ]);
    const { createCanvas } = canvasModule;
    loadingTask = pdfjsLib.getDocument({
      data: pdfBytes.slice(),
      disableWorker: true,
      standardFontDataUrl: standardFontDataUrl(),
      verbosity: 0
    });
    const document = await loadingTask.promise;
    const previews = [];
    const demos = [];
    const demoCanvases = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const pdfPage = await document.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: PAGE_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      const fileName = `page-${String(pageNumber).padStart(2, '0')}.png`;
      previews.push({ fileName, bytes: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height });

      const demoCanvas = createCanvas(canvas.width, canvas.height);
      const demoContext = demoCanvas.getContext('2d');
      demoContext.drawImage(canvas, 0, 0);
      const scaleX = canvas.width / SOURCE_WIDTH;
      const scaleY = canvas.height / SOURCE_HEIGHT;
      for (const control of controlsForPage(renderedControls, pageNumber - 1)) {
        drawControlOverlay(demoContext, control, scaleX, scaleY);
      }
      demos.push({
        fileName: `page-${String(pageNumber).padStart(2, '0')}-controls.png`,
        bytes: demoCanvas.toBuffer('image/png'),
        width: demoCanvas.width,
        height: demoCanvas.height
      });
      demoCanvases.push(demoCanvas);
      try { pdfPage.cleanup(); } catch {}
    }
    return {
      previews,
      demos,
      overview: { fileName: 'controls-overview.png', bytes: renderOverview(createCanvas, demoCanvases) }
    };
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not render document preview images.');
  } finally {
    try { await loadingTask?.destroy(); } catch {}
  }
}
