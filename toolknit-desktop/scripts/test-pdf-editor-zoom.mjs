import assert from 'node:assert/strict';
import { createPdfEditorZoomController } from '../src/features/pdf-editor/zoom.js';

function makeElement({ left = 0, top = 0, width = 200, height = 300 } = {}) {
  const listeners = new Map();
  return {
    style: {},
    dataset: {},
    clientWidth: width,
    clientHeight: height,
    scrollWidth: width * 5,
    scrollHeight: height * 5,
    scrollLeft: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
    contains: () => true,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    listeners
  };
}

const canvasWrap = makeElement({ left: 100, top: 50 });
const canvasScroll = makeElement({ left: 100, top: 50 });
const frames = [];
const timers = new Map();
let timerId = 0;
let intervals = new Map();
let intervalId = 0;
let renderedRequests = [];
let lastRenderScale = 1;
let menuPositions = 0;

function flushFrames() {
  while (frames.length) frames.shift()?.();
}

const zoom = createPdfEditorZoomController({
  getCanvasWrap: () => canvasWrap,
  getCanvasScroll: () => canvasScroll,
  getSelectedComponent: () => ({ type: 'text' }),
  getLastRenderScale: () => lastRenderScale,
  setLastRenderScale: value => { lastRenderScale = value; },
  hasDocument: () => true,
  updateZoomLabel: () => {},
  positionComponentMenu: () => { menuPositions += 1; },
  renderMainPreview: (...args) => renderedRequests.push(args),
  requestFrame: callback => {
    frames.push(callback);
    return frames.length;
  },
  cancelFrame: handle => { frames[handle - 1] = null; },
  setTimer: callback => {
    const id = ++timerId;
    timers.set(id, callback);
    return id;
  },
  clearTimer: id => timers.delete(id),
  setIntervalRef: callback => {
    const id = ++intervalId;
    intervals.set(id, callback);
    return id;
  },
  clearIntervalRef: id => intervals.delete(id)
});

assert.deepEqual(zoom.getState(), { viewMode: 'fit', zoomPercent: 1 });
zoom.setState({ viewMode: 'manual', zoomPercent: 1.5 });
assert.deepEqual(zoom.getState(), { viewMode: 'manual', zoomPercent: 1.5 });
assert.equal(zoom.getCurrentScale(), 1.5);

zoom.setZoom('manual', 2, { clientX: 200, clientY: 200 });
assert.equal(canvasWrap.style.transform, 'translate3d(-100px, -150px, 0) scale(2)');
assert.equal(canvasWrap.style.transformOrigin, '0px 0px');
flushFrames();
assert.equal(renderedRequests.length, 1);
const [previewToken, previewRequest] = renderedRequests[0];
assert.equal(previewToken, zoom.getPreviewToken());
assert.equal(zoom.isCurrentRequest(previewRequest), true);

zoom.commitRender(previewToken, previewRequest, 2);
assert.equal(canvasWrap.style.transform, '');
assert.equal(canvasWrap.style.transformOrigin, '');
assert.equal(canvasWrap.dataset.zoomPreviewToken, undefined);
assert.equal(lastRenderScale, 2);
assert.equal(canvasScroll.scrollLeft, 100);
assert.equal(canvasScroll.scrollTop, 150);
flushFrames();
assert.ok(menuPositions >= 2);

let prevented = false;
zoom.setState({ viewMode: 'manual', zoomPercent: 1 });
zoom.setLastRenderScale(1);
zoom.handleWheel({
  target: canvasScroll,
  deltaMode: 0,
  deltaY: -100,
  clientX: 210,
  clientY: 210,
  preventDefault: () => { prevented = true; }
});
assert.equal(prevented, true);
assert.ok(zoom.getState().zoomPercent > 1);

zoom.setZoom('fit', zoom.getState().zoomPercent);
assert.equal(zoom.getState().viewMode, 'fit');
flushFrames();
assert.equal(renderedRequests.length, 2);

const staleRequest = renderedRequests[1][1];
zoom.setZoom('manual', 1.2);
zoom.reset();
assert.equal(zoom.isCurrentRequest(staleRequest), false);
assert.equal(canvasWrap.style.transform, '');
assert.equal(timers.size, 0);
assert.equal(intervals.size, 0);

const button = makeElement();
zoom.bindButton(button, 1.25);
button.dispatch('click', { preventDefault: () => {} });
assert.ok(zoom.getState().zoomPercent > 1.2);
button.dispatch('pointerdown', {
  button: 0,
  pointerId: 1,
  preventDefault: () => {},
  setPointerCapture: () => {}
});
assert.ok(timers.size >= 1);
button.dispatch('pointercancel');
assert.equal(timers.size, 0);
assert.equal(intervals.size, 0);

zoom.dispose();
assert.equal(zoom.isCurrentRequest({ requestId: 999 }), false);

console.log('PDF editor zoom lifecycle checks passed');
