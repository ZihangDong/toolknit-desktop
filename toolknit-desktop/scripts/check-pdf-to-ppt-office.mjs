import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import JSZip from 'jszip';

const run = promisify(execFile), root = path.resolve('tmp/pdf-ppt-browser');
const report = JSON.parse((await readFile(path.join(root, 'office-report.json'), 'utf8')).replace(/^\uFEFF/, ''));
const renderer = process.env.TOOLKNIT_TEST_PDFTOPPM || 'pdftoppm';
report.visualChecks = [];
for (const item of report.checks) {
  const pdf = await PDFDocument.load(await readFile(item.pdf)); assert.equal(pdf.getPageCount(), item.slides);
  const zip = await JSZip.loadAsync(await readFile(path.join(root, item.file)));
  for (let index = 1; index <= item.slides; index++) {
    const prefix = path.join(root, `${path.parse(item.file).name}-office-${index}`);
    await run(renderer, ['-f', String(index), '-l', String(index), '-r', '72', '-singlefile', '-png', item.pdf, prefix], { windowsHide: true, timeout: 30000 });
    const rendered = await sharp(prefix + '.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(rendered.info.channels, 3);
    const slide = await zip.file(`ppt/slides/slide${index}.xml`).async('string');
    const placement = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(slide.split('<p:pic>')[1]);
    assert.ok(placement);
    const [x, y, width, height] = placement.slice(1).map(value => Math.round(Number(value) / 12700));
    const image = await zip.file(`ppt/media/page${index}.png`).async('nodebuffer');
    const resized = await sharp(image).resize(width, height, { fit: 'fill' }).toBuffer();
    const expected = await sharp({ create: { width: rendered.info.width, height: rendered.info.height, channels: 3, background: '#fff' } })
      .composite([{ input: resized, left: x, top: y }]).removeAlpha().raw().toBuffer();
    let squared = 0;
    for (let i = 0; i < expected.length; i++) squared += (expected[i] - rendered.data[i]) ** 2;
    const mse = squared / expected.length, psnr = mse ? 10 * Math.log10(255 ** 2 / mse) : 99;
    assert.ok(psnr > 20, `${item.file} page ${index}: page image survives Office round trip (${psnr.toFixed(2)} dB)`);
    report.visualChecks.push({ file: item.file, slide: index, psnrDb: Number(psnr.toFixed(2)) });
  }
}
await writeFile(path.join(root, 'office-report.json'), JSON.stringify(report, null, 2));
console.log(`Office PDF verification: ${report.visualChecks.length} pages retain slide dimensions, fitting and image content.`);
