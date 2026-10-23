import assert from 'node:assert/strict';
import { createPdfEditorOperationRuntime } from '../src/features/pdf-editor/operation.js';

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name)
  };
}

const processMask = { classList: classList() };
const processCancel = { disabled: false, style: {} };
const processBarFill = { style: {} };
const processValue = { textContent: '' };
const processText = { textContent: '' };
const successOverlay = { classList: classList() };
const exportBtn = { id: 'export' };
const back = { id: 'back' };
const focused = { id: 'focused' };
const restored = [];
const invoked = [];
let nativeBytes = Uint8Array.from([8, 9, 10]);
let tauri = false;

const runtime = createPdfEditorOperationRuntime({
  isTauri: tauri,
  t: (key, params) => params?.error ? `${key}:${params.error}` : key,
  getInvoke: async () => async (command, args) => {
    invoked.push({ command, args });
    if (command === 'get_file_size') return 42;
    return nativeBytes;
  },
  processMask,
  processBarFill,
  processValue,
  processText,
  processCancel,
  successOverlay,
  exportBtn,
  back,
  focusedElement: () => focused,
  restoreFocus: value => restored.push(value),
  canReceiveFocus: value => value === focused,
  syncInteractiveLayers: () => {},
  updateControls: () => {},
  isRenderCancellation: error => error?.renderCancelled === true
});

const operation = runtime.beginOperation('load');
assert.equal(operation.id, 1);
assert.equal(runtime.getActiveOperation(), operation);
runtime.showProcess('loadingDocument', 12);
assert.equal(processMask.classList.contains('visible'), true);
assert.equal(processBarFill.style.width, '12%');
assert.equal(processValue.textContent, '12%');
assert.equal(processText.textContent, 'home.pdfEditor.loadingDocument');
runtime.setLocalizedProgress(35, 'preparingPages', { count: 2 });
assert.equal(operation.progressKey, 'preparingPages');
assert.deepEqual(operation.progressParams, { count: 2 });

let destroyed = 0;
operation.loadingTask = { destroy: async () => { destroyed += 1; } };
await runtime.cancelActiveOperation();
assert.equal(operation.cancelled, true);
assert.equal(destroyed, 1);
assert.equal(processCancel.disabled, true);
assert.throws(() => runtime.assertOperation(operation), /cancelled/);
runtime.endOperation(operation);
assert.equal(runtime.getActiveOperation(), null);
assert.equal(processMask.classList.contains('visible'), false);

const exportOperation = runtime.beginOperation('export');
assert.equal(exportOperation.id, 2);
assert.throws(() => runtime.beginOperation('append'), /busy/);
runtime.beginCommit(exportOperation);
assert.equal(processCancel.disabled, true);
await runtime.cancelActiveOperation();
assert.equal(exportOperation.cancelled, false, 'an irreversible write cannot be reported as cancelled');
runtime.endOperation(exportOperation);
assert.equal(restored.at(-1), focused);

assert.equal(runtime.messageForError({ name: 'PasswordException' }, 'load'), 'home.pdfEditor.passwordProtected');
assert.equal(runtime.messageForError({ message: 'PDF exceeds page limit' }, 'append'), 'home.pdfEditor.tooManyPages');
assert.equal(runtime.messageForError({ renderCancelled: true }, 'export'), 'home.pdfEditor.cancelled');
assert.equal(runtime.messageForError({ message: 'boom' }, 'export'), 'home.pdfEditor.exportFailed:boom');

const browserFile = { size: 7, async arrayBuffer() { return Uint8Array.from([1, 2]).buffer; } };
assert.equal(await runtime.fileSizeFor(browserFile), 7);
assert.deepEqual([...await runtime.readBytes(browserFile)], [1, 2]);

tauri = true;
const nativeRuntime = createPdfEditorOperationRuntime({
  isTauri: tauri,
  getInvoke: async () => async (command, args) => {
    invoked.push({ command, args });
    return command === 'get_file_size' ? 99 : nativeBytes;
  }
});
const nativeFile = { path: 'C:/input.pdf', size: 0 };
assert.equal(await nativeRuntime.fileSizeFor(nativeFile), 99);
assert.deepEqual([...await nativeRuntime.readBytes(nativeFile)], [...nativeBytes]);
assert.deepEqual(invoked.slice(-2).map(item => item.command), ['get_file_size', 'read_file_bytes']);

runtime.clearActiveOperation();
console.log('PDF editor operation runtime checks passed');
