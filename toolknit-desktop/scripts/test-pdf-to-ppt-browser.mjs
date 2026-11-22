import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createServer, preview } from 'vite';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('tmp/pdf-ppt-browser'); await mkdir(root, { recursive: true });
const report = { checks: [], errors: [], console: [], outputs: [] };
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); };
const run = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
GlobalFonts.registerFromPath('public/assets/fonts/NotoSansSC-Regular.ttf', 'PPT QA Chinese');
const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.Helvetica);
const scan = createCanvas(360, 480), ctx = scan.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 360, 480); ctx.fillStyle = '#dd2222'; ctx.fillRect(10, 10, 45, 45);
ctx.fillStyle = '#111'; ctx.font = '24px "PPT QA Chinese"'; ctx.fillText('中文扫描页 · 合同', 35, 110);
ctx.font = '18px "PPT QA Chinese"'; ctx.fillText('原样保留图片和页面布局', 35, 155);
ctx.fillStyle = '#2255dd'; ctx.fillRect(280, 400, 60, 60);
const scanPng = await source.embedPng(await scan.encode('png'));
source.addPage([360, 480]).drawImage(scanPng, { x: 0, y: 0, width: 360, height: 480 });
const landscape = source.addPage([640, 360]);
landscape.drawText('Landscape vector page 2', { x: 40, y: 290, size: 26, font });
landscape.drawRectangle({ x: 40, y: 40, width: 200, height: 150, color: rgb(0.1, 0.6, 0.3) });
landscape.drawRectangle({ x: 100, y: 80, width: 200, height: 150, color: rgb(0.2, 0.3, 0.8), opacity: 0.4 });
const rotated = source.addPage([300, 500]); rotated.setRotation(degrees(90));
rotated.drawRectangle({ x: 0, y: 0, width: 45, height: 45, color: rgb(0.9, 0.1, 0.1) });
rotated.drawText('Rotated page 3', { x: 40, y: 300, size: 24, font });
const square = source.addPage([420, 420]);
square.drawRectangle({ x: 40, y: 40, width: 200, height: 200, color: rgb(0, 0, 1), opacity: 0.3 });
square.drawText('Transparent page 4', { x: 30, y: 300, size: 22, font });
const inputPath = path.join(root, '合同 mixed.pdf'), sourceBytes = await source.save(); await writeFile(inputPath, sourceBytes);
const originalHash = hash(sourceBytes);
const huge = await PDFDocument.create(); huge.addPage([3000, 3000]); await writeFile(path.join(root, 'oversized.pdf'), await huge.save());
const many = await PDFDocument.create(); for (let n = 0; n < 201; n++) many.addPage([72, 72]); await writeFile(path.join(root, 'too-many.pdf'), await many.save());
await writeFile(path.join(root, 'broken.pdf'), 'not a valid PDF');
await run(path.resolve('src-tauri/resources/qpdf/qpdf.exe'), ['--encrypt', 'secret', 'owner', '256', '--', inputPath, path.join(root, 'locked.pdf')], { windowsHide: true });

async function inspect(file, pageNumbers, dpi) {
  const zip = await JSZip.loadAsync(await readFile(file));
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.xml(\.rels)?$/.test(name)) continue;
    const text = await entry.async('string');
    const valid = await page.evaluate(text => !new DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror'), text);
    assert.ok(valid, name);
  }
  const slide = await zip.file('ppt/presentation.xml').async('string');
  assert.equal((slide.match(/<p:sldId /g) || []).length, pageNumbers.length);
  const sizes = [[360, 480], [640, 360], [500, 300], [420, 420]];
  for (const [index, number] of pageNumbers.entries()) {
    const bytes = await zip.file(`ppt/media/page${index + 1}.png`).async('nodebuffer');
    const image = await sharp(bytes).metadata(), [width, height] = sizes[number - 1];
    assert.equal(image.width, Math.ceil(width * dpi / 72)); assert.equal(image.height, Math.ceil(height * dpi / 72));
    const picture = await zip.file(`ppt/slides/slide${index + 1}.xml`).async('string');
    assert.match(picture, new RegExp(`name="PDF page ${number}"`)); assert.equal((picture.match(/<p:pic>/g) || []).length, 1);
    assert.doesNotMatch(picture, /<p:sp>/);
    if (number === 1 || number === 3) {
      const pixel = await sharp(bytes).extract({ left: Math.round(20 * dpi / 72), top: Math.round(20 * dpi / 72), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      assert.ok(pixel[0] > 180 && pixel[1] < 70 && pixel[2] < 70, 'red corner survives rendering and rotation');
    }
    if (number === 4) {
      const pixel = await sharp(bytes).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      assert.ok([...pixel].every(value => value === 255), 'transparent blank area becomes white');
    }
  }
  report.outputs.push({ file: path.basename(file), pages: pageNumbers, dpi });
}
const server = await createServer({ configFile: false, plugins: [pdfjsAssets()], logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/src-tauri/**', '**/cli/**'] } },
  optimizeDeps: { entries: ['scripts/fixtures/pdf-to-ppt.html'], include: ['jszip', 'lucide', 'pdfjs-dist/legacy/build/pdf.mjs'] } });
let browser, page, production;
try {
  await server.listen(); browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : { channel: 'msedge' }) });
  async function fixture(theme, lang, native = false) {
    await page?.close(); page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.console.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0] + `scripts/fixtures/pdf-to-ppt.html?theme=${theme}&lang=${lang}${native ? '&native=1' : ''}`);
    await page.waitForFunction(() => window.pptTest && !pptTest.controller.busy);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  }
  async function load(name = '合同 mixed.pdf') {
    await page.locator('#pdfPptFileInput').setInputFiles(path.join(root, name));
    await page.waitForFunction(() => !pptTest.controller.busy);
  }
  async function download(name) {
    const downloaded = page.waitForEvent('download'); await page.locator('#pdfPptExport').click();
    const file = await downloaded; const target = path.join(root, name); await file.saveAs(target);
    await page.waitForFunction(() => !pptTest.controller.busy); return target;
  }
  async function done() { await page.locator('#pdfPptDone').click(); }
  for (const theme of ['light', 'dark']) for (const lang of ['zh', 'en']) {
    await fixture(theme, lang); await page.screenshot({ path: path.join(root, `empty-${theme}-${lang}.png`) });
    await load(); await page.waitForSelector('#pdfPptPages canvas');
    await page.locator('[data-ppt-dpi="144"]').click();
    const target = await download(`all-${theme}-${lang}.pptx`); await inspect(target, [1, 2, 3, 4], 144);
    check(await page.locator('#pdfPptSuccess').getAttribute('aria-hidden') === 'false', `${theme}/${lang}: real PDF → worker → PPTX download`);
    check(await page.evaluate(() => pptTest.center.list()[0].state === 'succeeded'), `${theme}/${lang}: task center completion`);
    await done();
    for (const width of [1440, 1024, 720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => {
        const nodes = [document.getElementById('pdfPptProcess'), document.getElementById('pdfPptSuccess')];
        return nodes.every(node => getComputedStyle(node).visibility === 'hidden' || Number(getComputedStyle(node).opacity) === 0);
      });
      check(await page.locator('#pdfPptOverlay').evaluate(node => node.scrollWidth <= node.clientWidth + 2), `${theme}/${lang}/${width}: no page overflow`);
      if (width <= 1100) {
        const box = await page.locator('#pdfPptMobileExport').boundingBox();
        check(box && box.y + box.height < 900, `${theme}/${lang}/${width}: export action is on the first screen`);
      }
      await page.screenshot({ path: path.join(root, `loaded-${theme}-${lang}-${width}.png`) });
    }
  }
  const mobileDownload = page.waitForEvent('download'); await page.locator('#pdfPptMobileExport').click();
  await (await mobileDownload).saveAs(path.join(root, 'mobile.pptx')); await page.waitForFunction(() => !pptTest.controller.busy); await done();
  check(true, 'narrow-window primary action exports the same selected pages');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#pdfPptRange').fill('3, 2, 3'); await page.locator('#pdfPptApplyRange').click();
  await page.locator('[data-ppt-dpi="200"]').click();
  const subset = await download('subset.pptx'); await inspect(subset, [2, 3], 200); await done();
  const zip = await JSZip.loadAsync(await readFile(subset));
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /cx="9144000" cy="5143500"/);
  check(true, 'range deduplication, original order and first selected page aspect ratio');
  await page.locator('#pdfPptRange').fill('9'); await page.locator('#pdfPptApplyRange').click();
  check(await page.locator('#pdfPptStatus').evaluate(node => node.classList.contains('is-error')), 'invalid range preserves the previous selection');
  await page.locator('#pdfPptNone').click(); check(await page.locator('#pdfPptExport').isDisabled(), 'empty selection blocks export');
  await page.locator('#pdfPptRange').fill('1'); await page.locator('#pdfPptApplyRange').click();
  await page.locator('[data-ppt-dpi="300"]').click(); const high = await download('300dpi.pptx'); await inspect(high, [1], 300); await done();
  check(true, '300 DPI retains source page dimensions');
  // Pause the packaging transport to cancel a real in-flight worker request.
  await page.evaluate(() => { pptTest.holdPage = true; pptTest.pagesSent = 0; });
  await page.locator('#pdfPptExport').click(); await page.waitForFunction(() => pptTest.pagesSent > 0);
  await page.locator('#pdfPptCancel').click(); await page.waitForFunction(() => !pptTest.controller.busy);
  check(await page.evaluate(() => pptTest.center.list()[0].state === 'cancelled'), 'cancel terminates packaging and records cancellation');
  await page.evaluate(() => { pptTest.holdPage = false; });
  await download('retry-after-cancel.pptx'); await done(); check(true, 'export succeeds again after cancellation');
  await page.evaluate(() => { pptTest.holdPage = true; pptTest.pagesSent = 0; });
  await page.locator('#pdfPptExport').click(); await page.waitForFunction(() => pptTest.pagesSent > 0);
  await page.evaluate(() => { pptTest.controller.close(); pptTest.controller.open(); });
  check(await page.locator('#pdfPptUpload').isVisible(), 'closing and reopening discards stale export state');
  await page.waitForFunction(() => pptTest.workers.size === 0);
  check(true, 'closing releases PDF and packaging workers');
  for (const [name, key] of [['broken.pdf', 'valid PDF'], ['locked.pdf', 'password'], ['too-many.pdf', '200-page']]) {
    await load(name);
    const text = await page.locator('#pdfPptUploadStatus').textContent();
    check(Boolean(text.trim()) && await page.locator('#pdfPptUploadStatus').evaluate(node => node.classList.contains('is-error')), `${name}: actionable error and unlocked picker`);
    if (name === 'locked.pdf') assert.match(text, /password/i);
  }
  await load('oversized.pdf'); await page.locator('[data-ppt-dpi="300"]').click(); await page.locator('#pdfPptExport').click();
  await page.waitForFunction(() => !pptTest.controller.busy);
  check(await page.locator('#pdfPptStatus').evaluate(node => node.classList.contains('is-error')), 'oversized render is rejected before canvas allocation');
  // Native adapter keeps raw bytes, failure recovery and the publication boundary visible.
  await fixture('dark', 'zh', true); await load();
  await page.evaluate(() => { pptTest.failSave = true; });
  await page.locator('#pdfPptExport').click(); await page.waitForFunction(() => !pptTest.controller.busy);
  check(await page.evaluate(() => pptTest.center.list()[0].state === 'failed'), 'native output failure retains loaded document for retry');
  await page.evaluate(() => { pptTest.failSave = false; pptTest.holdSave = true; });
  await page.locator('#pdfPptExport').click(); await page.waitForFunction(() => pptTest.calls.filter(call => call.command === 'write_unique_file_binary').length === 2);
  check(await page.locator('#pdfPptCancel').isDisabled(), 'saving disables cancellation');
  check(await page.evaluate(() => pptTest.controller.close() === false), 'saving vetoes navigation until the actual path returns');
  await page.evaluate(() => { pptTest.holdSave = false; }); await page.waitForFunction(() => !pptTest.controller.busy);
  check((await page.locator('#pdfPptSuccessPath').textContent()).endsWith('合同_slides_1.pptx'), 'success displays actual collision-resolved output path');
  await page.locator('#pdfPptFolder').click(); await page.waitForFunction(() => !!pptTest.revealed);
  check(await page.evaluate(() => pptTest.revealed === 'C:/QA 输出/合同_slides_1.pptx'), 'reveal targets the exported PPTX');
  check(await page.evaluate(() => pptTest.savedBytes instanceof Uint8Array), 'native output uses binary IPC');
  // Launch the registered tool through the built application's actual home catalog.
  production = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
  await page.close(); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(production.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await page.locator('.audio-list-item[data-tool="pdf-to-ppt"]').evaluate(node => node.click());
  await page.waitForSelector('#pdfPptOverlay.visible');
  await page.locator('#pdfPptFileInput').setInputFiles(inputPath);
  await page.waitForFunction(() => !document.getElementById('pdfPptExport').disabled);
  const builtDownload = page.waitForEvent('download'); await page.locator('#pdfPptExport').click();
  const builtFile = path.join(root, 'built-app.pptx'); await (await builtDownload).saveAs(builtFile); await inspect(builtFile, [1, 2, 3, 4], 200);
  await page.locator('#pdfPptDone').click();
  await page.locator('#pdfPptBack').click(); await page.waitForFunction(() => !document.getElementById('pdfPptOverlay').classList.contains('visible'));
  check(true, 'production home entry, lazy template, bundled worker, real export and return navigation');
  assert.equal(hash(await readFile(inputPath)), originalHash); check(true, 'input PDF hash stays unchanged');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); report.passed = true;
  console.log(`PDF to PPT browser acceptance: ${report.checks.length} checks, ${report.outputs.length} inspected PPTX files.`);
} catch (error) {
  report.failure = String(error.stack || error); await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error;
} finally { await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await server.close(); await production?.close(); }
