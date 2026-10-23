import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const identifier = 'LicenseRef-ToolKnit-PDF-Word-Source-View-1.0';
const licenseName = 'ToolKnit-PDF-Word-Source-View-1.0.md';
const license = await readFile(path.join(root, '..', 'LICENSES', licenseName), 'utf8');
const check = process.argv.includes('--check');
const sourceFiles = [];
async function visit(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await visit(relative);
    else if (/\.(?:js|css)$/.test(entry.name)) sourceFiles.push(relative);
  }
}
await visit('src/features/pdf-to-word');
sourceFiles.push('src-tauri/src/native_runtime/pdf/docx_write.rs');
sourceFiles.push('cli/lib/pdf-word-engine.mjs');
for (const file of sourceFiles) {
  const target = path.join(root, file), original = await readFile(target, 'utf8');
  const lines = [`SPDX-License-Identifier: ${identifier}`, 'Copyright 2026 Zihang Dong.',
    'Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com'];
  const header = file.endsWith('.css') ? `/* ${lines.join('\n * ')}\n */\n` : `${lines.map(line => `// ${line}`).join('\n')}\n`;
  if (check) assert(original.startsWith(header), `Engine license header missing: ${file}`);
  else if (!original.startsWith(header)) {
    assert(!original.includes('SPDX-License-Identifier:'), `Review existing license before changing ${file}`);
    await writeFile(target, header + original);
  }
}
for (const file of [`LICENSES/${licenseName}`, 'src/features/pdf-to-word/LICENSE.md', 'public/assets/licenses/pdf-word-engine.txt']) {
  const target = path.join(root, file);
  if (check) assert.equal(await readFile(target, 'utf8'), license, `Engine license copy differs: ${file}`);
  else await writeFile(target, license);
}
console.log(`PDF Word license ${check ? 'verified' : 'synchronized'}: ${sourceFiles.length} source headers and 3 copies.`);
