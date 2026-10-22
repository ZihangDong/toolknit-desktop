import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const sharp = require('sharp');
const output = path.resolve('tmp/v32-pdf-creation/editor');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, logLevel: 'error', build: { outDir: process.env.TOOLKNIT_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const checks = [], errors = [];
try {
  for (const [theme, lang] of [['light', 'zh'], ['dark', 'en']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('toolknit.theme.v3', theme); localStorage.setItem('toolknit-lang', lang);
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    }, { theme, lang });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
    const settle = () => page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
      || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
    const ready = () => page.waitForFunction(() => !document.querySelector('#pdfEditorExport').disabled
      && document.querySelector('.pdf-editor-canvas-wrap canvas')?.width > 100);
    await page.goto(url);
    await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await page.locator('.audio-list-item[data-tool="pdf-editor"]').evaluate(node => node.click());
    await page.waitForSelector('#pdfEditorOverlay.visible'); await settle();
    for (const [width, height] of [[1440, 900], [1100, 700], [800, 600]]) {
      await page.setViewportSize({ width, height });
      const button = page.locator('#pdfEditorNewDocument');
      assert.equal(await button.isEnabled(), true);
      assert.equal(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await page.screenshot({ path: path.join(output, `empty-${theme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(theme === 'light' ? '#pdfEditorNewDocument' : '#pdfEditorBlankPage').click(); await ready();
    assert.equal(await page.locator('#pdfEditorPageStrip .pdf-editor-tile').count(), 1);
    assert.equal(await page.locator('#pdfEditorInsertText').isEnabled(), true);
    let confirmations = 0;
    const dismiss = async dialog => { confirmations++; await dialog.dismiss(); };
    page.on('dialog', dismiss);
    await page.locator('#pdfEditorInsertText').click();
    await page.locator('#pdfEditorEditInput').fill('Cancel only this text dialog');
    await page.locator('#pdfEditorEditInput').press('Escape');
    await page.waitForSelector('#pdfEditorEditModal.visible', { state: 'hidden' });
    assert.equal(confirmations, 0, 'Escape in the text input must not also close the document');
    assert.equal(await page.locator('#pdfEditorOverlay').isVisible(), true);
    const firstConfirmation = page.waitForEvent('dialog');
    await page.locator('#pdfEditorBack').click();
    await firstConfirmation; await settle();
    assert.equal(confirmations, 1, 'a new empty document is not already saved');
    assert.equal(await page.locator('#pdfEditorOverlay').isVisible(), true);
    async function insertText(text, x = 100, y = 120) {
      await page.locator('#pdfEditorInsertText').click();
      await page.locator('#pdfEditorEditInput').fill(text);
      await page.locator('#pdfEditorEditSave').click();
      await page.locator('.pdf-editor-canvas-wrap').click({ position: { x, y } });
      await page.waitForFunction(() => document.querySelector('.pdf-editor-inserted-text'));
    }
    const paperBounds = await page.locator('.pdf-editor-canvas-wrap').boundingBox();
    await insertText('ToolKnit blank PDF 123\n\nSecond line after a blank line', paperBounds.width - 8, paperBounds.height - 8);
    const multiline = await page.locator('.pdf-editor-inserted-text').evaluate(node => ({
      height: node.getBoundingClientRect().height, font: parseFloat(getComputedStyle(node).fontSize),
      whitespace: getComputedStyle(node).whiteSpace
    }));
    assert.ok(multiline.height > multiline.font * 2.8, 'multiline text preview includes the blank line');
    assert.equal(multiline.whitespace, 'pre', 'manual line breaks remain visible without implicit wrapping');
    const textBounds = await page.locator('.pdf-editor-inserted-text').boundingBox();
    assert.ok(textBounds.x >= paperBounds.x && textBounds.y >= paperBounds.y
      && textBounds.x + textBounds.width <= paperBounds.x + paperBounds.width + 1
      && textBounds.y + textBounds.height <= paperBounds.y + paperBounds.height + 1, 'edge insertion stays inside the page');
    await page.locator('#pdfEditorUndo').click();
    await page.waitForFunction(() => !document.querySelector('.pdf-editor-inserted-text'));
    await page.locator('#pdfEditorRedo').click();
    await page.waitForFunction(() => document.querySelector('.pdf-editor-inserted-text'));
    await page.locator('#pdfEditorBlankPage').click(); await ready();
    assert.equal(await page.locator('#pdfEditorPageStrip .pdf-editor-tile').count(), 2);
    await page.locator('#pdfEditorUndo').click();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 1);
    await page.locator('#pdfEditorRedo').click();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 2);
    await ready();
    await insertText('第二页：空白文档编辑测试');
    const download = page.waitForEvent('download');
    await page.locator('#pdfEditorExport').click();
    const result = await download, file = path.join(output, `${theme}-created.pdf`);
    await result.saveAs(file);
    await page.locator('#pdfEditorSuccessOk').click();
    const bytes = new Uint8Array(await readFile(file));
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2);
    for (const p of pdf.getPages()) assert.deepEqual(p.getSize(), { width: 595.28, height: 841.89 });
    const loading = getDocument({ data: bytes.slice(), useSystemFonts: false,
      standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
    const parsed = await loading.promise;
    const texts = [];
    for (let i = 1; i <= parsed.numPages; i++) texts.push((await (await parsed.getPage(i)).getTextContent()).items.map(item => item.str).join(''));
    assert.match(texts[0], /ToolKnit blank PDF 123/);
    assert.match(texts[0], /Second line after a blank line/);
    const lines = (await (await parsed.getPage(1)).getTextContent()).items.filter(item => item.str.trim());
    assert.equal(lines.length, 2);
    assert.ok(lines[0].transform[5] - lines[1].transform[5] > 32, 'export preserves the empty line');
    for (const line of lines) assert.ok(line.transform[4] >= 0 && line.transform[4] + line.width <= 596
      && line.transform[5] > 0, 'edge-inserted exported text stays inside A4');
    assert.match(texts[1], /第二页：空白文档编辑测试/);
    await loading.destroy();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#pdfEditorSuccessOverlay')).opacity === '0');
    await page.screenshot({ path: path.join(output, `created-${theme}.png`) });
    // Resetting changes the document, but must not pretend that it overwrote the exported file.
    await page.locator('#pdfEditorReset').click();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 1);
    const resetConfirmation = page.waitForEvent('dialog');
    await page.locator('#pdfEditorBack').click(); await resetConfirmation; await settle();
    assert.equal(confirmations, 2, 'resetting after export retains dirty state relative to the actual saved result');
    page.off('dialog', dismiss);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#pdfEditorBack').click(); await settle();
    await page.locator('.audio-list-item[data-tool="pdf-editor"]').evaluate(node => node.click()); await settle();
    await page.locator('#pdfEditorNewDocument').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pdfEditorPageStrip .pdf-editor-tile').count(), 0);
    await page.locator('#pdfEditorNewDocument').click(); await ready();
    await insertText('Mixed blank document');
    const imageCanvas = createCanvas(180, 90), imageContext = imageCanvas.getContext('2d');
    imageContext.fillStyle = '#c02030'; imageContext.fillRect(0, 0, 90, 90);
    imageContext.fillStyle = '#20a060'; imageContext.fillRect(90, 0, 90, 90);
    const chooser = page.waitForEvent('filechooser'); await page.locator('#pdfEditorInsertImage').click();
    await (await chooser).setFiles({ name: 'two-colors.png', mimeType: 'image/png', buffer: imageCanvas.toBuffer('image/png') });
    await page.waitForFunction(() => document.querySelector('#pdfEditorInsertImage').classList.contains('active')
      || document.querySelector('.app-toast')?.textContent?.match(/准备好|ready/i));
    await page.locator('.pdf-editor-main-canvas').click({ position: { x: 170, y: 210 } });
    await page.waitForSelector('.pdf-editor-inserted-image-wrap');
    await page.locator('#pdfEditorInsertRect').click();
    await page.locator('.pdf-editor-main-canvas').click({ position: { x: 100, y: 310 } });
    await page.waitForSelector('.pdf-editor-inserted-shape');
    await page.locator('#pdfEditorDuplicate').click(); await ready();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 2);
    for (const selector of ['.pdf-editor-inserted-image-wrap', '.pdf-editor-inserted-shape', '.pdf-editor-inserted-text']) {
      assert.equal(await page.locator(selector).count(), 1, 'page copy carries its own components');
    }
    await page.locator('.pdf-editor-inserted-image-wrap img').click();
    await page.locator('#pdfEditorComponentDelete').click();
    assert.equal(await page.locator('.pdf-editor-inserted-image-wrap').count(), 0);
    await page.locator('#pdfEditorUndo').click(); await page.waitForSelector('.pdf-editor-inserted-image-wrap');
    await page.locator('#pdfEditorRedo').click();
    await page.waitForSelector('.pdf-editor-inserted-image-wrap', { state: 'detached' });
    assert.equal(await page.locator('.pdf-editor-inserted-image-wrap').count(), 0);
    await page.locator('#pdfEditorUndo').click(); await page.waitForSelector('.pdf-editor-inserted-image-wrap');
    await page.locator('#pdfEditorRotateCw').click(); await ready();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.pdf-editor-main-canvas'), image = document.querySelector('.pdf-editor-inserted-image-wrap img');
      return canvas?.width > canvas?.height && image?.complete && image?.naturalWidth > 0;
    });
    const rotatedImage = await page.locator('.pdf-editor-inserted-image-wrap').screenshot({ path: path.join(output, `rotated-image-${theme}.png`) });
    const pixels = await sharp(rotatedImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = y => [...pixels.data.subarray((Math.floor(pixels.info.height * y) * pixels.info.width + Math.floor(pixels.info.width * .5)) * 4,
      (Math.floor(pixels.info.height * y) * pixels.info.width + Math.floor(pixels.info.width * .5)) * 4 + 3)];
    const top = pixel(.25), bottom = pixel(.75);
    assert.ok(top[0] > top[1] + 50 && bottom[1] > bottom[0] + 50, 'page rotation turns left/right image halves into top/bottom halves in the preview');
    const imageWrap = page.locator('.pdf-editor-inserted-image-wrap');
    await imageWrap.locator('img').click();
    const beforeResize = await imageWrap.boundingBox(), fixedBefore = await imageWrap.locator('[data-handle="nw"]').boundingBox();
    const handle = await imageWrap.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 20, handle.y + handle.height / 2 + 40, { steps: 5 }); await page.mouse.up();
    const afterResize = await imageWrap.boundingBox(), fixedAfter = await imageWrap.locator('[data-handle="nw"]').boundingBox();
    assert.ok(afterResize.width > beforeResize.width && afterResize.height > beforeResize.height, 'rotated page outward resize grows the image');
    assert.ok(Math.abs(fixedAfter.x - fixedBefore.x) < 2 && Math.abs(fixedAfter.y - fixedBefore.y) < 2, 'opposite rotated handle remains anchored');
    await page.keyboard.down('Alt');
    await page.mouse.move(afterResize.x + afterResize.width / 2, afterResize.y + afterResize.height / 2); await page.mouse.down();
    await page.mouse.move(afterResize.x + afterResize.width / 2 + 15, afterResize.y + afterResize.height / 2 + 10, { steps: 5 }); await page.mouse.up();
    await page.keyboard.up('Alt');
    const afterMove = await imageWrap.boundingBox();
    assert.ok(Math.abs(afterMove.x - afterResize.x - 15) < 2 && Math.abs(afterMove.y - afterResize.y - 10) < 2, 'rotated page drag follows the pointer');
    await page.locator('#pdfEditorBlankPage').click(); await ready();
    const appended = await PDFDocument.create(), appendedPage = appended.addPage([400, 300]);
    appendedPage.setRotation(degrees(90)); appendedPage.drawText('Appended rotated source', { x: 30, y: 200, size: 14 });
    await page.locator('#pdfEditorAppendInput').setInputFiles({ name: 'rotated-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await appended.save()) });
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 4); await ready();
    const mixedDownload = page.waitForEvent('download'); await page.locator('#pdfEditorExport').click();
    const mixedFile = path.join(output, `${theme}-mixed.pdf`); await (await mixedDownload).saveAs(mixedFile);
    await page.locator('#pdfEditorSuccessOk').click();
    const mixedTask = getDocument({ data: new Uint8Array(await readFile(mixedFile)),
      standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
    const mixed = await mixedTask.promise;
    try {
      const expected = [[595.28, 841.89], [841.89, 595.28], [841.89, 595.28], [300, 400]];
      for (let i = 1; i <= 4; i++) {
        const p = await mixed.getPage(i), view = p.getViewport({ scale: 1 });
        assert.deepEqual([view.width, view.height], expected[i - 1], 'visible dimensions include source and editor rotation');
        const text = (await p.getTextContent()).items.map(item => item.str).join('');
        assert.equal(text, i < 3 ? 'Mixed blank document' : i === 3 ? '' : 'Appended rotated source');
        const c = createCanvas(Math.ceil(view.width), Math.ceil(view.height)), ctx = c.getContext('2d');
        await p.render({ canvasContext: ctx, viewport: view }).promise;
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let colored = 0;
        for (let j = 0; j < pixels.length; j += 4) if (Math.max(pixels[j], pixels[j + 1], pixels[j + 2]) - Math.min(pixels[j], pixels[j + 1], pixels[j + 2]) > 60) colored++;
        if (i < 3) assert.ok(colored > 1000, 'copied images survive delete/undo/rotation/export');
        await writeFile(path.join(output, `${theme}-mixed-${i}.png`), c.toBuffer('image/png'));
        c.width = c.height = 0;
      }
    } finally { await mixedTask.destroy(); }
    let unexpectedPrompt = false;
    page.on('dialog', async dialog => { unexpectedPrompt = true; await dialog.dismiss(); });
    await page.locator('#pdfEditorPageStrip .pdf-editor-tile').first().click(); await ready();
    await page.locator('#pdfEditorZoomIn').click(); await ready();
    await page.locator('#pdfEditorBack').click(); await settle();
    assert.equal(unexpectedPrompt, false, 'page navigation and zoom do not dirty a saved document');
    assert.equal(await page.locator('#pdfEditorOverlay').isVisible(), false);
    checks.push(`${theme}/${lang}: create without input, A4, insertion, undo/redo, real export, reset/dirty/close/reopen`);
    checks.push(`${theme}/${lang}: image/shape insertion, page duplication, component delete undo/redo, rotated blank-page size, append rotated PDF, rendered output, saved-view close`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(checks.join('\n'));
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
