import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { SCAN_LIMITS, scanError, scanRenderPlan, scanFileName, scanSkewGeometry, validateScanSettings, validateScanPages } from './core.js';
import { createScanWorker } from './worker-client.js';

export async function transformScanCanvas(canvas, settings, pageNumber, worker, check = () => {}) {
  if (settings.mode === 'faithful') return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height);
  const buffer = await worker.request('effect', { buffer: pixels.data.buffer, width, height, settings, pageNumber }, [pixels.data.buffer]);
  check();
  context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
  const { angle, scale } = scanSkewGeometry(width, height, settings, pageNumber);
  if (!angle) return;
  const copy = document.createElement('canvas');
  try {
    copy.width = width; copy.height = height; copy.getContext('2d').drawImage(canvas, 0, 0);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.save(); context.translate(width / 2, height / 2); context.rotate(angle); context.scale(scale, scale);
    context.drawImage(copy, -width / 2, -height / 2); context.restore();
  } finally { copy.width = 0; copy.height = 0; }
}

export async function publishScanBytes({ bytes, fileName, count, isTauri, getOutputDir, check, operation, onCommit = () => {}, native = tauriCorePromise }) {
  check();
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) throw scanError('output-invalid');
  if (bytes.length > SCAN_LIMITS.outputBytes) throw scanError('output-large');
  validateScanPages(count);
  if (!isTauri) return '';
  const { invoke } = await native;
  const directory = await getOutputDir('PDF_Scan');
  check();
  let sessionId = null;
  try {
    sessionId = await invoke('begin_pdf_enhance_write', { directory, fileName, expectedPages: count });
    check();
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      await invoke('append_pdf_enhance_chunk', { sessionId, bytes: Array.from(bytes.subarray(offset, offset + 1024 * 1024)) });
      check();
    }
    // Once atomic publication begins, cancellation may no longer retract a valid result.
    operation.committing = true; onCommit();
    const path = await invoke('finalize_pdf_enhance_write', { sessionId });
    sessionId = null;
    return path;
  } finally {
    if (sessionId !== null) await invoke('discard_pdf_enhance_write', { sessionId }).catch(() => {});
  }
}

export async function exportScannedPdf({ pdf, pages, settings: value, fileName, operation, isTauri, getOutputDir, onProgress = () => {}, onCommit }) {
  const settings = validateScanSettings(value), started = Date.now();
  validateScanPages(pages.length);
  if (new Set(pages).size !== pages.length || pages.some(page => !Number.isInteger(page) || page < 1 || page > pdf.numPages)) throw scanError('range');
  const check = () => {
    if (operation.cancelled || !operation.isCurrent()) throw scanError('cancelled');
    if (Date.now() - started > SCAN_LIMITS.timeoutMs) throw scanError('timeout');
  };
  check();
  // Validate every selected page before allocating an export canvas.
  const plans = [];
  for (const number of pages) {
    const page = await pdf.getPage(number); check();
    const base = page.getViewport({ scale: 1 });
    plans.push(scanRenderPlan(base.width, base.height, settings.dpi));
  }
  const worker = createScanWorker(); operation.worker = worker;
  const canvas = document.createElement('canvas');
  try {
    await worker.request('start', { count: pages.length }); check();
    for (let i = 0; i < pages.length; i++) {
      check(); onProgress({ key: 'progressPage', current: i + 1, total: pages.length, percent: i / pages.length * 90 });
      const page = await pdf.getPage(pages[i]); check();
      const plan = plans[i];
      canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: plan.scale }), background: '#ffffff' });
      operation.renderTask = task; await task.promise; operation.renderTask = null; check();
      await transformScanCanvas(canvas, settings, pages[i], worker, check); check();
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(scanError('failed')), 'image/jpeg', 0.94));
      check();
      const buffer = await blob.arrayBuffer(); check();
      await worker.request('page', { buffer, width: plan.width, height: plan.height }, [buffer]); check();
      canvas.width = 0; canvas.height = 0;
      page.cleanup();
    }
    onProgress({ key: 'assembling', percent: 92 });
    const bytes = new Uint8Array(await worker.request('finish')); check();
    const name = scanFileName(fileName);
    onProgress({ key: 'saving', percent: 96 });
    const path = await publishScanBytes({ bytes, fileName: name, count: pages.length, isTauri, getOutputDir, check, operation, onCommit });
    return { bytes, path, name: path ? path.split(/[\\/]/).pop() : name, count: pages.length, settings };
  } finally {
    try { operation.renderTask?.cancel(); } catch {}
    operation.renderTask = null; operation.worker = null;
    worker.dispose(); canvas.width = 0; canvas.height = 0;
  }
}
