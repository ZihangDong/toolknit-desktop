import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { ToolKnitError } from './errors.mjs';
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
const { PDF_ENCRYPT_LIMITS, assertPdfEncryptPassword, assertPdfEncryptSelection, encryptPdf } = encryptCore;
const { PDF_DECRYPT_LIMITS, assertPdfDecryptPassword, assertPdfDecryptSelection } = decryptCore;
const { PDF_COMPRESS_LIMITS, assertPdfCompressLevel, assertPdfCompressSelection } = compressCore;
const { PDF_ENHANCE_LIMITS, assertPdfEnhancePagePlan, assertPdfEnhanceSelection, assertPdfEnhanceStrength } = enhanceCore;

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
  const pageIndexes = new Set();
  return value.map((entry, index) => {
    assertObject(entry, `page_rotations[${index}]`);
    assertOnlyKeys(entry, new Set(['page', 'rotation']));
    const pageIndex = assertPositiveInteger(entry.page, `page_rotations[${index}].page`);
    if (pageIndex > sourcePageCount) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_rotations[${index}].page is outside the input PDF.`);
    }
    if (pageIndexes.has(pageIndex)) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'page_rotations cannot contain duplicate pages.');
    }
    pageIndexes.add(pageIndex);
    if (!Number.isFinite(entry.rotation) || entry.rotation % 90 !== 0) {
      throw new ToolKnitError('INVALID_ARGUMENT', `page_rotations[${index}].rotation must be a multiple of 90.`);
    }
    return { pageIndex, rotation: entry.rotation };
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

async function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
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
      if (error?.code === 'ENOENT') {
        fail(new ToolKnitError('ENGINE_UNAVAILABLE', 'qpdf is unavailable. Reinstall ToolKnit CLI or configure TOOLKNIT_QPDF_PATH.'));
        return;
      }
      fail(new ToolKnitError('PROCESSING_FAILED', 'The PDF engine could not start.'));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
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

export async function inspectPdf(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path']));
  const input = await readPdfInput(assertString(args.input_path, 'input_path'));
  const pageCount = await pageCountFor(input.bytes);
  return {
    tool: 'pdf.inspect',
    input: { path: input.path, name: input.name, bytes: input.size, pages: pageCount },
    outputs: []
  };
}

export async function mergePdf(args) {
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
  const inputs = await Promise.all(descriptors.map(readPdfInput));
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
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: inputs.map(input => input.path),
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  return {
    tool: 'pdf.merge',
    inputs: inputs.map(input => ({ path: input.path, bytes: input.size })),
    outputs: [{ path: outputPath, pages: pages.length, bytes: bytes.length }]
  };
}

export async function splitPdf(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_dir', 'pages', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_SPLIT_LIMITS.maxTotalBytes
  }));
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
    const outputPath = path.join(path.resolve(outputDirectory), output.fileName);
    const savedPath = await writePdfOutput({
      outputPath,
      inputPaths: [input.path],
      bytes: output.bytes,
      overwrite: assertBoolean(args.overwrite, 'overwrite')
    });
    published.push({ path: savedPath, page: output.pageIndex, bytes: output.bytes.length });
  }
  return { tool: 'pdf.split', inputs: [{ path: input.path, bytes: input.size }], outputs: published };
}

export async function rotatePdf(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'rotation', 'page_rotations', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ROTATE_LIMITS.maxInputBytes
  }));
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
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  return { tool: 'pdf.rotate', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pages.length, bytes: bytes.length }] };
}

export async function encryptPdfFile(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'password', 'permissions', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ENCRYPT_LIMITS.maxInputBytes
  }));
  try {
    assertPdfEncryptSelection([input], input.size);
    assertPdfEncryptPassword(assertString(args.password, 'password'));
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
  const outputPath = await writePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    bytes,
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  return { tool: 'pdf.encrypt', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, bytes: bytes.length }] };
}

export async function decryptPdfFile(args) {
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
  const output = await runProcess(qpdf, qpdfArgs, password.length > 0 ? `${password}\n` : undefined);
  if (output.code !== 0) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw qpdfError(output, 'PDF decryption');
  }
  const pages = await runProcess(qpdf, ['--show-npages', '--', prepared.temporaryPath]);
  const pageCount = Number.parseInt(pages.stdout.toString('utf8').trim(), 10);
  if (pages.code !== 0 || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_DECRYPT_LIMITS.maxPages) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw new ToolKnitError('PROCESSING_FAILED', 'PDF decryption produced an invalid output.');
  }
  const outputPath = await publishTemporaryOutput(prepared);
  return { tool: 'pdf.decrypt', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pageCount, bytes: await fileSize(outputPath) }] };
}

export async function compressPdfFile(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'level', 'overwrite']));
  const input = await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_COMPRESS_LIMITS.maxInputBytes
  });
  const level = args.level === undefined ? 'medium' : assertString(args.level, 'level');
  try {
    assertPdfCompressSelection([input]);
    assertPdfCompressLevel(level);
  } catch (error) {
    throw new ToolKnitError('INPUT_INVALID', String(error.message || error));
  }
  const prepared = await preparePdfOutput({
    outputPath: assertString(args.output_path, 'output_path'),
    inputPaths: [input.path],
    overwrite: assertBoolean(args.overwrite, 'overwrite')
  });
  const qpdf = await resolveQpdf();
  const pages = await runProcess(qpdf, ['--show-npages', '--', input.path]);
  const pageCount = Number.parseInt(pages.stdout.toString('utf8').trim(), 10);
  if (pages.code !== 0) throw qpdfError(pages, 'PDF inspection');
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_COMPRESS_LIMITS.maxPages) {
    throw new ToolKnitError('INPUT_INVALID', 'PDF page count exceeds the compression limit.');
  }
  const qpdfArgs = ['--warning-exit-0', '--object-streams=generate', '--compress-streams=y'];
  if (level !== 'low') {
    qpdfArgs.push('--recompress-flate', level === 'high' ? '--compression-level=9' : '--compression-level=6');
  }
  qpdfArgs.push('--', input.path, prepared.temporaryPath);
  const output = await runProcess(qpdf, qpdfArgs);
  if (output.code !== 0) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw qpdfError(output, 'PDF compression');
  }
  const check = await runProcess(qpdf, ['--check', prepared.temporaryPath]);
  if (check.code !== 0) {
    await discardTemporaryOutput(prepared.temporaryPath);
    throw new ToolKnitError('PROCESSING_FAILED', 'PDF compression produced an invalid output.');
  }
  const compressedBytes = await fileSize(prepared.temporaryPath);
  if (compressedBytes >= input.size) {
    await discardTemporaryOutput(prepared.temporaryPath);
    return {
      tool: 'pdf.compress',
      inputs: [{ path: input.path, bytes: input.size }],
      outputs: [],
      warnings: ['The optimized PDF was not smaller, so no output file was created.']
    };
  }
  const outputPath = await publishTemporaryOutput(prepared);
  return { tool: 'pdf.compress', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pageCount, bytes: compressedBytes }] };
}

export async function enhancePdfFile(args) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_path', 'output_path', 'strength', 'overwrite']));
  const input = await readPdfInput(await inspectPdfInput(assertString(args.input_path, 'input_path'), {
    maxBytes: PDF_ENHANCE_LIMITS.maxInputBytes
  }));
  const strength = args.strength === undefined ? 'medium' : assertString(args.strength, 'strength');
  try {
    assertPdfEnhanceSelection([input]);
    assertPdfEnhanceStrength(strength);
  } catch (error) {
    throw mapPdfEnhanceError(error);
  }

  let loadingTask;
  try {
    const [pdfjsLib, canvasModule, enhancementModule] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
      importPdfCore('pdf-enhance-engine.js')
    ]);
    const { createCanvas } = canvasModule;
    const { enhanceRgbaImage } = enhancementModule;
    loadingTask = pdfjsLib.getDocument({
      data: input.bytes.slice(),
      disableWorker: true,
      standardFontDataUrl: getPdfjsStandardFontDataUrl(),
      verbosity: 0
    });
    const sourcePdf = await loadingTask.promise;
    const pagePlan = [];
    for (let pageIndex = 1; pageIndex <= sourcePdf.numPages; pageIndex++) {
      const page = await sourcePdf.getPage(pageIndex);
      const outputViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: 2.5 });
      pagePlan.push({
        outputWidth: outputViewport.width,
        outputHeight: outputViewport.height,
        renderWidth: renderViewport.width,
        renderHeight: renderViewport.height
      });
      try { page.cleanup(); } catch {}
    }
    assertPdfEnhancePagePlan(pagePlan);

    const outputPdf = await PDFDocument.create();
    for (let pageIndex = 1; pageIndex <= sourcePdf.numPages; pageIndex++) {
      const page = await sourcePdf.getPage(pageIndex);
      const plan = pagePlan[pageIndex - 1];
      const renderViewport = page.getViewport({ scale: 2.5 });
      const canvas = createCanvas(Math.ceil(plan.renderWidth), Math.ceil(plan.renderHeight));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('pdf-enhance:enhancement-failed');
      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      enhanceRgbaImage(imageData.data, canvas.width, canvas.height, strength);
      context.putImageData(imageData, 0, 0);
      const image = await outputPdf.embedJpg(canvas.toBuffer('image/jpeg', { quality: 85 }));
      const outputPage = outputPdf.addPage([plan.outputWidth, plan.outputHeight]);
      outputPage.drawImage(image, { x: 0, y: 0, width: plan.outputWidth, height: plan.outputHeight });
      try { page.cleanup(); } catch {}
    }
    const bytes = await outputPdf.save();
    if (bytes.length > PDF_ENHANCE_LIMITS.maxOutputBytes) throw new Error('pdf-enhance:output-too-large');
    const outputPath = await writePdfOutput({
      outputPath: assertString(args.output_path, 'output_path'),
      inputPaths: [input.path],
      bytes,
      overwrite: assertBoolean(args.overwrite, 'overwrite')
    });
    return { tool: 'pdf.enhance', inputs: [{ path: input.path, bytes: input.size }], outputs: [{ path: outputPath, pages: pagePlan.length, bytes: bytes.length }] };
  } catch (error) {
    throw mapPdfEnhanceError(error);
  } finally {
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
