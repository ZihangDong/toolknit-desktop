import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const read = p => readFile(p, 'utf8');
const canonical = value => value.replace(/\r\n/g, '\n').trimEnd();
const license = canonical(await read('../LICENSE'));
assert.match(license, /^MIT License/);
// Standard MIT terms with ToolKnit copyright; only EOL/final whitespace is normalized.
const expectedHash = '1e4e478d3753164aa5c3da9f6c1f656265d9231b8755545e5735bbbe418711ae';
assert.equal(createHash('sha256').update(license).digest('hex'), expectedHash);
for (const file of ['LICENSE', 'cli/LICENSE']) assert.equal(canonical(await read(file)), license);
const apache = canonical(await read('../LICENSES/Apache-2.0.txt'));
assert.match(apache, /Apache License[\s\S]*Version 2\.0, January 2004/);
for (const file of ['LICENSES/Apache-2.0.txt', 'cli/LICENSES/Apache-2.0.txt']) assert.equal(canonical(await read(file)), apache);
for (const file of ['../NOTICE', 'NOTICE', 'cli/NOTICE']) {
  const text = await read(file);
  assert.match(text, /Required Notice: Copyright 2026 Zihang Dong/);
  assert.match(text, /Previously granted\s+Apache-2\.0 and other rights are not withdrawn/);
  assert.match(text, /Joshua-Zion PR #67/);
}
assert.equal(JSON.parse(await read('package.json')).license, 'MIT');
assert.equal(JSON.parse(await read('cli/package.json')).license, 'MIT');
assert.equal(JSON.parse(await read('package-lock.json')).packages[''].license, 'MIT');
assert.equal(JSON.parse(await read('cli/npm-shrinkwrap.json')).packages[''].license, 'MIT');
const cli = JSON.parse(await read('cli/package.json'));
assert.ok(cli.files.includes('NOTICE'));
assert.ok(cli.files.includes('LICENSES'));
const resources = JSON.parse(await read('src-tauri/tauri.conf.json')).bundle.resources;
for (const file of ['../LICENSE', '../NOTICE', '../LICENSES/Apache-2.0.txt', '../LICENSES/MIT.txt']) assert.ok(resources.includes(file));
for (const file of ['Download-FFmpeg-GPL-3.0.txt', 'Download-FFmpeg-6.1.1-README.txt', 'Download-FFmpeg-ToolKnit-README.txt', 'Download-FFmpeg-Third-Party.txt', 'Download-FFmpeg-Toolchain.txt', 'Download-Mozilla-MPL-2.0.txt', 'Download-Whisper-MIT.txt', 'Download-Models-Notice.txt']) {
  assert.ok(resources.includes(`../LICENSES/${file}`), `${file} must be bundled`);
  assert.ok((await read(`LICENSES/${file}`)).trim(), `${file} must not be empty`);
}
const modelNotices = await read('LICENSES/Download-Models-Notice.txt');
assert.match(modelNotices, /Xenova\/modnet[\s\S]*Apache-2\.0/);
assert.match(modelNotices, /ggerganov\/whisper\.cpp[\s\S]*MIT/);
assert.match(modelNotices, /https:\/\/github\.com\/ZihangDong\/toolknit-ffmpeg-sources/);
assert.match(modelNotices, /6\.1\.6-toolknit-r3[\s\S]*GNU GPL version 3 or later/);
assert.match(modelNotices, /ffmpeg-6\.1\.6-toolknit-3/);
assert.match(modelNotices, /Legacy Gyan 6\.1\.1[\s\S]*unresolved/);
const ffmpegNotice = await read('LICENSES/Download-FFmpeg-ToolKnit-README.txt');
assert.match(ffmpegNotice, /x264, x265, LAME, Ogg, Vorbis, Opus, libvpx, WebP/);
assert.match(ffmpegNotice, /zlib, dav1d and NVIDIA/);
assert.match(ffmpegNotice, /ffmpeg-6\.1\.6-toolknit-3/);
assert.match(await read('LICENSES/Download-FFmpeg-Third-Party.txt'), /NVIDIA[\s\S]*Permission is hereby granted/);
assert.match(await read('LICENSES/Download-FFmpeg-Toolchain.txt'), /GCC Runtime Library Exception/);
const cargo = await read('src-tauri/Cargo.toml');
assert.match(cargo, /^license = "MIT"$/m);
assert.doesNotMatch(cargo, /^license-file =/m);
for (const file of ['../NOTICE', 'NOTICE', 'cli/NOTICE']) {
  const notice = await read(file);
  assert.match(notice, /PDF-to-Word Engine/);
  assert.match(notice, /MIT/);
  assert.match(notice, /not a license condition/);
  assert.match(notice, /Third-party code/);
  assert.doesNotMatch(notice, /requires prior written authorization|excluded\s+from the general PolyForm grant/);
}
execFileSync(process.execPath, ['scripts/sync-pdf-word-license.mjs', '--check'], { stdio: 'pipe', windowsHide: true });
const engineLicense = await read('../LICENSES/MIT.txt');
for (const file of ['cli/LICENSES/MIT.txt', 'src/features/pdf-to-word/LICENSE.md', 'public/assets/licenses/pdf-word-engine.txt']) {
  assert.equal(canonical(await read(file)), canonical(engineLicense));
}
assert.equal(canonical(engineLicense),license);
assert.match(await read('src/features/color-space-compare/README.md'), /LICENSES\/Apache-2\.0\.txt/);
for (const file of ['../README.md', '../README_EN.md', 'src/legal-data.js']) {
  assert.match(await read(file), /MIT/);
  assert.doesNotMatch(await read(file), /commercial use requires separate permission|商业用途需另行授权/i);
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
  const lines = ['SPDX-License-Identifier: MIT',
    'Copyright 2026 Zihang Dong.',
    'Licensed under the MIT License; see LICENSE and NOTICE.'];
  const jsHeader = lines.map(line => `// ${line}`).join('\n') + '\n';
  const cssHeader = `/* ${lines.join('\n * ')}\n */\n`;
  const sourcePaths = ['src/features/pdf-to-word/sample.js', 'src-tauri/src/native_runtime/pdf/docx_write.rs', 'src-tauri/src/native_runtime/pdf/docx_fonts.rs', 'cli/lib/pdf-word-engine.mjs'];
  const licensePaths = ['../LICENSES/MIT.txt',
    'LICENSES/MIT.txt', 'src/features/pdf-to-word/LICENSE.md', 'public/assets/licenses/pdf-word-engine.txt'];
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
    await fixture(licensePaths[1], canonical(engineLicense).replace('Permission is hereby granted', 'Permission is hereby denied') + '\n');
    assert.notEqual(invoke('--check').status, 0, 'Changed license terms must still fail.');
  }
} finally {
  assert.equal(path.dirname(fixtureRoot), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixtureRoot).startsWith('toolknit-license-eol-'));
  await rm(fixtureRoot, { recursive: true, force: true });
}
console.log('License checkout regression passed: LF, CRLF, mixed copies, idempotent sync and rejected missing/changed notices.');
console.log('License contracts passed: MIT Engine/source grants, headers, metadata, optional backlinks, third-party and prior grants, and package inclusion.');
