import { IMAGE_PDF_LIMITS } from '../../core/limits/pdf.js';
export const LIMITS = IMAGE_PDF_LIMITS;
export const DEFAULT_SETTINGS = Object.freeze({ paper: 'a4', orientation: 'auto', margin: 8, quality: 'balanced', mode: 'faithful' });
export const QUALITY = Object.freeze({ clear: { dpi: 300, jpeg: .96 }, balanced: { dpi: 200, jpeg: .9 }, small: { dpi: 150, jpeg: .78 } });
export const imagePdfError = code => new Error(`image-pdf:${code}`);
export function errorCode(error) {
  const message = String(error?.message || error);
  if (message.includes('pdf-enhance:output-path')) return 'output-path';
  if (message.includes('pdf-enhance:output-too-large')) return 'output-size';
  return /(?:image-pdf|pdf-scan):([a-z-]+)/.exec(String(error?.message || error))?.[1] || 'failed';
}
export function validateInput(file) {
  if (!file || !/\.(?:jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name || '')) throw imagePdfError('format');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > LIMITS.inputBytes) throw imagePdfError('input-size');
}
export function validateDimensions(width, height) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > LIMITS.inputSide
    || height > LIMITS.inputSide || width * height > LIMITS.inputPixels) throw imagePdfError('pixels');
}
export function settingsFor(value) {
  const settings = { ...DEFAULT_SETTINGS, ...value };
  if (!['a4', 'original'].includes(settings.paper) || !['auto', 'portrait', 'landscape'].includes(settings.orientation)
    || ![0, 8, 15].includes(settings.margin) || !Object.hasOwn(QUALITY, settings.quality)
    || !['faithful', 'grayscale', 'natural'].includes(settings.mode)) throw imagePdfError('settings');
  return settings;
}
export function pagePlan(image, value = {}) {
  const settings = settingsFor(value);
  validateDimensions(image.width, image.height);
  const rotation = image.rotation ?? 0;
  if (![0, 90, 180, 270].includes(rotation)) throw imagePdfError('settings');
  const [imageWidth, imageHeight] = rotation % 180 ? [image.height, image.width] : [image.width, image.height];
  const resolution = value => Number.isFinite(Number(value)) && Number(value) >= 36 && Number(value) <= 2400 ? Number(value) : null;
  const sourceX = resolution(image.dpiX) || resolution(image.dpiY) || 96;
  const sourceY = resolution(image.dpiY) || resolution(image.dpiX) || 96;
  const [dpiX, dpiY] = rotation % 180 ? [sourceY, sourceX] : [sourceX, sourceY];
  let width = settings.paper === 'a4' ? 595.28 : imageWidth * 72 / dpiX;
  let height = settings.paper === 'a4' ? 841.89 : imageHeight * 72 / dpiY;
  if (settings.paper === 'a4' && (settings.orientation === 'landscape' || settings.orientation === 'auto' && imageWidth > imageHeight)) [width, height] = [height, width];
  if (Math.max(width, height) > 14400 || Math.min(width, height) < 1) throw imagePdfError('paper-size');
  const margin = settings.paper === 'a4' ? settings.margin * 72 / 25.4 : 0;
  const fit = Math.min((width - margin * 2) / imageWidth, (height - margin * 2) / imageHeight);
  const drawWidth = settings.paper === 'a4' ? imageWidth * fit : width;
  const drawHeight = settings.paper === 'a4' ? imageHeight * fit : height;
  const requestedScale = QUALITY[settings.quality].dpi / 72;
  const sourceScale = Math.min(imageWidth / drawWidth, imageHeight / drawHeight);
  const budgetScale = Math.min(LIMITS.renderSide / width, LIMITS.renderSide / height,
    Math.sqrt(LIMITS.renderPixels / (width * height)));
  // Keep enough page pixels to represent A4 margins, even for a one-pixel icon.
  // Source decoding stays at its original resolution; this does not add detail.
  const scale = Math.min(requestedScale, budgetScale, Math.max(settings.paper === 'a4' ? 1 : 0, sourceScale));
  const effectiveScale = Math.min(scale, sourceScale);
  return { width, height, rotation, imageWidth, imageHeight,
    x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, drawWidth, drawHeight,
    pixelWidth: Math.max(1, Math.floor(width * scale)), pixelHeight: Math.max(1, Math.floor(height * scale)),
    effectiveDpi: effectiveScale * 72, sourceDpi: dpiX, resolutionLimited: effectiveScale + .001 < requestedScale,
    resolutionLimit: budgetScale + .001 < Math.min(sourceScale, requestedScale) ? 'processing' : 'source' };
}
export function naturalFileOrder(files) {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

export function decodeSize(image, plan) {
  const paintedWidth = plan.drawWidth * plan.pixelWidth / plan.width;
  const paintedHeight = plan.drawHeight * plan.pixelHeight / plan.height;
  const [targetWidth, targetHeight] = plan.rotation % 180 ? [paintedHeight, paintedWidth] : [paintedWidth, paintedHeight];
  // TIFF may have different horizontal and vertical resolution. Decode enough
  // samples for both axes before the final canvas applies physical dimensions.
  const scale = Math.min(1, Math.max(targetWidth / image.width, targetHeight / image.height),
    LIMITS.renderSide / image.width, LIMITS.renderSide / image.height,
    Math.sqrt(LIMITS.renderPixels / (image.width * image.height)));
  return { maxWidth: Math.max(1, Math.floor(image.width * scale)), maxHeight: Math.max(1, Math.floor(image.height * scale)) };
}
export function movePage(pages, fromId, toId, after = false) {
  if (fromId === toId) return pages;
  const from = pages.findIndex(page => page.id === fromId), target = pages.findIndex(page => page.id === toId);
  if (from < 0 || target < 0) return pages;
  const result = [...pages], [item] = result.splice(from, 1);
  result.splice(result.findIndex(page => page.id === toId) + Number(after), 0, item);
  return result;
}
export function outputName(value) {
  let name = String(value || '').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '_');
  name = [...name].slice(0, 90).join('').replace(/[. ]+$/g, '') || 'images';
  if (/^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return `${name}.pdf`;
}
