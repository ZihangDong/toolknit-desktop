import assert from 'node:assert/strict';
import { createPdfEditorEvents } from '../src/features/pdf-editor/events.js';

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    files: [],
    value: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    contains: () => false,
    addEventListener(type, handler) {
      if (typeof handler !== 'function') return;
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    trigger(type, event = {}) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
    listenerCount(type) { return (listeners.get(type) || []).length; }
  };
}

const overlay = element();
const toolItem = element();
const fileInput = element();
const appendInput = element();
const imageInput = element();
const editModalInput = element();
const cta = element();
const newDocumentBtn = element();
const appendBtn = element();
const editTextBtn = element();
const selectComponentBtn = element();
const exportBtn = element();
const extractBtn = element();
const canvasScroll = element();
const zoomValueBtn = element();
const shapeFillInput = element();
const shapeStrokeInput = element();
const shapeStrokeWidth = element();
const calls = [];
let editMode = false;
let componentMode = false;

const events = createPdfEditorEvents({
  documentRef: { querySelectorAll: () => [toolItem] },
  listenerOptions: {},
  overlay,
  fileInput,
  appendInput,
  imageInput,
  editModalInput,
  cta,
  newDocumentBtn,
  appendBtn,
  editTextBtn,
  selectComponentBtn,
  exportBtn,
  extractBtn,
  shapeFillInput,
  shapeStrokeInput,
  shapeStrokeWidth,
  zoomValueBtn,
  canvasScroll,
  zoom: {
    bindButton: () => {},
    handleWheel: () => calls.push('wheel'),
    getState: () => ({ zoomPercent: 1 }),
    setZoom: mode => calls.push(`zoom:${mode}`)
  },
  exporter: {
    exportPdf: () => calls.push('export'),
    extractSelected: ids => calls.push(`extract:${ids.join(',')}`)
  },
  t: key => key,
  getEditMode: () => editMode,
  getComponentMode: () => componentMode,
  getSelectedComponent: () => null,
  getCurrentOperation: () => null,
  hexToRgb01: value => [value],
  setEditMode: value => { editMode = value; calls.push(`edit:${value}`); },
  setComponentMode: value => { componentMode = value; calls.push(`component:${value}`); },
  updateSelectedShapeProperty: (property, value) => calls.push(`shape:${property}:${value[0] ?? value}`),
  chooseMainFile: () => calls.push('choose-main'),
  saveEditModal: () => calls.push('save-text'),
  handleEditModalCancel: () => calls.push('cancel-text'),
  insertBlankPage: async () => calls.push('create-blank'),
  chooseAppendFile: () => calls.push('choose-append'),
  loadMainFile: file => calls.push(`load:${file?.name || 'none'}`),
  appendFile: file => calls.push(`append:${file.name}`),
  prepareInsertImage: file => calls.push(`image:${file?.name || 'none'}`),
  targetIds: () => ['page-1'],
  openOverlay: () => calls.push('open'),
  showDropZone: () => calls.push('drag-show'),
  hideDropZone: () => calls.push('drag-hide'),
  showToast: message => calls.push(`toast:${message}`)
});

cta.trigger('click');
appendBtn.trigger('click');
editTextBtn.trigger('click');
selectComponentBtn.trigger('click');
exportBtn.trigger('click');
extractBtn.trigger('click');
zoomValueBtn.trigger('click');
shapeFillInput.trigger('input', { target: { value: '#fff' } });
shapeStrokeWidth.trigger('input', { target: { value: '3' } });
toolItem.trigger('click');
assert.deepEqual(calls.slice(0, 10), [
  'choose-main',
  'choose-append',
  'edit:true',
  'component:true',
  'export',
  'extract:page-1',
  'zoom:fit',
  'shape:fill:#fff',
  'shape:strokeWidth:3',
  'open'
]);
selectComponentBtn.trigger('click');
assert.equal(componentMode, true, 'Clicking selection again must keep it active');
newDocumentBtn.trigger('click');
assert.equal(calls.at(-1), 'create-blank');

fileInput.files = [{ name: 'input.pdf' }];
fileInput.trigger('change');
appendInput.files = [{ name: 'append.pdf', size: 10, async arrayBuffer() { return new Uint8Array([1]).buffer; } }];
appendInput.trigger('change');
imageInput.files = [{ name: 'image.png' }];
imageInput.trigger('change');
overlay.classList.add('visible');
overlay.trigger('dragover', { preventDefault() {} });
overlay.trigger('dragleave', { relatedTarget: null });
assert.ok(calls.includes('load:input.pdf'));
assert.ok(calls.includes('append:append.pdf'));
assert.ok(calls.includes('image:image.png'));
assert.ok(calls.includes('drag-show'));
assert.ok(calls.includes('drag-hide'));
assert.equal(canvasScroll.listenerCount('wheel'), 1);
editModalInput.rows = 3;
let prevented = false;
editModalInput.trigger('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
assert.equal(prevented, false, 'Enter inserts a line break into inserted text');
const beforeComposition = calls.length;
editModalInput.trigger('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, preventDefault() { throw new Error('IME confirmation must stay with the input'); } });
assert.equal(calls.length, beforeComposition);
editModalInput.trigger('keydown', { key: 'Enter', ctrlKey: true, preventDefault() {} });
assert.equal(calls.at(-1), 'save-text', 'Ctrl+Enter submits multiline text');
editModalInput.rows = 1; editModalInput.value = 'old\nnew'; editModalInput.trigger('input');
assert.equal(editModalInput.value, 'old new', 'editing source lines preserves its single-line contract');
editModalInput.trigger('keydown', { key: 'Enter', preventDefault() {} });
assert.equal(calls.at(-1), 'save-text');

events.dispose();
console.log('PDF editor event binding checks passed');
