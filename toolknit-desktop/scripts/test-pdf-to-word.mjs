import assert from 'node:assert/strict';
import './test-pdf-word-quality.mjs';
import './test-pdf-word-image-assets.mjs';
import './test-pdf-word-table-layers.mjs';
import './test-pdf-word-table-extension.mjs';
import './test-pdf-word-white-text.mjs';
import './test-pdf-word-graphic-clipping.mjs';
import './test-pdf-word-table-cells.mjs';
import './test-pdf-word-graphic-text-layers.mjs';
import './test-pdf-word-text-paints.mjs';
import './test-pdf-word-aligned-tables.mjs';
import './test-pdf-word-table-backgrounds.mjs';
import './test-pdf-word-complex.mjs';
import './test-pdf-word-math.mjs';
import './test-pdf-word-native-layout.mjs';
import './test-pdf-word-native-candidates.mjs';
import './test-pdf-word-math-levels.mjs';
import './test-pdf-word-math-evidence.mjs';
import './test-pdf-word-long-bars.mjs';
import './test-pdf-word-summation.mjs';
import './test-pdf-word-integrals.mjs';
import './test-pdf-word-matrices.mjs';
import './test-pdf-word-glyph-radicals.mjs';
import './test-pdf-word-reading-order.mjs';
import './test-pdf-word-text-spacing.mjs';
import './test-pdf-word-font-style.mjs';
import './test-pdf-word-font-fallback.mjs';
import './test-pdf-word-font-outline.mjs';
import './test-pdf-word-tex-symbol.mjs';
import './test-pdf-word-radicals.mjs';
import './test-pdf-word-layers.mjs';
import './test-pdf-word-annotations.mjs';
import './test-pdf-word-patterns.mjs';
import './test-pdf-word-groups.mjs';
import './test-pdf-word-ai.mjs';
import './test-pdf-word-semantic-audit.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode,
  rectangle, clip, endPath } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { inferDocument, validateCoverage, leafBlocks } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { parsePageRange, validateInput, outputName, LIMITS } from '../src/features/pdf-to-word/core/input.js';
import { aiPageRequest, validateAiStructure, applyAiStructure } from '../src/features/pdf-to-word/core/ai.js';
import { paragraphLineHeight, planParagraphPagination } from '../src/features/pdf-to-word/core/pagination.js';
import { groupLines } from '../src/features/pdf-to-word/core/text.js';

const output = 'tmp/pdf-to-word-core'; await mkdir(output, { recursive: true });
const checks = [];
const columnItems = [{ id: 'left', x: 20, baseline: 100 }, { id: 'right', x: 220, baseline: 98.5 }]
  .map(item => ({ ...item, text: item.id, type: 'text', size: 10, sourceIds: [item.id],
    rect: { x: item.x, y: item.baseline - 7, width: 30, height: 9 } }));
const columnLines = groupLines(columnItems);
assert.equal(columnLines.length, 2);
for (const item of columnItems) assert.equal(columnLines.find(line => line.sourceIds.includes(item.id)).baseline, item.baseline,
  'separated columns retain their own text baseline after grouping nearby rows');
assert.deepEqual(parsePageRange('1-3, 2, 5', 6), [1, 2, 3, 5]);
for (const range of ['0', '3-1', '999', '1,,2', '-2', '1.5']) assert.throws(() => parsePageRange(range, 6));
assert.throws(() => parsePageRange('', LIMITS.selectedPages + 1));
assert.throws(() => validateInput({ name: 'file.pdf', size: 0 }));
assert.throws(() => validateInput({ name: 'file.pdf', size: LIMITS.inputBytes + 1 }));
checks.push('input and page boundaries reject invalid ranges without truncation');
const supplementary = String.fromCodePoint(0x1f4c4);
for (const name of ['a'.repeat(99) + supplementary + '.pdf', supplementary.repeat(60) + '.pdf']) {
  const output = outputName(name);
  assert(output.isWellFormed(), 'truncating a long filename cannot produce an invalid Unicode surrogate for native serialization');
  assert(output.length <= 114 && Buffer.byteLength(output, 'utf8') < 400);
}
assert.equal(outputName('a'.repeat(98) + supplementary + '.pdf'), 'a'.repeat(98) + supplementary + '_ToolKnit.docx');
checks.push('long supplementary-character filenames retain the existing native length budget without splitting characters');

const paragraphs = Array.from({ length: 25 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', size: 10.5,
  rect: { x: 40, y: 70 + index * 22, width: 400, height: 10.5 },
  lines: [{ rect: { height: 10.5 }, size: 10.5, items: [{ size: 10.5 }] }] }));
const before = structuredClone(paragraphs);
const tightBottom = paragraphs.at(-1).rect.y + paragraphLineHeight(paragraphs.at(-1)) + 12;
const plan = planParagraphPagination(paragraphs, { top: 70, bottom: tightBottom });
assert(plan.recovered > 0 && plan.recovered <= 18);
assert(plan.slackAfter >= plan.reserve); assert(!plan.limited);
assert.deepEqual(paragraphs, before);
for (const [index, block] of paragraphs.entries()) {
  const original = index ? block.rect.y - paragraphs[index - 1].rect.y - paragraphLineHeight(paragraphs[index - 1]) : 0;
  assert(plan.gaps.get(block.id) >= original * .85 - .05);
}
assert.equal(planParagraphPagination(paragraphs, { top: 70, bottom: 800 }).recovered, 0);
assert.equal(planParagraphPagination(paragraphs, { top: 70, bottom: tightBottom, continuous: true }), null);
assert.equal(planParagraphPagination([{ type: 'image' }], { top: 70, bottom: 800 }), null);
const anchored = structuredClone(paragraphs); anchored.at(-1).rect.y += 120;
const limited = planParagraphPagination(anchored, { top: 70, bottom: anchored.at(-1).rect.y + 15 });
assert(limited.limited); assert.equal(limited.recovered, 0);
const packed = structuredClone(paragraphs);
packed.forEach((block, index) => { block.rect.y = 70 + index * paragraphLineHeight(block); });
const noWhitespace = planParagraphPagination(packed, { top: 70, bottom: packed.at(-1).rect.y + 13 });
assert(noWhitespace.limited); assert.equal(noWhitespace.recovered, 0);
checks.push('pagination reserves spare lines using bounded whitespace only, preserving fonts and fixed gaps');

async function fixture() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const text = (page, value, x, y, size = 12) => page.drawText(value, { x, y, size, font });
  for (let index = 0; index < 6; index++) {
    const page = pdf.addPage([595, 842]);
    text(page, 'Shared document header', 40, 810, 9);
    const footer = `Page ${index + 8}`;
    text(page, footer, (595 - font.widthOfTextAtSize(footer, 9)) / 2, 20 + (index % 2) * 0.4, 9);
    if (index === 0) {
      text(page, 'R2 second', 320, 620); text(page, 'R1 first', 320, 700); text(page, 'L2 second', 40, 620); text(page, 'L1 first', 40, 700);
      page.drawText('A spanning title', { x: 40, y: 760, size: 20, font: bold });
    } else if (index === 1) {
      text(page, 'Visible content', 40, 740);
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
      text(page, 'HIDDEN-SENTINEL', 40, 700); page.pushOperators(popGraphicsState());
      text(page, 'COVERED-SENTINEL', 40, 660); page.drawRectangle({ x: 30, y: 650, width: 250, height: 30, color: rgb(1, 1, 1) });
      page.pushOperators(pushGraphicsState(), rectangle(40, 600, 60, 30), clip(), endPath());
      text(page, 'PARTIAL-SENTINEL', 40, 610); page.pushOperators(popGraphicsState());
    } else if (index === 2) {
      for (let row = 0; row < 4; row++) page.drawLine({ start: { x: 40, y: 700 - row * 40 }, end: { x: 500, y: 700 - row * 40 }, thickness: 1 });
      for (const x of [40, 170, 500]) page.drawLine({ start: { x, y: 580 }, end: { x, y: 700 }, thickness: 1 });
      for (let row = 0; row < 3; row++) { text(page, `Key-${row}`, 48, 674 - row * 40); text(page, `Value-${row}`, 178, 674 - row * 40); }
    } else if (index === 3) {
      text(page, 'Choose the correct answer.', 40, 740);
      text(page, 'A. First', 50, 700); text(page, 'B. Second', 300, 700); text(page, 'C. Third', 50, 670); text(page, 'D. Fourth', 300, 670);
    } else if (index === 4) {
      text(page, 'DUPLICATE', 40, 740); text(page, 'DUPLICATE', 40.1, 740);
      page.drawText('ROTATED', { x: 100, y: 620, size: 12, font, rotate: degrees(90) });
    } else {
      page.drawText('Styled heading', { x: 40, y: 780, size: 18, font: bold });
      text(page, 'Final editable paragraph.', 40, 740);
      page.drawText('Emphasis ', { x: 40, y: 710, size: 12, font: bold });
      const plainX = 40 + bold.widthOfTextAtSize('Emphasis ', 12);
      text(page, 'plain ', plainX, 710);
      page.drawText('italic', { x: plainX + font.widthOfTextAtSize('plain ', 12), y: 710, size: 12, font: italic });
      page.drawRectangle({ x: 40, y: 580, width: 130, height: 90, color: rgb(.2, .6, .4) });
    }
  }
  return new Uint8Array(await pdf.save());
}
const source = await fixture(); await writeFile(`${output}/source.pdf`, source);
const task = getDocument({ data: source.slice(), cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', wasmUrl: 'node_modules/pdfjs-dist/wasm/', verbosity: 0 });
const pdf = await task.promise, scenes = [], assets = [];
try {
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number), snapshot = await snapshotPage(page, OPS), canvas = createCanvas(1, 1);
    await renderPage(page, canvas, {}); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
    const scene = buildPageScene(snapshot); assets.push(...await collectPageAssets(scene, canvas, createCanvas)); scenes.push(scene);
    canvas.width = canvas.height = 0; page.cleanup();
  }
} finally { await task.destroy(); }
const document = inferDocument(scenes), quality = validateCoverage(document);
assert(document.pages.every(page => page.header.length));
assert(document.pages.every(page => page.footer.length));
assert(document.pages.every(page => leafBlocks(page.blocks).every(block => !(block.lines || []).some(line => /^Page \d+$/.test(line.text)))));
checks.push('centered page numbers remain footers across digit-width changes and coordinate rounding boundaries');
const columns = document.pages[0].blocks.find(block => block.type === 'columns');
assert(columns); assert.equal(columns.columns.length, 2);
const columnText = columns.columns.map(column => leafBlocks(column.blocks).flatMap(block => block.lines || []).map(line => line.text).join('\n'));
assert(columnText[0].indexOf('L1') < columnText[0].indexOf('L2')); assert(columnText[1].indexOf('R1') < columnText[1].indexOf('R2'));
checks.push('repeated headers and multi-column reading order');
assert(scenes[1].sources.find(source => source.text.includes('HIDDEN-SENTINEL')).disposition === 'excluded-hidden');
assert(scenes[1].sources.find(source => source.text.includes('COVERED-SENTINEL')).disposition === 'excluded-hidden');
assert(scenes[1].sources.find(source => source.text.includes('PARTIAL-SENTINEL')).disposition === 'visible-image');
checks.push('hidden covered and clipped text do not leak into editable text');
const table = document.pages[2].blocks.find(block => block.type === 'table');
assert(table); assert.equal(table.cells.length, 6); assert.equal(table.rows, 3);
assert(document.pages[3].blocks.some(block => block.type === 'option-grid'));
assert.equal(scenes[4].sources.filter(source => source.disposition === 'redraw').length, 1);
checks.push('real PDF table and option grids plus conservative redraw deduplication');
const invalid = structuredClone(document); invalid.pages[0].blocks.pop(); assert.throws(() => validateCoverage(invalid));
const request = aiPageRequest(document.pages[3], 'test', 'digest');
const response = { schemaVersion: 1, requestId: request.requestId, sourceDigest: request.sourceDigest, page: request.page,
  regions: request.regions.map(region => ({ id: region.id, role: region.role })), readingOrder: request.regions.map(region => region.id) };
const accepted = validateAiStructure(JSON.stringify(response), request);
assert.deepEqual(applyAiStructure(document, request, accepted).quality, quality);
for (const mutation of [value => { value.text = 'invented'; }, value => { value.regions.pop(); }, value => { value.readingOrder[0] = 'unknown'; }, value => { value.requestId = 'old'; }, value => { value.regions[0].role = 'execute'; }]) {
  const value = structuredClone(response); mutation(value); assert.throws(() => validateAiStructure(JSON.stringify(value), request));
}
checks.push('source coverage and AI contract reject omissions rewrites unknown ids stale tasks');
for (const [pageIndex, role] of [[0, 'columns'], [2, 'table']]) {
  const base = structuredClone(document), page = base.pages[pageIndex], structure = page.blocks.find(block => block.type === role);
  page.blocks = leafBlocks(page.blocks);
  const proposalRequest = aiPageRequest(page, `group-${role}`, 'digest');
  const fixed = role === 'columns' ? page.blocks.filter(block => !structure.sourceIds.some(id => block.sourceIds.includes(id))) : [];
  const grouped = role === 'columns'
    ? { id: 'structure', role, columns: structure.columns.map(column => ({ sourceIds: leafBlocks(column.blocks).map(block => block.id) })) }
    : { id: 'structure', role, cells: structure.cells.map(cell => ({ row: cell.row, col: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan, sourceIds: leafBlocks(cell.blocks).map(block => block.id) })) };
  const groups = [...fixed.map((block, index) => ({ id: `fixed${index}`, role: block.role, sourceIds: [block.id] })), grouped];
  const proposal = { schemaVersion: 1, requestId: proposalRequest.requestId, sourceDigest: 'digest', page: page.number, groups, readingOrder: groups.map(group => group.id) };
  const valid = validateAiStructure(JSON.stringify(proposal), proposalRequest);
  const applied = applyAiStructure(base, proposalRequest, valid);
  assert(applied.pages[pageIndex].blocks.some(block => block.type === role));
  assert.equal(applied.quality.characters, document.quality.characters);
  const bad = structuredClone(proposal);
  if (role === 'table') bad.groups.at(-1).cells[0].colSpan = 20;
  else bad.groups.at(-1).columns[0].sourceIds.push('fabricated');
  assert.throws(() => validateAiStructure(JSON.stringify(bad), proposalRequest));
}
checks.push('AI grouping reconstructs columns and tables without new text and rejects invalid spans');
const converted = await createWordBytes(document, assets, { measurementContext: createCanvas(1, 1).getContext('2d') });
await writeFile(`${output}/result.docx`, converted.bytes);
const zip = await JSZip.loadAsync(converted.bytes), xml = await zip.file('word/document.xml').async('string');
assert(xml.includes('Final editable paragraph.')); assert(!xml.includes('HIDDEN-SENTINEL')); assert(!xml.includes('COVERED-SENTINEL')); assert(!xml.includes('PARTIAL-SENTINEL'));
assert(xml.includes('<w:tbl>')); assert(xml.includes('<w:cols')); assert(Object.keys(zip.files).some(name => /^word\/header\d+\.xml$/.test(name)));
assert.equal((xml.match(/<w:docGrid w:type="default" w:linePitch="0"\/>/g) || []).length, (xml.match(/<w:sectPr>/g) || []).length);
const nodes = element => [element, ...(element.elements || []).flatMap(nodes)];
const root = xml2js(xml);
const elements = nodes(root);
for (const part of Object.keys(zip.files).filter(name => /^word\/(document|styles|header\d+|footer\d+)\.xml$/.test(name))) {
  const content = nodes(xml2js(await zip.file(part).async('string')));
  assert(!content.some(node => node.name === 'w:contextualSpacing'), `${part}: no inherited spacing suppression`);
}
for (const name of ['w:b', 'w:i', 'w:bCs', 'w:iCs', 'w:keepNext', 'w:keepLines']) {
  assert(!elements.some(node => node.name === name && ['false', '0', 'off'].includes(node.attributes?.['w:val'])), `${name}: redundant off tags omitted`);
}
const runFor = text => elements.find(node => node.name === 'w:r' && nodes(node).some(child => child.type === 'text' && child.text.trim() === text));
assert(nodes(runFor('Emphasis')).some(node => node.name === 'w:b'));
assert(!nodes(runFor('plain')).some(node => node.name === 'w:b' || node.name === 'w:i'));
assert(nodes(runFor('italic')).some(node => node.name === 'w:i'));
assert(elements.some(node => node.name === 'w:keepNext' && !['false', '0', 'off'].includes(node.attributes?.['w:val'])));
assert(elements.some(node => node.name === 'w:spacing' && Number(node.attributes?.['w:before']) > 0));
assert(elements.some(node => node.name === 'w:widowControl' && node.attributes?.['w:val'] === 'false'));
checks.push('preview-safe default-off properties preserve paragraph gaps, mixed emphasis and heading pagination');
assert(!Object.keys(zip.files).some(name => /vba|embeddings|activeX/i.test(name)));
checks.push('real DOCX package native tables columns headers and no hidden sentinels');
await writeFile(`${output}/report.json`, JSON.stringify({ checks, quality, bytes: converted.bytes.length }, null, 2));
console.log(JSON.stringify({ checks, quality, bytes: converted.bytes.length }, null, 2));
