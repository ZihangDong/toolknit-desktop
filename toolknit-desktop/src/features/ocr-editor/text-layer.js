import {
  beginText, endText, popGraphicsState, pushGraphicsState, setFontAndSize,
  setTextMatrix, setTextRenderingMode, showText, TextRenderingMode,
} from 'pdf-lib';
import fontkit from '../../pdf-lib-fontkit.js';
import { editError } from './core.js';

const TEXT_LIMIT = 200000;
const POINTS_PER_PIXEL = 0.5;
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
const cleanText = text => text.replace(/[^\S\r\n]+/gu, ' ').trim();

function visibleRegions(regions) {
  const covers = regions.filter(region => region.edited);
  const zOrder = new Map(covers.map((region, index) => [region, index]));
  // Even a partial cover makes the old OCR string unreliable as a whole.
  const visible = regions.filter(region => region.text.trim() &&
    !covers.some((cover, index) => index > (zOrder.get(region) ?? -1) && intersects(region, cover)));
  visible.sort((a, b) => a.y - b.y || a.x - b.x);

  // Group boxes whose vertical spans share the upper half of a row, then read left to right.
  for (let first = 0; first < visible.length;) {
    const anchor = visible[first];
    let end = first + 1;
    while (end < visible.length && visible[end].y - anchor.y < Math.min(anchor.height, visible[end].height) / 2) end++;
    const row = visible.slice(first, end).sort((a, b) => a.x - b.x || a.y - b.y);
    row.forEach((region, index) => { visible[first + index] = region; });
    first = end;
  }
  return visible;
}

function textRuns(page, replacementLayout) {
  const context = page.source.getContext('2d');
  const runs = [];
  for (const region of visibleRegions(page.regions)) {
    if (!region.edited) {
      const text = cleanText(region.text.replace(/[\r\n]+/g, ' '));
      runs.push({ text, x: region.x, y: region.y, width: region.width, height: region.height, angle: 0 });
      continue;
    }
    const layout = replacementLayout(context, region);
    const angle = region.angle * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const [index, line] of layout.lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const width = context.measureText(trimmed).width;
      const leading = line.slice(0, line.length - line.trimStart().length);
      const x = layout.x + context.measureText(leading).width;
      const y = layout.y + index * layout.lineHeight;
      runs.push({ text: cleanText(trimmed), width, height: layout.lineHeight, angle,
        x: region.x + region.width / 2 + x * cos - y * sin,
        y: region.y + region.height / 2 + x * sin + y * cos });
    }
  }
  return runs;
}

function pdfPoint(source, rotation, x, y) {
  const p = POINTS_PER_PIXEL;
  switch (rotation) {
    case 90: return [(source.height - y) * p, (source.width - x) * p];
    case 180: return [(source.width - x) * p, y * p];
    case 270: return [y * p, x * p];
    default: return [x * p, (source.height - y) * p];
  }
}

export async function createSearchableLayer(pdf, pages, { check, replacementLayout }) {
  const pageRuns = [];
  let count = 0;
  for (const page of pages) {
    check();
    const runs = textRuns(page, replacementLayout);
    count += runs.reduce((sum, run) => sum + run.text.length, 0);
    if (count > TEXT_LIMIT) throw editError('layer-limit');
    pageRuns.push(runs);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!count) throw editError('layer-empty');

  let font;
  try {
    const response = await fetch('/assets/fonts/NotoSansSC-Regular.ttf');
    if (!response.ok) throw new Error('OCR font asset unavailable');
    const bytes = await response.arrayBuffer();
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(bytes, { subset: true, features: { liga: false, clig: false } });
  } catch {
    throw editError('layer-font');
  }
  check();
  const supported = new Set(font.getCharacterSet());
  const fontHeight = font.heightAtSize(1);
  const ascent = font.heightAtSize(1, { descender: false });
  for (const runs of pageRuns) {
    check();
    for (const run of runs) {
      for (const char of run.text) {
        if (!supported.has(char.codePointAt(0))) throw editError('layer-glyph');
      }
    }
  }
  return {
    write(sheet, index) {
      const runs = pageRuns[index];
      if (!runs.length) return;
      const { source, rotation } = pages[index];
      const fontKey = sheet.node.newFontDictionary(font.name, font.ref);
      sheet.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(fontKey, 1),
        setTextRenderingMode(TextRenderingMode.Invisible));
      for (const { text, x, y, width, height, angle } of runs) {
        const advance = font.widthOfTextAtSize(text, 1);
        if (advance <= 0 || width <= 0) throw editError('layer-glyph');
        const baseline = height * ascent / fontHeight;
        const [tx, ty] = pdfPoint(source, rotation, x - Math.sin(angle) * baseline, y + Math.cos(angle) * baseline);
        const radians = angle + rotation * Math.PI / 180;
        const cos = Math.cos(radians), sin = Math.sin(radians);
        const sx = width * POINTS_PER_PIXEL / advance;
        const sy = height * POINTS_PER_PIXEL / fontHeight;
        sheet.pushOperators(setTextMatrix(cos * sx, -sin * sx, sin * sy, cos * sy, tx, ty),
          showText(font.encodeText(text)));
      }
      sheet.pushOperators(endText(), popGraphicsState());
    }
  };
}
