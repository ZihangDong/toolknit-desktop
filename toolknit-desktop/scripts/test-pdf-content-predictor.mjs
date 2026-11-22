import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { decodeContentPrediction } from '../src/features/pdf-object-remove/content-predictor.js';
import { decodeRemovalStream } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { encodeFixtureAscii85, encodeFixtureLzw, encodeFixturePrediction } from './lib/pdf-object-fixtures.mjs';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const qa = await pdfRemovalRenderQa('tmp/pdf-content-predictor');
const { context } = await PDFDocument.create(), N = PDFName.of;
const baseline = { columns: 16, colors: 1, bits: 8 };
const body = 'BT /F0 14 Tf 20 170 Td (Predictor retained body) Tj ET\n';
const mark = 'BT /F0 22 Tf 24 84 Td (PREDICTED CONTENT MARK) Tj ET\n';
function pad(content, { columns, colors, bits } = baseline) {
  const rowBytes = Math.ceil(columns * colors * bits / 8);
  const input = Buffer.from(content), output = Buffer.alloc(Math.ceil(input.length / rowBytes) * rowBytes, 32);
  input.copy(output);
  return output;
}
function residuals(bytes, predictor, { columns, colors, bits } = baseline) {
  return encodeFixturePrediction(bytes, { predictor, columns, colors, bits,
    rowBytes: Math.ceil(columns * colors * bits / 8), pixelBytes: Math.ceil(colors * bits / 8) });
}
function stream(ctx, bytes, { predictor = 15, filter = 'FlateDecode', earlyChange = 1, wrapper,
  geometry = baseline, params = {}, entries = {}, encodedRows = residuals(bytes, predictor, geometry) } = {}) {
  const { columns, colors, bits } = geometry;
  const settings = { Predictor: predictor, Columns: columns, ...params };
  if (geometry !== baseline) Object.assign(settings, { Colors: colors, BitsPerComponent: bits }, params);
  let packed = deflateSync(encodedRows);
  if (filter === 'LZWDecode') {
    packed = encodeFixtureLzw(encodedRows, earlyChange);
    settings.EarlyChange = earlyChange;
  }
  if (wrapper === 'ASCIIHexDecode') packed = Buffer.from(packed.toString('hex') + '>');
  if (wrapper === 'ASCII85Decode') packed = encodeFixtureAscii85(packed);
  return PDFRawStream.of(ctx.obj({ ...entries, Filter: wrapper ? [N(wrapper), N(filter)] : N(filter),
    DecodeParms: wrapper ? [null, settings] : settings }), packed);
}

assert.deepEqual([...decodeContentPrediction(Uint8Array.from([255, 2, 30, 1]), { predictor: 2, rowBytes: 2, colors: 1, bits: 8 }, 4)], [255, 1, 30, 31]);
assert.deepEqual([...decodeContentPrediction(Uint8Array.from([0, 10, 20, 2, 5, 6, 4, 1, 1]), { predictor: 15, rowBytes: 2, colors: 1, bits: 8 }, 6)], [10, 20, 15, 26, 16, 27]);
const filters = [{ filter: 'FlateDecode' }, { filter: 'LZWDecode', earlyChange: 0 }, { filter: 'LZWDecode', earlyChange: 1 }];
const profiles = [2, 10, 11, 12, 13, 14, 15].flatMap(predictor => filters.flatMap(filter =>
  [undefined, 'ASCIIHexDecode', 'ASCII85Decode'].map(wrapper => ({ predictor, ...filter, wrapper }))));
const plain = pad(body + mark);
for (const profile of profiles) {
  const actual = await decodeRemovalStream(stream(context, plain, profile), { bytes: 0 });
  assert.deepEqual(Buffer.from(actual), plain, JSON.stringify(profile));
}
let geometryProfiles = 0;
for (const colors of [1, 2, 3, 4]) {
  for (const bits of [1, 2, 4, 8, 16]) {
    for (const profile of profiles) {
      const { predictor } = profile;
      if (predictor === 2 && bits === 16) continue;
      // TIFF profiles span several pixels with complete bytes. PNG also exercises partial final bytes.
      const columns = predictor === 2 ? 8 : 5;
      const geometry = { columns, bits, colors };
      const rowBytes = Math.ceil(columns * colors * bits / 8);
      const data = Buffer.from(Array.from({ length: 7 * rowBytes }, (_, i) => (i * 113 + (i >>> 2) * 29 + 231) & 255));
      const actual = await decodeRemovalStream(stream(context, data, { ...profile, geometry }), { bytes: 0 });
      assert.deepEqual(Buffer.from(actual), data, JSON.stringify({ ...profile, geometry }));
      geometryProfiles++;
    }
  }
}
for (const params of [{ Colors: 5 }, { Colors: 0 }, { BitsPerComponent: 3 }, { BPC: 8 }, { Columns: 0 }, { Columns: 1.5 },
  { Columns: REMOVE_LIMITS.streamBytes }, { Columns: REMOVE_LIMITS.streamBytes * 8 + 1, BitsPerComponent: 1 },
  { Columns: REMOVE_LIMITS.streamBytes, Colors: 4, BitsPerComponent: 16 },
  { Predictor: 2, BitsPerComponent: 16 }, { Predictor: 2, BitsPerComponent: 4, Colors: 3, Columns: 3 },
  { Predictor: null }, { Predictor: 16 }, { Unknown: 1 }]) {
  await assert.rejects(() => decodeRemovalStream(stream(context, plain, { params }), { bytes: 0 }), /pdf-remove:filter/);
}
const arrayFilter = stream(context, plain);
arrayFilter.dict.set(N('Filter'), context.obj([N('FlateDecode')]));
await assert.rejects(() => decodeRemovalStream(arrayFilter, { bytes: 0 }), /pdf-remove:filter/);
arrayFilter.dict.set(N('DecodeParms'), context.obj([{ Predictor: 15, Columns: baseline.columns }]));
assert.deepEqual(Buffer.from(await decodeRemovalStream(arrayFilter, { bytes: 0 })), plain);

const rows = residuals(plain, 15), badTag = Buffer.from(rows);
badTag[baseline.columns + 1] = 5;
for (const encodedRows of [Buffer.alloc(0), rows.subarray(0, -1), badTag]) {
  await assert.rejects(() => decodeRemovalStream(stream(context, plain, { encodedRows }), { bytes: 0 }), /pdf-remove:stream/);
}
const wrapped = stream(context, plain, { filter: 'LZWDecode', earlyChange: 0, wrapper: 'ASCIIHexDecode' });
const cost = encodeFixtureLzw(rows, 0).length + rows.length + plain.length;
const budget = { bytes: REMOVE_LIMITS.decodedBytes - cost };
await decodeRemovalStream(wrapped, budget);
assert.equal(budget.bytes, REMOVE_LIMITS.decodedBytes);
await assert.rejects(() => decodeRemovalStream(wrapped, { bytes: REMOVE_LIMITS.decodedBytes - cost + 1 }), /pdf-remove:decoded/);
await assert.rejects(() => decodeRemovalStream(stream(context, plain, { predictor: 2,
  geometry: { columns: 8, colors: 3, bits: 2 }, encodedRows: Buffer.alloc(7) }), { bytes: 0 }), /pdf-remove:stream/);

const pageProfiles = [
  { predictor: 2, geometry: { columns: 16, colors: 3, bits: 1 } },
  { predictor: 12, wrapper: 'ASCIIHexDecode', geometry: { columns: 7, colors: 3, bits: 2 } },
  { predictor: 14, filter: 'LZWDecode', earlyChange: 0, geometry: { columns: 5, colors: 3, bits: 4 } },
  { predictor: 15, filter: 'LZWDecode', wrapper: 'ASCII85Decode', geometry: { columns: 3, colors: 4, bits: 16 } },
  { predictor: 2, filter: 'LZWDecode', wrapper: 'ASCIIHexDecode', geometry: { columns: 8, colors: 3, bits: 2 } },
  { predictor: 2, geometry: { columns: 5, colors: 4, bits: 8 } },
  { predictor: 11, geometry: { columns: 13, colors: 2, bits: 1 } },
];
const formProfile = { predictor: 2, filter: 'LZWDecode', earlyChange: 0, wrapper: 'ASCII85Decode',
  geometry: { columns: 6, colors: 3, bits: 4 } };

async function fixture(mode, marked, invalidPage = false) {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, profile] of pageProfiles.entries()) {
    const page = doc.addPage([350, 220]);
    const resources = ctx.obj({ Font: { F0: font.ref } });
    page.node.set(N('Resources'), resources);
    let bytes = pad(body + (marked ? mark : ''), profile.geometry);
    if (index === 6) {
      const entries = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 350, 220], Resources: { Font: { F0: font.ref } } };
      const formBytes = pad('BT /F0 10 Tf 20 20 Td (Form retained body) Tj ET\n' + (marked ? mark : ''), formProfile.geometry);
      const form = mode === 'plain' ? ctx.flateStream(formBytes, entries) : stream(ctx, formBytes, { ...formProfile, entries });
      resources.set(N('XObject'), ctx.obj({ Paint: ctx.register(form) }));
      bytes = pad(body + 'q /Paint Do Q\n', profile.geometry);
    }
    const contents = invalidPage && index === 0 ? stream(ctx, bytes, { encodedRows: badTag })
      : mode === 'plain' ? ctx.flateStream(bytes) : stream(ctx, bytes, profile);
    page.node.set(N('Contents'), ctx.register(contents));
  }
  return doc.save();
}

const original = await fixture('encoded', true), analysis = await analyzeRemovalPdf(original);
const targets = analysis.candidates.filter(item => item.label === 'PREDICTED CONTENT MARK');
assert.equal(targets.length, 7);
assert.ok(targets.at(-1).formDepth);
assert.equal(exactRemovalMatches(analysis.candidates, targets[0], removalPages('', 7)).length, 6);
const output = await buildRemovalPdf(analysis, targets.map(item => item.id));
const reopened = await analyzeRemovalPdf(output);
assert.ok(reopened.summary.pages.every(page => !page.reason));
assert.ok(!reopened.candidates.some(item => item.label === 'PREDICTED CONTENT MARK'));
assert.equal(reopened.candidates.filter(item => item.label === 'Predictor retained body').length, 7);
assert.ok(reopened.candidates.some(item => item.label === 'Form retained body'));
const source = await qa.save('source', original), edited = await qa.save('edited', output);
await qa.verify(edited);
await qa.compare(source, await qa.save('source-reference', await fixture('plain', true)), 7, { allPdfjsPages: true });
await qa.compare(edited, await qa.save('clean-reference', await fixture('plain', false)), 7, { allPdfjsPages: true });

const mixedBytes = await fixture('encoded', true, true), mixed = await analyzeRemovalPdf(mixedBytes);
assert.equal(mixed.summary.pages[0].reason, 'stream');
const adjacent = mixed.candidates.find(item => item.pageIndex === 1 && item.label === 'PREDICTED CONTENT MARK');
assert.ok(adjacent);
const mixedResult = await buildRemovalPdf(mixed, [adjacent.id]);
const raw = async bytes => (await PDFDocument.load(bytes)).getPage(0).node.Contents().getContents();
assert.deepEqual(await raw(mixedBytes), await raw(mixedResult));
assert.ok(!(await analyzeRemovalPdf(mixedResult)).candidates.some(item => item.pageIndex === 1 && item.label === adjacent.label));
await qa.save('mixed', mixedBytes);

const report = { profiles: profiles.length + geometryProfiles, baselineProfiles: profiles.length, geometryProfiles,
  pageProfiles, formProfile, pages: 7, ...qa.report() };
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify(report, null, 2));
console.log(`PDF content prediction passed: ${report.profiles} byte profiles, ${report.pixelChecks} Poppler pages, ${report.pdfjsComparisons} PDF.js comparisons.`);
