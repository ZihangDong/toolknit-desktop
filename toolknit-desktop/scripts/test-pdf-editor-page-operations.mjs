import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createPdfEditorPageOperations } from '../src/features/pdf-editor/page-operations.js';

let idCounter = 100;
const nextId = type => `${type}-${++idCounter}`;
let pages = [
  { id: 'page-1', sourceId: 'source-1', pageIndex: 0, rotation: 0, sourceRotation: 0 },
  { id: 'page-2', sourceId: 'source-1', pageIndex: 1, rotation: 0, sourceRotation: 0 }
];
let sources = [{ id: 'source-1', name: 'input.pdf', size: 20, pageCount: 2 }];
const sourceStore = new Map([['source-1', sources[0]]]);
const textEdits = new Map([
  ['page-1:0:0', { newText: 'edited', segment: { text: 'source' } }]
]);
let insertedTexts = [{ id: 'text-1', pageId: 'page-1', text: 'hello' }];
let insertedImages = [{
  id: 'image-1', pageId: 'page-1', bytes: new Uint8Array([1, 2]),
  mimeType: 'image/png', previewUrl: 'blob:image-1', width: 40, height: 40
}];
let insertedShapes = [{ id: 'shape-1', pageId: 'page-1', shapeType: 'rect' }];
const imageStore = new Map([['image-1', { bytes: insertedImages[0].bytes, mimeType: 'image/png' }]]);
let selectedComponent = null;
let currentId = 'page-1';
let selectedIds = new Set(['page-1']);
let selectionAnchorId = 'page-1';
const pageStrip = { children: [], appendChild(fragment) { this.children = [...fragment.nodes]; } };
const documentRef = {
  createDocumentFragment() {
    return {
      nodes: [],
      appendChild(node) { this.nodes.push(node); }
    };
  }
};
const pageTiles = new Map();
for (const page of pages) {
  pageTiles.set(page.id, {
    tile: { id: `${page.id}-tile` },
    indexEl: { textContent: '' }
  });
  pageStrip.children.push(pageTiles.get(page.id).tile);
}

let activeOperation = null;
let refreshCount = 0;
let renderCount = 0;
let contentRefreshCount = 0;
let updateCount = 0;
let commitCount = 0;
let buildCount = 0;
let releaseCount = 0;
let revokeCount = 0;
let lastProgress = null;
let endCount = 0;
const notices = [];
const urlRef = {
  createObjectURL: () => `blob:duplicate-${++revokeCount}`,
  revokeObjectURL: () => { revokeCount += 1; }
};
class TestBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.options = options;
  }
}

const operations = createPdfEditorPageOperations({
  documentRef,
  urlRef,
  blobConstructor: TestBlob,
  t: key => key,
  getActiveOperation: () => activeOperation,
  getPages: () => pages,
  setPages: value => { pages = value; },
  getSources: () => sources,
  getSourceStore: () => sourceStore,
  getTextEdits: () => textEdits,
  getInsertedTexts: () => insertedTexts,
  setInsertedTexts: value => { insertedTexts = value; },
  getInsertedImages: () => insertedImages,
  setInsertedImages: value => { insertedImages = value; },
  getInsertedShapes: () => insertedShapes,
  setInsertedShapes: value => { insertedShapes = value; },
  getInsertedImageStore: () => imageStore,
  getSelectedComponent: () => selectedComponent,
  getCurrentId: () => currentId,
  setCurrentId: value => { currentId = value; },
  getSelectedIds: () => selectedIds,
  setSelectedIds: value => { selectedIds = value; },
  getSelectionAnchorId: () => selectionAnchorId,
  setSelectionAnchorId: value => { selectionAnchorId = value; },
  getPageStrip: () => pageStrip,
  hasDocument: () => true,
  targetIds: () => [...selectedIds],
  currentPage: () => pages.find(page => page.id === currentId) || null,
  pageStateFor: id => pageTiles.get(id),
  refreshTile: () => { refreshCount += 1; },
  renderMainPreview: () => { renderCount += 1; },
  refreshCurrentTextLayer: () => {
    assert.equal(selectedComponent, null);
    assert.equal(insertedImages.some(item => item.id === 'image-1'), false);
    contentRefreshCount += 1;
  },
  updateControls: () => { updateCount += 1; },
  commitEditorHistory: () => { commitCount += 1; },
  showToast: message => { notices.push(message); },
  clearSelectedComponent: () => { selectedComponent = null; },
  ensureTextEditEntry: (_component, segment) => ({ segment, newText: segment?.text || '' }),
  releasePreview: () => { releaseCount += 1; },
  buildTiles: () => { buildCount += 1; },
  updateFileCard() {},
  beginOperation: type => { activeOperation = { type, cancelled: false }; return activeOperation; },
  assertOperation: operation => { if (operation.cancelled) throw new Error('cancelled'); },
  endOperation: () => { activeOperation = null; endCount += 1; },
  showProcess() {},
  setLocalizedProgress: (...args) => { lastProgress = args; },
  getSourceDoc: async () => ({
    getPage: async () => ({
      getViewport: () => ({ width: 640, height: 480 }),
      cleanup() {}
    })
  }),
  cacheSourceRotation() {},
  effectivePageRotation: page => page.rotation,
  messageForError: error => String(error?.message || error),
  nextId,
  cloneState: value => structuredClone(value),
  normalizeEditSnapshot: value => structuredClone(value),
  normalizeInsertedImageSnapshot: value => ({
    id: value.id,
    pageId: value.pageId,
    width: value.width,
    height: value.height,
    mimeType: value.mimeType
  }),
  normalizeInsertedShapeSnapshot: value => structuredClone(value)
});

operations.rotateSelected(90);
assert.equal(pages[0].rotation, 90);
assert.equal(refreshCount, 1);
assert.equal(renderCount, 1);
assert.equal(commitCount, 1);

operations.moveCurrent(1);
assert.deepEqual(pages.map(page => page.id), ['page-2', 'page-1']);
assert.equal(pageTiles.get('page-2').indexEl.textContent, '1');
assert.equal(pageTiles.get('page-1').indexEl.textContent, '2');
assert.equal(commitCount, 2);

currentId = 'page-1';
selectedIds = new Set(['page-1']);
operations.duplicateSelectedPages();
assert.equal(pages.length, 3);
const duplicatePage = pages.find(page => page.id !== 'page-1' && page.id !== 'page-2');
assert.ok(duplicatePage);
assert.ok(textEdits.has(`${duplicatePage.id}:0:0`));
assert.equal(insertedTexts.filter(item => item.pageId === duplicatePage.id).length, 1);
const duplicateImage = insertedImages.find(item => item.pageId === duplicatePage.id);
assert.ok(duplicateImage);
assert.equal(imageStore.get(duplicateImage.id).bytes, insertedImages[0].bytes);
assert.equal(insertedShapes.filter(item => item.pageId === duplicatePage.id).length, 1);
assert.equal(commitCount, 3);

selectedComponent = { type: 'inserted-image', key: 'image-1' };
operations.deleteSelected();
assert.equal(insertedImages.some(item => item.id === 'image-1'), false);
assert.equal(imageStore.has('image-1'), true, 'undo history still owns the deleted image bytes');
assert.equal(contentRefreshCount, 1, 'component deletion must refresh the content layer immediately');
assert.equal(commitCount, 4);

selectedComponent = null;
currentId = 'page-2';
selectedIds = new Set(['page-2']);
operations.deleteSelected();
assert.equal(pages.some(page => page.id === 'page-2'), false);
assert.equal(releaseCount, 1);
assert.equal(selectedIds.size, 1);
assert.equal(commitCount, 5);

currentId = pages[0].id;
selectedIds = new Set([currentId]);
await operations.insertBlankPage();
assert.equal(pages.length, 3);
assert.equal(sources.length, 2);
assert.match(pages[1].sourceId, /^src-/);
assert.deepEqual(lastProgress, [100, 'preparingPages']);
assert.equal(endCount, 1);
assert.ok(buildCount >= 2);
assert.equal(notices.length, 0);
assert.ok(updateCount > 0);
assert.equal(selectionAnchorId, currentId);

const blankSource = pages[1].sourceId;
for (let i = 0; i < 30; i++) await operations.insertBlankPage();
assert.equal(sources.length, 2, 'same-sized blank pages share an immutable blank PDF source');
assert.equal(new Set(pages.filter(page => page.sourceId === blankSource).map(page => page.id)).size, 31,
  'shared source pages retain independent editable identities');
let created = 0;
await createPdfEditorPageOperations({ hasDocument: () => false, createBlankDocument: async () => created++ }).insertBlankPage();
assert.equal(created, 1, 'the empty editor routes blank insertion through document creation');

{
  const gate = Promise.withResolvers(), reachedPage = Promise.withResolvers();
  const page = { id: 'page', sourceId: 'source', pageIndex: 0 };
  const pages = [page], operation = { cancelled: false };
  let cleaned = 0;
  const deferred = createPdfEditorPageOperations({ hasDocument: () => true,
    getPages: () => pages, currentPage: () => page, getCurrentId: () => page.id,
    getSources: () => [{ id: 'blank', blankSize: [595.28, 841.89] }],
    beginOperation: () => operation,
    assertOperation: op => { if (op.cancelled) throw new Error('cancelled'); },
    getSourceDoc: async () => ({ async getPage() { reachedPage.resolve(); await gate.promise;
      return { getViewport: () => ({ width: 595.28, height: 841.89 }), cleanup() { cleaned++; } }; } })
  });
  const pending = deferred.insertBlankPage(); await reachedPage.promise;
  operation.cancelled = true; gate.resolve(); await pending;
  assert.equal(pages.length, 1, 'late page geometry cannot insert a cached blank page after cancellation');
  assert.equal(cleaned, 1);
}

{
  const sources = [], pages = [{ id: 'small', sourceId: 'small-source', pageIndex: 0 }];
  const small = createPdfEditorPageOperations({ hasDocument: () => true,
    getPages: () => pages, getSources: () => sources, currentPage: () => pages[0],
    getCurrentId: () => 'small', nextId,
    getSourceDoc: async () => ({ async getPage() { return {
      getViewport: () => ({ width: 40, height: 60 }), cleanup() {}
    }; } })
  });
  await small.insertBlankPage();
  const result = await PDFDocument.load(sources[0].bytes);
  assert.deepEqual(result.getPage(0).getSize(), { width: 40, height: 60 }, 'small label pages must not be enlarged to one inch');
}

console.log('PDF editor page operation lifecycle checks passed');
