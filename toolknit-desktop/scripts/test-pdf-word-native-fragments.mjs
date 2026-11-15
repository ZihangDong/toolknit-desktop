import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

// Source geometry from an ordinary native function split across CMR/CMMI runs.
// This tests provenance/ownership, not recognition or a complete paper's score.
const context = createCanvas(1, 1).getContext('2d');
const fragmentId = 'native-fragment';
function fixture() {
  const baseline = 554.252, size = 9.9626, color = '000000';
  const peer = { id: 'native-function', type: 'text', sourceIds: ['native-function'], text: 'Sublayer(',
    rect: { x: 267.5369, y: 546.78, width: 40.12437, height: 9.9626 }, baseline, size, color,
    font: 'ABCDEF+CMR10', preciseInk: true, raster: false, bold: false, italic: false, order: 1 };
  const glyphs = [{ id: 'native-x', text: 'x', italic: true, font: 'ABCDEF+CMMI10', rect: { x: 308.5299, y: 549.8485, width: 4.96137, height: 4.51306 } },
    { id: 'native-close', text: ')', italic: false, font: 'ABCDEF+CMR10', rect: { x: 314.5029, y: 546.78, width: 2.31132, height: 9.9626 } }]
    .map(glyph => ({ ...glyph, baseline, size, color, bold: false, preciseInk: true, raster: false }));
  return { number: 3, width: 612, height: 792, rules: [], risks: ['math-image'], characters: 11,
    sources: [{ id: peer.id, text: peer.text, rect: { ...peer.rect }, disposition: 'editable' },
      ...glyphs.map(glyph => ({ id: glyph.id, text: glyph.text, rect: { ...glyph.rect }, disposition: 'visible-image' }))],
    items: [peer, { id: fragmentId, type: 'image', role: 'math', order: 2, rect: { x: 308.5299, y: 546.78, width: 8.28432, height: 9.9626 },
      sourceIds: glyphs.map(glyph => glyph.id), mathGlyphs: glyphs, mathStrokes: [], drawingIds: [], reasons: [] }] };
}
const scene = fixture(), original = structuredClone(scene);
recoverMathLetters(scene, context);
assert.equal(scene.items.length, 3); assert(scene.items.every(item => item.type === 'text'));
assert.deepEqual(scene.items[0], original.items[0], 'native function owner cannot be moved, copied or restyled');
assert.equal(scene.items.map(item => item.text).join(''), 'Sublayer(x)');
assert(scene.sources.every(source => source.disposition === 'editable'));
assert.deepEqual(scene.items.slice(1).map(item => item.rect), original.items[1].mathGlyphs.map(glyph => glyph.rect));
assert(scene.items[1].italic && !scene.items[2].italic);
const result = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), [], { preserveGeometry: true });
const zip = await JSZip.loadAsync(result.bytes), xml = await zip.file('word/document.xml').async('string');
assert(!xml.includes('<w:drawing>') && !xml.includes('<m:oMath>'), 'ordinary native function fragments are editable text, not invented formula objects');
assert.equal((xml.match(/>x<\/w:t>/g) || []).length, 1);
for (const mutate of [s => { s.items.shift(); }, s => { s.items[0].text = 'Unknown((3)'; },
  s => { s.items[0].font = 'UnverifiedFont'; }, s => { s.items[0].baseline += 2; }, s => { s.items[0].size += 2; },
  s => { s.items[0].color = 'ff0000'; }, s => { s.items[0].bold = true; }, s => { s.items[0].ocr = true; },
  s => { s.items[0].mathStyleUncertain = true; }, s => { s.sources[0].disposition = 'hidden'; },
  s => { s.sources[0].rect.width += 1; }, s => { s.items[0].sourceIds.push('another-owner'); },
  s => { const p = s.items[0]; p.rect.width += p.rect.x + 1; p.rect.x = -1; s.sources[0].rect = { ...p.rect }; },
  s => { s.items[0].rect.x -= 10; s.sources[0].rect.x -= 10; },
  s => { const peer = structuredClone(s.items[0]); peer.id = 'ambiguous'; peer.sourceIds = [peer.id]; s.items.unshift(peer); s.sources.push({ ...structuredClone(s.sources[0]), id: peer.id }); },
  s => { s.sources[1].text = 'y'; }, s => { s.items[1].mathGlyphs[0].raster = true; },
  s => { s.items[1].mathGlyphs[1].baseline -= 3; }]) {
  const s = fixture(); mutate(s); recoverMathLetters(s, context);
  assert(s.items.some(item => item.id === fragmentId && item.type === 'image'), 'ambiguous/unowned/foreign/scanned/raised fragments keep their original image');
}
console.log('Native linear fragments: unique original function context, unchanged owner/source geometry, actual editable DOCX and ambiguity/source/style/scan rejection passed.');
