import assert from 'node:assert/strict';
import { createPdfEditorPreview } from '../src/features/pdf-editor/preview.js';

function makeElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    className: '',
    isConnected: false,
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = true;
      return child;
    },
    addEventListener() {},
    setAttribute(name, value) { this[name] = String(value); },
    replaceWith(next) {
      const parent = this.parentElement;
      const index = parent?.children.indexOf(this) ?? -1;
      if (parent && index >= 0) {
        parent.children.splice(index, 1, next);
        next.parentElement = parent;
        next.isConnected = true;
      }
      this.isConnected = false;
    },
    remove() {
      const parent = this.parentElement;
      const index = parent?.children.indexOf(this) ?? -1;
      if (parent && index >= 0) parent.children.splice(index, 1);
      this.isConnected = false;
    }
  };
  if (tagName === 'canvas') {
    element.width = 0;
    element.height = 0;
    element.getContext = () => ({ fillStyle: '', fillRect() {} });
  }
  return element;
}

const documentRef = { createElement: tag => makeElement(tag) };
const canvasStage = makeElement('section');
canvasStage.isConnected = true;
const canvasScroll = { clientWidth: 500 };
let canvasWrap = null;
let textLayer = null;
let mainCanvas = null;
let mainRenderTask = null;
let mainEpoch = 0;
let lastRenderScale = 1;
let textLinesCache = new Map();
let previewCleanup = 0;
let controlsUpdated = 0;
let stageSynced = 0;
let textRenders = [];
let committedScale = null;
let currentPage = { id: 'p1', sourceId: 'source-1', pageIndex: 0 };
let paints = 0;
let textGate = null;
let renderGate = null;

const pdfPage = {
  getViewport({ scale }) {
    return { width: 100 * scale, height: 200 * scale };
  },
  render() {
    paints++;
    return { promise: renderGate?.promise || Promise.resolve(), cancel() {} };
  },
  async getTextContent() {
    if (textGate) await textGate.promise;
    return { items: [{ text: 'hello' }] };
  },
  cleanup() { previewCleanup += 1; }
};

const zoom = {
  beginRender() {},
  clearPreviewHint() {},
  commitRender(_token, _request, scale) { committedScale = scale; },
  getState: () => ({ viewMode: 'fit', zoomPercent: 1 }),
  isCurrentRequest: () => true
};

const preview = createPdfEditorPreview({
  canvasStage,
  canvasScroll,
  getCanvasWrap: () => canvasWrap,
  setCanvasWrap: value => { canvasWrap = value; },
  getTextLayer: () => textLayer,
  setTextLayer: value => { textLayer = value; },
  getMainCanvas: () => mainCanvas,
  setMainCanvas: value => { mainCanvas = value; },
  getMainRenderTask: () => mainRenderTask,
  setMainRenderTask: value => { mainRenderTask = value; },
  getMainEpoch: () => mainEpoch,
  setMainEpoch: value => { mainEpoch = value; },
  getLastRenderScale: () => lastRenderScale,
  setLastRenderScale: value => { lastRenderScale = value; },
  getZoom: () => zoom,
  getCurrentPage: () => currentPage,
  hasDocument: () => true,
  getSourceDoc: async () => ({ getPage: async () => pdfPage }),
  cacheSourceRotation() {},
  effectivePageRotation: () => 0,
  pageSupportsContentEditing: () => true,
  getTextLinesCache: () => textLinesCache,
  setTextLinesCache: value => { textLinesCache = value; },
  renderTextLayer: (...args) => textRenders.push(args),
  syncStageVisibility: () => { stageSynced += 1; },
  updateControls: () => { controlsUpdated += 1; },
  updateZoomLabel() {},
  groupTextItemsIntoLines: items => items.map(item => ({ text: item.text })),
  buildTextLine: line => ({ ...line, box: { x: 0, y: 0, width: 20, height: 10 } }),
  documentRef,
  windowRef: { devicePixelRatio: 1 }
});

await preview.render(1, null);
assert.ok(canvasWrap && textLayer && mainCanvas, 'preview creates its canvas and text layers');
assert.equal(mainCanvas.isConnected, true);
assert.equal(mainRenderTask, null);
assert.equal(lastRenderScale, 4);
assert.equal(committedScale, 4);
assert.equal(textLinesCache.get('p1').lines[0].text, 'hello');
assert.equal(textRenders.length, 1);
assert.equal(controlsUpdated, 1);
assert.equal(stageSynced, 1);
assert.equal(previewCleanup, 1);

const firstCanvas = mainCanvas;
currentPage = { ...currentPage, id: 'p2', pageIndex: 1 };
await preview.render(2, null);
currentPage = { ...currentPage, id: 'p1', pageIndex: 0 };
await preview.render(3, null);
assert.equal(paints, 2, 'returning to a cached page skips PDF.js rasterization');
assert.equal(mainCanvas, firstCanvas);

// Slow text extraction from an old render must not zero a cached canvas after
// a newer page has already committed.
textGate = Promise.withResolvers();
currentPage = { ...currentPage, id: 'p3', pageIndex: 2 };
const pending = preview.render(4, null);
while (mainCanvas === firstCanvas) await new Promise(resolve => setTimeout(resolve, 0));
const pendingCanvas = mainCanvas;
currentPage = { ...currentPage, id: 'p1', pageIndex: 0 };
await preview.render(5, null);
const currentTextRenders = textRenders.length;
textGate.reject(new Error('stale page text read')); await pending; textGate = null;
assert.ok(pendingCanvas.width > 0, 'superseded text completion leaves cache ownership intact');
assert.equal(textRenders.length, currentTextRenders, 'late failure cannot clear the new text layer');
for (let index = 3; index < 8; index++) {
  currentPage = { ...currentPage, id: `p${index + 1}`, pageIndex: index };
  await preview.render(index + 5, null);
}
assert.equal(firstCanvas.width, 0, 'old canvas is evicted from bounded cache');
preview.clearCache();
assert.equal(pendingCanvas.width, 0);

renderGate = Promise.withResolvers();
const visibleBeforeSwitch = mainCanvas;
currentPage = { ...currentPage, id: 'p9', pageIndex: 8 };
const delayedPaint = preview.render(20, null);
while (!mainRenderTask) await new Promise(resolve => setTimeout(resolve, 0));
currentPage = { ...currentPage, id: 'p10', pageIndex: 9 };
renderGate.resolve(); await delayedPaint; renderGate = null;
assert.equal(mainCanvas, visibleBeforeSwitch, 'page switch invalidates old paint even before the next render begins');
await preview.render(21, null);
assert.equal(mainCanvas.dataset.pageId, 'p10');

let taskCancelled = false;
mainRenderTask = { cancel: () => { taskCancelled = true; } };
const previousEpoch = mainEpoch;
preview.cancel();
assert.equal(taskCancelled, true);
assert.equal(mainRenderTask, null);
assert.equal(mainEpoch, previousEpoch + 1);

const renderedCanvas = mainCanvas;
preview.dispose();
assert.equal(mainCanvas, null);
assert.equal(renderedCanvas.isConnected, false);
assert.equal(renderedCanvas.width, 0);
assert.equal(renderedCanvas.height, 0);

console.log('PDF editor main preview lifecycle checks passed');

