import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = 'tmp/pdf-input-interactions';
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 8; i++) {
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 60, y: 140, width: 460, height: 500, color: rgb(.9, .94, .96) });
  page.drawText(`Preview anchor test ${i + 1}`, { x: 80, y: 710, size: 22, font });
}
const file = { name: 'preview.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
const bitmap = createCanvas(700, 1000), ctx = bitmap.getContext('2d');
ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 700, 1000); ctx.fillStyle = '#111111';
ctx.font = '36px sans-serif'; ctx.fillText('ToolKnit PDF preview', 80, 120); ctx.fillRect(100, 300, 400, 400);
const image = { name: 'preview.png', mimeType: 'image/png', buffer: bitmap.toBuffer('image/png') };
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { checks: [], errors: [] };
let page;
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}' }));
    await context.addInitScript(theme => {
      localStorage.setItem('toolknit.theme.v3', theme); localStorage.setItem('toolknit-lang', 'zh');
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    }, theme);
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message));
    const settle = () => page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]') || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
    async function open(tool, root) {
      await page.goto(url); await page.locator('#homeToolGrid .tool-result-card').first().waitFor();
      await page.locator(`.audio-list-item[data-tool="${tool}"]`).first().evaluate(node => node.click());
      await page.locator(root + '.visible').waitFor(); await settle();
    }
    async function field(selector) {
      const node = page.locator(selector), before = await node.boundingBox();
      await node.focus(); await page.waitForTimeout(260);
      const style = await node.evaluate(el => {
        const css = getComputedStyle(el); return { outline: css.outlineStyle, shadow: css.boxShadow, height: css.getPropertyValue('--tk-field-height').trim(), fill: css.getPropertyValue('--tk-field-fill').trim(), accent: css.getPropertyValue('--tk-field-accent').trim(), background: css.backgroundImage };
      });
      assert.equal(style.outline, 'none', selector); assert.equal(style.shadow, 'none', selector);
      assert.equal(style.height, '3px', selector); assert.equal(style.fill, '100%', selector);
      assert.equal(style.accent, theme === 'light' ? '#111' : '#fff', selector);
      assert.deepEqual(await node.boundingBox(), before, 'focus must not move the field');
      report.checks.push({ theme, field: selector, style });
    }
    async function zoom(viewSelector, paperSelector, name) {
      const view = page.locator(viewSelector), paper = page.locator(paperSelector);
      await paper.waitFor(); await page.waitForTimeout(450);
      const box = await view.boundingBox(), x = box.x + box.width * .55, y = box.y + box.height * .45;
      await page.mouse.move(x, y);
      const initial = await paper.boundingBox();
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -220); await page.waitForTimeout(55); }
      await page.waitForTimeout(650);
      const enlarged = await paper.boundingBox(); assert.ok(enlarged.width > initial.width * 1.4, `${name}: wheel must zoom`);
      // Move the anchor while the previous high-resolution render is still deferred.
      for (let i = 0; i < 3; i++) {
        const px = x + i * 60, py = y + i * 40, before = await paper.boundingBox();
        const pu = (px - before.x) / before.width, pv = (py - before.y) / before.height;
        await page.mouse.move(px, py); await page.mouse.wheel(0, -40); await page.waitForTimeout(40);
        const after = await paper.boundingBox();
        assert.ok(Math.hypot(after.x + after.width * pu - px, after.y + after.height * pv - py) <= 3, `${name}: moving anchor during burst`);
      }
      await page.waitForTimeout(500); await page.mouse.move(x, y);
      const a = await paper.boundingBox(), u = (x - a.x) / a.width, v = (y - a.y) / a.height;
      await page.mouse.wheel(0, -100); await page.waitForTimeout(600);
      const b = await paper.boundingBox();
      const drift = Math.hypot(b.x + b.width * u - x, b.y + b.height * v - y);
      assert.ok(drift <= 3, `${name}: anchor drift ${drift}`);
      const start = await view.evaluate(el => [el.scrollLeft, el.scrollTop]);
      await page.mouse.down({ button: 'middle' }); await page.mouse.move(x - 50, y - 45, { steps: 8 });
      await page.waitForTimeout(50); await page.mouse.up({ button: 'middle' });
      const finish = await view.evaluate(el => [el.scrollLeft, el.scrollTop]);
      assert.ok(Math.hypot(finish[0] - start[0], finish[1] - start[1]) > 20, `${name}: middle pan`);
      await page.mouse.move(x, y);
      for (let i = 0; i < 18; i++) { await page.mouse.wheel(0, -500); await page.waitForTimeout(20); }
      await page.waitForTimeout(650);
      const maxScroll = await view.evaluate(el => [el.scrollLeft, el.scrollTop]);
      await page.mouse.wheel(0, -500); await page.waitForTimeout(250);
      assert.deepEqual(await view.evaluate(el => [el.scrollLeft, el.scrollTop]), maxScroll, `${name}: no scrolling at zoom limit`);
      report.checks.push({ theme, tool: name, drift }); console.log(`${theme} ${name}: anchor ${drift.toFixed(2)}px, pan and limits passed`);
    }
    await open('image-to-pdf', '#imagePdfOverlay');
    await page.screenshot({ path: `${output}/${theme}-empty.png` });
    assert.equal(await page.locator('#imagePdfEmpty .tk-empty-hero-icon').evaluate(el => getComputedStyle(el).borderRadius), '50%');
    await page.locator('#imagePdfInput').setInputFiles(image);
    await page.waitForFunction(() => document.querySelector('#imagePdfPreview').naturalWidth > 0 && !document.querySelector('#imagePdfExport').disabled);
    await field('#imagePdfName'); await page.screenshot({ path: `${output}/${theme}-focus.png` });
    await zoom('#imagePdfStage', '#imagePdfPreview', 'image-to-pdf');
    await page.locator('#imagePdfName').fill('A'.repeat(90));
    const download = page.waitForEvent('download'); await page.locator('#imagePdfExport').click(); await download;
    await page.locator('#imagePdfSuccess.visible').waitFor(); await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${theme}-success.png` });
    assert.ok((await page.locator('#imagePdfSuccess .audio-clip-success-dialog').boundingBox()).width <= 500);
    assert.equal(await page.locator('#imagePdfResultName').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'long name wraps');
    // Exercise the same three-action layout used by the native success state.
    await page.locator('#imagePdfSuccess').evaluate(el => { el.querySelector('#imagePdfOpen').hidden = false; el.querySelector('#imagePdfFolder').hidden = false; });
    for (const [width, height] of [[800, 600], [390, 650]]) {
      await page.setViewportSize({ width, height });
      const button = await page.locator('#imagePdfDone').boundingBox();
      assert.ok(button.x >= 0 && button.x + button.width <= width && button.y + button.height <= height);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const cases = [
      ['pdf-to-word', 'pdfWord', 'FileInput', '#pdfWordPreview', '#pdfWordPaper'],
      ['pdf-crop', 'pdfCrop', 'FileInput', '#pdfCropCanvasScroll', '#pdfCropCanvasWrap'],
      ['pdf-page-number', 'pdfPageNumber', 'FileInput', '#pdfPageNumberCanvasScroll', '#pdfPageNumberCanvasWrap'],
      ['pdf-editor', 'pdfEditor', 'FileInput', '#pdfEditorCanvasScroll', '#pdfEditorOverlay .pdf-editor-canvas-wrap'],
      ['pdf-to-scan', 'pdfScan', 'FileInput', '#pdfScanOverlay [data-wb-scroll]', '#pdfScanOverlay [data-wb-canvas]']
    ];
    for (const [tool, prefix, input, view, paper] of cases) {
      await open(tool, '#' + prefix + 'Overlay');
      await page.locator('#' + prefix + input).setInputFiles(file);
      await page.waitForFunction(selector => {
        const el = document.querySelector(selector); return el && !el.hidden && el.getBoundingClientRect().width > 80 && !document.querySelector('[id$="ProcessMask"].visible');
      }, paper);
      await zoom(view, paper, tool);
    }
    for (const [tool, prefix, input, process] of [
      ['pdf-split', 'pdfSplit', null, '#pdfSplitProcessBtn'],
      ['pdf-merge', 'pdfMerge', null, '#pdfMergeProcessBtn'],
      ['pdf-rotate', 'pdfRotate', '#pdfRotateInput', '#pdfRotateProcessBtn'],
      ['pdf-to-image', 'pdfToImage', '#pdfToImageFileInput', null]
    ]) {
      await open(tool, '#' + prefix + 'Overlay');
      if (input) await page.locator(input).setInputFiles(file);
      else { const chooser = page.waitForEvent('filechooser'); await page.locator('#' + prefix + 'Cta').click(); await (await chooser).setFiles(tool === 'pdf-merge' ? [file, { ...file, name: 'second.pdf' }] : file); }
      if (process) await page.locator(process).click();
      await page.locator('#' + prefix + 'Workspace.visible').waitFor();
      await zoom('#' + prefix + 'Workspace [data-wb-scroll]', '#' + prefix + 'Workspace [data-wb-canvas]', tool);
    }
    await open('quick-screenshot', '#quickScreenshotOverlay');
    const shortcut = '#screenshotShortcut';
    // The browser has no native hotkeys; enable only this field for the visual contract.
    await page.locator(shortcut).evaluate(el => { el.disabled = false; });
    await field(shortcut); await page.screenshot({ path: `${output}/${theme}-shortcut.png` });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
