import assert from 'node:assert/strict';
import { createQuerySession, createInvalidationBarrier, createInputPublisher, normalizeQuery } from '../src/features/file-search/core.js';

const pending = [], changes = [], errors = [];
let invalidations = 0;
const session = createQuerySession({ delay: 5, invalidate: () => invalidations++,
  search: input => new Promise((resolve, reject) => pending.push({ input: structuredClone(input), resolve, reject })),
  changed: value => changes.push(value), failed: value => errors.push(value) });
const tick = () => new Promise(resolve => setTimeout(resolve, 12));
const result = (name, cursor = null) => ({ result: { rows: [{ id: name, name }], total: 1, extensions: ['txt'] }, ticket: name, cursor });
session.start();
session.set({ text: 'old' }); await tick();
session.set({ text: 'new' });
pending.find(p => p.input.query.text === 'old').resolve(result('old'));
await tick();
assert.equal(changes.at(-1).rows.length, 0, 'new input invalidates old results before debounce ends');
pending.find(p => p.input.query.text === 'new').resolve(result('new')); await tick();
assert.equal(changes.at(-1).rows[0].name, 'new');
session.composition(true); const before = pending.length;
session.set({ text: '中文' }); await tick(); assert.equal(pending.length, before, 'IME composition does not query');
session.composition(false); await tick(); assert.equal(pending.length, before + 1);
pending.at(-1).resolve(result('中文')); await tick();
session.set({ text: 'closing' }, { immediate: true }); await tick(); session.pause();
pending.at(-1).resolve(result('late')); await tick();
assert.ok(!changes.some(c => c.rows.some(r => r.name === 'late')), 'closed view rejects late response');
session.dispose(); await tick();
assert.equal(errors.length, 0); assert.ok(invalidations >= 4);
assert.deepEqual(normalizeQuery({ extension: '.PDF', sort: 'unknown' }), { text: '', extension: 'pdf', sort: 'relevance' });
console.log('File search query lifecycle, IME and stale-response tests passed.');

let releaseInvalidation, searched = [];
const ordered = createQuerySession({ search: async data => { searched.push(data.query.text); return result('ordered'); },
  invalidate: () => new Promise(resolve => { releaseInvalidation = resolve; }) });
ordered.start(); ordered.set({ text: 'immediate' }, { immediate: true });
await tick(); assert.deepEqual(searched, [], 'query must wait for native invalidation acknowledgement');
releaseInvalidation(); await tick(); assert.deepEqual(searched, ['immediate']); ordered.dispose(); releaseInvalidation();
console.log('Native invalidation ordering test passed.');

const acknowledgements = [], sent = [];
const reverseOrder = createQuerySession({
  invalidate: () => new Promise(resolve => acknowledgements.push(resolve)),
  search: async data => { sent.push(data.query.text); return result(data.query.text); }
});
reverseOrder.start();
reverseOrder.set({ text: 'first' }, { immediate: true });
reverseOrder.set({ text: 'latest' }, { immediate: true });
acknowledgements[1](); await tick();
assert.deepEqual(sent, [], 'an older in-flight invalidation can still cancel the latest query');
acknowledgements[0](); await tick();
assert.deepEqual(sent, ['latest'], 'only the latest input runs after all cancellation acknowledgements');
reverseOrder.dispose(); acknowledgements[2]();

let finishCancellation;
const barrier = createInvalidationBarrier(() => new Promise(resolve => { finishCancellation = resolve; }));
barrier.invalidate(); let drained = false;
const draining = barrier.wait().then(() => { drained = true; });
await tick(); assert.equal(drained, false);
finishCancellation(); await draining; assert.equal(drained, true);
console.log('Out-of-order invalidation barrier tests passed.');

const publishAcks = [], published = [];
const publisher = createInputPublisher({ delay:5,
  invalidate: () => new Promise(resolve => publishAcks.push(resolve)),
  publish: async text => { published.push(text); }
});
publisher.submit('old'); publisher.submit('new');
assert.equal(publisher.pending, true, 'keyboard navigation waits for the new capsule query');
publishAcks[1](); await tick(); assert.deepEqual(published, []);
assert.equal(publisher.pending, true, 'one cancellation acknowledgement cannot unlock old results');
publishAcks[0](); await tick(); assert.deepEqual(published, ['new']);
assert.equal(publisher.pending, false, 'navigation resumes after the latest publication');
publisher.submit('closed'); publisher.cancel(); publishAcks[2](); await tick();
assert.equal(publisher.pending, false, 'closing does not retain a stale keyboard lock');
assert.deepEqual(published, ['new'], 'collapse cancels a pending capsule draft');
publisher.submit('ime draft'); publisher.invalidate(); publishAcks[3](); publishAcks[4](); await tick();
assert.deepEqual(published, ['new'], 'composition start cancels a pending committed draft');
publisher.submit('', { immediate:true }); publishAcks[5](); await tick();
assert.deepEqual(published, ['new',''], 'clearing publishes immediately after native cancellation');
publisher.submit('disposed'); publisher.dispose(); publishAcks[6](); await tick();
assert.deepEqual(published, ['new',''], 'disposed capsule cannot publish a late draft');
publisher.invalidate(); publisher.submit('late'); publisher.dispose(); await tick();
assert.equal(publishAcks.length,7,'disposed input owner cannot issue additional native invalidations');
console.log('Capsule input cancellation, IME and clear-order tests passed.');

let finishPublish;
const commits = [];
const serialPublisher = createInputPublisher({ invalidate: async () => {}, publish: text => {
  commits.push(text);
  return text === 'in-flight' ? new Promise(resolve => { finishPublish = resolve; }) : Promise.resolve();
} });
serialPublisher.submit('in-flight', { immediate:true }); await tick();
serialPublisher.submit('superseded', { immediate:true });
serialPublisher.submit('current', { immediate:true }); await tick();
assert.deepEqual(commits, ['in-flight'], 'capsule updates cannot overtake an in-flight publication');
finishPublish(); await tick();
assert.deepEqual(commits, ['in-flight','current'], 'queued capsule input publishes only the newest text');
serialPublisher.dispose();

let reopenedSearches = 0;
const reopen = createQuerySession({ search: async () => { reopenedSearches++; return result('reopened'); } });
reopen.start(); await tick(); reopen.composition(true); reopen.pause(); reopen.start(); await tick();
assert.equal(reopenedSearches, 2, 'closing during IME composition must not freeze search on reopen'); reopen.dispose();

let idempotentQueries = 0, idempotentInvalidations = 0, idempotentChanges = 0;
const idempotent = createQuerySession({ search:async()=>{idempotentQueries++;return result('same');},
  invalidate:()=>{idempotentInvalidations++;}, changed:()=>{idempotentChanges++;} });
idempotent.start();idempotent.start();await tick();
assert.equal(idempotentQueries,1,'repeated start does not issue duplicate queries');
idempotent.pause();idempotent.pause();await tick();
assert.equal(idempotentInvalidations,1,'repeated pause does not create redundant IPC');
idempotent.start();await tick();assert.equal(idempotentQueries,2,'resume still refreshes');
idempotent.dispose();const changesAfterDispose=idempotentChanges, invalidationsAfterDispose=idempotentInvalidations;
idempotent.dispose();idempotent.start();idempotent.pause();idempotent.set({text:'after-dispose'});idempotent.composition(true);await tick();
assert.equal(idempotentQueries,2);assert.equal(idempotentChanges,changesAfterDispose);
assert.equal(idempotentInvalidations,invalidationsAfterDispose,'disposed session owns no further IPC');
console.log('Repeated query lifecycle calls are idempotent.');

let checked,finishCheck;const backgroundChanges=[];
const quiet=createQuerySession({search:async()=>({...result('stable'),generation:1}),
  check:()=>new Promise(resolve=>{finishCheck=resolve;}),changed:value=>backgroundChanges.push(value)});
quiet.start();await tick();const countBeforeCheck=backgroundChanges.length;
checked=quiet.checkUpdate();await tick();finishCheck({changed:false,generation:2});
assert.deepEqual(await checked,{changed:false,generation:2});assert.equal(backgroundChanges.length,countBeforeCheck,'checking the index does not enter loading or rewrite results');
quiet.refreshBackground();await tick();
assert.ok(backgroundChanges.some(value=>value.loading&&value.background),'automatic refresh is distinct from user input');
assert.equal(backgroundChanges.at(-1).background,false);
checked=quiet.checkUpdate();await tick();quiet.pause();finishCheck({changed:true,generation:3});
assert.equal(await checked,null,'mode switch drops an in-flight background check');quiet.dispose();
console.log('Silent update checks, background refresh and mode-switch cancellation passed.');
const expired=createQuerySession({search:async()=>result('expired'),check:async()=>{throw Error('file-search:stale-query');}});
expired.start();await tick();assert.deepEqual(await expired.checkUpdate(),{expired:true},'index restart can request silent recovery instead of leaving results stale');expired.dispose();
