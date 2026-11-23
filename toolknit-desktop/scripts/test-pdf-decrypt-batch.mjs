import assert from 'node:assert/strict';
import { addDecryptFiles, prepareDecryptJobs, runDecryptBatch, decryptErrorCode } from '../src/features/pdf-security/decrypt-batch.js';
import { PDF_DECRYPT_LIMITS } from '../src/pdf-decrypt-core.js';

const file = (name, path = `C:/fixtures/${name}`, size = 100) => ({ name, path, size });
const files = [file('a.pdf'), file('b.pdf'), file('owner-only.pdf')];
let rows = addDecryptFiles([], files);
assert.equal(addDecryptFiles(rows, [file('A.PDF', 'c:\\FIXTURES\\A.PDF')]).length, 3);
assert.equal(addDecryptFiles(rows, [file('a.pdf', 'D:/other/a.pdf')]).length, 4, 'equal basenames at different locations are distinct');
assert.throws(() => addDecryptFiles(rows, [file('ok.pdf'), file('bad.txt')]), /invalid-pdf/);
assert.equal(rows.length, 3, 'mixed invalid additions are atomic');
assert.throws(() => addDecryptFiles(rows, [file('large.pdf', undefined, PDF_DECRYPT_LIMITS.maxInputBytes + 1)]), /input-too-large/);
assert.throws(() => addDecryptFiles([], Array.from({ length: 51 }, (_, i) => file(`${i}.pdf`))), /too-many-files/);
rows[1].passwordMode = 'own'; rows[1].password = 'individual-secret';
rows[2].passwordMode = 'own'; rows[2].password = '';
const ids = rows.map(row => row.id);
let jobs = prepareDecryptJobs(rows, ids, 'shared-secret');
assert.deepEqual(jobs.map(job => job.password), ['shared-secret', 'individual-secret', '']);
rows[1].password = 'line\nbreak';
assert.throws(() => prepareDecryptJobs(rows, ids, ''), /password-unsupported/);
rows[1].password = '\0';
assert.throws(() => prepareDecryptJobs(rows, ids, ''), /password-unsupported/);
rows[1].password = 'x'.repeat(1025);
assert.throws(() => prepareDecryptJobs(rows, ids, ''), /password-unsupported/);
rows[0].status = 'succeeded'; rows[1].password = 'individual-secret';
assert.equal(prepareDecryptJobs(rows, ids, '').length, 2, 'successful rows never enter a retry');
assert.equal(decryptErrorCode(new Error('pdf-decrypt:arbitrary-secret')), 'decryption-failed');

const updates = [], received = [];
let concurrent = 0, peak = 0;
const results = await runDecryptBatch(jobs, {
  prepare: async () => 'C:/output', sizeOf: async () => 100,
  decrypt: async (input, password) => {
    peak = Math.max(peak, ++concurrent); received.push([input.name, password]);
    await Promise.resolve(); concurrent--;
    if (input.name === 'b.pdf') throw new Error('pdf-decrypt:invalid-password');
    return `C:/output/${input.name}`;
  },
  onUpdate: result => updates.push(result)
});
assert.equal(peak, 1, 'native decrypt calls are sequential');
assert.deepEqual(results.map(row => row.status), ['succeeded', 'failed', 'succeeded']);
assert.equal(results[1].error, 'invalid-password');
assert.equal(received[2][1], '', 'an explicit blank individual password overrides a shared password');
assert.ok(jobs.every(job => job.password === ''), 'all credentials released after partial failure');
assert.ok(!JSON.stringify(updates).includes('secret'), 'view events contain no credentials');

for (const stage of ['before-prepare', 'during-prepare', 'during-size', 'during-decrypt']) {
  const controller = new AbortController();
  rows = addDecryptFiles([], files); jobs = prepareDecryptJobs(rows, rows.map(row => row.id), 'cancel-secret');
  const current = jobs;
  let calls = 0, prepared = 0;
  if (stage === 'before-prepare') controller.abort();
  const result = await runDecryptBatch(current, {
    signal: controller.signal,
    prepare: async () => { prepared++; if (stage === 'during-prepare') controller.abort(); return 'C:/output'; },
    sizeOf: async () => { if (stage === 'during-size') controller.abort(); return 100; },
    decrypt: async () => {
      calls++; controller.abort();
      assert.ok(current.every(job => job.password === ''), 'abort immediately releases queued passwords');
      return 'C:/output/finished.pdf';
    }
  });
  assert.equal(calls, stage === 'during-decrypt' ? 1 : 0);
  assert.equal(prepared, stage === 'before-prepare' ? 0 : 1);
  assert.equal(result[0].status, stage === 'during-decrypt' ? 'succeeded' : 'cancelled');
  assert.ok(result.slice(1).every(row => row.status === 'cancelled'));
  assert.ok(current.every(job => job.password === ''));
}

rows = addDecryptFiles([], files);
jobs = prepareDecryptJobs(rows, rows.map(row => row.id), 'directory-secret');
const unavailable = await runDecryptBatch(jobs, {
  prepare: async () => { throw new Error('secret must never be exposed'); },
  sizeOf: async () => assert.fail('preparation failed'), decrypt: async () => assert.fail('preparation failed')
});
assert.ok(unavailable.every(row => row.error === 'output-path' && row.status === 'failed'));
assert.ok(jobs.every(job => job.password === ''));

jobs = prepareDecryptJobs(rows, rows.map(row => row.id), 'size-secret');
let sizeIndex = 0;
const oversized = await runDecryptBatch(jobs, {
  prepare: async () => 'C:/output',
  sizeOf: async () => [0, PDF_DECRYPT_LIMITS.maxInputBytes + 1, 100][sizeIndex++],
  decrypt: async () => 'C:/output/valid.pdf'
});
assert.deepEqual(oversized.map(row => row.error), ['invalid-pdf', 'input-too-large', '']);
assert.equal(oversized[2].status, 'succeeded', 'invalid/oversized files do not stop later valid files');
assert.ok(jobs.every(job => job.password === ''));
console.log('PDF decrypt batch checks passed: limits, deduplication, individual passwords, sequential processing, partial failure and cancellation at every await boundary.');
