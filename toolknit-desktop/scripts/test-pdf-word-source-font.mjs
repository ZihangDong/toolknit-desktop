import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildSourceTtf, inspectSourceTtf, isSourceFontName, SOURCE_FONT_LIMITS, sourceFontAssetId, sourceFontCandidateName, sourceFontUnicodeMap } from '../src/features/pdf-to-word/core/source-font.js';
import { collectSourceFontAssets, readSourceFontStream, createSourceFontRegistry } from '../src/features/pdf-to-word/adapters/source-fonts.js';
import { createSourceFontScope, sourceFontOptions } from '../src/features/pdf-to-word/adapters/source-font-runtime.js';
import { buildOcrTtf } from '../src/features/pdf-to-word/core/ocr-font-ttf.js';

// Existing freely distributed application font: tests introduce no user font or
// binary fixture. Source permissions and outlines are independently inspected.
const bytes = new Uint8Array(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'));
const source = fontkit.create(bytes), mapping = new Map([...new Set([...'中文字体AB123'])].map(c => [c.codePointAt(0), source.glyphForCodePoint(c.codePointAt(0)).id]));
const original = bytes.slice(), name = 'TKPdf' + 'a'.repeat(24), info = inspectSourceTtf(bytes);
assert(info); assert.equal(info.glyphCount, source.numGlyphs);
const result = buildSourceTtf(bytes, mapping, name); assert(result); assert.deepEqual(bytes, original);
assert.equal(result.fsType, info.fsType); assert.equal(result.units, source.unitsPerEm);
const output = fontkit.create(result.bytes); assert.equal(output.familyName, name); assert.equal(output.postscriptName, name);
for (const [point, id] of mapping) {
  const before = source.getGlyph(id), after = output.glyphForCodePoint(point);
  assert.equal(after.id, id); assert.equal(after.advanceWidth, before.advanceWidth); assert.deepEqual(after.path.commands, before.path.commands);
}
const tableOffset = (data, tag) => {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < v.getUint16(4); i++) if (String.fromCharCode(...data.subarray(12 + i * 16, 16 + i * 16)) === tag) return v.getUint32(20 + i * 16);
  throw Error('Missing test table');
};
const os2 = tableOffset(bytes, 'OS/2');
for (const flags of [0, 8, 12]) {
  const sample = bytes.slice(); new DataView(sample.buffer).setUint16(os2 + 8, flags);
  const built = buildSourceTtf(sample, mapping, name); assert(built); assert.equal(inspectSourceTtf(built.bytes).fsType, flags);
}
for (const flags of [2, 4, 6, 10, 0x100, 0x108, 0x200, 0x208, 0x8000]) {
  const sample = bytes.slice(); new DataView(sample.buffer).setUint16(os2 + 8, flags);
  assert.equal(inspectSourceTtf(sample), null, 'restricted/preview-only/no-subsetting/bitmap/unknown permission cannot become editable embedding');
  assert.equal(buildSourceTtf(sample, mapping, name), null);
}
for (const value of [null, new Uint8Array(11), new Uint8Array(SOURCE_FONT_LIMITS.bytes + 1)]) assert.equal(inspectSourceTtf(value), null);
for (const point of [0, 0x7f, 0x9f, 0xd800, 0xffff, 0x10000]) assert.equal(buildSourceTtf(bytes, new Map([[point, 1]]), name), null);
for (const id of [0, -1, source.numGlyphs, NaN]) assert.equal(buildSourceTtf(bytes, new Map([[65, id]]), name), null);
for (const alias of ['Arial', '../font', 'TKPdf' + 'g'.repeat(24), 'TKPdf' + 'a'.repeat(32), name + '<']) assert.equal(buildSourceTtf(bytes, mapping, alias), null);
const oversized = new Map(Array.from({ length: SOURCE_FONT_LIMITS.glyphs + 1 }, (_, i) => [0x100 + i, 1]));
assert.equal(buildSourceTtf(bytes, oversized, name), null);
for (const corrupt of [data => new DataView(data.buffer).setUint32(20, 0), data => new DataView(data.buffer).setUint32(24, 0xffffffff),
  data => new DataView(data.buffer).setUint16(4, 65535), data => data.set(data.subarray(12, 16), 28)]) {
  const sample = bytes.slice(); corrupt(sample); assert.equal(inspectSourceTtf(sample), null);
}
let sum = 0; const word = new DataView(result.bytes.buffer);
for (let i = 0; i < result.bytes.length; i += 4) sum = (sum + word.getUint32(i)) >>> 0;
assert.equal(sum, 0xb1b0afba, 'whole sfnt checksum is regenerated after metadata reconstruction');
assert(isSourceFontName(name)); assert.equal(sourceFontAssetId(name), 'font:' + name); assert.equal(sourceFontAssetId('SimSun'), null);
assert.deepEqual(output['OS/2'].fsType, source['OS/2'].fsType);
const cmap = contents => new TextEncoder().encode('begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ' + contents + ' endcmap');
assert.deepEqual(sourceFontUnicodeMap(cmap('2 beginbfchar <0010><0041> <0020><4E2D> endbfchar')), new Map([[65,16],[0x4e2d,32]]));
assert.deepEqual(sourceFontUnicodeMap(cmap('1 beginbfrange <0010><0012><0041> endbfrange')), new Map([[65,16],[66,17],[67,18]]));
assert.deepEqual(sourceFontUnicodeMap(cmap('1 beginbfrange <0010><0012>[<4E2D><6587><4EBA>] endbfrange')), new Map([[0x4e2d,16],[0x6587,17],[0x4eba,18]]));
for (const content of ['1 beginbfchar <0010><00410042> endbfchar', '2 beginbfchar <0010><0041> endbfchar',
  '1 beginbfrange <0012><0010><0041> endbfrange', '1 beginbfrange <0001><FFFF><0041> endbfrange',
  '1 beginbfrange <0010><0012>[<0041>] endbfrange', '2 beginbfchar <0010><0041> <0011><0041> endbfchar',
  '2 beginbfchar <0010><0041> <0010><0042> endbfchar', '1 beginbfchar <0010><D800> endbfchar',
  '/AnotherMap usecmap 1 beginbfchar <0010><0041> endbfchar', '1 beginbfchar <0010><0041> exec endbfchar']) assert.equal(sourceFontUnicodeMap(cmap(content)), null);
assert.equal(sourceFontUnicodeMap(new Uint8Array(256 * 1024 + 1)), null);
assert(sourceFontCandidateName('ABCDEF+CustomDisplay')); assert(!sourceFontCandidateName('ABCDEF+CMMI10'));
assert(!sourceFontCandidateName('XITSMath-Regular')); assert(!sourceFontCandidateName('Invalid<font>'));

const asset = { id: sourceFontAssetId(name), kind: 'font', format: 'ttf', name, bytes: result.bytes,
  fsType: result.fsType, weight: result.weight, bold: result.bold, italic: result.italic, glyphs: [...mapping.keys()].map(point => String.fromCodePoint(point)).join(''),
  fingerprint: createHash('sha256').update(result.bytes).digest('hex') };
const document = { pages: [{ header: [], footer: [], blocks: [{ type: 'paragraph', lines: [{ items: [
  { type: 'text', text: '中A', font: name, fontAssetId: asset.id, size: 30 } ] }] }] }] };
const options = await sourceFontOptions(document, [asset]); assert.equal(options.length, 1); assert.equal(options[0].name, name);
await assert.rejects(sourceFontOptions(document, []), /structure/);
await assert.rejects(sourceFontOptions(document, [asset, asset]), /structure/);
await assert.rejects(sourceFontOptions(document, [{ ...asset, fingerprint: '0'.repeat(64) }]), /structure/);
assert.deepEqual(await sourceFontOptions({ pages: [] }, [asset]), [], 'unused fonts are not exported');
const fontSet = new Set(), faceFactory = (name, data, options) => ({ name, data, options, async load() { return this; } });
const scope = createSourceFontScope({ fontSet, makeFace: faceFactory });
await scope.ensure([asset]); await scope.ensure([asset]); assert.equal(fontSet.size, 1); assert(scope.has(asset.id));
const style = { font: name, fontFamily: name, fontAssetId: asset.id, size: 30, text: '中', color: '000000', bold: false, advanceWidth: 30, fontMetrics: { ascent: 1 } };
assert.equal(scope.insertedStyle('A', style), style);
const newGlyph = scope.insertedStyle('Z', style); assert.equal(newGlyph.font, 'Arial'); assert.equal(newGlyph.fontAssetId, undefined); assert.equal(newGlyph.size, style.size); assert.equal(newGlyph.fontMetrics, undefined); assert.equal(newGlyph.advanceWidth, undefined);
assert.equal(style.fontAssetId, asset.id, 'new-glyph fallback cannot mutate the original style');
scope.dispose(); scope.dispose(); assert.equal(fontSet.size, 0);
await assert.rejects(scope.ensure([asset]), /cancelled/);
let releaseLoad;
const lateFonts = new Set(), late = createSourceFontScope({ fontSet: lateFonts, makeFace: () => ({ load() { return new Promise(resolve => { releaseLoad = resolve; }); } }) });
const lateLoad = late.ensure([asset]); while (!releaseLoad) await new Promise(resolve => setTimeout(resolve, 0));
await assert.rejects(late.ensure([{ ...asset, fingerprint: '0'.repeat(64) }]), /structure/, 'pending aliases cannot silently acquire different data');
late.dispose(); releaseLoad(); await assert.rejects(lateLoad, /cancelled/); assert.equal(lateFonts.size, 0, 'late font loads do not escape a released editor');
const limited = createSourceFontScope({ fontSet: new Set(), makeFace: faceFactory });
await limited.ensure([asset]);
await assert.rejects(limited.ensure([{ ...asset, name: 'TKPdf' + 'f'.repeat(24), id: 'font:TKPdf' + 'f'.repeat(24) }]), /asset-large/, 'editor scopes enforce the total font byte budget across calls');
limited.dispose();
let finishShared, renderCancelled = false;
const sharedFaces = new Set(), sharedScope = createSourceFontScope({ fontSet: sharedFaces, makeFace: () => ({ load() { return new Promise(resolve => { finishShared = resolve; }); } }) });
const staleRender = sharedScope.ensure([asset], () => { if (renderCancelled) throw Object.assign(Error('cancelled'), { code: 'cancelled' }); });
while (!finishShared) await new Promise(resolve => setTimeout(resolve, 0));
const currentRender = sharedScope.ensure([asset]); renderCancelled = true; finishShared();
await assert.rejects(staleRender, /cancelled/); await currentRender; assert.equal(sharedFaces.size, 1, 'cancelled preview cannot poison another render sharing the document face');
sharedScope.dispose(); assert.equal(sharedFaces.size, 0);

// Independent PDF fixture with an original embeddable program and a minimal
// explicit Identity-H mapping. Do not rely on PDF.js's reset permission field.
const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); const face = await pdf.embedFont(bytes, { subset: false });
pdf.addPage([400, 200]).drawText('中文AB', { x: 30, y: 120, size: 30, font: face });
const pdfBytes = await pdf.save(), originalPdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
const fontDictionary = originalPdf.context.lookup(originalPdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).entries()[0][1], PDFDict);
const bodyMap = [...'中文AB'].map(character => `<${source.glyphForCodePoint(character.codePointAt(0)).id.toString(16).padStart(4, '0')}> <${character.codePointAt(0).toString(16).padStart(4, '0')}>`).join('\n');
fontDictionary.set(PDFName.of('ToUnicode'), originalPdf.context.register(originalPdf.context.flateStream(cmap('4 beginbfchar\n' + bodyMap + '\nendbfchar'))));
const fixture = await originalPdf.save(), collected = await collectSourceFontAssets(fixture, [1]);
assert.equal(collected.length, 1); assert.equal(collected[0].fsType, info.fsType); assert(collected[0].glyphs.includes('中'));
assert.deepEqual(await collectSourceFontAssets(fixture, [2]), []);
assert.deepEqual(await collectSourceFontAssets(new Uint8Array([1, 2, 3]), [1]), []);
const bomb = originalPdf.context.flateStream(new Uint8Array(20000));
assert.equal(await readSourceFontStream(bomb, originalPdf.context, 4096), null, 'compressed output is bounded independently from source length');
let cancelledReads = 0;
await assert.rejects(readSourceFontStream(bomb, originalPdf.context, 30000, () => { if (++cancelledReads > 1) throw Object.assign(Error('cancelled'), { code: 'cancelled' }); }), /cancelled/);
const unsupported = PDFRawStream.of(originalPdf.context.obj({ Filter: 'ASCII85Decode' }), Uint8Array.from([1, 2]));
assert.equal(await readSourceFontStream(unsupported, originalPdf.context, 30000), null);
const registryFonts = new Set(), registry = createSourceFontRegistry({ fontSet: registryFonts, makeFace: faceFactory });
await registry.prepare(fixture, [1]); assert.equal(registryFonts.size, 1);
assert.equal(registry.capacity().fonts, SOURCE_FONT_LIMITS.fonts - 1);
assert.equal(registry.capacity().bytes, SOURCE_FONT_LIMITS.totalBytes - collected[0].bytes.length, 'all loaded fonts reserve capacity before a visible run uses them');
await registry.prepare(fixture, [1]); assert.equal(registryFonts.size, 1, 'one registry loads the original programs only once');
const item = { id: 'p1:t1', type: 'text', sourceIds: ['p1:t1'], text: '中文AB', font: collected[0].originalName, size: 30, preciseInk: true, bold: false, italic: false };
const scene = { items: [item], sources: [{ id: item.id, text: item.text, disposition: 'editable' }] }, frozenSources = structuredClone(scene.sources);
registry.apply(scene); assert(item.fontAssetId); assert.equal(item.font, collected[0].name); assert.equal(item.size, 30); assert.deepEqual(scene.sources, frozenSources); assert.equal(registry.assets().length, 1);
registry.dispose(); assert.equal(registryFonts.size, 0);
const failedFonts = new Set(), failedRegistry = createSourceFontRegistry({ fontSet: failedFonts, makeFace: () => ({ async load() { throw Error('unsupported'); } }) });
await failedRegistry.prepare(fixture, [1]); const fallbackItem = { ...item, font: collected[0].originalName, fontAssetId: undefined };
failedRegistry.apply({ items: [fallbackItem], sources: scene.sources }); assert.equal(fallbackItem.font, collected[0].originalName); assert.equal(failedRegistry.assets().length, 0);
failedRegistry.dispose(); assert.equal(failedFonts.size, 0);

// Two PDF resource aliases can refer to exactly the same original program and
// Unicode mapping. They must retain both lookup names but own one loaded face.
const aliasInput = await PDFDocument.create(); aliasInput.registerFontkit(fontkit);
// Tiny instruction-free test outlines keep the two distinct programs below
// the unchanged aggregate byte cap; their ink is not an OCR accuracy fixture.
const aliasProgram = buildOcrTtf(['A', 'B'].map((text, index) => ({ text, advance: 1024,
  contours: [[[0, 100], [700 + index * 30, 100], [700 + index * 30, 800], [0, 800]]] })), 'TKInk' + '9'.repeat(24));
assert(inspectSourceTtf(aliasProgram.bytes));
const aliasFace = await aliasInput.embedFont(aliasProgram.bytes, { subset: false });
aliasInput.addPage([400, 200]).drawText('AB', { x: 30, y: 120, size: 30, font: aliasFace });
const aliasPdf = await PDFDocument.load(await aliasInput.save(), { updateMetadata: false });
const aliasResources = aliasPdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict);
const aliasOriginal = aliasPdf.context.lookup(aliasResources.entries()[0][1], PDFDict);
const aliasGlyphs = fontkit.create(aliasProgram.bytes);
aliasOriginal.set(PDFName.of('ToUnicode'), aliasPdf.context.register(aliasPdf.context.flateStream(cmap('2 beginbfchar\n'
  + ['A', 'B'].map(c => `<${aliasGlyphs.glyphForCodePoint(c.codePointAt(0)).id.toString(16).padStart(4, '0')}> <${c.codePointAt(0).toString(16).padStart(4, '0')}>`).join('\n') + '\nendbfchar'))));
const aliasDictionary = aliasOriginal.clone(aliasPdf.context);
aliasDictionary.set(PDFName.of('BaseFont'), PDFName.of('ToolKnitOriginalAlias'));
aliasResources.set(PDFName.of('ToolKnitAlias'), aliasPdf.context.register(aliasDictionary));
const aliasBytes = await aliasPdf.save(), aliasAssets = await collectSourceFontAssets(aliasBytes, [1]);
assert.equal(aliasAssets.length, 2); assert.equal(aliasAssets[0].id, aliasAssets[1].id);
let aliasLoads = 0;
const aliasFaces = new Set(), aliasRegistry = createSourceFontRegistry({ fontSet: aliasFaces,
  makeFace: (...args) => { aliasLoads++; return faceFactory(...args); } });
await aliasRegistry.prepare(aliasBytes, [1]);
assert.equal(aliasLoads, 1); assert.equal(aliasFaces.size, 1);
assert.equal(aliasRegistry.capacity().bytes, SOURCE_FONT_LIMITS.totalBytes - aliasAssets[0].bytes.length);
const aliasItems = aliasAssets.map((asset, index) => ({ ...item, text: 'AB', id: 'alias' + index, sourceIds: ['alias' + index], font: asset.originalName, fontAssetId: undefined }));
const aliasScene = { items: aliasItems, sources: aliasItems.map(i => ({ id: i.id, text: i.text, disposition: 'editable' })) };
aliasRegistry.apply(aliasScene); assert(aliasItems.every(i => i.fontAssetId === aliasAssets[0].id));
assert.equal(aliasRegistry.assets().length, 1); aliasRegistry.dispose(); assert.equal(aliasFaces.size, 0, 'no overwritten alias face leaks from its owner');

// A different Unicode map needs its own program and cannot consume the OCR
// owner's last reserved face/bytes. Loading remains data-only until commit.
aliasDictionary.set(PDFName.of('ToUnicode'), aliasPdf.context.register(aliasPdf.context.flateStream(cmap('1 beginbfchar\n'
  + `<${fontkit.create(aliasAssets[0].bytes).glyphForCodePoint(65).id.toString(16).padStart(4, '0')}> <0041>\nendbfchar`))));
const distinctBytes = await aliasPdf.save(), distinctAssets = await collectSourceFontAssets(distinctBytes, [1]);
assert.equal(distinctAssets.length, 2); assert.notEqual(distinctAssets[0].id, distinctAssets[1].id);
const limitedFaces = new Set(), limitedRegistry = createSourceFontRegistry({ fontSet: limitedFaces, makeFace: faceFactory,
  available: () => ({ fonts: 1, bytes: SOURCE_FONT_LIMITS.totalBytes }) });
await limitedRegistry.prepare(distinctBytes, [1]); assert.equal(limitedFaces.size, 1);
limitedRegistry.dispose(); assert.equal(limitedFaces.size, 0);
for (const mode of ['bytes', 'invalid', 'throws', 'late-fonts', 'late-bytes']) {
  const faces = new Set(); let capacity = { fonts: 1, bytes: mode === 'bytes' ? collected[0].bytes.length - 1 : SOURCE_FONT_LIMITS.totalBytes }, loads = 0;
  const owner = createSourceFontRegistry({ fontSet: faces, available: () => {
    if (mode === 'invalid') return { fonts: NaN, bytes: 0 };
    if (mode === 'throws') throw Error('unavailable');
    return capacity;
  }, makeFace: (...args) => {
    loads++; const face = faceFactory(...args), load = face.load.bind(face);
    face.load = async () => { await load(); if (mode === 'late-fonts') capacity = { fonts: 0, bytes: SOURCE_FONT_LIMITS.totalBytes };
      if (mode === 'late-bytes') capacity = { fonts: 1, bytes: 0 }; return face; }; return face;
  } });
  await owner.prepare(fixture, [1]);
  assert.equal(faces.size, 0, mode + ': no over-budget face is installed');
  assert.equal(owner.capacity().fonts, SOURCE_FONT_LIMITS.fonts); assert.equal(owner.assets().length, 0);
  assert.equal(loads, mode.startsWith('late-') ? 1 : 0); owner.dispose();
}
console.log('Source TTF: original permissions, unchanged outlines/metrics, Unicode/alias reconstruction, bounded tables and checksums passed.');
