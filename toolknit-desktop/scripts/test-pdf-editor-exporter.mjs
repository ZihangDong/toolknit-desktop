import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createPdfEditorExporter } from '../src/features/pdf-editor/exporter.js';
import { createPdfEditorOperationRuntime } from '../src/features/pdf-editor/operation.js';

const pdf = await PDFDocument.create(); pdf.addPage([595.28, 841.89]);
const bytes = await pdf.save();
function fixture({ outputGate, writeGate, writeError = false } = {}) {
  const writes = [], successes = [], messages = [], reachedWrite = Promise.withResolvers();
  let saved = 0, disposed = false;
  const cancel = { disabled: false, style: {} };
  const runtime = createPdfEditorOperationRuntime({ processCancel: cancel });
  const exporter = createPdfEditorExporter({ ...runtime, isTauri: true,
    isDisposed: () => disposed, hasDocument: () => true,
    getOutputDir: async () => { if (outputGate) await outputGate.promise; return 'C:/fixture-output'; },
    getInvoke: async () => async (command, args) => {
      assert.equal(command, 'write_unique_file_bytes');
      assert.equal((await PDFDocument.load(Uint8Array.from(args.bytes))).getPageCount(), 1);
      writes.push(args.fileName); reachedWrite.resolve();
      if (writeGate) await writeGate.promise;
      if (writeError) throw new Error('fixture:disk-full');
      return args.directory + '/' + args.fileName;
    },
    t: key => key,
    getSources: () => [{ id: 'source', bytes, name: 'blank.pdf' }],
    getPages: () => [{ id: 'page', sourceId: 'source', pageIndex: 0, rotation: 0 }],
    getTextEdits: () => new Map(), getInsertedTexts: () => [], getInsertedImages: () => [], getInsertedShapes: () => [],
    getMainSourceName: () => 'blank.pdf',
    setSavedSnapshot: () => { saved++; },
    showSuccess: result => successes.push(result), showToast: value => messages.push(value)
  });
  return { exporter, runtime, cancel, writes, successes, messages, reachedWrite,
    saved: () => saved, dispose: () => { disposed = true; runtime.clearActiveOperation(); exporter.dispose(); } };
}

{
  const gate = Promise.withResolvers(), test = fixture({ writeGate: gate });
  const pending = test.exporter.exportPdf(); await test.reachedWrite.promise;
  assert.equal(test.cancel.disabled, true);
  await test.runtime.cancelActiveOperation();
  assert.equal(test.runtime.getActiveOperation().cancelled, false);
  gate.resolve(); await pending;
  assert.equal(test.saved(), 1); assert.equal(test.successes.length, 1); assert.equal(test.messages.length, 0);
  assert.equal(test.runtime.getActiveOperation(), null); assert.equal(test.cancel.disabled, false);
}
{
  const gate = Promise.withResolvers(), test = fixture({ outputGate: gate });
  const pending = test.exporter.exportPdf(); await test.runtime.cancelActiveOperation();
  gate.resolve(); await pending;
  assert.equal(test.writes.length, 0); assert.equal(test.saved(), 0); assert.equal(test.successes.length, 0);
  assert.deepEqual(test.messages, ['home.pdfEditor.cancelled']);
}
{
  const test = fixture({ writeError: true }); await test.exporter.exportPdf();
  assert.equal(test.saved(), 0); assert.equal(test.successes.length, 0); assert.equal(test.messages.length, 1);
  assert.equal(test.runtime.getActiveOperation(), null); assert.equal(test.cancel.disabled, false);
}
{
  const gate = Promise.withResolvers(), test = fixture({ writeGate: gate });
  const pending = test.exporter.extractSelected(['page']); await test.reachedWrite.promise;
  test.dispose(); gate.resolve(); await pending;
  assert.equal(test.saved(), 0); assert.equal(test.successes.length, 0); assert.equal(test.messages.length, 0);
}
console.log('PDF editor real assembly: cancellation before write, commit boundary, failed save and disposed late results passed');
