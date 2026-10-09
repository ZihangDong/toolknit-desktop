import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-to-scan');
await mkdir(output, { recursive: true });
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const [index, dimensions] of [[0, [360, 480]], [1, [480, 360]], [2, [360, 480]]]) {
  const page = source.addPage(dimensions);
  page.drawRectangle({ x: 0, y: 0, width: dimensions[0], height: dimensions[1], color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 30, y: 30, width: 100, height: 90, color: index === 1 ? rgb(0, .6, 0) : rgb(.85, .1, .1) });
  page.drawText(`Source page ${index + 1}`, { x: 30, y: dimensions[1] - 50, font, size: 18 });
  for (let row = 0; row < 4; row++) {
    page.drawLine({ start: { x: 30, y: 150 + row * 30 }, end: { x: 300, y: 150 + row * 30 }, thickness: 1 });
    page.drawText(`Table row ${row + 1}`, { x: 40, y: 158 + row * 30, font, size: 11 });
  }
  if (index === 2) page.setRotation(degrees(90));
}
const fixture = { name: '\u626b\u63cf-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) };
await writeFile(path.join(output, 'source.pdf'), fixture.buffer);
const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe');
const encrypted = path.join(output, 'encrypted.pdf');
assert.equal(spawnSync(qpdf, ['--encrypt', 'test-password', 'owner-password', '256', '--', path.join(output, 'source.pdf'), encrypted]).status, 0);
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER
  ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : { channel: 'msedge' }) });
const errors = [], checks = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1401, height: 920 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
  await page.goto(url);
  async function open(tool = 'pdf-to-scan', overlay = 'pdfScanOverlay') {
    await page.locator(`.audio-list-item[data-tool="${tool}"]`).first().evaluate(node => node.click());
    await page.waitForSelector(`#${overlay}.visible`);
    await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
      || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  }
  async function loaded(file = fixture) {
    await page.locator('#pdfScanFileInput').setInputFiles(file);
    await page.waitForFunction(() => !document.querySelector('#pdfScanExport').disabled);
    await page.waitForFunction(() => document.querySelector('#pdfScanOverlay [data-wb-canvas]').width > 100);
  }
  async function screenshot(name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }
  async function verifyEmptyLayout(language, theme, width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      document.querySelector('#pdfScanUpload').scrollTop = 0;
      document.querySelector('.pdf-scan-empty-workspace').scrollTop = 0;
    }, theme);
    await page.waitForTimeout(300);
    const layout = await page.locator('.pdf-scan-empty-workspace').evaluate(workspace => {
      const bounds = node => node.getBoundingClientRect().toJSON();
      const state = workspace.querySelector('.pdf-scan-empty-state');
      const children = [...state.children];
      const info = workspace.querySelector('.pdf-scan-upload-info');
      return {
        display: getComputedStyle(workspace).display,
        workspace: bounds(workspace), state: bounds(state),
        uploadOverflows: workspace.parentElement.scrollWidth > workspace.parentElement.clientWidth + 1,
        workspaceOverflows: workspace.scrollWidth > workspace.clientWidth + 1,
        children: children.map(bounds),
        heading: bounds(workspace.querySelector('h2')),
        button: bounds(workspace.querySelector('#pdfScanPick')),
        icons: [...info.querySelectorAll('svg')].map(bounds),
        modeTitles: [...info.querySelectorAll('strong')].map(bounds)
      };
    });
    const detail = JSON.stringify({ language, theme, width, height, layout });
    assert.equal(layout.display, 'flex', detail);
    assert.equal(layout.uploadOverflows || layout.workspaceOverflows, false, detail);
    for (const child of layout.children) {
      assert.ok(child.top >= layout.state.top && child.bottom <= layout.state.bottom + 1, detail);
      assert.ok(child.left >= layout.workspace.left && child.right <= layout.workspace.right, detail);
    }
    for (const box of [layout.heading, layout.button]) {
      assert.ok(Math.abs(box.x + box.width / 2 - layout.workspace.x - layout.workspace.width / 2) < 2, detail);
    }
    if (width >= 1280) {
      assert.ok(layout.modeTitles.every(box => Math.abs(box.top - layout.modeTitles[0].top) < 1), detail);
      assert.ok(layout.icons.every(box => Math.abs(box.top - layout.icons[0].top) < 1), detail);
    }
    if (width >= 1400 && height >= 900) {
      const first = layout.children[0], last = layout.children.at(-1);
      const topSpace = first.top - layout.workspace.top;
      const bottomSpace = layout.workspace.bottom - last.bottom;
      assert.ok(topSpace > 28 && Math.abs(topSpace - bottomSpace) < 80, detail);
      assert.ok(last.bottom < height, detail);
    }
    for (const selector of ['.pdf-scan-empty-mark', '.pdf-scan-empty-note', '#pdfScanPick']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1
        && box.y >= 0 && box.y + box.height <= height + 1, JSON.stringify({ selector, box, width, height }));
    }
    await page.evaluate(() => {
      document.querySelector('#pdfScanUpload').scrollTop = 0;
      document.querySelector('.pdf-scan-empty-workspace').scrollTop = 0;
    });
    await screenshot(`empty-${language}-${theme}-${width}x${height}`);
  }
  async function verifyExport(mode, dimensions) {
    const pending = page.waitForEvent('download');
    await page.locator('#pdfScanExport').click();
    const download = await pending;
    await page.waitForSelector('#pdfScanSuccessOverlay.visible');
    const saved = path.join(output, `${mode}.pdf`); await download.saveAs(saved);
    assert.equal(spawnSync(qpdf, ['--check', saved]).status, 0);
    const bytes = await readFile(saved), doc = await PDFDocument.load(bytes);
    assert.deepEqual(doc.getPages().map(p => [p.getWidth(), p.getHeight()]), dimensions);
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
    const parsed = await task.promise;
    try {
      for (let number = 1; number <= parsed.numPages; number++) {
        assert.equal((await (await parsed.getPage(number)).getTextContent()).items.length, 0);
      }
    } finally { await task.destroy(); }
    for (let index = 0; index < doc.getPageCount(); index++) {
      const resources = doc.getPage(index).node.Resources().lookup(PDFName.of('XObject'));
      assert.equal(resources.keys().length, 1);
      const image = resources.lookup(resources.keys()[0]);
      const pixels = await page.evaluate(async data => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0, colored = 0, warm = 0, green = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          const [r, g, b] = rgba.subarray(i, i + 3);
          if (r < 150 && g < 150 && b < 150) dark++;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colored++;
          if (r - b > 2 && r > 220) warm++;
          if (g > r + 30 && g > b + 30) green++;
        }
        return { dark, colored, warm, green, width: canvas.width, height: canvas.height };
      }, Array.from(image.contents));
      assert.ok(pixels.dark > 100, JSON.stringify(pixels));
      assert.equal(pixels.width, Math.ceil(dimensions[index][0] * 150 / 72));
      assert.equal(pixels.height, Math.ceil(dimensions[index][1] * 150 / 72));
      if (mode === 'grayscale') assert.ok(pixels.colored < 10);
      else assert.ok(pixels.colored > 1000);
      if (mode === 'natural') assert.ok(pixels.warm > 1000);
      if (mode === 'faithful') assert.equal(pixels.green > 1000, index === 1);
    }
    assert.equal(await page.locator('#pdfScanOverlay').evaluate(n => n.inert), true);
    assert.equal(await page.locator('#pdfScanSuccessOk').evaluate(n => n === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#pdfScanSuccessOk').evaluate(n => n === document.activeElement), true);
    await screenshot(`${mode}-success`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pdfScanSuccessOverlay.visible', { state: 'hidden' });
    assert.equal(await page.locator('#pdfScanOverlay').evaluate(n => n.inert), false);
  }
  await open();
  assert.equal(await page.locator('#pdfScanOverlay .tool-page-v2-topbar').count(), 1);
  const uploadBox = await page.locator('#pdfScanUpload').boundingBox();
  assert.ok(uploadBox.height > 700);
  for (const language of ['zh', 'en']) {
    await page.evaluate(value => document.querySelector(`[data-lang="${value}"]`).click(), language);
    await page.waitForFunction(value => document.documentElement.lang === (value === 'zh' ? 'zh-CN' : 'en')
      && !document.body.classList.contains('fade-in'), language);
    for (const theme of ['light', 'dark']) {
      const sizes = language === 'zh'
        ? [[1920, 919], [1401, 920], [1280, 520], [720, 820], [390, 740]]
        : [[1401, 920], [1280, 520], [390, 740]];
      for (const [width, height] of sizes) await verifyEmptyLayout(language, theme, width, height);
    }
  }
  checks.push('Empty state: centered content, aligned mode columns, no clipping/overflow and reachable controls in both themes/languages at desktop, low and narrow sizes');
  await page.setViewportSize({ width: 1401, height: 920 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    document.querySelector('[data-lang="zh"]').click();
  });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN'
    && !document.body.classList.contains('fade-in'));
  await page.locator('#pdfScanPick').click();
  await screenshot('light-empty');
  await loaded();
  await screenshot('light-loaded');
  assert.equal(await page.locator('#pdfScanPages .pdf-editor-tile').count(), 3);
  await page.locator('[data-scan-dpi="150"]').click();
  await screenshot('light-loaded');
  const before = await page.locator('#pdfScanOverlay .pdf-editor-preview').boundingBox();
  await page.locator('#pdfScanExpand').click(); await page.waitForTimeout(300);
  const after = await page.locator('#pdfScanOverlay .pdf-editor-preview').boundingBox();
  assert.ok(after.width > before.width + 150);
  assert.equal(await page.locator('#pdfScanOverlay .pdf-editor-page-sidebar').evaluate(n => n.inert), true);
  await screenshot('light-expanded'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pdfScanOverlay.visible').count(), 1);
  await page.locator('#pdfScanRange').fill('3, 1-2, 2'); await page.locator('#pdfScanApplyRange').click();
  await verifyExport('faithful', [[360, 480], [480, 360], [480, 360]]);
  await page.locator('#pdfScanRange').fill('2-1'); await page.locator('#pdfScanApplyRange').click();
  assert.equal(await page.locator('#pdfScanStatus.is-error').count(), 1);
  await page.locator('#pdfScanRange').fill('1, 3'); await page.locator('#pdfScanApplyRange').click();
  await page.locator('[data-scan-mode="grayscale"]').click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await screenshot('dark-loaded');
  await verifyExport('grayscale', [[360, 480], [480, 360]]);
  await page.locator('[data-scan-mode="natural"]').click(); await page.locator('#pdfScanAdvanced summary').click();
  await page.locator('[data-scan-preview="original"]').click(); await screenshot('dark-original');
  await page.locator('[data-scan-preview="effect"]').click(); await page.waitForTimeout(500); await screenshot('dark-effect');
  await verifyExport('natural', [[360, 480], [480, 360]]);
  checks.push('Real JPEG/PDF export: qpdf, empty text layers, color/grayscale/warmth, dimensions, rotation, order, selection and modal focus');
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.waitForFunction(() => document.documentElement.lang === 'en'
    && !document.body.classList.contains('fade-in'));
  assert.match(await page.locator('#pdfScanExport').innerText(), /Export/);
  await screenshot('english');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const [width, height] of [[1280, 520], [720, 820], [390, 740]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
      await page.locator('#pdfScanExport').scrollIntoViewIfNeeded();
      const box = await page.locator('#pdfScanExport').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, JSON.stringify({ width, height, box }));
      await screenshot(`${theme}-${width}x${height}`);
    }
  }
  await page.setViewportSize({ width: 1401, height: 920 });
  await page.evaluate(() => document.querySelector('[data-lang="zh"]').click());
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN'
    && !document.body.classList.contains('fade-in'));
  await page.locator('#pdfScanExpand').click(); await page.locator('#pdfScanReset').click();
  assert.equal(await page.locator('#pdfScanOverlay .pdf-editor-page-sidebar').evaluate(n => n.inert), false);
  await page.locator('#pdfScanFileInput').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-invalid') });
  await page.waitForSelector('#pdfScanUploadStatus.is-error');
  await screenshot('invalid');
  await page.locator('#pdfScanFileInput').setInputFiles(encrypted);
  await page.waitForSelector('#pdfScanPasswordOverlay.visible');
  await page.locator('#pdfScanPassword').fill('wrong'); await page.locator('#pdfScanPasswordForm button[type="submit"]').click();
  await page.waitForSelector('#pdfScanPasswordOverlay.visible');
  await page.waitForFunction(() => document.querySelector('#pdfScanPasswordHint').textContent.includes('\u5bc6\u7801')
      && document.querySelector('#pdfScanPassword') === document.activeElement);
  await page.locator('#pdfScanPassword').fill('test-password'); await page.locator('#pdfScanPasswordForm button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#pdfScanExport').disabled);
  await page.locator('#pdfScanReset').click();
  await page.locator('#pdfScanFileInput').setInputFiles(encrypted); await page.waitForSelector('#pdfScanPasswordOverlay.visible');
  await page.keyboard.press('Escape'); await page.waitForSelector('#pdfScanPasswordOverlay.visible', { state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('#pdfScanPick').disabled);
  await loaded();
  await page.locator('#pdfScanExport').click(); await page.locator('#pdfScanCancel').click();
  await page.waitForFunction(() => !document.querySelector('#pdfScanExport').disabled);
  assert.match(await page.locator('#pdfScanStatus').innerText(), /\u53d6\u6d88/);
  assert.equal(await page.locator('#pdfScanSuccessOverlay.visible').count(), 0);
  await page.keyboard.press('Escape'); await open();
  assert.equal(await page.locator('#pdfScanUpload').isVisible(), true);
  assert.equal(await page.locator('#pdfScanPages .pdf-editor-tile').count(), 0);
  await loaded(); await page.locator('#pdfScanBack').click(); await open();
  assert.equal(await page.locator('#pdfScanUpload').isVisible(), true);
  await page.locator('#pdfScanFileInput').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await page.waitForSelector('#pdfScanUploadStatus.is-error');
  const manyPages = await PDFDocument.create();
  for (let i = 0; i < 101; i++) manyPages.addPage([360, 480]);
  await page.locator('#pdfScanFileInput').setInputFiles({ name: '101-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await manyPages.save()) });
  await page.waitForFunction(() => document.querySelector('#pdfScanUploadStatus').textContent.includes('100'));
  assert.equal(await page.locator('#pdfScanExport').isDisabled(), true);
  const oversized = await PDFDocument.create(); oversized.addPage([2400, 3400]);
  await loaded({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await oversized.save()) });
  await page.locator('#pdfScanExport').click();
  await page.waitForSelector('#pdfScanProcessOverlay.visible', { state: 'hidden' });
  await page.waitForSelector('#pdfScanStatus.is-error');
  assert.equal(await page.locator('#pdfScanSuccessOverlay.visible').count(), 0);
  await page.locator('#pdfScanReset').click(); await loaded();
  await page.locator('#pdfScanNone').click();
  assert.equal(await page.locator('#pdfScanExport').isDisabled(), true);
  await page.locator('#pdfScanAll').click(); await page.locator('#pdfScanExport').click();
  await page.evaluate(() => document.querySelector('#pdfScanBack').click());
  await open(); await page.waitForTimeout(500);
  assert.equal(await page.locator('#pdfScanUpload').isVisible(), true);
  assert.equal(await page.locator('#pdfScanProcessOverlay.visible, #pdfScanSuccessOverlay.visible').count(), 0);
  await page.locator('#pdfScanFileInput').setInputFiles(encrypted);
  await page.waitForSelector('#pdfScanPasswordOverlay.visible');
  await page.evaluate(() => document.querySelector('#pdfScanBack').click()); await open();
  assert.equal(await page.locator('#pdfScanPasswordOverlay.visible').count(), 0);
  assert.equal(await page.locator('#pdfScanPassword').inputValue(), '');
  await loaded();
  checks.push('Empty input, 101-page rejection, oversized-page rejection, deselection and close/reopen during conversion/password loading');
  checks.push('Both themes, English/Chinese, responsive controls, invalid file, password retry/cancel, conversion cancel, reset and reopen');
  await page.keyboard.press('Escape');
  for (const [tool, overlay] of [['pdf-to-image', 'pdfToImageOverlay'], ['ppt-to-pdf', 'pptToPdfOverlay'],
    ['markdown-editor', 'markdownEditorOverlay'], ['hardware-overview', 'hardwareOverviewOverlay']]) {
    await open(tool, overlay); await screenshot(`smoke-${tool}`); await page.keyboard.press('Escape');
    await page.waitForSelector(`#${overlay}.visible`, { state: 'hidden' });
  }
  checks.push('Shared-boundary smoke: existing PDF, PPT, Markdown and hardware pages');
  await page.locator('#homeV2Settings').click();
  await page.waitForSelector('#settingsOverlay.visible');
  await page.locator('#helpLink').click();
  await page.waitForSelector('#helpOverlay.visible');
  await page.locator('[data-help-section="pdf-to-scan"]').click();
  assert.match(await page.locator('#helpContentTitle').innerText(), /\u626b\u63cf/);
  assert.match(await page.locator('#helpContentBody').innerText(), /64 MB/);
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.waitForFunction(() => document.documentElement.lang === 'en'
    && document.querySelector('#helpContentTitle').textContent.includes('Scanned PDF')
    && !document.body.classList.contains('fade-in'));
  assert.match(await page.locator('[data-help-section="pdf-to-scan"]').innerText(), /Scanned PDF/);
  assert.match(await page.locator('#helpContentBody').innerText(), /OCR/);
  await page.locator('#helpBackBtn').click();
  await page.waitForSelector('#helpOverlay.visible', { state: 'hidden' });
  checks.push('Help center entry, workflow and limits in Chinese and English');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(checks.join('\n'));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    const layout = await page.evaluate(() => ['#pdfScanUpload', '.pdf-workbench-body', '.pdf-editor-tool-panel', '#pdfScanActions', '[data-scan-dpi="150"]']
      .map(selector => {
        const node = document.querySelector(`#pdfScanOverlay ${selector}`), style = node && getComputedStyle(node);
        return { selector, bounds: node?.getBoundingClientRect().toJSON(), display: style?.display,
          position: style?.position, opacity: style?.opacity, visibility: style?.visibility,
          overflow: style?.overflow, zIndex: style?.zIndex };
      }));
    console.error(JSON.stringify({ layout, errors }, null, 2));
  }
  throw error;
} finally { await browser.close(); await server.close(); }
