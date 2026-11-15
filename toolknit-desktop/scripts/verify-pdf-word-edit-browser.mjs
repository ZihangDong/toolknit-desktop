import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
const [source, pageValue, match, directory] = process.argv.slice(2);
if (!source || !match || !directory || !Number.isInteger(Number(pageValue))) throw Error('Usage: input.pdf page match output-directory');
const pageNumber = Number(pageValue), output = path.resolve(directory);
await mkdir(output, { recursive: true });
const bytes = await readFile(source), require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], externalPosts = [];
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
    if (route.request().method() === 'POST') externalPosts.push(new URL(route.request().url()).origin);
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.result?.schemaVersion && data.result.pages) window.__initialWordDocument = structuredClone(data.result);
        });
      }
      postMessage(data, ...args) {
        if (data.type === 'finish') window.__editedWordDocument = structuredClone(data.document);
        return super.postMessage(data, ...args);
      }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('[data-tool="pdf-to-word"]').first().evaluate(node => node.click());
  await page.waitForSelector('#pdfWordOverlay.visible');
  await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]') || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  await page.locator('#pdfWordFileInput').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: bytes });
  if (await page.locator('#pdfWordPagesOverlay.visible').count()) await page.locator('#pdfWordAllPages').click();
  else await Promise.race([page.waitForSelector('#pdfWordPagesOverlay.visible').then(() => page.locator('#pdfWordAllPages').click()), page.waitForSelector('#pdfWordSuccessOverlay.visible')]);
  await page.waitForSelector('#pdfWordSuccessOverlay.visible', { timeout: 180000 });
  await page.locator('#pdfWordEditDocument').click();
  await page.waitForSelector('#wordDocumentOverlay.visible');
  await page.locator('#wordDocumentOverlay .pdf-editor-tile').nth(pageNumber - 1).click();
  await page.waitForFunction(() => document.querySelector('#wordDocumentRegions')?.children.length > 0);
  const targetKey = await page.evaluate(({ pageNumber, match }) => {
    const flatten = blocks => blocks.flatMap(block => block.columns ? block.columns.flatMap(column => flatten(column.blocks)) : block.cells ? block.cells.flatMap(cell => flatten(cell.blocks)) : [block]);
    const source = window.__initialWordDocument.pages.find(page => page.number === pageNumber);
    const blocks = flatten([...source.header, ...source.blocks, ...source.footer]);
    const text = block => block.lines?.flatMap(line => line.items).map(item => item.text || '').join('').replace(/\s/g, '');
    const block = blocks.find(block => text(block) === match) || blocks.find(block => text(block)?.includes(match));
    return block && pageNumber + '/' + block.id;
  }, { pageNumber, match });
  assert(targetKey, 'requested editable region exists');
  if (process.argv.includes('--background')) {
    const region = page.locator('.pdf-word-region[data-key="' + targetKey + '"]');
    await region.scrollIntoViewIfNeeded();
    const probe = await page.evaluate(key => {
      const nodes = [...document.querySelectorAll('.pdf-word-region')];
      const text = nodes.find(node => node.dataset.key === key).getBoundingClientRect();
      const parent = nodes.filter(node => node.dataset.type === 'image').map(node => ({ node, box: node.getBoundingClientRect() }))
        .filter(({ box }) => box.left <= text.left && box.top <= text.top && box.right >= text.right && box.bottom >= text.bottom)
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
      if (!parent) return null;
      for (let y = parent.box.top + 3; y < parent.box.bottom; y += 5) for (let x = parent.box.left + 3; x < parent.box.right; x += 5) {
        if (document.elementFromPoint(x, y) === parent.node) return { background: { x, y }, image: parent.node.dataset.key,
          text: { x: text.left + text.width / 2, y: text.top + text.height / 2 } };
      }
      return null;
    }, targetKey);
    assert(probe, 'the table background remains selectable in blank space');
    await page.mouse.move(probe.background.x, probe.background.y); await page.mouse.click(probe.background.x, probe.background.y);
    assert(await page.locator('#wordDocumentReplace').isVisible());
    await page.mouse.move(probe.text.x, probe.text.y, { steps: 5 });
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dataset.key, probe.text), targetKey,
      'hovering/selected table background must not intercept its editable text');
  }
  await page.locator('.pdf-word-region[data-key="' + targetKey + '"]').click();
  const originalCanvas = await page.locator('#wordDocumentOverlay [data-wb-canvas]').evaluate(canvas => canvas.toDataURL());
  await page.locator('#wordDocumentEdit').click();
  assert.equal(await page.locator('#wordDocumentFontSize').count(), 0);
  const beforeText = await page.locator('#wordDocumentEditText').inputValue();
  const replacement = beforeText + '123';
  await page.locator('#wordDocumentEditText').fill(replacement);
  await page.screenshot({ path: path.join(output, 'edit-dialog.png') });
  await page.locator('#wordDocumentEditForm button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#wordDocumentEditOverlay').classList.contains('visible') || document.querySelector('#wordDocumentEditError').textContent);
  assert.equal(await page.locator('#wordDocumentEditError').innerText(), '');
  await page.waitForFunction(previous => document.querySelector('#wordDocumentOverlay [data-wb-canvas]').toDataURL() !== previous, originalCanvas);
  await page.screenshot({ path: path.join(output, 'edited-page.png') });
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#wordDocumentExport').click(); await (await download).saveAs(path.join(output, 'edited.docx'));
  const zip = await JSZip.loadAsync(await readFile(path.join(output, 'edited.docx')));
  const xml = await zip.file('word/document.xml').async('string');
  const nodes = (node, name) => [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => nodes(child, name))];
  const text = nodes(xml2js(xml, { captureSpacesBetweenElements: true }), 'w:t').flatMap(node => node.elements || []).map(node => node.text || '').join('');
  assert(text.replace(/\s/g, '').includes(replacement.replace(/\s/g, '')), 'appended text is present in the actual DOCX');
  const metrics = await page.evaluate(({ pageNumber }) => {
    const initial = window.__initialWordDocument, result = window.__editedWordDocument;
    const flatten = blocks => blocks.flatMap(block => block.columns ? block.columns.flatMap(column => flatten(column.blocks)) : block.cells ? block.cells.flatMap(cell => flatten(cell.blocks)) : [block]);
    const current = result.pages.find(page => page.number === pageNumber);
    const edited = flatten([...current.header, ...current.blocks, ...current.footer]).flatMap(block => block.lines || []).filter(line => line.items.some(item => item.id.includes(':edited:')));
    return { sourcePages: initial.pages.length, outputSourcePages: result.pages.length, fontSizes: [...new Set(edited.map(line => line.size))],
      lineCount: edited.length, changedOtherPages: result.pages.filter(page => page.number !== pageNumber && JSON.stringify(page) !== JSON.stringify(initial.pages.find(other => other.number === page.number))).length };
  }, { pageNumber });
  assert.equal(metrics.changedOtherPages, 0);
  assert.deepEqual(errors, []); assert.deepEqual(externalPosts, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...metrics, errors, externalPosts }, null, 2));
  console.log(JSON.stringify({ ...metrics, errors, externalPosts }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
