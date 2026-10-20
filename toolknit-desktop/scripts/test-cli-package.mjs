import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = path.join(projectRoot, 'cli');
const readJson = async filePath => JSON.parse(await readFile(filePath, 'utf8'));

const [desktopPackage, cliPackage, cliLock] = await Promise.all([
  readJson(path.join(projectRoot, 'package.json')),
  readJson(path.join(cliRoot, 'package.json')),
  readJson(path.join(cliRoot, 'npm-shrinkwrap.json'))
]);
const [cliReadme, cliEntry, mcpServer] = await Promise.all([
  readFile(path.join(cliRoot, 'README.md'), 'utf8'),
  readFile(path.join(cliRoot, 'toolknit.mjs'), 'utf8'),
  readFile(path.join(cliRoot, 'lib', 'mcp-server.mjs'), 'utf8')
]);

// Run staging a second time so Windows replacement behavior stays covered.
execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'stage-cli-resources.cjs')], {
  cwd: projectRoot,
  stdio: 'pipe'
});

const { parseRefinement } = await import('../cli/lib/transcription-runtime.mjs');
assert.equal(parseRefinement('{"segments":[{"id":7,"text":"總有細碎的溫暖 English"}]}', new Set([7])).get(7), '总有细碎的温暖 English');
assert.throws(() => parseRefinement('{"segments":[]}', new Set([7])), /segment count/);
assert.throws(() => parseRefinement('{"segments":[{"id":7,"text":"A"},{"id":7,"text":"B"}]}', new Set([7, 8])), /subtitle IDs/);
const stagedChinese = await import('../cli/lib/core/core/chinese-text.js');
assert.equal(stagedChinese.simplifyChineseText('視頻終於開始 English'), '视频终于开始 English');
assert.equal(stagedChinese.simplifyTranscriptionJson({ file: '聲音.wav', text: '視頻' }).file, '聲音.wav');

assert.equal(cliPackage.version, desktopPackage.version, 'desktop and CLI release versions must match');
assert.equal(cliLock.version, cliPackage.version, 'CLI shrinkwrap version must match package.json');
assert.equal(cliPackage.repository?.directory, 'toolknit-desktop/cli', 'npm repository directory must resolve from the repository root');
assert.match(cliEntry, new RegExp(`const VERSION = '${cliPackage.version.replaceAll('.', '\\.')}';`));
assert.match(cliEntry, /async function runPdfCommand\(action, options, runtimeOptions = \{\}\)/, 'CLI pdf to-image must receive runtime options for progress and cancellation.');
assert.match(mcpServer, new RegExp(`version: '${cliPackage.version.replaceAll('.', '\\.')}'`));

assert.match(cliReadme, /toolknit pdf merge --input .* --input /);
assert.match(cliReadme, /toolknit video frame .*--timestamp-ms 3500 .*--output-dir/);
assert.match(cliReadme, /toolknit video gif .*--start-ms 2000 .*--end-ms 7000 .*--frame-rate 12/);
assert.match(cliReadme, /toolknit ai-doc create .*--output .*\.pdf/);
assert.match(cliReadme, /toolknit ai-table create .*--output .*\.xlsx/);
assert.doesNotMatch(cliReadme, /"DEEPSEEK_API_KEY"\s*:\s*"(?:你的|<)/, 'README must not provide a copyable placeholder key');

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('test:cli-package must be started through npm.');
const packOutput = execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: cliRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});
const pack = JSON.parse(packOutput)[0];
const packedFiles = new Set(pack.files.map(file => file.path));
for (const required of ['README.md', 'LICENSE', 'NOTICE', 'LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md', 'package.json', 'npm-shrinkwrap.json', 'toolknit.mjs']) {
  assert.equal(packedFiles.has(required), true, `published CLI package must include ${required}`);
}
for (const required of ['lib/core/core/chinese-text.js', 'lib/core/core/opencc/t2s.json', 'lib/core/core/opencc/LICENSE.txt', 'lib/core/core/opencc/NOTICE.txt']) {
  assert.ok(packedFiles.has(required), `Chinese normalization and its license must ship together: ${required}`);
}
for (const required of ['lib/core/pdf-document-structure.js', 'lib/ppt-image-extract-runtime.mjs', 'lib/core/ppt-image-extract-core.js', 'lib/ppt-text-extract-runtime.mjs', 'lib/core/ppt-text-extract-core.js', 'lib/ppt-compress-runtime.mjs', 'lib/core/ppt-compress-core.js', 'lib/ppt-render-runtime.mjs', 'lib/core/ppt-render-core.js', 'lib/ppt-to-pdf-runtime.mjs', 'lib/ppt-to-image-runtime.mjs', 'lib/ppt-outline-runtime.mjs', 'lib/core/ppt-outline-core.js', 'lib/ppt-draft-runtime.mjs', 'lib/core/ppt-draft-core.js']) {
  assert.equal(packedFiles.has(required), true, `published CLI package must include ${required}`);
}
assert.equal(pack.version, cliPackage.version);
for (const required of ['lib/core/core/pdf-compression.js', 'lib/core/core/pdf-raster-candidate.js', 'lib/pdf-compress-worker.mjs', 'lib/pdf-compress-raster-runtime.mjs']) {
  assert.ok(packedFiles.has(required), `shared PDF compression runtime must be packaged: ${required}`);
}
assert.ok(pack.size < 30 * 1024 * 1024, `packed CLI must remain below 30 MiB, got ${pack.size}`);

console.log(`CLI package contract passed: ${pack.files.length} files, ${pack.size} packed bytes.`);
