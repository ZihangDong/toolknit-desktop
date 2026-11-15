import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { nativeCaptionedFigureIds, retainUnverifiedImageSources } from '../src/features/pdf-to-word/core/ocr-figure-ownership.js';
import { needsPageOcr, prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const captionText = 'Figure 2: Original illustration and its labels';
const native = (id, text, rect, size = 12) => ({ id, type: 'text', text, rect, size,
  sourceIds: [id], raster: false, baseline: rect.y + rect.height, font: 'Arial', color: '000000' });
const body = [native('body1', 'This is a complete native paragraph. '.repeat(3), { x: 20, y: 15, width: 740, height: 15 }),
  native('body2', 'The source already contains independently readable body text. '.repeat(2), { x: 20, y: 50, width: 740, height: 15 })];
const caption = native('caption', captionText, { x: 80, y: 500, width: 640, height: 15 });
const figure = { id: 'figure', type: 'image', role: 'figure', rect: { x: 80, y: 140, width: 640, height: 350 },
  sourceIds: [], reasons: [], drawingIds: ['original-raster'], order: 3 };
const scene = { number: 1, width: 800, height: 1000, rasterPage: false, risks: [], rules: [], characters: 200,
  items: [...body, caption, figure], sources: [...body, caption].map(item => ({ id: item.id, text: item.text,
    rect: item.rect, disposition: 'editable' })) };
const before = structuredClone(scene);
assert.deepEqual([...nativeCaptionedFigureIds(scene)], ['figure']);
assert.equal(needsPageOcr(scene), false, 'a known figure does not force native prose through OCR');
for (const mutate of [
  s => { s.rasterPage = true; },
  s => { s.risks.push('image-page'); },
  s => { s.items[2].ocr = true; },
  s => { s.items[2].text = 'Table 2: Native table'; s.sources[2].text = s.items[2].text; },
  s => { s.sources[2].text = 'unrelated source'; },
  s => { s.sources[2].text += '\u0001'; },
  s => { s.items[2].rect.y = 540; },
  s => { s.items[2].rect.width = 100; },
  s => { s.items[3].reasons = ['unknown-clipping']; },
  s => { s.items[3].sourceIds = ['native-label']; },
  s => { s.items[0].rect.y = 200; },
  s => { s.items[0].text = 'short'; s.items[1].text = 'short'; },
  s => { s.items[3].rect = { x: 0, y: 0, width: 800, height: 1000 }; },
]) {
  const copy = structuredClone(scene); mutate(copy);
  assert.equal(nativeCaptionedFigureIds(copy).size, 0, 'uncertain ownership keeps the existing scan policy');
  assert.equal(needsPageOcr(copy), true);
}
assert.deepEqual(scene, before, 'classification does not rewrite sources or scene geometry');

// A different scanned area may still require OCR on the same page. Its result
// cannot reclaim an already proven figure or erase the original picture text.
const canvas = createCanvas(800, 1000), ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 1000); ctx.fillStyle = 'black'; ctx.font = '24px Arial';
ctx.fillText('Original picture labels', 110, 220); ctx.fillText('Scanned body', 110, 730);
const pixels = ctx.getImageData(0, 0, 800, 1000).data;
const mixed = structuredClone(scene);
mixed.items.push({ id: 'scan', type: 'image', role: 'figure', rect: { x: 30, y: 640, width: 740, height: 300 },
  sourceIds: [], drawingIds: ['scan-raster'], reasons: [] });
assert.equal(needsPageOcr(mixed), true);
const output = prepareOcrScene({ scene: mixed, result: { width: 800, height: 1000, lines: [
  { text: 'Incorrect picture transcription', x: 100, y: 195, width: 320, height: 35, confidence: .99 },
  { text: 'Scanned body', x: 100, y: 705, width: 200, height: 35, confidence: .99 },
] }, pixels, width: 800, height: 1000, preserveGeometry: true, measurementContext: ctx });
assert(output.changed);
assert(output.scene.items.some(item => item.ocrBackground), 'mixed-page source pixels remain in the existing background owner');
assert(!output.scene.items.some(item => item.ocr && item.text.includes('Incorrect')));
assert(output.scene.items.some(item => item.ocr && item.text === 'Scanned body'));
for (let y = 140; y < 490; y++) for (let x = 80; x < 720; x++) {
  const at = (y * 800 + x) * 4;
  assert.deepEqual(output.pixels.subarray(at, at + 4), pixels.subarray(at, at + 4));
}
// A mixed page can already contain a real borderless Word table. If every
// extra OCR hypothesis is rejected, the native table must not be flattened
// into independent paragraphs merely to account for the uncertain photo ink.
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 1000);
ctx.fillStyle = '#777777'; ctx.fillRect(110, 720, 18, 25);
const names = [native('name', 'NAME', { x: 40, y: 75, width: 40, height: 12 }),
  native('value', 'Alice', { x: 160, y: 75, width: 40, height: 12 })];
const table = { id: 'native-table', type: 'table', borderless: true, sourceIds: names.map(n => n.id),
  rect: { x: 30, y: 65, width: 240, height: 30 }, rows: 1, columnWidths: [120, 120], rowHeights: [30],
  cells: names.map((item, col) => ({ row: 0, col, rowSpan: 1, colSpan: 1,
    rect: { x: 30 + col * 120, y: 65, width: 120, height: 30 }, sourceIds: [item.id],
    blocks: [{ id: item.id + ':block', type: 'paragraph', sourceIds: [item.id], rect: item.rect, size: 12,
      lines: [{ rect: item.rect, sourceIds: [item.id], items: [item], text: item.text, baseline: item.baseline, size: 12 }], align: 'left' }] })) };
const photo = { id: 'uncertain-photo', type: 'image', role: 'figure', rect: { x: 30, y: 640, width: 740, height: 300 },
  sourceIds: [], drawingIds: ['original-photo'], reasons: [] };
const nativeTableScene = { ...scene, items: [table, photo], sources: names.map(item => ({
  id: item.id, text: item.text, rect: item.rect, disposition: 'editable' })), risks: ['image-page'],
  characters: names.reduce((sum, item) => sum + item.text.length, 0) };
const nativeTableBefore = structuredClone(nativeTableScene), originalPixels = ctx.getImageData(0, 0, 800, 1000).data;
const uncertainPage = prepareOcrScene({ scene: nativeTableScene, result: { width: 800, height: 1000,
  lines: [{ text: '1', x: 100, y: 710, width: 40, height: 45, confidence: .61,
    words: [{ text: '1', x: 110, y: 720, width: 18, height: 25, confidence: .61 }] }] },
  pixels: originalPixels, width: 800, height: 1000, preserveGeometry: true, measurementContext: ctx });
assert.deepEqual(uncertainPage.scene.items.find(item => item.type === 'table'), table, 'a rejected photo token cannot destroy native table semantics');
assert.deepEqual(uncertainPage.pixels, originalPixels, 'no accepted OCR text means no native text erasure');
assert.deepEqual(nativeTableScene, nativeTableBefore);
const weakSource = uncertainPage.scene.sources.find(source => source.ocrUnverified);
assert(weakSource && weakSource.disposition === 'visible-image');
assert(uncertainPage.scene.items.find(item => item.id === photo.id).sourceIds.includes(weakSource.id));
assert(uncertainPage.scene.risks.includes('ocr-low-confidence'));
assert.equal(uncertainPage.changed, false, 'metadata-only recovery does not repaint or allocate a replacement background');
assert.equal(uncertainPage.scene.items.filter(item => item.type === 'image').length, 1);
assert(!uncertainPage.scene.items.some(item => item.ocrBackground));
assert.deepEqual(uncertainPage.scene.sources.slice(0, names.length), nativeTableScene.sources);
const assets = await collectPageAssets(uncertainPage.scene, canvas, createCanvas);
const document = inferDocument([uncertainPage.scene], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, 1, 'uncertainty remains in source accounting while native characters stay editable');
const word = await createWordBytes(document, assets, { preserveGeometry: true, measurementContext: ctx });
const xml = await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
assert.equal((xml.match(/<w:tc>/g) || []).length, 2);
assert(xml.includes('NAME') && xml.includes('Alice'));
for (const mutate of [
  list => { list[0].id = 'name'; },
  list => { list.push(structuredClone(list[0])); },
  list => { list[0].rect.x = 790; },
  list => { list[0].disposition = 'editable'; },
  list => { list[0].ocrUnverified = false; },
]) {
  const candidates = [structuredClone(weakSource)]; mutate(candidates);
  assert.equal(retainUnverifiedImageSources(nativeTableScene, candidates), null);
  assert.deepEqual(nativeTableScene, nativeTableBefore, 'failed attribution never partially mutates the native page');
}
const nestedImage = { ...photo, id: 'small-photo', rect: { x: 100, y: 700, width: 80, height: 80 } };
const nested = retainUnverifiedImageSources({ ...nativeTableScene, items: [...nativeTableScene.items, nestedImage] }, [weakSource]);
assert.deepEqual(nested.items.find(item => item.id === photo.id).sourceIds, []);
assert.deepEqual(nested.items.find(item => item.id === nestedImage.id).sourceIds, [weakSource.id], 'the smallest complete image owns the hypothesis once');
canvas.width = canvas.height = 0;
console.log('OCR figures: native caption proof, scan fallback, all-uncertain native table retention, exact pixels, actual DOCX, bounded image ownership and atomic refusal passed.');
