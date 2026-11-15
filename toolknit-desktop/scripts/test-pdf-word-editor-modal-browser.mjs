import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve('tmp/pdf-word-editor-modal-browser'); await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, logLevel: 'error', cacheDir: path.join(out, 'vite'), optimizeDeps: { entries: [] },
  plugins: [{ name: 'editor-modal-fixture', configureServer(server) { server.middlewares.use('/__editor_modal_test', (_, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>');
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/dist/**', '**/cli/**', '**/src-tauri/target/**'] } } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true }), errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0] + '__editor_modal_test');
  await page.evaluate(async () => {
    await import('/src/features/pdf-to-word/pdf-to-word.css');
    const { createWordDocumentEditor } = await import('/src/features/pdf-to-word/document-editor.js');
    const { inferDocument } = await import('/src/features/pdf-to-word/core/layout.js');
    const { createWordBytes } = await import('/src/features/pdf-to-word/adapters/docx.js');
    const { leafBlocks } = await import('/src/features/pdf-to-word/core/layout.js');
    const scene = { number: 1, width: 595, height: 842, rules: [], risks: [], characters: 23,
      items: [{ id: 'first', type: 'text', sourceIds: ['first'], text: 'Editable text', font: 'Arial', size: 14,
        rect: { x: 50, y: 60, width: 90, height: 16 }, baseline: 74 },
      { id: 'second', type: 'text', sourceIds: ['second'], text: 'Keep style', font: 'Times New Roman', size: 12, italic: true,
        rect: { x: 50, y: 160, width: 90, height: 15 }, baseline: 172 }] };
    scene.sources = scene.items.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' }));
    const baseline = inferDocument([scene], { preserveGeometry: true }), exported = [];
    let releasePaint, paint;
    const holdPaint = () => { paint = new Promise(resolve => { releasePaint = resolve; }); };
    holdPaint();
    const worker = { async request(type, payload) {
      if (type === 'assets') { await paint; return []; }
      if (type === 'finish') { exported.push(structuredClone(payload.document)); return createWordBytes(payload.document, [], payload.options); }
      throw Error('unexpected fixture transport');
    } };
    const editor = createWordDocumentEditor(); let released = 0;
    editor.open({ document: baseline, worker, name: 'modal-test.docx', release() { released++; } });
    window.__modalTest = { editor, baseline, exported, holdPaint, releasePaint: () => releasePaint(), leafBlocks, get released() { return released; } };
  });
  const first = page.locator('#wordDocumentRegions [data-type="text"]').first();
  await first.evaluate(node => node.click()); await page.locator('#wordDocumentEdit').evaluate(node => node.click());
  const original = await page.locator('#wordDocumentEditText').inputValue();
  await page.locator('#wordDocumentEditText').fill(original + '123');
  // Finish the real pending preview and thumbnail while its sibling edit modal
  // owns focus. The renderer calls the actual editor.render() on completion.
  await page.evaluate(() => __modalTest.releasePaint());
  await page.waitForFunction(() => document.querySelector('#wordDocumentOverlay [data-wb-canvas]').width > 0);
  assert.equal(await page.locator('#wordDocumentEditText').inputValue(), original + '123');
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit());
  await page.locator('#wordDocumentEditOverlay.visible').waitFor({ state: 'hidden', timeout: 3000 });
  assert(await page.locator('#wordDocumentUndo').isEnabled(), 'late preview completion must not discard the active edit target');
  const download = page.waitForEvent('download'); await page.locator('#wordDocumentExport').evaluate(node => node.click());
  await (await download).saveAs(path.join(out, 'edited.docx'));
  await page.locator('#wordDocumentSuccessOverlay.visible').waitFor();
  const state = await page.evaluate(() => {
    const { baseline, exported, leafBlocks } = __modalTest, flatten = doc => leafBlocks(doc.pages[0].blocks).flatMap(b => b.lines.flatMap(l => l.items));
    const before = flatten(baseline), after = flatten(exported.at(-1));
    return { edited: after.some(item => item.text === 'Editable text123'), neighbour: JSON.stringify(before.at(-1)) === JSON.stringify(after.at(-1)),
      styles: after.filter(item => item.text?.startsWith('Editable')).map(item => ({ font: item.font, size: item.size })) };
  });
  assert(state.edited && state.neighbour); assert.deepEqual(state.styles, [{ font: 'Arial', size: 14 }]);
  await page.locator('#wordDocumentSuccessOk').evaluate(node => node.click());
  await page.locator('#wordDocumentUndo').evaluate(node => node.click());
  await first.evaluate(node => node.click()); await page.locator('#wordDocumentEdit').evaluate(node => node.click());
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit());
  await page.locator('#wordDocumentEditOverlay.visible').waitFor({ state: 'hidden' });
  assert(await page.locator('#wordDocumentUndo').isDisabled(), 'no-op after undo creates no new history');
  await page.locator('#wordDocumentRedo').evaluate(node => node.click());
  for (const cancelWithEscape of [false, true]) {
    await page.evaluate(() => { __modalTest.holdPaint(); document.querySelector('[data-wb-zoom="in"]').click(); });
    await first.evaluate(node => node.click()); await page.locator('#wordDocumentEdit').evaluate(node => node.click());
    const previous = await page.locator('#wordDocumentEditText').inputValue();
    await page.locator('#wordDocumentEditText').fill(previous + 'discard');
    const size = await page.locator('[data-wb-canvas]').evaluate(node => node.width);
    await page.evaluate(() => __modalTest.releasePaint());
    await page.waitForFunction(size => document.querySelector('[data-wb-canvas]').width !== size, size);
    if (cancelWithEscape) await page.locator('#wordDocumentEditText').press('Escape');
    else await page.locator('#wordDocumentEditCancel').evaluate(node => node.click());
    await page.locator('#wordDocumentEditOverlay.visible').waitFor({ state: 'hidden' });
    assert(await page.locator('#wordDocumentUndo').isEnabled(), 'cancel and Escape restore history controls after a locked render');
    await first.evaluate(node => node.click()); await page.locator('#wordDocumentEdit').evaluate(node => node.click());
    assert.equal(await page.locator('#wordDocumentEditText').inputValue(), previous, 'cancelled text must not leak into the document');
    await page.locator('#wordDocumentEditCancel').evaluate(node => node.click());
  }
  await page.evaluate(() => { __modalTest.editor.dispose(); __modalTest.editor.dispose(); });
  assert.equal(await page.evaluate(() => __modalTest.released), 1); assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ latePaintEdit: true, preservedNeighbour: true, noOp: true, cancelAndEscapeRestoreControls: true, releasedOnce: true, errors }, null, 2));
  console.log('Word document editor: delayed preview preserves modal target, style, neighbour, export, undo and disposal.');
} finally { await browser.close(); await server.close(); }
