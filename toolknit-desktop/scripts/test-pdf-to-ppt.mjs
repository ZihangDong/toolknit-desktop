import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { PDF_PPT_LIMITS, pptPageRange, pptRenderPlan, pptSlideSize, fitPptImage, validatePptInput, validatePptPages, pptFileName } from '../src/features/pdf-to-ppt/core.js';
import { createImagePresentation } from '../src/features/pdf-to-ppt/package.js';
import { publishPdfPresentation } from '../src/features/pdf-to-ppt/processor.js';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import markup from '../src/features/pdf-to-ppt/template.js';

assert.deepEqual(pptPageRange('3, 1-2，2', 4), [1, 2, 3]);
assert.deepEqual(pptPageRange('', 2), [1, 2]);
for (const range of ['0', '3-2', '1,', '1-5', 'x', '1.5', '-1', '9'.repeat(1001)]) assert.throws(() => pptPageRange(range, 4), /pdf-ppt:range/);
validatePptInput({ name: '中文.PDF', size: 5 }); validatePptPages(200);
for (const file of [{ name: 'x.zip', size: 5 }, { name: 'x.pdf', size: 0 }, { name: 'x.pdf', size: NaN }]) assert.throws(() => validatePptInput(file));
assert.throws(() => validatePptInput({ name: 'x.pdf', size: PDF_PPT_LIMITS.inputBytes + 1 }), /input-large/);
assert.throws(() => validatePptPages(201), /pages-large/);
assert.equal(pptFileName('合同 <终稿>.PDF'), '合同 _终稿__slides.pptx');
assert.equal(pptRenderPlan(595, 842, 300).pixelWidth, 2480);
for (const args of [[595, 842, 72], [9000, 1, 144], [3000, 3000, 300], [NaN, 10, 144]]) assert.throws(() => pptRenderPlan(...args));
assert.throws(() => pptSlideSize(1, 11), /page-size/);
const size = pptSlideSize(360, 480), box = fitPptImage(640, 360, size);
assert.equal(box.x, 0); assert.ok(box.y > 0); assert.equal(box.cx, size.cx);
assert.ok(box.cy + box.y <= size.cy); assert.ok(Math.abs(box.cx / box.cy - 640 / 360) < 0.00001);

const image = await createCanvas(40, 30).encode('png');
const deck = createImagePresentation({ width: 360, height: 480, count: 2, title: '合同 & <图片>' });
deck.add({ bytes: image, width: 360, height: 480, pageNumber: 2 });
await assert.rejects(() => deck.finish(), /invalid/);
deck.add({ bytes: image, width: 640, height: 360, pageNumber: 4 });
assert.throws(() => deck.add({ bytes: image, width: 1, height: 1 }), /invalid/);
const bytes = await deck.finish(), zip = await JSZip.loadAsync(bytes);
const xml = name => zip.file(name).async('string');
assert.match(await xml('ppt/presentation.xml'), /cx="6858000" cy="9144000" type="custom"/);
assert.equal((await xml('ppt/presentation.xml')).match(/<p:sldId /g).length, 2);
assert.match(await xml('docProps/core.xml'), /合同 &amp; &lt;图片&gt;/);
for (const index of [1, 2]) {
  const slide = await xml(`ppt/slides/slide${index}.xml`);
  assert.equal((slide.match(/<p:pic>/g) || []).length, 1); assert.doesNotMatch(slide, /<p:sp>/);
  assert.match(slide, /<a:blip r:embed="rId2"/);
  assert.deepEqual(await zip.file(`ppt/media/page${index}.png`).async('uint8array'), new Uint8Array(image));
  assert.match(await xml(`ppt/slides/_rels/slide${index}.xml.rels`), new RegExp(`Target="../media/page${index}.png"`));
}
assert.doesNotMatch((await Promise.all(Object.keys(zip.files).filter(name => /\.xml(\.rels)?$/.test(name)).map(xml))).join(''), /TargetMode="External"/);
const invalid = createImagePresentation({ width: 10, height: 10, count: 1, title: '' });
assert.throws(() => invalid.add({ bytes: new Uint8Array(10), width: 1, height: 1 }), /invalid/);

let committed = false, checks = 0, calls = [];
const operation = { check: () => checks++, committing: false };
const saved = await publishPdfPresentation({ output: { bytes, name: '合同.pptx' }, operation,
  getOutputDir: async category => { assert.equal(category, 'PDF_To_PPT'); return 'D:/QA 输出'; },
  onCommit: () => { committed = true; }, invoke: async (...args) => { calls.push(args); return 'D:/QA 输出/合同_1.pptx'; } });
assert.ok(committed && operation.committing && checks); assert.equal(saved, 'D:/QA 输出/合同_1.pptx');
assert.equal(calls[0][0], 'write_unique_file_binary'); assert.equal(calls[0][1], bytes);
assert.deepEqual(JSON.parse(Buffer.from(calls[0][2].headers['x-toolknit-output'], 'base64').toString()), { directory: 'D:/QA 输出', fileName: '合同.pptx' });
let published = false;
await assert.rejects(() => publishPdfPresentation({ output: { bytes, name: 'x.pptx' }, operation: { check() { throw Error('pdf-ppt:cancelled'); } },
  getOutputDir: async () => 'D:/QA', invoke: async () => { published = true; } }), /cancelled/);
assert.equal(published, false);

const zh = JSON.parse(await readFile('src/locales/zh.json')), en = JSON.parse(await readFile('src/locales/en.json'));
function flatten(value, prefix = '') { return Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[prefix + key, item]] : flatten(item, prefix + key + '.')); }
const chinese = new Map(flatten(zh.home.pdfPpt)), english = new Map(flatten(en.home.pdfPpt));
assert.deepEqual([...chinese.keys()].sort(), [...english.keys()].sort());
for (const [key, value] of chinese) assert.deepEqual(value.match(/\{\w+\}/g) || [], english.get(key).match(/\{\w+\}/g) || []);
for (const key of markup.matchAll(/home\.pdfPpt\.([\w.-]+)/g)) assert.ok(chinese.has(key[1]), key[1]);
assert.equal((await LAZY_TOOL_SPECS['pdf-to-ppt'].markup()).default, markup);
assert.equal(LAZY_TOOL_SPECS['pdf-to-ppt'].init, 'initPdfPptTool');
assert.ok(zh.help.nav.pdfPpt && en.help.nav.pdfPpt);
console.log('PDF to PPT: ranges, limits, proportional fitting, PPTX pictures/relationships, binary publication and bilingual registration passed.');
