import assert from 'node:assert/strict';
import { createPdfEditorHistory } from '../src/features/pdf-editor/history.js';
import { createPdfEditorStateController } from '../src/features/pdf-editor/state.js';

let state = { value: 0 };
let refreshes = 0;
const applied = [];

const history = createPdfEditorHistory({
  capture: () => ({ value: state.value }),
  apply: snapshot => {
    state = { ...snapshot };
    applied.push(state.value);
  },
  equals: (left, right) => left?.value === right?.value,
  hasDocument: () => true,
  onChange: () => { refreshes += 1; },
  limit: 3
});

const initial = history.reset();
assert.deepEqual(initial, { value: 0 });
assert.equal(history.length, 1);
assert.equal(history.firstSnapshot().value, 0);
assert.equal(history.canUndo(), false);
assert.equal(history.canRedo(), false);

state.value = 1;
assert.equal(history.commit(), true);
state.value = 2;
assert.equal(history.commit(), true);
assert.equal(history.length, 3);
assert.equal(history.canUndo(), true);

state.value = 3;
history.commit();
assert.equal(history.length, 3, 'history must remain bounded');
assert.equal(history.firstSnapshot().value, 1, 'oldest snapshot must be evicted first');

assert.equal(history.undo(), true);
assert.equal(state.value, 2);
assert.deepEqual(applied, [2]);
assert.equal(history.redo(), true);
assert.equal(state.value, 3);
assert.deepEqual(applied, [2, 3]);

const beforeLockedCommit = history.length;
history.withLock(() => {
  state.value = 99;
  assert.equal(history.commit(), false);
});
assert.equal(history.length, beforeLockedCommit);
assert.equal(history.hasUnsavedChanges({ value: 3 }), true);
assert.equal(history.hasUnsavedChanges({ value: 99 }), false);

history.clear();
assert.equal(history.length, 0);
assert.equal(history.current, null);
assert.ok(refreshes >= 6);

// An image removed from the page remains available to undo, then is released
// only when every retained history and baseline reference has disappeared.
{
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const assets = new Map([['image-1', { bytes, mimeType: 'image/png' }]]);
  let images = [{ id: 'image-1', pageId: 'page-1', mimeType: 'image/png', bytes }];
  let saved = null;
  const state = createPdfEditorStateController({
    getInsertedImages: () => images, setInsertedImages: value => { images = value; },
    getInsertedImageStore: () => assets,
    normalizeInsertedImageSnapshot: ({ bytes: _bytes, previewUrl: _url, ...image }) => image,
    getSavedSnapshot: () => saved
  });
  const history = createPdfEditorHistory({ capture: state.captureEditorSnapshot, apply: state.applyEditorSnapshot,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), limit: 3,
    onChange: state.pruneImageAssets });
  state.setHistory(history); history.reset();
  assets.set('duplicate-payload', { bytes });
  assert.equal(state.imageAssetBytes(), bytes.byteLength, 'copied pages share immutable bytes instead of double-counting capacity');
  state.pruneImageAssets();
  images = []; history.commit();
  assert.equal(assets.has('image-1'), true);
  history.undo();
  assert.equal(images[0].bytes, bytes, 'undo restores the original immutable payload');
  assert.match(images[0].previewUrl, /^blob:/);
  history.redo(); assert.equal(images.length, 0);
  history.commit(); history.commit();
  assert.equal(assets.has('image-1'), false, 'history eviction releases unreachable bytes');
  assets.set('saved-image', { bytes }); saved = { insertedImages: [{ id: 'saved-image' }] };
  state.pruneImageAssets(); assert.equal(assets.has('saved-image'), true);
  saved = null; state.pruneImageAssets(); assert.equal(assets.size, 0);
}

console.log('PDF editor history lifecycle checks passed');
