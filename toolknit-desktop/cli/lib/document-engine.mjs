import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { loadCore } from './core-loader.mjs';
import { withPdf, selectPages, createCanvas } from './pdf-headless.mjs';
import { ToolKnitError } from './errors.mjs';

async function word(args, options) {
  return (await import('./pdf-word-engine.mjs')).convertPdfWord(args, options);
}

async function text(args, options) {
  const core = await loadCore('features/pdf-text-extract/core.js');
  const { extractPdfRules } = await loadCore('features/pdf-text-extract/table-grid.js');
  return withPdf(args.input.bytes, async (pdf, ops) => {
    const selected = selectPages(args.pages, pdf.numPages), pages = []; let characters = 0;
    for (let index = 0; index < selected.length; index++) {
      const page = await pdf.getPage(selected[index]);
      try {
        const content = await page.getTextContent(), viewport = page.getViewport({ scale: 1 });
        if (content.items.length > core.PDF_TEXT_LIMITS.maxItemsPerPage) throw new ToolKnitError('INPUT_TOO_LARGE', 'Too many text items on a page.');
        const list = await page.getOperatorList();
        if (list.fnArray.length > 250000) throw new ToolKnitError('INPUT_TOO_LARGE', 'Too many drawing operators on a page.');
        const result = core.reconstructPdfPage(content.items, { pageNumber: selected[index], pageWidth: viewport.width, pageHeight: viewport.height, rules: extractPdfRules(list, ops) });
        characters += result.chars;
        if (characters > core.PDF_TEXT_LIMITS.maxCharacters) throw new ToolKnitError('INPUT_TOO_LARGE', 'Extracted text exceeds the character budget.');
        pages.push(result); options.reportProgress?.(5 + 85 * (index + 1) / selected.length, 'Extracting text and table structure.');
      } finally { page.cleanup(); }
    }
    const result = core.convertPdfPagesToMarkdown(pages, { sourceName: args.input.name });
    const output = args.output_extension === '.txt' ? pages.map(page => page.text || '').join('\n\n') + '\n' : result.markdown;
    return { bytes: new TextEncoder().encode(output), meta: { page_count: pages.length, characters, status: result.status, warnings: result.warnings, source_pages: selected } };
  });
}

async function crop(args) {
  const core = await loadCore('features/pdf-crop/core.js');
  const r = args.rect;
  if (r.x + r.width > 1 + 1e-9 || r.y + r.height > 1 + 1e-9) throw new ToolKnitError('INVALID_ARGUMENT', 'Crop rectangle must stay within the visible page.');
  const pdf = await PDFDocument.load(args.input.bytes), count = pdf.getPageCount();
  core.assertPdfCropPageCount(count);
  const selected = new Set(selectPages(args.pages, count));
  const bytes = await core.exportCroppedPdf({ bytes: args.input.bytes, crops: Array.from({ length: count }, (_, index) => ({ rect: r, explicit: selected.has(index + 1) })) });
  return { bytes, meta: { page_count: count, cropped_pages: [...selected], warnings: ['Cropping does not securely remove hidden content.'] } };
}

async function pageNumber(args) {
  const core = await loadCore('pdf-page-number-core.js');
  const pdf = await PDFDocument.load(args.input.bytes), count = pdf.getPageCount();
  core.assertPdfPageNumberPageCount(count);
  const selected = selectPages(args.pages, count), pages = Array.from({ length: count }, (_, index) => ({ id: String(index + 1), sourceId: 'source', sourcePageIndex: index }));
  const fontBytes = await readFile(new URL('../resources/fonts/NotoSansSC-Regular.ttf', import.meta.url));
  const settings = { ...core.PDF_PAGE_NUMBER_DEFAULTS, scope: 'selected', selectedIds: selected.map(String), start: args.start ?? 1,
    position: args.position ?? 'bottom-center', fontSize: args.font_size ?? 11, margin: args.margin ?? 24, template: args.template ?? '{page}' };
  const bytes = await core.exportPdfWithPageNumbers({ sources: [{ id: 'source', bytes: args.input.bytes }], pages, settings, fontBytes });
  return { bytes, meta: { page_count: count, numbered_pages: selected } };
}

export async function scanCanvas(canvas, settings, ordinal) {
  const scan = await loadCore('core/pdf-scan.js');
  const width = canvas.width, height = canvas.height, ctx = canvas.getContext('2d');
  if (settings.mode !== 'faithful') {
    const pixels = ctx.getImageData(0, 0, width, height);
    scan.applyScanPixels(pixels.data, width, height, settings, ordinal); ctx.putImageData(pixels, 0, 0);
    const { angle, scale } = scan.scanSkewGeometry(width, height, settings, ordinal);
    if (angle) {
      const copy = createCanvas(width, height);
      try {
        copy.getContext('2d').drawImage(canvas, 0, 0); ctx.save();
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
        ctx.translate(width / 2, height / 2); ctx.rotate(angle); ctx.scale(scale, scale); ctx.drawImage(copy, -width / 2, -height / 2); ctx.restore();
      } finally { copy.width = copy.height = 0; }
    }
  }
}

async function scan(args, options) {
  const core = await loadCore('core/pdf-scan.js'), { createScanWriter } = await loadCore('shared/scanned-pdf-writer.js');
  const settings = core.validateScanSettings({ mode: args.mode ?? 'faithful', dpi: args.dpi ?? 200 });
  return withPdf(args.input.bytes, async pdf => {
    const pages = selectPages(args.pages, pdf.numPages, core.SCAN_LIMITS.pages), writer = await createScanWriter(pages.length);
    const canvas = createCanvas(1, 1);
    try {
      for (const [index, number] of pages.entries()) {
        const page = await pdf.getPage(number);
        try {
          const viewport = page.getViewport({ scale: 1 }), plan = core.scanRenderPlan(viewport.width, viewport.height, settings.dpi);
          canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: plan.scale }), background: '#fff' }).promise;
          await scanCanvas(canvas, settings, index + 1);
          await writer.add({ jpeg: new Uint8Array(canvas.toBuffer('image/jpeg', 94)), width: viewport.width, height: viewport.height });
          options.reportProgress?.(5 + 85 * (index + 1) / pages.length, 'Rendering scan pages.');
        } finally { page.cleanup(); canvas.width = canvas.height = 0; }
      }
      return { bytes: await writer.finish(), meta: { page_count: pages.length, source_pages: pages, mode: settings.mode, image_only: true } };
    } finally { canvas.width = canvas.height = 0; }
  }, { maxPages: core.SCAN_LIMITS.pages });
}

async function create(args) {
  const pdf = await PDFDocument.create(), dimensions = args.paper === 'letter' ? [612, 792] : [595.28, 841.89];
  if (args.orientation === 'landscape') dimensions.reverse();
  for (let i = 0; i < (args.page_count ?? 1); i++) pdf.addPage(dimensions);
  return { bytes: await pdf.save(), meta: { page_count: pdf.getPageCount(), width: dimensions[0], height: dimensions[1] } };
}
export async function processDocument(job, args, options) {
  if (job === 'workbook_inspect') return (await import('./office-archive.mjs')).inspectWorkbookArchive(args.bytes);
  if (job.startsWith('image_')) return (await import('./image-engine.mjs')).processImage(job, args, options);
  const operations = { pdf_to_word: word, pdf_text: text, pdf_crop: crop, pdf_page_number: pageNumber, pdf_to_scan: scan, pdf_create: create };
  if (!Object.hasOwn(operations, job)) throw new ToolKnitError('INVALID_ARGUMENT', 'Unknown document operation.');
  return operations[job](args, options);
}
