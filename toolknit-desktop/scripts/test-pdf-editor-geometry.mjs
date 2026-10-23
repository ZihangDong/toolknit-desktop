import assert from 'node:assert/strict';
import { resizePdfBoxFromHandle, rotatePdfDeltaToLocal } from '../src/pdf-editor-geometry.js';
import { fitInitialPdfPlacement } from '../src/features/pdf-editor/placement.js';

for (const viewBox of [[0, 0, 595, 842], [20, 30, 420, 330], [0, 0, 36, 54]]) {
  for (const [x, y] of [[-1000, -1000], [1000, 1000], [80, 120]]) {
    const box = fitInitialPdfPlacement({ x, y, width: 240, height: 120 }, viewBox, 2);
    assert.ok(box.x >= viewBox[0] + 2 && box.y >= viewBox[1] + 2);
    assert.ok(box.x + box.width <= viewBox[2] - 2 && box.y + box.height <= viewBox[3] - 2);
    assert.equal(box.width / box.height, 2, 'fitting preserves original aspect ratio');
  }
}
assert.deepEqual(fitInitialPdfPlacement({ x: -50, y: 400, width: 200, height: 0 }, [0, 0, 400, 300], 1),
  { x: 1, y: 299, width: 200, height: 0 }, 'line endpoints and strokes remain inside the page');

const base = { x: 100, y: 200, width: 120, height: 80 };

// PDF y grows upward: moving the top handle down reduces height and keeps the bottom fixed.
assert.deepEqual(resizePdfBoxFromHandle(base, 'n', 0, -20), {
  x: 100, y: 200, width: 120, height: 60
});
// Moving the bottom handle down moves the bottom edge and increases height while keeping the top fixed.
assert.deepEqual(resizePdfBoxFromHandle(base, 's', 0, -20), {
  x: 100, y: 180, width: 120, height: 100
});
assert.deepEqual(resizePdfBoxFromHandle(base, 'e', 30, 0), {
  x: 100, y: 200, width: 150, height: 80
});
assert.deepEqual(resizePdfBoxFromHandle(base, 'w', 30, 0), {
  x: 130, y: 200, width: 90, height: 80
});
assert.deepEqual(resizePdfBoxFromHandle(base, 'nw', 400, -400, { minWidth: 20, minHeight: 20 }), {
  x: 200, y: 200, width: 20, height: 20
});
assert.deepEqual(resizePdfBoxFromHandle({ x: 0, y: 0, width: 5, height: 5 }, 'se', -100, 100, { minWidth: 10, minHeight: 10 }), {
  x: 0, y: 0, width: 10, height: 10
});
const rotatedDelta = rotatePdfDeltaToLocal(10, 0, 90);
for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
  const box = resizePdfBoxFromHandle(base, handle, 30, -20, { aspectRatio: 1.5 });
  assert.ok(Math.abs(box.width / box.height - 1.5) < 1e-9, handle);
}
assert.deepEqual(resizePdfBoxFromHandle(base, 'e', 30, 0, { aspectRatio: 1.5 }), {
  x: 100, y: 190, width: 150, height: 100
});
assert.ok(Math.abs(rotatedDelta.x) < 1e-9 && Math.abs(rotatedDelta.y + 10) < 1e-9);

console.log('PDF editor geometry regression checks passed');
