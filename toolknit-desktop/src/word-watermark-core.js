import { PDFDocument, degrees, rgb } from 'pdf-lib';
import fontkit from './pdf-lib-fontkit.js';

export const WATERMARK_PAGE = Object.freeze({ width: 595.28, height: 841.89 });
export const WATERMARK_MAX_BYTES = 4 * 1024 * 1024;
const fail = code => { throw new Error(`word-render:${code}`); };

export function watermarkPages(value = '', count = 10000) {
  if (typeof value !== 'string' || value.length > 500) fail('watermark-pages');
  if (!value.trim()) return '';
  const selected = new Set();
  for (const part of value.split(',')) {
    const match = part.trim().match(/^([1-9]\d{0,4})(?:\s*-\s*([1-9]\d{0,4}))?$/);
    if (!match) fail('watermark-pages');
    const first = Number(match[1]), last = Number(match[2] || first);
    if (first > last || last > count) fail('watermark-pages');
    for (let page = first; page <= last; page++) selected.add(page);
  }
  const ordered = [...selected].sort((a, b) => a - b), ranges = [];
  for (let i = 0; i < ordered.length; i++) {
    const first = ordered[i]; let last = first;
    while (ordered[i + 1] === last + 1) last = ordered[++i];
    ranges.push(first === last ? String(first) : `${first}-${last}`);
  }
  return ranges.join(',');
}

export const watermarkPageCount = pages => pages.split(',').reduce((total, range) => {
  const [first, last = first] = range.split('-').map(Number); return total + last - first + 1;
}, 0);

export function normalizeWatermark(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('watermark-options');
  const { type = 'text', text = '', opacity = 0.2, angle = 45, width = 60, pages = '' } = value;
  if (!['text', 'image'].includes(type) || typeof text !== 'string'
    || (type === 'text' && (!text.trim() || [...text].length > 80 || /[\u0000-\u001f\u007f]/.test(text)))
    || typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1
    || ![-45, 0, 45].includes(angle) || typeof width !== 'number' || !Number.isFinite(width) || width < 20 || width > 80) fail('watermark-options');
  watermarkPages(pages);
  return { type, text, opacity, angle, width, pages: pages.trim() };
}

// A single A4 overlay. qpdf uniformly fits and centers it on each target page,
// including landscape and mixed paper sizes; the original page content stays intact.
export async function createWordWatermark(value, { fontBytes, imageBytes } = {}) {
  const settings = normalizeWatermark(value);
  const pdf = await PDFDocument.create(), page = pdf.addPage([WATERMARK_PAGE.width, WATERMARK_PAGE.height]);
  let width = WATERMARK_PAGE.width * settings.width / 100, height, draw;
  if (settings.type === 'text') {
    if (!fontBytes?.length) fail('watermark-font');
    let font;
    try {
      const parsed = fontkit.create(fontBytes);
      if ([...settings.text].some(char => !parsed.hasGlyphForCodePoint(char.codePointAt(0)))) fail('watermark-font');
      pdf.registerFontkit(fontkit);
      font = await pdf.embedFont(fontBytes, { subset: true });
    } catch { fail('watermark-font'); }
    let size = Math.min(96, width / font.widthOfTextAtSize(settings.text, 1));
    width = font.widthOfTextAtSize(settings.text, size);
    height = font.heightAtSize(size, { descender: false });
    draw = (x, y) => page.drawText(settings.text, { x, y, size, font, color: rgb(0.35, 0.35, 0.35), opacity: settings.opacity, rotate: degrees(settings.angle) });
  } else {
    if (!imageBytes?.length || imageBytes.length > WATERMARK_MAX_BYTES) fail('watermark-image');
    let image;
    try {
      // Inspect dimensions before embedding to bound decompression in preview consumers.
      const { imageDimensions } = await import('./word-watermark-image.js');
      imageDimensions(imageBytes);
      image = imageBytes[0] === 137 ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
    } catch { fail('watermark-image'); }
    height = width * image.height / image.width;
    if (height > WATERMARK_PAGE.height * 0.6) { width *= WATERMARK_PAGE.height * 0.6 / height; height = WATERMARK_PAGE.height * 0.6; }
    const radians = settings.angle * Math.PI / 180, c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians));
    const fit = Math.min(1, WATERMARK_PAGE.width * 0.9 / (width * c + height * s), WATERMARK_PAGE.height * 0.9 / (width * s + height * c));
    width *= fit; height *= fit;
    draw = (x, y) => page.drawImage(image, { x, y, width, height, opacity: settings.opacity, rotate: degrees(settings.angle) });
  }
  const radians = settings.angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  draw(WATERMARK_PAGE.width / 2 - (width * c - height * s) / 2,
    WATERMARK_PAGE.height / 2 - (width * s + height * c) / 2);
  const bytes = await pdf.save();
  if (bytes.length > WATERMARK_MAX_BYTES) fail('watermark-image');
  return { bytes, pages: settings.pages };
}
