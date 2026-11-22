export const PDF_PPT_LIMITS = Object.freeze({ inputBytes: 150 * 1024 * 1024, pages: 200,
  pixels: 16_000_000, side: 8192, outputBytes: 128 * 1024 * 1024, timeoutMs: 300_000 });
export function pptError(code) { const error = new Error(`pdf-ppt:${code}`); error.code = code === 'cancelled' ? 'CANCELLED' : code; return error; }
export function pptErrorCode(error) {
  if (error?.name === 'RenderingCancelledException') return 'cancelled';
  if (error?.name === 'PasswordException') return 'password';
  return /pdf-ppt:([a-z-]+)/.exec(String(error?.message || error))?.[1] || 'failed';
}
export function validatePptInput(file) {
  if (!file || !/\.pdf$/i.test(file.name || '') || !Number.isFinite(file.size) || file.size < 5) throw pptError('invalid');
  if (file.size > PDF_PPT_LIMITS.inputBytes) throw pptError('input-large');
}
export function validatePptPages(count) {
  if (!Number.isInteger(count) || count < 1) throw pptError('invalid');
  if (count > PDF_PPT_LIMITS.pages) throw pptError('pages-large');
}
export function pptPageRange(text, count) {
  validatePptPages(count);
  const value = String(text).trim();
  if (value.length > 1000) throw pptError('range');
  if (!value) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of value.replaceAll('，', ',').split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw pptError('range');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > count) throw pptError('range');
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
export function pptRenderPlan(width, height, dpi) {
  if (![144, 200, 300].includes(dpi)) throw pptError('settings');
  if (![width, height].every(value => Number.isFinite(value) && value >= 1)) throw pptError('page-size');
  const scale = dpi / 72, pixelWidth = Math.ceil(width * dpi / 72), pixelHeight = Math.ceil(height * dpi / 72);
  if (pixelWidth * pixelHeight > PDF_PPT_LIMITS.pixels || Math.max(pixelWidth, pixelHeight) > PDF_PPT_LIMITS.side) throw pptError('page-size');
  return { width, height, scale, pixelWidth, pixelHeight };
}
export function pptSlideSize(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value >= 1)
    || Math.max(width, height) / Math.min(width, height) > 10) throw pptError('page-size');
  const scale = 9144000 / Math.max(width, height);
  return { cx: Math.round(width * scale), cy: Math.round(height * scale), type: 'custom' };
}
export function fitPptImage(width, height, size) {
  if (![width, height, size.cx, size.cy].every(value => Number.isFinite(value) && value > 0)) throw pptError('page-size');
  const scale = Math.min(size.cx / width, size.cy / height);
  const cx = Math.round(width * scale), cy = Math.round(height * scale);
  return { x: Math.round((size.cx - cx) / 2), y: Math.round((size.cy - cy) / 2), cx, cy };
}
export function pptFileName(name) {
  const base = String(name || 'document.pdf').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 90) || 'document';
  return `${base}_slides.pptx`;
}
