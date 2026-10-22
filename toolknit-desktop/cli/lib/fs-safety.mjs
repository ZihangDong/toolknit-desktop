import { access, link, lstat, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ToolKnitError, throwIfAborted } from './errors.mjs';
import { assertNoLinkedParents, readInputFile, prepareOutputFile, writeOutputFile } from './safe-files.mjs';

const PDF_EXTENSION = '.pdf';

function assertPathValue(value, label, errorCode = 'INVALID_ARGUMENT') {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new ToolKnitError(errorCode, `${label} must be a non-empty file path.`);
  }
  return path.resolve(value.trim());
}

function assertPdfPath(filePath, label, errorCode = 'INPUT_INVALID') {
  const absolutePath = assertPathValue(filePath, label, errorCode);
  if (path.extname(absolutePath).toLowerCase() !== PDF_EXTENSION) {
    throw new ToolKnitError(errorCode, `${label} must point to a .pdf file.`);
  }
  return absolutePath;
}

export async function inspectPdfInput(inputPath, options = {}) {
  const absolutePath = assertPdfPath(inputPath, options.label || 'Input path');
  await assertNoLinkedParents(absolutePath);
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ToolKnitError('INPUT_NOT_FOUND', `Input file does not exist: ${absolutePath}`);
    }
    throw new ToolKnitError('INPUT_INVALID', `Input file cannot be read: ${absolutePath}`);
  }

  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ToolKnitError('INPUT_INVALID', `Input path must be a regular PDF file: ${absolutePath}`);
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `Input PDF is empty or has an invalid size: ${absolutePath}`);
  }
  if (Number.isSafeInteger(options.maxBytes) && metadata.size > options.maxBytes) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `Input PDF exceeds the ${Math.floor(options.maxBytes / 1024 / 1024)} MB limit.`);
  }

  return { path: absolutePath, name: path.basename(absolutePath), size: metadata.size };
}

export async function readPdfInput(input, options = {}) {
  const descriptor = typeof input === 'string'
    ? await inspectPdfInput(input, options)
    : input;
  try {
    const checked = await readInputFile(descriptor.path, { extensions: ['.pdf'], maxBytes: descriptor.size, signal: options.signal });
    const bytes = Uint8Array.from(checked.bytes);
    if (bytes.length !== descriptor.size) {
      throw new ToolKnitError('INPUT_INVALID', `Input PDF changed while it was being read: ${descriptor.path}`);
    }
    return { ...descriptor, bytes };
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('INPUT_INVALID', `Input PDF cannot be read: ${descriptor.path}`);
  }
}

async function outputTarget(outputPath, inputPaths, overwrite) {
  const target = assertPdfPath(outputPath, 'Output path', 'OUTPUT_INVALID');
  return prepareOutputFile(target, { extensions: ['.pdf'], inputPaths, overwrite });
}

export async function preparePdfOutput({ outputPath, inputPaths, overwrite = false }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new ToolKnitError('INTERNAL', 'Output safety check requires at least one input path.');
  }
  return outputTarget(outputPath, inputPaths, overwrite === true);
}

export async function publishTemporaryOutput({ target, temporaryPath, overwrite, parent, inputPaths = [], signal }) {
  try {
    throwIfAborted(signal);
    await prepareOutputFile(target, { inputPaths, overwrite, signal });
    if (parent && await realpath(path.dirname(target)) !== parent) throw new ToolKnitError('OUTPUT_INVALID', 'Output directory changed.');
    throwIfAborted(signal);
    if (overwrite) {
      await rename(temporaryPath, target);
    } else {
      // link() makes the no-overwrite publish operation atomic on the target volume.
      await link(temporaryPath, target);
      await unlink(temporaryPath);
    }
    return target;
  } catch (error) {
    try { await unlink(temporaryPath); } catch {}
    if (error instanceof ToolKnitError) throw error;
    if (error?.code === 'EEXIST') {
      throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite an existing file: ${target}`);
    }
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Output file could not be published: ${target}`);
  }
}

export async function writePdfOutput({ outputPath, inputPaths, bytes, overwrite = false, signal }) {
  if (!inputPaths?.length) throw new ToolKnitError('INTERNAL', 'Output safety requires an input path.');
  return writeOutputFile(outputPath, bytes, { extensions: ['.pdf'], inputPaths, overwrite, signal });
}

export async function writeGeneratedPdfOutput({ outputPath, bytes, overwrite = false }) {
  return writeOutputFile(outputPath, bytes, { extensions: ['.pdf'], overwrite });
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(filePath) {
  const metadata = await stat(filePath);
  return metadata.size;
}
