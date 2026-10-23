import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, beginText, endText, setFontAndSize, setTextMatrix, showText,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, stroke } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { recoverTableTextLayers } from '../src/features/pdf-to-word/core/table-text-layers.js';
import { ruledTableGrids } from '../src/features/pdf-to-word/core/tables.js';
import { matchRenderedTextOperations, mappedTextSelection } from '../src/features/pdf-to-word/core/render-text-map.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { planAiScopes, aiScopePayload, applyAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

function fixture(groups = [['A'], ['B']]) {
  const operations = [], text = [], sources = [];
  for (const group of groups) {
    operations.push({ name: 'beginText' });
    for (const value of group) {
      if (value === 'RESET') { operations.push({ name: 'setTextMatrix', args: [1, 0, 0, 1, 240, 25] }); continue; }
      const id = `p1:t${operations.length}`, rect = { x: value === 'OUTSIDE' ? 240 : 30,
        y: value === 'B' ? 75 : 25, width: 30, height: 10 };
      operations.push({ name: 'showText' });
      sources.push({ id, text: value, rect, disposition: value === 'HIDDEN' ? 'excluded-hidden' : 'visible-image' });
      if (value !== 'HIDDEN') text.push({ id, text: value, sourceIds: [id], rect, size: 10, baseline: rect.y + 9, raster: false });
    }
    operations.push({ name: 'endText' });
  }
  const rect = { x: 10, y: 10, width: 200, height: 100 };
  return { number: 1, operations, text, sources,
    items: [{ id: 'table-picture', type: 'image', role: 'figure', rect, sourceIds: text.filter(item => item.text !== 'OUTSIDE').map(item => item.id) }],
    rules: [10, 60, 110].map(at => ({ axis: 'h', at, from: 10, to: 210 }))
      .concat([10, 110, 210].map(at => ({ axis: 'v', at, from: 10, to: 110 }))) };
}
const recovered = recoverTableTextLayers(fixture());
assert.equal(recovered.count, 1); assert.equal(recovered.items.filter(item => item.type === 'text').length, 2);
const adjacentBorder = fixture();
adjacentBorder.graphics = [{ rect: { x: 9.75, y: 10, width: .5, height: 100 }, order: 100, strokedFillRect: true }];
assert.equal(recoverTableTextLayers(adjacentBorder).count, 1,
  'a later backdrop touching only the cell boundary does not protect unrelated cell text');
const coveredEdge = fixture();
coveredEdge.graphics = structuredClone(adjacentBorder.graphics);
coveredEdge.text[0].rect.x = 10.1;
assert.equal(recoverTableTextLayers(coveredEdge).count, 0,
  'a border actually touching text remains protected even inside the boundary tolerance');
const coveredInterior = fixture();
coveredInterior.graphics = [{ rect: { x: 25, y: 23, width: 12, height: 15 }, order: 100, strokedFillRect: true }];
assert.equal(recoverTableTextLayers(coveredInterior).count, 0,
  'a later rectangular fill over cell content must not be treated as an earlier backdrop');
const overhang = fixture(); overhang.items[0].rect.width += 2;
assert.equal(recoverTableTextLayers(overhang).count, 1, 'minor painted edge overhang does not discard otherwise proven cell text');
const footerExtension = fixture([['A'], ['B'], ['OUTSIDE']]);
const outside = footerExtension.text.find(item => item.text === 'OUTSIDE');
outside.rect = { x: 30, y: 120, width: 40, height: 10 };
footerExtension.sources.find(source => source.id === outside.id).rect = outside.rect;
footerExtension.items[0].rect.height = 125;
footerExtension.items[0].sourceIds.push(outside.id);
const restoredExtension = recoverTableTextLayers(footerExtension);
assert.equal(restoredExtension.count, 1, 'a bounded footer joined to a table backdrop does not prevent proven cell text recovery');
assert.deepEqual(restoredExtension.items.filter(item => item.type === 'text').map(item => item.text), ['A', 'B']);
assert.deepEqual(restoredExtension.items[0].sourceIds, [outside.id], 'content outside the confirmed cells stays in its backdrop');
assert.deepEqual(recovered.items[0].sourceIds, []); assert.deepEqual(recovered.items[0].backgroundPaintIndexes, [1, 4]);
const reusable = fixture(), tableGrids = ruledTableGrids(reusable.rules), unchangedGrids = structuredClone(tableGrids);
assert.deepEqual(recoverTableTextLayers({ ...reusable, tableGrids }).items, recovered.items);
assert.deepEqual(tableGrids, unchangedGrids, 'shared grid geometry is read-only');
const opNames = Object.fromEntries(Object.entries(OPS).map(([name, code]) => [code, name]));
const textOp = text => ({ name: 'showText', args: [[{ unicode: text, fontChar: text, width: 500, isInFont: true }]] });
const matrixOp = x => ({ name: 'setTextMatrix', args: [new Float32Array([1, 0, 0, 1, x, 20])] });
const sourceOps = ['A', 'B', 'C'].flatMap((text, index) => [{ name: 'beginText', args: [] },
  { name: 'setFont', args: ['face', 12] }, matrixOp(20 + index * 40), textOp(text), { name: 'endText', args: [] }]);
const optimizedOps = [{ name: 'beginText', args: [] }, { name: 'setFont', args: ['face', 12] },
  ...['A', 'B', 'C'].flatMap((text, index) => [matrixOp(20 + index * 40), textOp(text)]), { name: 'endText', args: [] }];
const list = operations => ({ fnArray: operations.map(operation => OPS[operation.name]), argsArray: operations.map(operation => operation.args), lastChunk: true });
const binding = matchRenderedTextOperations(sourceOps, list(optimizedOps), opNames);
assert(binding); assert.deepEqual([...mappedTextSelection(binding, [3, 13])], [3, 7]);
assert.equal(mappedTextSelection(binding, [1]), null);
for (const mutate of [
  operations => { operations[3] = textOp('changed'); },
  operations => { operations.splice(5, 1); },
  operations => { [operations[3], operations[5]] = [operations[5], operations[3]]; },
  operations => { operations[4] = { name: 'setLeading', args: [12] }; },
]) {
  const changed = structuredClone(optimizedOps); mutate(changed);
  assert.equal(matchRenderedTextOperations(sourceOps, list(changed), opNames), null);
}
assert.equal(matchRenderedTextOperations(sourceOps, null, opNames), null);
assert.equal(matchRenderedTextOperations(sourceOps, { ...list(optimizedOps), lastChunk: false }, opNames), null);
const hidden = fixture([['A', 'HIDDEN'], ['B']]), hiddenResult = recoverTableTextLayers(hidden);
assert.equal(hiddenResult.count, 1); assert(!hiddenResult.items.some(item => item.text === 'HIDDEN'));
assert.equal(hidden.sources.find(source => source.text === 'HIDDEN').disposition, 'excluded-hidden');
for (const alter of [
  input => { input.rules.pop(); },
  input => { input.items[0].rect = { x: 0, y: 0, width: 600, height: 800 }; },
  input => { input.items[0].role = 'math'; },
  input => { input.text[0].raster = true; },
  input => { input.text[0].text = '='; },
  input => { input.text[0].text = 'x'; input.text[0].italic = true; },
  input => { input.graphics = [{ rect: { x: 35, y: 40, width: 15, height: .5 }, thin: true, decoration: true }]; },
  input => { input.sources.push({ id: 'redraw', text: 'A', disposition: 'redraw', equivalentTo: input.text[0].id }); },
  input => { input.operations[1].name = 'nextLineSetSpacingShowText'; },
  input => { input.operations.pop(); },
  input => { input.operations[2].name = 'beginText'; },
  input => { input.items.push({ ...structuredClone(input.items[0]), id: 'overlapping-picture', sourceIds: [] }); },
]) {
  const input = fixture(); alter(input);
  assert.equal(recoverTableTextLayers(input).count, 0, 'ambiguous or stateful text cannot be erased from a backdrop');
}
assert.equal(recoverTableTextLayers(fixture([['A', 'OUTSIDE'], ['B']])).count, 0,
  'removing one draw must not shift a later visible draw in the same text object');
assert.equal(recoverTableTextLayers(fixture([['A', 'RESET', 'OUTSIDE'], ['B']])).count, 1,
  'an explicit text matrix resets the position of the remaining outside draw');
const scripted = fixture([['A'], ['B'], ['SUP']]);
Object.assign(scripted.text[0], { text: '10', rect: { x: 30, y: 25, width: 12, height: 10 } });
Object.assign(scripted.text[2], { text: '2', size: 6, baseline: 25, rect: { x: 41, y: 20, width: 4, height: 6 } });
assert.equal(recoverTableTextLayers(scripted).count, 0, 'small raised text protects the whole expression cell');

const directory = 'tmp/pdf-word-table-layers'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([300, 500]);
page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 5, 5), moveTo(1, 1), lineTo(15, 1), stroke(), popGraphicsState());
const red = rgb(.7, .1, .1);
page.drawRectangle({ x: 20, y: 150, width: 240, height: 200, borderColor: red, borderWidth: .5 });
page.drawLine({ start: { x: 140, y: 150 }, end: { x: 140, y: 350 }, color: red, thickness: .5 });
page.drawLine({ start: { x: 20, y: 250 }, end: { x: 260, y: 250 }, color: red, thickness: .5 });
const labels = [ ['ALPHA', 36, 310], ['BETA', 160, 310], ['GAMMA', 36, 210] ];
const fontKey = page.node.newFontDictionary(font.name, font.ref);
page.pushOperators(beginText(), setFontAndSize(fontKey, 12));
for (const [text, x, y] of labels) page.pushOperators(setTextMatrix(1, 0, 0, 1, x, y), showText(font.encodeText(text)));
page.pushOperators(setTextMatrix(1, 0, 0, 1, 22, 400), showText(font.encodeText('OUTSIDE')), endText());
page.drawText('1', { x: 180, y: 220, size: 12, font });
page.drawLine({ start: { x: 178, y: 216 }, end: { x: 189, y: 216 }, thickness: .5, color: rgb(0, 0, 0) });
page.drawText('2', { x: 180, y: 202, size: 12, font });
page.drawText('SECRET', { x: 160, y: 175, size: 12, font });
page.drawRectangle({ x: 155, y: 169, width: 85, height: 22, color: rgb(1, 1, 1) });
page.drawRectangle({ x: 20, y: 20, width: 240, height: 100, borderColor: red, borderWidth: .5 });
page.drawLine({ start: { x: 140, y: 20 }, end: { x: 140, y: 120 }, color: red, thickness: .5 });
page.drawLine({ start: { x: 20, y: 70 }, end: { x: 260, y: 70 }, color: red, thickness: .5 });
const secondLabels = [['LEFT', 36, 90], ['RIGHT', 160, 90]];
for (const [text, x, y] of secondLabels) page.drawText(text, { x, y, size: 12, font });
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const source = await task.promise, original = await source.getPage(1), canvas = createCanvas(1, 1);
  const render = original.render.bind(original); let renders = 0, firstRender;
  original.render = options => { renders++; const result = render(options); if (renders === 1) firstRender = result; return result; };
  const operation = { optionalContentConfig: await source.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  assert(snapshot.textLayerMapping, 'the current PDF.js display stream is verified');
  assert.notDeepEqual(snapshot.operations.flatMap((operation, index) => operation.name === 'showText' ? [index] : []),
    firstRender._internalRenderTask.operatorList.fnArray.flatMap((code, index) => code === OPS.showText ? [index] : []),
    'the real fixture changes drawing indexes through PDF.js path optimization');
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert.equal(scene.backgroundTextLayers, 2);
  for (const [label] of labels.concat(secondLabels)) assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable');
  for (const label of ['1', '2']) assert.equal(scene.sources.find(source => source.text === label).disposition, 'visible-image');
  assert.equal(scene.sources.find(source => source.text === 'SECRET').disposition, 'excluded-hidden');
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  assert.equal(renders, 2, 'all table layers on the page share one additional real PDF render');
  assert.equal(operation.renderTask, null);
  const backdrop = scene.items.find(item => item.backgroundPaintIndexes?.length), asset = assets.find(asset => asset.id === backdrop.id);
  assert.deepEqual(asset.excludedPaintIndexes, backdrop.backgroundPaintIndexes); assert.equal(asset.format, 'png');
  const decoded = await loadImage(asset.bytes), visible = createCanvas(decoded.width, decoded.height), context = visible.getContext('2d');
  context.drawImage(decoded, 0, 0);
  const black = data => { let count = 0; for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) < 70) count++; return count; };
  const blackInSourceRect = rect => {
    const x = Math.max(0, Math.floor(rect.x * plan.scale) - Math.floor(backdrop.rect.x * plan.scale) - 2);
    const y = Math.max(0, Math.floor(rect.y * plan.scale) - Math.floor(backdrop.rect.y * plan.scale) - 2);
    return black(context.getImageData(x, y, Math.min(visible.width - x, Math.ceil(rect.width * plan.scale) + 4),
      Math.min(visible.height - y, Math.ceil(rect.height * plan.scale) + 4)).data);
  };
  for (const [label] of labels.concat([['SECRET']])) assert.equal(blackInSourceRect(scene.sources.find(source => source.text === label).rect), 0,
    'old native words and the redacted secret are absent from the stored backdrop');
  for (const label of ['1', '2']) assert(blackInSourceRect(scene.sources.find(source => source.text === label).rect) > 50,
    'the complete fraction remains in the backdrop instead of splitting its numerator/denominator into plain text');
  assert(black(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) > 100,
    'source canvas is retained unchanged and really contained visible words');
  assert(context.getImageData(0, 0, visible.width, visible.height).data.some((value, index, data) => index % 4 === 0 && value > 100 && data[index + 1] < 80),
    'the red grid survives removal of text');
  const otherBackdrop = scene.items.find(item => item.backgroundPaintIndexes?.length && item !== backdrop);
  const otherImage = await loadImage(assets.find(asset => asset.id === otherBackdrop.id).bytes);
  const otherCanvas = createCanvas(otherImage.width, otherImage.height); otherCanvas.getContext('2d').drawImage(otherImage, 0, 0);
  assert.equal(black(otherCanvas.getContext('2d').getImageData(0, 0, otherCanvas.width, otherCanvas.height).data), 0,
    'the second table also contains no duplicated native words');
  otherCanvas.width = otherCanvas.height = 0;
  const layout = inferDocument([scene]);
  const localLayout = structuredClone(layout), scopes = planAiScopes(layout);
  const restoredIds = new Set(scene.items.filter(item => item.type === 'text' && item.text !== 'OUTSIDE').flatMap(item => item.sourceIds));
  assert(scopes.length, 'outside prose still participates in AI structure review');
  let assisted = layout;
  for (const scope of scopes) {
    const payload = aiScopePayload(layout.pages[0], scope);
    assert(!payload.regions?.some(region => layout.pages[0].blocks.find(block => block.id === region.id)
      ?.sourceIds.some(id => restoredIds.has(id))),
      'text restored over a fixed table backdrop must not enter AI regrouping');
    const identity = { schemaVersion: 2, requestId: 'table-layer-review', inputDigest: 'a'.repeat(64),
      sourceDigest: 'b'.repeat(64), page: scope.page, scopeId: scope.id };
    const request = { ...payload, ...identity };
    assisted = applyAiScope(assisted, scope, request, { ...identity,
      groups: request.regions.map((region, i) => ({ id: `group${i}`, role: 'paragraph', sourceIds: [region.id] })),
      readingOrder: request.regions.map((_, i) => `group${i}`) });
  }
  assert.deepEqual(layout, localLayout, 'AI planning and application retain the source layout');
  for (const block of layout.pages[0].blocks.filter(block => block.backgroundPaintIndexes?.length
    || block.sourceIds.some(id => restoredIds.has(id)))) {
    assert.deepEqual(assisted.pages[0].blocks.find(candidate => candidate.id === block.id), block,
      'AI review leaves backdrop and its editable text at their original positions');
  }
  const assistedOutput = await createWordBytes(assisted, assets, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const assistedXml = await (await JSZip.loadAsync(assistedOutput.bytes)).file('word/document.xml').async('string');
  for (const [label] of labels.concat(secondLabels, [['OUTSIDE']])) assert.equal(assistedXml.split(`>${label}<`).length - 1, 1);
  assert(!assistedXml.includes('SECRET'));
  assert.equal(layout.pages[0].backgroundTextLayers, 2);
  for (const continuous of [false, true]) {
    const result = await createWordBytes(layout, assets, { continuous, measurementContext: createCanvas(1, 1).getContext('2d') });
    const zip = await JSZip.loadAsync(result.bytes), xml = await zip.file('word/document.xml').async('string');
    for (const [label] of labels.concat(secondLabels)) assert.equal(xml.split(`>${label}<`).length - 1, 1);
    assert(!xml.includes('SECRET')); assert(/behindDoc="(?:1|true)"/.test(xml));
    assert.equal(result.quality.editableCharacters, labels.concat(secondLabels).reduce((sum, [text]) => sum + text.length, 'OUTSIDE'.length));
    assert.equal(result.quality.imageCharacters, 2);
    await writeFile(`${directory}/${continuous ? 'continuous' : 'positioned'}.docx`, result.bytes);
  }
  await assert.rejects(createWordBytes(layout, assets.map(asset => ({ ...asset, excludedPaintIndexes: undefined }))), /pdf-to-word:image/);
  await assert.rejects(collectPageAssets(scene, createCanvas(canvas.width, canvas.height), createCanvas), /pdf-to-word:image/);
  for (const backgroundPaintIndexes of [[-1], [backdrop.backgroundPaintIndexes[0], backdrop.backgroundPaintIndexes[0]], [0]]) {
    await assert.rejects(collectPageAssets({ ...scene, items: [{ ...backdrop, backgroundPaintIndexes }] }, canvas, createCanvas), /pdf-to-word:image/);
  }
  await assert.rejects(collectPageAssets(scene, canvas, createCanvas, () => { throw Error('cancelled'); }), /cancelled/);
  assert.equal(operation.renderTask, null);
  assert(plan.scale > 0); canvas.width = canvas.height = visible.width = visible.height = 0;
} finally { await task.destroy(); }

let calls = 0, rejectRender;
const fakeList = { fnArray: [OPS.beginText, OPS.showText, OPS.endText], argsArray: [[], [[]], []], lastChunk: true };
const fakePage = { pageNumber: 1, getViewport: ({ scale }) => ({ width: 20 * scale, height: 20 * scale, transform: [scale, 0, 0, -scale, 0, 20 * scale] }),
  getOperatorList: async () => fakeList,
  getTextContent: async () => ({ items: [] }),
  render() { return ++calls === 1 ? { promise: Promise.resolve(), _internalRenderTask: { operatorList: fakeList } } : {
    promise: new Promise((_, reject) => { rejectRender = reject; }), cancel() { rejectRender(Error('cancelled-background')); },
  }; } };
const operation = {}, sourceCanvas = createCanvas(1, 1), releases = new Set();
await snapshotPage(fakePage, OPS); await renderPage(fakePage, sourceCanvas, operation);
const backgroundFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return new Proxy(canvas, {
    get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { if (['width', 'height'].includes(key) && value === 0) releases.add(key); return Reflect.set(target, key, value, target); },
  });
};
const pending = collectPageAssets({ number: 1, width: 20, height: 20, items: [{ id: 'background', type: 'image', sourceIds: [],
  rect: { x: 0, y: 0, width: 20, height: 20 }, backgroundPaintIndexes: [1] }] }, sourceCanvas, backgroundFactory);
assert(operation.renderTask); operation.renderTask.cancel();
await assert.rejects(pending, /cancelled-background/);
assert.equal(operation.renderTask, null); assert.equal(releases.size, 2);
sourceCanvas.width = sourceCanvas.height = 0;
console.log('Table layer checks passed: closed grids, independent text groups, visible words removed from real backgrounds, redaction, source coverage, background provenance and positioned/continuous DOCX.');
