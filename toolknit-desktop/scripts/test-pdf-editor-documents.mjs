import assert from 'node:assert/strict';
import { createPdfEditorDocumentStore } from '../src/features/pdf-editor/documents.js';
globalThis.document = { baseURI: 'https://app.test/' };

function fixture() {
  const tasks = [];
  const library = { GlobalWorkerOptions: {}, getDocument() {
    const deferred = Promise.withResolvers();
    const task = { promise: deferred.promise, destroyed: 0,
      async destroy() { this.destroyed++; }, resolve: deferred.resolve, reject: deferred.reject };
    task.document = { numPages: 1, loadingTask: task };
    tasks.push(task); return task;
  } };
  const sources = [{ id: 'source', bytes: new Uint8Array([1, 2, 3]) }];
  const store = createPdfEditorDocumentStore({ pdfWorkerUrl: 'fixture-worker', getSources: () => sources,
    loadPdfjs: async () => library });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return { library, tasks, store, tick };
}

{
  const { store, tasks, tick } = fixture();
  const loading = store.loadBytes(new Uint8Array([1])); await tick();
  tasks[0].resolve(tasks[0].document);
  const result = await loading; store.set('source', result.document);
  await store.destroyAll();
  assert.equal(tasks[0].destroyed, 1, 'PDF.js 6 documents are destroyed through their loadingTask');
}
{
  const { store, tasks, tick } = fixture();
  const loading = store.loadBytes(new Uint8Array([1]));
  const rejection = assert.rejects(loading, /bad PDF/); await tick(); tasks[0].reject(new Error('bad PDF')); await rejection;
  assert.equal(tasks[0].destroyed, 1, 'a rejected parser must release its worker');
  await store.destroyAll(); assert.equal(tasks[0].destroyed, 1);
}
{
  const { library } = fixture(); const importGate = Promise.withResolvers(); let created = 0;
  const store = createPdfEditorDocumentStore({ getSources: () => [], loadPdfjs: async () => {
    await importGate.promise; return { ...library, getDocument() { created++; return library.getDocument(); } };
  } });
  const pending = store.loadBytes(new Uint8Array([1]));
  const rejected = assert.rejects(pending, error => error.name === 'PdfEditorCancelledError');
  await store.destroyAll(); importGate.resolve(); await rejected;
  assert.equal(created, 0, 'closing during dynamic import must not start an orphan worker');
}
{
  const { store, tasks, tick } = fixture();
  const old = store.loadBytes(new Uint8Array([1])); await tick(); tasks[0].resolve(tasks[0].document);
  store.set('old', (await old).document);
  const destroyGate = Promise.withResolvers();
  tasks[0].destroy = async () => { tasks[0].destroyed++; await destroyGate.promise; };
  const closing = store.destroyAll();
  const fresh = store.loadBytes(new Uint8Array([2])); await tick(); tasks[1].resolve(tasks[1].document);
  store.set('source', (await fresh).document); destroyGate.resolve(); await closing;
  assert.equal(await store.get('source'), tasks[1].document);
  assert.equal(tasks[1].destroyed, 0, 'old cleanup must not destroy a newly committed document');
  await store.dispose(); assert.equal(tasks[1].destroyed, 1);
}
{
  const { store, tasks, tick } = fixture();
  const first = store.get('source'), second = store.get('source'); await tick();
  assert.equal(tasks.length, 1, 'concurrent page consumers share one source load');
  tasks[0].resolve(tasks[0].document); assert.equal(await first, await second);
  await store.dispose();
}
console.log('PDF editor document workers: rejection cleanup, lazy cancellation, concurrent consumers and generation ownership passed');
