import assert from 'node:assert/strict';
import {
  buildTextLine,
  editedTextVisualBox,
  groupTextItemsIntoLines,
  insertedTextVisualBox,
  rectToViewport,
  sourceTextBox
} from '../src/features/pdf-editor/text-layout.js';

const items = [
  { str: 'World', transform: [12, 0, 0, 20, 148, 700], width: 52, height: 20, fontName: 'Helvetica-Bold' },
  { str: 'Hello', transform: [12, 0, 0, 20, 100, 700], width: 38, height: 20, fontName: 'Helvetica' },
  { str: 'next', transform: [12, 0, 0, 20, 100, 650], width: 30, height: 20, fontName: 'Helvetica-Oblique' },
  { str: '', transform: [12, 0, 0, 20, 200, 700], width: 0, height: 20 }
];

const lines = groupTextItemsIntoLines(items);
assert.equal(lines.length, 2);
assert.deepEqual(lines[0].map(item => item.str), ['Hello', 'World']);
assert.deepEqual(lines[1].map(item => item.str), ['next']);
assert.deepEqual(groupTextItemsIntoLines([]), []);
assert.deepEqual(groupTextItemsIntoLines([{ str: '', transform: [1, 0, 0, 10, 0, 0] }]), []);

const line = buildTextLine(lines[0]);
assert.equal(line.text, 'Hello World');
assert.equal(line.fontName, 'Helvetica');
assert.equal(line.bold, false);
assert.equal(line.italic, false);
assert.equal(line.segments.length, 2);
assert.equal(line.segments[0].bold, false);
assert.equal(line.segments[1].bold, true);
assert.ok(line.box.width > 90 && line.box.height > 20);
assert.deepEqual(line.sourceBox, line.box);

const italicLine = buildTextLine(lines[1]);
assert.equal(italicLine.text, 'next');
assert.equal(italicLine.italic, true);

const view = {
  convertToViewportPoint(x, y) {
    return [x * 2 + 10, 900 - y * 2];
  }
};
assert.deepEqual(rectToViewport(view, { x: 10, y: 20, width: 30, height: 40 }), {
  left: 30,
  top: 780,
  width: 60,
  height: 80
});

const baseSegment = { box: { x: 1, y: 2, width: 3, height: 4 } };
assert.deepEqual(sourceTextBox({ baseSegment: { sourceBox: { x: 5, y: 6, width: 7, height: 8 } } }, baseSegment), {
  x: 5, y: 6, width: 7, height: 8
});
assert.deepEqual(sourceTextBox({}, baseSegment), baseSegment.box);
assert.equal(sourceTextBox(null, null), null);

const replacementBox = editedTextVisualBox({
  newText: 'A much wider replacement',
  segment: { box: { x: 10, y: 20, width: 2, height: 12 }, fontSize: 12 }
}, null);
assert.equal(replacementBox.x, 10);
assert.equal(replacementBox.y, 20);
assert.ok(Math.abs(replacementBox.width - 160.2) < 1e-9);
assert.ok(Math.abs(replacementBox.height - 14.4) < 1e-9);
assert.equal(editedTextVisualBox({}, null), null);
assert.equal(editedTextVisualBox({ newText: '中文', segment: {
  box: { x: 0, y: 0, width: 10, height: 12 }, fontSize: 12,
  visualTextWidth: 24, visualTextHeight: 18
} }).height, 18, 'replacement box includes the actual font height');

const insertedFallbackBox = insertedTextVisualBox({ x: 10, y: 20, text: 'WWW', fontSize: 16 });
assert.equal(insertedFallbackBox.x, 10);
assert.equal(insertedFallbackBox.y, 20 - (16 * 1.15) * 0.2);
assert.ok(Math.abs(insertedFallbackBox.width - 45.6) < 1e-9);
assert.equal(insertedFallbackBox.height, 16 * 1.15);
assert.equal(insertedTextVisualBox({ fontSize: 16, height: 18, visualTextHeight: 24 }).height, 24);
assert.deepEqual(insertedTextVisualBox({ x: 10, y: 20, text: 'ignored', fontSize: 16, width: 80, height: 30 }), {
  x: 10,
  y: 14,
  width: 80,
  height: 30
});

console.log('PDF editor text layout regression checks passed');
