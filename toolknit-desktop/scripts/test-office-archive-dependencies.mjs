import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Optional argument tests the tree installed by an npm consumer.
const target = path.resolve(process.argv[2] || '.');
const require = createRequire(path.join(target, 'package.json'));
const excelPath = require.resolve('exceljs');
const officeRequire = createRequire(excelPath);
const ExcelJS = officeRequire(excelPath);
const glob = officeRequire('glob');
const archiver = officeRequire('archiver');
const JSZip = officeRequire('jszip');
for (const name of ['glob', 'readdir-glob']) {
  const caller = createRequire(officeRequire.resolve(name));
  assert.equal(caller('minimatch/package.json').version, '11.0.3');
}
const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-archive-qa-'));
try {
  await mkdir(path.join(root, 'nested'));
  for (const file of ['a.txt', '.secret.txt', 'nested/中文 b.txt', 'nested/skip.bin']) {
    await writeFile(path.join(root, file), file);
  }
  const expected = ['a.txt', 'nested/中文 b.txt'];
  assert.deepEqual(glob.sync('**/*.txt', { cwd: root }).sort(), expected);
  assert.deepEqual(await new Promise((resolve, reject) => glob('**/*.txt', { cwd: root }, (error, files) => error ? reject(error) : resolve(files.sort()))), expected);
  assert.deepEqual(glob.sync('**/*.txt', { cwd: root, ignore: ['nested/**'], dot: true }).sort(), ['.secret.txt', 'a.txt']);
  const archive = archiver('zip');
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('error', reject); archive.on('end', resolve);
  });
  archive.glob('**/*.txt', { cwd: root, ignore: ['nested/**'], dot: true });
  await archive.finalize(); await done;
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  assert.deepEqual(Object.keys(zip.files).sort(), ['.secret.txt', 'a.txt']);
  const book = new ExcelJS.Workbook();
  book.addWorksheet('数据').addRow(['Chinese 中文', 17, { formula: 'B1*2', result: 34 }]);
  const bytes = await book.xlsx.writeBuffer();
  const roundTrip = new ExcelJS.Workbook(); await roundTrip.xlsx.load(bytes);
  assert.equal(roundTrip.getWorksheet('数据').getCell('A1').value, 'Chinese 中文');
  assert.equal(roundTrip.getWorksheet('数据').getCell('C1').value.result, 34);
  console.log('Audited Office archive dependencies: glob sync/callback, ignored paths, dotfiles, Unicode ZIP and Excel round-trip passed.');
} finally { await rm(root, { recursive: true, force: true }); }
