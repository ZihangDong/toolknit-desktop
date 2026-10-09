import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-workbench-theme');
await mkdir(output, { recursive: true });
const document = await PDFDocument.create();
const font = await document.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 6; index += 1) {
  document.addPage([612, 792]).drawText(`Theme regression page ${index + 1}`, { x: 48, y: 720, font, size: 20 });
}
const fixture = { name: 'workbench.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { checks: [], errors: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
  const url = server.resolvedUrls.local[0];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light');
    localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card');
  async function openTool(tool, prefix) {
    await page.evaluate(id => document.querySelector(`.audio-list-item[data-tool="${id}"]`).click(), tool);
    await page.waitForSelector(`#${prefix}Overlay.visible`);
    await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
      || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  }
  async function disabledColors(prefix) {
    await page.waitForTimeout(250);
    return page.locator(`#${prefix}Overlay`).evaluate(overlay => {
      const reference = getComputedStyle(overlay.querySelector('[id$="Export"]'));
      return [...overlay.querySelectorAll('button:disabled, input:disabled, select:disabled')]
        .filter(node => !['range', 'color'].includes(node.type))
        .map(node => {
          const surface = node.type === 'radio' ? node.nextElementSibling : node;
          const style = getComputedStyle(surface);
          return { id: node.id || node.value, match: style.backgroundColor === reference.backgroundColor
            && style.color === reference.color && style.opacity === '1',
          radioHidden: node.type !== 'radio' || getComputedStyle(node).opacity === '0' };
        });
    });
  }
  await openTool('pdf-editor', 'pdfEditor');
  assert.ok((await disabledColors('pdfEditor')).every(item => item.match));
  assert.equal(await page.locator('#pdfEditorEditModal').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('#pdfEditorComponentMenu').isVisible(), false);
  await page.screenshot({ path: path.join(output, 'editor-empty.png') });
  await page.locator('#pdfEditorFileInput').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll('.pdf-editor-tile').length === 6
    && !document.querySelector('#pdfEditorExport').disabled
    && !document.querySelector('#pdfEditorProcessMask').classList.contains('visible'));
  await page.waitForSelector('.pdf-editor-main-canvas');
  await page.waitForSelector('.pdf-editor-tile-frame.is-ready');
  assert.equal(await page.locator('.pdf-editor-tile-frame.is-ready .pdf-editor-tile-skeleton').first().isVisible(), false);
  assert.equal(await page.locator('.pdf-editor-tile-index').first().evaluate(n => {
    const box = n.getBoundingClientRect();
    const tile = n.parentElement.getBoundingClientRect();
    return getComputedStyle(n).zIndex === '1' && box.x >= tile.x && box.y >= tile.y
      && box.x + box.width <= tile.right && box.y + box.height <= tile.bottom;
  }), true);
  for (const selector of ['.pdf-editor-sidebar', '.pdf-editor-preview', '.pdf-editor-tool-panel']) {
    assert.equal(await page.locator(selector).evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  }
  await page.locator('#pdfEditorEditText').click();
  await page.locator('.pdf-editor-text-segment').first().click();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  assert.equal(await page.locator('#pdfEditorEditInput').inputValue(), 'Theme regression page 1');
  await page.locator('#pdfEditorEditInput').fill('Edited source text');
  await page.locator('#pdfEditorEditSave').click();
  await page.waitForFunction(() => document.querySelector('.pdf-editor-text-segment.is-edited')?.textContent === 'Edited source text');
  await page.locator('#pdfEditorEditText').click();
  await page.locator('#pdfEditorSelectComponent').click();
  await page.locator('.pdf-editor-text-segment').first().click();
  await page.keyboard.press('F2');
  await page.waitForSelector('#pdfEditorEditModal.visible');
  assert.equal(await page.locator('#pdfEditorEditInput').inputValue(), 'Edited source text');
  await page.locator('#pdfEditorEditCancel').click();
  await page.locator('#pdfEditorSelectComponent').click();
  await page.locator('#pdfEditorSelectComponent').click();
  assert.equal(await page.locator('#pdfEditorSelectComponent').getAttribute('aria-pressed'), 'true');
  await page.locator('.pdf-editor-text-segment').first().dblclick();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  await page.locator('#pdfEditorEditInput').fill('中文文字编辑后的完整选择框 WWW');
  await page.locator('#pdfEditorEditSave').click();
  await page.waitForFunction(() => document.querySelector('.pdf-editor-text-segment.is-edited')
    ?.textContent.includes('完整选择框'));
  const editedBounds = await page.locator('.pdf-editor-text-segment.is-edited').evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('.pdf-editor-text-content'));
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { fits: text.left >= box.left - 1 && text.right <= box.right + 1
        && text.top >= box.top - 1 && text.bottom <= box.bottom + 1,
      width: box.width, textWidth: text.width, height: box.height, textHeight: text.height };
  });
  assert.ok(editedBounds.fits, JSON.stringify(editedBounds));
  await page.locator('.pdf-editor-text-segment.is-edited').dblclick();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  await page.locator('#pdfEditorEditInput').fill('Edited source text');
  await page.locator('#pdfEditorEditSave').click();
  await page.locator('#pdfEditorSelectComponent').click();
  await page.locator('#pdfEditorInsertText').click();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.pdf-editor-edit-modal-card').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(output, 'editor-text-dialog.png') });
  await page.locator('#pdfEditorEditInput').fill('Editor theme regression');
  await page.locator('#pdfEditorEditSave').click();
  await page.locator('.pdf-editor-main-canvas').click({ position: { x: 80, y: 110 } });
  await page.waitForSelector('.pdf-editor-inserted-text');
  await page.locator('.pdf-editor-inserted-text').dblclick();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  assert.equal(await page.locator('#pdfEditorEditInput').inputValue(), 'Editor theme regression');
  await page.locator('#pdfEditorEditCancel').click();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#b52424';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#22734b';
    ctx.fillRect(60, 0, 60, 60);
    return canvas.toDataURL().split(',')[1];
  });
  const imageChooserEvent = page.waitForEvent('filechooser');
  await page.locator('#pdfEditorInsertImage').click();
  const imageChooser = await imageChooserEvent;
  await imageChooser.setFiles({ name: 'ratio.png',
    mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
  await page.getByText('图像已准备好，请点击页面放置', { exact: true }).waitFor();
  await page.locator('.pdf-editor-main-canvas').click({ position: { x: 140, y: 260 } });
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');
  await page.locator('.pdf-editor-inserted-image-wrap img').click();
  const ratioButton = page.locator('#pdfEditorComponentAspect');
  assert.equal(await ratioButton.getAttribute('aria-pressed'), 'true');
  await ratioButton.click();
  const imageBox = () => page.locator('.pdf-editor-inserted-image-wrap').boundingBox();
  const beforeStretch = await imageBox();
  const imageResizeHandle = await page.locator('.pdf-editor-inserted-image-wrap [data-handle="e"]').boundingBox();
  await page.mouse.move(imageResizeHandle.x + imageResizeHandle.width / 2, imageResizeHandle.y + imageResizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(imageResizeHandle.x + imageResizeHandle.width / 2 + 50, imageResizeHandle.y + imageResizeHandle.height / 2, { steps: 8 });
  await page.mouse.up();
  const stretched = await imageBox();
  assert.ok(stretched.width > beforeStretch.width + 40);
  assert.ok(Math.abs(stretched.height - beforeStretch.height) < 1);
  assert.equal(await page.locator('.pdf-editor-inserted-image').evaluate(n => getComputedStyle(n).objectFit), 'fill');
  await ratioButton.click();
  const restored = await imageBox();
  assert.ok(Math.abs(restored.width / restored.height - 2) < 0.01);
  await page.locator('#pdfEditorUndo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');
  assert.equal(await ratioButton.getAttribute('aria-pressed'), 'false');
  assert.ok(Math.abs((await imageBox()).height - stretched.height) < 1);
  await page.locator('#pdfEditorRedo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');
  assert.equal(await ratioButton.getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(output, 'editor-image-ratio-light.png') });
  await page.locator('#pdfEditorComponentDelete').click();
  assert.equal(await page.locator('.pdf-editor-inserted-image-wrap').count(), 0,
    'Deleting an image must remove its preview without another pointer gesture');
  await page.locator('#pdfEditorUndo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');
  await page.locator('.pdf-editor-inserted-image-wrap img').click();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.pdf-editor-inserted-image-wrap').count(), 0,
    'Keyboard deletion must remove the image preview immediately');
  await page.locator('#pdfEditorUndo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');
  await page.locator('#pdfEditorRedo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap', { state: 'detached' });
  assert.equal(await page.locator('.pdf-editor-inserted-image-wrap').count(), 0);
  await page.locator('#pdfEditorUndo').click();
  await page.waitForSelector('.pdf-editor-inserted-image-wrap');

  // Drag near the page's center and check both the guide and actual placement.
  await page.locator('.pdf-editor-inserted-text').scrollIntoViewIfNeeded();
  const canvasBox = await page.locator('.pdf-editor-main-canvas').boundingBox();
  const movingText = await page.locator('.pdf-editor-inserted-text').boundingBox();
  const centerX = canvasBox.x + canvasBox.width / 2;
  await page.mouse.move(movingText.x + movingText.width / 2, movingText.y + movingText.height / 2);
  await page.mouse.down();
  await page.mouse.move(centerX + 3, movingText.y + movingText.height / 2 + 45, { steps: 10 });
  await page.waitForSelector('.pdf-editor-snap-guide');
  const snappedText = await page.locator('.pdf-editor-inserted-text').boundingBox();
  assert.ok(Math.abs(snappedText.x + snappedText.width / 2 - centerX) < 1);
  await page.screenshot({ path: path.join(output, 'editor-snap-light.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'editor-snap-dark.png') });
  await page.mouse.up();
  assert.equal(await page.locator('.pdf-editor-snap-guide').count(), 0);
  await page.locator('.pdf-editor-inserted-text').dblclick();
  await page.waitForSelector('#pdfEditorEditModal.visible');
  await page.locator('#pdfEditorEditCancel').click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  report.checks.push('Persistent selection, native double-click, Chinese text bounds, free image resize, original ratio restore/undo/redo, page-center guides in both themes and cleanup');
  await page.locator('#pdfEditorInsertRect').click();
  await page.locator('.pdf-editor-main-canvas').click({ position: { x: 80, y: 190 } });
  await page.waitForSelector('.pdf-editor-inserted-shape');
  await page.locator('#pdfEditorSelectComponent').click();
  await page.locator('.pdf-editor-inserted-shape').click();
  await page.waitForSelector('#pdfEditorShapePanel:not([hidden])');
  await page.locator('#pdfEditorShapeFill').fill('#b52424');
  await page.locator('#pdfEditorShapeFill').dispatchEvent('input');
  await page.waitForTimeout(200);
  for (const close of await page.locator('.app-toast-close').all()) await close.click();
  const shapePaint = () => page.locator('.pdf-editor-inserted-shape svg').evaluate(n => n.outerHTML);
  const paintBefore = await shapePaint();
  const textBefore = await page.locator('.pdf-editor-inserted-text').evaluate(n => getComputedStyle(n).color);
  await page.screenshot({ path: path.join(output, 'editor-shape.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await shapePaint(), paintBefore);
  assert.equal(await page.locator('.pdf-editor-inserted-text').evaluate(n => getComputedStyle(n).color), textBefore);
  await page.screenshot({ path: path.join(output, 'editor-dark.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  assert.equal(await shapePaint(), paintBefore);
  assert.equal(await page.locator('.pdf-editor-text-segment.is-edited').first().evaluate(n => getComputedStyle(n).color), 'rgb(17, 17, 17)');
  for (const selector of ['.pdf-editor-inserted-shape', '.pdf-editor-inserted-text']) {
    if (selector === '.pdf-editor-inserted-text') await page.keyboard.press('Escape');
    await page.locator(selector).click();
    await page.locator('#pdfEditorComponentDelete').click();
    assert.equal(await page.locator(selector).count(), 0,
      `${selector} must disappear immediately after deletion`);
    await page.locator('#pdfEditorUndo').click();
    await page.waitForSelector(selector);
  }
  report.checks.push('Immediate image/text/shape deletion, keyboard deletion and image delete undo/redo');
  await page.locator('#pdfEditorUndo').click();
  await page.locator('#pdfEditorRedo').click();
  await page.locator('#pdfEditorRotateCw').click();
  await page.waitForTimeout(300);
  await page.locator('#pdfEditorUndo').click();
  for (const [width, height] of [[1400, 887], [1100, 700], [900, 520], [720, 480]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    await page.locator('#pdfEditorExport').scrollIntoViewIfNeeded();
    const box = await page.locator('#pdfEditorExport').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
    await page.screenshot({ path: path.join(output, `editor-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.waitForFunction(() => document.querySelector('#pdfEditorExport').textContent.includes('Export'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'editor-english.png') });
  await page.evaluate(() => document.querySelector('[data-lang="zh"]').click());
  const editorDownloadEvent = page.waitForEvent('download');
  await page.locator('#pdfEditorExport').click();
  const editorDownload = await editorDownloadEvent;
  assert.equal((await PDFDocument.load(await readFile(await editorDownload.path()))).getPageCount(), 6);
  await page.waitForSelector('#pdfEditorSuccessOverlay.visible');
  assert.equal(await page.locator('#pdfEditorSuccessOverlay .audio-clip-success-dialog').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(output, 'editor-success.png') });
  await page.locator('#pdfEditorSuccessOk').click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#pdfEditorBack').click();
  await page.waitForFunction(() => !document.querySelector('#pdfEditorOverlay').classList.contains('visible'));
  await openTool('pdf-editor', 'pdfEditor');
  assert.ok((await disabledColors('pdfEditor')).every(item => item.match));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#pdfEditorOverlay').classList.contains('visible'));
  report.checks.push('Editor light chrome, empty controls, text/shape editing, color isolation, undo/redo, rotation, responsive export, language and reopen');

  await openTool('pdf-crop', 'pdfCrop');
  await page.locator('[data-crop-scope="all"]').hover();
  await page.waitForTimeout(200);
  assert.ok((await disabledColors('pdfCrop')).every(item => item.match && item.radioHidden));
  const cropPanel = await page.locator('.pdf-crop-settings').evaluate(n => {
    const s = getComputedStyle(n); return { background: s.backgroundColor, shadow: s.boxShadow, filter: s.backdropFilter };
  });
  await page.screenshot({ path: path.join(output, 'crop-empty.png') });
  await page.locator('#pdfCropBack').click();
  await openTool('pdf-page-number', 'pdfPageNumber');
  let disabled = await disabledColors('pdfPageNumber');
  assert.ok(disabled.every(item => item.match && item.radioHidden), JSON.stringify(disabled));
  const numberPanel = await page.locator('.pdf-page-number-settings').evaluate(n => {
    const s = getComputedStyle(n); return { background: s.backgroundColor, shadow: s.boxShadow, filter: s.backdropFilter };
  });
  assert.deepEqual(numberPanel, cropPanel);
  await page.screenshot({ path: path.join(output, 'number-empty.png') });
  report.checks.push('Both empty workbenches share panel and disabled colors');

  await page.locator('#pdfPageNumberFileInput').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page-number-page-item').length === 6
    && !document.querySelector('#pdfPageNumberExport').disabled
    && !document.querySelector('#pdfPageNumberProcessMask').classList.contains('visible'));
  await page.waitForFunction(() => document.querySelector('#pdfPageNumberPreviewCanvas').width > 0);
  const customSelect = page.locator('#pdfPageNumberScope').locator('..').locator('.tool-custom-select-trigger');
  await customSelect.click();
  const menu = page.locator('.tool-custom-select-menu:visible');
  assert.equal(await menu.evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(output, 'number-dropdown.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pdfPageNumberOverlay').evaluate(n => n.classList.contains('visible')), true);
  await page.locator('[data-position="top-right"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-position="top-right"]').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(23, 23, 23)');
  await page.locator('[data-style="pill"]').click();
  await page.locator('#pdfPageNumberTextColor').fill('#b52424');
  await page.locator('#pdfPageNumberTextColor').dispatchEvent('input');
  await page.waitForTimeout(250);
  const previewBefore = await page.locator('#pdfPageNumberLiveText').evaluate(n => n.getAttribute('style'));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await page.locator('#pdfPageNumberLiveText').evaluate(n => n.getAttribute('style')), previewBefore);
  await page.screenshot({ path: path.join(output, 'number-dark.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  assert.equal(await page.locator('#pdfPageNumberTextColor').inputValue(), '#b52424');
  report.checks.push('Custom menu, selected controls and PDF color isolation');

  const firstId = await page.locator('.pdf-page-number-page-item').first().getAttribute('data-page-id');
  const handle = await page.locator('.pdf-page-number-drag').first().boundingBox();
  const third = await page.locator('.pdf-page-number-page-item').nth(2).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width / 2, third.y + third.height * .8, { steps: 10 });
  await page.mouse.up();
  assert.notEqual(await page.locator('.pdf-page-number-page-item').first().getAttribute('data-page-id'), firstId);
  await page.locator('#pdfPageNumberDeleteSelected').click();
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page-number-page-item').length === 5);
  await page.locator('#pdfPageNumberUndoDelete').click();
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page-number-page-item').length === 6);
  report.checks.push('Page sorting, deletion and undo');

  for (const [width, height] of [[1400, 887], [1100, 700], [900, 520], [720, 480]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await page.locator('#pdfPageNumberExport').scrollIntoViewIfNeeded();
    const box = await page.locator('#pdfPageNumberExport').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
    await page.screenshot({ path: path.join(output, `number-${width}x${height}.png`) });
  }
  report.checks.push('Export reachable at desktop and minimum window sizes');
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.waitForFunction(() => document.querySelector('#pdfPageNumberExport').textContent.includes('Export'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, 'number-english.png') });
  await page.evaluate(() => document.querySelector('[data-lang="zh"]').click());
  await page.waitForFunction(() => document.querySelector('#pdfPageNumberExport').textContent.includes('导出'));
  report.checks.push('Chinese/English language switching');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#pdfPageNumberExport').click();
  const download = await downloadEvent;
  const exported = await PDFDocument.load(await readFile(await download.path()));
  assert.equal(exported.getPageCount(), 6);
  await page.waitForSelector('#pdfPageNumberSuccessOverlay.visible');
  assert.equal(await page.locator('#pdfPageNumberSuccessOverlay .audio-clip-success-dialog').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(output, 'number-success.png') });
  await page.locator('#pdfPageNumberSuccessOk').click();
  await page.locator('#pdfPageNumberBack').click();
  await page.waitForFunction(() => !document.querySelector('#pdfPageNumberOverlay').classList.contains('visible')
    && document.querySelectorAll('.pdf-page-number-page-item').length === 0);
  await openTool('pdf-page-number', 'pdfPageNumber');
  disabled = await disabledColors('pdfPageNumber');
  assert.ok(disabled.every(item => item.match && item.radioHidden), JSON.stringify(disabled));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#pdfPageNumberOverlay').classList.contains('visible'));
  report.checks.push('Valid six-page PDF export, white success dialog, close/reopen/Escape');
  assert.deepEqual(report.errors, []);
  console.log(report.checks.join('\n'));
} finally {
  if (page) await page.screenshot({ path: path.join(output, 'last-state.png') }).catch(() => {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
