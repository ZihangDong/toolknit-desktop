import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { fitOcrNumericLabel } from '../src/features/pdf-to-word/core/ocr-numeric-label.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';

const canvas = (width, height) => createCanvas(width, height);
const fit = createOcrTypography(canvas);
function fixture(text = '-3-', face = 'SimSun') {
  const source = canvas(500, 150), context = source.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = 'black'; context.font = `42px "${face}"`; context.fontKerning = 'none';
  const boxes = [];
  for (const [i, char] of [...text].entries()) {
    const x = 20 + i * 21; context.fillText(char, x, 90);
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    let left = source.width, top = source.height, right = 0, bottom = 0;
    for (let y = 0; y < source.height; y++) for (let xx = x - 1; xx < x + 21; xx++)
      if (pixels[(y * source.width + xx) * 4] < 180) {
        left = Math.min(left, xx); top = Math.min(top, y); right = Math.max(right, xx + 1); bottom = Math.max(bottom, y + 1);
      }
    assert(right > left && bottom > top); boxes.push({ left, top, right, bottom });
  }
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const x = Math.min(...boxes.map(box => box.left)), y = Math.min(...boxes.map(box => box.top));
  const right = Math.max(...boxes.map(box => box.right)), bottom = Math.max(...boxes.map(box => box.bottom));
  const tight = { x: x / 3, y: y / 3, width: (right - x) / 3, height: (bottom - y) / 3 };
  const center = box => (box.left + box.right) / 2;
  const words = [...text].map((text, i) => ({ text, confidence: .999, width: 2,
    x: (i === 0 ? center(boxes[1]) - 7 : i === boxes.length - 1 ? center(boxes[i - 1]) + 7 : center(boxes[i])) - 1,
    y, height: bottom - y }));
  return { boxes, options: { line: { text, confidence: .8, words }, tight, pixels, width: source.width, height: source.height,
    sx: 3, sy: 3, inkAt: (x, y) => pixels[(y * source.width + x) * 4] < 220,
    allowLineFit: true, allowSymbolCorrection: true, allowSingleNumeric: true, lineFitBudget: { remaining: 4_000_000 } } };
}

for (const text of ['-3-', '-4-', '-10-']) {
  const { options, boxes } = fixture(text), before = options.pixels.slice(), budgetBefore = options.lineFitBudget.remaining;
  const result = fit(options);
  if (!result?.ocrLineTypography) console.log(JSON.stringify({ numericFixture: text,
    result, expectedInk: boxes, lineFitBudget: options.lineFitBudget }));
  assert.equal(result?.words?.length, text.length, `${text}: isolated complete numeric ink survives displaced narrow CTC cells`);
  assert.equal(result.words.map(word => word.text).join(''), text);
  for (const [i, word] of result.words.entries()) {
    const box = boxes[i];
    assert.deepEqual(word.rect, { x: box.left / 3, y: box.top / 3, width: (box.right - box.left) / 3, height: (box.bottom - box.top) / 3 });
    assert.equal(word.confidence, .999); assert(word.size >= 4 && word.size <= 120);
  }
  assert.deepEqual(options.pixels, before, 'the proposal never edits source pixels');
  assert(options.lineFitBudget.remaining >= 0 && options.lineFitBudget.remaining <= budgetBefore);
  if(result.ocrLineTypography)assert(options.lineFitBudget.remaining < budgetBefore);
  const item = { id: 'p1:label', type: 'text', text, ...result, rect: options.tight,
    sourceIds: ['p1:label'], ocr: true, preciseInk: true, raster: false, color: '000000' };
  const document = inferDocument([{ number: 1, width: 300, height: 200, items: [item], rules: [], risks: [],
    characters: text.length, sources: [{ id: item.id, text, rect: item.rect, disposition: 'editable' }] }], { preserveGeometry: true });
  const measureContext = canvas(1, 1).getContext('2d');
  const measure = (text, style) => measureResultText(text, style, measureContext);
  measure.metrics = (text, style) => measureResultText.metrics(text, style, measureContext);
  const target = resultTargets(document.pages[0]).find(target => target.type === 'text');
  assert(target); assert.deepEqual(layoutEditedText(target, target.text, measure, { page: document.pages[0] }), { type: 'noop' });
  const edited = applyResultEdits(document, { [target.key]: layoutEditedText(target, target.text.replace(/-$/, '0-'), measure, { page: document.pages[0] }) });
  const packed = await createWordBytes(edited, [], { preserveGeometry: true, measurementContext: measureContext });
  const zip = await JSZip.loadAsync(packed.bytes);
  const xml = await zip.file('word/document.xml').async('string');
  assert(xml.includes('0'), 'the added digit is emitted as editable Word text');
  for (const word of result.words) assert(xml.includes(`w:val="${Math.round(word.size * 2)}"`), 'the original mixed run sizes remain in Word output');
}

const rejected = options => assert.notEqual(fit(options)?.ocrLineTypography, true);
{
  const { options } = fixture();
  rejected({ ...options, line: { ...options.line, text: '-8-', words: options.line.words.map((word, i) => i === 1 ? { ...word, text: '8' } : word) } });
  rejected({ ...options, line: { ...options.line, words: options.line.words.map((word, i) => i === 1 ? { ...word, confidence: .8 } : word) } });
  rejected({ ...options, lineFitBudget: { remaining: 0 } });
  const extra = options.pixels.slice(), x = Math.round(options.tight.x * 3) + 30, y = Math.round(options.tight.y * 3) + 3;
  assert(extra[(y * options.width + x) * 4] > 235, 'the negative fixture adds a genuinely separate dark mark');
  extra.set([0, 0, 0, 255], (y * options.width + x) * 4);
  rejected({ ...options, pixels: extra, inkAt: (x, y) => extra[(y * options.width + x) * 4] < 220 });
}
{
  const { options } = fixture();
  const direct = { ...options, budget: { remaining: 0 }, fonts: ['Arial'], weights: [false],
    glyph: () => assert.fail('exhausted or malformed proposals cannot allocate a font'), normalized: () => {}, similarity: () => 1 };
  assert.equal(fitOcrNumericLabel(direct), null);
  assert.equal(fitOcrNumericLabel({ ...direct, budget: { remaining: 100000 }, width: NaN }), null);
  assert.equal(fitOcrNumericLabel({ ...direct, budget: { remaining: 100000 }, line: { ...options.line, words: [] } }), null);
  assert.equal(fitOcrNumericLabel({ ...direct, budget: { remaining: 100000 }, line: { ...options.line,
    words: options.line.words.map((word, i) => ({ ...word, text: ['-', '3-', ''][i] })) } }), null);
}
console.log('Numeric OCR labels: complete ink/CTC attribution, source preservation, edit/DOCX, punctuation/shape/confidence and bounded work passed.');
