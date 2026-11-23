import { EDIT_FONTS, OCR_EDIT_LIMITS, editError, rotatedSize } from './core.js';
export async function ensureEditFonts() {
  if (!document.fonts) return;
  try {
    const faces = await document.fonts.load('16px "ToolKnit OCR Sans"');
    if (!faces.length || faces.some(face => face.status !== 'loaded') || !document.fonts.check('16px "ToolKnit OCR Sans"')) throw editError('font');
  } catch { throw editError('font'); }
}
function linesFor(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && context.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
export function layoutRegion(context, region) {
  context.font = `${region.size}px ${EDIT_FONTS[region.font]}`;
  const lines = linesFor(context, region.text, region.width), lineHeight = region.size * 1.2;
  const textWidth = Math.max(0,...lines.map(line => context.measureText(line).width)), textHeight = region.text ? lines.length * lineHeight : 0;
  const radians = region.angle * Math.PI / 180, cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const overflow = !!region.text && (textWidth * cos + textHeight * sin > region.width + .5 || textWidth * sin + textHeight * cos > region.height + .5);
  return { lines, lineHeight, textWidth, textHeight, overflow };
}
export function replacementLayout(context, region) {
  const layout = layoutRegion(context, region);
  const x = region.angle ? -layout.textWidth / 2 : -region.width / 2;
  const y = region.angle ? -layout.textHeight / 2 : -region.height / 2;
  return { ...layout, x, y };
}
/** Every preview/export starts from immutable pixels, so editing never compounds erasure. */
export function renderEditedPage(page, { original = false, makeCanvas = () => document.createElement('canvas') } = {}) {
  const canvas = makeCanvas(), { width, height } = rotatedSize(page.source.width, page.source.height, page.rotation);
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw editError('encode');
  context.fillStyle = '#ffffff'; context.fillRect(0,0,width,height);
  context.save();
  if (page.rotation === 90) { context.translate(width,0); context.rotate(Math.PI / 2); }
  else if (page.rotation === 180) { context.translate(width,height); context.rotate(Math.PI); }
  else if (page.rotation === 270) { context.translate(0,height); context.rotate(-Math.PI / 2); }
  context.drawImage(page.source,0,0);
  if (!original) for (const region of page.regions.filter(region => region.edited)) {
    // Erase the full original rectangle before clipping / rotating replacement glyphs.
    context.fillStyle = region.background; context.fillRect(region.x,region.y,region.width,region.height);
    context.save(); context.beginPath(); context.rect(region.x,region.y,region.width,region.height); context.clip();
    context.translate(region.x + region.width / 2,region.y + region.height / 2); context.rotate(region.angle * Math.PI / 180);
    const layout = replacementLayout(context, region); context.fillStyle = region.foreground; context.textBaseline = 'top';
    layout.lines.forEach((line, i) => context.fillText(line, layout.x, layout.y + i * layout.lineHeight)); context.restore();
  }
  context.restore(); return canvas;
}
export function canvasPng(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(editError('encode')), 'image/png')); }
export async function exportEditedPdf(pages, { searchable = false, check = () => {}, progress = () => {} } = {}) {
  const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.create();
  let layer;
  if (searchable) {
    const { createSearchableLayer } = await import('./text-layer.js');
    check();
    layer = await createSearchableLayer(pdf, pages, { check, replacementLayout });
  }
  for (let index = 0; index < pages.length; index++) {
    check(); const canvas = renderEditedPage(pages[index]);
    try {
      const blob = await canvasPng(canvas); check(); const image = await pdf.embedPng(await blob.arrayBuffer());
      const sheet = pdf.addPage([canvas.width * .5,canvas.height * .5]); sheet.drawImage(image,{ x:0,y:0,width:sheet.getWidth(),height:sheet.getHeight() });
      layer?.write(sheet, index);
    } finally { canvas.width = canvas.height = 1; }
    progress((index + 1) / pages.length * 85); await new Promise(resolve => setTimeout(resolve,0));
  }
  check(); const bytes = await pdf.save(); check(); if (bytes.length > OCR_EDIT_LIMITS.outputBytes) throw editError('output'); return bytes;
}
