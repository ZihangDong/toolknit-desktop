import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildRenamePlan, validFileName } from '../src/features/productivity/rename-core.js';
import { runPdfWorkflow } from '../src/features/productivity/workflow-core.js';
import { exportPdfWithPageNumbers } from '../src/pdf-page-number-core.js';
import { createTaskCenter } from '../src/app/task-center.js';
import { createTrackedInvoke, resultOutputs } from '../src/platform/tracked-invoke.js';

const files = [{ name: '照片.jpg', path: 'C:\\photos\\照片.jpg' }, { name: '记录.tar.gz', path: 'C:\\photos\\记录.tar.gz' }];
const plan = buildRenamePlan(files, { pattern: '{date}_{n}_{name}', start: 7, digits: 2 }, new Date(2026, 10, 20));
assert.equal(plan[0].newName, '2026-11-20_07_照片.jpg');
assert.equal(plan[1].newName, '2026-11-20_08_记录.tar.gz');
assert.equal(buildRenamePlan([{ name: '.gitignore' }], { pattern: '{name}' })[0].newName, '.gitignore');
assert.equal(buildRenamePlan([{ name: 'a.txt' }, { name: 'b.txt' }], { pattern: 'same' })[1].error, '目标名称重复 / Duplicate target');
assert.equal(buildRenamePlan([{ name: 'item-123.txt' }], { pattern: '{name}', regex: true, find: '\\d+', replace: 'x' })[0].newName, 'item-x.txt');
assert.throws(() => buildRenamePlan(files, { regex: true, find: '[' }));
assert.throws(() => buildRenamePlan(files, { digits: 0 }));
for (const value of ['NUL.txt', 'COM¹.txt', '../a', 'abc.', 'a:b', 'a\n']) assert.equal(validFileName(value), false, value);

const map = new Map();
const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
const center = createTaskCenter({ storage, limit: 2 });
let cancelled = 0, retries = 0;
const first = center.begin({ label: 'first', cancel: () => { cancelled++; }, retry: () => { retries++; } });
first.progress(24, 'working');
await center.cancel(first.id); assert.equal(cancelled, 1); assert.equal(center.list()[0].state, 'cancelling');
first.fail(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
await center.retry(first.id); assert.equal(retries, 1);
const active = center.begin({ label: 'active' });
for (let i = 0; i < 5; i++) center.begin({ label: `done ${i}` }).finish();
assert.equal(center.list().length, 3, 'active tasks survive history pruning');
assert(center.list().some(row => row.id === active.id));
const restored = createTaskCenter({ storage });
assert.equal(restored.list().find(row => row.id === active.id).state, 'interrupted');
center.clearFinished(); assert.equal(center.list().length, 1);
const committed = center.begin({ label: 'committing', cancel: () => { throw new Error('must not cancel commit'); } });
committed.disableCancellation(); assert.equal(center.list()[0].canCancel, false);
committed.finish({ outputs: ['C:\\out.pdf'] }); committed.fail(new Error('late error'));
assert.equal(center.list()[0].state, 'succeeded', 'late events cannot corrupt a completed task');
assert.deepEqual(resultOutputs({ output_paths: ['a.pdf'], files: [{ outputPath: 'b.pdf' }] }), ['a.pdf', 'b.pdf']);

const trackedCenter = createTaskCenter();
const calls = [], pending = [];
const tracked = createTrackedInvoke({ center: trackedCenter, listen: async () => () => {},
  invoke: async (command, args) => {
    calls.push(command);
    if (command === 'cancel_convert') return true;
    return new Promise((resolve, reject) => pending.push({ resolve, reject, command, args }));
  }
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const running = tracked('convert_image_batch', { inputPaths: ['a'], outputDir: 'out' });
await tick();
const queued = tracked('compress_image_batch', { inputPaths: ['b'], outputDir: 'out' });
const queuedResult = queued.catch(error => error);
await tick(); assert.equal(pending.length, 1, 'native conversions serialize');
const queuedTask = trackedCenter.list().find(row => row.tool === 'image-compress');
assert.equal(queuedTask.state, 'queued');
await trackedCenter.cancel(queuedTask.id);
assert(!calls.includes('cancel_convert'), 'cancelling queued work never cancels another task');
pending[0].resolve({ success_count: 1, fail_count: 0, output_dir: 'out' });
await running; assert.equal((await queuedResult).code, 'CANCELLED');
assert.equal(pending.length, 1, 'cancelled queued work is never executed');
const ownerRun = tracked('convert_image_batch', { inputPaths: ['c'], outputDir: 'out' }); await tick();
const sourceQueued = tracked('compress_image_batch', { inputPaths: ['d'], outputDir: 'out' });
const sourceQueuedResult = sourceQueued.catch(error => error); await tick();
await tracked('cancel_convert', { toolknitTaskTool: 'image-compress' });
assert(!calls.includes('cancel_convert'), 'source-page cancellation is scoped to its queued task');
await tracked('cancel_convert', { toolknitTaskTool: 'audio-clip' });
assert(!calls.includes('cancel_convert'), 'untracked pages cannot cancel a different page’s task');
pending[1].resolve({ success_count: 1, fail_count: 0 }); await ownerRun;
assert.equal((await sourceQueuedResult).code, 'CANCELLED');
const partial = tracked('convert_word_to_pdf', { jobId: 'abc' }); await tick();
const queuedWord = tracked('convert_word_to_pdf', { jobId: 'queued-word' });
const queuedWordResult = queuedWord.catch(error => error); await tick();
await tracked('cancel_word_to_pdf', { jobId: 'queued-word' });
assert(!calls.includes('cancel_word_to_pdf'), 'Word cancellation matches its job ID while queued');
pending[2].resolve({ files: [{ status: 'failed', error: 'bad source' }, { status: 'success', outputPath: 'ok.pdf' }] });
await partial;
assert.equal((await queuedWordResult).code, 'CANCELLED');
const failedWord = trackedCenter.list().find(row => row.state === 'failed');
assert(failedWord);
assert.deepEqual(failedWord.outputs, ['ok.pdf'], 'partial failures retain successful output paths');

const docs = [];
for (const width of [300, 600]) {
  const doc = await PDFDocument.create(); doc.addPage([width, 400]); docs.push(await doc.save());
}
let written, writes = 0;
const args = {
  files: [{ name: 'one.pdf', size: docs[0].length }, { name: 'two.pdf', size: docs[1].length }],
  options: { input: 'pdf', number: true, start: 5 },
  readFile: async file => docs[file.name === 'one.pdf' ? 0 : 1],
  pdf: { PDFDocument, copyPages: (target, source, indices) => target.copyPages(source, indices) },
  addNumbers: (bytes, count, options, progress) => exportPdfWithPageNumbers({ sources: [{ id: 'input', bytes }],
    pages: Array.from({ length: count }, (_, sourcePageIndex) => ({ id: String(sourcePageIndex), sourceId: 'input', sourcePageIndex })),
    settings: { start: options.start }, onProgress: event => progress(event.percent) }),
  write: async bytes => { writes++; written = bytes; return 'result.pdf'; }
};
const result = await runPdfWorkflow(args);
assert.equal(result.pages, 2); assert.equal(writes, 1);
const merged = await PDFDocument.load(written);
assert.deepEqual(merged.getPages().map(page => page.getWidth()), [300, 600], 'workflow preserves input order and page dimensions');
let checks = 0; writes = 0;
await assert.rejects(runPdfWorkflow({ ...args, check() { if (++checks >= 3) throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' });
assert.equal(writes, 0, 'cancelled workflow publishes no output');
await assert.rejects(runPdfWorkflow({ ...args, files: [{ name: 'bad.png' }] }), /File type/);
console.log('Productivity: naming, task persistence, queue cancellation, partial failures, PDF workflow and cancellation passed.');
