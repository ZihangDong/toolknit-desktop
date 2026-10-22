import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { cancellationError, ToolKnitError, throwIfAborted } from './errors.mjs';
import {
  fileExists,
  fileSize,
  inspectPdfInput,
  preparePdfOutput,
  publishTemporaryOutput,
  readPdfInput,
  writePdfOutput
} from './fs-safety.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const MAX_ENGINE_OUTPUT_BYTES = 64 * 1024;
const nodeRequire = createRequire(import.meta.url);

async function importPdfCore(fileName) {
  const stagedPath = path.join(STAGED_CORE_ROOT, fileName);
  if (await fileExists(stagedPath)) {
    return import(pathToFileURL(stagedPath).href);
  }
  // Development uses the same source modules as the desktop application.
  return import(new URL(`../../src/${fileName}`, import.meta.url));
}

const [
  mergeCore,
  splitCore,
  rotateCore,
  encryptCore,
  decryptCore,
  compressCore,
  enhanceCore
] = await Promise.all([
  importPdfCore('pdf-merge-core.js'),
  importPdfCore('pdf-split-core.js'),
  importPdfCore('pdf-rotate-core.js'),
  importPdfCore('pdf-encrypt-core.js'),
  importPdfCore('pdf-decrypt-core.js'),
  importPdfCore('pdf-compress-core.js'),
  importPdfCore('pdf-enhance-core.js')
]);

const { PDF_MERGE_LIMITS, assertPdfMergeSelection, mergePdfPages } = mergeCore;
const { PDF_SPLIT_LIMITS, assertPdfSplitPageCount, assertPdfSplitSelection, splitPdfPages } = splitCore;
const { PDF_ROTATE_LIMITS, assertPdfRotateSelection, rotatePdfPages } = rotateCore;
const { PDF_ENCRYPT_LIMITS, assertPdfEncryptLegacyPassword, assertPdfEncryptSelection, encryptPdf } = encryptCore;
const { PDF_DECRYPT_LIMITS, assertPdfDecryptPassword, assertPdfDecryptSelection } = decryptCore;
const { PDF_COMPRESS_LIMITS, assertPdfCompressLevel, assertPdfCompressSelection,
  normalizePdfCompressionOptions, structureCompressionArguments, pdfCompressionStatus } = compressCore;
const {
  PDF_ENHANCE_LIMITS,
  assertPdfEnhancePagePlan,
  assertPdfEnhanceSelection,
  assertPdfEnhanceStrength,
  createPdfEnhanceRenderPlan
} = enhanceCore;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be an object.`);
  }
}

function assertOnlyKeys(value, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
    }
  }
}

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a ${allowEmpty ? 'string' : 'non-empty string'}.`);
  }
  return value;
}

function assertBoolean(value, label, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be true or false.`);
  }
  return value;
}

function assertStringArray(value, label, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must contain at least ${minimum} file path${minimum === 1 ? '' : 's'}.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a positive integer.`);
  }
  return value;
}

function normalizePageList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must contain at least one page number.`);
  }
  const pages = value.map((page, index) => assertPositiveInteger(page, `${label}[${index}]`));
  if (new Set(pages).size !== pages.length) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} cannot contain duplicate page numbers.`);
  }
  return pages;
}

async function inspectInputs(paths, limit) {
  return Promise.all(paths.map((inputPath, index) => inspectPdfInput(inputPath, {
    label: `input_paths[${index}]`,
    maxBytes: limit
  })));
}

function mapPdfLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('password') || message.includes('encrypted')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected. Decrypt it before this operation.');
  }
  return new ToolKnitError('INPUT_INVALID', 'The input is not a readable PDF.');
}

function mapPdfEnhanceError(error) {
  if (error instanceof ToolKnitError) return error;
  const details = String(error?.message || error || '');
  const normalized = details.toLowerCase();
  const code = details.match(/pdf-enhance:([a-z-]+)/i)?.[1]?.toLowerCase();
  if (code === 'input-too-large' || code === 'too-many-pages' || code === 'page-too-large' || code === 'document-too-large' || code === 'output-too-large') {
    return new ToolKnitError('INPUT_INVALID', 'The PDF exceeds the safe enhancement limits.');
  }
  if (code === 'password-protected') return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected. Decrypt it before this operation.');
  if (code === 'invalid-pdf') return new ToolKnitError('INPUT_INVALID', 'The input is not a readable PDF.');
  if (normalized.includes('password') || normalized.includes('encrypted')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected. Decrypt it before this operation.');
  }
  if (normalized.includes('invalid pdf') || normalized.includes('pdf header') || normalized.includes('malformed') || normalized.includes('pdf structure')) {
    return new ToolKnitError('INPUT_INVALID', 'The input is not a readable PDF.');
  }
  return new ToolKnitError('PROCESSING_FAILED', 'PDF enhancement failed.');
}

async function pageCountFor(bytes) {
  try {
    return (await PDFDocument.load(bytes.slice())).getPageCount();
  } catch (error) {
    throw mapPdfLoadError(error);
  }
}

function getPdfjsStandardFontDataUrl() {
  try {
    const fontFile = nodeRequire.resolve('pdfjs-dist/standard_fonts/FoxitSerif.pfb');
    // PDF.js Node factories accept a forward-slash filesystem path, not a file:// URL.
    return `${path.dirname(fontFile).replaceAll('\\', '/')}/`;
  } catch {
    throw new ToolKnitError('ENGINE_UNAVAILABLE', 'PDF.js standard font resources are unavailable. Reinstall ToolKnit CLI.');
  }
}

function selectionForMerge(inputCount, selections) {
  if (selections === undefined) return null;
  if (!Array.isArray(selections)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'page_selections must be an array.');
  }
  const normalized = new Map();
  for (const [index, selection] of selections.entries()) {
    assertObject(selection, `page_selections[${index}]`);
    assertOnlyKeys(selection, new Set(['input_index', 'pages']));
    if (!Number.isSafeInteger(selection.input_index) || selection.input_index < 0 || selection.input_index >= inputCount) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_selections[${index}].input_index is out of range.`);
    }
    if (normalized.has(selection.input_index)) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_selections contains duplicate input_index ${selection.input_index}.`);
    }
    normalized.set(selection.input_index, normalizePageList(selection.pages, `page_selections[${index}].pages`));
  }
  return normalized;
}

function pagesForMerge(documents, selections) {
  const pages = [];
  for (let fileIndex = 0; fileIndex < documents.length; fileIndex++) {
    const selectedPages = selections?.get(fileIndex);
    if (selectedPages) {
      for (const pageIndex of selectedPages) pages.push({ fileIndex, pageIndex, rotation: 0 });
      continue;
    }
    for (let pageIndex = 1; pageIndex <= documents[fileIndex].pageCount; pageIndex++) {
      pages.push({ fileIndex, pageIndex, rotation: 0 });
    }
  }
  return pages;
}

function normalizeRotations(value, sourcePageCount, defaultRotation) {
  if (value === undefined) {
    return Array.from({ length: sourcePageCount }, (_, index) => ({ pageIndex: index + 1, rotation: defaultRotation }));
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'page_rotations must contain at least one page rotation.');
  }
  const rotationsByPage = new Map();
  for (const [index, entry] of value.entries()) {
    assertObject(entry, `page_rotations[${index}]`);
    assertOnlyKeys(entry, new Set(['page', 'rotation']));
    const pageIndex = assertPositiveInteger(entry.page, `page_rotations[${index}].page`);
    if (pageIndex > sourcePageCount) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_rotations[${index}].page is outside the input PDF.`);
    }
    if (rotationsByPage.has(pageIndex)) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'page_rotations cannot contain duplicate pages.');
    }
    if (!Number.isFinite(entry.rotation) || entry.rotation % 90 !== 0) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_rotations[${index}].rotation must be a multiple of 90.`);
    }
    rotationsByPage.set(pageIndex, entry.rotation);
  }
  return Array.from({ length: sourcePageCount }, (_, index) => {
    const pageIndex = index + 1;
    return { pageIndex, rotation: rotationsByPage.get(pageIndex) ?? 0 };
  });
}

function validateEncryptPermissions(value) {
  if (value === undefined) return undefined;
  assertObject(value, 'permissions');
  const allowed = new Set([
    'printing', 'modifying', 'copying', 'annotating', 'fillingForms',
    'contentAccessibility', 'documentAssembly'
  ]);
  assertOnlyKeys(value, allowed);
  if (value.printing !== undefined && value.printing !== false
    && value.printing !== 'lowResolution' && value.printing !== 'highResolution') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'permissions.printing must be false, lowResolution, or highResolution.');
  }
  for (const key of allowed) {
    if (key !== 'printing' && value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new ToolKnitError('INVALID_ARGUMENT', `permissions.${key} must be true or false.`);
    }
  }
  return value;
}

function qpdfCandidatePaths() {
  const candidates = [];
  if (process.env.TOOLKNIT_QPDF_PATH) candidates.push(process.env.TOOLKNIT_QPDF_PATH);
  const executable = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
  candidates.push(path.join(CLI_ROOT, 'vendor', 'qpdf', executable));
  candidates.push(path.join(PROJECT_ROOT, 'src-tauri', 'resources', 'qpdf', executable));
  return candidates;
}

async function resolveQpdf() {
  for (const candidate of qpdfCandidatePaths()) {
    if (await fileExists(candidate)) return candidate;
  }
  // A trusted system installation is an intentional fallback; it is invoked without a shell.
  return process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
}

async function runProcess(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      reject(error);
      return;
    }
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let settled = false;
    let aborted = false;
    let forceKillTimer = null;
    const cleanupAbort = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      options.signal?.removeEventListener?.('abort', onAbort);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      reject(error);
    };
    const onAbort = () => {
      aborted = true;
      try { child.stdin.destroy(); } catch {}
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch {}
        forceKillTimer = setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch {}
        }, 2500);
        forceKillTimer.unref?.();
      }
    };
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const collect = destination => chunk => {
      if (settled) return;
      capturedBytes += chunk.length;
      if (capturedBytes > MAX_ENGINE_OUTPUT_BYTES) {
        child.kill();
        fail(new ToolKnitError('PROCESSING_FAILED', 'The PDF engine produced too much diagnostic output.'));
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', error => {
      if (aborted || options.signal?.aborted) {
        fail(cancellationError(options.signal));
        return;
      }
      if (error?.code === 'ENOENT') {
        fail(new ToolKnitError('ENGINE_UNAVAILABLE', 'qpdf is unavailable. Reinstall ToolKnit CLI or configure TOOLKNIT_QPDF_PATH.'));
        return;
      }
      fail(new ToolKnitError('PROCESSING_FAILED', 'The PDF engine could not start.'));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      if (aborted || options.signal?.aborted) {
        reject(cancellationError(options.signal));
        return;
      }
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

function qpdfError(output, operation) {
  const details = output.stderr.toString('utf8').toLowerCase();
  if (details.includes('invalid password') || details.includes('password supplied is incorrect')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF password is invalid or missing.');
  }
  if (details.includes('encrypted')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected.');
  }
  if (details.includes('not a pdf') || details.includes('damaged pdf') || details.includes("can't find pdf header")) {
    return new ToolKnitError('INPUT_INVALID', 'The input is not a readable PDF.');
  }
  return new ToolKnitError('PROCESSING_FAILED', `${operation} failed.`);
}

async function discardTemporaryOutput(temporaryPath) {
  try { await unlink(temporaryPath); } catch {}
}

export async function inspectPdf(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path']));
  const input = await readPdfInput(assertString(args.input_path, 'input_path'), options);
  const pageCount = await pageCountFor(input.bytes);
  throwIfAborted(options.signal);
  return {
    tool: 'pdf.inspect',
    input: { path: input.path, name: input.name, bytes: input.size, pages: pageCount },
    outputs: []
  };
}

export async function mergePdf(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_paths', 'output_path', 'page_selections', 'overwrite']));
  const inputPaths = assertStringArray(args.input_paths, 'input_paths', 2);
  const descriptors = await inspectInputs(inputPaths, PDF_MERGE_LIMITS.maxTotalBytes);
  const totalBytes = descriptors.reduce((total, file) => total + file.size, 0);
  try {
    assertPdfMergeSelection(descriptors, totalBytes);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const inputs = await Promise.all(descriptors.map(input => readPdfInput(input, options)));
  const documents = await Promise.all(inputs.map(async input => ({
    fileData: input.bytes,
    fileName: input.name,
    pageCount: await pageCountFor(input.bytes)
  })));
  const pages = pagesForMerge(documents, selectionForMerge(documents.length, args.page_selections));
  let bytes;
  try {
    bytes = await mergePdfPages({ documents, pages });
  } catch (error) {
    throw mapPdfLoadError(error);
  }
  options.reportProgress?.(90, 'Publishing merged PDF.');
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: inputs.map(input => input.path),
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite'), signal: options.signal
  });
  return {
    tool: 'pdf.merge',
    inputs: inputs.map(input => ({ path: input.path, bytes: input.size })),
    outputs: [{ path: outputPath, pages: pages.length, bytes: bytes.length }]
  };
}

export async function splitPdf(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_dir', 'pages', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_SPLIT_LIMITS.maxTotalBytes
  }), options);
  try {
    assertPdfSplitSelection([input], input.size);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const pageCount = await pageCountFor(input.bytes);
  try {
    assertPdfSplitPageCount(pageCount);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const selectedPages = normalizePageList(args.pages, 'pages');
  if (selectedPages.some(page => page > pageCount)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'pages contains a page outside the input PDF.');
  }
  const outputDirectory = assertString(args.output_dir, 'output_dir');
  const outputs = await splitPdfPages({
    documents: [{ fileData: input.bytes, fileName: input.name }],
    pages: selectedPages.map(pageIndex => ({ fileIndex: 0, pageIndex }))
  });
  const published = [];
  for (const output of outputs) {
    options.reportProgress?.(80 + 15 * published.length / outputs.length, 'Publishing split PDF pages.');
    if (options.signal?.aborted) throw new ToolKnitError('CANCELLED', 'PDF split cancelled. Completed page files were retained.', { details: { outputs: published } });
    const outputPath = path.join(path.resolve(outputDirectory), output.fileName);
    const savedPath = await writePdfOutput({
      outputPath,
      inputPaths: [input.path],
      bytes: output.bytes,
      overwrite: assertBoolean(args.overwrite, 'overwrite'), signal: options.signal
    });
    published.push({ path: savedPath, page: output.pageIndex, bytes: output.bytes.length });
  }
  return { tool: 'pdf.split', inputs: [{ path: input.path, bytes: input.size }], outputs: published };
}

export async function rotatePdf(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'rotation', 'page_rotations', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ROTATE_LIMITS.maxInputBytes
  }), options);
  try {
    assertPdfRotateSelection([input], input.size);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const sourcePageCount = await pageCountFor(input.bytes);
  const rotation = args.rotation === undefined ? 90 : args.rotation;
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'rotation must be a multiple of 90.');
  }
  const pages = normalizeRotations(args.page_rotations, sourcePageCount, rotation);
  let bytes;
  try {
    bytes = await rotatePdfPages({ fileData: input.bytes, pages });
  } catch (error) {
    throw mapPdfLoadError(error);
  }
  options.reportProgress?.(90, 'Publishing rotated PDF.');
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite'), signal: options.signal
  });
  return { tool: 'pdf.rotate', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pages.length, bytes: bytes.length }] };
}

export async function encryptPdfFile(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'password', 'permissions', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ENCRYPT_LIMITS.maxInputBytes
  }), options);
  try {
    assertPdfEncryptSelection([input], input.size);
    assertPdfEncryptLegacyPassword(assertString(args.password, 'password'));
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const permissions = validateEncryptPermissions(args.permissions);
  let bytes;
  try {
    bytes = await encryptPdf({ fileData: input.bytes, password: args.password, permissions });
  } catch (error) {
    throw mapPdfLoadError(error);
  }
  options.reportProgress?.(90, 'Publishing encrypted PDF.');
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite'), signal: options.signal
  });
  return { tool: 'pdf.encrypt', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, bytes: bytes.length }] };
}

export async function decryptPdfFile(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'password', 'overwrite']));
  const inputPath = assertString(args.input_path, 'input_path');
  const input = await inspectPdfInput(inputPath, { maxBytes: PDF_DECRYPT_LIMITS.maxInputBytes });
  const password = args.password === undefined ? '' : assertString(args.password, 'password', { allowEmpty: true });
  try {
    assertPdfDecryptSelection([input], input.size);
    assertPdfDecryptPassword(password);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const prepared = await preparePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  const qpdf = await resolveQpdf();
  const qpdfArgs = ['--warning-exit-0'];
  if (password.length > 0) qpdfArgs.push('--password-file=-');
  qpdfArgs.push('--decrypt', '--', input.path, prepared.temporaryPath);
  try {
    const output = await runProcess(qpdf, qpdfArgs, password.length > 0 ? `${password}\n` : undefined, { signal: options.signal });
    if (output.code !== 0) {
      await discardTemporaryOutput(prepared.temporaryPath);
      throw qpdfError(output, 'PDF decryption');
    }
    const pages = await runProcess(qpdf, ['--show-npages', '--', prepared.temporaryPath], undefined, { signal: options.signal });
    const pageCount = Number.parseInt(pages.stdout.toString('utf8').trim(), 10);
    if (pages.code !== 0 || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_DECRYPT_LIMITS.maxPages) {
      await discardTemporaryOutput(prepared.temporaryPath);
      throw new ToolKnitError('PROCESSING_FAILED', 'PDF decryption produced an invalid output.');
    }
    const outputPath = await publishTemporaryOutput({ ...prepared, signal: options.signal });
    return { tool: 'pdf.decrypt', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pageCount, bytes: await fileSize(outputPath) }] };
  } catch (error) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw error;
  }
}

export async function compressPdfFile(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'level', 'overwrite', 'mode', 'clarity', 'target_bytes']));
  const input = await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_COMPRESS_LIMITS.maxInputBytes
  });
  const level = args.level === undefined ? 'medium' : assertString(args.level, 'level');
  let compressionOptions;
  try {
    assertPdfCompressSelection([input]);
    assertPdfCompressLevel(level);
    compressionOptions = normalizePdfCompressionOptions({ mode: args.mode, level, clarity: args.clarity, targetBytes: args.target_bytes ?? null });
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const prepared = await preparePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  const qpdf = await resolveQpdf();
  const warnings = {
    'already-within-target': 'The original PDF already satisfies the size cap. It was not re-encoded and no output was created.',
    'no-reduction': 'The optimized PDF was not smaller, so no output file was created.',
    'target-not-reached': 'The size cap was not reached. No oversized output was published.'
  };
  const outcome = (compression, outputs = []) => ({ tool: 'pdf.compress',
    inputs: [{ path: input.path, bytes: input.size }], outputs,
    status: compression.status, compression: { mode: compressionOptions.mode, ...compression },
    warnings: warnings[compression.status] ? [warnings[compression.status]]
      : compressionOptions.mode === 'raster' ? ['Image-only PDF: searchable text, links, forms, bookmarks and accessibility tags are not preserved.'] : [] });
  try {
    if (compressionOptions.mode === 'raster') {
      const { runRasterPdfCompression } = await import('./pdf-compress-raster-runtime.mjs');
      const result = await runRasterPdfCompression({ input, options: compressionOptions, temporaryPath: prepared.temporaryPath, signal: options.signal });
      throwIfAborted(options.signal);
      if (result.status !== 'compressed') return outcome(result);
      const bytes = await fileSize(prepared.temporaryPath);
      if (bytes !== result.compressedSize || bytes >= input.size
        || (compressionOptions.targetBytes != null && bytes > compressionOptions.targetBytes)) {
        throw new ToolKnitError('PROCESSING_FAILED', 'PDF compression output failed its final byte limit check.');
      }
      const check = await runProcess(qpdf, ['--warning-exit-0', '--check', prepared.temporaryPath], undefined, { signal: options.signal });
      const pages = await runProcess(qpdf, ['--show-npages', '--', prepared.temporaryPath], undefined, { signal: options.signal });
      if (check.code !== 0 || pages.code !== 0 || Number(pages.stdout.toString('utf8').trim()) !== result.pages) {
        throw new ToolKnitError('PROCESSING_FAILED', 'PDF compression output failed validation.');
      }
      throwIfAborted(options.signal);
      const outputPath = await publishTemporaryOutput({ ...prepared, signal: options.signal });
      return outcome(result, [{ path: outputPath, pages: result.pages, bytes: await fileSize(outputPath) }]);
    }
    const pages = await runProcess(qpdf, ['--show-npages', '--', input.path], undefined, { signal: options.signal });
    const pageCount = Number.parseInt(pages.stdout.toString('utf8').trim(), 10);
    if (pages.code !== 0) throw qpdfError(pages, 'PDF inspection');
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_COMPRESS_LIMITS.maxPages) {
      throw new ToolKnitError('INPUT_INVALID', 'PDF page count exceeds the compression limit.');
    }
    if (compressionOptions.targetBytes != null && input.size <= compressionOptions.targetBytes) {
      return outcome({ status: 'already-within-target', originalSize: input.size, compressedSize: input.size,
        pages: pageCount, targetBytes: compressionOptions.targetBytes, attempts: [] });
    }
    const qpdfArgs = structureCompressionArguments(level);
    qpdfArgs.push('--', input.path, prepared.temporaryPath);
    const output = await runProcess(qpdf, qpdfArgs, undefined, { signal: options.signal });
    if (output.code !== 0) {
      await discardTemporaryOutput(prepared.temporaryPath);
      throw qpdfError(output, 'PDF compression');
    }
    const check = await runProcess(qpdf, ['--check', prepared.temporaryPath], undefined, { signal: options.signal });
    if (check.code !== 0) {
      await discardTemporaryOutput(prepared.temporaryPath);
      throw new ToolKnitError('PROCESSING_FAILED', 'PDF compression produced an invalid output.');
    }
    const outputPages = await runProcess(qpdf, ['--show-npages', '--', prepared.temporaryPath], undefined, { signal: options.signal });
    if (outputPages.code !== 0 || Number(outputPages.stdout.toString('utf8').trim()) !== pageCount) {
      throw new ToolKnitError('PROCESSING_FAILED', 'PDF compression changed its page count.');
    }
    const compressedBytes = await fileSize(prepared.temporaryPath);
    const compression = { status: pdfCompressionStatus({ originalSize: input.size, compressedSize: compressedBytes, targetBytes: compressionOptions.targetBytes }),
      originalSize: input.size, compressedSize: Math.min(input.size, compressedBytes), pages: pageCount,
      targetBytes: compressionOptions.targetBytes, attempts: [{ attempt: 1, bytes: compressedBytes, flateLevel: compressionOptions.flateLevel }] };
    if (compression.status !== 'compressed') {
      await discardTemporaryOutput(prepared.temporaryPath);
      return outcome(compression);
    }
    throwIfAborted(options.signal);
    const outputPath = await publishTemporaryOutput({ ...prepared, signal: options.signal });
    return outcome(compression, [{ path: outputPath, pages: pageCount, bytes: compressedBytes }]);
  } catch (error) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw error;
  }
}

export async function enhancePdfFile(args, options = {}) {
  throwIfAborted(options.signal);
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'strength', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ENHANCE_LIMITS.maxInputBytes
  }), options);
  const strength = args.strength === undefined ? 'medium' : assertString(args.strength, 'strength');
  try {
    assertPdfEnhanceSelection([input]);
    assertPdfEnhanceStrength(strength);
  } catch (error) {
    throw mapPdfEnhanceError(error);
  }

  let loadingTask;
  let activeRender;
  const abort = () => { activeRender?.cancel(); void loadingTask?.destroy().catch(() => {}); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const [canvasModule, enhancementModule] = await Promise.all([
      import('@napi-rs/canvas'),
      importPdfCore('pdf-enhance-engine.js')
    ]);
    for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
      if (canvasModule[name]) globalThis[name] = canvasModule[name];
    }
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    throwIfAborted(options.signal);
    const { createCanvas } = canvasModule;
    const { enhanceRgbaImage } = enhancementModule;
    loadingTask = pdfjsLib.getDocument({
      data: input.bytes.slice(),
      disableWorker: true,
      standardFontDataUrl: getPdfjsStandardFontDataUrl(),
      verbosity: 0
    });
    const sourcePdf = await loadingTask.promise;
    throwIfAborted(options.signal);
    const pageSizes = [];
    for (let pageIndex = 1; pageIndex <= sourcePdf.numPages; pageIndex++) {
      throwIfAborted(options.signal);
      const page = await sourcePdf.getPage(pageIndex);
      const outputViewport = page.getViewport({ scale: 1 });
      pageSizes.push({
        outputWidth: outputViewport.width,
        outputHeight: outputViewport.height
      });
      try { page.cleanup(); } catch {}
    }
    const pagePlan = createPdfEnhanceRenderPlan(pageSizes, { baseRenderScale: 2.5 });
    assertPdfEnhancePagePlan(pagePlan);

    const outputPdf = await PDFDocument.create();
    for (let pageIndex = 1; pageIndex <= sourcePdf.numPages; pageIndex++) {
      throwIfAborted(options.signal);
      const page = await sourcePdf.getPage(pageIndex);
      const plan = pagePlan[pageIndex - 1];
      const renderViewport = page.getViewport({ scale: plan.renderScale });
      const canvas = createCanvas(Math.ceil(plan.renderWidth), Math.ceil(plan.renderHeight));
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('pdf-enhance:enhancement-failed');
        activeRender = page.render({ canvasContext: context, viewport: renderViewport });
        await activeRender.promise;
        throwIfAborted(options.signal);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        enhanceRgbaImage(imageData.data, canvas.width, canvas.height, strength);
        context.putImageData(imageData, 0, 0);
        const image = await outputPdf.embedJpg(canvas.toBuffer('image/jpeg', 85));
        const outputPage = outputPdf.addPage([plan.outputWidth, plan.outputHeight]);
        outputPage.drawImage(image, { x: 0, y: 0, width: plan.outputWidth, height: plan.outputHeight });
      } finally { activeRender = null; canvas.width = canvas.height = 0; try { page.cleanup(); } catch {} }
      options.reportProgress?.(85 * pageIndex / sourcePdf.numPages, 'Enhancing PDF pages.');
    }
    throwIfAborted(options.signal);
    const bytes = await outputPdf.save();
    if (bytes.length > PDF_ENHANCE_LIMITS.maxOutputBytes) throw new Error('pdf-enhance:output-too-large');
    const outputPath = await writePdfOutput({
      outputPath: assertString(args.output_path, 'output_path'),
      inputPaths: [input.path],
      bytes,
      overwrite: assertBoolean(args.overwrite, 'overwrite'), signal: options.signal
    });
    return { tool: 'pdf.enhance', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pagePlan.length, bytes: bytes.length }] };
  } catch (error) {
    if (options.signal?.aborted) throw cancellationError(options.signal);
    throw mapPdfEnhanceError(error);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    try { await loadingTask?.destroy(); } catch {}
  }
}

export const PDF_TOOL_HANDLERS = Object.freeze({
  toolknit_pdf_inspect: inspectPdf,
  toolknit_pdf_merge: mergePdf,
  toolknit_pdf_split: splitPdf,
  toolknit_pdf_rotate: rotatePdf,
  toolknit_pdf_encrypt: encryptPdfFile,
  toolknit_pdf_decrypt: decryptPdfFile,
  toolknit_pdf_compress: compressPdfFile,
  toolknit_pdf_enhance: enhancePdfFile
});

export async function checkQpdfAvailability() {
  const command = await resolveQpdf();
  try {
    const result = await runProcess(command, ['--version']);
    return { available: result.code === 0, command: result.code === 0 ? command : null };
  } catch {
    return { available: false, command: null };
  }
}
