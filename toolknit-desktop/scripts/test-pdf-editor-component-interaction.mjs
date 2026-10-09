import assert from 'node:assert/strict';
import { createPdfEditorComponentInteraction } from '../src/features/pdf-editor/component-interaction.js';

function makeElement(rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) {
  return {
    style: {},
    classList: { add() {} },
    parentElement: null,
    getBoundingClientRect: () => rect,
    querySelector: () => null,
    appendChild() {}
  };
}

const documentRef = {
  listeners: new Map(),
  addEventListener(name, handler) { this.listeners.set(name, handler); },
  removeEventListener(name) { this.listeners.delete(name); }
};
const canvasWrap = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const target = makeElement();
const cache = {
  scale: 1,
  cssViewport: {
    convertToPdfPoint: (x, y) => [x, y],
    convertToViewportPoint: (x, y) => [x, y]
  }
};
const object = { id: 'image-1', pageId: 'p1', x: 10, y: 20, width: 30, height: 40, rotation: 0 };
let selected = { type: 'inserted-image', pageId: 'p1', key: object.id, object };
let dragUpdate = null;
let resizeUpdate = null;
let rotationUpdate = null;
let commits = 0;
let flushes = 0;

const interaction = createPdfEditorComponentInteraction({
  documentRef,
  getComponentMode: () => true,
  getEditMode: () => false,
  getInsertMode: () => null,
  getActiveOperation: () => null,
  hasDocument: () => true,
  getSelectedComponent: () => selected,
  getCurrentTextLayerCache: () => cache,
  getCanvasWrap: () => canvasWrap,
  getCurrentPage: () => ({ id: 'p1' }),
  getTextLayer: () => target,
  getTextLinesCache: () => new Map([['p1', cache]]),
  getTextEdits: () => new Map(),
  getInsertedTexts: () => [],
  getInsertedImages: () => [object],
  getInsertedShapes: () => [],
  cloneState: value => structuredClone(value),
  selectComponent: component => { selected = structuredClone(component); },
  componentElement: () => target,
  resolveComponentObject: () => object,
  getComponentRotation: component => Number(component?.object?.rotation) || 0,
  snapRotationToAxis: value => value,
  setComponentRotation: (_component, value) => { rotationUpdate = value; selected.object.rotation = value; },
  collectSnapTargets: () => [],
  snapComponentDrag: (_component, dx, dy) => ({ dx, dy }),
  updateComponentFromDelta: (...args) => { dragUpdate = args; },
  applyRelativeViewportRect() {},
  ensureTextMask() {},
  buildShapeSvg: () => makeElement(),
  positionComponentMenu() {},
  flushComponentVisualRefresh: () => { flushes += 1; },
  updateControls() {},
  commitEditorHistory: () => { commits += 1; }
});

interaction.beginComponentDrag(
  { button: 0, pointerId: 1, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {} },
  selected
);
documentRef.listeners.get('pointermove')({ pointerId: 1, clientX: 28, clientY: 44, preventDefault() {} });
assert.deepEqual(dragUpdate.slice(0, 3), [18, 24, 1]);
documentRef.listeners.get('pointerup')({ pointerId: 1 });
assert.equal(commits, 1);
assert.equal(flushes, 1);

interaction.beginComponentRotate(
  { button: 0, pointerId: 2, clientX: 100, clientY: 50, preventDefault() {}, stopPropagation() {} }
);
documentRef.listeners.get('pointermove')({ pointerId: 2, clientX: 50, clientY: 100, preventDefault() {} });
assert.equal(rotationUpdate, 90);
documentRef.listeners.get('pointerup')({ pointerId: 2 });
assert.equal(commits, 2);

interaction.beginComponentResize(
  { button: 0, pointerId: 3, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {} },
  selected,
  'se'
);
documentRef.listeners.get('pointermove')({ pointerId: 3, clientX: 20, clientY: 30, preventDefault() {} });
assert.equal(object.width, 40);
assert.equal(object.height, 50);
documentRef.listeners.get('pointerup')({ pointerId: 3 });
assert.equal(commits, 3);

interaction.reset();
assert.equal(documentRef.listeners.size, 0);

// A click must preserve the DOM for native double-click delivery. RAF drag
// updates coalesce, and pointerup publishes the final queued position.
const frames = new Map();
let frameId = 0;
let queuedUpdates = 0;
let queuedPosition;
const batched = createPdfEditorComponentInteraction({
  documentRef,
  windowRef: {
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); }
  },
  getComponentMode: () => true,
  hasDocument: () => true,
  getSelectedComponent: () => selected,
  getCurrentTextLayerCache: () => cache,
  getCanvasWrap: () => canvasWrap,
  cloneState: value => structuredClone(value),
  selectComponent: component => { selected = structuredClone(component); },
  updateComponentFromDelta(dx, dy) { queuedUpdates++; queuedPosition = [dx, dy]; },
  flushComponentVisualRefresh() { flushes++; },
  commitEditorHistory() { commits++; }
});
const start = { button: 0, pointerId: 4, clientX: 10, clientY: 20,
  preventDefault() {}, stopPropagation() {} };
const previousFlushes = flushes;
const previousCommits = commits;
batched.beginComponentDrag(start, selected);
documentRef.listeners.get('pointerup')({ pointerId: 4 });
assert.equal(flushes, previousFlushes);
assert.equal(commits, previousCommits);
batched.beginComponentDrag(start, selected);
for (const clientX of [20, 30, 40]) {
  documentRef.listeners.get('pointermove')({ pointerId: 4, clientX, clientY: 35, preventDefault() {} });
}
assert.equal(frames.size, 1);
assert.equal(queuedUpdates, 0);
documentRef.listeners.get('pointerup')({ pointerId: 4 });
assert.equal(queuedUpdates, 1);
assert.deepEqual(queuedPosition, [30, 15]);
assert.equal(frames.size, 0);
batched.beginComponentDrag(start, selected);
documentRef.listeners.get('pointermove')({ pointerId: 4, clientX: 50, clientY: 40, preventDefault() {} });
batched.reset();
assert.equal(frames.size, 0);
assert.equal(documentRef.listeners.size, 0);
assert.equal(queuedUpdates, 1, 'reset discards pending moves');

console.log('PDF editor component interaction lifecycle checks passed');
