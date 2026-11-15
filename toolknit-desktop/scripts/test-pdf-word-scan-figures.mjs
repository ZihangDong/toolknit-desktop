import assert from 'node:assert/strict';
import { createScanFigureFixture as fixture } from './lib/pdf-word-scan-fixture.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { scanFigureRegions } from '../src/features/pdf-to-word/core/scan-figure-regions.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { collectScanFigureAssets } from '../src/features/pdf-to-word/adapters/scan-figure-assets.js';
import { collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { contains, overlaps } from '../src/features/pdf-to-word/core/geometry.js';


for (const scale of [.8, 1, 2]) {
  const data = fixture({ scale }), before = data.pixels.slice(), resultBefore = structuredClone(data.result);
  const plans = scanFigureRegions(data);
  assert.equal(plans.length, 1, 'one complete diagram, independent of raster resolution');
  const p = plans[0];
  for (const line of data.result.lines.slice(0, 4).concat(data.result.lines.at(-1))) assert(!overlaps(p.pixelRect, line, 0), 'prose including short paragraph tail is outside crop');
  for (const line of data.result.lines.slice(4, 8)) assert(contains(p.pixelRect, line, 0), 'diagram and legend labels are complete');
  const prepared = prepareOcrScene({ ...data, preserveGeometry: true, preserveScanFigures: true });
  const figures = prepared.scene.items.filter(i => i.scanFigure);
  assert.equal(figures.length, 1);
  for (const index of p.lineIndexes) assert(!prepared.scene.items.some(i => i.type === 'text' && i.id === `p7:ocr${index}`));
  const sourceIds = figures[0].sourceIds;
  assert(sourceIds.length > 0);
  for (const id of sourceIds) {
    assert.equal(prepared.scene.items.filter(i => i.sourceIds?.includes(id)).length, 1, 'unique image owner');
    assert.equal(prepared.scene.sources.find(s => s.id === id).disposition, 'visible-image');
  }
  assert(prepared.scene.items.some(i => i.type === 'text' && i.text === data.result.lines.at(-1).text));
  const assets = await collectScanFigureAssets(prepared.scene, data.canvas, createCanvas);
  assert.equal(assets.length, 1); assert.equal(assets[0].format, 'png');
  const decoded = await loadImage(Buffer.from(assets[0].bytes)), crop = createCanvas(decoded.width, decoded.height), cc = crop.getContext('2d');
  cc.drawImage(decoded, 0, 0);
  const pixels = cc.getImageData(0, 0, crop.width, crop.height).data, box = figures[0].scanFigure.pixelRect;
  for (let y = 0; y < box.height; y++) {
    const start = ((box.y + y) * data.width + box.x) * 4;
    assert.deepEqual(pixels.subarray(y * box.width * 4, (y + 1) * box.width * 4), before.subarray(start, start + box.width * 4), 'PNG is an exact crop of the visible original');
    for (let x = box.x; x < box.x + box.width; x++) {
      const at = ((box.y + y) * data.width + x) * 4;
      assert.deepEqual([...prepared.pixels.subarray(at, at + 4)], [255, 255, 255, 255], 'deleting image leaves no background picture/labels');
    }
  }
  assert.deepEqual(data.pixels, before); assert.deepEqual(data.result, resultBefore);
  const cleanCanvas = createCanvas(data.width, data.height);
  cleanCanvas.getContext('2d').putImageData(new (await import('@napi-rs/canvas')).ImageData(prepared.pixels, data.width, data.height), 0, 0);
  assets.push(...await collectPageAssets({ ...prepared.scene, items: prepared.scene.items.filter(i => !i.scanFigure) }, cleanCanvas, createCanvas));
  const doc = inferDocument([prepared.scene], { preserveGeometry: true }); validateCoverage(doc);
  const out = await createWordBytes(doc, assets, { preserveGeometry: true }), zip = await JSZip.loadAsync(out.bytes), xml = await zip.file('word/document.xml').async('string');
  assert(xml.includes('Question')); assert(!xml.includes('Picture label')); assert(!xml.includes('Legend')); assert(!xml.includes('HIDDEN'));
  assert(out.quality.imageCharacters > 0); assert(out.quality.editableCharacters > 0);
  const old = prepareOcrScene({ ...data, preserveGeometry: true, preserveScanFigures: false });
  assert(!old.scene.items.some(i => i.scanFigure), 'explicit baseline switch retains original path');
}
assert.equal(scanFigureRegions(fixture({ diagram: false })).length, 0, 'body alone is never a figure');
assert.equal(scanFigureRegions(fixture({ diagram: false, table: true })).length, 0, 'ruled table stays editable');
const valid = fixture();
for (const mutate of [
  d => { d.result.width++; }, d => { d.scene.sources = [{ id: 'native', text: 'native' }]; },
  d => { d.width = Infinity; }, d => { d.scene.width = Infinity; }, d => { d.result.lines = Array(1001).fill({}); },
]) { const d = { ...valid, result: structuredClone(valid.result), scene: structuredClone(valid.scene) }; mutate(d); assert.deepEqual(scanFigureRegions(d), []); }
assert.throws(() => scanFigureRegions({ ...valid, check: () => { throw new Error('cancelled'); } }), /cancelled/);
let disposed;
await assert.rejects(collectScanFigureAssets({ items: [{ type: 'image', id: 'cancel', scanFigure: { version: 1, width: valid.width, height: valid.height, pixelRect: { x: 100, y: 200, width: 200, height: 200 } } }] },
  valid.canvas, (w, h) => { const c = createCanvas(w, h); disposed = { width: w, height: h, getContext: () => c.getContext('2d'), toBuffer: (...args) => c.toBuffer(...args) }; return disposed; }, (() => { let checks = 0; return () => { if (++checks === 2) throw new Error('cancelled'); }; })()), /cancelled/);
assert.equal(disposed.width, 0); assert.equal(disposed.height, 0);
console.log('Local scan figures: complete labels, prose/table protection, exact visible PNG, unique ownership, real DOCX, baseline switch, bounds and cancellation passed.');
