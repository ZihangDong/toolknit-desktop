import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';
import { copyPdfPages } from '../src/core/pdf-page-copy.js';
import { createPdfPageRetention } from '../src/shared/pdf-page-retention.js';
import { writeUniqueBinaryFile } from '../src/platform/binary-output.js';

const source = await PDFDocument.create();
const image = await source.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const privateData = source.context.register(source.context.stream(new Uint8Array(1024 * 1024).fill(23)));
for (let i = 0; i < 12; i++) {
  const page = source.addPage([200 + i, 300]);
  page.drawImage(image, { x: 10, y: 20, width: 20, height: 20 });
  page.node.set(PDFName.of('PieceInfo'), source.context.obj({ Creator: { Private: privateData } }));
}
const before = await source.save();
const output = await PDFDocument.create();
for (const index of [11, 0, 5, 0]) {
  const [page] = await copyPdfPages(output, source, [index]);
  output.addPage(page);
}
assert.deepEqual(output.getPages().map(p => p.getWidth()), [211, 200, 205, 200]);
assert.ok(output.getPages().every(p => !p.node.has(PDFName.of('PieceInfo'))));
const streams = output.context.enumerateIndirectObjects().filter(([, v]) => v instanceof PDFRawStream);
assert.ok(streams.length < 10, 'image payload is copied once across separate calls');
const duplicate = output.getPage(3), originalCopy = output.getPage(1);
const originalContentSize = originalCopy.node.Contents().size();
duplicate.drawRectangle({ x: 10, y: 10, width: 10, height: 10 });
duplicate.setRotation(degrees(90));
assert.equal(originalCopy.node.Contents().size(), originalContentSize, 'editing duplicate cannot append to the first copy');
assert.equal(originalCopy.getRotation().angle, 0);
assert.ok((await output.save()).length < 20000, 'private authoring payload is absent');
assert.deepEqual(await source.save(), before, 'copy never mutates source');
const second = await PDFDocument.create();
second.addPage((await copyPdfPages(second, source, [0]))[0]);
assert.equal((await PDFDocument.load(await second.save())).getPageCount(), 1);
await assert.rejects(copyPdfPages(second, source, [-1]), /outside/);
await assert.rejects(copyPdfPages(second, source, [12]), /outside/);

const cleaned = [];
const pages = Array.from({ length: 5 }, (_, i) => ({ cleanup() { cleaned.push(i); } }));
const retention = createPdfPageRetention(2);
const a = retention.retain(pages[0]), overlap = retention.retain(pages[0]);
retention.retain(pages[1])();
retention.retain(pages[2])();
assert.deepEqual(cleaned, [1], 'active main/thumbnail lease is not evicted');
a(); a(); overlap();
retention.retain(pages[2])();
retention.retain(pages[3])();
assert.deepEqual(cleaned, [1, 0]);
const oldLease = retention.retain(pages[4]);
retention.clear();
const newLease = retention.retain(pages[4]);
oldLease();
retention.retain(pages[0])(); retention.retain(pages[1])();
assert.equal(cleaned.filter(i => i === 4).length, 1, 'late lease from cleared session cannot release a new one');
newLease(); retention.clear(); retention.clear();
const body = new Uint8Array([99, 0, 255, 128, 99]).subarray(1, 4);
assert.equal(await writeUniqueBinaryFile(async (command, data, options) => {
  assert.equal(command, 'write_unique_file_binary');
  assert.equal(data, body, 'no numeric array or base64 expansion of file body');
  assert.deepEqual([...data], [0, 255, 128]);
  assert.deepEqual(JSON.parse(Buffer.from(options.headers['x-toolknit-output'], 'base64').toString()),
    { directory: 'D:/测试目录', fileName: '结果.pdf' });
  return 'ok';
}, { directory: 'D:/测试目录', fileName: '结果.pdf', bytes: body }), 'ok');
assert.throws(() => writeUniqueBinaryFile(() => {}, { bytes: new Uint8Array() }), /empty/);
assert.throws(() => writeUniqueBinaryFile(() => {}, { bytes: [1, 2] }), /empty/);
assert.throws(() => writeUniqueBinaryFile(() => {}, { directory: 'a'.repeat(9000), fileName: 'x.pdf', bytes: body }), /too long/);
console.log('PDF shared copy: resource reuse, private data, duplicate edits, source integrity and bounded page leases passed');
