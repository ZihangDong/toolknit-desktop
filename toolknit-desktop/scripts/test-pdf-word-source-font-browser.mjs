import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve('tmp/pdf-word-source-font-browser'); await mkdir(out, { recursive: true });
// Existing unrestricted fixture; a deliberately small PDF Unicode map models
// a real subset without changing the original program's permission bits.
const bytes = await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'), parsed = fontkit.create(bytes);
const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); const face = await pdf.embedFont(bytes, { subset: false });
for (const text of ['中文AB', 'KEEP']) pdf.addPage([500, 300]).drawText(text, { x: 40, y: 200, size: 30, font: face });
const original = await PDFDocument.load(await pdf.save());
const dictionary = original.context.lookup(original.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).entries()[0][1], PDFDict);
const letters = [...new Set('中文ABKEEP')];
const pairs = letters.map(c => `<${parsed.glyphForCodePoint(c.codePointAt(0)).id.toString(16).padStart(4, '0')}> <${c.codePointAt(0).toString(16).padStart(4, '0')}>`).join('\n');
dictionary.set(PDFName.of('ToUnicode'), original.context.register(original.context.flateStream(`begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ${letters.length} beginbfchar\n${pairs}\nendbfchar endcmap`)));
const input = { name: 'source-font.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await original.save()) };
const server = await createServer({ configFile: false, cacheDir: 'tmp/pdf-word-source-font-browser/vite', optimizeDeps: { entries: ['index.html'] }, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/cli/**', '**/dist/**', '**/src-tauri/target/**', '**/.git/**'] } } });
await server.listen(); const url = server.resolvedUrls.local[0], browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], posts = [];
try {
  const context = await browser.newContext({ viewport: { width: 1380, height: 900 }, acceptDownloads: true });
  await context.route('**/*', route => {
    const request = route.request(); if (new URL(request.url()).origin === new URL(url).origin) return route.continue();
    if (request.method() === 'POST') posts.push(request.url());
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await context.addInitScript(() => {
    localStorage.setItem('toolknit-lang', 'zh'); localStorage.setItem('toolknit.theme.v3', 'light');
    window.__fontInitializations = 0; window.__finished = []; window.__workers = new Set(); window.__fontLoads = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.__workers.add(this); this.addEventListener('message', ({ data }) => { if (data.result?.schemaVersion && data.result.pages) window.__scene = structuredClone(data.result); }); }
      postMessage(data, ...args) { if (data.type === 'source-fonts') window.__fontInitializations++; if (data.type === 'finish') window.__finished.push(structuredClone(data.document)); return super.postMessage(data, ...args); }
      terminate() { window.__workers.delete(this); return super.terminate(); }
    };
    const nativeLoad = FontFace.prototype.load;
    FontFace.prototype.load = function () {
      if (!this.family.startsWith('TKPdf')) return nativeLoad.call(this);
      const face = this; return new Promise((resolve, reject) => window.__fontLoads.push(() => nativeLoad.call(face).then(resolve, reject)));
    };
    window.__releaseSourceFonts = () => { for (const load of window.__fontLoads.splice(0)) load(); };
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('[data-tool="pdf-to-word"]').first().evaluate(node => node.click()); await page.waitForSelector('#pdfWordOverlay.visible');
  const initialDownload = page.waitForEvent('download'); await page.locator('#pdfWordFileInput').setInputFiles(input);
  await page.waitForSelector('#pdfWordPagesOverlay.visible'); await page.locator('#pdfWordAllPages').click();
  await page.waitForSelector('#pdfWordSuccessOverlay.visible', { timeout: 180000 }); await (await initialDownload).saveAs(path.join(out, 'original.docx'));
  assert.equal(await page.evaluate(() => window.__fontInitializations), 1);
  await page.locator('#pdfWordEditDocument').click(); await page.waitForFunction(() => window.__fontLoads.length > 0);
  assert.equal(await page.locator('#wordDocumentRegions .pdf-word-region').count(), 0, 'editing is gated through font fetching and loading');
  await page.evaluate(() => window.__releaseSourceFonts());
  try { await page.waitForSelector('#wordDocumentRegions .pdf-word-region[data-type="text"]'); }
  catch (error) {
    await writeFile(path.join(out, 'font-load-failure.json'), JSON.stringify(await page.evaluate(() => ({
      fonts: [...document.fonts].map(face => ({ name: face.family, status: face.status })), pending: window.__fontLoads.length,
      status: document.querySelector('#wordDocumentStatus')?.textContent, preview: document.querySelector('#wordDocumentOverlay [data-wb-error]')?.textContent,
      inert: document.querySelector('#wordDocumentOverlay')?.inert, structure: document.querySelector('#wordDocumentStructure')?.outerHTML,
      canvas: document.querySelector('#wordDocumentOverlay [data-wb-canvas]')?.width
    })), null, 2)); throw error;
  }
  const countFonts = () => page.evaluate(() => [...document.fonts].filter(face => face.family.startsWith('TKPdf')).length);
  assert.equal(await countFonts(), 1);
  const initial = await page.evaluate(() => window.__scene);
  const item = initial.pages[0].blocks.flatMap(block => block.lines || []).flatMap(line => line.items).find(item => item.text === '中文AB');
  assert(item?.fontAssetId, 'actual conversion retains a document-owned font'); assert(item.font.length <= 31);
  const region = page.locator('#wordDocumentRegions .pdf-word-region[data-type="text"]').first(); await region.click();
  const pixels = await page.locator('#wordDocumentOverlay [data-wb-canvas]').evaluate(canvas => canvas.toDataURL());
  await page.locator('#wordDocumentEdit').click(); assert.equal(await page.locator('#wordDocumentEditText').inputValue(), '中文AB');
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit()); await page.waitForSelector('#wordDocumentEditOverlay.visible', { state: 'hidden' });
  assert.equal(await page.locator('#wordDocumentOverlay [data-wb-canvas]').evaluate(canvas => canvas.toDataURL()), pixels); assert(await page.locator('#wordDocumentUndo').isDisabled());
  await region.click(); await page.locator('#wordDocumentEdit').click(); await page.locator('#wordDocumentEditText').fill('中文AB123');
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit());
  if (await page.locator('#wordDocumentEditError').innerText()) {
    await writeFile(path.join(out, 'edit-failure.json'), JSON.stringify(await page.evaluate(async () => {
      const { resultTargets, availableTextRect } = await import('/src/features/pdf-to-word/core/result-edit.js');
      const { measureResultText } = await import('/src/features/pdf-to-word/result-preview.js');
      const page = window.__scene.pages[0], target = resultTargets(page).find(target => target.type === 'text');
      const context = document.createElement('canvas').getContext('2d');
      return { target, rect: availableTextRect(target, page), metrics: target.items.map(item => ({ text: item.text, metrics: measureResultText.metrics(item.text, item, context) })) };
    }), null, 2));
  }
  assert.equal(await page.locator('#wordDocumentEditError').innerText(), '');
  await page.waitForSelector('#wordDocumentEditOverlay.visible', { state: 'hidden' });
  await page.locator('#wordDocumentUndo').click(); await page.locator('#wordDocumentRedo').click();
  const editedDownload = page.waitForEvent('download'); await page.locator('#wordDocumentExport').click(); await (await editedDownload).saveAs(path.join(out, 'edited.docx'));
  await page.waitForSelector('#wordDocumentSuccessOverlay.visible'); const edited = await page.evaluate(() => window.__finished.at(-1));
  assert.deepEqual(edited.pages[1], initial.pages[1]);
  const runs = edited.pages[0].blocks.flatMap(block => block.lines || []).flatMap(line => line.items);
  const old = runs.filter(run => run.fontAssetId), inserted = runs.filter(run => run.sourceFont === item.font && !run.fontAssetId);
  assert.equal(old.map(run => run.text).join(''), '中文AB'); assert(old.every(run => run.font === item.font && run.size === item.size && run.baseline === item.baseline));
  assert.equal(inserted.map(run => run.text).join(''), '123'); assert(inserted.every(run => run.font === 'Arial' && !run.fontAssetId && run.size === item.size && run.baseline === item.baseline));
  let originalFontBytes;
  for (const filename of ['original.docx', 'edited.docx']) {
    const zip = await JSZip.loadAsync(await readFile(path.join(out, filename)));
    assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.odttf')).length, 1);
    const table = await zip.file('word/fontTable.xml').async('string'); assert(table.includes(item.font));
    const key = table.match(/w:fontKey="\{([0-9A-F-]+)\}"/)[1].replaceAll('-', '').match(/../g).map(value => parseInt(value, 16)).reverse();
    const program = await zip.file('word/fonts/font1.odttf').async('uint8array');
    for (let index = 0; index < 32; index++) program[index] ^= key[index % 16];
    if (originalFontBytes) assert.deepEqual(program, originalFontBytes, 'editing preserves the actual embedded program, independent of random OOXML GUIDs');
    else originalFontBytes = program;
  }
  await page.locator('#wordDocumentSuccessOk').click(); await page.locator('#wordDocumentReset').click(); await page.locator('#wordDocumentConfirmOk').click();
  await page.waitForFunction(() => document.querySelector('#wordDocumentReset').disabled);
  await page.locator('#wordDocumentOverlay .settings-back').click(); await page.waitForSelector('#wordDocumentConfirmOverlay.visible');
  await page.locator('#wordDocumentConfirmOk').click(); await page.waitForSelector('#pdfWordOverlay.visible');
  await page.waitForFunction(() => window.__workers.size === 0); assert.equal(await countFonts(), 0, 'document fonts are released with the editor');
  assert.deepEqual(errors, []); assert.deepEqual(posts, []);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ checks: ['one original-font initialization', 'real browser font loading gate', '31-character Windows font-name limit', 'no-op pixel equality', 'inserted-only missing glyph fallback', 'stable old font size baseline', 'unchanged second page', 'undo redo reset', 'font embedding in actual DOCX', 'worker and FontFace release'], errors, posts }, null, 2));
  console.log('Source font browser: real conversion, load gate, no-op, inserted-only fallback, history, DOCX and release passed.');
} finally { await browser.close(); await server.close(); }
