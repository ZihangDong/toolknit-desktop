import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createPdfEditorFileSession } from '../src/features/pdf-editor/file-session.js';
import { createPdfEditorOperationRuntime } from '../src/features/pdf-editor/operation.js';

let idCounter = 0;
let sources = [{ id: 'old-source', name: 'old.pdf', size: 10, pageCount: 1 }];
let pages = [{ id: 'old-page', sourceId: 'old-source', pageIndex: 0, rotation: 0 }];
let sourceStore = new Map([['old-source', sources[0]]]);
let currentId = 'old-page';
let selectedIds = new Set(['old-page']);
let selectionAnchorId = 'old-page';
let activeOperation = null;
let resetCount = 0;
let buildCount = 0;
let renderCount = 0;
let commitCount = 0;
let historyResetCount = 0;
let destroyedStagedDocument = 0;
let lastProgress = null;
let lastToast = null;
let savedSnapshot = null;
const fileClicks = [];
const pageStrip = {
  scrollHeight: 800,
  scrollTo: options => { pageStrip.lastScroll = options; }
};
const documents = {
  async loadBytes(_bytes, { onLoadingTask } = {}) {
    onLoadingTask?.({ destroy: async () => {} });
    return {
      document: {
        numPages: 2,
        async destroy() { destroyedStagedDocument += 1; }
      }
    };
  },
  set(sourceId, document) { this.lastSet = { sourceId, document }; }
};
const input = { value: 'stale', click: () => fileClicks.push('main') };
const appendInput = { value: 'stale', click: () => fileClicks.push('append') };
const windowRef = { requestAnimationFrame: callback => { callback(); return 1; } };

const session = createPdfEditorFileSession({
  isTauri: false,
  documentRef: {},
  windowRef,
  fileInput: input,
  appendInput,
  pageStrip,
  t: key => key,
  isDisposed: () => false,
  getActiveOperation: () => activeOperation,
  getIdCounter: () => idCounter,
  setIdCounter: value => { idCounter = value; },
  getSources: () => sources,
  setSources: value => { sources = value; },
  getPages: () => pages,
  setPages: value => { pages = value; },
  getSourceStore: () => sourceStore,
  setSourceStore: value => { sourceStore = value; },
  setCurrentId: value => { currentId = value; },
  setSelectedIds: value => { selectedIds = value; },
  setSelectionAnchorId: value => { selectionAnchorId = value; },
  getDocuments: () => documents,
  hasDocument: () => sources.length > 0 && pages.length > 0,
  confirmDiscardChanges: action => action === 'replace',
  resetDocument: async () => { resetCount += 1; },
  fileSizeFor: async file => Number(file.size || 0),
  readBytes: async file => new Uint8Array(await file.arrayBuffer()),
  beginOperation: type => {
    activeOperation = { type, cancelled: false };
    return activeOperation;
  },
  assertOperation: operation => { if (operation.cancelled) throw new Error('cancelled'); },
  endOperation: () => { activeOperation = null; },
  showProcess() {},
  setLocalizedProgress: (...args) => { lastProgress = args; },
  buildTiles: () => { buildCount += 1; },
  updateFileCard() {},
  syncStageVisibility() {},
  renderMainPreview: () => { renderCount += 1; },
  updateControls() {},
  resetEditorHistory: () => { historyResetCount += 1; },
  setBaselineSnapshot() {},
  setSavedSnapshot(value) { savedSnapshot = value; },
  editorHistoryFirstSnapshot: () => ({ pages: [{ id: 'snapshot-page' }] }),
  cloneState: value => structuredClone(value),
  messageForError: error => String(error?.message || error),
  commitEditorHistory: () => { commitCount += 1; },
  showToast: message => { lastToast = message; }
});

const sourceFile = {
  name: 'replacement.pdf',
  size: 12,
  async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; }
};
await session.loadMainFile(sourceFile);
assert.equal(resetCount, 1);
assert.equal(sources[0].name, 'replacement.pdf');
assert.equal(pages.length, 2);
assert.equal(currentId, pages[0].id);
assert.deepEqual([...selectedIds], [pages[0].id]);
assert.equal(selectionAnchorId, pages[0].id);
assert.deepEqual(lastProgress, [100, 'loadingDocument']);
assert.equal(historyResetCount, 1);
assert.equal(destroyedStagedDocument, 0);
assert.equal(lastToast, null);

await session.loadMainFile({
  name: 'invalid.txt',
  size: 1,
  async arrayBuffer() { return new ArrayBuffer(0); }
});
assert.equal(sources[0].name, 'replacement.pdf');
assert.equal(lastToast, 'home.pdfEditor.pdfOnly');

const appendDoc = await PDFDocument.create();
appendDoc.addPage([612, 792]);
const appendBytes = new Uint8Array(await appendDoc.save());
await session.appendPdfBytes(appendBytes, 'append.pdf', appendBytes.length);
assert.equal(sources.length, 2);
assert.equal(pages.length, 3);
assert.match(currentId, /^page-/);
assert.deepEqual([...selectedIds], [currentId]);
assert.equal(pageStrip.lastScroll.behavior, 'smooth');
assert.deepEqual(lastProgress, [100, 'appending']);
assert.equal(commitCount, 1);

session.chooseMainFile();
session.chooseAppendFile();
assert.deepEqual(fileClicks, ['main', 'append']);
assert.equal(input.value, '');
assert.equal(appendInput.value, '');

documents.loadBytes = async bytes => {
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 }, 'new documents start at A4');
  return { document: { numPages: pdf.getPageCount(), async destroy() { destroyedStagedDocument++; } } };
};
sources = []; pages = [];
await session.createBlankDocument();
assert.equal(pages.length, 1);
assert.equal(sources.length, 1);
assert.equal(sources[0].generated, true);
assert.equal(sources[0].name, 'untitled.pdf');
assert.equal(savedSnapshot, null, 'a newly created PDF has not been saved');
assert.equal(sourceStore.get(pages[0].sourceId), sources[0]);
assert.equal(currentId, pages[0].id);
const createdSource = sources[0], createdPage = pages[0];
const cancelledCreation = session.createBlankDocument();
activeOperation.cancelled = true;
await cancelledCreation;
assert.equal(sources[0], createdSource, 'cancelling creation preserves the current document');
assert.equal(pages[0], createdPage);
documents.loadBytes = async () => { throw new Error('fixture:decode-failed'); };
await session.createBlankDocument();
assert.equal(sources[0], createdSource, 'failed replacement must preserve the existing blank document');
assert.equal(activeOperation, null);

let finishRead;
const beforeAppend = pages.length;
const pendingAppend = session.appendFile({ name: 'late.pdf', size: appendBytes.length,
  arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) });
await Promise.resolve();
assert.equal(activeOperation.type, 'append', 'file reading belongs to the cancellable append operation');
activeOperation.cancelled = true;
finishRead(appendBytes.buffer); await pendingAppend;
assert.equal(pages.length, beforeAppend, 'cancelled reads cannot append pages later');
assert.equal(activeOperation, null);
await session.appendFile({ name: 'unreadable.pdf', size: 100, async arrayBuffer() { throw new Error('fixture:read-failed'); } });
assert.equal(pages.length, beforeAppend);
assert.equal(lastToast, 'fixture:read-failed', 'file read errors become visible feedback');
assert.equal(activeOperation, null);
await session.appendFile({ name: 'append-read.pdf', size: appendBytes.length + 10, async arrayBuffer() { return appendBytes.buffer; } });
assert.equal(pages.length, beforeAppend + 1);
assert.equal(sources.at(-1).size, appendBytes.length, 'source budget uses actual bytes, not stale file metadata');

{
  const resetGate = Promise.withResolvers(), reachedReset = Promise.withResolvers();
  const cancel = { disabled: false, style: {} };
  const runtime = createPdfEditorOperationRuntime({ processCancel: cancel });
  let sources = [{ id: 'previous' }], pages = [{ id: 'previous-page' }], ids = 0;
  const replacement = createPdfEditorFileSession({ ...runtime,
    getIdCounter: () => ids, setIdCounter: value => { ids = value; },
    getSources: () => sources, setSources: value => { sources = value; },
    getPages: () => pages, setPages: value => { pages = value; },
    hasDocument: () => pages.length > 0,
    getDocuments: () => ({ async loadBytes() { return { document: { numPages: 1 } }; }, set() {} }),
    resetDocument: async () => { sources = []; pages = []; reachedReset.resolve(); await resetGate.promise; }
  });
  const pending = replacement.createBlankDocument(); await reachedReset.promise;
  assert.equal(cancel.disabled, true, 'document replacement cannot be cancelled after removing the old document');
  await runtime.cancelActiveOperation();
  assert.equal(runtime.getActiveOperation().cancelled, false);
  resetGate.resolve(); await pending;
  assert.equal(pages.length, 1); assert.equal(sources[0].generated, true);
  assert.equal(runtime.getActiveOperation(), null);
}

console.log('PDF editor file session lifecycle checks passed');
