import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const out = path.resolve('tmp/pdf-word-ocr-font-browser'); await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, cacheDir: path.join(out, 'vite'), logLevel: 'error', optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/dist/**', '**/cli/**', '**/src-tauri/target/**'] } } });
await server.listen(); const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  const report = await page.evaluate(async () => {
    const { createOcrFontRegistry } = await import('/src/features/pdf-to-word/adapters/ocr-fonts.js');
    const { validateSourceFontAsset, validateDocumentFontAsset, createSourceFontScope } = await import('/src/features/pdf-to-word/adapters/source-font-runtime.js');
    const { inferDocument } = await import('/src/features/pdf-to-word/core/layout.js');
    const { createWordBytes } = await import('/src/features/pdf-to-word/adapters/docx.js');
    const { resultTargets, layoutEditedText, applyResultEdits } = await import('/src/features/pdf-to-word/core/result-edit.js');
    const { measureResultText } = await import('/src/features/pdf-to-word/result-preview.js');
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const canvas = (width, height) => new OffscreenCanvas(width, height);
    // Synthetic ink exercises geometry and lifecycle, not OCR recognition.
    const fixture = (split = false) => {
      const c = canvas(900, 540), context = c.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, c.width, c.height);
      const scene = { number: 1, width: 300, height: 180, items: [], sources: [], rules: [], risks: [], characters: 2 };
      for (let i = 0; i < 2; i++) {
        const x = 40 + i * 60, y = i ? 72 : 50, height = i ? 2 : 24;
        context.fillStyle = '#000'; context.fillRect(x * 3, y * 3, 60, height * 3);
        if (!i) { context.fillStyle = '#fff'; context.fillRect(x * 3 + 9, y * 3, 42, 27); context.fillRect(x * 3 + 9, y * 3 + 45, 42, 27); }
        const text = i ? '一' : 'H', rect = { x, y, width: 20, height };
        const id = 'p1:ocr' + i, font = split && i ? 'Times New Roman' : 'Arial';
        scene.items.push({ id, type: 'text', sourceIds: [id], text, rect, size: 30, baseline: 80, baselineX: x,
          font, bold: true, italic: false, color: '000000', preciseInk: true, ocr: true,
          words: [{ text, rect: { ...rect }, size: 30, baseline: 80, baselineX: x, font, preciseInk: true, confidence: .999 }] });
        scene.sources.push({ id, text, rect: { ...rect }, disposition: 'editable', order: i });
      }
      return { scene, pixels: context.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    };
    const count = () => [...document.fonts].filter(face => face.family.startsWith('TKInk')).length;
    const prepare = (registry, fixture, options) => registry.prepare(fixture.scene, fixture.pixels, fixture.width, fixture.height, options);
    const registry = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts }), input = fixture(), originalSources = structuredClone(input.scene.sources);
    await prepare(registry, input);
    const assets = registry.assets(input.scene), changed = input.scene.items.flatMap(item => item.words).filter(word => word.fontAssetId);
    assert(changed.length === 2, 'real FontFace painting must accept both complete synthetic glyphs');
    assert(assets.length === 1 && count() === 1, 'one shared face is owned by the document');
    assert(assets[0].bold && assets[0].weight === 700, 'parent bold style is inherited');
    assert(changed.every(word => Math.abs(word.size - 30) < .05), 'thin 一 retains the shared nominal size');
    assert(same(input.scene.sources, originalSources), 'font fitting cannot rewrite source text/coverage');
    await validateDocumentFontAsset(assets[0]);
    let rejected = false; try { await validateSourceFontAsset(assets[0]); } catch { rejected = true; }
    assert(rejected, 'generated contours cannot masquerade as original font permissions');
    const repeat = fixture(); await prepare(registry, repeat);
    assert(count() === 1 && registry.assets(repeat.scene).length === 1, 'repeat shapes reuse their loaded face');
    const converted = inferDocument([input.scene], { preserveGeometry: true });
    const result = await createWordBytes(converted, assets, { preserveGeometry: true });
    const editorSet = new Set(), editor = createSourceFontScope({ fontSet: editorSet });
    await editor.ensure(assets); assert(editorSet.size === 1, 'editor has a separate loaded ownership scope');
    const old = changed[0], inserted = editor.insertedStyle('新', old);
    assert(inserted.font === 'Microsoft YaHei' && !inserted.fontAssetId && inserted.size === old.size, 'only an inserted absent character falls back');
    assert(old.fontAssetId === assets[0].id, 'old runs retain their face');
    const target = resultTargets(converted.pages[0]).findLast(target => target.type === 'text'), measureContext = editor.context(canvas(1, 1).getContext('2d'));
    // The two isolated synthetic labels are inferred as narrow columns. Give
    // this style test an explicit free edit area; column inference is tested
    // separately with actual page geometry.
    target.container = { x: target.rect.x, y: 0, width: 300 - target.rect.x, height: 180 };
    const measure = (text, style) => measureResultText(text, style, measureContext);
    measure.metrics = (text, style) => measureResultText.metrics(text, style, measureContext);
    measure.resolveStyle = (text, style) => editor.insertedStyle(text, style);
    assert(same(layoutEditedText(target, target.text, measure), { type: 'noop' }), 'generated fonts retain exact no-op editing');
    const edit = layoutEditedText(target, target.text + '123', measure, { page: converted.pages[0] });
    const runs = edit.lines.flatMap(line => line.items), originalRuns = runs.filter(run => run.fontAssetId);
    assert(originalRuns.length > 0 && originalRuns.every(run => run.font === assets[0].name && run.size === 30 && run.bold), 'actual edit keeps singleton child font/size/emphasis');
    assert(runs.filter(run => !run.fontAssetId).map(run => run.text).join('') === '123', 'actual edit falls back only the inserted absent digits');
    const edited = applyResultEdits(converted, { [target.key]: edit });
    const editedResult = await createWordBytes(edited, assets, { preserveGeometry: true });
    editor.dispose(); assert(editorSet.size === 0, 'editor release');
    registry.dispose(); registry.dispose(); assert(count() === 0, 'worker owner releases all generated faces');
    // A bounded proposal scan must retain enough of the SAME allowance to
    // actually paint its accepted candidates. Four source H shapes used to
    // consume the budget before any generated face could be verified.
    const dense = fixture(), denseCanvas = canvas(900, 540), dc = denseCanvas.getContext('2d');
    dc.fillStyle = '#fff'; dc.fillRect(0, 0, 900, 540);
    const base = structuredClone(dense.scene.items[0]), denseWords = [];
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 60, y = 50;
      dc.fillStyle = '#000'; dc.fillRect(x * 3, y * 3, 60, 72);
      dc.fillStyle = '#fff'; dc.fillRect(x * 3 + 9, y * 3, 42, 27); dc.fillRect(x * 3 + 9, y * 3 + 45, 42, 27);
      denseWords.push({ ...structuredClone(base.words[0]), rect: { x, y, width: 20, height: 24 }, baselineX: x });
    }
    Object.assign(base, { text: 'HHHH', words: denseWords, rect: { x: 30, y: 50, width: 200, height: 24 }, baselineX: 30 });
    dense.scene.items = [base]; dense.scene.characters = 4;
    dense.scene.sources = [{ id: base.id, text: base.text, rect: { ...base.rect }, disposition: 'editable', order: 0 }];
    dense.pixels = dc.getImageData(0, 0, 900, 540).data;
    const denseBefore = structuredClone(dense.scene.sources), denseRegistry = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts });
    await prepare(denseRegistry, dense, { pixelBudget: 70000 });
    assert(denseWords.some(word => word.fontAssetId), 'dense proposals leave bounded work for actual generated-font paint instead of starving every candidate');
    assert(same(dense.scene.sources, denseBefore), 'the scheduling change preserves original text ownership');
    assert(denseRegistry.assets(dense.scene).length === 1, 'accepted repeated glyphs share one face within the original quota');
    denseRegistry.dispose(); assert(count() === 0, 'dense proposal owner releases its face');
    // Once a page has spent its only cohort, another family cannot produce
    // a font on this page. Its repeated ink must not exhaust work needed by
    // a later occurrence belonging to the existing cohort.
    const quota = fixture(), qc = canvas(900, 540), qp = qc.getContext('2d');
    qp.fillStyle = '#fff'; qp.fillRect(0, 0, 900, 540);
    const quotaBase = structuredClone(quota.scene.items[0]);
    quota.scene.items = []; quota.scene.sources = []; quota.scene.characters = 8;
    for (let i = 0; i < 8; i++) {
      const x = 30 + i % 4 * 60, y = 30 + Math.floor(i / 4) * 65;
      qp.fillStyle = '#000'; qp.fillRect(x * 3, y * 3, 60, 72);
      qp.fillStyle = '#fff'; qp.fillRect(x * 3 + 9, y * 3, 42, 27); qp.fillRect(x * 3 + 9, y * 3 + 45, 42, 27);
      const font = i > 0 && i < 7 ? 'Times New Roman' : 'Arial', id = 'p1:quota' + i;
      const rect = { x, y, width: 20, height: 24 }, baseline = y + 30;
      quota.scene.items.push({ ...structuredClone(quotaBase), id, sourceIds: [id], font, rect,
        baseline, baselineX: x, words: [{ ...structuredClone(quotaBase.words[0]), font, rect: { ...rect }, baseline, baselineX: x }] });
      quota.scene.sources.push({ id, text: 'H', rect: { ...rect }, disposition: 'editable', order: i });
    }
    quota.pixels = qp.getImageData(0, 0, 900, 540).data;
    const quotaBefore = structuredClone(quota.scene), quotaOwner = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts });
    await prepare(quotaOwner, quota, { maxFonts: 1, pixelBudget: 60000 });
    assert(quota.scene.items[0].words[0].fontAssetId && quota.scene.items[7].words[0].fontAssetId,
      'unavailable families do not starve the last existing-cohort glyph under the same 60000-pixel allowance');
    assert(quota.scene.items.slice(1, 7).every((item, i) => same(item, quotaBefore.items[i + 1])),
      'exhausted other families preserve their original spelling, geometry and style');
    assert(same(quota.scene.sources, quotaBefore.sources) && quotaOwner.assets(quota.scene).length === 1,
      'scheduling preserves all source ownership and the one-font quota');
    quotaOwner.dispose(); assert(count() === 0, 'quota owner releases its face');
    quota.scene = structuredClone(quotaBefore);
    for (const item of quota.scene.items.slice(1, 7)) {
      item.font = item.words[0].font = 'Arial'; item.bold = false;
    }
    const weightBefore = structuredClone(quota.scene), weightOwner = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts });
    await prepare(weightOwner, quota, { maxFonts: 1, pixelBudget: 60000 });
    assert(quota.scene.items[0].words[0].fontAssetId && quota.scene.items[7].words[0].fontAssetId,
      'another weight of the same family cannot exhaust the existing bold cohort work');
    assert(quota.scene.items.slice(1, 7).every((item, i) => same(item, weightBefore.items[i + 1]))
      && weightOwner.assets(quota.scene).length === 1, 'unavailable weights retain their source style and cannot share a bold font');
    weightOwner.dispose(); qc.width = qc.height = 0; assert(count() === 0, 'weight quota owner releases its face');
    const crowded = fixture(), seed = canvas(900, 540), compact = canvas(300, 6500), cc = compact.getContext('2d');
    seed.getContext('2d').putImageData(new ImageData(crowded.pixels, crowded.width, crowded.height), 0, 0);
    cc.fillStyle = '#fff'; cc.fillRect(0, 0, compact.width, compact.height); cc.drawImage(seed, 0, 0, 300, 180);
    seed.width = seed.height = 0;
    crowded.scene.height = 6500;
    cc.font = '10px Arial'; cc.fillStyle = '#000';
    for (let i = 0; i < 500; i++) {
      const y = 120 + i * 12, id = 'p1:filler' + i, rect = { x: 40, y, width: 7, height: 10 };
      cc.fillText('X', 40, y + 10);
      crowded.scene.items.push({ id, type: 'text', sourceIds: [id], text: 'X', rect, size: 10, baseline: y + 10,
        baselineX: 40, font: 'Arial', preciseInk: true, ocr: true, color: '000000',
        words: [{ text: 'X', rect: { ...rect }, size: 10, baseline: y + 10, baselineX: 40,
          font: 'Arial', preciseInk: true, confidence: .98 }] });
      crowded.scene.sources.push({ id, text: 'X', rect: { ...rect }, disposition: 'editable', order: i + 2 });
    }
    crowded.scene.characters += 500;
    // At one pixel per point this remains within the same decoded-page limit.
    crowded.width = 300; crowded.height = 6500; crowded.pixels = cc.getImageData(0, 0, 300, 6500).data;
    const crowdedBefore = structuredClone(crowded.scene); let stagedLoads = 0;
    const crowdedRegistry = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts,
      makeFace: (name, bytes, options) => { stagedLoads++; return new FontFace(name, bytes, options); } });
    await prepare(crowdedRegistry, crowded);
    assert(stagedLoads > 0, 'the dense-page test reaches actual font staging');
    assert(same(crowded.scene, crowdedBefore) && count() === 0 && crowdedRegistry.assets(crowded.scene).length === 0,
      'frame preflight overflow rolls back staged faces without changing source geometry or styles');
    crowdedRegistry.dispose(); compact.width = compact.height = 0;
    const sharedAllowance = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts,
      available: () => ({ fonts: 4, bytes: 2 * 1024 * 1024 }) });
    const early = fixture(true); await prepare(sharedAllowance, early, { remainingPages: 4 });
    assert(early.scene.items[0].words[0].fontAssetId && !early.scene.items[1].words[0].fontAssetId,
      'early pages share scarce font slots with the rest of the selected document');
    assert(sharedAllowance.assets(early.scene).length === 1);
    const late = fixture(true); await prepare(sharedAllowance, late, { remainingPages: 1 });
    assert(late.scene.items.every(item => item.words[0].fontAssetId), 'a later page can reuse the first face and consume unused document allowance');
    assert(sharedAllowance.assets(late.scene).length === 2);
    sharedAllowance.dispose(); assert(count() === 0, 'page quotas retain the same document owner and release path');
    for (const remainingPages of [0, 101, 1.5, NaN]) {
      const invalid = fixture(), before = structuredClone(invalid.scene), owner = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts });
      await prepare(owner, invalid, { remainingPages });
      assert(same(invalid.scene, before) && owner.assets(invalid.scene).length === 0, 'invalid remaining-page data cannot allocate a face'); owner.dispose();
    }
    const noisy = fixture(); let noiseLoads = 0;
    for (const item of noisy.scene.items) {
      item.rect.width = item.words[0].rect.width = 23;
      const offset = (Math.round(item.rect.y * 3) * noisy.width + Math.round(item.rect.x * 3) + 68) * 4;
      noisy.pixels[offset] = noisy.pixels[offset + 1] = noisy.pixels[offset + 2] = 0;
    }
    const noiseScene = structuredClone(noisy.scene), noiseRegistry = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts,
      makeFace: (name, bytes, options) => { noiseLoads++; return new FontFace(name, bytes, options); } });
    await prepare(noiseRegistry, noisy);
    assert(noiseLoads === 0 && same(noisy.scene, noiseScene), 'distant specks decline the entire proposal instead of silently deleting a component'); noiseRegistry.dispose();
    const cell = fixture(), cellItems = cell.scene.items;
    cell.scene.items = [{ type: 'table', cells: [{ blocks: [{ type: 'paragraph', lines: [{ items: cellItems }] }] }] }];
    const cellScene = structuredClone(cell.scene), cellRegistry = createOcrFontRegistry({ createCanvas: canvas, fontSet: document.fonts,
      makeFace: () => { throw Error('ordinary table fonts must retain the existing fitter'); } });
    await prepare(cellRegistry, cell);
    assert(same(cell.scene, cellScene) && !cellRegistry.assets(cell.scene).length, 'ordinary table preflight and shaping stay isolated'); cellRegistry.dispose();
    for (const mode of ['confidence', 'source', 'color', 'capacity', 'budget', 'load']) {
      const f = fixture(), fonts = new Set();
      if (mode === 'confidence') f.scene.items.forEach(item => { item.words[0].confidence = .98; });
      if (mode === 'source') f.scene.sources.forEach(source => { source.disposition = 'visible-image'; });
      if (mode === 'color') for (let i = 0; i < f.pixels.length; i += 4) if (!f.pixels[i]) f.pixels[i] = 180;
      const frozen = structuredClone(f.scene), r = createOcrFontRegistry({ createCanvas: canvas, fontSet: fonts,
        ...(mode === 'capacity' ? { available: () => ({ fonts: 0, bytes: 0 }) } : {}),
        ...(mode === 'load' ? { makeFace: () => ({ async load() { throw Error('unsupported'); } }) } : {}) });
      await prepare(r, f, mode === 'budget' ? { pixelBudget: 1 } : undefined);
      assert(same(f.scene, frozen) && fonts.size === 0 && r.assets(f.scene).length === 0, mode + ' keeps the old scene without a dangling face'); r.dispose();
    }
    let cancelled = false, loads = 0; const f = fixture(true), frozen = structuredClone(f.scene), set = document.fonts;
    const transactional = createOcrFontRegistry({ createCanvas: canvas, fontSet: set, makeFace: (name, bytes, options) => {
      const face = new FontFace(name, bytes, options), load = face.load.bind(face);
      face.load = async () => { await load(); if (++loads === 2) cancelled = true; return face; }; return face;
    } });
    let cancelledResult = false;
    try { await prepare(transactional, f, { check: () => { if (cancelled) throw Object.assign(Error('cancelled'), { code: 'cancelled' }); } }); }
    catch (error) { cancelledResult = error.code === 'cancelled'; }
    assert(cancelledResult && loads === 2, 'cancel after the first face was staged');
    assert(same(f.scene, frozen) && count() === 0, 'late cancellation rolls back every staged face and every scene change'); transactional.dispose();
    for (const dimension of ['fonts', 'bytes']) {
      const sample = fixture(), before = structuredClone(sample.scene), held = document.fonts;
      let capacity = { fonts: 32, bytes: 16 * 1024 * 1024 };
      const owner = createOcrFontRegistry({ createCanvas: canvas, fontSet: held, available: () => capacity,
        makeFace: (name, bytes, options) => {
          const face = new FontFace(name, bytes, options), load = face.load.bind(face);
          face.load = async () => { await load(); capacity = { ...capacity, [dimension]: 0 }; return face; }; return face;
        } });
      await prepare(owner, sample);
      assert(same(sample.scene, before) && count() === 0 && owner.assets(sample.scene).length === 0, 'late shared ' + dimension + ' allowance rolls back every staged font');
      assert(owner.capacity().fonts === 32 && owner.capacity().bytes === 16 * 1024 * 1024, 'uncommitted fonts consume no persistent allowance'); owner.dispose();
    }
    const merged = { ...input.scene.items[0], text: 'H一', rect: { x: 40, y: 50, width: 80, height: 24 },
      sourceIds: originalSources.map(source => source.id), words: input.scene.items.flatMap(item => item.words) };
    // A lower paragraph gives this real UI fixture a full text column. The
    // two isolated labels above intentionally have no room below their ink.
    const lower = { id: 'p1:uiLower', type: 'text', sourceIds: ['p1:uiLower'], text: 'Unchanged', font: 'Arial', size: 12,
      baseline: 145, baselineX: 40, rect: { x: 40, y: 133, width: 70, height: 14 } };
    window.__ocrFontUiFixture = { document: inferDocument([{ ...input.scene, items: [merged, lower],
      sources: [...originalSources, { id: lower.id, text: lower.text, rect: lower.rect, disposition: 'editable' }], characters: 11 }], { preserveGeometry: true }), assets };
    return { docx: Array.from(result.bytes), editedDocx: Array.from(editedResult.bytes), fontName: assets[0].name, syntheticGlyphs: changed.length, checks: ['real FontFace and actual paint', 'shared em thin glyph', 'inherited bold', 'source ledger preserved',
      'generated/original distinction', 'repeat reuse', 'actual DOCX', 'actual singleton edit keeps old styles', 'inserted-only fallback', 'separate editor scope', 'bounded final-paint reservation', 'frame-overflow rollback', 'shared page allowance', 'detached-speck ownership', 'ordinary-table isolation', 'negative ownership/confidence/color/load/budget', 'atomic late cancellation/shared capacity', 'release'] };
  });
  const bytes = Uint8Array.from(report.docx), zip = await JSZip.loadAsync(bytes); delete report.docx;
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.odttf')).length, 1, 'actual DOCX embeds the validated generated font');
  assert((await zip.file('word/document.xml').async('string')).includes(report.fontName), 'serialized text is bound to the embedded font');
  await writeFile(path.join(out, 'generated.docx'), bytes);
  const editedBytes = Uint8Array.from(report.editedDocx); delete report.editedDocx;
  const editedZip = await JSZip.loadAsync(editedBytes);
  assert.equal(Object.keys(editedZip.files).filter(name => name.endsWith('.odttf')).length, 1);
  const editedXml = await editedZip.file('word/document.xml').async('string');
  assert(editedXml.includes(report.fontName) && editedXml.replace(/<[^>]*>/g, '').includes('123') && editedXml.includes('Arial'));
  await writeFile(path.join(out, 'generated-edited.docx'), editedBytes);
  await page.evaluate(async () => {
    await import('/src/styles.css'); await import('/src/features/pdf-to-word/pdf-to-word.css');
    const { createWordDocumentEditor } = await import('/src/features/pdf-to-word/document-editor.js');
    const { createWordBytes } = await import('/src/features/pdf-to-word/adapters/docx.js');
    const { assets, document: baseline } = window.__ocrFontUiFixture;
    window.__ocrFontUiReleased = 0; window.__ocrFontUiExports = [];
    window.__ocrFontUiEditor = createWordDocumentEditor();
    window.__ocrFontUiEditor.open({ document: baseline, name: 'generated-editor.docx',
      worker: { async request(type, data) {
        if (type === 'assets') return assets.filter(asset => data.ids.includes(asset.id));
        if (type === 'finish') { window.__ocrFontUiExports.push(structuredClone(data.document)); return createWordBytes(data.document, assets, data.options); }
        throw Error('Unexpected synthetic worker operation');
      } }, release() { window.__ocrFontUiReleased++; } });
  });
  const region = page.locator('#wordDocumentRegions [data-type="text"]').first(), canvas = page.locator('#wordDocumentOverlay [data-wb-canvas]');
  await region.waitFor(); await region.click();
  const noOpPixels = await canvas.evaluate(c => c.toDataURL());
  await page.locator('#wordDocumentEdit').click();
  const text = await page.locator('#wordDocumentEditText').inputValue();
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit());
  await page.waitForSelector('#wordDocumentEditOverlay.visible', { state: 'hidden' });
  assert.equal(await canvas.evaluate(c => c.toDataURL()), noOpPixels, 'actual generated-font editor no-op retains all pixels');
  await region.click(); await page.locator('#wordDocumentEdit').click(); await page.locator('#wordDocumentEditText').fill(text + '123');
  await page.locator('#wordDocumentEditForm').evaluate(form => form.requestSubmit());
  const uiError = await page.locator('#wordDocumentEditError').innerText();
  if (uiError) await writeFile(path.join(out, 'generated-ui-edit-failure.json'), JSON.stringify(await page.evaluate(async () => {
    const { resultTargets, availableTextRect } = await import('/src/features/pdf-to-word/core/result-edit.js');
    const page = window.__ocrFontUiFixture.document.pages[0], targets = resultTargets(page);
    return { message: document.querySelector('#wordDocumentEditError').textContent, targets: targets.map(target => ({ target, available: availableTextRect(target, page) })) };
  }), null, 2));
  assert.equal(uiError, '');
  await page.waitForSelector('#wordDocumentEditOverlay.visible', { state: 'hidden' });
  assert.equal(await page.locator('#wordDocumentEditError').innerText(), '');
  await page.locator('#wordDocumentUndo').click();
  await page.waitForFunction(before => document.querySelector('#wordDocumentOverlay [data-wb-canvas]').toDataURL() === before, noOpPixels);
  await page.locator('#wordDocumentRedo').click();
  const download = page.waitForEvent('download'); await page.locator('#wordDocumentExport').click();
  await (await download).saveAs(path.join(out, 'generated-ui-edited.docx'));
  await page.waitForSelector('#wordDocumentSuccessOverlay.visible');
  const uiSaved = await page.evaluate(() => window.__ocrFontUiExports.at(-1));
  const uiText = uiSaved.pages.flatMap(p => [...p.header, ...p.blocks, ...p.footer]).flatMap(b => b.lines || []).flatMap(l => l.items).filter(item => item.id !== 'p1:uiLower');
  assert.equal(uiText.filter(item => item.fontAssetId).map(item => item.text).join(''), 'H一');
  assert(uiText.filter(item => item.fontAssetId).every(item => item.font === report.fontName && item.size === 30 && item.bold));
  assert.equal(uiText.filter(item => !item.fontAssetId).map(item => item.text).join(''), '123');
  await page.locator('#wordDocumentSuccessOk').click(); await region.click(); await page.locator('#wordDocumentDelete').click();
  await page.locator('#wordDocumentUndo').click();
  await page.evaluate(() => { window.__ocrFontUiEditor.dispose(); window.__ocrFontUiEditor.dispose(); });
  assert.equal(await page.evaluate(() => window.__ocrFontUiReleased), 1);
  assert.equal(await page.evaluate(() => [...document.fonts].filter(face => face.family.startsWith('TKInk')).length), 0);
  report.checks.push('actual shared editor no-op/add/delete/undo/redo/DOCX/disposal');
  assert.deepEqual(errors, []); await writeFile(path.join(out, 'report.json'), JSON.stringify({ ...report, errors }, null, 2));
  console.log('Generated OCR font browser: ' + report.checks.join(', ') + ' passed.');
} finally { await browser.close(); await server.close(); }
