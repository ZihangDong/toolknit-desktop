import { PDF_PPT_LIMITS, pptError, pptFileName, pptRenderPlan, validatePptPages } from './core.js';
import { createPptPackageWorker } from './worker-client.js';
import { writeUniqueBinaryFile } from '../../platform/binary-output.js';

export async function exportPdfPresentation({ pdf, pages, dpi, fileName, operation, onProgress = () => {}, createWorker = createPptPackageWorker }) {
  validatePptPages(pages.length);
  if (new Set(pages).size !== pages.length || pages.some(p => !Number.isInteger(p) || p < 1 || p > pdf.numPages)) throw pptError('range');
  const check = operation.check;
  check();
  const plans = [];
  for (const number of pages) {
    const page = await pdf.getPage(number); check();
    const base = page.getViewport({ scale: 1 });
    plans.push(pptRenderPlan(base.width, base.height, dpi));
  }
  const worker = createWorker(); operation.worker = worker;
  const canvas = document.createElement('canvas');
  try {
    await worker.request('start', { width: plans[0].width, height: plans[0].height, count: pages.length, title: fileName }); check();
    for (let i = 0; i < pages.length; i++) {
      check(); onProgress({ key: 'rendering', current: i + 1, total: pages.length, percent: i / pages.length * 90 });
      const page = await pdf.getPage(pages[i]); check();
      const plan = plans[i]; canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
      try {
        const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: page.getViewport({ scale: plan.scale }), background: '#ffffff' });
        operation.renderTask = task; await task.promise; operation.renderTask = null; check();
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(pptError('failed')), 'image/png'));
        check(); const buffer = await blob.arrayBuffer(); check();
        await worker.request('page', { buffer, width: plan.width, height: plan.height, pageNumber: pages[i] }, [buffer]); check();
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    onProgress({ key: 'assembling', percent: 93 });
    const bytes = await worker.request('finish'); check();
    if (!(bytes instanceof Uint8Array) || bytes.length > PDF_PPT_LIMITS.outputBytes) throw pptError('output-large');
    return { bytes, name: pptFileName(fileName), count: pages.length, dpi };
  } finally {
    try { operation.renderTask?.cancel(); } catch {}
    operation.renderTask = null; operation.worker = null;
    worker.dispose(); canvas.width = 0; canvas.height = 0;
  }
}

export async function publishPdfPresentation({ output, invoke, getOutputDir, operation, onCommit = () => {} }) {
  const directory = await getOutputDir('PDF_To_PPT'); operation.check();
  // The existing binary writer reserves a unique filename and removes failed writes.
  // Once writing starts, retain ownership until it returns the actual saved path.
  operation.committing = true; onCommit();
  return writeUniqueBinaryFile(invoke, { directory, fileName: output.name, bytes: output.bytes });
}
