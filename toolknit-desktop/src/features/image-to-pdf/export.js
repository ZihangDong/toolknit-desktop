import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { createImagePdfWorker } from './worker-client.js';
import { LIMITS, pagePlan, decodeSize, outputName, imagePdfError } from './core.js';

export async function exportImagePdf({ pages, settings, name, inputs, check, operation, isTauri, getOutputDir, progress }) {
  if (!pages.length || pages.length > LIMITS.pages) throw imagePdfError('pages');
  const worker = createImagePdfWorker(); operation.worker = worker;
  let writeSession = null, native;
  try {
    await worker.request('start', { count: pages.length }); check();
    for (let i = 0; i < pages.length; i++) {
      check(); const entry = pages[i], plan = pagePlan(entry, settings);
      progress({ phase: 'rendering', current: i + 1, total: pages.length, percent: i / pages.length * 90 });
      const { maxWidth, maxHeight } = decodeSize(entry, plan);
      const bitmap = await inputs.bitmap(entry, maxWidth, maxHeight, check);
      let result;
      try { result = await worker.request('render', { bitmap, plan, settings, ordinal: i + 1 }, [bitmap]); }
      finally { bitmap.close(); }
      check();
      await worker.request('page', { ...result, width: plan.width, height: plan.height }, [result.buffer]);
    }
    progress({ phase: 'assembling', percent: 92 });
    const bytes = new Uint8Array(await worker.request('finish')); check();
    if (!bytes.length || bytes.length > LIMITS.outputBytes) throw imagePdfError('output-size');
    const fileName = outputName(name);
    let path = '';
    if (isTauri) {
      native = await tauriCorePromise;
      const directory = await getOutputDir('Image_PDF'); check();
      writeSession = await native.invoke('begin_pdf_enhance_write', { directory, fileName, expectedPages: pages.length }); check();
      for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
        await native.invoke('append_pdf_enhance_chunk', { sessionId: writeSession, bytes: Array.from(bytes.subarray(offset, offset + 1024 * 1024)) }); check();
        progress({ phase: 'saving', percent: 94 + offset / bytes.length * 5 });
      }
      operation.committing = true; progress({ phase: 'saving', percent: 99 });
      path = await native.invoke('finalize_pdf_enhance_write', { sessionId: writeSession }); writeSession = null;
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click();
      operation.owner.timeout(() => URL.revokeObjectURL(url), 1500); operation.owner.use(() => URL.revokeObjectURL(url));
    }
    check(); return { path, name: path ? path.split(/[\\/]/).pop() : fileName, count: pages.length, bytes: bytes.length };
  } finally {
    worker.dispose(); operation.worker = null;
    if (writeSession) await native.invoke('discard_pdf_enhance_write', { sessionId: writeSession }).catch(() => {});
  }
}
