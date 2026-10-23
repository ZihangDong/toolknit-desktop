import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { executeTool } from '../cli/lib/tool-registry.mjs';
import { withPdf } from '../cli/lib/pdf-headless.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { decode as decodeBmp } from 'bmp-ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-cli-images-'));
const file = name => path.join(root, name);
const call = (name, args, options) => executeTool(`toolknit_${name}`, args, options);
try {
  const canvas = createCanvas(80, 60), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 40, 60); ctx.fillStyle = 'blue'; ctx.fillRect(40, 0, 40, 60);
  const source = canvas.toBuffer('image/png'); canvas.width = canvas.height = 0;
  await writeFile(file('colors.png'), source);
  const pngInput = file('colors.png');
  const converted = await call('image_convert', { input_paths: [pngInput], output_dir: root, format: 'jpg' });
  const jpeg = await sharp(converted.outputs[0].path).metadata(); assert.equal(jpeg.width, 80); assert.equal(jpeg.height, 60); assert.equal(jpeg.format, 'jpeg');
  const repeated = await call('image_convert', { input_paths: [pngInput], output_dir: root, format: 'jpg' });
  assert.notEqual(repeated.outputs[0].path, converted.outputs[0].path);
  for (const format of ['png', 'webp', 'bmp', 'gif', 'svg']) {
    const result = await call('image_convert', { input_paths: [pngInput], output_dir: root, format });
    const bytes = await readFile(result.outputs[0].path);
    if (format === 'bmp') {
      const decoded = decodeBmp(bytes, { toRGBA: true }); assert.equal(decoded.width, 80); assert.equal(decoded.height, 60); assert.deepEqual([...decoded.data.subarray(0, 3)], [255, 0, 0]);
    } else if (format === 'svg') {
      assert.match(bytes.toString(), /width="80" height="60"/); assert.match(bytes.toString(), /data:image\/png;base64,/);
    } else { const info = await sharp(bytes).metadata(); assert.equal(info.width, 80); assert.equal(info.height, 60); }
  }
  const compressed = await call('image_compress', { input_paths: [pngInput], output_dir: root });
  for (const item of compressed.results) if (item.status === 'success') assert.ok(item.output.bytes < source.length);
  await call('image_crop', { input_path: pngInput, output_path: file('cropped.png'), rect: { x: 0, y: 0, width: 20, height: 30 } });
  const crop = await sharp(file('cropped.png')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(crop.info.width, 20); assert.equal(crop.info.height, 30); assert.equal(crop.data[0], 255); assert.equal(crop.data[2], 0);
  await call('image_crop', { input_path: pngInput, output_path: file('flipped.png'), flip_horizontal: true, rect: { x: 0, y: 0, width: 20, height: 30 } });
  const flipped = await sharp(file('flipped.png')).raw().toBuffer(); assert.deepEqual([...flipped.subarray(0, 3)], [0, 0, 255]);
  await call('image_crop', { input_path: pngInput, output_path: file('rotated.png'), rotation: 90, rect: { x: 0, y: 0, width: 60, height: 80 } });
  assert.equal((await sharp(file('rotated.png')).metadata()).height, 80);
  await writeFile(file('oriented.jpg'), await sharp(source).withMetadata({ orientation: 6 }).jpeg().toBuffer());
  const oriented = await call('image_convert', { input_paths: [file('oriented.jpg')], output_dir: root, format: 'png' });
  const orientedInfo = await sharp(oriented.outputs[0].path).metadata(); assert.equal(orientedInfo.width, 60); assert.equal(orientedInfo.height, 80);
  await assert.rejects(call('image_crop', { input_path: pngInput, output_path: file('bad.png'), rect: { x: 70, y: 0, width: 20, height: 30 } }), error => error.code === 'INVALID_ARGUMENT');
  await call('image_color_replace', { input_path: pngInput, output_path: file('replaced.png'), source: '#ff0000', target: '#00ff00', softness: 0, preserve_luminance: false });
  const replacement = await sharp(file('replaced.png')).raw().toBuffer(); assert.deepEqual([...replacement.subarray(0, 3)], [0, 255, 0]);
  await call('image_to_pdf', { input_paths: [pngInput, converted.outputs[0].path], output_path: file('images.pdf'), paper: 'original' });
  const pdf = await PDFDocument.load(await readFile(file('images.pdf'))); assert.equal(pdf.getPageCount(), 2); assert.equal(pdf.getPage(0).getWidth(), 60); assert.equal(pdf.getPage(0).getHeight(), 45);
  await call('image_icons', { input_path: pngInput, output_path: file('icons.zip') });
  const zip = await JSZip.loadAsync(await readFile(file('icons.zip'))), ico = await zip.file('favicon.ico').async('nodebuffer');
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
  const icon = await sharp(await zip.file('icon-32.png').async('nodebuffer')).raw().toBuffer({ resolveWithObject: true }); assert.equal(icon.info.width, 32); assert.equal(icon.data[3], 0, 'non-square source has transparent padding');
  const tiff = await sharp(source).tiff().toBuffer(); await writeFile(file('page.tiff'), tiff);
  await call('image_to_pdf', { input_paths: [file('page.tiff')], output_path: file('tiff.pdf') });
  assert.equal((await PDFDocument.load(await readFile(file('tiff.pdf')))).getPageCount(), 1);
  const frames = Buffer.alloc(10 * 20 * 4);
  for (let pixel = 0; pixel < 200; pixel++) { frames[pixel * 4 + (pixel < 100 ? 0 : 2)] = 255; frames[pixel * 4 + 3] = 255; }
  await writeFile(file('multiple.tiff'), await sharp(frames, { raw: { width: 10, height: 20, pageHeight: 10, channels: 4 } }).tiff().toBuffer());
  await call('image_to_pdf', { input_paths: [file('multiple.tiff')], output_path: file('multiple.pdf'), paper: 'original' });
  await withPdf(await readFile(file('multiple.pdf')), async document => {
    assert.equal(document.numPages, 2);
    for (let number = 1; number <= 2; number++) {
      const page = await document.getPage(number), view = page.getViewport({ scale: 10 }), canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
      try {
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: view }).promise;
        const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        assert.ok(pixel[number === 1 ? 0 : 2] > 200 && pixel[number === 1 ? 2 : 0] < 80, 'Each TIFF page retains its own image.');
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
  });
  const animated = await sharp(frames, { raw: { width: 10, height: 20, pageHeight: 10, channels: 4 } }).gif({ delay: [100, 100] }).toBuffer();
  assert.ok((await sharp(animated).metadata()).pages > 1, 'animation fixture has multiple frames');
  await writeFile(file('animation.gif'), animated);
  await assert.rejects(call('image_convert', { input_paths: [file('animation.gif')], output_dir: root, format: 'png' }), error => error.code === 'PROCESSING_FAILED');
  const first = await call('image_convert', { input_paths: [file('animation.gif')], output_dir: root, format: 'png', frame_policy: 'first' });
  assert.equal(first.results[0].first_frame, true);
  await assert.rejects(call('image_to_pdf', { input_paths: [pngInput], output_path: file('cancel.pdf') }, { signal: AbortSignal.abort() }), error => error.code === 'CANCELLED');
  assert.ok(!(await readdir(root)).includes('cancel.pdf'));
  assert.deepEqual(await readFile(pngInput), source);
  console.log('Image CLI/MCP passed: real encoding, no-overwrite, crop pixels, color replacement, page dimensions, icon archive, TIFF, animation policy and cancellation.');
} finally { await rm(root, { recursive: true, force: true }); }
