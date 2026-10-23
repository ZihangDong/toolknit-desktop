import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { wordFont, wordLineMetrics } from '../src/features/pdf-to-word/adapters/docx-fonts.js';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';

assert.equal(wordFont('ABCDEF+MinionPro-Regular', 'serif'), 'Times New Roman');
assert.equal(wordFont('ABCDEF+CenturyGothic-Bold', 'sans-serif'), 'Arial');
assert.equal(wordFont('ABCDEF+UnknownMono', 'monospace'), 'Courier New');
assert.equal(wordFont('ABCDEF+Calibri', 'serif'), 'Calibri', 'known families override inaccurate subset fallback flags');
assert.equal(wordFont('ABCDEF+SegoeUI', 'sans-serif'), 'Segoe UI');
assert.equal(wordFont('ABCDEF+NimbusRoman-Regular', 'sans-serif'), 'Times New Roman');
assert.equal(wordFont('ABCDEF+FZSSK', 'sans-serif'), 'SimSun');
assert.equal(wordFont('ABCDEF+URWPalladioL-Roma', 'sans-serif'), 'Palatino Linotype',
  'known serif faces override inaccurate PDF generic family flags');
assert.equal(wordFont('ABCDEF+P052-Italic', 'sans-serif'), 'Palatino Linotype');
assert(wordLineMetrics('Palatino Linotype', 1499 / 2048, 582 / 2048));
assert.equal(wordLineMetrics('Palatino Linotype', 2150 / 2048, 613 / 2048), null, 'do not apply a second correction to Win metrics');
assert.equal(wordLineMetrics('Palatino Linotype', .9, .2), null, 'an unknown substitute must not use another face\'s metrics');
assert.equal(wordLineMetrics('Times New Roman', 1499 / 2048, 582 / 2048), null);
assert.equal(wordFont('LegacyCustomFont'), 'LegacyCustomFont', 'layouts without PDF family metadata retain compatibility');
assert.equal(wordFont('LegacyCustomFont', '__proto__'), 'LegacyCustomFont');
assert.equal(wordFont('<invalid>', 'unrecognized'), 'SimSun');

const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.TimesRoman), page = pdf.addPage([300, 240]);
page.drawText('Invoice total 1234.56', { x: 25, y: 160, font, size: 12 });
const italicFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
page.drawText('jiffy', { x: 25, y: 115, font: italicFont, size: 18 });
const task = getDocument({ data: await pdf.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  assert.equal(snapshot.fonts[snapshot.fontIds[0]].fallbackFamily, 'serif');
  snapshot.fonts[snapshot.fontIds[0]].name = 'ABCDEF+UnavailablePublicationSerif';
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(scene.items.filter(item => item.type === 'text').every(item => item.fontFamily === 'serif'));
  const absentSpaces = structuredClone(snapshot);
  for (const operation of absentSpaces.operations) if (operation.name === 'showText') {
    for (const glyph of operation.args[0]) if (typeof glyph === 'object' && glyph.unicode === ' ') {
      Object.assign(glyph, { fontChar: '%', isInFont: false, isSpace: false });
    }
  }
  const absentScene = prepareWordScene(absentSpaces, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(absentScene.items.every(item => item.type === 'text'),
    'a repaired-font outline cannot create ink for an absent glyph that PDF.js does not paint');
  assert.deepEqual(absentScene.sources.map(source => source.text), scene.sources.map(source => source.text));
  const layout = inferDocument([scene]), unchanged = structuredClone(layout);
  const output = await createWordBytes(layout, [], { measurementContext: createCanvas(1, 1).getContext('2d') });
  const zip = await JSZip.loadAsync(output.bytes), tree = xml2js(await zip.file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
  const descendants = node => [node, ...(node.elements || []).flatMap(descendants)];
  const textRuns = descendants(tree).filter(node => node.name === 'w:r' && descendants(node)
    .some(child => child.name === 'w:t' && child.elements?.some(part => part.type === 'text' && part.text.trim())));
  assert(textRuns.length);
  assert(textRuns.every(node => descendants(node).some(child => child.name === 'w:rFonts' && child.attributes['w:ascii'] === 'Times New Roman')));
  const text = descendants(tree).filter(node => node.name === 'w:t').map(node => node.elements?.map(child => child.text || '').join('')).join('');
  assert.equal(text, 'Invoice total 1234.56jiffy');
  assert.deepEqual(layout.pages[0].sources, unchanged.pages[0].sources, 'font fallback cannot rewrite source values');
  assert.equal(output.quality.imageCharacters, 0);
  const zeroMetrics = structuredClone(snapshot);
  Object.values(zeroMetrics.fonts).forEach(font => Object.assign(font, { ascent: 0, descent: 0, data: null }));
  const boundedScene = prepareWordScene(zeroMetrics, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(boundedScene.sources.every(source => source.disposition === 'editable'), 'invalid font metrics cannot classify painted text as hidden');
  assert(inspectSceneInk(boundedScene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale).accepted, 'fallback bounds cover the real visible glyphs');
  canvas.width = canvas.height = 0; original.cleanup();
} finally { await task.destroy(); }
console.log('PDF Word font fallback passed: renderer family metadata, stable output faces, source values and legacy layouts.');
