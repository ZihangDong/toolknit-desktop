import assert from 'node:assert/strict';
import { createPdfEditorControls } from '../src/features/pdf-editor/controls.js';

function button() {
  const values = new Set();
  return {
    disabled: false,
    dataset: {},
    attributes: {},
    classList: {
      add: name => values.add(name),
      remove: name => values.delete(name),
      toggle: (name, force) => {
        const next = force === undefined ? !values.has(name) : Boolean(force);
        if (next) values.add(name); else values.delete(name);
        return next;
      },
      contains: name => values.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    textContent: ''
  };
}

const refs = Object.fromEntries([
  'appendBtn', 'rotateCcwBtn', 'rotateCwBtn', 'moveUpBtn', 'moveDownBtn',
  'duplicateBtn', 'blankPageBtn', 'newDocumentBtn', 'deleteBtn', 'extractBtn', 'replaceBtn',
  'exportBtn', 'editTextBtn', 'editTextSidebarBtn', 'insertTextBtn',
  'insertImageBtn', 'insertRectBtn', 'insertEllipseBtn', 'insertLineBtn',
  'selectComponentBtn', 'resetBtn', 'undoBtn', 'redoBtn', 'selectedCountEl',
  'pageIndicator', 'footerHint', 'selectAllBtn', 'invertSelectionBtn'
].map(key => [key, button()]));
refs.insertTextBtn.dataset.insertMode = 'text';
refs.insertImageBtn.dataset.insertMode = 'image';
refs.insertRectBtn.dataset.insertMode = 'rect';
refs.insertEllipseBtn.dataset.insertMode = 'ellipse';
refs.insertLineBtn.dataset.insertMode = 'line';

const pageOne = { id: 'page-1' };
const pageTwo = { id: 'page-2' };
const pages = [pageOne, pageTwo];
const pageState = {
  id: 'page-1',
  tile: button(),
  selectButton: button()
};
let hasDocument = false;
let busy = null;
let selectedIds = new Set();
let componentMode = false;
let editMode = false;
let insertMode = null;
let baseline = null;
let undo = false;
let redo = false;
let zoomUpdates = 0;

const controls = createPdfEditorControls({
  ...refs,
  t: (key, params) => `${key}:${params?.count ?? params?.current ?? params?.name ?? ''}`,
  getActiveOperation: () => busy,
  hasDocument: () => hasDocument,
  getPages: () => pages,
  getSelectedIds: () => selectedIds,
  getCurrentPage: () => pages[0],
  pageSupportsContentEditing: () => true,
  getSelectedComponent: () => null,
  getComponentMode: () => componentMode,
  getEditMode: () => editMode,
  getInsertMode: () => insertMode,
  getMainSourceName: () => 'file.pdf',
  getPageStates: () => new Map([['page-1', pageState]]),
  updateZoomLabel: () => { zoomUpdates += 1; }
});
controls.setHistoryState({ getBaseline: () => baseline, canUndo: () => undo, canRedo: () => redo });

controls.updateControls();
assert.equal(refs.exportBtn.disabled, true);
assert.equal(refs.insertTextBtn.disabled, true);
assert.equal(refs.blankPageBtn.disabled, false, 'blank page can initialize an empty editor');
assert.equal(refs.newDocumentBtn.disabled, false);
assert.equal(refs.footerHint.textContent, 'home.pdfEditor.footerEmptyHint:');

hasDocument = true;
selectedIds = new Set(['page-1']);
baseline = { pages };
undo = true;
redo = true;
insertMode = 'text';
controls.updateControls();
assert.equal(refs.exportBtn.disabled, false);
assert.equal(refs.moveUpBtn.disabled, true);
assert.equal(refs.moveDownBtn.disabled, false);
assert.equal(refs.selectedCountEl.textContent, 'home.pdfEditor.selectedCount:1');
assert.equal(refs.pageIndicator.textContent, 'home.pdfEditor.pageIndicator:1');
assert.equal(refs.footerHint.textContent, 'home.pdfEditor.footerHint:file.pdf');
assert.equal(refs.insertTextBtn.classList.contains('is-active'), true);
assert.equal(pageState.selectButton.attributes['aria-pressed'], 'true');
assert.equal(refs.undoBtn.disabled, false);
assert.equal(refs.redoBtn.disabled, false);

busy = { type: 'export' };
controls.updateControls();
assert.equal(refs.blankPageBtn.disabled, true);
assert.equal(refs.newDocumentBtn.disabled, true);
assert.equal(refs.exportBtn.disabled, true);
assert.equal(refs.insertTextBtn.disabled, true);
busy = null;

editMode = true;
componentMode = true;
controls.updateControls();
assert.equal(refs.editTextBtn.attributes['aria-pressed'], 'true');
assert.equal(refs.selectComponentBtn.attributes['aria-pressed'], 'true');
assert.equal(zoomUpdates >= 3, true);

console.log('PDF editor control state checks passed');
