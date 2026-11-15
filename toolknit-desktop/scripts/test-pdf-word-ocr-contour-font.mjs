import assert from 'node:assert/strict';
import fontkit from '@pdf-lib/fontkit';
import { traceOcrGlyph } from '../src/features/pdf-to-word/core/ocr-font-contours.js';
import { buildOcrTtf, isOcrFontName, OCR_FONT_LIMITS } from '../src/features/pdf-to-word/core/ocr-font-ttf.js';
import { inspectSourceTtf, isSourceFontName, buildSourceTtf } from '../src/features/pdf-to-word/core/source-font.js';

// These shapes test contour/TrueType mechanics, not OCR recognition accuracy.
const mask = rows => ({ mask: Uint8Array.from(rows.join(''), c => c === '#' ? 1 : 0), width: rows[0].length, height: rows.length });
const fixtures = [
  ['I', ['.###.', '..#..', '..#..', '..#..', '.###.']],
  ['O', ['.###.', '#...#', '#...#', '#...#', '.###.']],
  ['一', ['.....', '.....', '#####', '.....', '.....']],
  ['十', ['..#..', '..#..', '#####', '..#..', '..#..']],
  ['A', ['#.#..', '.#...', '....#', '...#.', '..#..']],
];
const glyphs = [];
for (const [text, rows] of fixtures) {
  const data = mask(rows), frozen = data.mask.slice(), outline = traceOcrGlyph(data.mask, data.width, data.height);
  assert(outline); assert.deepEqual(data.mask, frozen); assert.equal(outline.inkPixels, data.mask.reduce((a, b) => a + b, 0));
  // Independently rasterize the polygon winding at original pixel centers.
  // This catches reversed holes, lost diagonal fragments and dropped tiny ink.
  const winding = (px, py) => outline.contours.reduce((sum, ring) => sum + ring.reduce((n, a, i) => {
    const b = ring[(i + 1) % ring.length], cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    return n + (a[1] <= py && b[1] > py && cross > 0 ? 1 : a[1] > py && b[1] <= py && cross < 0 ? -1 : 0);
  }, 0), 0);
  for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++)
    assert.equal(winding(x + .5, y + .5) !== 0, Boolean(data.mask[y * data.width + x]), text + ' pixel ownership');
  glyphs.push({ text, advance: 768, contours: outline.contours.map(r => r.map(([x, y]) => [x * 100, 400 - y * 100]).reverse()) });
}
const name = 'TKInk' + 'c'.repeat(24), frozen = structuredClone(glyphs), result = buildOcrTtf(glyphs, name);
assert(isOcrFontName(name)); assert(!isSourceFontName(name), 'generated OCR fonts are not declared original PDF fonts');
assert(result); assert.deepEqual(glyphs, frozen); assert.equal(result.origin, 'generated-ocr-outline');
assert.equal(result.fsType, 0); assert.equal(result.units, 1024); assert(result.bytes.length < 10000);
assert.deepEqual(buildOcrTtf(glyphs, name).bytes, result.bytes, 'font bytes/names are deterministic, without local timestamps');
const info = inspectSourceTtf(result.bytes); assert(info); assert.equal(info.fsType, 0); assert.equal(info.weight, 400);
assert.equal(buildSourceTtf(result.bytes, new Map([[65, 1]]), name), null, 'original-font metadata rebuilding does not accept generated names');
const face = fontkit.create(result.bytes);
assert.equal(face.familyName, name); assert.equal(face.unitsPerEm, 1024);
for (const glyph of glyphs) {
  const actual = face.glyphForCodePoint(glyph.text.charCodeAt(0)); assert(actual.id > 0); assert.equal(actual.advanceWidth, glyph.advance);
  const points = glyph.contours.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  assert.deepEqual([actual.bbox.minX, actual.bbox.minY, actual.bbox.maxX, actual.bbox.maxY], [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}
assert.equal(face.glyphForCodePoint(66).id, 0, 'unseen characters remain missing and must use inserted-only fallback');
assert.equal(face.glyphForCodePoint(32).advanceWidth, 256, 'spaces have an explicit empty quarter-em advance');
assert.equal(face.glyphForCodePoint(160).id, face.glyphForCodePoint(32).id);
assert.equal(face.glyphForCodePoint(32).path.commands.length, 0);
assert.equal(buildOcrTtf([{ ...glyphs[0], text: ' ' }], name), null, 'structural whitespace cannot claim source-pixel glyph ownership');
const bold = buildOcrTtf(glyphs, name, { bold: true }); assert(bold.bold); assert.equal(bold.weight, 700);
assert.equal(inspectSourceTtf(bold.bytes).bold, true); assert.equal(fontkit.create(bold.bytes).subfamilyName, 'Bold');
let checksum = 0; const data = new DataView(result.bytes.buffer);
for (let i = 0; i < result.bytes.length; i += 4) checksum = (checksum + data.getUint32(i)) >>> 0;
assert.equal(checksum, 0xb1b0afba);

const ordinary = mask(['###', '#.#', '###']);
for (const [m, w, h, opts] of [[new Uint8Array(9).fill(2), 3, 3], [ordinary.mask, 0, 3], [ordinary.mask, 3, Infinity],
  [ordinary.mask, 3, 3, { maxEdges: 4 }], [ordinary.mask, 3, 3, { maxPoints: 4 }], [new Uint8Array(9), 3, 3]])
  assert.equal(traceOcrGlyph(m, w, h, opts), null);
assert.equal(traceOcrGlyph(new Uint8Array(257 * 2), 257, 2), null);
let checks = 0;
assert.throws(() => traceOcrGlyph(ordinary.mask, 3, 3, { check() { if (++checks === 2) throw Error('cancelled'); } }), /cancelled/);
assert.deepEqual(ordinary.mask, mask(['###', '#.#', '###']).mask);
for (const bad of [null, [], [...glyphs, glyphs[0]], [{ ...glyphs[0], text: '\ue000' }], [{ ...glyphs[0], text: 'ab' }],
  [{ ...glyphs[0], advance: Infinity }], [{ ...glyphs[0], contours: [null] }], [{ ...glyphs[0], contours: [[[-9999, 0], [0, 0], [1, 1], [2, 2]]] }]])
  assert.equal(buildOcrTtf(bad, name), null);
assert.equal(buildOcrTtf(glyphs, 'TKPdf' + 'a'.repeat(24)), null);
assert.equal(buildOcrTtf(Array.from({ length: OCR_FONT_LIMITS.glyphs + 1 }, () => glyphs[0]), name), null);
assert.throws(() => buildOcrTtf(glyphs, name, { check() { throw Error('cancelled'); } }), /cancelled/);
console.log('OCR contour/font mechanics: every pixel/hole/diagonal, shared em/baseline, independent TTF parser, deterministic checksum, bounded rejection/cancellation and separate origin passed.');
