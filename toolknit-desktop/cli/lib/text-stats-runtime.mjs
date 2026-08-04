import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { TEXT_STATS_LIMITS, calculateTextStats } from './core/text-stats-core.js';
import { ToolKnitError } from './errors.mjs';

const MAX_UTF8_BYTES = TEXT_STATS_LIMITS.maxInputChars * 4;

function report(options, value, message) {
  try { options.reportProgress?.(value, message); } catch {}
}

function decodeUtf8(bytes, source) {
  if (bytes.length > MAX_UTF8_BYTES) throw new ToolKnitError('INPUT_TOO_LARGE', `Text input exceeds the ${TEXT_STATS_LIMITS.maxInputChars} character limit.`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ToolKnitError('INPUT_INVALID', `Text input is not valid UTF-8: ${source}`); }
  if (text.includes('\0')) throw new ToolKnitError('INPUT_INVALID', `Text input appears to be binary: ${source}`);
  if (text.length > TEXT_STATS_LIMITS.maxInputChars) throw new ToolKnitError('INPUT_TOO_LARGE', `Text input exceeds the ${TEXT_STATS_LIMITS.maxInputChars} character limit.`);
  return text;
}

export async function readUtf8TextFile(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  const resolved = path.resolve(inputPath.trim());
  let metadata;
  try { metadata = await lstat(resolved); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Text input does not exist: ${resolved}`); }
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new ToolKnitError('INPUT_INVALID', `Text input must be a regular file: ${resolved}`);
  if (metadata.size > MAX_UTF8_BYTES) throw new ToolKnitError('INPUT_TOO_LARGE', `Text input exceeds the ${TEXT_STATS_LIMITS.maxInputChars} character limit.`);
  let bytes;
  try { bytes = await readFile(resolved); } catch { throw new ToolKnitError('INPUT_INVALID', `Text input cannot be read: ${resolved}`); }
  return { text: decodeUtf8(bytes, resolved), input: { source: 'file', path: resolved, bytes: bytes.length } };
}

export async function readUtf8Stdin(input = process.stdin) {
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_UTF8_BYTES) throw new ToolKnitError('INPUT_TOO_LARGE', `Text input exceeds the ${TEXT_STATS_LIMITS.maxInputChars} character limit.`);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('INPUT_INVALID', 'Text input could not be read from standard input.');
  }
  const bytes = Buffer.concat(chunks);
  return { text: decodeUtf8(bytes, 'standard input'), input: { source: 'stdin', bytes: bytes.length } };
}

export function analyzeTextStats(text, input, options = {}) {
  report(options, 0, 'Validating UTF-8 text input.');
  let stats;
  try { stats = calculateTextStats(text); } catch (error) {
    if (error instanceof RangeError) throw new ToolKnitError('INPUT_TOO_LARGE', error.message);
    throw new ToolKnitError('INVALID_ARGUMENT', 'Text input must be valid UTF-8 text.');
  }
  report(options, 100, 'Text statistics completed.');
  return { tool: 'text.stats', input, stats };
}

export async function analyzeTextFile(args, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  if (Object.keys(args).some(key => key !== 'input_path')) throw new ToolKnitError('INVALID_ARGUMENT', 'Unknown argument.');
  report(options, 0, 'Reading UTF-8 text file.');
  const value = await readUtf8TextFile(args.input_path);
  return analyzeTextStats(value.text, value.input, options);
}
