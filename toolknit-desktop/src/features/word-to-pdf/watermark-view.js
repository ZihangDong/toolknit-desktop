import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createWordWatermark, WATERMARK_MAX_BYTES } from '../../word-watermark-core.js';
import { pdfjsDocumentOptions } from '../../shared/pdfjs-options.js';

export function createWordWatermarkView({ q, lifetime, tr, errorText }) {
  let revision = 0, cached = null, previewTask = null, locked = false, disposed = false;
  const fields = ['WatermarkType', 'WatermarkText', 'WatermarkImage', 'WatermarkOpacity', 'WatermarkAngle', 'WatermarkWidth', 'WatermarkPages'];
  const enabled = () => q('WatermarkEnabled').checked;
  function invalidate() {
    revision++; cached = null;
    void previewTask?.destroy(); previewTask = null;
    q('WatermarkCanvas').hidden = true;
    q('WatermarkPreviewStatus').textContent = tr('watermark.previewHint');
    q('WatermarkPreview').removeAttribute('aria-busy');
    render(locked);
  }
  function render(busy = false) {
    locked = busy;
    q('WatermarkEnabled').disabled = busy;
    q('WatermarkSettings').hidden = !enabled();
    q('WatermarkTextField').hidden = q('WatermarkType').value !== 'text';
    q('WatermarkImageField').hidden = q('WatermarkType').value !== 'image';
    fields.forEach(id => { q(id).disabled = busy || !enabled(); });
    q('WatermarkPreview').disabled = busy || !enabled();
    q('WatermarkOpacityValue').textContent = `${q('WatermarkOpacity').value}%`;
    q('WatermarkWidthValue').textContent = `${q('WatermarkWidth').value}%`;
  }
  async function build() {
    if (!enabled()) return null;
    if (cached) return cached;
    const settings = { type: q('WatermarkType').value, text: q('WatermarkText').value,
      opacity: Number(q('WatermarkOpacity').value) / 100, angle: Number(q('WatermarkAngle').value),
      width: Number(q('WatermarkWidth').value), pages: q('WatermarkPages').value };
    const file = q('WatermarkImage').files[0];
    const promise = (async () => {
      let fontBytes, imageBytes;
      if (settings.type === 'image') {
        if (!file || file.size > WATERMARK_MAX_BYTES) throw new Error('word-render:watermark-image');
        imageBytes = new Uint8Array(await file.arrayBuffer());
      } else {
        const response = await fetch('/assets/fonts/NotoSansSC-Regular.ttf');
        if (!response.ok) throw new Error('word-render:watermark-font');
        fontBytes = new Uint8Array(await response.arrayBuffer());
      }
      return createWordWatermark(settings, { fontBytes, imageBytes });
    })();
    cached = promise;
    try { return await promise; }
    catch (error) { if (cached === promise) cached = null; throw error; }
  }
  async function prepare() {
    const stamp = await build();
    if (!stamp) return null;
    let binary = '';
    for (let offset = 0; offset < stamp.bytes.length; offset += 8192) binary += String.fromCharCode(...stamp.bytes.subarray(offset, offset + 8192));
    return { pdfBase64: btoa(binary), pages: stamp.pages };
  }
  async function preview() {
    if (locked || disposed) return;
    const owner = ++revision;
    void previewTask?.destroy(); previewTask = null;
    q('WatermarkPreview').setAttribute('aria-busy', 'true');
    q('WatermarkPreviewStatus').textContent = tr('preparing');
    try {
      const stamp = await build();
      if (!stamp || owner !== revision || disposed) return;
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (owner !== revision || disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: stamp.bytes.slice(), isEvalSupported: false }));
      previewTask = task;
      try {
        const pdf = await task.promise, page = await pdf.getPage(1);
        if (owner !== revision || disposed) return;
        const viewport = page.getViewport({ scale: 320 / page.view[2] });
        // Render offscreen so invalidating an old request never paints the next session.
        const canvas = q('WatermarkCanvas').ownerDocument.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
        if (owner !== revision || disposed) return;
        const target = q('WatermarkCanvas'); target.width = canvas.width; target.height = canvas.height;
        target.getContext('2d').drawImage(canvas, 0, 0); target.hidden = false;
        q('WatermarkPreviewStatus').textContent = tr('watermark.previewHint');
      } finally { await task.destroy(); if (previewTask === task) previewTask = null; }
    } catch (error) {
      if (owner === revision && !disposed) { q('WatermarkCanvas').hidden = true; q('WatermarkPreviewStatus').textContent = errorText(error); }
    } finally { if (owner === revision && !disposed) q('WatermarkPreview').removeAttribute('aria-busy'); }
  }
  lifetime.event(q('WatermarkEnabled'), 'change', invalidate);
  fields.forEach(id => lifetime.event(q(id), 'input', invalidate));
  lifetime.event(q('WatermarkPreview'), 'click', () => void preview());
  lifetime.use(() => { disposed = true; revision++; void previewTask?.destroy(); });
  function reset() {
    q('WatermarkEnabled').checked = false; q('WatermarkType').value = 'text'; q('WatermarkText').value = '';
    q('WatermarkImage').value = ''; q('WatermarkOpacity').value = '20'; q('WatermarkAngle').value = '45';
    q('WatermarkWidth').value = '60'; q('WatermarkPages').value = ''; invalidate();
  }
  return { prepare, render, reset, restoreRequired() { reset(); q('WatermarkEnabled').checked = true; invalidate(); } };
}
