import assert from 'node:assert/strict';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareNativeFallback, refineNativeDisplayInk } from '../src/features/pdf-to-word/adapters/native-fallback-typography.js';
import { ocrFrameLayout } from '../src/features/pdf-to-word/core/ocr-frame-layout.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { renderResultPage } from '../src/features/pdf-to-word/result-preview.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';

const font = 'FZH4FW--GB1-0', fonts = { known: { name: font, missingFile: true } };
const fixture = () => {
  const text = 'SCHEME', rect = { x: 20, y: 30, width: 350, height: 110 };
  const item = { id: 'display', sourceIds: ['display'], type: 'text', font, text, rect, size: 74,
    baseline: 130, raster: false, color: '000000', glyphPositions: [...text].map((text, i) => ({
      text, rect: { x: 20 + i * 55, y: 35, width: 49, height: 82 },
    })) };
  return { number: 1, width: 420, height: 300, items: [item], rules: [], risks: ['unmapped-glyph'], characters: 6,
    sources: [{ id: item.id, text, rect, disposition: 'editable', order: 0 }] };
};
const context = createCanvas(1, 1).getContext('2d');
context.font = '1000px "SimHei"';
const available = Math.abs(context.measureText('S').width - 500) <= 1;
{
  const scene = fixture(), ledger = structuredClone(scene.sources), source = structuredClone(scene.items[0]);
  const originalFont = context.font, originalKerning = context.fontKerning;
  prepareNativeFallback(scene, fonts, context);
  assert.equal(context.font, originalFont); assert.equal(context.fontKerning, originalKerning);
  assert.deepEqual(scene.sources, ledger);
  if (available) {
    const item = scene.items[0];
    assert.equal(item.text, source.text); assert.equal(item.sourceFont, source.font);
    assert.equal(item.sourceSize, source.size); assert.equal(item.baseline, source.baseline);
    assert.deepEqual(item.rect, source.rect); assert.equal(item.words.length, 6);
    assert(item.words.every(word => word.font === 'SimHei' && word.bold && word.size === source.size));
    assert(item.words.every((word, i) => word.advanceWidth === source.glyphPositions[i].rect.width));
    assert(item.words.every((word, i) => word.baselineX > source.glyphPositions[i].rect.x),
      'a half-em substitute is centered inside the wider declared PDF character advances');
    const once = structuredClone(scene); prepareNativeFallback(scene, fonts, context); assert.deepEqual(scene, once);
    const packed = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), [],
      { preserveGeometry: true, measurementContext: context });
    const xml = await (await JSZip.loadAsync(packed.bytes)).file('word/document.xml').async('string');
    assert.match(xml, /<w:b\/>/); assert.match(xml, /<w:sz w:val="148"/);
    assert.equal([...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').replace(/\s/g, ''), source.text);
    assert(!xml.includes('<w:embedRegular'), 'the installed system substitute is not copied into the Word package');
  } else assert.deepEqual(scene.items[0], source, 'an unavailable substitute retains the existing fitter');
}
for (const mutate of [
  s => { s.items[0].ocr = true; }, s => { s.items[0].raster = true; },
  s => { s.items[0].alphabet = 'symbols'; }, s => { s.items[0].italic = true; },
  s => { s.items[0].size = 12; }, s => { s.items[0].fontAssetId = 'already-embedded'; },
  s => { s.items[0].sourceIds = ['other']; }, s => { s.items[0].font = 'UnknownFace'; },
  s => { s.items[0].text = 'x=1'; }, s => { s.items[0].glyphPositions[0].text = 'AB'; },
  s => { s.items[0].glyphPositions[0].rect.width = Infinity; },
  s => { s.items[0] = { type: 'table', cells: [{ blocks: s.items }] }; },
]) {
  const scene = fixture(); mutate(scene); const frozen = structuredClone(scene);
  prepareNativeFallback(scene, fonts, context); assert.deepEqual(scene, frozen);
}
for (const metadata of [{ name: font, missingFile: false }, { name: font, missingFile: true, data: new Uint8Array(4) },
  { name: font, missingFile: true, vertical: true }, { name: font, missingFile: true, type3: true }]) {
  const scene = fixture(), frozen = structuredClone(scene);
  prepareNativeFallback(scene, { known: metadata }, context); assert.deepEqual(scene, frozen);
  const ambiguous = fixture(), frozenAmbiguous = structuredClone(ambiguous);
  prepareNativeFallback(ambiguous, { ...fonts, conflicting: metadata }, context);
  assert.deepEqual(ambiguous, frozenAmbiguous, 'a same-name embedded or unsupported font resource cannot inherit missing-font provenance');
}
{
  const scene = fixture(), frozen = structuredClone(scene);
  prepareNativeFallback(scene, fonts, { font: '', measureText: () => ({ width: 667 }) });
  assert.deepEqual(scene, frozen);
  prepareNativeFallback(scene, fonts, { font: '', measureText: () => ({ width: 500 }) });
  assert.deepEqual(scene, frozen, 'missing actual ink metrics are not a known installed-face signature');
}
// A decorative rule cannot disable independent glyph origins. Real pictures,
// retained text/formulas and unknown image ownership keep the old line path.
{
  const text = fixture().items[0];
  Object.assign(text, { nativeCalibrated: true, nativeAdvanceCentered: true, preciseInk: true,
    words: text.glyphPositions.map(g => ({ text: g.text, rect: g.rect, size: 74, baseline: 130 })) });
  const decoration = { id: 'rule', type: 'image', role: 'figure', text: '', decoration: true, sourceIds: [],
    rect: { x: 20, y: 141, width: 350, height: 2 }, assetId: 'rule' };
  const page = { header: [], footer: [], blocks: [{ type: 'paragraph', lines: [
    { id: 'line', baseline: 130, items: [text, decoration] },
  ] }] };
  const frozen = structuredClone(page), frames = ocrFrameLayout(page).get('line');
  assert.equal(frames.length, 6); assert(frames.every(frame => frame.items.length === 1));
  assert.equal(frames.map(frame => frame.items[0].text).join(''), 'SCHEME');
  assert(frames.every(frame => frame.mixedNativeDecoration)); assert.deepEqual(page, frozen);
  const ordinary = structuredClone(page); delete ordinary.blocks[0].lines[0].items[0].nativeAdvanceCentered;
  assert(!ocrFrameLayout(ordinary).has('line'), 'ordinary mixed native/OCR lines keep their existing reader contract');
  for (const mutate of [i => { i.decoration = false; }, i => { i.sourceIds = ['retained-text']; },
    i => { i.role = 'formula'; }, i => { i.text = 'x'; }, i => { i.mathGlyphs = [{}]; }]) {
    const copy = structuredClone(page); mutate(copy.blocks[0].lines[0].items[1]);
    assert(!ocrFrameLayout(copy).has('line'));
  }
  if (available) {
    const scene = fixture(); scene.width = 840; prepareNativeFallback(scene, fonts, context);
    scene.items.push({ ...decoration, inlineGraphic: true, inline: true, baseline: 130, size: 74, order: 1 });
    const rule = createCanvas(350, 2), pen = rule.getContext('2d'); pen.fillRect(0, 0, 350, 2);
    const bytes = rule.toBuffer('image/png'), document = inferDocument([scene], { preserveGeometry: true });
    const output = await createWordBytes(document, [{ id: 'rule', bytes, format: 'png' }],
      { preserveGeometry: true, measurementContext: context });
    const zip = await JSZip.loadAsync(output.bytes), xml = await zip.file('word/document.xml').async('string');
    assert.equal((xml.match(/<pic:pic(?=[\s>])/g) || []).length, 1, 'the decorative image survives actual serialization exactly once');
    assert.equal((xml.match(/<w:framePr /g) || []).length, 6, 'actual Word uses six independent native glyph frames');
    const media = Object.keys(zip.files).filter(name => /^word\/media\/.*\.png$/.test(name));
    assert.equal(media.length, 1); assert.deepEqual(await zip.file(media[0]).async('nodebuffer'), bytes);
    const target = resultTargets(document.pages[0]).find(target => target.type === 'text' && target.text === 'SCHEME');
    assert(target);
    const measure = (text, style) => measureResultText(text, style, context);
    measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
    const changed = applyResultEdits(document, { [target.key]: layoutEditedText(target, 'SCHEME123', measure, { page: document.pages[0] }) });
    const editedTarget = resultTargets(changed.pages[0]).find(target => target.type === 'text' && target.text.replace(/\s/g, '') === 'SCHEME123');
    assert(editedTarget);
    const editedFrames = ocrFrameLayout(changed.pages[0]).get(editedTarget.lines[0].id);
    assert.equal(editedFrames?.length, 6, 'editing a source word keeps its independent frames instead of merging them into one tracked run');
    const editedOutput = await createWordBytes(changed, [{ id: 'rule', bytes, format: 'png' }],
      { preserveGeometry: true, measurementContext: context });
    const editedXml = await (await JSZip.loadAsync(editedOutput.bytes)).file('word/document.xml').async('string');
    const frameCoordinates = value => [...value.matchAll(/<w:framePr\s+([^>]+)\/>/g)].map(match =>
      Object.fromEntries([...match[1].matchAll(/w:(x|y|h)="([^"]+)"/g)].map(m => [m[1], m[2]])));
    assert.deepEqual(frameCoordinates(editedXml).slice(0, 5), frameCoordinates(xml).slice(0, 5),
      'actual Word coordinates of the five unchanged source glyphs remain exact');
    rule.width = rule.height = 0;
  }
}
// Independent source painting verifies that the optional optical pass improves
// real pixels, preserves spelling/ownership and releases its scoring canvas.
{
  const name = 'TKInk' + 'e'.repeat(24), page = { header: [], footer: [], blocks: [{ type: 'paragraph', lines: [] }] };
  for (let row = 0; row < 6; row++) page.blocks[0].lines.push({ id: 'row' + row, baseline: 20 + row * 20,
    items: [{ type: 'text', text: 'A'.repeat(70), font: 'Arial', size: 8, ocr: true, preciseInk: true,
      words: Array.from({ length: 70 }, (_, i) => ({ text: 'A', font: i % 3 ? 'Arial' : name,
        fontAssetId: i % 3 ? undefined : 'font:' + name, size: 8, baseline: 20 + row * 20,
        rect: { x: 2 + i * 5, y: 10 + row * 20, width: 4, height: 7 } })) }] });
  const before = [...ocrFrameLayout(page).values()].flat();
  const expanded = structuredClone(page);
  for (const line of expanded.blocks[0].lines) line.items = line.items.flatMap(item =>
    item.words.map(word => ({ ...item, ...word, words: undefined, positionedWord: true })));
  const after = [...ocrFrameLayout(expanded).values()].flat();
  assert.equal(after.length, before.length, 'expanded edited words consume the same frame budget as their source words');
  assert.equal(after.length, 420); assert(after.every(frame => frame.items.length === 1));
}
{
  const name = 'TKPdf' + 'd'.repeat(24);
  GlobalFonts.registerFromPath('public/assets/fonts/Alibaba-PuHuiTi-Medium.ttf', name);
  const image = createCanvas(500, 300), ctx = image.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 500, 300); ctx.fillStyle = '#000';
  ctx.font = `100px "${name}"`; ctx.fontKerning = 'none'; ctx.fillText('山', 100, 200);
  const pixels = ctx.getImageData(0, 0, 500, 300).data;
  let l = 500, t = 300, rr = 0, bb = 0;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 500; x++) if (pixels[(y * 500 + x) * 4] < 180) {
    l = Math.min(l, x); t = Math.min(t, y); rr = Math.max(rr, x + 1); bb = Math.max(bb, y + 1);
  }
  const word = { text: '山', font: name, fontAssetId: 'font:' + name, size: 100 / 3,
    baseline: 200 / 3 + .5, baselineX: 100 / 3 + .5, advanceWidth: (rr - l) / 3, preciseInk: true,
    rect: { x: l / 3 + .5, y: t / 3 + .5, width: (rr - l) / 3, height: (bb - t) / 3 } };
  const scene = { number: 1, width: 500 / 3, height: 100, items: [{ id: 'native', type: 'text', text: '山',
    ...word, words: [word], sourceIds: ['native'], sourceFont: name, sourceSize: word.size, nativeCalibrated: true }],
    sources: [{ id: 'native', text: '山', rect: word.rect, disposition: 'editable' }], rules: [], risks: [], characters: 1 };
  const ledger = structuredClone(scene.sources), frozenPixels = pixels.slice(); let released = 0;
  const table = structuredClone(scene);
  table.items = [{ type: 'table', cells: [{ blocks: table.items }] }];
  const frozenTable = structuredClone(table);
  refineNativeDisplayInk(table, pixels, 500, 300, createCanvas);
  assert.deepEqual(table, frozenTable, 'ordinary native cells retain their existing complete-cell fitter');
  const create = (w, h) => new Proxy(createCanvas(w, h), {
    get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { if ((key === 'width' || key === 'height') && value === 0) released++; return Reflect.set(target, key, value, target); },
  });
  const errors = async () => {
    const target = createCanvas(500, 300);
    try {
      await renderResultPage(inferDocument([scene], { preserveGeometry: true }).pages[0], target, new Map());
      const actual = target.getContext('2d').getImageData(0, 0, 500, 300).data;
      let differences = 0;
      for (let i = 0; i < actual.length; i += 4) if ((actual[i] < 180) !== (pixels[i] < 180)) differences++;
      return differences;
    } finally { target.width = target.height = 0; }
  };
  const before = await errors();
  refineNativeDisplayInk(scene, pixels, 500, 300, create);
  assert(word.rect.x < l / 3 + .5 || word.rect.y < t / 3 + .5, 'a misplaced native glyph receives a source-pixel improvement');
  assert.equal(word.text, '山'); assert.deepEqual(scene.sources, ledger); assert.deepEqual(pixels, frozenPixels);
  assert(await errors() < before, 'the actual editor painter moves closer to independently drawn source pixels');
  assert.equal(released, 2);
  assert.throws(() => refineNativeDisplayInk(scene, pixels, 500, 300, create, () => { throw Error('cancelled'); }), /cancelled/);
  assert.equal(released, 4, 'cancellation also releases the owned canvas');
  image.width = image.height = 0;
}
console.log('Native display fallback: source advances, installed-face/embedding boundaries, real DOCX styles, decorative-image isolation, pixel proposals and cancellation passed.');
