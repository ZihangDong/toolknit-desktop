import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const nodes = node => [node, ...(node.elements || []).flatMap(nodes)];
const measurementContext = { measureText(text) { return { width: [...text].length * 1000, actualBoundingBoxLeft: 0,
  actualBoundingBoxAscent: 800, fontBoundingBoxAscent: 900, fontBoundingBoxDescent: 200 }; } };
async function convert(parts, font = 'SimSun') {
  const items = parts.map(([text, x, spaceBefore], index) => ({ id: `g${index}`, sourceIds: [`g${index}`], type: 'text',
    text, size: 10, baseline: 30, baselineX: x, rect: { x, y: 22, width: [...text].length * 10, height: 10 },
    advanceWidth: [...text].length * 10, preciseInk: true, font, color: '000000', spaceBefore, order: index }));
  const original = structuredClone(items);
  const scene = { number: 1, width: 500, height: 100, items, risks: [], rasterPage: false,
    sources: items.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: item.order, disposition: 'editable' })) };
  const layout = inferDocument([scene], { preserveGeometry: true, pageModes: { 1: 'single' } });
  const output = await createWordBytes(layout, [], { preserveGeometry: true, measurementContext });
  assert.deepEqual(items, original, 'spacing correction cannot change source text, positions or word boundaries');
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  const all = nodes(xml2js(xml, { captureSpacesBetweenElements: true }));
  const text = all.filter(node => node.name === 'w:t').map(node => node.elements?.map(item => item.text || '').join('') || '').join('');
  return { text, all };
}

const cjk = await convert([['\u7532', 10], ['\u4e59', 20.2], ['\u4e19', 30.4]]);
assert.equal(cjk.text, '\u7532\u4e59\u4e19', 'small inter-glyph placements do not become artificial space characters');
const advances = cjk.all.filter(node => node.name === 'w:r').filter(run => nodes(run).some(node => node.name === 'w:t'
  && node.elements?.some(child => child.type === 'text' && child.text.length)));
assert.equal(advances.length, 3);
assert.equal(nodes(advances[0]).find(node => node.name === 'w:spacing').attributes['w:val'], '4');
assert.equal(nodes(advances[1]).find(node => node.name === 'w:spacing').attributes['w:val'], '4');
const explicit = await convert([['A', 10], ['B', 20.2, true]]);
assert.equal(explicit.text, 'A B', 'an explicit source word boundary survives even when the gap is small');
const distant = await convert([['A', 10], ['B', 25]]);
assert.equal(distant.text, 'A B', 'a word-sized gap remains a real editable space');
const words = await convert([['word', 10], ['next', 50.2]]);
assert.equal(words.text, 'word next', 'word runs are not stretched to absorb their trailing gaps');
const tight = await convert([['A', 10], ['B', 19.8]]);
assert.equal(tight.text, 'AB', 'overlapping advances retain the existing bounded condensation path');
for (const [requested, serialized] of [['KaiTi', '\u6977\u4f53'], ['FangSong', '\u4eff\u5b8b']]) {
  const result = await convert([['\u7532', 10], ['\u4e59', 20]], requested);
  assert.equal(result.text, '\u7532\u4e59');
  const faces = result.all.filter(node => node.name === 'w:rFonts').map(node => node.attributes);
  assert(faces.some(face => face['w:ascii'] === serialized && face['w:eastAsia'] === serialized && face['w:hAnsi'] === serialized));
  assert(!faces.some(face => Object.values(face).includes(requested)), 'serialized font uses the reader-compatible name');
  assert(measurementContext.font.endsWith(`"${requested}"`), 'font aliasing does not change the measurement family');
}
console.log('PDF Word text spacing checks passed: contiguous glyphs, explicit/large word gaps, source immutability and measured/serialized CJK font aliases.');
