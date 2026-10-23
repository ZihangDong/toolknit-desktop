import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import JSZip from 'jszip';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-split-workbench');
await mkdir(output, { recursive: true });
const fixtures = [];
for (const [name, count] of [['source-a.pdf', 24], ['source-b.pdf', 2]]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < count; index++) {
    const page = pdf.addPage([420 + index * 2, 595]);
    page.drawText(`${name} / PAGE ${index + 1}`, { x: 30, y: 500, font, size: 18 });
    if (index === 1) page.setRotation(degrees(90));
  }
  fixtures.push({ name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
}
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { checks: [], errors: [], warnings: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
  const url = server.resolvedUrls.local[0];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light');
    localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text()); });
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card');
  await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-split"]').click());
  await page.waitForSelector('#pdfSplitOverlay.visible');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#pdfSplitCta').click();
  await (await chooser).setFiles(fixtures);
  await page.locator('#pdfSplitProcessBtn').click();
  await page.waitForSelector('#pdfSplitWorkspace.visible');
  await page.waitForFunction(() => document.querySelector('[data-wb-canvas]')?.width > 10);
  await page.waitForSelector('#pdfSplitPageStrip .is-ready');
  const wb = page.locator('#pdfSplitWorkspace');
  assert.equal(await wb.locator('.pdf-editor-tile').count(), 26);
  assert.equal(await page.locator('#pdfSplitOverlay').evaluate(n => n.inert), true);
  assert.equal(await wb.evaluate(n => n.inert), false);
  assert.equal(await wb.locator('[data-tool-window]').count(), 3);
  const initialRendered = await wb.locator('.pdf-editor-tile-canvas').count();
  assert.ok(initialRendered < 26, 'thumbnails must load on demand');
  const pixels = await wb.locator('[data-wb-canvas]').evaluate(n => {
    const data = n.getContext('2d').getImageData(0, 0, n.width, n.height).data;
    let dark = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 3]) dark++;
    return dark;
  });
  assert.ok(pixels > 50, 'preview must contain rendered text');
  assert.equal(await wb.locator('.pdf-editor-tile.is-selected').count(), 0);
  assert.equal(await page.locator('#pdfSplitDownloadAllBtn').isDisabled(), true);
  assert.equal(await page.locator('#pdfSplitDownloadZipBtn').isDisabled(), true);
  assert.equal(await page.locator('#pdfSplitDownloadCurrentBtn').isDisabled(), false);
  await page.screenshot({ path: path.join(output, 'light.png') });
  report.checks.push('26 pages / two sources / lazy thumbnails / rendered preview / complete chrome');

  const range = page.locator('#pdfSplitRangeDialog');
  const rangeInput = page.locator('#pdfSplitRangeInput');
  const chosenPages = () => wb.locator('.pdf-editor-tile.is-selected').evaluateAll(nodes => nodes.map(node => Number(node.dataset.index) + 1));
  async function addRange(text, enter = false) {
    await rangeInput.fill(text);
    if (enter) await rangeInput.press('Enter'); else await range.locator('[type="submit"]').click();
    assert.equal(await rangeInput.inputValue(), '');
    assert.equal(await rangeInput.evaluate(node => document.activeElement === node), true);
  }
  await page.locator('#pdfSplitRangeBtn').click();
  assert.equal(await wb.evaluate(node => node.inert), true);
  await addRange('1-10');
  assert.equal((await chosenPages()).length, 10);
  await addRange('15-20', true);
  const disjoint = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20];
  assert.deepEqual(await chosenPages(), disjoint);
  await addRange('3-8');
  assert.deepEqual(await chosenPages(), disjoint);
  assert.match(await range.locator('[data-range-status]').innerText(), /没有重复/);
  for (const invalid of ['', '20-15', '0-4', '1-27', '1-3,9', '1.5-2']) {
    await rangeInput.fill(invalid); await range.locator('[type="submit"]').click();
    assert.equal(await rangeInput.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#pdfSplitRangeError').isVisible(), true);
    assert.deepEqual(await chosenPages(), disjoint);
    assert.equal(await rangeInput.inputValue(), invalid);
  }
  await rangeInput.fill('1-10');
  assert.equal(await rangeInput.getAttribute('aria-invalid'), 'false');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const [width, height] of [[1400, 887], [720, 480], [390, 700]]) {
      await page.setViewportSize({ width, height });
      await rangeInput.focus(); await page.waitForTimeout(250);
      const style = await rangeInput.evaluate(node => {
        const css = getComputedStyle(node), box = node.getBoundingClientRect();
        return { outline: css.outlineStyle, shadow: css.boxShadow, ink: css.color,
          underline: css.getPropertyValue('--tk-field-height').trim(), fits: box.left >= 0 && box.right <= innerWidth };
      });
      assert.equal(style.outline, 'none'); assert.equal(style.shadow, 'none'); assert.equal(style.underline, '3px'); assert.equal(style.fits, true);
      assert.equal(style.ink, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
      const card = await range.locator('form').boundingBox();
      assert.ok(card && card.x >= 0 && card.y >= 0 && card.x + card.width <= width && card.y + card.height <= height);
      const submit = await range.locator('[type="submit"]').boundingBox();
      assert.ok(submit && submit.y + submit.height <= height, 'Modal action must remain visible.');
      await page.screenshot({ path: path.join(output, `range-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.querySelector('[data-lang="en"]').click(); });
  await page.waitForFunction(() => document.querySelector('#pdfSplitRangeHelp').textContent.includes('11-14 stay unselected'));
  assert.match(await range.locator('[data-range-limit]').innerText(), /1-26/);
  assert.match(await page.locator('#pdfSplitRangeHelp').innerText(), /11-14 stay unselected/);
  await page.screenshot({ path: path.join(output, 'range-english.png') });
  await rangeInput.press('Escape');
  assert.equal(await range.evaluate(node => node.inert && !node.classList.contains('visible')), true);
  assert.equal(await wb.evaluate(node => !node.inert && node.classList.contains('visible')), true);
  assert.equal(await page.locator('#pdfSplitRangeBtn').evaluate(node => document.activeElement === node), true);
  await page.evaluate(() => document.querySelector('[data-lang="zh"]').click());
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  const rangesPdf = await PDFDocument.load(await download('#pdfSplitDownloadAllBtn'));
  assert.equal(rangesPdf.getPageCount(), 16);
  assert.deepEqual(rangesPdf.getPages().map(page => page.getWidth()), disjoint.map(page => 420 + (page - 1) * 2));
  await wb.locator('.pdf-editor-tile-select').nth(2).click();
  await page.locator('#pdfSplitRangeBtn').click();
  assert.equal(await rangeInput.inputValue(), '');
  await addRange('24-26');
  assert.deepEqual(await chosenPages(), [...disjoint.filter(page => page !== 3), 24, 25, 26]);
  await range.locator('[data-range-close]').last().click();
  await page.locator('#pdfSplitRangeBtn').click();
  await rangeInput.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await range.locator('[type="submit"]').evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Tab');
  assert.equal(await range.locator('[data-range-close]').first().evaluate(node => document.activeElement === node), true);
  await range.locator('[data-range-close]').first().click();
  await page.locator('#pdfSplitSelectAllBtn').click();
  assert.equal(await wb.locator('.pdf-editor-tile.is-selected').count(), 26);
  report.checks.push('default empty / additive 1-10 + 15-20 / actual 16-page export / overlap / validation / cross-file range / retained manual deselection / modal themes and sizes / focus and keyboard');
  await wb.locator('[data-tool-settings]').click();
  await page.waitForSelector('#settingsOverlay.visible');
  await page.locator('#settingsBack').click();
  await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
  assert.equal(await wb.evaluate(n => n.classList.contains('visible') && !n.inert), true);
  // Keep the worker script pending so cancellation is tested before any output can be published.
  let releaseWorker, workerRequested;
  const held = new Promise(resolve => { releaseWorker = resolve; });
  const requested = new Promise(resolve => { workerRequested = resolve; });
  await context.route('**/export-worker-*.js', async route => {
    workerRequested(); await held; await route.continue().catch(() => {});
  });
  let cancelledDownloads = 0;
  const countCancelled = () => { cancelledDownloads++; };
  page.on('download', countCancelled);
  await page.locator('#pdfSplitDownloadZipBtn').click();
  await requested;
  await page.locator('#pdfSplitProcessCancel').click();
  releaseWorker();
  await context.unroute('**/export-worker-*.js');
  await page.waitForTimeout(450);
  page.off('download', countCancelled);
  assert.equal(cancelledDownloads, 0);
  assert.equal(await page.locator('#pdfSplitDownloadZipBtn').isDisabled(), false);
  report.checks.push('cancel pending worker: no download, controls restored');
  await wb.locator('.pdf-editor-tile').nth(1).click();
  await page.waitForFunction(() => document.querySelector('[data-wb-source-page]').textContent.includes('2'));
  await wb.locator('.pdf-editor-tile-select').nth(1).click();
  assert.match(await page.locator('#pdfSplitDownloadAllBtn').innerText(), /所选/);
  async function download(button) {
    const pending = page.waitForEvent('download');
    await page.locator(button).click();
    const file = await pending;
    const bytes = await readFile(await file.path());
    await page.waitForSelector('#pdfSplitSuccessOverlay.visible');
    await page.locator('#pdfSplitSuccessOk').click();
    assert.equal(await wb.evaluate(n => n.inert), false);
    return bytes;
  }
  const current = await PDFDocument.load(await download('#pdfSplitDownloadCurrentBtn'));
  assert.equal(current.getPageCount(), 1);
  assert.equal(current.getPage(0).getRotation().angle, 90);
  assert.equal(current.getPage(0).getWidth(), 422);
  const selected = await PDFDocument.load(await download('#pdfSplitDownloadAllBtn'));
  assert.equal(selected.getPageCount(), 25);
  assert.equal(selected.getPage(1).getWidth(), 424);
  const zip = await JSZip.loadAsync(await download('#pdfSplitDownloadZipBtn'));
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  assert.equal(entries.length, 25);
  for (const entry of entries) assert.equal((await PDFDocument.load(await entry.async('uint8array'))).getPageCount(), 1);
  report.checks.push('current unselected page / selected combined PDF / ZIP with 25 valid single-page PDFs');
  await page.locator('#pdfSplitSelectAllBtn').click();
  await page.locator('#pdfSplitSelectAllBtn').click();
  assert.equal(await page.locator('#pdfSplitDownloadAllBtn').isDisabled(), true);
  assert.equal(await page.locator('#pdfSplitDownloadZipBtn').isDisabled(), true);
  assert.equal(await page.locator('#pdfSplitDownloadCurrentBtn').isDisabled(), false);
  await page.locator('#pdfSplitSelectAllBtn').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const primary = page.locator('#pdfSplitDownloadAllBtn');
    await page.mouse.move(1, 1);
    await page.waitForTimeout(180);
    const idlePrimary = await primary.evaluate(node => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor };
    });
    assert.equal(idlePrimary.color, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)');
    assert.equal(idlePrimary.background, theme === 'light' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)');
    await primary.hover();
    await page.waitForTimeout(180);
    const hoverPrimary = await primary.evaluate(node => {
      const style = getComputedStyle(node);
      const iconStyle = getComputedStyle(node.querySelector('svg'));
      return {
        color: style.color,
        background: style.backgroundColor,
        iconColor: iconStyle.color,
        iconStroke: iconStyle.stroke
      };
    });
    assert.equal(hoverPrimary.color, 'rgb(255, 255, 255)');
    assert.equal(hoverPrimary.background, 'rgb(48, 48, 48)');
    assert.equal(hoverPrimary.iconColor, 'rgb(255, 255, 255)');
    assert.equal(hoverPrimary.iconStroke, 'rgb(255, 255, 255)');
    for (const [width, height] of [[1400, 887], [1100, 600], [900, 520], [720, 480]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#pdfSplitDownloadZipBtn').scrollIntoViewIfNeeded();
      const box = await page.locator('#pdfSplitDownloadZipBtn').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`) });
    }
  }
  await page.locator('#pdfSplitSelectAllBtn').click();
  const disabledPrimary = page.locator('#pdfSplitDownloadAllBtn');
  assert.equal(await disabledPrimary.isDisabled(), true);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(180);
  const disabledIdle = await disabledPrimary.evaluate(node => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor, opacity: style.opacity };
  });
  await disabledPrimary.hover();
  await page.waitForTimeout(180);
  const disabledHover = await disabledPrimary.evaluate(node => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor, opacity: style.opacity };
  });
  assert.deepEqual(disabledHover, disabledIdle);
  await page.locator('#pdfSplitSelectAllBtn').click();
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.waitForFunction(() => document.querySelector('#pdfSplitDownloadCurrentBtn').textContent.includes('Export current'));
  assert.match(await wb.locator('[data-tool-website]').innerText(), /Web version/);
  await page.screenshot({ path: path.join(output, 'english.png') });
  await page.locator('#pdfSplitWorkspaceClose').click();
  assert.equal(await page.locator('#pdfSplitFiles .audio-convert-file-item').count(), 2);
  assert.equal(await wb.locator('.pdf-editor-tile').count(), 0);
  await page.locator('#pdfSplitProcessBtn').click();
  await page.waitForSelector('#pdfSplitWorkspace.visible');
  assert.equal(await wb.locator('.pdf-editor-tile.is-selected').count(), 0, 'Reopening starts with no pages selected.');
  await page.locator('#pdfSplitWorkspaceClose').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#pdfSplitWorkspace').classList.contains('visible'));
  assert.equal(await page.locator('#pdfSplitOverlay').evaluate(n => n.inert), false);
  await page.locator('#pdfSplitBack').click();
  report.checks.push('empty selection / dark and light / four window sizes / English / return retains inputs / reopen / Escape');
  assert.deepEqual(report.errors, []);
  assert.ok(!report.warnings.some(text => /aria-hidden|ICCBased|cMapUrl/.test(text)), report.warnings.join('\n'));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
