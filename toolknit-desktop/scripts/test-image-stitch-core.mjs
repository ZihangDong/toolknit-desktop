import assert from 'node:assert/strict';
import {
  calculateImageStitchLayout,
  ImageStitchError,
  normalizeImageStitchRequest
} from '../src/image-stitch-core.js';

const images = [{ width: 100, height: 200 }, { width: 400, height: 100 }];
const vertical = calculateImageStitchLayout(images, { mode: 'vertical', reference: 'first' });
assert.deepEqual(vertical.items.map(item => [item.target_width, item.target_height]), [[100, 200], [100, 25]]);
assert.equal(vertical.width, 100);
assert.equal(vertical.height, 225);

const horizontal = calculateImageStitchLayout(images, {
  mode: 'horizontal',
  reference: 'largest',
  spacing_px: 8,
  scale_percent: 50,
  format: 'jpg',
  jpeg_quality: 92
});
assert.equal(horizontal.height, 100);
assert.equal(horizontal.width, 458);
assert.equal(horizontal.items[0].target_height, horizontal.items[1].target_height);
assert.equal(horizontal.pixels, horizontal.width * horizontal.height);

const rounded = calculateImageStitchLayout([{ width: 101, height: 10 }, { width: 5, height: 7 }], {
  mode: 'vertical', reference: 'first', scale_percent: 50
});
assert.equal(rounded.width, 51, 'reference scaling must round instead of truncate');

assert.deepEqual(normalizeImageStitchRequest(), {
  mode: 'vertical', reference: 'first', spacing_px: 0, scale_percent: 100,
  format: 'png', jpeg_quality: 92, background_rgba: '#FFFFFFFF', output_name: null
});
assert.equal(normalizeImageStitchRequest({ output_name: '发布 长图' }).output_name, '发布 长图');
assert.throws(() => normalizeImageStitchRequest({ output_name: '../escape' }), ImageStitchError);
assert.throws(() => normalizeImageStitchRequest({ output_name: 'CON' }), ImageStitchError);
assert.throws(() => normalizeImageStitchRequest({ background_rgba: '#fff' }), ImageStitchError);
assert.throws(() => calculateImageStitchLayout([images[0]], {}), /2 to 100/);
assert.throws(() => calculateImageStitchLayout(images, { spacing_px: 501 }), /Invalid stitch settings/);
assert.throws(() => calculateImageStitchLayout([{ width: 70_000, height: 1 }, images[0]], {}), /safe export limit/);

console.log('Image stitch core checks passed');
