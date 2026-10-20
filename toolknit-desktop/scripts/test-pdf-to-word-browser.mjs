import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PDFDocument as ProtectedPDFDocument } from 'pdf-lib-plus-encrypt';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { createCanvas } from '@napi-rs/canvas';
import './test-pdf-word-complex.mjs';
import './test-pdf-word-layers.mjs';
import './test-pdf-word-table-cells.mjs';
import './test-pdf-word-table-layers.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-to-word-browser'); await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 3; index++) {
  const page = pdf.addPage([595, 842]);
  page.drawText('ToolKnit example header', { x: 45, y: 805, size: 10, font });
  page.drawText('Example ' + (index + 1), { x: 45, y: 750, size: 20, font });
  for (let row = 0; row < 8; row++) page.drawText('Editable paragraph ' + (index + 1) + '.' + (row + 1) + ' with complete content.', { x: 45, y: 700 - row * 25, size: 12, font });
  page.drawRectangle({ x: 45, y: 390, width: 100, height: 70, color: rgb(.3, .6, .2) });
}
const bytes = Buffer.from(await pdf.save()), fixture = { name: '转换-sample.pdf', mimeType: 'application/pdf', buffer: bytes };
const protectedPdf = await ProtectedPDFDocument.load(bytes);
await protectedPdf.encrypt({ userPassword: 'fixture-open', ownerPassword: 'fixture-owner', permissions: { copying: true } });
const protectedFixture = { name: 'protected.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await protectedPdf.save({ useObjectStreams: false })) };
const restrictedPdf = await ProtectedPDFDocument.load(bytes);
await restrictedPdf.encrypt({ ownerPassword: 'fixture-owner', permissions: { copying: false } });
const restrictedFixture = { name: 'restricted.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await restrictedPdf.save({ useObjectStreams: false })) };
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], checks = [];
let aiCalls = 0, aiBehavior = 'valid';
const nodes = (node, name) => [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => nodes(child, name))];
const wordText = xml => nodes(xml2js(xml, { captureSpacesBetweenElements: true }), 'w:t').flatMap(text => text.elements || []).map(text => text.text || '').join('');
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 920 }, acceptDownloads: true });
  await context.route('**/*', route => {
    if (route.request().url().startsWith('https://pdf-word-test.invalid/')) {
      aiCalls++; if (aiBehavior === 'fail') return route.fulfill({ status: 503, body: '{}' });
      const request = JSON.parse(route.request().postData()), input = JSON.parse(request.messages[1].content[0].text);
      assert.equal(input.schemaVersion, 2); assert(!JSON.stringify(input).includes('HIDDEN-LAYER-TEXT'));
      const png = Buffer.from(request.messages[1].content[1].image_url.url.split(',')[1], 'base64');
      assert(png.readUInt32BE(16) <= 1600 && png.readUInt32BE(20) <= 1600);
      const response = { schemaVersion: 2, requestId: input.requestId, inputDigest: input.inputDigest, sourceDigest: input.sourceDigest, page: input.page, scopeId: input.scopeId,
        groups: input.regions.map((region, i) => ({ id: 'g' + i, role: region.role, sourceIds: [region.id] })), readingOrder: input.regions.map((_, i) => 'g' + i) };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }] }) });
    }
    return new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' });
  });
  await context.addInitScript(() => {
    const NativeWorker = window.Worker, active = new Set(); window.__wordWorkers = active;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); active.add(this); }
      terminate() { active.delete(this); return super.terminate(); }
    };
    if (!localStorage.getItem('toolknit.theme.v3')) localStorage.setItem('toolknit.theme.v3', 'light');
    if (!localStorage.getItem('toolknit-lang')) localStorage.setItem('toolknit-lang', 'zh');
    localStorage.setItem('ai_platform', 'custom'); localStorage.setItem('ai_custom_url', 'https://pdf-word-test.invalid/v1/chat/completions');
    localStorage.setItem('ai_custom_model', 'fixture-model'); localStorage.setItem('ai_api_key', 'fixture-not-a-secret');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
  await page.goto(url);
  const workerBaseline = await page.evaluate(() => window.__wordWorkers.size);
  const idle = () => page.waitForFunction(() => !document.querySelector('#pdfWordPick').disabled && !document.querySelector('#pdfWordProgressOverlay').classList.contains('visible'));
  const open = async () => {
    await page.locator('[data-tool="pdf-to-word"]').first().evaluate(node => node.click());
    await page.waitForSelector('#pdfWordOverlay.visible');
    await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]') || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  };
  const load = async input => {
    await page.locator('#pdfWordFileInput').setInputFiles(input); await idle();
    assert.equal(await page.locator('#pdfWordFileName').innerText(), input.name);
    await page.waitForFunction(() => document.querySelector('#pdfWordCanvas').width > 0);
  };
  const convert = async name => {
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#pdfWordExport').click();
    const file = path.join(output, name + '.docx'); await (await download).saveAs(file);
    await page.waitForSelector('#pdfWordSuccessOverlay.visible');
    const zip = await JSZip.loadAsync(await readFile(file));
    const xml = await zip.file('word/document.xml').async('string');
    await page.locator('#pdfWordSuccessOk').click(); await idle();
    return { zip, xml, text: wordText(xml) };
  };
  const toggleStructure = async () => {
    const english = await page.evaluate(() => localStorage.getItem('toolknit-lang') === 'en');
    if (await page.locator('#pdfWordStructure').getAttribute('aria-pressed') !== 'true') {
      assert.equal(await page.locator('#pdfWordStructure').innerText(), english ? 'Start editing' : '开始编辑');
      await page.locator('#pdfWordStructure').click();
    }
    await idle(); assert.equal(await page.locator('#pdfWordStructure').innerText(), english ? 'Exit editing' : '退出编辑');
    assert.equal(await page.locator('#pdfWordStructure').getAttribute('aria-label'), english ? 'Exit editing' : '退出编辑');
  };
  await open();
  assert.equal(await page.locator('#pdfWordEmpty').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
  assert(await page.locator('#pdfWordLoaded').isHidden()); assert.equal(await page.locator('#pdfWordFallback').count(), 0);
  await page.screenshot({ path: path.join(output, 'light-empty.png') });
  await load(fixture);
  await page.waitForSelector('.pdf-word-thumbnail canvas');
  const original = await convert('original');
  assert(original.text.includes('Editable paragraph 1.1') && original.text.includes('Editable paragraph 3.8'));
  assert.equal(aiCalls, 0);
  checks.push('one-click local conversion with no review or checkbox, real DOCX keeps first and last content');
  await toggleStructure();
  const textRegion = page.locator('.pdf-word-region[data-type="text"]').first();
  await textRegion.click(); await page.locator('#pdfWordEdit').click();
  assert.equal(await page.locator('#pdfWordFontSize').count(), 0);
  const oldText = await page.locator('#pdfWordEditText').inputValue();
  await page.locator('#pdfWordEditText').fill('Changed in ToolKnit');
  await page.locator('#pdfWordEditForm button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#pdfWordEditOverlay').classList.contains('visible'));
  await page.waitForFunction(() => document.querySelector('#pdfWordPreviewLabel').textContent === '内容编辑预览');
  const edited = await convert('edited-text');
  assert(edited.text.includes('Changed in ToolKnit')); assert(!edited.text.includes(oldText.replaceAll('\n', '')));
  await page.screenshot({ path: path.join(output, 'light-edited.png') });
  await page.locator('#pdfWordUndo').click();
  const undone = await convert('undone'); assert(!undone.text.includes('Changed in ToolKnit'));
  await page.locator('#pdfWordRedo').click();
  const redone = await convert('redone'); assert(redone.text.includes('Changed in ToolKnit'));
  checks.push('result text edit, undo and redo alter real DOCX without changing source');
  await page.locator('#pdfWordReset').click(); await page.locator('#pdfWordConfirmOk').click();
  const reset = await convert('reset'); assert.equal(reset.text, original.text);
  await toggleStructure();
  await page.locator('.pdf-word-region[data-type="image"]').first().click(); await page.locator('#pdfWordDelete').click();
  const removedImage = await convert('removed-image');
  assert((removedImage.xml.match(/<w:drawing>/g) || []).length < (original.xml.match(/<w:drawing>/g) || []).length);
  await page.locator('#pdfWordUndo').click();
  const replacementCanvas = createCanvas(80, 40); replacementCanvas.getContext('2d').fillStyle = 'red'; replacementCanvas.getContext('2d').fillRect(0, 0, 80, 40);
  await page.locator('.pdf-word-region[data-type="image"]').first().click();
  await page.locator('#pdfWordImageInput').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: replacementCanvas.toBuffer('image/png') });
  await page.waitForFunction(() => document.querySelector('#pdfWordPreviewLabel').textContent === '内容编辑预览' && !document.querySelector('#pdfWordReplace').disabled);
  const replaced = await convert('replaced-image');
  assert((replaced.xml.match(/<w:drawing>/g) || []).length === (original.xml.match(/<w:drawing>/g) || []).length);
  const originalImages = await Promise.all(Object.keys(original.zip.files).filter(name => name.startsWith('word/media/') && !original.zip.files[name].dir).map(name => original.zip.file(name).async('base64')));
  const replacedImages = await Promise.all(Object.keys(replaced.zip.files).filter(name => name.startsWith('word/media/') && !replaced.zip.files[name].dir).map(name => replaced.zip.file(name).async('base64')));
  assert(replacedImages.some(value => !originalImages.includes(value)));
  checks.push('image removal and replacement change actual DOCX media; reset restores baseline');
  await page.locator('#pdfWordFlow').click(); await page.waitForSelector('#pdfWordConfirmOverlay.visible');
  await page.locator('#pdfWordConfirmCancel').click();
  assert.equal(await page.locator('#pdfWordFaithful').getAttribute('aria-pressed'), 'true');
  await page.locator('#pdfWordReset').click(); await page.locator('#pdfWordConfirmOk').click();
  await page.locator('.pdf-word-region[data-type="text"]').first().click(); await page.locator('#pdfWordEdit').click();
  await page.locator('#pdfWordEditText').fill('This text cannot fit. '.repeat(150)); await page.locator('#pdfWordEditForm button[type="submit"]').click();
  assert(await page.locator('#pdfWordEditOverlay').isVisible()); assert((await page.locator('#pdfWordEditError').innerText()).includes('超出'));
  await page.locator('#pdfWordEditCancel').click(); await page.locator('#pdfWordDeselect').click();
  checks.push('parameter changes confirm edits; overflow is rejected without clipping or altering the result');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const size of [{ width: 1400, height: 920 }, { width: 900, height: 620 }]) {
      await page.setViewportSize(size);
      assert(await page.locator('#pdfWordOverlay').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
      const exportBox = await page.locator('#pdfWordExport').boundingBox();
      assert(exportBox && exportBox.y >= 0 && exportBox.y + exportBox.height <= size.height);
      await page.screenshot({ path: path.join(output, theme + '-' + size.width + '.png') });
    }
  }
  await page.setViewportSize({ width: 1400, height: 920 });
  await page.locator('#pdfWordNext').click(); await page.waitForFunction(() => document.querySelector('#pdfWordPageInput').value === '2');
  await page.locator('.pdf-word-thumbnail[data-page="3"]').click(); await page.waitForFunction(() => document.querySelector('#pdfWordPageInput').value === '3');
  await page.locator('#pdfWordPageInput').fill('1'); await page.locator('#pdfWordPageInput').press('Enter'); await page.locator('#pdfWordPreviewLabel').click();
  await page.waitForFunction(() => document.querySelector('.pdf-word-thumbnail[aria-current="page"]').dataset.page === '1');
  checks.push('light/dark compact layout, page navigation and thumbnail synchronization');
  await load({ name: 'adjacent-cells.pdf', mimeType: 'application/pdf', buffer: await readFile('tmp/pdf-word-table-cells/source.pdf') });
  const table = await convert('adjacent-cells'), tables = nodes(xml2js(table.xml, { captureSpacesBetweenElements: true }), 'w:tbl');
  assert.equal(tables.length, 1);
  assert.deepEqual(nodes(tables[0], 'w:tc').map(cell => nodes(cell, 'w:t').flatMap(text => text.elements || []).map(text => text.text || '').join('')),
    ['Invoice date', '2026-10-20', 'Quantity', '12', 'Unit price', '25.50', 'Total', '306.00']);
  await load({ name: 'table-background.pdf', mimeType: 'application/pdf', buffer: await readFile('tmp/pdf-word-table-layers/source.pdf') });
  await toggleStructure();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const probe = await page.evaluate(() => {
      const images = [...document.querySelectorAll('.pdf-word-region[data-type="image"]')];
      const texts = [...document.querySelectorAll('.pdf-word-region[data-type="text"]')];
      for (const image of images) {
        const box = image.getBoundingClientRect();
        const text = texts.find(node => { const r = node.getBoundingClientRect(); return r.left > box.left && r.right < box.right && r.top > box.top && r.bottom < box.bottom; });
        if (!text) continue;
        for (let y = box.top + 3; y < box.bottom; y += 5) for (let x = box.left + 3; x < box.right; x += 5) {
          if (document.elementFromPoint(x, y) !== image) continue;
          const r = text.getBoundingClientRect();
          return { image: { x, y }, text: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, key: text.dataset.key };
        }
      }
      return null;
    });
    assert(probe, 'table fixture has independent text and background hit areas');
    await page.mouse.move(probe.image.x, probe.image.y); await page.mouse.click(probe.image.x, probe.image.y);
    assert(await page.locator('#pdfWordReplace').isVisible());
    const textRegion = page.locator('.pdf-word-region[data-key="' + probe.key + '"]');
    await textRegion.scrollIntoViewIfNeeded();
    const box = await textRegion.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dataset.key, { x, y }), probe.key);
    await page.mouse.click(x, y);
    assert.equal(await page.locator('.pdf-word-region[aria-pressed="true"]').getAttribute('data-key'), probe.key);
    assert(await page.locator('#pdfWordEdit').isVisible()); assert(await page.locator('#pdfWordReplace').isHidden());
  }
  await page.locator('#pdfWordStructure').click();
  assert.equal(await page.locator('#pdfWordStructure').innerText(), '开始编辑');
  assert.equal(await page.locator('.pdf-word-region').count(), 0);
  checks.push('selected table backgrounds leave inner text clickable in both themes, edit labels follow state');
  await load({ name: 'complex.pdf', mimeType: 'application/pdf', buffer: await readFile('tmp/pdf-to-word-complex/source.pdf') });
  const complex = await convert('complex');
  assert(complex.xml.includes('w:framePr') && complex.xml.includes('VISIBLE') && !complex.xml.includes('CONFIDENTIAL'));
  await page.locator('#pdfWordFlow').click();
  const flow = await convert('continuous'); assert.equal((flow.xml.match(/<w:sectPr>/g) || []).length, 1);
  assert(flow.xml.includes('w:w="11906" w:h="16838"'));
  await page.locator('#pdfWordFaithful').click();
  const widePdf = await PDFDocument.create(), wideFont = await widePdf.embedFont(StandardFonts.Helvetica);
  const widePage = widePdf.addPage([900, 320]);
  widePage.drawText('LEFT EDGE', { x: 40, y: 230, size: 12, font: wideFont });
  widePage.drawText('RIGHT EDGE', { x: 760, y: 230, size: 12, font: wideFont });
  await load({ name: 'wide.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await widePdf.save()) });
  await page.locator('#pdfWordFlow').click();
  const wideA4 = await convert('wide-a4');
  assert(wideA4.text.includes('LEFT EDGE') && wideA4.text.includes('RIGHT EDGE'));
  assert(wideA4.xml.includes('w:w="11906" w:h="16838"'));
  await page.locator('#pdfWordFaithful').click();
  const wide = await convert('wide-original'); assert(wide.text.includes('LEFT EDGE') && wide.text.includes('RIGHT EDGE'));
  checks.push('editable tables, complex formulas/redaction and A4 packing retain prior conversion behavior');
  await load({ name: 'layers.pdf', mimeType: 'application/pdf', buffer: await readFile('tmp/pdf-word-layers/source.pdf') });
  const layer = await convert('layers');
  assert(layer.xml.includes('PUBLIC-A') && !layer.xml.includes('HIDDEN-LAYER-TEXT') && !layer.xml.includes('HIDDEN-NESTED-TEXT'));
  await load(fixture); await page.locator('#pdfWordAi').click();
  const beforeAi = aiCalls; await convert('ai'); assert.equal(aiCalls - beforeAi, 3);
  await convert('ai-reuse'); assert.equal(aiCalls - beforeAi, 3);
  aiBehavior = 'fail'; await page.evaluate(() => localStorage.setItem('ai_custom_model', 'fixture-new'));
  await page.locator('#pdfWordExport').click();
  await page.waitForFunction(() => document.querySelector('#pdfWordStatus').classList.contains('is-error') && !document.querySelector('#pdfWordLocal').disabled);
  await page.locator('#pdfWordLocal').click(); await convert('local-recovery');
  checks.push('AI remains explicit and bounded, reuse avoids repeated calls, changed provider failure recovers locally');
  await page.locator('#pdfWordRange').fill('999'); await page.locator('#pdfWordExport').click();
  await page.waitForFunction(() => document.querySelector('#pdfWordStatus').classList.contains('is-error'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#pdfWordOverlay').classList.contains('visible'));
  await page.waitForFunction(count => window.__wordWorkers.size === count, workerBaseline);
  await page.evaluate(() => localStorage.setItem('toolknit-lang', 'en')); await page.reload(); await open();
  assert.equal(await page.locator('#pdfWordEmptyPick').innerText(), 'Choose PDF');
  await page.locator('#pdfWordFileInput').setInputFiles(protectedFixture); await page.waitForSelector('#pdfWordPasswordOverlay.visible');
  await page.locator('#pdfWordPassword').fill('wrong'); await page.locator('#pdfWordPasswordForm button[type="submit"]').click();
  await page.waitForFunction(() => /incorrect/i.test(document.querySelector('#pdfWordPasswordHint').textContent));
  await page.locator('#pdfWordPassword').fill('fixture-open'); await page.locator('#pdfWordPasswordForm button[type="submit"]').click(); await idle();
  const encrypted = await convert('protected'); assert(encrypted.text.includes('Editable paragraph 3.8'));
  await page.locator('#pdfWordFileInput').setInputFiles(restrictedFixture);
  await page.waitForFunction(() => document.querySelector('#pdfWordStatus').classList.contains('is-error') && !document.querySelector('#pdfWordPick').disabled);
  assert.equal(await page.locator('#pdfWordFileName').innerText(), 'protected.pdf');
  const passwordWorkers = await page.evaluate(() => window.__wordWorkers.size);
  await page.locator('#pdfWordFileInput').setInputFiles(protectedFixture); await page.waitForSelector('#pdfWordPasswordOverlay.visible');
  await page.keyboard.press('Escape'); await idle();
  await page.waitForFunction(count => window.__wordWorkers.size === count, passwordWorkers);
  assert.equal(await page.locator('#pdfWordPassword').inputValue(), '');
  await page.locator('#pdfWordFileInput').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.waitForFunction(() => document.querySelector('#pdfWordStatus').classList.contains('is-error')); await idle();
  checks.push('English, invalid range, password retry/cancel, copy restrictions and corrupt input recover');
  await load(fixture);
  await page.locator('#pdfWordExport').click(); await page.locator('#pdfWordCancel').evaluate(node => node.click()); await idle();
  assert.equal(await page.locator('#pdfWordStatus').innerText(), 'Cancelled. The original file is unchanged.');
  await convert('cancel-retry');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Escape'); await page.waitForFunction(count => window.__wordWorkers.size === count, workerBaseline);
    await open(); await load(fixture); await toggleStructure();
  }
  await page.keyboard.press('Escape'); await page.waitForFunction(count => window.__wordWorkers.size === count, workerBaseline);
  checks.push('cancel and retry plus repeated close/reopen release PDF and conversion workers');
  const densePdf = await PDFDocument.create(), denseFont = await densePdf.embedFont(StandardFonts.Helvetica);
  const densePage = densePdf.addPage([595, 842]);
  for (let row = 0; row < 66; row++) densePage.drawText('Dense paragraph ' + (row + 1) + '.', { x: 40, y: 810 - row * 12, size: 10, font: denseFont });
  await open(); await load({ name: 'dense.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await densePdf.save()) });
  const dense = await convert('dense');
  assert.equal((dense.xml.match(/<w:sectPr>/g) || []).length, 1);
  assert.equal((dense.xml.match(/<w:framePr /g) || []).length, 66);
  assert(dense.text.includes('Dense paragraph 66.'));
  checks.push('dense-page output retains all 66 positioned lines without adding UI review steps');
  const many = await PDFDocument.create();
  for (let i = 0; i < 24; i++) many.addPage((await many.copyPages(pdf, [i % 3]))[0]);
  await load({ name: 'many.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await many.save()) });
  assert.equal(await page.locator('.pdf-word-thumbnail').count(), 24);
  await page.locator('#pdfWordThumbnails').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('.pdf-word-thumbnail[data-page="24"] canvas').width > 0);
  assert(await page.locator('.pdf-word-thumbnail canvas').evaluateAll(nodes => nodes.filter(node => node.width > 0).length <= 18));
  await page.keyboard.press('Escape'); await page.waitForFunction(count => window.__wordWorkers.size === count, workerBaseline);
  checks.push('24-page navigation loads visible thumbnails only and bounds the canvas cache');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  const current = browser.contexts()[0]?.pages()[0];
  if (current) { await current.screenshot({ path: path.join(output, 'failure.png') }); console.error(await current.locator('#pdfWordStatus').textContent().catch(() => ''), errors); }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
