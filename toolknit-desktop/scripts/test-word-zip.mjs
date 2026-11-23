import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Document, Paragraph, Packer } from 'docx';
import { inspectWordZip, prepareWordBatchInputs, safeWordZipName } from '../cli/lib/word-zip.mjs';
import { addWordArchive, addWordFiles, wordZipIdentity } from '../src/features/word-to-pdf/core.js';

// Deliberately independent ZIP writer so unsafe names and corrupt metadata are
// preserved for both the Node and Rust readers to test against the same bytes.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name), data = Buffer.from(item.data || ''), method = item.method ?? 8;
    const packed = method === 0 ? data : deflateRawSync(data), flags = 0x800 | (item.flags || 0);
    const checksum = item.badCrc ? crc32(data) ^ 1 : crc32(data), size = item.size ?? data.length;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6); head.writeUInt16LE(method, 8); head.writeUInt32LE(checksum >>> 0, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6); directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(checksum >>> 0, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((item.unixMode ?? 0o100600) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42); local.push(head, name, packed); central.push(directory, name);
    offset += head.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const root = path.resolve('tmp/word-zip'); await mkdir(root, { recursive: true });
const document = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('ZIP_WORD_BODY 中文合同 2026-11-20')] }] }));
const validEntries = [{ name: '合同/同名.docx', data: document }, { name: '副本/同名.docx', data: document },
  { name: '损坏.docx', data: 'broken Word document' }, { name: 'readme.txt', data: 'ignored' }, { name: 'nested.zip', data: 'ignored' }];
const cases = [
  ['valid.zip', validEntries, true],
  ['traversal.zip', [{ name: '../escape.docx' }], false],
  ['backslash.zip', [{ name: 'folder\\a.docx' }], false],
  ['absolute.zip', [{ name: '/escape.docx' }], false],
  ['drive.zip', [{ name: 'C:/escape.docx' }], false],
  ['device.zip', [{ name: 'folder/CON.docx' }], false],
  ['trailing.zip', [{ name: 'folder./a.docx' }], false],
  ['duplicate.zip', [{ name: 'A.docx' }, { name: 'a.docx' }], false],
  ['same-name.zip', [{ name: 'a.docx' }, { name: 'a.docx' }], false],
  ['symlink.zip', [{ name: 'link.docx', unixMode: 0o120777 }], false],
  ['encrypted.zip', [{ name: 'a.docx', flags: 1 }], false],
  ['unsupported.zip', [{ name: 'a.docx', method: 99 }], false],
  ['oversize.zip', [{ name: 'a.docx', size: 50 * 1024 * 1024 + 1 }], false],
  ['expanded.zip', Array.from({ length: 5 }, (_, i) => ({ name: `${i}.docx`, size: 45 * 1024 * 1024 })), false],
  ['many-documents.zip', Array.from({ length: 21 }, (_, i) => ({ name: `${i}.docx` })), false],
  ['many-entries.zip', Array.from({ length: 1001 }, (_, i) => ({ name: `${i}.txt` })), false],
  ['empty.zip', [{ name: 'nested.zip' }], false],
  ['bad-crc.zip', [{ name: 'bad.docx', data: 'corrupt crc', badCrc: true }], true, true],
  ['bad-size.zip', [{ name: 'bad.docx', data: 'expanded'.repeat(5000), size: 1 }], true, true],
];
const manifest = [], checks = [];
for (const [file, entries, accepted, readInvalid] of cases) {
  const bytes = zip(entries); await writeFile(path.join(root, file), bytes);
  if (accepted) { const info = await inspectWordZip(bytes); info.zip.close(); }
  else await assert.rejects(inspectWordZip(bytes), error => /word-render:/.test(error.message));
  manifest.push({ file, accepted, readInvalid: Boolean(readInvalid) }); checks.push(`manifest ${file}`);
}
await writeFile(path.join(root, 'cases.json'), JSON.stringify(manifest, null, 2));
for (const file of ['bad-crc.zip', 'bad-size.zip']) {
  const result = await prepareWordBatchInputs([path.join(root, file)]);
  try { assert.ok(result.sources[0].prepareError); checks.push(`bounded extraction ${file}`); } finally { await result.dispose(); }
}
const prepared = await prepareWordBatchInputs([path.join(root, 'valid.zip'), path.join(root, 'valid.zip')]);
let staged;
try {
  assert.equal(prepared.sources.length, 3); assert.equal(prepared.skipped, 2);
  staged = prepared.sources[0].path;
  assert.deepEqual(await readFile(staged), document);
  assert.equal(prepared.sources[0].archiveEntry, '合同/同名.docx');
  assert.equal(prepared.sources[1].sourceName, '同名.docx'); checks.push('archive origin, ignored entries, flat staging and source de-duplication');
} finally { await prepared.dispose(); }
await assert.rejects(access(staged)); checks.push('temporary documents removed after disposal');
const capacity = await prepareWordBatchInputs([...Array.from({ length: 19 }, (_, i) => path.join(root, `${i}.docx`)), path.join(root, 'valid.zip')]);
try { assert.equal(capacity.sources.length, 20); assert.equal(capacity.sources.at(-1).prepareError, 'invalid-file-count'); checks.push('expanded document count checked before extracting an archive'); }
finally { await capacity.dispose(); }
const partial = await prepareWordBatchInputs([path.join(root, 'traversal.zip'), path.join(root, 'valid.zip')]);
try { assert.equal(partial.sources.length, 4); assert.equal(partial.sources[0].prepareError, 'invalid-archive'); checks.push('bad archive does not discard valid archive documents'); }
finally { await partial.dispose(); }
await assert.rejects(prepareWordBatchInputs([path.join(root, 'valid.zip')], { signal: AbortSignal.abort() }), error => error.code === 'CANCELLED'); checks.push('pre-dispatch cancellation');
const archiveManifest = { archivePath: 'C:/输入/资料.zip', archiveHash: 'a'.repeat(64), entries: [{ entryName: '合同/同名.docx', size: document.length }, { entryName: '副本/同名.docx', size: document.length }] };
const rows = addWordArchive(addWordFiles([], ['C:/direct.doc']), archiveManifest);
assert.equal(addWordArchive(rows, archiveManifest).length, 3);
assert.equal(rows[1].path, wordZipIdentity(archiveManifest.archivePath, archiveManifest.entries[0].entryName));
assert.equal(rows[1].origin, '资料.zip / 合同/同名.docx'); checks.push('desktop stable entry identity and repeated archive de-duplication');
assert.throws(() => addWordArchive(addWordFiles([], Array.from({ length: 19 }, (_, i) => `C:/${i}.docx`)), archiveManifest)); checks.push('combined queue limit is atomic');
for (const name of ['../a.docx', '/a.docx', 'C:/a.docx', 'a\\b.docx', 'a/./b.docx', 'a//b.docx', 'AUX.doc', 'a /b.doc']) assert.equal(safeWordZipName(name), false);
assert.equal(safeWordZipName('中文/合同 v1.docx'), true); checks.push('portable archive path checks');
await writeFile(path.join(root, 'core-report.json'), JSON.stringify({ checks, fixtures: manifest.length }, null, 2));
console.log(`Word ZIP: ${checks.length} checks passed; ${manifest.length} cross-runtime ZIP fixtures created.`);
