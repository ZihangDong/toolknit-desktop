import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const require = createRequire(import.meta.url), sharp = require('sharp'), { chromium } = require('playwright');
const output = path.resolve('tmp/v32-pdf-creation/print-quality'); await mkdir(output, { recursive: true });
GlobalFonts.registerFromPath(path.resolve('public/assets/fonts/NotoSansSC-Regular.ttf'), 'QA Noto');
const width = 2480, height = 3508, canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
ctx.strokeStyle = '#171717'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, width - 10, height - 10);
ctx.fillStyle = '#171717'; ctx.font = '68px "QA Noto"'; ctx.fillText('ToolKnit 图像 PDF 验证样本', 140, 180);
ctx.font = '32px "QA Noto"'; ctx.fillText('300 DPI | A4 | Synthetic document | 本地转换测试', 140, 250);
ctx.font = '42px "QA Noto"';
for (let i = 0; i < 10; i++) ctx.fillText(`${i + 1}. 图片转换应保留文字、表格和页面边缘，不裁切，不遗漏内容。`, 140, 380 + i * 62);
ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(140, 1100 + i * 120); ctx.lineTo(2340, 1100 + i * 120); ctx.stroke(); }
for (const x of [140, 640, 1240, 1840, 2340]) { ctx.beginPath(); ctx.moveTo(x, 1100); ctx.lineTo(x, 1820); ctx.stroke(); }
for (let row = 0; row < 6; row++) for (const [column, text] of ['样本项目', '2026-10-21', 'ABC 123.456', '正常'].entries())
  ctx.fillText(`${text} ${row + 1}`, [170, 670, 1270, 1870][column], 1180 + row * 120);
ctx.font = '32px "QA Noto"';
for (let i = 0; i < 9; i++) ctx.fillText('中文小字号与英文混排：合同条款、票据说明、细线表格。Read every detail: 1234567890.', 140, 1980 + i * 55);
for (const [index, color] of ['#c02030', '#208050', '#2040a0', '#888888'].entries()) {
  ctx.fillStyle = color; ctx.fillRect(140 + index * 550, 2580, 450, 180);
}
ctx.fillStyle = '#171717'; ctx.font = '24px "QA Noto"';
for (let i = 0; i < 12; i++) ctx.fillText('小字号扫描可读性测试：图像保持完整，不伪造细节。Quality sample 0123456789.', 140, 2910 + i * 36);
const input = path.join(output, 'sample-a4-300.png');
await sharp(canvas.toBuffer('image/png')).withMetadata({ density: 300 }).png().toFile(input);
const source = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0], browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { width, height, outputs: [], errors: [] }, variants = [{ name: 'source', image: input }];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue()
    : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => { localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh'); });
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await page.locator('.audio-list-item[data-tool="image-to-pdf"]').evaluate(node => node.click());
  await page.waitForSelector('#imagePdfOverlay.visible');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  await page.locator('#imagePdfInput').setInputFiles(input);
  await page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled);
  await page.locator('[data-image-setting="paper"][data-value="original"]').click();
  for (const quality of ['clear', 'balanced', 'small']) {
    await page.locator(`[data-image-setting="quality"][data-value="${quality}"]`).click();
    const download = page.waitForEvent('download'), started = performance.now(); await page.locator('#imagePdfExport').click();
    const pdfFile = path.join(output, `${quality}.pdf`); await (await download).saveAs(pdfFile);
    const elapsed = performance.now() - started; await page.locator('#imagePdfDone').click();
    const bytes = await readFile(pdfFile), pdf = await PDFDocument.load(bytes), paper = pdf.getPage(0).getSize();
    assert.ok(Math.abs(paper.width - 595.2) < .1 && Math.abs(paper.height - 841.92) < .1, '300 DPI metadata preserves A4 physical size');
    const prefix = path.join(output, quality);
    const render = spawnSync(process.env.TOOLKNIT_TEST_PDFTOPPM || 'pdftoppm', ['-singlefile', '-scale-to-x', String(width), '-scale-to-y', String(height), '-png', pdfFile, prefix], { windowsHide: true, timeout: 60000, encoding: 'utf8' });
    assert.equal(render.status, 0, render.stderr);
    if (render.stderr) {
      assert.ok(render.stderr.trim().split(/\r?\n/).every(line => line.includes("Couldn't open 'nameToUnicode' file")), render.stderr);
      report.rendererNote = 'Bundled Poppler could not find optional character maps in its Unicode profile path; these image-only PDFs contain no font text.';
    }
    const rendered = await sharp(prefix + '.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(rendered.info.width, width); assert.equal(rendered.info.height, height);
    let squared = 0, changed = 0;
    for (let i = 0; i < source.data.length; i++) { const delta = source.data[i] - rendered.data[i]; squared += delta * delta; if (Math.abs(delta) > 8) changed++; }
    const mse = squared / source.data.length, psnr = mse ? 10 * Math.log10(255 * 255 / mse) : Infinity;
    let embeddedPixelMatch = null;
    if (quality === 'clear') {
      const images = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
      assert.equal(images.length, 1);
      assert.equal(images[0].dict.get(PDFName.of('Width')).asNumber(), width);
      assert.equal(images[0].dict.get(PDFName.of('Height')).asNumber(), height);
      assert.equal(images[0].dict.get(PDFName.of('Filter')).toString(), '/FlateDecode');
      embeddedPixelMatch = inflateSync(images[0].contents).equals(source.data);
      assert.equal(embeddedPixelMatch, true, 'high quality preserves every source RGB pixel');
    }
    report.outputs.push({ quality, bytes: bytes.length, elapsedMs: elapsed, paper, renderPsnr: psnr,
      embeddedPixelMatch, changedChannelFraction: changed / source.data.length });
    variants.push({ name: quality, image: prefix + '.png' });
    assert.ok(psnr >= 18, 'independent rendering must preserve the page content; resampling is reader-dependent');
  }
  const sheet = createCanvas(2000, 840), sctx = sheet.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, 2000, 840);
  sctx.font = '24px sans-serif';
  for (const [index, variant] of variants.entries()) {
    const x = index % 2 * 1000, y = Math.floor(index / 2) * 420;
    sctx.fillStyle = '#171717'; sctx.fillText(variant.name, x + 20, y + 30);
    sctx.drawImage(await loadImage(variant.image), 120, 2870, 1000, 370, x, y + 50, 1000, 370);
  }
  await writeFile(path.join(output, 'small-text-comparison.png'), sheet.toBuffer('image/png'));
  assert.deepEqual(report.errors, []); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
