export const OCR_EDIT_LIMITS = Object.freeze({ inputBytes: 24 * 1024 * 1024, pages: 20, pagePixels: 12_000_000, totalPixels: 48_000_000, side: 12000, regions: 1000, text: 2000, outputBytes: 128 * 1024 * 1024 });
export const EDIT_FONTS = Object.freeze({ sans: '"ToolKnit OCR Sans", sans-serif', serif: '"SimSun", "Songti SC", serif', mono: '"Consolas", monospace' });
export const editError = code => {
  const error = new Error(`ocr-edit:${code}`);
  if (code === 'cancelled') { error.name = 'AbortError'; error.code = 'CANCELLED'; }
  return error;
};
export function validateEditInput(file) {
  if (!/\.(png|jpe?g|webp|bmp|pdf)$/i.test(file?.name || '')) throw editError('type');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > OCR_EDIT_LIMITS.inputBytes) throw editError('size');
}
export function validateEditDimensions(width, height, total = 0) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= OCR_EDIT_LIMITS.side) || width * height > OCR_EDIT_LIMITS.pagePixels || total + width * height > OCR_EDIT_LIMITS.totalPixels) throw editError('pixels');
}
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export function normalizeRegion(input, width, height) {
  const x = Number(input.x), y = Number(input.y), w = Number(input.width), h = Number(input.height), angle = Number(input.angle || 0);
  if (![x,y,w,h,angle].every(Number.isFinite) || w < 2 || h < 2 || x < 0 || y < 0 || x + w > width + .01 || y + h > height + .01 || Math.abs(angle) > 180) throw editError('geometry');
  const text = String(input.text ?? ''); if (text.length > OCR_EDIT_LIMITS.text) throw editError('text');
  if (input.edited && !text.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}]/gu, '')) throw editError('empty-replacement');
  const size = Number(input.size ?? h * .8); if (!Number.isFinite(size) || size < 4 || size > 600) throw editError('font');
  return { id: String(input.id || crypto.randomUUID()), original: String(input.original ?? text), x,y,width:w,height:h, angle,
    text, size, font: Object.hasOwn(EDIT_FONTS, input.font) ? input.font : 'sans', foreground: color(input.foreground, '#111111'), background: color(input.background, '#ffffff'), edited: !!input.edited };
}
export function regionsFromOcr(result, width, height) {
  if (!result || !Array.isArray(result.lines) || result.lines.length > OCR_EDIT_LIMITS.regions || !(result.width > 0) || !(result.height > 0)) throw editError('result');
  const sx = width / result.width, sy = height / result.height;
  try { return result.lines.map((line, index) => {
    const x = Math.max(0, Number(line.x) * sx), y = Math.max(0, Number(line.y) * sy);
    return normalizeRegion({ ...line, id: `ocr-${index}`, x, y, width: Math.min(width - x, line.width * sx), height: Math.min(height - y, line.height * sy), size: Math.min(600, Math.max(4, line.height * sy * .8)), edited: false }, width, height);
  }); } catch { throw editError('result'); }
}
export function rotatedSize(width, height, rotation) { return rotation % 180 ? { width: height, height: width } : { width, height }; }
export function rotateRect(box, width, height, rotation) {
  switch ((rotation % 360 + 360) % 360) {
    case 90: return { x: height - box.y - box.height, y: box.x, width: box.height, height: box.width };
    case 180: return { x: width - box.x - box.width, y: height - box.y - box.height, width: box.width, height: box.height };
    case 270: return { x: box.y, y: width - box.x - box.width, width: box.height, height: box.width };
    default: return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
}
/** Snapshots hold edit metadata only; the immutable source pixels are shared. */
export function createEditHistory(initial, limit = 40) {
  let entries = [JSON.stringify(initial)], at = 0;
  return { push(value) { const next = JSON.stringify(value); if (next === entries[at]) return; entries = entries.slice(0, at + 1); entries.push(next); if (entries.length > limit) entries.shift(); at = entries.length - 1; },
    undo() { if (at > 0) at--; return JSON.parse(entries[at]); }, redo() { if (at < entries.length - 1) at++; return JSON.parse(entries[at]); }, get canUndo() { return at > 0; }, get canRedo() { return at < entries.length - 1; } };
}
export function editOutputName(name, extension, page) { return `${String(name).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,100).replace(/[. ]+$/, '') || 'scan'}-edited${page ? `-${page}` : ''}.${extension}`; }
