import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

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
assert.equal(canonical(await read('cli/LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md')), canonical(engineLicense),
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

// Git's Windows checkout changes line endings, never license ownership or text.
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'toolknit-license-eol-'));
try {
  const project = path.join(fixtureRoot, 'desktop');
  const fixture = async (file, text) => {
    const target = path.join(project, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  };
  await mkdir(path.join(project, 'scripts'), { recursive: true });
  await copyFile('scripts/sync-pdf-word-license.mjs', path.join(project, 'scripts/sync-pdf-word-license.mjs'));
  const lines = ['SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0',
    'Copyright 2026 Zihang Dong.',
    'Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com'];
  const jsHeader = lines.map(line => `// ${line}`).join('\n') + '\n';
  const cssHeader = `/* ${lines.join('\n * ')}\n */\n`;
  const sourcePaths = ['src/features/pdf-to-word/sample.js', 'src-tauri/src/native_runtime/pdf/docx_write.rs', 'cli/lib/pdf-word-engine.mjs'];
  const licensePaths = ['../LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md',
    'LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md', 'src/features/pdf-to-word/LICENSE.md', 'public/assets/licenses/pdf-word-engine.txt'];
  const invoke = (...args) => spawnSync(process.execPath, ['scripts/sync-pdf-word-license.mjs', ...args],
    { cwd: project, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  for (const eol of ['\n', '\r\n']) {
    for (const file of sourcePaths) await fixture(file, (jsHeader + '// unchanged body\n').replaceAll('\n', eol));
    await fixture('src/features/pdf-to-word/sample.css', (cssHeader + '.sample {}\n').replaceAll('\n', eol));
    for (const [index, file] of licensePaths.entries()) await fixture(file,
      (canonical(engineLicense) + '\n').replaceAll('\n', index % 2 ? '\r\n' : '\n'));
    const checked = invoke('--check');
    assert.equal(checked.status, 0, checked.stderr);
    const before = await readFile(path.join(project, sourcePaths[0]));
    const synced = invoke();
    assert.equal(synced.status, 0, synced.stderr);
    assert.deepEqual(await readFile(path.join(project, sourcePaths[0])), before, 'Sync must preserve a valid source header byte-for-byte.');
    await fixture(sourcePaths[0], '// header removed\n');
    assert.notEqual(invoke('--check').status, 0, 'Missing headers must still fail.');
    await fixture(sourcePaths[0], jsHeader.replace('Copyright 2026 Zihang Dong.', 'Copyright changed.') + '// body\n');
    assert.notEqual(invoke('--check').status, 0, 'Changed copyright must still fail.');
    assert.notEqual(invoke().status, 0, 'Sync must not replace an existing different SPDX header.');
    await fixture(sourcePaths[0], jsHeader);
    await fixture(licensePaths[1], canonical(engineLicense).replace('info@toolknit.com', 'changed@example.invalid') + '\n');
    assert.notEqual(invoke('--check').status, 0, 'Changed license terms must still fail.');
  }
} finally {
  assert.equal(path.dirname(fixtureRoot), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixtureRoot).startsWith('toolknit-license-eol-'));
  await rm(fixtureRoot, { recursive: true, force: true });
}
console.log('License checkout regression passed: LF, CRLF, mixed copies, idempotent sync and rejected missing/changed notices.');
console.log('License contracts passed: scoped Engine terms, source headers, metadata, official-app exception, third-party and prior grants, and package inclusion.');
