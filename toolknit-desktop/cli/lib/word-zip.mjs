import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readInputFile } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

export const WORD_ZIP_LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, entries: 1000, expanded: 200 * 1024 * 1024, documents: 20 });
const invalid = (code = 'invalid-archive') => new ToolKnitError('INPUT_INVALID', `word-render:${code}`);
export function safeWordZipName(name) {
  const value = name.replace(/\/$/, '');
  return !!value && Buffer.byteLength(value) <= 1024 && !value.includes('\\') && value.split('/').every(part =>
    part && !['.', '..'].includes(part) && Buffer.byteLength(part) <= 255 && !/[ .]$/.test(part)
    && !/[\x00-\x1f\x7f-\x9f<>:"|?*]/u.test(part)
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}
function directoryCount(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
    || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)
    || bytes.readUInt32LE(end + 12) + bytes.readUInt32LE(end + 16) !== end) throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  if (!count || count > WORD_ZIP_LIMITS.entries) throw invalid('archive-limit');
  return count;
}
export async function inspectWordZip(bytes, signal) {
  throwIfAborted(signal);
  if (bytes.length > WORD_ZIP_LIMITS.bytes) throw invalid('archive-limit');
  const count = directoryCount(bytes);
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes,
    { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
    (error, value) => error ? reject(invalid()) : resolve(value)));
  try {
    const entries = [], names = new Set(); let expanded = 0, seen = 0, skipped = 0;
    await new Promise((resolve, reject) => {
      const abort = () => { zip.close(); reject(new ToolKnitError('CANCELLED', 'Word ZIP inspection cancelled.')); };
      const finish = error => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      signal?.addEventListener('abort', abort, { once: true });
      zip.once('error', () => finish(invalid()));
      zip.once('end', () => finish());
      zip.on('entry', entry => {
        try {
          throwIfAborted(signal);
          const name = entry.fileName, normalized = name.replace(/\/$/, '').toLowerCase();
          const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (++seen > count || !safeWordZipName(name) || names.has(normalized) || entry.isEncrypted()
            || ![0, 0o100000, 0o040000].includes(kind) || ![0, 8].includes(entry.compressionMethod)) throw invalid();
          names.add(normalized); expanded += entry.uncompressedSize;
          if (!Number.isSafeInteger(expanded) || expanded > WORD_ZIP_LIMITS.expanded) throw invalid('archive-limit');
          if (!name.endsWith('/')) {
            if (/\.(doc|docx)$/i.test(name)) {
              if (entry.uncompressedSize > WORD_ZIP_LIMITS.bytes || entries.length >= WORD_ZIP_LIMITS.documents) throw invalid('archive-limit');
              entries.push(entry);
            } else skipped++;
          }
          zip.readEntry();
        } catch (error) { finish(error); zip.close(); }
      });
      if (signal?.aborted) abort(); else zip.readEntry();
    });
    if (seen !== count) throw invalid();
    if (!entries.length) throw invalid('archive-empty');
    return { zip, entries, skipped, expanded };
  } catch (error) { zip.close(); throw error; }
}
async function entryBytes(zip, entry, signal) {
  throwIfAborted(signal);
  const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(invalid()) : resolve(stream)));
  const abort = () => stream.destroy(new ToolKnitError('CANCELLED', 'Word ZIP extraction cancelled.'));
  signal?.addEventListener('abort', abort, { once: true });
  let size = 0, checksum = 0; const chunks = [];
  try {
    if (signal?.aborted) abort();
    for await (const chunk of stream) {
      throwIfAborted(signal); size += chunk.length;
      if (size > entry.uncompressedSize || size > WORD_ZIP_LIMITS.bytes) throw invalid('archive-limit');
      checksum = crc32(chunk, checksum); chunks.push(chunk);
    }
    if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw invalid();
    return Buffer.concat(chunks, size);
  } catch (error) { throwIfAborted(signal); throw error instanceof ToolKnitError ? error : invalid(); }
  finally { signal?.removeEventListener('abort', abort); stream.destroy(); }
}
export async function prepareWordBatchInputs(inputs, { signal } = {}) {
  let root = null, expanded = 0, compressed = 0, skipped = 0;
  const sources = [], known = new Set();
  const dispose = async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  try {
    for (const input of inputs) {
      throwIfAborted(signal);
      const resolved = path.resolve(input), identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (known.has(identity)) continue;
      known.add(identity);
      if (!/\.zip$/i.test(input)) { sources.push({ path: input, inputPath: input, sourceName: path.basename(input) }); continue; }
      let archive;
      try {
        const file = await readInputFile(input, { extensions: ['.zip'], maxBytes: WORD_ZIP_LIMITS.bytes, signal });
        compressed += file.size;
        if (compressed > WORD_ZIP_LIMITS.expanded) throw invalid('archive-limit');
        archive = await inspectWordZip(file.bytes, signal);
        if (sources.length + archive.entries.length > WORD_ZIP_LIMITS.documents) throw invalid('invalid-file-count');
        const selectedSize = archive.entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
        if (expanded + selectedSize > WORD_ZIP_LIMITS.expanded) throw invalid('archive-limit');
        expanded += selectedSize; skipped += archive.skipped;
        if (!root) root = await mkdtemp(path.join(os.tmpdir(), 'tk-word-zip-'));
        for (const entry of archive.entries) {
          const item = { path: null, inputPath: input, sourceName: path.posix.basename(entry.fileName), archiveEntry: entry.fileName };
          try {
            const bytes = await entryBytes(archive.zip, entry, signal);
            item.path = path.join(root, `${sources.length}${path.extname(entry.fileName).toLowerCase()}`);
            await writeFile(item.path, bytes, { flag: 'wx', mode: 0o600 });
          } catch (error) { throwIfAborted(signal); item.prepareError = error.message?.match(/word-render:([a-z-]+)/)?.[1] || 'invalid-archive'; }
          sources.push(item);
        }
      } catch (error) {
        throwIfAborted(signal);
        sources.push({ path: null, inputPath: input, sourceName: path.basename(input),
          prepareError: error.message?.match(/word-render:([a-z-]+)/)?.[1] || 'invalid-archive' });
      } finally { archive?.zip.close(); }
    }
    if (!sources.length || sources.length > WORD_ZIP_LIMITS.documents) throw new ToolKnitError('INVALID_ARGUMENT', 'Select at most 20 Word documents after ZIP expansion and de-duplication.');
    return { sources, skipped, dispose };
  } catch (error) { await dispose(); throw error; }
}
