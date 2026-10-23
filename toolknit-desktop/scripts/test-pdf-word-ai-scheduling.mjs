import assert from 'node:assert/strict';
import { runWordAi, createWordAiCache, wordInputDigest } from '../src/features/pdf-to-word/ai-runtime.js';
import { validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { resultTargets } from '../src/features/pdf-to-word/core/result-edit.js';
import { LIMITS, wordError } from '../src/features/pdf-to-word/core/input.js';

const page = number => {
  const id = 'source-' + number, rect = { x: 20, y: 20, width: 150, height: 12 };
  return { number, width: 595, height: 842, header: [], footer: [], content: rect, risks: [], evidence: [],
    sources: [{ id, text: id, disposition: 'editable' }], blocks: [{ id: id + ':paragraph', type: 'paragraph', role: 'paragraph', rect, sourceIds: [id],
      lines: [{ text: id, rect, sourceIds: [id], items: [{ id, type: 'text', text: id, rect, sourceIds: [id], size: 12 }] }] }] };
};
const doc = count => ({ schemaVersion: 1, pages: Array.from({ length: count }, (_, index) => page(index + 1)) });
const response = request => JSON.stringify({ schemaVersion: 2, requestId: request.requestId, inputDigest: request.inputDigest,
  sourceDigest: request.sourceDigest, page: request.page, scopeId: request.scopeId,
  groups: request.regions.map((region, index) => ({ id: 'g' + index, role: 'paragraph', sourceIds: [region.id] })),
  readingOrder: request.regions.map((_, index) => 'g' + index) });
const operation = () => ({ abort: new AbortController(), check() { if (this.abort.signal.aborted) throw wordError('cancelled'); } });
const digest = await wordInputDigest(new Uint8Array([7, 2, 1]));
const common = { inputDigest: digest, expectedProvider: { url: 'https://fixture.invalid/v1/chat/completions', model: 'fixture' },
  renderRegion: async () => 'data:image/png;base64,fixture' };
const until = async predicate => {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('The expected scheduling event did not happen');
};

const cache = createWordAiCache(), original = doc(72), requests = [];
let last;
for (let attempt = 0; attempt < 10; attempt++) {
  last = await runWordAi({ ...common, document: original, cache, operation: operation(), requestAi: async messages => {
    const request = JSON.parse(messages[1].content[0].text); requests.push(request.page); return response(request);
  } });
  assert.equal(last.review.reviewed, Math.min(72, (attempt + 1) * 8));
}
assert.deepEqual(requests, Array.from({ length: 72 }, (_, i) => i + 1), 'response-cache eviction cannot reset completed work');
assert.equal(last.review.remaining, 0); assert.equal(last.requests, 0);
assert(cache.size <= 32 && cache.bytes <= 2 * 1024 * 1024);
assert.equal(validateCoverage(last.document).characters, validateCoverage(original).characters);
assert.deepEqual(original, doc(72), 'checkpoint application never mutates source pages');
assert.equal(cache.restore(original, digest, 'unrelated').completed.size, 0, 'provider identity isolates progress');
cache.clear(); assert.equal(cache.restore(original, digest, 'unrelated').completed.size, 0);

const priorityCache = createWordAiCache(), priorityDocument = doc(5), priorityRequests = [];
let priorityResult;
for (const selectedPages of [[5], [3], [4]]) {
  priorityResult = await runWordAi({ ...common, document: priorityDocument, cache: priorityCache, operation: operation(),
    selectedPages, limits: { ...LIMITS, aiRegions: 2 }, requestAi: async messages => {
      const request = JSON.parse(messages[1].content[0].text); priorityRequests.push(request.page); return response(request);
    } });
}
assert.deepEqual(priorityRequests, [5, 1, 3, 2, 4], 'changing the preview priority resumes only unchecked pages');
assert.equal(priorityResult.review.remaining, 0);
assert.deepEqual(priorityResult.document.pages.map(page => page.number), [1, 2, 3, 4, 5]);

const gates = [], order = [], concurrencyDoc = doc(5), concurrencyCache = createWordAiCache();
let active = 0, maximum = 0, rendering = 0, maximumRendering = 0;
const concurrent = runWordAi({ ...common, document: concurrencyDoc, cache: concurrencyCache, operation: operation(),
  renderRegion: async () => { rendering++; maximumRendering = Math.max(maximumRendering, rendering);
    await new Promise(resolve => setTimeout(resolve, 2)); rendering--; return 'data:image/png;base64,fixture'; },
  requestAi: (messages, signal) => {
    const request = JSON.parse(messages[1].content[0].text); active++; maximum = Math.max(maximum, active);
    return new Promise(resolve => gates.push({ page: request.page, signal, release() { active--; order.push(request.page); resolve(response(request)); } }));
  } });
await until(() => gates.length === 2);
assert.equal(maximum, 2); assert.equal(maximumRendering, 1);
gates[1].release(); gates[0].release();
await until(() => gates.length === 4);
gates[3].release(); gates[2].release();
await until(() => gates.length === 5); gates[4].release();
const concurrentResult = await concurrent;
assert.deepEqual(order, [2, 1, 4, 3, 5]); assert.equal(maximum, 2);
assert.equal(concurrentResult.review.reviewed, 5);
assert.deepEqual(concurrentResult.document.pages.map(page => resultTargets(page)[0].text), concurrencyDoc.pages.map(page => page.sources[0].text));

const cancel = operation(), cancelSignals = [], cancelCache = createWordAiCache();
const cancelled = runWordAi({ ...common, document: doc(5), cache: cancelCache, operation: cancel,
  requestAi: (_messages, signal) => { cancelSignals.push(signal); return new Promise(() => {}); } });
await until(() => cancelSignals.length === 2); cancel.abort.abort();
await assert.rejects(cancelled, /cancelled/);
assert(cancelSignals.every(signal => signal.aborted)); assert.equal(cancelCache.size, 0);

let rejectFirst; const failureSignals = [];
const failed = runWordAi({ ...common, document: doc(5), operation: operation(), requestAi: (_messages, signal) => {
  failureSignals.push(signal); return new Promise((_resolve, reject) => { if (!rejectFirst) rejectFirst = reject; });
} });
await until(() => failureSignals.length === 2);
rejectFirst(Object.assign(new Error('denied'), { code: 'http_error', status: 401 }));
await assert.rejects(failed, error => error.code === 'http_error' && error.status === 401);
assert(failureSignals.every(signal => signal.aborted));
assert.equal(failureSignals.length, 2, 'fatal errors stop queued requests');

const laterSignals = []; let rejectLater;
const laterFailure = runWordAi({ ...common, document: doc(5), operation: operation(), requestAi: (_messages, signal) => {
  laterSignals.push(signal);
  return new Promise((_resolve, reject) => { if (laterSignals.length === 2) rejectLater = reject; });
} });
await until(() => laterSignals.length === 2);
rejectLater(Object.assign(new Error('rate limit'), { code: 'http_error', status: 429 }));
await assert.rejects(laterFailure, error => error.code === 'http_error' && error.status === 429);
assert(laterSignals.every(signal => signal.aborted), 'a later failure aborts an earlier unresponsive transport');
assert.equal(laterSignals.length, 2);

let rejectWhileRendering; const cropSignals = [];
const failureDuringCrop = runWordAi({ ...common, document: doc(3), operation: operation(),
  renderRegion: (_page, _scope, signal) => {
    cropSignals.push(signal);
    return cropSignals.length === 1 ? Promise.resolve('data:image/png;base64,fixture') : new Promise(() => {});
  },
  requestAi: () => new Promise((_resolve, reject) => { rejectWhileRendering = reject; }) });
await until(() => cropSignals.length === 2);
rejectWhileRendering(Object.assign(new Error('denied'), { code: 'http_error', status: 403 }));
await assert.rejects(failureDuringCrop, error => error.code === 'http_error' && error.status === 403);
assert(cropSignals[1].aborted, 'network failure cancels a crop that would otherwise wait for the total budget');

const budgetTimers = new Set(), budgetSignals = [], budgetCache = createWordAiCache(), budgetDocument = doc(5);
let budgetClock = 0;
const timerAdapter = { setTimer: callback => { budgetTimers.add(callback); return callback; }, clearTimer: callback => budgetTimers.delete(callback) };
const budgetRun = runWordAi({ ...common, document: budgetDocument, operation: operation(), cache: budgetCache,
  now: () => budgetClock, limits: { ...LIMITS, aiTotalMs: 10 }, timers: timerAdapter,
  requestAi: (_messages, signal) => { budgetSignals.push(signal); return new Promise(() => {}); } });
await until(() => budgetSignals.length === 2); budgetClock = 10;
for (const expire of [...budgetTimers]) expire();
const budgetResult = await budgetRun;
assert.equal(budgetResult.review.reason, 'budget'); assert.equal(budgetResult.review.remaining, 5);
assert.equal(budgetCache.size, 0); assert.equal(budgetTimers.size, 0);
assert(budgetSignals.every(signal => signal.aborted));
assert.deepEqual(budgetResult.document, budgetDocument, 'total budget expiry preserves complete local output');
const budgetRetry = await runWordAi({ ...common, document: budgetDocument, operation: operation(), cache: budgetCache,
  requestAi: async messages => response(JSON.parse(messages[1].content[0].text)) });
assert.equal(budgetRetry.review.remaining, 0); assert.equal(budgetRetry.requests, 5);

budgetClock = 0; budgetSignals.length = 0;
const requestTimeout = runWordAi({ ...common, document: doc(5), operation: operation(), now: () => budgetClock,
  limits: { ...LIMITS, aiTotalMs: 100, aiRequestMs: 5 }, timers: timerAdapter,
  requestAi: (_messages, signal) => { budgetSignals.push(signal); return new Promise(() => {}); } });
await until(() => budgetSignals.length === 2); budgetClock = 5;
for (const expire of [...budgetTimers]) expire();
await assert.rejects(requestTimeout, error => error.code === 'ai-timeout', 'single-request timeout remains a visible service error');
assert.equal(budgetTimers.size, 0);

let serialActive = 0, serialMaximum = 0;
await runWordAi({ ...common, document: doc(4), operation: operation(), limits: { ...LIMITS, aiConcurrency: 1 },
  requestAi: async messages => { serialActive++; serialMaximum = Math.max(serialMaximum, serialActive);
    await new Promise(resolve => setTimeout(resolve, 2)); serialActive--; return response(JSON.parse(messages[1].content[0].text)); } });
assert.equal(serialMaximum, 1);
console.log('PDF Word AI scheduling: bounded network concurrency, serial rendering, out-of-order results, cancellation, failure and 72-page checkpoint passed.');
