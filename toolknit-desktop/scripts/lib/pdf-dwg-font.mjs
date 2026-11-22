// Only the repository's OFL font is redistributed. PDF font programs are read
// for metrics only; they are never copied to the CAD output.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';

export const CAD_FONT_FILE = 'NotoSansSC-Regular.ttf';
export const CAD_FONT_LICENSE = 'NOTO-SANS-SC-OFL.txt';
const sourceRoot = new URL('../../public/assets/fonts/', import.meta.url);
let fontPromise;
const failure = (code, detail = '') => Object.assign(new Error(`pdf-dwg:${code}${detail ? ': ' + detail : ''}`), { code });

export function loadCadFont() {
  return fontPromise ||= (async () => {
    const bytes = await readFile(new URL(CAD_FONT_FILE, sourceRoot));
    const license = await readFile(new URL(CAD_FONT_LICENSE, sourceRoot));
    const font = fontkit.create(new Uint8Array(bytes));
    // A classic TrueType glyf/cmap font, not a renamed CFF/variable program.
    if (bytes.readUInt32BE(0) !== 0x00010000 || !font.directory.tables.glyf || !font.directory.tables.cmap || font.directory.tables.fvar) throw failure('cad-font-format');
    if (!(font.capHeight > 0 && font.capHeight <= font.unitsPerEm * 2)) throw failure('cad-font-metrics');
    const metadata = { file: CAD_FONT_FILE, licenseFile: CAD_FONT_LICENSE, family: font.familyName,
      fullName: font.fullName, postscriptName: font.postscriptName, capHeight: font.capHeight, unitsPerEm: font.unitsPerEm,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source: 'bundled-OFL-font', license: 'OFL-1.1' };
    return { font, bytes, license, metadata };
  })();
}

// Standard-14 cap heights (AFM units / 1000). Ascender != cap height: using
// the ascent of an arbitrary CJK font would noticeably enlarge CAD text.
const standardCaps = new Map([
  ['Helvetica', .718], ['Helvetica-Bold', .718], ['Helvetica-Oblique', .718], ['Helvetica-BoldOblique', .718],
  ['Times-Roman', .662], ['Times-Bold', .676], ['Times-Italic', .653], ['Times-BoldItalic', .669],
  ['Courier', .562], ['Courier-Bold', .562], ['Courier-Oblique', .562], ['Courier-BoldOblique', .562],
]);

export function sourceCapHeight(page, fontName, cache) {
  if (cache.has(fontName)) return cache.get(fontName);
  let result = null;
  try {
    const face = page.commonObjs.get(fontName);
    if (face.data?.length && face.data.length <= 20 * 1024 * 1024) {
      const parsed = fontkit.create(face.data);
      const ratio = parsed.capHeight / parsed.unitsPerEm;
      if (Number.isFinite(ratio) && ratio >= .2 && ratio <= 2) result = { ratio, method: 'embedded-cap-height' };
    }
    if (!result && standardCaps.has(face.name)) result = { ratio: standardCaps.get(face.name), method: 'standard-14-cap-height' };
  } catch { /* A missing metric is surfaced as an explicit fallback notice. */ }
  result ||= { ratio: null, method: 'fallback-cap-height' };
  cache.set(fontName, result);
  return result;
}

export async function applyCadFont(plan, check = () => {}) {
  const texts = plan.geometry.filter(item => item.type === 'TEXT');
  if (!texts.length) return null;
  const bundle = await loadCadFont(); check();
  const missing = new Set();
  for (const item of texts) {
    check();
    let advance = 0;
    for (const character of item.value) {
      const code = character.codePointAt(0);
      if (!bundle.font.hasGlyphForCodePoint(code) || bundle.font.glyphForCodePoint(code).id === 0) missing.add('U+' + code.toString(16).toUpperCase());
      else advance += bundle.font.glyphForCodePoint(code).advanceWidth;
    }
    if (missing.size) continue;
    const ratio = item.capRatio ?? bundle.font.capHeight / bundle.font.unitsPerEm;
    item.height = item.emHeight * ratio;
    if (!(Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0)) throw failure('text-metrics');
    // CAD TEXT height is cap height. Use unshaped TrueType advances for ordinary
    // editable TEXT, then calibrate the width factor to the PDF run's advance.
    // Do not use FIT: renderers can fit ink bounds rather than advances and shift
    // the first/last glyph bearings, visibly changing a same-font source.
    item.widthFactor = item.width / (advance * item.height / bundle.font.capHeight);
    if (!Number.isFinite(item.widthFactor) || item.widthFactor < .01 || item.widthFactor > 100) throw failure('text-width-factor');
  }
  if (missing.size) throw failure('missing-font-glyph', [...missing].slice(0, 16).join(', '));
  plan.font = bundle.metadata;
  if (texts.some(item => item.capMethod === 'fallback-cap-height')) plan.notices.push('source-cap-height-approximation');
  return bundle;
}

export async function writeCadFontBundle(directory, bundle) {
  await writeFile(path.join(directory, CAD_FONT_FILE), bundle.bytes, { flag: 'wx' });
  await writeFile(path.join(directory, CAD_FONT_LICENSE), bundle.license, { flag: 'wx' });
  await writeFile(path.join(directory, 'FONT-README.txt'), [
    '本目录的 DWG 文字样式引用随附的 NotoSansSC-Regular.ttf。请连同字体文件一起保留 / 传递。',
    'DWG 本身不嵌入 TrueType 字体。CAD 若未识别该字体，请先安装此字体，或在 CAD 中为 PDF_PORTABLE 样式选择此字体。',
    '可编辑 TEXT 使用左对齐、换算后的大写字高和按源 PDF 文字宽度校准的宽度因子。替代字体的笔形仍可能与源字体不同。',
    '字符覆盖已在导出前检查；不支持的字符会明确失败，不生成缺字方框结果。',
    '本字体原样复制，实际内嵌名称为 ' + bundle.metadata.fullName + '；文件名不代表其字重。',
    '字体版权、保留名称及许可见 ' + CAD_FONT_LICENSE + '。未复制任何 PDF 内嵌字体程序，也未更改系统字体设置。',
  ].join('\r\n') + '\r\n', { flag: 'wx' });
}
