import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PDFDocument, PDFName, PDFNumber, PDFString, PDFOperator, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, moveTo, lineTo, appendBezierCurve, stroke, clip, endPath, rectangle, setDashPattern, setTextRenderingMode } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { convertPrototype } from './convert-pdf-to-dwg-prototype.mjs';
import { cadPrototypePages, cadPrototypeSettings } from './lib/pdf-to-dwg-prototype.mjs';
import { applyCadFont, loadCadFont } from './lib/pdf-dwg-font.mjs';

const run = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: {
  'cad-module': { type: 'string', default: 'tmp/tk016/acad-ts-research/node_modules/@node-projects/acad-ts/dist/index.js' },
  'engine-dir': { type: 'string', default: 'tmp/tk016/libredwg-0.14.9154' },
  python: { type: 'string', default: 'tmp/tk016/python/Scripts/python.exe' }, snapshot: { type: 'string' },
} });
const reportRoot = path.resolve('tmp/tk016/prototype-qa'); await mkdir(reportRoot, { recursive: true });
const root = await mkdtemp(path.join(reportRoot, 'run-'));
const inputRoot = path.join(root, 'inputs'); await mkdir(inputRoot, { recursive: true });
const out = path.join(root, 'outputs'), cadModule = path.resolve(values['cad-module']), engineDir = path.resolve(values['engine-dir']);
const checks = [], passed = label => checks.push(label);
const base = async () => { const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); return { doc, font, page: doc.addPage([360, 240]) }; };
const draw = (page, font, text = 'Scale 1:1') => { page.drawLine({ start: { x: 72, y: 72 }, end: { x: 144, y: 72 }, thickness: 1, color: rgb(0.2, 0.4, 0.6) }); page.drawText(text, { x: 72, y: 110, size: 12, font }); };
async function save(name, modify) { const fixture = await base(); await modify(fixture); const file = path.join(inputRoot, name + '.pdf'); await writeFile(file, await fixture.doc.save()); return file; }
const sources = {};
sources.vector = await save('vector', ({ page, font }) => draw(page, font));
sources.rotated = await save('rotated', ({ page, font }) => { draw(page, font); page.setRotation(degrees(90)); });
sources.cropped = await save('cropped', ({ page, font }) => { draw(page, font); page.setCropBox(36, 24, 288, 192); });
sources.userUnit = await save('user-unit', ({ page, font }) => { draw(page, font); page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)); });
sources.affine = await save('affine', ({ page }) => { page.pushOperators(pushGraphicsState(), concatTransformationMatrix(2, 0, 0, 2, 10, 20), moveTo(10, 10), lineTo(50, 10), stroke(), popGraphicsState()); });
sources.curve = await save('curve', ({ page }) => { page.pushOperators(moveTo(72, 72), appendBezierCurve(96, 120, 120, 24, 144, 72), stroke()); });
sources.chinese = await save('chinese', async ({ doc, page }) => { doc.registerFontkit(fontkit); const font = await doc.embedFont(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'), { subset: false }); draw(page, font, 'CAD 中文图纸'); });
sources.chineseRotated = await save('chinese-rotated', async ({ doc, page }) => { doc.registerFontkit(fontkit); const font = await doc.embedFont(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'), { subset: false }); draw(page, font, 'CAD 中文图纸'); page.setRotation(degrees(90)); });
sources.chineseMixed = await save('chinese-mixed', async ({ doc, page }) => { doc.registerFontkit(fontkit); const font = await doc.embedFont(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'), { subset: false }); draw(page, font, '中文 WWW iii 123 标注'); });
sources.compressed = await save('compressed', ({ page, font }) => { page.pushOperators(pushGraphicsState(), concatTransformationMatrix(.7, 0, 0, 1, 0, 0)); draw(page, font); page.pushOperators(popGraphicsState()); });
sources.expanded = await save('expanded', ({ page, font }) => { page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1.3, 0, 0, 1, 0, 0)); draw(page, font); page.pushOperators(popGraphicsState()); });
sources.serif = await save('serif', async ({ doc, page }) => { draw(page, await doc.embedFont(StandardFonts.TimesRoman)); });
sources.plan = await save('plan', ({ page, font }) => {
  const lines = [[36, 36, 324, 36], [324, 36, 324, 204], [324, 204, 36, 204], [36, 204, 36, 36], [180, 36, 180, 100], [180, 130, 180, 204], [180, 120, 250, 120]];
  for (const [x1, y1, x2, y2] of lines) page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1 });
  page.drawText('SYNTHETIC PLAN / 1:100', { x: 45, y: 215, size: 9, font });
  page.drawText('ROOM A', { x: 70, y: 130, size: 12, font }); page.drawText('ROOM B', { x: 230, y: 155, size: 12, font });
});
sources.multiple = await save('multiple', ({ doc, page, font }) => { draw(page, font); draw(doc.addPage([360, 240]), font); });
sources.dense = await save('dense', ({ page }) => {
  for (let i = 0; i < 1200; i++) {
    const x = 20 + i % 40 * 7, y = 20 + Math.floor(i / 40) * 6;
    page.drawLine({ start: { x, y }, end: { x: x + 4, y }, thickness: 1 });
  }
});
sources.blank = await save('blank', () => {});
sources.fill = await save('fill', ({ page }) => page.drawRectangle({ x: 40, y: 40, width: 50, height: 50, color: rgb(1, 0, 0) }));
sources.outside = await save('outside', ({ page }) => page.drawLine({ start: { x: -20, y: 10 }, end: { x: 100, y: 10 } }));
sources.dash = await save('dash', ({ page, font }) => { page.pushOperators(setDashPattern([4, 2], 0)); draw(page, font); });
sources.clipped = await save('clipped', ({ page, font }) => { page.pushOperators(rectangle(60, 60, 50, 50), clip(), endPath()); draw(page, font); });
sources.invisible = await save('invisible', ({ page, font }) => { page.pushOperators(setTextRenderingMode(3)); draw(page, font); });
sources.hiddenLayer = await save('hidden-layer', ({ doc, page, font }) => {
  const layer = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Hidden') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [layer], D: { BaseState: 'OFF', OFF: [layer] } }));
  page.node.Resources().set(PDFName.of('Properties'), doc.context.obj({ Hidden: layer }));
  page.pushOperators(PDFOperator.of('BDC', [PDFName.of('OC'), PDFName.of('Hidden')])); draw(page, font); page.pushOperators(PDFOperator.of('EMC'));
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
sources.image = await save('image', async ({ doc, page }) => { page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 100, height: 100 }); });
sources.partialFailure = await save('partial-failure', async ({ doc, page, font }) => { draw(page, font); const second = doc.addPage([360, 240]); second.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 100, height: 100 }); });
sources.broken = path.join(inputRoot, 'broken.pdf'); await writeFile(sources.broken, 'not a valid PDF');
const inputHashes = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, file]) => [name, hash(await readFile(file))])));

const pythonScript = path.resolve('scripts/check-pdf-dwg-typography.py');
const nativeRows = [];
async function validateNative(result, name, expected = {}) {
  for (const [index, item] of result.pages.entries()) {
    const file = path.join(result.directory, item.file), stem = path.join(root, `${name}-${index}`);
    const read = await run(path.join(engineDir, 'dwgread.exe'), ['-O', 'JSON', '-o', stem + '.json', file], { windowsHide: true, timeout: 30000 });
    const native = JSON.parse(await readFile(stem + '.json', 'utf8'));
    const entities = native.OBJECTS.filter(obj => obj.entity === 'LINE' || obj.entity === 'TEXT' || obj.entity === 'SPLINE');
    assert.equal(entities.length, Object.values(item.entities).reduce((a, b) => a + b, 0));
    const converted = await run(path.join(engineDir, 'dwg2dxf.exe'), ['-o', stem + '.dxf', file], { windowsHide: true, timeout: 30000 });
    const independent = await run(path.resolve(values.python), [pythonScript, stem + '.dxf', result.directory], { windowsHide: true, timeout: 30000 });
    const audit = JSON.parse(independent.stdout);
    assert.equal(audit.errors, 0); assert.equal(audit.fixes, 0);
    assert.equal(audit.units, { mm: 4, m: 6, inch: 1 }[result.unit]);
    assert.equal(audit.objects.length, entities.length);
    const lines = audit.objects.filter(obj => obj.type === 'LINE');
    const texts = audit.objects.filter(obj => obj.type === 'TEXT');
    function near(actual, wanted) { assert.ok(Math.abs(actual - wanted) < 1e-7, `${name}: ${actual} != ${wanted}`); }
    if (expected.line) {
      assert.equal(lines.length, 1);
      for (const [key, points] of [['start', expected.line[0]], ['end', expected.line[1]]]) points.forEach((value, axis) => near(lines[0][key][axis], value));
      assert.deepEqual(lines[0].color, expected.color || [51, 102, 153]);
    }
    if (expected.text) assert.equal(texts.map(obj => obj.text).join(''), expected.text);
    let maximumWidthError = 0;
    assert.equal(texts.length, item.textLayout.length);
    for (let i = 0; i < texts.length; i++) {
      const actual = texts[i], target = item.textLayout[i];
      const error = Math.abs(actual.measuredWidth - target.width);
      maximumWidthError = Math.max(maximumWidthError, error);
      assert.ok(error < Math.max(1e-8, target.width * 1e-10), `${name}: rendered font width ${actual.measuredWidth} != PDF width ${target.width}`);
      near(actual.height, target.capHeight); near(actual.widthFactor, target.widthFactor);
      assert.equal(actual.font, result.fonts[0].file); assert.deepEqual(actual.missingGlyphs, []);
      assert.equal(actual.fontSha256, result.fonts[0].sha256);
      assert.equal(hash(await readFile(path.join(result.directory, actual.font))), result.fonts[0].sha256);
      assert.equal(hash(await readFile(path.join(result.directory, result.fonts[0].licenseFile))), hash(await readFile('public/assets/fonts/NOTO-SANS-SC-OFL.txt')));
    }
    if (expected.textWidth != null) near(texts[0].measuredWidth, expected.textWidth);
    if (expected.capHeight != null) near(texts[0].height, expected.capHeight);
    if (expected.rotation != null) {
      near(Math.sin(texts[0].rotation * Math.PI / 180), Math.sin(expected.rotation * Math.PI / 180));
      near(Math.cos(texts[0].rotation * Math.PI / 180), Math.cos(expected.rotation * Math.PI / 180));
    }
    if (expected.curve) {
      const splines = audit.objects.filter(obj => obj.type === 'SPLINE'); assert.equal(splines.length, 1);
      assert.equal(splines[0].degree, 3); assert.equal(splines[0].controls.length, 4);
      for (const [i, pair] of [[72, 72], [96, 120], [120, 24], [144, 72]].entries()) pair.forEach((value, axis) => near(splines[0].controls[i][axis], value * 25.4 / 72));
    }
    const diagnostics = (read.stderr + converted.stderr).trim();
    assert.doesNotMatch(diagnostics, /Warning:|ERROR:/i, `${name}: independent engine diagnostics`);
    await writeFile(stem + '.log', diagnostics);
    nativeRows.push({ scenario: name, page: item.page, artifact: path.relative(root, file).split(path.sep).join('/'), bytes: item.bytes, entities: item.entities,
      textWidthMaximumError: maximumWidthError, checkedTextRuns: texts.length, missingGlyphs: texts.flatMap(item => item.missingGlyphs),
      dxfAuditErrors: audit.errors, dxfAuditFixes: audit.fixes, units: audit.units,
      diagnostics: diagnostics.split(/\r?\n/).filter(line => /Warning:|ERROR:/i.test(line)),
      dwgSha256: hash(await readFile(file)), independentEngine: 'LibreDWG 0.14.9154', dxfValidator: 'ezdxf 1.4.3' });
  }
  passed(name);
}
const factor = 25.4 / 72;
const cases = [
  ['paper-mm', 'vector', {}, { line: [[25.4, 25.4], [50.8, 25.4]], text: 'Scale 1:1', textWidth: 50.028 * factor, capHeight: 12 * .718 * factor }],
  ['model-mm-100', 'vector', { scale: 100 }, { line: [[2540, 2540], [5080, 2540]] }],
  ['paper-inch', 'vector', { unit: 'inch' }, { line: [[1, 1], [2, 1]] }],
  ['model-metres-100', 'vector', { unit: 'm', scale: 100 }, { line: [[2.54, 2.54], [5.08, 2.54]] }],
  ['rotation-90', 'rotated', {}, { line: [[25.4, 101.6], [25.4, 76.2]], rotation: -90 }],
  ['nonzero-crop', 'cropped', {}, { line: [[12.7, 48 * factor], [38.1, 48 * factor]] }],
  ['user-unit-two', 'userUnit', {}, { line: [[50.8, 50.8], [101.6, 50.8]] }],
  ['affine-transform', 'affine', {}, { line: [[30 * factor, 40 * factor], [110 * factor, 40 * factor]], color: [0, 0, 0] }],
  ['cubic-spline', 'curve', {}, { curve: true }],
  ['unicode-text', 'chinese', {}, { text: 'CAD 中文图纸', textWidth: 73.896 * factor, capHeight: 12 * .733 * factor }],
  ['unicode-rotation-90', 'chineseRotated', {}, { text: 'CAD 中文图纸', textWidth: 73.896 * factor, capHeight: 12 * .733 * factor, rotation: -90 }],
  ['mixed-glyph-widths', 'chineseMixed', {}, {}],
  ['compressed-text', 'compressed', {}, { textWidth: 50.028 * .7 * factor, capHeight: 12 * .718 * factor }],
  ['expanded-text', 'expanded', {}, { textWidth: 50.028 * 1.3 * factor, capHeight: 12 * .718 * factor }],
  ['serif-cap-height', 'serif', {}, { capHeight: 12 * .662 * factor }],
  ['synthetic-floor-plan', 'plan', { scale: 100 }, {}],
  ['multiple-container-pages', 'dense', {}, {}],
  ['multiple-pages', 'multiple', {}, { line: [[25.4, 25.4], [50.8, 25.4]] }],
];
const results = [];
for (const [name, source, options, expected] of cases) {
  const result = await convertPrototype({ input: sources[source], outputDirectory: out, cadModule, ...options });
  await validateNative(result, name, expected); results.push(result);
}
assert.equal(results.at(-1).pages.length, 2);
const firstHash = hash(await readFile(path.join(results[0].directory, 'page-001.dwg')));
const repeated = await convertPrototype({ input: sources.vector, outputDirectory: out, cadModule });
assert.notEqual(repeated.directory, results[0].directory);
assert.equal(hash(await readFile(path.join(results[0].directory, 'page-001.dwg'))), firstHash); passed('repeat-preserves-existing-output');

const outputBeforeFailure = await readdir(out);
for (const [source, code] of [['blank', 'empty'], ['fill', 'fill'], ['image', 'unsupported-operator'], ['outside', 'outside-page'], ['partialFailure', 'unsupported-operator'],
  ['dash', 'dash'], ['clipped', 'unsupported-operator'], ['invisible', 'text-render-mode'], ['hiddenLayer', 'unsupported-operator']]) {
  await assert.rejects(convertPrototype({ input: sources[source], outputDirectory: out, cadModule }), error => error.code === code);
  assert.deepEqual(await readdir(out), outputBeforeFailure); passed('reject-' + source);
}
await assert.rejects(convertPrototype({ input: sources.broken, outputDirectory: out, cadModule })); passed('reject-broken-pdf');
let cancelled = false;
await assert.rejects(convertPrototype({ input: sources.multiple, outputDirectory: out, cadModule,
  onProgress: ({ completed }) => { if (completed === 1) cancelled = true; },
  check: () => { if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); },
}), error => error.code === 'cancelled');
assert.deepEqual(await readdir(out), outputBeforeFailure); passed('cancel-after-first-page-removes-all-staging');
assert.deepEqual(cadPrototypePages('2,1-2', 2), [1, 2]);
for (const invalid of ['0', '3', '2-1', '1,', 'no', '1.5']) assert.throws(() => cadPrototypePages(invalid, 2));
for (const invalid of [{ unit: 'unknown' }, { scale: 0 }, { scale: NaN }, { scale: 10001 }, { unit: '__proto__' }]) assert.throws(() => cadPrototypeSettings(invalid));
passed('settings-and-range-validation');
const font = await loadCadFont();
await assert.rejects(applyCadFont({ geometry: [{ type: 'TEXT', value: '\u{10ffff}', emHeight: 1, width: 1 }], notices: [] }), error => error.code === 'missing-font-glyph');
passed('missing-font-glyph-is-explicit-error');
assert.equal(results.find(result => !result.fonts.length).fonts.length, 0);
passed('geometry-only-export-does-not-require-font-assets');
passed('all-text-runs-use-shipped-font-and-preserve-PDF-advance');
for (const [name, file] of Object.entries(sources)) assert.equal(hash(await readFile(file)), inputHashes[name]); passed('all-source-hashes-unchanged');
const lock = JSON.parse(await readFile('tmp/tk016/acad-ts-research/package-lock.json', 'utf8'));
const report = { task: 'TK-016-A', scope: 'limited-linework-conversion-prototype', codecAdapter: 'acad-ts-3.9.0-root-defaults-and-section-count', artifactRun: path.basename(root), checks, scenarios: nativeRows,
  textLayout: 'portable-font-cap-height-width-factor', font: font.metadata,
  package: lock.packages['node_modules/@node-projects/acad-ts'],
  engineSha256: hash(await readFile(path.join(engineDir, 'dwgread.exe'))),
  releaseArchiveSha256: hash(await readFile(path.join(path.dirname(engineDir), 'libredwg-0.14.9154-win64.zip'))),
  sourceHashes: inputHashes,
  status: nativeRows.some(row => row.diagnostics.length) ? 'geometry-passed-with-engine-diagnostics' : 'synthetic-geometry-passed',
  remaining: ['no independently installed interactive CAD', 'no user/production PDF drawings', 'CAD must resolve the shipped font', 'glyph design may differ from the original PDF font', 'unsupported PDF operators explicitly rejected', 'no desktop integration', 'no native release package'] };
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (values.snapshot) await writeFile(path.resolve(values.snapshot), JSON.stringify(report, null, 2) + '\n');
console.log(`${checks.length} prototype checks; ${nativeRows.length} independent native DWG/DXF validations; ${report.status}`);
