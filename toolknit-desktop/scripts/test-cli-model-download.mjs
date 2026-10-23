import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { downloadVerifiedModel } from '../cli/lib/model-download.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-model-contract-'));
const bytes = Buffer.from('Only a local deterministic model fixture.'), model = { display_name: 'Fixture', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const source = { name: 'official', url: 'https://example.invalid/model' };
const file = name => path.join(root, name);
const install = (name, extra = {}) => downloadVerifiedModel({ model, destination: file(name), sources: [source], ...extra });
const noLock = async () => assert.ok(!(await readdir(root)).some(name => name.endsWith('.download.lock')));
try {
  await install('success.bin', { fetchImpl: async () => new Response(bytes) });
  assert.deepEqual(await readFile(file('success.bin')), bytes);
  assert.equal((await install('success.bin', { fetchImpl: () => assert.fail('Verified model must not download twice.') })).already_installed, true);
  await writeFile(file('resume.bin.cli.part'), bytes.subarray(0, 8));
  await install('resume.bin', { fetchImpl: async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=8-');
    return new Response(bytes.subarray(8), { status: 206, headers: { 'Content-Range': `bytes 8-${bytes.length - 1}/${bytes.length}` } });
  } });
  assert.deepEqual(await readFile(file('resume.bin')), bytes);
  await writeFile(file('restart.bin.cli.part'), bytes.subarray(0, 8));
  await install('restart.bin', { fetchImpl: async () => new Response(bytes) });
  assert.deepEqual(await readFile(file('restart.bin')), bytes, 'A server ignoring Range restarts instead of appending.');
  await writeFile(file('previous.bin'), 'previous model');
  await writeFile(file('previous.bin.cli.part'), bytes.subarray(0, 8));
  await assert.rejects(install('previous.bin', { fetchImpl: async () => new Response(bytes.subarray(8), { status: 206, headers: { 'Content-Range': `bytes 9-${bytes.length - 1}/${bytes.length}` } }) }), error => error.details.reason === 'invalid-range');
  assert.equal(await readFile(file('previous.bin'), 'utf8'), 'previous model');
  assert.deepEqual(await readFile(file('previous.bin.cli.part')), bytes.subarray(0, 8));
  await assert.rejects(install('oversized.bin', { fetchImpl: async () => new Response(Buffer.alloc(bytes.length + 1)) }), error => error.details.reason === 'size-limit');
  await assert.rejects(install('hash.bin', { fetchImpl: async () => new Response(Buffer.alloc(bytes.length)) }), error => error.details.reason === 'integrity-check');
  assert.ok(!(await readdir(root)).includes('hash.bin.cli.part'));
  let attempt = 0;
  await install('fallback.bin', { sources: [source, { ...source, name: 'china' }], fetchImpl: async () => ++attempt === 1 ? new Response('', { status: 503 }) : new Response(bytes) });
  assert.equal(attempt, 2);
  const pending = Promise.withResolvers(), entered = Promise.withResolvers(), controller = new AbortController();
  const first = install('concurrent.bin', { signal: controller.signal, fetchImpl: async (url, { signal }) => {
    signal.addEventListener('abort', () => pending.reject(signal.reason), { once: true }); entered.resolve(); return pending.promise;
  } });
  await entered.promise;
  await assert.rejects(install('concurrent.bin'), /already being installed/);
  controller.abort(); await assert.rejects(first, error => error.code === 'CANCELLED');
  await noLock();
  await writeFile(file('locked.bin.download.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(install('locked.bin'), /already being installed/);
  await rm(file('locked.bin.download.lock'));
  await writeFile(file('dead.bin.download.lock'), JSON.stringify({ pid: 2147483647 }));
  await install('dead.bin', { fetchImpl: async () => new Response(bytes) });
  const timer = setInterval(() => {}, 1000);
  try {
    await assert.rejects(install('timeout.bin', { timeoutMs: 30, fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }), error => error.details.reason === 'timeout');
  } finally { clearInterval(timer); }
  await writeFile(file('private.txt'), 'preserve unrelated file');
  await link(file('private.txt'), file('linked.bin.cli.part'));
  await assert.rejects(install('linked.bin', { fetchImpl: () => assert.fail('Hard-link must be rejected before network.') }));
  assert.equal(await readFile(file('private.txt'), 'utf8'), 'preserve unrelated file');
  await writeFile(file('desktop.bin.part'), 'desktop partial');
  await install('desktop.bin', { fetchImpl: async () => new Response(bytes) });
  assert.equal(await readFile(file('desktop.bin.part'), 'utf8'), 'desktop partial');
  await noLock();
  console.log('Model download passed: checksum, resume/restart/range validation, fallback, concurrency, stale locks, cancellation, timeout, hard-links and previous-file preservation.');
} finally { await rm(root, { recursive: true, force: true }); }
