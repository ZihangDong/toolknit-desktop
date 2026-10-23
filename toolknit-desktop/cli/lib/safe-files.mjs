import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

export function localPath(value, code = 'INVALID_ARGUMENT') {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError(code, 'An explicit local path is required.');
  }
  const result = path.resolve(value);
  if (process.platform === 'win32' && (result.slice(path.parse(result).root.length).includes(':')
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(path.basename(result)))) {
    throw new ToolKnitError(code, 'Device paths and alternate data streams are not supported.');
  }
  return result;
}

export async function assertNoLinkedParents(filePath, code = 'INPUT_INVALID') {
  let current = filePath;
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new ToolKnitError(code, 'Symbolic links and junctions are not supported.');
    } catch (error) {
      if (error instanceof ToolKnitError) throw error;
      if (error.code !== 'ENOENT') throw new ToolKnitError(code, 'The local path cannot be inspected.');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function readInputFile(value, { extensions, maxBytes = 20 * 1024 * 1024, allowEmpty = false, signal } = {}) {
  throwIfAborted(signal);
  const inputPath = localPath(value);
  if (extensions && !extensions.includes(path.extname(inputPath).toLowerCase())) {
    throw new ToolKnitError('INPUT_INVALID', `Expected ${extensions.join(', ')} input.`);
  }
  await assertNoLinkedParents(inputPath);
  let handle;
  try {
    const before = await lstat(inputPath);
    if (!before.isFile() || before.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', 'Input must be a regular file.');
    handle = await open(inputPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw new ToolKnitError('INPUT_INVALID', 'Input changed before reading.');
    if (!Number.isSafeInteger(info.size) || info.size > maxBytes) throw new ToolKnitError('INPUT_TOO_LARGE', `Input exceeds ${maxBytes} bytes.`);
    if (!allowEmpty && info.size === 0) throw new ToolKnitError('INPUT_INVALID', 'Input is empty.');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new ToolKnitError('INPUT_INVALID', 'Input changed while reading.');
    return { path: inputPath, name: path.basename(inputPath), size: info.size, bytes: bytes.subarray(0, offset) };
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError(error.code === 'ENOENT' ? 'INPUT_NOT_FOUND' : 'INPUT_INVALID', 'The input file cannot be read.');
  } finally { await handle?.close(); }
}

export async function readTextInput(args, options = {}) {
  if ((args.text !== undefined) === (args.input_path !== undefined)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'Supply exactly one of text or input_path.');
  }
  const limit = options.maxBytes ?? 1024 * 1024;
  if (args.text !== undefined) {
    if (typeof args.text !== 'string') throw new ToolKnitError('INVALID_ARGUMENT', 'text must be a string.');
    if (Buffer.byteLength(args.text) > limit) throw new ToolKnitError('INPUT_TOO_LARGE', 'Text exceeds the input limit.');
    return args.text;
  }
  const input = await readInputFile(args.input_path, { ...options, maxBytes: limit, allowEmpty: true });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(input.bytes); }
  catch { throw new ToolKnitError('INPUT_INVALID', 'Input must contain valid UTF-8 text.'); }
}

export async function prepareOutputFile(value, { extensions, inputPaths = [], overwrite = false, signal } = {}) {
  throwIfAborted(signal);
  const target = localPath(value, 'OUTPUT_INVALID');
  if (extensions && !extensions.includes(path.extname(target).toLowerCase())) throw new ToolKnitError('OUTPUT_INVALID', `Output must use ${extensions.join(', ')}.`);
  await assertNoLinkedParents(target, 'OUTPUT_INVALID');
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const inputs = inputPaths.map(value => localPath(value));
  if (inputs.some(input => fold(input) === fold(target))) throw new ToolKnitError('OUTPUT_INVALID', 'Output cannot replace an input.');
  let existing;
  try { existing = await lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw new ToolKnitError('OUTPUT_INVALID', 'Output cannot be inspected.'); }
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) throw new ToolKnitError('OUTPUT_INVALID', 'Output must be a regular file.');
    for (const input of inputs) {
      const info = await lstat(input);
      if (info.dev === existing.dev && info.ino === existing.ino) throw new ToolKnitError('OUTPUT_INVALID', 'Output aliases an input file.');
    }
    if (!overwrite) throw new ToolKnitError('OUTPUT_EXISTS', 'Output already exists; explicit overwrite is required.');
  }
  try { await mkdir(path.dirname(target), { recursive: true }); }
  catch { throw new ToolKnitError('OUTPUT_INVALID', 'Output directory cannot be created.'); }
  const parent = await realpath(path.dirname(target));
  return { target, parent, temporaryPath: path.join(path.dirname(target), `.${randomUUID()}.toolknit.tmp`), overwrite, inputPaths: inputs };
}

export async function writeOutputFile(value, bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new ToolKnitError('PROCESSING_FAILED', 'No output was produced.');
  const prepared = options.prepared || await prepareOutputFile(value, options);
  let handle;
  try {
    throwIfAborted(options.signal);
    handle = await open(prepared.temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    throwIfAborted(options.signal);
    await assertNoLinkedParents(prepared.target, 'OUTPUT_INVALID');
    if (await realpath(path.dirname(prepared.target)) !== prepared.parent) throw new ToolKnitError('OUTPUT_INVALID', 'Output directory changed.');
    // Recheck aliases just before publication. rename preserves the old file if
    // replacement fails; unlinking first would destroy a valid previous result.
    await prepareOutputFile(prepared.target, { ...options, inputPaths: prepared.inputPaths, overwrite: prepared.overwrite });
    if (prepared.overwrite) await rename(prepared.temporaryPath, prepared.target);
    else { await link(prepared.temporaryPath, prepared.target); await unlink(prepared.temporaryPath); }
    return prepared.target;
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError(error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED', 'The result could not be published. Existing files were preserved.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(prepared.temporaryPath).catch(() => {});
  }
}
