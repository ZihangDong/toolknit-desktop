import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertNoLinkedParents } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';

const downloads = new Set();
const busy = () => new ToolKnitError('PROCESSING_FAILED', 'This model is already being installed by another ToolKnit CLI task.');
async function regularInfo(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', 'Model files must be regular local files.');
    return info;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function checksum(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) { throwIfAborted(signal); hash.update(chunk); }
  throwIfAborted(signal); return hash.digest('hex');
}
async function lock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      const identity = await handle.stat();
      return async () => {
        await handle.close();
        const current = await regularInfo(file);
        if (current?.ino === identity.ino && current?.dev === identity.dev) await unlink(file);
      };
    } catch (error) {
      if (handle) { await handle.close().catch(() => {}); await unlink(file).catch(() => {}); throw error; }
      if (error.code !== 'EEXIST') throw error;
      const info = await regularInfo(file);
      if (!info || info.size > 512) throw busy();
      let owner;
      try { owner = JSON.parse(await readFile(file, 'utf8')).pid; } catch { throw busy(); }
      if (!Number.isInteger(owner) || owner <= 0) throw busy();
      try { process.kill(owner, 0); throw busy(); }
      catch (error) { if (error.code !== 'ESRCH') throw busy(); }
      const current = await regularInfo(file);
      if (current?.ino !== info.ino || current?.dev !== info.dev || current?.mtimeMs !== info.mtimeMs) throw busy();
      await unlink(file);
    }
  }
  throw busy();
}

export async function downloadVerifiedModel({ model, destination, sources, signal, reportProgress, fetchImpl = fetch, timeoutMs = 15 * 60 * 1000 }) {
  throwIfAborted(signal);
  if (downloads.has(destination)) throw busy();
  downloads.add(destination);
  let release;
  try {
    await assertNoLinkedParents(destination);
    release = await lock(`${destination}.download.lock`);
    const current = await regularInfo(destination);
    if (current?.size === model.bytes && await checksum(destination, signal) === model.sha256) return { already_installed: true };
    // Desktop downloads use .part; keep CLI partial data independent so the
    // two processes cannot append different responses to the same file.
    const partial = `${destination}.cli.part`;
    let failure = 'download-failed';
    for (const source of sources) {
      throwIfAborted(signal);
      const timeout = AbortSignal.timeout(timeoutMs), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        const info = await regularInfo(partial);
        if (info?.nlink > 1) throw new ToolKnitError('INPUT_INVALID', 'A model partial download cannot be a hard-linked file.');
        let start = info?.size ?? 0;
        if (start > model.bytes) { await unlink(partial); start = 0; }
        if (start === model.bytes) {
          if (await checksum(partial, requestSignal) === model.sha256) {
            throwIfAborted(requestSignal); await rename(partial, destination);
            return { already_installed: false, source: source.name };
          }
          await unlink(partial); start = 0;
        }
        const headers = { 'User-Agent': 'ToolKnit/3.2.0 offline-model-manager' };
        if (start) headers.Range = `bytes=${start}-`;
        response = await fetchImpl(source.url, { headers, redirect: 'follow', signal: requestSignal });
        if (![200, 206].includes(response.status) || !response.body) throw new Error('http-status');
        const append = response.status === 206;
        if (append) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          if (!range || Number(range[1]) !== start || Number(range[2]) < start || Number(range[2]) >= model.bytes || Number(range[3]) !== model.bytes) throw new Error('invalid-range');
        } else start = 0;
        let received = start;
        const meter = new Transform({ transform(chunk, encoding, callback) {
          received += chunk.length;
          if (received > model.bytes) { callback(new Error('size-limit')); return; }
          try { reportProgress?.(Math.min(94, received / model.bytes * 94), `Downloading ${model.display_name} model.`); } catch {}
          callback(null, chunk);
        } });
        const flags = constants.O_WRONLY | constants.O_CREAT | (append ? constants.O_APPEND : constants.O_TRUNC) | (constants.O_NOFOLLOW || 0);
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial, { flags, mode: 0o600 }), { signal: requestSignal });
        if (received !== model.bytes) throw new Error('incomplete-response');
        if (await checksum(partial, requestSignal) !== model.sha256) throw new Error('integrity-check');
        throwIfAborted(requestSignal);
        await assertNoLinkedParents(destination);
        await regularInfo(destination);
        await rename(partial, destination);
        return { already_installed: false, source: source.name };
      } catch (error) {
        if (signal?.aborted) throw cancellationError(signal);
        failure = timeout.aborted ? 'timeout' : /^[a-z-]{1,40}$/.test(error.message) ? error.message : 'download-failed';
        const info = await regularInfo(partial);
        if (info && info.size >= model.bytes) await unlink(partial);
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    }
    throw new ToolKnitError('PROCESSING_FAILED', 'Model download failed; the previous model was preserved and partial downloads can be resumed.', { details: { reason: failure } });
  } catch (error) {
    if (signal?.aborted) throw cancellationError(signal);
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('PROCESSING_FAILED', 'Model download storage could not be prepared. Previous files were preserved.');
  } finally {
    await release?.().catch(() => {});
    downloads.delete(destination);
  }
}
