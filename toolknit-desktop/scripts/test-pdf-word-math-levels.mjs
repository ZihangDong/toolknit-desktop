import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';

const glyph = (id, text, x, baseline, size = 12, width = 6, italic = false) => ({ id, text, baseline, size, italic, bold: false,
  font: 'Times-Roman', rect: { x, y: baseline - size * .7, width, height: size * .7 } });
const region = values => ({ id: 'formula', role: 'math', reasons: [], mathGlyphs: values, mathStrokes: [],
  rect: { x: 0, y: 0, width: 100, height: 65 } });
const lower = region([glyph('min', 'min', 10, 30, 12, 18), glyph('index', 'i', 17, 37, 7, 4, true)]);
const lowerAst = inferMathAst(lower);
assert.equal(lowerAst.type, 'limit'); assert.equal(lowerAst.base.sourceId, 'min'); assert.equal(lowerAst.lower.sourceId, 'index');
assert(validateMathEvidence(lowerAst, lower)); assert(validateMathAst(lowerAst, lower));
const falseScript = { type: 'script', base: lowerAst.base, subscript: lowerAst.lower };
assert(!validateMathEvidence(falseScript, lower), 'a centered limit cannot be claimed as an ordinary right-side index');
const side = structuredClone(lower); side.mathGlyphs[1].rect.x = 30;
const sideAst = inferMathAst(side);
assert.equal(sideAst.type, 'script');
assert(!validateMathEvidence(lowerAst, side), 'right-side evidence cannot be moved under an operator');
const upper = region([glyph('max', 'max', 10, 40, 12, 18), glyph('top', 'n', 17, 27, 7, 4, true)]);
assert.equal(inferMathAst(upper).upper.sourceId, 'top');
const both = structuredClone(upper); both.mathGlyphs.push(glyph('bottom', 'i', 17, 47, 7, 4, true));
assert(inferMathAst(both).upper && inferMathAst(both).lower);
for (const mutate of [value => { value.mathGlyphs[1].rect.x = 60; }, value => { value.mathGlyphs[1].size = 12; },
  value => { value.mathGlyphs[0].text = 'unknown'; }]) {
  const changed = structuredClone(lower); mutate(changed);
  assert(!validateMathEvidence(lowerAst, changed), 'a limit needs the original known operator and centered smaller evidence');
}
const competing = structuredClone(lower); competing.mathGlyphs.push(glyph('max', 'max', 14, 30, 12, 18));
assert.equal(inferMathAst(competing), null, 'competing centered owners require review');

const nestedPower = region([glyph('x', 'x', 10, 30, 12, 6, true), glyph('a', 'a', 17, 24, 8, 5, true),
  glyph('b', 'b', 23, 20.3, 5.5, 3, true)]);
const powerAst = inferMathAst(nestedPower);
assert.equal(powerAst.base.sourceId, 'x'); assert.equal(powerAst.superscript.base.sourceId, 'a');
assert.equal(powerAst.superscript.superscript.sourceId, 'b');
const flatPower = { ...powerAst, superscript: { type: 'row', children: [powerAst.superscript.base, powerAst.superscript.superscript] } };
assert(!validateMathAst(flatPower, nestedPower), 'an exponent of the exponent cannot flatten into two letters');
const nestedSubscript = region([glyph('E', 'E', 10, 30, 12, 8), glyph('x', 'x', 19, 33, 8, 4, true),
  glyph('relation', '\u223c', 24, 33, 8, 4),
  { ...glyph('p', 'p', 29, 33, 8, 4.7, true), rect: { x: 29, y: 28.5, width: 4.7, height: 6 } },
  glyph('label', 'data', 34.7, 34.2, 5.5, 12), glyph('plus', '+', 50, 30), glyph('B', 'B', 58, 30)]);
const subAst = inferMathAst(nestedSubscript), expectation = subAst.children[0];
assert.equal(expectation.base.sourceId, 'E');
assert.equal(expectation.subscript.children[2].base.sourceId, 'p');
assert.equal(expectation.subscript.children[2].subscript.sourceId, 'label');
assert.equal(subAst.children[1].sourceId, 'plus', 'a following main-line operator is outside the index');
const descenderDrift = structuredClone(nestedSubscript);
descenderDrift.mathGlyphs[4].baseline = 33.3;
const driftAst = inferMathAst(descenderDrift);
const ownsLabel = node => node && typeof node === 'object' && (node.type === 'script' && node.subscript?.sourceId === 'label'
  || Object.values(node).some(value => value && typeof value === 'object' && (Array.isArray(value) ? value : [value]).some(ownsLabel)));
assert(!ownsLabel(driftAst),
  'a small baseline drift alone does not justify the nested index');
const original = structuredClone(nestedSubscript); inferMathAst(nestedSubscript);
assert.deepEqual(nestedSubscript, original, 'hierarchical assembly cannot mutate source evidence');
for (let count = 0; count < 30; count++) {
  const changed = structuredClone(count % 2 ? nestedPower : lower), scale = .6 + count / 20;
  for (const item of changed.mathGlyphs) {
    item.rect = { x: item.rect.x * scale + 100, y: item.rect.y * scale + 20,
      width: item.rect.width * scale, height: item.rect.height * scale };
    item.baseline = item.baseline * scale + 20; item.size *= scale;
  }
  assert(inferMathAst(changed), 'translated/scaled evidence preserves the structure');
}
const samples = [lower, upper, both, nestedPower, nestedSubscript];
const doc = new Document({ sections: [{ children: samples.map(sample => new Paragraph({
  children: [nativeMath(inferMathAst(sample), sample, { measurementContext: createCanvas(1, 1).getContext('2d') })],
  run: { size: 24 }, spacing: { after: 400 }
})) }] });
const bytes = await Packer.toBuffer(doc), zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml').async('string');
assert.equal((xml.match(/<m:oMath>/g) || []).length, samples.length);
assert.equal((xml.match(/<m:limLow>/g) || []).length, 2); assert.equal((xml.match(/<m:limUpp>/g) || []).length, 2);
assert(!xml.includes('<w:drawing>'));
await mkdir('tmp/pdf-word-math/levels', { recursive: true });
await writeFile('tmp/pdf-word-math/levels/supported-levels.docx', bytes);
console.log('Math levels passed: centered limits, side-index distinction, nested powers/text indices, ambiguity rejection and native OMML.');
