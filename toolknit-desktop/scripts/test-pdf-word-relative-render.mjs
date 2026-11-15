import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, beginText, endText, setFontAndSize, moveText, showText } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';

// Actual PDF.js source/display optimization and operationsFilter proof. The
// synthetic scene explicitly requests the mapping mode; proposal semantics
// are independently tested in test-pdf-word-relative-text and real originals.
async function input({ removeBody = false, unsafe = false } = {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman), p = doc.addPage([360, 200]);
  p.drawText('Independent earlier body', { x: 20, y: 170, size: 10, font });
  const key = p.node.newFontDictionary(font.name, font.ref);
  p.pushOperators(beginText(), setFontAndSize(key, 10), moveText(30, 120), showText(font.encodeText('BASE')),
    moveText(25, 4), setFontAndSize(key, 7), showText(font.encodeText('*')), setFontAndSize(key, 10));
  if (!unsafe) p.pushOperators(moveText(0, -4));
  if (!removeBody) p.pushOperators(showText(font.encodeText(', Middle Other Third')));
  p.pushOperators(moveText(-20, -18), showText(font.encodeText('Unchanged following line')), endText());
  return doc.save();
}
const loads = [];
const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') + '/';
try {
  const operation = {}, canvas = createCanvas(1, 1), references = [];
  let scene, body, marker;
  for (const removeBody of [false, true]) {
    const loading = getDocument({ data: await input({ removeBody }), standardFontDataUrl, useSystemFonts: false, fontExtraProperties: true }); loads.push(loading);
    const doc = await loading.promise, page = await doc.getPage(1), snap = await snapshotPage(page, OPS);
    await renderPage(page, canvas, operation); snap.fonts = snapshotFonts(page, snap.fontIds);
    references.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.slice());
    if (removeBody) continue;
    const raw = buildPageScene(snap, { traceTypography: true });
    body = raw.sources.find(s => s.text === ', Middle Other Third'); marker = raw.sources.find(s => s.text === '*');
    assert(body && marker);
    const rect = union([body.rect, marker.rect]), index = body.order;
    scene = { number: 1, width: 360, height: 200, sources: raw.sources.map(s => ({ ...s,
      disposition: s.id === marker.id ? 'visible-image' : s.id === body.id ? 'editable' : s.disposition })),
    items: [{ id: 'reference-layer', type: 'image', role: 'figure', sourceIds: [marker.id], rect,
      backgroundPaintIndexes: [index], relativeTextPaintIndexes: [index] }] };
    const original = structuredClone(scene);
    const assets = await collectPageAssets(scene, canvas, createCanvas);
    assert.equal(assets.length, 1); assert.deepEqual(assets[0].excludedPaintIndexes, [index]);
    assert.deepEqual(scene.sources, original.sources, 'collecting pixels never edits source ownership');
    const image = await loadImage(assets[0].bytes), crop = createCanvas(image.width, image.height);
    crop.getContext('2d').drawImage(image, 0, 0); references.push({ crop: crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data.slice(),
      x: Math.floor(rect.x * canvas.width / 360), y: Math.floor(rect.y * canvas.height / 200), width: crop.width, height: crop.height,
      canvasWidth: canvas.width, original: references[0] });
    const options = [
      item => { delete item.relativeTextPaintIndexes; },
      item => { item.relativeTextPaintIndexes = [index + 1]; },
      item => { item.relativeTextPaintIndexes = [index, index]; },
      item => { item.relativeTextPaintIndexes = []; },
      item => { item.relativeTextPaintIndexes = 'invalid'; },
    ];
    for (const mutate of options) {
      const bad = structuredClone(original); mutate(bad.items[0]);
      await assert.rejects(collectPageAssets(bad, canvas, createCanvas), /pdf-to-word:image/);
    }
    let checks = 0; const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const staged = [], factory = (w, h) => {
      const value = createCanvas(w, h), requested = { width: w, height: h };
      for (const key of ['width', 'height']) {
        let proto = value, descriptor;
        while (proto && !(descriptor = Object.getOwnPropertyDescriptor(proto, key))) proto = Object.getPrototypeOf(proto);
        assert(descriptor?.get && descriptor?.set);
        Object.defineProperty(value, key, { get() { return descriptor.get.call(this); },
          set(next) { requested[key] = next; descriptor.set.call(this, next); } });
      }
      staged.push(requested); return value;
    };
    await assert.rejects(collectPageAssets(structuredClone(original), canvas, factory, () => { if (++checks === 2) throw cancelled; }), e => e === cancelled);
    assert(!operation.renderTask, 'cancelled filtered rendering releases task ownership');
    assert(staged.length > 0 && staged.every(c => !c.width && !c.height), 'cancelled filtered canvases request zero dimensions; Node canvas normalizes zero internally');
  }
  const complete = references[2], crop = references[1];
  let changed = 0, retainedInk = 0;
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const at = (y * crop.width + x) * 4, full = ((crop.y + y) * crop.canvasWidth + crop.x + x) * 4;
    for (let c = 0; c < 4; c++) assert.equal(crop.crop[at + c], complete[full + c], 'real filtered pixels equal independently generated original without target draw');
    if (Math.min(crop.crop[at], crop.crop[at + 1], crop.crop[at + 2]) < 180) retainedInk++;
    if (crop.original[full] !== complete[full] || crop.original[full + 1] !== complete[full + 1]) changed++;
  }
  assert(changed > 30 && retainedInk > 0, 'body ink is actually removed while the independent star remains');
  // Source/display group optimization must not let the explicit mode skip a
  // draw whose advance is still used by the next text operation.
  const loading = getDocument({ data: await input({ unsafe: true }), standardFontDataUrl, fontExtraProperties: true }); loads.push(loading);
  const doc = await loading.promise, page = await doc.getPage(1), snapshot = await snapshotPage(page, OPS);
  await renderPage(page, canvas, operation); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
  const raw = buildPageScene(snapshot), target = raw.sources.find(s => s.text === ', Middle Other Third');
  const unsafeScene = { ...scene, sources: raw.sources, items: [{ ...scene.items[0], rect: target.rect,
    backgroundPaintIndexes: [target.order], relativeTextPaintIndexes: [target.order] }] };
  await assert.rejects(collectPageAssets(unsafeScene, canvas, createCanvas), /pdf-to-word:image/);
} finally { for (const loading of loads) await loading.destroy(); }
console.log('Relative text render: actual optimized PDF.js draws, independently generated deletion pixels, preserved star/cursor, default refusal, malformed proof and cancelled-task/canvas cleanup passed.');
