import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { buildOcrTtf } from '../src/features/pdf-to-word/core/ocr-font-ttf.js';
import { inspectOcrFontProgram } from '../src/features/pdf-to-word/core/ocr-font-program.js';
import { createOcrFontContext } from '../src/features/pdf-to-word/adapters/ocr-font-context.js';
import { validateDocumentFontAsset, createSourceFontScope } from '../src/features/pdf-to-word/adapters/source-font-runtime.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let assertions = 0;
const check = (...args) => { assert(...args); assertions++; };
function assetFor(glyphs, n = 1, bold = false) {
  const font = buildOcrTtf(glyphs, 'TKInk' + n.toString(16).padStart(24, '0'), { bold });
  assert(font);
  return { ...font, kind: 'font', format: 'ttf', id: 'font:' + font.name, fingerprint: sha(font.bytes),
    ocrProvenance: { version: 1, page: 1, width: 1000, height: 1000, pixelFingerprint: '2'.repeat(64), glyphs: glyphs.map((g, i) =>
      ({ text: g.text, sourceId: 'p1:ocr' + i, box: [10, 10, 50, 50], confidence: .999, points: g.contours.reduce((sum, ring) => sum + ring.length, 0) })) } };
}
const glyphs = [{ text: '一', advance: 900, contours: [[[0, 100], [800, 100], [800, 180], [0, 180]]] },
  { text: '不', advance: 1000, contours: [[[-50, -120], [700, -120], [700, 900], [-50, 900]]] }];
const asset = assetFor(glyphs), info = await validateDocumentFontAsset(asset), program = info.generatedProgram;
check(program && program.units === 1024 && program.bold === false);
assert.deepEqual(program.glyph('不').bounds, [-50, -120, 700, 900]); assertions++;
assert.deepEqual([...program.glyph('不', true).coordinates], [-50, -120, 700, -120, 700, 900, -50, 900]); assertions++;
check(program.glyph(' ' ).advance === 256 && program.glyph('\u00a0').points === 0);
check(program.glyph('年') === null);
const invalid = asset.bytes.slice(); invalid[invalid.length - 1] ^= 1;
check(inspectOcrFontProgram(invalid, asset.name, asset.glyphs, asset.bold, asset.ocrProvenance.glyphs) === null);

const owner = createOcrFontContext({ makePath: () => new Path2D() }), canvas = createCanvas(200, 100), native = canvas.getContext('2d');
native.textBaseline = 'alphabetic'; native.textAlign = 'left'; native.fontKerning = 'none';
owner.add(asset, program); owner.add(asset, program);
const context = owner.context(native); check(context === owner.context(native)); check(context.fillRect === context.fillRect);
context.font = `16px "${asset.name}"`; context.fillStyle = '#000';
let measured = context.measureText('一');
check(measured.width === 900 / 64); check(measured.actualBoundingBoxAscent === 180 / 64);
check(measured.actualBoundingBoxDescent === -100 / 64, 'entirely above-baseline glyphs retain negative descent');
measured = context.measureText('一不');
check(measured.width === 1900 / 64); check(measured.actualBoundingBoxRight === 1600 / 64);
check(measured.actualBoundingBoxLeft === 0 && measured.actualBoundingBoxDescent === 120 / 64);
context.fillStyle = 'white'; context.fillRect(0, 0, 200, 100); context.fillStyle = 'black';
native.beginPath(); native.rect(1, 1, 5, 5); context.fillText('一', 20, 30); native.stroke();
const data = native.getImageData(0, 0, 200, 100).data;
// y=100..180 at 16/1024em paints 27.1875..28.4375: row 27 has
// >80% coverage; row 28 is only partially covered by design.
check(data[(27 * 200 + 25) * 4] < 100, 'program coordinates paint the source bar');
check(data[(28 * 200 + 25) * 4] > 100 && data[(28 * 200 + 25) * 4] < 200,
  'fractional lower edge retains antialiasing');
check(data[(31 * 200 + 25) * 4] > 240, 'no artificial descender is painted');
check(data[(1 * 200 + 3) * 4] < 200, 'fillText keeps the native current path intact');
check(owner.cachedPoints === 4 && owner.cachedPaths === 1);

context.letterSpacing = '2px'; context.wordSpacing = '3px';
check(context.measureText('一不').width === 1900 / 64 + 4);
check(context.measureText('一 不').width === 2156 / 64 + 9);
context.letterSpacing = '0px'; context.wordSpacing = '0px';
context.font = '16px Arial';
check(context.measureText('abc').width === native.measureText('abc').width, 'ordinary fonts retain native measurement');
context.font = `bold 16px "${asset.name}"`;
check(context.measureText('一').width === native.measureText('一').width, 'synthetic emphasis retains the native path');
context.font = `16px "${asset.name}"`;
check(context.measureText('年').width === native.measureText('年').width, 'unknown subset characters retain existing fallback');
context.textBaseline = 'top'; check(context.measureText('一').actualBoundingBoxAscent === native.measureText('一').actualBoundingBoxAscent);
context.textBaseline = 'alphabetic'; context.textAlign = 'center';
check(context.measureText('一').actualBoundingBoxLeft === native.measureText('一').actualBoundingBoxLeft);
context.textAlign = 'left'; context.fillText('一不', 10, 50, 8); check(owner.cachedPaths === 2);
owner.remove(asset.name); check(owner.cachedPoints === 0 && owner.cachedPaths === 0);
check(context.measureText('一').width === native.measureText('一').width);
owner.add(asset, program); owner.dispose(); owner.dispose();
check(owner.cachedPoints === 0); check(owner.context(native) === native);
assert.throws(() => owner.add(asset, program), /cancelled/); assertions++;
check(context.measureText('一').width === native.measureText('一').width, 'old context proxies cannot keep disposed programs');

const set = new Set(), scope = createSourceFontScope({ fontSet: set, makePath: () => new Path2D(),
  makeFace: () => ({ async load() { return this; } }) });
await scope.ensure([asset]); const scoped = scope.context(native); scoped.font = `16px "${asset.name}"`;
check(scoped.measureText('不').actualBoundingBoxLeft === 50 / 64);
scope.dispose(); check(set.size === 0); check(scoped.measureText('不').width === native.measureText('不').width);

// A cache must bound the sum across faces, rather than granting each face a
// new allowance. Independent native paths exceed the shared point cap here.
const ring = [...Array.from({ length: 4094 }, (_, i) => [i, 100 + i % 2]),
  ...Array.from({ length: 4094 }, (_, i) => [4093 - i, 0])];
const bounded = createOcrFontContext({ makePath: () => new Path2D() }), boundedContext = bounded.context(native);
for (let i = 0; i < 18; i++) {
  const a = assetFor([{ text: String.fromCharCode(0x4e00 + i), advance: 4094, contours: [ring] }], i + 20);
  const p = (await validateDocumentFontAsset(a)).generatedProgram; bounded.add(a, p);
  boundedContext.font = `4px "${a.name}"`; boundedContext.fillText(a.glyphs, 0, 20);
  check(bounded.cachedPoints <= 131072 && bounded.cachedPaths <= 256);
}
check(bounded.cachedPaths < 18, 'old paths are evicted across font boundaries');
bounded.dispose(); check(bounded.cachedPoints === 0);
console.log('Generated program/context: ' + assertions + ' parser, true bounds/advance, path/state, multi-character, fallback, lifecycle and shared-cache checks passed.');
