import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildOcrTtf } from '../src/features/pdf-to-word/core/ocr-font-ttf.js';
import { documentFontAssetId, validOcrFontProvenance } from '../src/features/pdf-to-word/core/document-font.js';
import { validateDocumentFontAsset, validateSourceFontAsset, createSourceFontScope, sourceFontOptions } from '../src/features/pdf-to-word/adapters/source-font-runtime.js';
import { textFragments, replaceStyledText } from '../src/features/pdf-to-word/core/rich-text-edit.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const name = 'TKInk' + '1'.repeat(24);
const glyphs = ['不', '一'].map((text, i) => ({ text, advance: 1024,
  contours: [[[0, 100], [800, 100], [800, i ? 180 : 800], [0, i ? 180 : 800]]] }));
const font = buildOcrTtf(glyphs, name);
const asset = { ...font, id: documentFontAssetId(name), kind: 'font', format: 'ttf', fingerprint: sha(font.bytes),
  ocrProvenance: { version: 1, page: 2, width: 1000, height: 1600, pixelFingerprint: '2'.repeat(64),
    glyphs: glyphs.map((glyph, i) => ({ text: glyph.text, sourceId: 'p2:ocr0', box: [i * 40, 10, 32, 40], confidence: .999, points: 4 })) } };
assert(validOcrFontProvenance(asset)); await validateDocumentFontAsset(asset);
await assert.rejects(validateSourceFontAsset(asset), /structure/, 'OCR contours cannot authorize original font embedding');
for (const change of [value => { value.origin = 'original-pdf-font-program'; }, value => { delete value.ocrProvenance; },
  value => { value.fsType = 8; }, value => { value.weight = 700; }, value => { value.italic = true; },
  value => { value.ocrProvenance.glyphs[0].confidence = .98; }, value => { value.ocrProvenance.glyphs[0].box[0] = -1; },
  value => { value.ocrProvenance.glyphs[1].text = value.ocrProvenance.glyphs[0].text; },
  value => { value.ocrProvenance.glyphs[0].points = 5; }, value => { value.ocrProvenance.pixelFingerprint = '<invalid>'; },
  value => { value.name = 'TKInk' + '3'.repeat(24); value.id = documentFontAssetId(value.name); },
  value => { value.glyphs = '中不'; value.ocrProvenance.glyphs[1].text = '中'; },
  value => { value.bytes[value.bytes.length - 1] ^= 1; value.fingerprint = sha(value.bytes); }]) {
  const modified = structuredClone(asset); change(modified);
  await assert.rejects(validateDocumentFontAsset(modified), /structure/);
}
const document = { pages: [{ header: [], footer: [], blocks: [{ lines: [{ items: [
  { type: 'text', text: '一不', font: name, fontAssetId: asset.id, size: 13.5 } ] }] }] }] };
assert.equal((await sourceFontOptions(document, [asset])).length, 1);
await assert.rejects(sourceFontOptions(document, []), /structure/);
const set = new Set(), scope = createSourceFontScope({ fontSet: set, makeFace: (name, data, options) => ({ name, data, options, async load() { return this; } }) });
await scope.ensure([asset]); await scope.ensure([asset]); assert.equal(set.size, 1);
const original = { font: name, fontAssetId: asset.id, size: 13.5, baseline: 40, glyphScale: 100, bold: false };
assert.equal(scope.insertedStyle('一', original), original);
assert.equal(scope.insertedStyle(' \u00a0', original), original);
const inserted = scope.insertedStyle('年', original);
assert.equal(inserted.font, 'Microsoft YaHei'); assert.equal(inserted.fontAssetId, undefined);
assert.equal(inserted.size, 13.5); assert.equal(inserted.baseline, 40); assert.equal(original.fontAssetId, asset.id);
for (const [hint, text, expected] of [['FangSong', '年', 'FangSong'], ['仿宋', '3', 'FangSong'],
  ['SimSun', '123', 'SimSun'], ['Calibri', 'A', 'Calibri'], ['Calibri', '年', 'Microsoft YaHei'],
  ['Wingdings', 'A', 'Arial'], ['unrecognized-custom-face', 'A', 'Arial'], ['<bad>', '年', 'Microsoft YaHei']]) {
  const kept = scope.insertedStyle(text, { ...original, ocrFallbackFont: hint });
  assert.equal(kept.font, expected); assert.equal(kept.fontAssetId, undefined);
  assert.equal(kept.size, original.size); assert.equal(kept.baseline, original.baseline);
}
assert.equal(scope.insertedStyle('一', { ...original, ocrFallbackFont: 'FangSong' }).font, name,
  'known source glyphs do not switch to the local insertion hint');
const child = { ...original, text: '一', fontFamily: name }, parent = { type: 'text', text: '一', font: 'Arial', size: 30, words: [child] };
const lines = [{ items: [parent] }], target = { lines, items: [parent] };
assert.equal(textFragments(lines).fragments[0].item.fontAssetId, asset.id, 'singleton source styles come from the actual calibrated child');
const tokens = replaceStyledText(target, '一年');
assert.equal(tokens[0].item.fontAssetId, asset.id); assert.equal(tokens[0].item.size, 13.5);
assert.equal(scope.insertedStyle(tokens[1].text, tokens[1].item).size, 13.5, 'inserted character inherits the child size, not the nominal parent');
scope.dispose(); scope.dispose(); assert.equal(set.size, 0);
await assert.rejects(scope.ensure([asset]), /cancelled/);
console.log('Generated OCR fonts: distinct provenance/permissions, exact program/name/cmap/point binding, inserted-only fallback, reuse and release passed.');
