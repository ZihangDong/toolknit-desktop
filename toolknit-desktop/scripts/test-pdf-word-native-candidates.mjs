import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const scene = { number: 1, width: 300, height: 260, sources: [], items: [], risks: [], characters: 0 };
const assets = [];
function addCandidate(id, symbols, adjust = () => {}) {
  const baseline = 35 + scene.items.length * 32;
  const glyphs = symbols.map((text, index) => ({ id: `${id}-${index}`, text, size: 12, baseline,
    rect: { x: 24 + index * 9, y: baseline - 9, width: 7, height: 9 },
    font: 'Times-Roman', italic: false, bold: false }));
  const item = { id, type: 'image', role: 'math', mathGlyphs: glyphs, mathStrokes: [], reasons: [],
    rect: { x: 24, y: baseline - 9, width: (symbols.length - 1) * 9 + 7, height: 9 },
    size: 12, baseline, sourceIds: glyphs.map(glyph => glyph.id) };
  adjust(item);
  scene.items.push(item);
  scene.sources.push(...glyphs.map(glyph => ({ ...glyph, disposition: 'visible-image' })));
  scene.characters += symbols.join('').length;
  const canvas = createCanvas(Math.ceil(item.rect.width * 2), 24), context = canvas.getContext('2d');
  context.font = '24px "Times New Roman"';
  glyphs.forEach(glyph => context.fillText(glyph.text, (glyph.rect.x - item.rect.x) * 2, 18));
  assets.push({ id, bytes: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height });
}
addCandidate('identity', ['x', '=', 'y', '+', 'z']);
addCandidate('literal', ['=']);
addCandidate('uncertain', ['F'], item => { item.mathGlyphs[0].mathStyleUncertain = true; });
addCandidate('clipped', ['q'], item => { item.reasons = ['partial-clip']; });
addCandidate('unsupported', ['#']);
addCandidate('non-math', ['r'], item => { item.role = 'figure'; });
scene.sources.push({ id: 'hidden', text: 'HIDDEN-SENTINEL', disposition: 'excluded-hidden' });
const document = inferDocument([scene], { preserveGeometry: true }), original = structuredClone(document);
const measurementContext = createCanvas(1, 1).getContext('2d');
const nodes = node => [node, ...(node.elements || []).flatMap(nodes)];
const unpack = async bytes => xml2js(await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'));

for (const continuous of [false, true]) {
  const options = { preserveGeometry: true, continuous, measurementContext };
  const fallback = await createWordBytes(document, assets, options), fallbackNodes = nodes(await unpack(fallback.bytes));
  assert.equal(fallback.quality.nativeFormulas, 0);
  assert.equal(fallback.quality.nativeMathCharacters, 0);
  assert.equal(fallback.quality.editableCharacters, 0);
  assert.equal(fallback.quality.imageCharacters, 10);
  assert.equal(fallbackNodes.filter(node => node.name === 'm:oMath').length, 0);
  assert.equal(fallbackNodes.filter(node => node.name === 'pic:pic').length, 6,
    'the default path preserves every formula/figure image');

  const native = await createWordBytes(document, assets, { ...options, editableMath: true });
  const nativeNodes = nodes(await unpack(native.bytes));
  const formulas = nativeNodes.filter(node => node.name === 'm:oMath');
  assert.equal(formulas.length, 2, 'flat identities and single symbols are actual editable math, not only counted as such');
  assert.deepEqual(formulas.map(formula => nodes(formula).filter(node => node.name === 'm:t')
    .map(node => node.elements?.map(child => child.text || '').join('')).join('').replace(/\s/g, '')), ['x=y+z', '=']);
  assert.equal(nativeNodes.filter(node => node.name === 'pic:pic').length, 4,
    'uncertain styling, clipped input, unsupported tokens and non-math still preserve images');
  assert(!nativeNodes.some(node => node.type === 'text' && node.text.includes('HIDDEN-SENTINEL')));
  assert.equal(native.quality.nativeFormulas, 2);
  assert.equal(native.quality.nativeMathCharacters, 6);
  assert.equal(native.quality.editableCharacters, 6);
  assert.equal(native.quality.imageCharacters, 4);
  assert.equal(native.quality.characters, native.quality.editableCharacters + native.quality.imageCharacters);
  assert.equal(native.quality.characters, fallback.quality.characters);
  assert.equal(native.quality.hiddenCharacters, fallback.quality.hiddenCharacters);
  assert.deepEqual(document, original, 'serialization does not rewrite the source document or its quality counts');
}
console.log('Native formula candidates: actual flat/single-symbol OMML, conservative fallback, default images and source accounting passed.');
