import assert from 'node:assert/strict';
import { createPreviewViewport } from '../src/shared/preview-viewport.js';
import { renderPdfPreviewCanvas } from '../src/shared/pdf-preview-canvas.js';

const frames = new Map(), timers = new Map(); let sequence = 0;
globalThis.requestAnimationFrame = fn => { frames.set(++sequence, fn); return sequence; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.setTimeout = fn => { timers.set(++sequence, fn); return sequence; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.document = new EventTarget(); globalThis.window = new EventTarget();
const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(fn => fn()); };
let scale = 3, left = 100, top = 200, renders = 0, enabled = true;
const viewport = new EventTarget();
Object.assign(viewport, { isConnected: true, clientWidth: 400, clientHeight: 400,
  classList: { add() {}, remove() {} }, closest: () => null, contains: el => el === viewport,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 400 }) });
Object.defineProperties(viewport, {
  scrollLeft: { get: () => left, set: value => { left = Math.max(0, Math.min(200 * scale - 400, value)); } },
  scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(300 * scale - 400, value)); } }
});
const content = { getBoundingClientRect: () => ({ left: 100 - left, top: 50 - top, width: 200 * scale, height: 300 * scale }) };
const controller = createPreviewViewport({ viewport, content, getScale: () => scale, setScale: next => { scale = next; },
  enabled: () => enabled, min: .2, max: 4, render: async () => { renders++; } });
const wheel = (deltaY, target = viewport, deltaMode = 0) => {
  const event = new Event('wheel', { cancelable: true });
  Object.assign(event, { deltaY, deltaMode, clientX: 220, clientY: 250 });
  if (target !== viewport) Object.defineProperty(event, 'target', { value: target });
  viewport.dispatchEvent(event); return event;
};
const before = content.getBoundingClientRect(), u = (220 - before.left) / before.width, v = (250 - before.top) / before.height;
assert.equal(wheel(-90).defaultPrevented, true); assert.equal(wheel(-20).defaultPrevented, true);
assert.equal(frames.size, 1, 'wheel work coalesces'); flush(frames);
const after = content.getBoundingClientRect();
assert.ok(Math.abs(after.left + u * after.width - 220) < .001);
assert.ok(Math.abs(after.top + v * after.height - 250) < .001);
assert.equal(timers.size, 1, 'only one deferred render'); flush(timers); await Promise.resolve();
assert.equal(renders, 1);
controller.zoomTo(4); flush(timers); await Promise.resolve();
assert.equal(wheel(-500).defaultPrevented, true, 'wheel consumed at maximum'); flush(frames);
assert.equal(scale, 4); assert.equal(timers.size, 0);
assert.equal(wheel(50, { closest: () => ({}) }).defaultPrevented, false, 'text editors retain scrolling');
enabled = false; assert.equal(wheel(50).defaultPrevented, false); enabled = true;
const startLeft = left, startTop = top;
for (const [type, x, y] of [['pointerdown', 200, 200], ['pointermove', 180, 170], ['pointerup', 180, 170]]) {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { button: 1, pointerId: 7, clientX: x, clientY: y }); viewport.dispatchEvent(event);
}
assert.equal(left, startLeft + 20); assert.equal(top, startTop + 30, 'pointer release commits the final queued move');
wheel(50); controller.reset(); flush(frames); assert.equal(scale, 4, 'late frame ignored after reset');
wheel(50); flush(frames); const count = renders; controller.dispose(); flush(timers);
assert.equal(renders, count, 'no late render after dispose');
assert.equal(wheel(50).defaultPrevented, false, 'listeners removed');

let resolve, cancelled = false, current = true;
const buffer = { width: 0, height: 0, getContext: () => ({}) };
document.createElement = () => buffer;
const proxy = { getViewport: ({ scale }) => ({ width: 1200 * scale, height: 1800 * scale }),
  render: () => ({ cancel: () => { cancelled = true; }, promise: new Promise(done => { resolve = done; }) }) };
const canvas = { width: 300, height: 450, style: {}, getContext: () => ({ drawImage: () => {} }) }, wrap = { style: {}, hidden: false };
const render = renderPdfPreviewCanvas({ proxy, canvas, wrap, scale: 4, isCurrent: () => current });
assert.ok(buffer.width * buffer.height <= 8010000, 'bounded raster size');
assert.equal(canvas.width, 300, 'visible pixels kept while rendering');
render.cancel(); assert.equal(cancelled, true); current = false; resolve(); await render.promise;
assert.equal(canvas.width, 300, 'stale render cannot repaint'); assert.equal(buffer.width, 0);
console.log('Preview pointer anchoring, bounds, RAF, cleanup, pixel budget and stale canvas checks passed');
