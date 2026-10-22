import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const read = p => readFile(p, 'utf8');
const canonical = value => value.replace(/\r\n/g, '\n').trimEnd();
const license = canonical(await read('../LICENSE'));
assert.match(license, /^# PolyForm Noncommercial License 1\.0\.0/);
// Official polyformproject.org text, with only line endings / final whitespace normalized.
const expectedHash = '7779a554c40798f0f9c04960b82154d16dc0fa64349d401d24146e5c81f64093';
assert.equal(createHash('sha256').update(license).digest('hex'), expectedHash);
for (const file of ['LICENSE', 'cli/LICENSE']) assert.equal(canonical(await read(file)), license);
const apache = canonical(await read('../LICENSES/Apache-2.0.txt'));
assert.match(apache, /Apache License[\s\S]*Version 2\.0, January 2004/);
for (const file of ['LICENSES/Apache-2.0.txt', 'cli/LICENSES/Apache-2.0.txt']) assert.equal(canonical(await read(file)), apache);
for (const file of ['../NOTICE', 'NOTICE', 'cli/NOTICE']) {
  const text = await read(file);
  assert.match(text, /Required Notice: Copyright 2026 Zihang Dong/);
  assert.match(text, /Previously granted Apache-2\.0 rights are not withdrawn/);
  assert.match(text, /Joshua-Zion PR #67/);
}
assert.equal(JSON.parse(await read('package.json')).license, 'SEE LICENSE IN NOTICE');
assert.equal(JSON.parse(await read('cli/package.json')).license, 'SEE LICENSE IN NOTICE');
assert.equal(JSON.parse(await read('package-lock.json')).packages[''].license, 'SEE LICENSE IN NOTICE');
assert.equal(JSON.parse(await read('cli/npm-shrinkwrap.json')).packages[''].license, 'SEE LICENSE IN NOTICE');
const cli = JSON.parse(await read('cli/package.json'));
assert.ok(cli.files.includes('NOTICE'));
assert.ok(cli.files.includes('LICENSES'));
const resources = JSON.parse(await read('src-tauri/tauri.conf.json')).bundle.resources;
for (const file of ['../LICENSE', '../NOTICE', '../LICENSES/Apache-2.0.txt', '../LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md']) assert.ok(resources.includes(file));
const cargo = await read('src-tauri/Cargo.toml');
assert.match(cargo, /^license-file = "\.\.\/NOTICE"$/m);
assert.doesNotMatch(cargo, /^license =/m);
for (const file of ['../NOTICE', 'NOTICE']) {
  const notice = await read(file);
  assert.match(notice, /excluded\s+from the general PolyForm grant/);
  assert.match(notice, /commercial\s+AND noncommercial use requires prior written authorization: info@toolknit\.com/);
  assert.match(notice, /src\/features\/pdf-to-word\/\*\*/);
  assert.match(notice, /src-tauri\/src\/native_runtime\/pdf\/docx_write\.rs/);
}
execFileSync(process.execPath, ['scripts/sync-pdf-word-license.mjs', '--check'], { stdio: 'pipe', windowsHide: true });
const engineLicense = await read('../LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md');
assert.equal(await read('cli/LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md'), engineLicense,
  'CLI NOTICE references the scoped exception, so its complete text must accompany the notice');
assert.match(engineLicense, /Official application use/);
assert.match(engineLicense, /commercial and noncommercial purposes/);
assert.match(engineLicense, /info@toolknit\.com/);
assert.match(engineLicense, /previously granted under Apache-2\.0, PolyForm/);
assert.match(await read('src/features/color-space-compare/README.md'), /LICENSES\/Apache-2\.0\.txt/);
for (const file of ['../README.md', '../README_EN.md', 'src/legal-data.js']) {
  assert.match(await read(file), /PolyForm Noncommercial 1\.0\.0/);
  assert.match(await read(file), /info@toolknit\.com/);
}
console.log('License contracts passed: scoped Engine terms, source headers, metadata, official-app exception, third-party and prior grants, and package inclusion.');
