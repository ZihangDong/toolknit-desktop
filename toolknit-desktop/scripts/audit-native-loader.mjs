import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Inspect the actual executable: source flags alone cannot prove a native
// dependency was linked statically. Run after the Windows production build.
const file = process.argv[2] || 'src-tauri/target/release/toolknit-desktop.exe';
const bytes = await readFile(file);
const u16 = at => { assert.ok(at >= 0 && at + 2 <= bytes.length, 'Truncated PE'); return bytes.readUInt16LE(at); };
const u32 = at => { assert.ok(at >= 0 && at + 4 <= bytes.length, 'Truncated PE'); return bytes.readUInt32LE(at); };
assert.equal(u16(0), 0x5a4d, 'Expected a Windows executable');
const pe = u32(60); assert.equal(u32(pe), 0x4550, 'Invalid PE signature');
const sectionCount = u16(pe + 6), optionalSize = u16(pe + 20), optional = pe + 24;
assert.ok(sectionCount > 0 && sectionCount <= 96, 'Invalid section count');
const magic = u16(optional); assert.ok([0x20b, 0x10b].includes(magic));
const directories = optional + (magic === 0x20b ? 112 : 96);
const sections = Array.from({ length: sectionCount }, (_, i) => {
  const at = optional + optionalSize + i * 40;
  return { size: Math.max(u32(at + 8), u32(at + 16)), virtual: u32(at + 12), raw: u32(at + 20) };
});
const offset = rva => {
  const section = sections.find(s => rva >= s.virtual && rva - s.virtual < s.size);
  assert.ok(section, 'PE address is outside its sections');
  const at = section.raw + rva - section.virtual; assert.ok(at < bytes.length, 'PE address is outside the file'); return at;
};
const name = rva => {
  const at = offset(rva), end = bytes.indexOf(0, at);
  assert.ok(end > at && end - at <= 260, 'Invalid import name');
  return bytes.subarray(at, end).toString('ascii').toLowerCase();
};
const imports = new Set();
for (const [directory, stride, nameField] of [[1, 20, 12], [13, 32, 4]]) {
  const rva = u32(directories + directory * 8); if (!rva) continue;
  let at = offset(rva), ended = false;
  for (let i = 0; i < 4096; i++, at += stride) {
    assert.ok(at + stride <= bytes.length, 'Truncated import directory');
    if (bytes.subarray(at, at + stride).every(b => b === 0)) { ended = true; break; }
    if (directory === 13) assert.equal(u32(at) & 1, 1, 'Only RVA delay imports are supported');
    imports.add(name(u32(at + nameField)));
  }
  assert.ok(ended, 'Unterminated import directory');
}
const unexpected = [...imports].filter(name => /^(?:msvcp\d|vcruntime\d|qt\d|everything|winshun|toolknit_(?:filename|ntfs))/.test(name));
assert.deepEqual(unexpected, [], 'Search must not introduce an external C++/Qt/Everything loader requirement');
console.log(`Native loader audit passed: ${path.basename(file)}, ${imports.size} imports, no external search/C++ runtime dependency.`);
