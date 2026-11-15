import assert from 'node:assert/strict';
import { proseFragments } from '../src/features/pdf-to-word/core/prose-fragments.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';

function fixture() {
  return [['Fo', 20, 10], ['r ', 30.5, 3], ['questions regarding this quote, please contact:', 36, 220]].map(([text, x, width], i) =>
    ({ id: 'p1:t' + i, sourceIds: ['p1:t' + i], text, rect: { x, y: 50, width, height: 8 }, baseline: 58,
      size: 10, font: 'Arial', color: '000000', bold: false, italic: true, preciseInk: true, raster: false, order: i }));
}
const text = fixture(), before = structuredClone(text), sources = text.map(item =>
  ({ id: item.id, rect: item.rect, text: item.text, order: item.order, disposition: 'editable' }));
assert.deepEqual([...proseFragments(text)].map(item => item.text), ['Fo', 'r ']);
assert.deepEqual(text, before, 'lexical evidence never rewrites text, fonts or coordinates');
const grouped = groupPageRegions(text, [], [], sources);
assert.equal(grouped.items.filter(item => item.type === 'image').length, 0,
  'splitting an italic prose word into short native commands does not create an uneditable formula image');
assert.equal(sources.filter(source => source.disposition === 'editable').length, 3);
const document = inferDocument([{ number: 1, width: 300, height: 200, items: grouped.items, sources, rules: [], risks: [],
  characters: text.map(item => item.text).join('').replace(/\s/gu, '').length }], { preserveGeometry: true });
const output = await createWordBytes(document, [], { preserveGeometry: true,
  measurementContext: createCanvas(1, 1).getContext('2d') });
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
const exported = [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/gs)].map(match => match[1]).join('');
assert(exported.replace(/\s/gu, '').startsWith('Forquestions'));
assert.equal((xml.match(/<w:drawing>/gu) || []).length, 0);
assert(xml.includes('<w:i/>'));
for (const change of [
  items => { items.forEach(item => { item.font = 'ABCDEF+CMMI10'; }); },
  items => { items[1].baseline -= 3; },
  items => { items[1].size = 6; },
  items => { items[0].text = 'F+'; },
  items => { items[0].text = 'fo'; },
  items => { items[0].text = 'F'; },
  items => { items[1].text = 'r'; },
  items => { items[1].spaceBefore = true; },
  items => { items[1].rect.x += 20; },
  items => { items[2].rect.x += 30; },
  items => { items[2].font = 'Times New Roman'; },
  items => { items[2].text = 'x = 2'; },
  items => { items.pop(); },
  items => { items[0].alphabet = 'script'; },
  items => { items[0].raster = true; },
  items => { items[0].mathStyleUncertain = true; },
]) {
  const value = fixture(); change(value);
  assert.equal(proseFragments(value).size, 0,
    'mathematical/ambiguous fragments cannot be relabeled as prose: ' + change.toString());
}
console.log('Split italic prose: complete lexical boundary, native font/style retention, actual DOCX and mathematical counterexamples passed.');
