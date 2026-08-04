import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { isAnimatedGifBuffer, stitchImages } from '../cli/lib/image-stitch-runtime.mjs';

function solidPng(width, height, color) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

const [pageMarkup, stylesheet] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
]);
const imageStitchMarkup = pageMarkup.match(/<div class="audio-convert-overlay image-stitch-overlay"[\s\S]*?<div class="audio-convert-success-overlay" id="imageStitchSuccessOverlay">/)?.[0] || '';
assert.match(imageStitchMarkup, /id="imageStitchBack"[\s\S]*?<svg\b[\s\S]*?<span[^>]*>返回<\/span>/, 'image stitch back button must keep its visible arrow icon');
assert.doesNotMatch(imageStitchMarkup, /audio-convert-hero-label/, 'image stitch must not render the IMAGE STITCH eyebrow');
for (const className of ['image-stitch-queue-empty', 'image-stitch-queue', 'image-stitch-preview-empty', 'image-stitch-preview-composition']) {
  assert.match(stylesheet, new RegExp(`\\.${className}\\[hidden\\][^{]*\\{[^}]*display:\\s*none\\s*!important`), `${className} must stay hidden when the UI switches state`);
}

async function pixelAt(imagePath, x, y) {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

const root = await mkdtemp(path.join(tmpdir(), 'toolknit-stitch-runtime-'));
try {
  const first = path.join(root, '红 色.png');
  const second = path.join(root, 'blue.png');
  const transparent = path.join(root, '透明.png');
  await writeFile(first, solidPng(10, 20, '#ff0000'));
  await writeFile(second, solidPng(20, 10, '#0000ff'));
  await writeFile(transparent, solidPng(10, 10, 'rgba(0,0,0,0)'));

  const progress = [];
  const vertical = await stitchImages({ input_paths: [first, second], output_dir: path.join(root, '输出 空间'), output_name: '发布 长图', mode: 'vertical' }, { reportProgress: value => progress.push(value) });
  assert.equal(vertical.width, 10);
  assert.equal(vertical.height, 25);
  assert.deepEqual((await loadImage(vertical.output_path)).width, 10);
  assert.deepEqual(await pixelAt(vertical.output_path, 5, 19), [255, 0, 0, 255]);
  assert.deepEqual(await pixelAt(vertical.output_path, 5, 20), [0, 0, 255, 255], '0px seam must switch directly to the next image');
  assert.equal(progress.at(-1), 100);
  assert.equal(path.basename(vertical.output_path), '发布 长图.png');

  const horizontal = await stitchImages({ input_paths: [first, second], output_dir: path.dirname(vertical.output_path), mode: 'horizontal', reference: 'largest', spacing_px: 3, scale_percent: 50, format: 'png', background_rgba: '#00FF00FF' });
  assert.equal(horizontal.width, 28);
  assert.equal(horizontal.height, 10);
  assert.deepEqual(await pixelAt(horizontal.output_path, 4, 5), [255, 0, 0, 255]);
  assert.deepEqual(await pixelAt(horizontal.output_path, 5, 5), [0, 255, 0, 255], 'the single configured gap must use the background color');
  assert.notEqual(horizontal.output_path, vertical.output_path, 'existing outputs must get unique names');

  const pngAlpha = await stitchImages({ input_paths: [transparent, second], output_dir: path.dirname(vertical.output_path), format: 'png', background_rgba: '#12345600' });
  assert.equal((await pixelAt(pngAlpha.output_path, 2, 2))[3], 0, 'PNG must preserve a transparent background');
  const jpeg = await stitchImages({ input_paths: [transparent, second], output_dir: path.dirname(vertical.output_path), format: 'jpg', background_rgba: '#FF00FF00', jpeg_quality: 92 });
  const jpegPixel = await pixelAt(jpeg.output_path, 2, 2);
  assert.ok(jpegPixel[0] > 220 && jpegPixel[2] > 220, 'JPG must flatten transparency onto the selected RGB background');

  await assert.rejects(() => stitchImages({ input_paths: [first, first], output_dir: root }), /Duplicate image input/);
  await assert.rejects(() => stitchImages({ input_paths: [first, second], output_dir: root, output_name: '../escape' }), /Invalid stitch settings/);
  const damaged = path.join(root, 'damaged.png');
  await writeFile(damaged, Buffer.from('not an image'));
  await assert.rejects(() => stitchImages({ input_paths: [first, damaged], output_dir: root }), /cannot be decoded/);
  assert.throws(() => isAnimatedGifBuffer(Buffer.from('not gif')), /invalid header/);
  assert.ok((await readFile(vertical.output_path)).length > 0);
  console.log('Image stitch runtime checks passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
