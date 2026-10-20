import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import { glyphInkBounds } from '../src/features/pdf-to-word/core/font-outline.js';

const face = fontkit.create(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'));
const Path = face.glyphForCodePoint(65).path.constructor;
const box = value => [value.minX, value.minY, value.maxX, value.maxY];
const outline = path => ({ path, bbox: path.bbox });
const ink = path => {
  const canvas = createCanvas(100, 100), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 100, 100); ctx.fillStyle = 'black';
  ctx.beginPath(); path.toFunction()(ctx); ctx.fill();
  const pixels = Buffer.from(ctx.getImageData(0, 0, 100, 100).data); canvas.width = canvas.height = 0;
  return pixels;
};
const minus = new Path().moveTo(8, 23).lineTo(69, 23).lineTo(69, 27).lineTo(8, 27).closePath();
const repaired = new Path().moveTo(8, 0).closePath();
repaired.commands.push(...minus.commands);
const before = JSON.stringify(repaired.commands), glyph = outline(repaired);
assert.deepEqual(box(glyph.bbox), [8, 0, 69, 27]);
assert.deepEqual(box(glyphInkBounds(glyph, true)), [8, 23, 69, 27], 'nonpainting origin must not turn a thin minus into a tall glyph');
assert.deepEqual(ink(repaired), ink(minus), 'the discarded contour contributes no visible fill');
assert.equal(JSON.stringify(repaired.commands), before, 'metrics cannot alter the original font outline');
assert.equal(glyphInkBounds(glyph, false), glyph.bbox, 'stroked or unknown paint mode retains conservative original bounds');
const curve = new Path().moveTo(5, 5).quadraticCurveTo(35, 85, 65, 5).closePath();
const curveRepaired = new Path().moveTo(-900, -900).closePath(); curveRepaired.commands.push(...curve.commands);
const curveBefore = JSON.stringify(curveRepaired.commands);
const curveBounds = glyphInkBounds(outline(curveRepaired), true);
assert.deepEqual(box(curveBounds), [5, 5, 65, 45], 'curve extrema are measured by fontkit, not the control-point box');
// Skia can change edge antialiasing with distant empty contours. The product
// renders the original path; its ink must remain inside the refined crop.
const curvePixels = ink(curveRepaired); let painted = 0;
for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
  if (curvePixels[(y * 100 + x) * 4] === 255) continue;
  painted++;
  assert.ok(x >= curveBounds.minX - 1 && x <= curveBounds.maxX + 1
    && y >= curveBounds.minY - 1 && y <= curveBounds.maxY + 1,
  'original curved-path ink must fit within measured bounds plus one antialias pixel');
}
assert.ok(painted > 1000, 'the original curve must actually render');
assert.equal(JSON.stringify(curveRepaired.commands), curveBefore);
const hole = new Path().moveTo(10, 10).lineTo(60, 10).lineTo(60, 60).lineTo(10, 60).closePath()
  .moveTo(20, 20).lineTo(20, 50).lineTo(50, 50).lineTo(50, 20).closePath();
const holeRepaired = new Path().moveTo(-800, -800).closePath(); holeRepaired.commands.push(...hole.commands);
assert.deepEqual(box(glyphInkBounds(outline(holeRepaired), true)), [10, 10, 60, 60]);
assert.deepEqual(ink(hole), ink(holeRepaired), 'inner contours and their winding remain unchanged');
const ordinary = outline(minus); assert.equal(glyphInkBounds(ordinary, true), ordinary.bbox);
for (const commands of [[{ command: 'unknown', args: [] }], [{ command: 'moveTo', args: [NaN, 0] }],
  Array.from({ length: 4097 }, () => ({ command: 'closePath', args: [] }))]) {
  const unsupported = { bbox: glyph.bbox, path: { commands, mapPoints() { throw Error('must not clone unvalidated commands'); } } };
  assert.equal(glyphInkBounds(unsupported, true), unsupported.bbox);
}
const empty = outline(new Path().moveTo(0, 0).closePath().moveTo(50, 50).closePath());
assert.equal(glyphInkBounds(empty, true), empty.bbox, 'an entirely empty outline is not optimized as a proven visible glyph');
console.log('Font outline checks passed: empty repair contours, exact curve bounds, original-ink containment, winding, paint-mode boundary and bounded input.');
