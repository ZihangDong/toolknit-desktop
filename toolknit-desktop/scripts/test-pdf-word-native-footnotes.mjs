import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import * as evidence from '../src/features/pdf-to-word/core/math-region-evidence.js';
import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const glyph = (id, text, x, y, width, height, size, baseline, font, italic = false, color = '000000') => ({
  id, sourceIds: [id], text, rect: { x, y, width, height }, size, baseline, font, italic, color,
  preciseInk: true, raster: false, bold: false, order: 1,
});
const letter = glyph('variable', 'A', 40, 50, 7.5, 8, 11, 58, 'ABCDEF+CMMI10', true);
const period = glyph('sentence-end', '.', 49, 57, 1, 1, 11, 58, 'GHIJKL+NimbusRomNo9L-Regu');
const marker = glyph('footnote', '3', 52, 49, 3.2, 5.5, 8, 54, 'GHIJKL+NimbusRomNo9L-Regu', false, '000080');
const original = [letter, period, marker], before = structuredClone(original);
const sources = original.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, order: 1, disposition: 'editable' }));
const grouped = groupPageRegions(original, [], [], sources, { bounds: { x: 0, y: 0, width: 200, height: 100 } });
assert.equal(sources.find(g => g.id === marker.id).disposition, 'editable',
  'a raised reference after a proven sentence stop is not the preceding variable\'s mathematical power');
assert.deepEqual(evidence.nativeFootnoteMarkers(original), new Set([marker]));
const scene = { number: 1, width: 200, height: 100, items: grouped.items, sources, rules: [], risks: grouped.risks, characters: 3 };
const context = createCanvas(1, 1).getContext('2d');
recoverMathLetters(scene, context);
assert(scene.items.every(g => g.type === 'text'));
const restored = scene.items.find(g => g.id === marker.id);
assert.equal(restored.color, marker.color);
assert.equal(restored.size, marker.size);
assert.equal(restored.baseline, marker.baseline);
assert.deepEqual(original, before);

for (const change of [
  a => { a.splice(1, 1); }, a => { a[1].text = ','; },
  a => { a[1].font = 'Unknown'; }, a => { a[1].italic = true; },
  a => { a[1].rect.x = 60; }, a => { a[1].rect.height = 5; },
  a => { a[1].baseline += 1; }, a => { a[0].font = 'Unknown'; },
  a => { a[0].text = '0'; }, a => { a[0].italic = false; },
  a => { a[2].baseline = 58; }, a => { a[2].baseline = 61; },
  a => { a[2].size = 11; }, a => { a[2].rect.x = 45; },
  a => { a[2].text = '1234'; }, a => { a[2].italic = true; },
  a => { a[2].raster = true; }, a => { a[2].ocr = true; },
  a => { a[2].preciseInk = false; }, a => { a[2].mathStyleUncertain = true; },
  a => { a[2].color = 'unknown'; }, a => { a[2].rect.width = NaN; },
  a => { a[0].radicalPart = true; },
]) {
  const changed = structuredClone(original); change(changed);
  assert.equal(evidence.nativeFootnoteMarkers(changed).size, 0, 'actual powers, decimal notation and uncertain sources retain existing math ownership');
}
const competing = { ...marker, id: 'competing', rect: { ...marker.rect, x: marker.rect.x + .1 } };
assert.equal(evidence.nativeFootnoteMarkers([...original, competing]).size, 0);
const dense = Array.from({ length: 200 }, (_, i) => ({ ...marker, id: 'dense' + i, rect: { ...marker.rect } }));
assert.equal(evidence.nativeFootnoteMarkers([...original, ...dense]).size, 0);
assert.equal(evidence.nativeFootnoteMarkers(null).size, 0);

const document = inferDocument([scene], { preserveGeometry: true });
const result = await createWordBytes(document, [], { preserveGeometry: true, editableMath: true,
  strictMathGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert(!xml.includes('<w:drawing') && !xml.includes('<m:oMath'));
assert(xml.includes('w:color w:val="000080"') && xml.includes('>3</w:t>'));
console.log('Native sentence footnotes: punctuation ownership, blue marker/font/size/baseline, real powers, ambiguity/budget refusal and editable DOCX passed.');
