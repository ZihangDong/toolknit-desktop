import { randomUUID } from 'node:crypto';
import { access, link, lstat, mkdir, mkdtemp, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';
import { inspectPdfInput, readPdfInput } from './fs-safety.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const nodeRequire = createRequire(import.meta.url);

function installPdfjsCanvasPrimitives() {
  for (const [name, value] of Object.entries({ DOMMatrix, ImageData, Path2D })) {
    if (value) globalThis[name] = value;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importPdfToImageCore() {
  const stagedPath = path.join(STAGED_CORE_ROOT, 'pdf-to-image-core.js');
  if (await fileExists(stagedPath)) {
    return import(pathToFileURL(stagedPath).href);
  }
  return import(pathToFileURL(path.join(PROJECT_ROOT, 'src', 'pdf-to-image-core.js')).href);
}

const pdfToImageCore = await importPdfToImageCore();
const {
  PDF_TO_IMAGE_LIMITS,
  PdfToImageError,
  assertPdfToImageInput,
  assertPdfToImagePageCount,
  getPdfToImageFormatConfig,
  normalizePdfToImagePageSelection,
  planPdfToImageExport,
  sanitizePdfToImageBaseName
} = pdfToImageCore;

function report(options, progress, message) {
  options.reportProgress?.(Math.max(0, Math.min(100, progress)), message);
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  }
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
    }
  }
}

function normalizeMode(value) {
  const mode = String(value ?? 'images').trim().toLowerCase();
  if (!['images', 'long', 'long-horizontal', 'grid'].includes(mode)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'mode must be images, long, long-horizontal or grid (4 or 9 pages).');
  }
  return mode;
}

function normalizePages(value, pageCount, mode) {
  const requestedPages = value === undefined
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : value;
  return normalizePdfToImagePageSelection(requestedPages, pageCount, mode);
}

function mapPdfToImageError(error) {
  if (error instanceof ToolKnitError) return error;
  const detail = String(error?.message || error || '');
  const code = error instanceof PdfToImageError
    ? error.code
    : detail.match(/pdf-to-image:([a-z0-9_-]+)/i)?.[1]?.replaceAll('-', '_');
  if (code) {
    if (['invalid_format', 'invalid_clarity', 'invalid_mode', 'invalid_request', 'invalid_selection', 'invalid_page_metrics', 'invalid_grid_count'].includes(code)) {
      return new ToolKnitError('INVALID_ARGUMENT', detail);
    }
    if (['input_too_large', 'too_many_pages', 'too_many_long_pages', 'page_too_large', 'output_too_large', 'output_too_large_for_memory'].includes(code)) {
      return new ToolKnitError('INPUT_TOO_LARGE', detail);
    }
    if (['invalid_pdf', 'empty_pdf', 'single_file_required'].includes(code)) {
      return new ToolKnitError('INPUT_INVALID', detail);
    }
  }
  const normalized = detail.toLowerCase();
  if (normalized.includes('password') || normalized.includes('encrypted')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected. Decrypt it before converting it to images.');
  }
  if (normalized.includes('invalid pdf') || normalized.includes('pdf header') || normalized.includes('malformed')) {
    return new ToolKnitError('INPUT_INVALID', 'The input is not a readable PDF.');
  }
  return new ToolKnitError('PROCESSING_FAILED', detail || 'PDF to image conversion failed.');
}

function getPdfjsStandardFontDataUrl() {
  try {
    const fontFile = nodeRequire.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb');
    return `${path.dirname(fontFile).replaceAll('\\', '/')}/`;
  } catch {
    throw new ToolKnitError('ENGINE_UNAVAILABLE', 'PDF.js standard font resources are unavailable. Reinstall ToolKnit CLI.');
  }
}

async function prepareOutputDirectory(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path.');
  }
  const requested = path.resolve(value.trim());
  try {
    await mkdir(requested, { recursive: true });
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Cannot create output directory: ${requested}`);
  }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  }
  return realpath(requested);
}

async function reserveOutputPath(outputDirectory, fileName, reserved) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(outputDirectory, `${stem}${suffix}${extension}`);
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (reserved.has(key)) continue;
    try {
      await lstat(candidate);
      continue;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ToolKnitError('OUTPUT_INVALID', `Output path cannot be inspected: ${candidate}`);
      }
    }
    reserved.add(key);
    return candidate;
  }
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Could not reserve a unique output file for ${fileName}.`);
}

function encodeCanvas(canvas, formatConfig) {
  try {
    if (formatConfig.format === 'jpg') {
      return canvas.toBuffer('image/jpeg', { quality: Math.round((formatConfig.quality ?? 0.94) * 100) });
    }
    if (formatConfig.format === 'webp') {
      return canvas.toBuffer('image/webp', { quality: Math.round((formatConfig.quality ?? 1) * 100) });
    }
    return canvas.toBuffer('image/png');
  } catch {
    throw new ToolKnitError('PROCESSING_FAILED', `The ${formatConfig.format.toUpperCase()} encoder could not create an output image.`);
  }
}

async function renderPageCanvas(sourcePdf, pagePlan, options = {}) {
  throwIfAborted(options.signal);
  const page = await sourcePdf.getPage(pagePlan.pageNumber);
  let canvas, renderTask;
  const abort = () => renderTask?.cancel();
  try {
    const viewport = page.getViewport({ scale: pagePlan.renderScale });
    canvas = createCanvas(pagePlan.width, pagePlan.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing-canvas-context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: [pagePlan.width / viewport.width, 0, 0, pagePlan.height / viewport.height, 0, 0],
      background: '#fff'
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    await renderTask.promise;
    throwIfAborted(options.signal);
    return canvas;
  } catch (error) {
    if (canvas) canvas.width = canvas.height = 0;
    if (options.signal?.aborted) throw cancellationError(options.signal);
    throw new ToolKnitError('PROCESSING_FAILED', `PDF page ${pagePlan.pageNumber} could not be rendered.`);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    try { page.cleanup(); } catch {}
  }
}

async function renderOutputCanvas(sourcePdf, output, options = {}) {
  if (output.kind === 'page') {
    return renderPageCanvas(sourcePdf, output.items[0], options);
  }
  throwIfAborted(options.signal);
  const canvas = createCanvas(output.width, output.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new ToolKnitError('PROCESSING_FAILED', 'The canvas engine could not create the long image.');
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    for (const item of output.items) {
      throwIfAborted(options.signal);
      const pageCanvas = await renderPageCanvas(sourcePdf, item, options);
      try { context.drawImage(pageCanvas, item.x, item.y, item.width, item.height); }
      finally { pageCanvas.width = pageCanvas.height = 0; }
    }
    return canvas;
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
}

async function publishPreparedOutputs(prepared, outputDirectory) {
  const reserved = new Set();
  const targets = [];
  for (const item of prepared) {
    targets.push(await reserveOutputPath(outputDirectory, item.fileName, reserved));
  }
  const published = [];
  try {
    for (let index = 0; index < prepared.length; index++) {
      await link(prepared[index].temporaryPath, targets[index]);
      published.push(targets[index]);
    }
    return published;
  } catch (error) {
    await Promise.all(published.map(item => unlink(item).catch(() => {})));
    if (error?.code === 'EEXIST') {
      throw new ToolKnitError('OUTPUT_EXISTS', 'An output file appeared during publishing. Run the command again.');
    }
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Could not publish PDF image outputs in: ${outputDirectory}`);
  }
}

export async function convertPdfToImages(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args);
  assertOnlyKeys(args, new Set(['input_path', 'output_dir', 'pages', 'mode', 'format', 'clarity', 'output_name']));
  report(options, 0, 'Validating PDF to image request.');
  const input = await readPdfInput(await inspectPdfInput(args.input_path, {
    label: 'input_path',
    maxBytes: PDF_TO_IMAGE_LIMITS.maxInputBytes
  }));
  try {
    assertPdfToImageInput([{ name: input.name }], input.size);
  } catch (error) {
    throw mapPdfToImageError(error);
  }
  const outputDirectory = await prepareOutputDirectory(args.output_dir);
  const mode = normalizeMode(args.mode);
  const sourceName = sanitizePdfToImageBaseName(args.output_name || input.name);
  let formatConfig;
  try {
    formatConfig = getPdfToImageFormatConfig(args.format, args.clarity);
  } catch (error) {
    throw mapPdfToImageError(error);
  }

  let loadingTask;
  let temporaryDirectory;
  try {
    installPdfjsCanvasPrimitives();
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjsLib.getDocument({
      data: input.bytes.slice(),
      disableWorker: true,
      standardFontDataUrl: getPdfjsStandardFontDataUrl(),
      verbosity: 0
    });
    const sourcePdf = await loadingTask.promise;
    throwIfAborted(options.signal);
    const pageCount = sourcePdf.numPages;
    assertPdfToImagePageCount(pageCount);
    const selectedPages = normalizePages(args.pages, pageCount, mode);
    report(options, 10, `Loaded ${pageCount} PDF page(s).`);

    const metrics = [];
    for (const pageNumber of selectedPages) {
      throwIfAborted(options.signal);
      const page = await sourcePdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        metrics.push({ pageNumber, width: viewport.width, height: viewport.height });
      } finally {
        try { page.cleanup(); } catch {}
      }
    }
    const plan = planPdfToImageExport({
      sourceName,
      pageCount,
      pages: selectedPages,
      pageMetrics: metrics,
      mode,
      format: formatConfig.format,
      clarity: args.clarity
    });

    temporaryDirectory = await mkdtemp(path.join(outputDirectory, '.toolknit-pdf-to-image-'));
    const prepared = [];
    for (const [index, output] of plan.outputs.entries()) {
      throwIfAborted(options.signal);
      report(options, 15 + (index / plan.outputs.length) * 70, `Rendering PDF image ${index + 1}/${plan.outputs.length}.`);
      const canvas = await renderOutputCanvas(sourcePdf, output, options);
      let bytes;
      try { throwIfAborted(options.signal); bytes = encodeCanvas(canvas, plan.formatConfig); }
      finally { canvas.width = canvas.height = 0; }
      if (!Buffer.isBuffer(bytes) || bytes.length < 1) {
        throw new ToolKnitError('PROCESSING_FAILED', 'The image encoder produced an empty output.');
      }
      const temporaryPath = path.join(temporaryDirectory, `${randomUUID()}.tmp`);
      await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
      const metadata = await stat(temporaryPath);
      if (!metadata.isFile() || metadata.size !== bytes.length) {
        throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'A temporary PDF image output is incomplete.');
      }
      prepared.push({ ...output, temporaryPath, bytes: metadata.size });
    }
    throwIfAborted(options.signal);
    report(options, 88, 'Publishing PDF image outputs.');
    const published = await publishPreparedOutputs(prepared, outputDirectory);
    report(options, 100, 'Published PDF image outputs.');
    return {
      tool: 'pdf.to-image',
      input: { path: input.path, bytes: input.size, pages: pageCount },
      output_dir: outputDirectory,
      mode: plan.mode,
      format: plan.format,
      clarity: plan.clarity,
      selected_pages: plan.pages,
      output_count: published.length,
      outputs: prepared.map((item, index) => ({
        path: published[index],
        kind: item.kind,
        page_numbers: item.pageNumbers,
        width: item.width,
        height: item.height,
        bytes: item.bytes,
        format: plan.format
      }))
    };
  } catch (error) {
    if (options.signal?.aborted) throw cancellationError(options.signal);
    throw mapPdfToImageError(error);
  } finally {
    try { await loadingTask?.destroy(); } catch {}
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
