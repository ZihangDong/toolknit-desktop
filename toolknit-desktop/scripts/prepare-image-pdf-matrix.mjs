import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
const require = createRequire(import.meta.url), sharp = require('sharp');
const root = path.resolve('tmp/v32-pdf-creation/formats');
await mkdir(root, { recursive: true });
const canvas = createCanvas(120, 80), ctx = canvas.getContext('2d');
for (const [color, x, y] of [['#e02020', 0, 0], ['#20c030', 60, 0], ['#2040e0', 0, 40], ['#e0b020', 60, 40]]) {
  ctx.fillStyle = color; ctx.fillRect(x, y, 60, 40);
}
const source = canvas.toBuffer('image/png'), manifest = [];
async function save(name, bytes, width = 120, height = 80, frames = 1) {
  await writeFile(path.join(root, name), bytes); manifest.push({ name, width, height, frames });
}
await save('colors.png', source);
await save('colors.jpg', await sharp(source).jpeg({ quality: 95 }).toBuffer());
await save('colors.webp', await sharp(source).webp({ lossless: true }).toBuffer());
await save('colors.gif', await sharp(source).gif().toBuffer());
await save('density-300.png', await sharp(source).withMetadata({ density: 300 }).png().toBuffer());
Object.assign(manifest.at(-1), { dpiX: 300, dpiY: 300 });
await save('density-300.jpg', await sharp(source).withMetadata({ density: 300 }).jpeg().toBuffer());
Object.assign(manifest.at(-1), { dpiX: 300, dpiY: 300 });
await save('density-300.webp', await sharp(source).withMetadata({ density: 300 }).webp({ lossless: true }).toBuffer());
Object.assign(manifest.at(-1), { dpiX: 300, dpiY: 300 });
const exif = Buffer.alloc(78); exif.write('II'); exif.writeUInt16LE(42, 2); exif.writeUInt32LE(8, 4); exif.writeUInt16LE(4, 8);
for (const [i, tag, type, value] of [[0, 0x11a, 5, 62], [1, 0x11b, 5, 70], [2, 0x128, 3, 2], [3, 0x112, 3, 6]]) {
  const offset = 10 + i * 12; exif.writeUInt16LE(tag, offset); exif.writeUInt16LE(type, offset + 2);
  exif.writeUInt32LE(1, offset + 4); exif.writeUInt32LE(value, offset + 8);
}
exif.writeUInt32LE(300, 62); exif.writeUInt32LE(1, 66); exif.writeUInt32LE(150, 70); exif.writeUInt32LE(1, 74);
const jpegBase = await sharp(source).jpeg().toBuffer(), exifHeader = Buffer.from([255, 225, 0, 86]);
await save('density-asymmetric-rotated.jpg', Buffer.concat([jpegBase.subarray(0, 2), exifHeader, Buffer.from('Exif\0\0'), exif, jpegBase.subarray(2)]), 80, 120);
Object.assign(manifest.at(-1), { dpiX: 150, dpiY: 300 });
const bmp = Buffer.alloc(54 + 120 * 80 * 3); bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(120, 18); bmp.writeInt32LE(80, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
bmp.writeUInt32LE(120 * 80 * 3, 34); bmp.writeInt32LE(11811, 38); bmp.writeInt32LE(5906, 42);
const rgba = ctx.getImageData(0, 0, 120, 80).data;
for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
  const from = (y * 120 + x) * 4, to = 54 + ((79 - y) * 120 + x) * 3;
  bmp[to] = rgba[from + 2]; bmp[to + 1] = rgba[from + 1]; bmp[to + 2] = rgba[from];
}
await save('density-asymmetric.bmp', bmp); Object.assign(manifest.at(-1), { dpiX: 300, dpiY: 150 });
for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
  await save(`orientation-${orientation}.jpg`, await sharp(source).withMetadata({ orientation }).jpeg({ quality: 95 }).toBuffer(),
    orientation > 4 ? 80 : 120, orientation > 4 ? 120 : 80);
}
const animation = createCanvas(120, 160), actx = animation.getContext('2d');
actx.fillStyle = '#e02020'; actx.fillRect(0, 0, 120, 80);
actx.fillStyle = '#20c030'; actx.fillRect(0, 80, 120, 80);
const pixels = Buffer.from(actx.getImageData(0, 0, 120, 160).data);
const raw = { width: 120, height: 160, channels: 4, pageHeight: 80 };
await save('animated.gif', await sharp(pixels, { raw }).gif({ delay: [100, 100], loop: 0 }).toBuffer());
await save('animated.webp', await sharp(pixels, { raw }).webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer());
await save('multipage.tiff', await sharp(pixels, { raw }).tiff({ compression: 'lzw' }).toBuffer(), 120, 80, 2);
await save('cmyk.tiff', await sharp(source).flatten({ background: '#fff' }).toColourspace('cmyk').tiff({ compression: 'lzw' }).toBuffer());
await save('cmyka.tiff', await sharp(source).toColourspace('cmyk').tiff({ compression: 'lzw' }).toBuffer());
manifest.at(-1).error = 'tiff-format';
await save('deflate.tiff', await sharp(source).tiff({ compression: 'deflate' }).toBuffer());
await save('packbits.tiff', await sharp(source).tiff({ compression: 'packbits' }).toBuffer());
await save('bw-fax.tiff', await sharp(source).flatten({ background: '#fff' }).greyscale().threshold(130).toColourspace('b-w').tiff({ bitdepth: 1, compression: 'ccittfax4' }).toBuffer());
ctx.clearRect(0, 0, 120, 80); ctx.fillStyle = '#e02020'; ctx.fillRect(20, 20, 80, 40);
await save('transparent.png', canvas.toBuffer('image/png'));
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Prepared ${manifest.length} synthetic image inputs at ${root}`);
