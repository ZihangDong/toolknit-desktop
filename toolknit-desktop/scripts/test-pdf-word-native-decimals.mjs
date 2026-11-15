import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import * as evidence from '../src/features/pdf-to-word/core/math-region-evidence.js';
import { planNativeMathRuns } from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const glyph = (id, text, x, y, width, height, size = 11, baseline = 60, italic = false) => ({
  id, sourceIds: [id], text, rect: { x, y, width, height }, size, baseline,
  font: 'ABCDEF+' + (italic ? 'CMMI10' : size === 8 ? 'CMR8' : 'CMR10'),
  italic, bold: false, color: '000000', preciseInk: true, raster: false, order: 0,
});
const beta = glyph('variable', 'β', 30, 52, 6, 9, 11, 60, true);
const index = glyph('index', '1', 37, 57, 3, 5, 8, 62);
const equation = glyph('relation-number', '= 0', 44, 52, 18, 8);
equation.mathGlyphPositions = [
  { text: '=', sourceOffset: 0, rect: { x: 44, y: 56, width: 7, height: 2 }, baseline: 60, baselineX: 44, advanceWidth: 8 },
  { text: '0', sourceOffset: 2, rect: { x: 57, y: 52, width: 5, height: 8 }, baseline: 60, baselineX: 57, advanceWidth: 5.5 },
];
const dot = glyph('point', '.', 64, 59, 1, 1, 11, 60, true);
const digit = glyph('fractional-digit', '9', 67, 52, 5, 8);
const original = [beta, index, equation, dot, digit];
const before = structuredClone(original);
const sources = original.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, order: g.order, disposition: 'editable' }));
const grouped = groupPageRegions(original, [], [], sources, { bounds: { x: 0, y: 0, width: 200, height: 120 } });
const region = grouped.items.find(item => item.sourceIds?.includes('relation-number'));
assert.equal(region?.role, 'math', 'a source-proven decimal point belongs to the equation, rather than making it a picture');
const plan = planNativeMathRuns(region);
assert(plan, 'the complete native relation/number trace must expose the actual subscript owner');
assert.equal(nativeMathReaderMode(plan.ast, plan.region), 'script');
assert.deepEqual(original, before);
assert.equal(plan.ast.children[0].type, 'script');
assert.equal(plan.ast.children[0].base.text, 'β');
assert.equal(plan.ast.children[0].subscript.text, '1');
assert.deepEqual(plan.ast.children.slice(1).map(node => node.text), ['=', '0', '.', '9']);
assert.deepEqual(evidence.nativeDecimalPoints(original), [dot]);

for (const change of [
  a => { a[3].ocr = true; }, a => { a[3].raster = true; },
  a => { a[3].preciseInk = false; }, a => { a[3].font = 'Unknown'; },
  a => { a[3].mathStyleUncertain = true; }, a => { a[3].alphabet = 'script'; },
  a => { a[3].rect.height = 4; }, a => { a[3].baseline -= 4; },
  a => { a[3].rect.width = 6; }, a => { a[3].size = NaN; },
  a => { a[4].baseline += 1; }, a => { a[4].size += 1; },
  a => { a[4].font = 'GHIJKL+CMR10'; }, a => { a[4].text = 'a'; },
  a => { a[4].text = '1234567'; }, a => { a[4].italic = true; },
  a => { a[4].rect.x += 15; }, a => { a[4].color = 'ff0000'; },
  a => { a[3].rect = null; }, a => { a[3].delimiterPart = true; },
  a => { a[3].rect.width = 0; a[3].rect.height = 0; },
]) {
  const changed = structuredClone(original); change(changed);
  assert.deepEqual(evidence.nativeDecimalPoints(changed), [], 'ambiguous punctuation or unsupported source evidence stays outside mathematics');
}
const competitor = { ...digit, id: 'ambiguous', rect: { ...digit.rect, x: digit.rect.x + .1 } };
assert.deepEqual(evidence.nativeDecimalPoints([...original, competitor]), []);
const dense = Array.from({ length: 150 }, (_, i) => ({ ...digit, id: 'dense' + i, rect: { ...digit.rect } }));
const dots = Array.from({ length: 80 }, (_, i) => ({ ...dot, id: 'dot' + i, rect: { ...dot.rect } }));
assert.deepEqual(evidence.nativeDecimalPoints([...original, ...dense, ...dots]), [], 'exhausted work never leaves partial decimal ownership');
assert.deepEqual(evidence.nativeDecimalPoints(null), []);

const page = { number: 1, width: 200, height: 120, items: grouped.items, sources, rules: [], risks: grouped.risks, characters: 7 };
const document = inferDocument([page], { preserveGeometry: true });
const result = await createWordBytes(document, [], { preserveGeometry: true, editableMath: true,
  strictMathGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert.equal(result.quality.nativeFormulas, 1);
assert.equal((xml.match(/<m:oMath[ >]/g) || []).length, 1);
assert(xml.includes('<m:sSub>') && xml.includes('>β</m:t>') && xml.includes('>9</m:t>'));
assert(!xml.includes('<w:drawing'));
console.log('Native decimals: independent point ownership, exact traced relation/index, ambiguity/budget refusal and actual editable OMML passed.');
