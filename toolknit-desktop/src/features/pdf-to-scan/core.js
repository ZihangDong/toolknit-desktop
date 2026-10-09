export const SCAN_LIMITS = Object.freeze({ inputBytes: 64 * 1024 * 1024, outputBytes: 100 * 1024 * 1024,
  pages: 100, pixels: 16000000, side: 8192, timeoutMs: 10 * 60 * 1000 });
export const DEFAULT_SCAN_SETTINGS = Object.freeze({ mode: 'faithful', dpi: 200, noise: 2, warmth: 3, skew: 0.25 });
export function scanError(code) { return new Error(`pdf-scan:${code}`); }
export function scanErrorCode(error) {
  if (error?.name === 'PasswordException') return 'password';
  const message = String(error?.message || error);
  if (message.includes('pdf-enhance:output-too-large')) return 'output-large';
  if (message.includes('pdf-enhance:output-path')) return 'output-path';
  return /pdf-scan:([a-z-]+)/.exec(message)?.[1] || 'failed';
}
export function validateScanInput(file) {
  if (!file || !/\.pdf$/i.test(file.name || '') || !Number.isFinite(file.size) || file.size < 5) throw scanError('invalid');
  if (file.size > SCAN_LIMITS.inputBytes) throw scanError('input-large');
}
export function validateScanSettings(value) {
  const settings = { ...DEFAULT_SCAN_SETTINGS, ...value };
  if (!['faithful', 'grayscale', 'natural'].includes(settings.mode) || ![150, 200, 300].includes(settings.dpi)) throw scanError('settings');
  for (const [key, max] of [['noise', 8], ['warmth', 10], ['skew', 0.8]]) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > max) throw scanError('settings');
  }
  return settings;
}
export function validateScanPages(count) {
  if (!Number.isInteger(count) || count < 1) throw scanError('invalid');
  if (count > SCAN_LIMITS.pages) throw scanError('pages-large');
}
export function scanPageRange(text, count) {
  validateScanPages(count);
  if (!String(text).trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of String(text).replaceAll('\uFF0C', ',').split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw scanError('range');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > count) throw scanError('range');
    for (let i = first; i <= last; i++) pages.add(i);
  }
  return [...pages].sort((a, b) => a - b);
}
export function scanRenderPlan(width, height, dpi) {
  if (![150, 200, 300].includes(dpi) || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw scanError('page-size');
  const scale = dpi / 72, pixelWidth = Math.ceil(width * dpi / 72), pixelHeight = Math.ceil(height * dpi / 72);
  if (pixelWidth * pixelHeight > SCAN_LIMITS.pixels || Math.max(pixelWidth, pixelHeight) > SCAN_LIMITS.side) throw scanError('page-size');
  return { width, height, scale, pixelWidth, pixelHeight };
}
export function scanFileName(name) {
  const base = String(name || 'document.pdf').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'document';
  return `${base}_scan.pdf`;
}
export function scanSkewGeometry(width, height, settings, pageNumber) {
  const angle = settings.mode === 'natural' ? settings.skew * (pageNumber % 2 ? 1 : -1) * Math.PI / 180 : 0;
  // Fit the rotated page inside its original paper so corner text is never cut off.
  const scale = Math.min(width / (width * Math.cos(angle) + height * Math.abs(Math.sin(angle))),
    height / (height * Math.cos(angle) + width * Math.abs(Math.sin(angle))));
  return { angle, scale };
}
export function applyScanPixels(data, width, height, value, seed = 1) {
  const settings = validateScanSettings(value);
  if (!(data instanceof Uint8ClampedArray) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width * height > SCAN_LIMITS.pixels || data.length !== width * height * 4) throw scanError('page-size');
  if (settings.mode === 'faithful') return data;
  let random = (seed >>> 0) || 1;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const r = data[i] * alpha + 255 * (1 - alpha), g = data[i + 1] * alpha + 255 * (1 - alpha), b = data[i + 2] * alpha + 255 * (1 - alpha);
    if (settings.mode === 'grayscale') {
      const gray = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
      data[i] = gray; data[i + 1] = gray; data[i + 2] = gray;
    } else {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const noise = ((random >>> 0) / 4294967295 - 0.5) * settings.noise;
      const paper = Math.min(r, g, b) / 255;
      data[i] = r + noise;
      data[i + 1] = g + noise - settings.warmth * 0.35 * paper;
      data[i + 2] = b + noise - settings.warmth * paper;
    }
    data[i + 3] = 255;
  }
  return data;
}
