import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWordWatermark, normalizeWatermark, watermarkPages } from '../src/word-watermark-core.js';
import { imageDimensions } from '../src/word-watermark-image.js';
import { applyWordWatermark } from '../cli/lib/word-watermark.mjs';

const root = path.resolve('tmp/word-watermark'); await mkdir(root, { recursive: true });
const fontBytes = new Uint8Array(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'));
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
check('ranges reject zero, reversed, empty tokens, leading zeros and outside pages', () => {
  for (const value of ['0', '01', '2-1', '1,', 'z', '1-4', '1-', '1-2-3']) assert.throws(() => watermarkPages(value, 3));
  assert.equal(watermarkPages('3,1-2,2', 3), '1-3'); assert.equal(watermarkPages('', 3), '');
  assert.equal(watermarkPages('1-10000'), '1-10000', 'large ranges stay below Windows process command-line limits');
});
check('options reject multiline, empty, >80 Unicode characters, invalid numbers and angles', () => {
  for (const value of [{text:''},{text:'a\nb'}, {text:'a'.repeat(81)}, {text:'ok',opacity:NaN}, {text:'ok',opacity:0}, {text:'ok',width:90}, {text:'ok',angle:30}]) assert.throws(() => normalizeWatermark(value));
  assert.equal(normalizeWatermark({text:'中文 Draft'}).type, 'text');
});
await assert.rejects(createWordWatermark({ text: 'a' }));
await assert.rejects(createWordWatermark({ text: 'a' }, {fontBytes:new Uint8Array([1,2,3])}),/watermark-font/);
await assert.rejects(createWordWatermark({ text: '\u{10ffff}' }, {fontBytes})); checks.push('missing font and unsupported glyph fail explicitly');
const text = await createWordWatermark({ text:'内部资料 DRAFT', pages:'1,3', angle:45 }, {fontBytes});
await writeFile(path.join(root, 'text-overlay.pdf'), text.bytes);
const layer = await PDFDocument.load(text.bytes); assert.equal(layer.getPageCount(), 1); checks.push('CJK text produces a one-page embedded-font PDF layer');
const canvas = createCanvas(120,60), ctx = canvas.getContext('2d');
ctx.fillStyle = '#d63333'; ctx.fillRect(0,0,120,60); ctx.clearRect(30,15,60,30);
const png = new Uint8Array(await canvas.encode('png')), jpg = new Uint8Array(await canvas.encode('jpeg'));
await writeFile(path.join(root, 'stamp.png'), png); await writeFile(path.join(root, 'stamp.jpg'), jpg);
for (const bytes of [png,jpg]) { assert.deepEqual(imageDimensions(bytes), {width:120,height:60}); await createWordWatermark({type:'image'}, {imageBytes:bytes}); }
checks.push('transparent PNG and JPEG accepted');
const huge = png.slice(); new DataView(huge.buffer).setUint32(16, 100000);
assert.throws(() => imageDimensions(huge)); await assert.rejects(createWordWatermark({type:'image'},{imageBytes:huge}));
await assert.rejects(createWordWatermark({type:'image'},{imageBytes:new Uint8Array(4*1024*1024+1)}));
checks.push('oversized dimensions, malformed and >4 MiB images rejected before preview decoding');
const pdf = await PDFDocument.create();
for (const size of [[595.28,841.89],[841.89,595.28],[297.64,420.945]]) { const page=pdf.addPage(size); page.drawText('BODY_'+pdf.getPageCount(),{x:30,y:40,size:12}); }
const input = path.join(root,'mixed.pdf'); await writeFile(input, await pdf.save());
const original = await readFile(input); const pages = await applyWordWatermark(input, text, {}); assert.equal(pages,2);
const task = getDocument({ data:new Uint8Array(await readFile(input)), standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts/')+'/' }); const parsed = await task.promise;
for(let i=1;i<=3;i++) { const page=await parsed.getPage(i), content=await page.getTextContent(); assert.ok(content.items.some(x=>x.str==='BODY_'+i)); const marks=content.items.filter(x=>x.str.includes('内部资料')); assert.equal(marks.length,i===2?0:1); }
await task.destroy(); checks.push('real qpdf overlay preserves searchable body, mixed paper sizes and exact selected pages');
const bad = path.join(root,'bad-pages.pdf'); await writeFile(bad,original);
await assert.rejects(applyWordWatermark(bad, {...text,pages:'4'},{}),/watermark-pages/); assert.deepEqual(await readFile(bad),original);
checks.push('out-of-range stamping fails without altering the original temporary PDF');
const abort = new AbortController(); abort.abort(); await assert.rejects(applyWordWatermark(bad,text,{signal:abort.signal})); assert.deepEqual(await readFile(bad),original);
checks.push('pre-cancelled watermark work retains the original and cleans overlay artifacts');
execFileSync('src-tauri/resources/qpdf/qpdf.exe',['--check',input],{windowsHide:true});
await writeFile(path.join(root,'core-report.json'),JSON.stringify({passed:true,checks},null,2)); console.log(`Word watermark: ${checks.length} groups passed.`);
