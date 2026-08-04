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

assert.equal(cliPackage.version, desktopPackage.version, 'desktop and CLI release versions must match');
assert.equal(cliLock.version, cliPackage.version, 'CLI shrinkwrap version must match package.json');
assert.equal(cliPackage.repository?.directory, 'toolknit-desktop/cli', 'npm repository directory must resolve from the repository root');
assert.match(cliEntry, new RegExp(`const VERSION = '${cliPackage.version.replaceAll('.', '\\.')}';`));
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
for (const required of ['README.md', 'LICENSE', 'package.json', 'npm-shrinkwrap.json', 'toolknit.mjs']) {
  assert.equal(packedFiles.has(required), true, `published CLI package must include ${required}`);
}
assert.equal(pack.version, cliPackage.version);
assert.ok(pack.size < 30 * 1024 * 1024, `packed CLI must remain below 30 MiB, got ${pack.size}`);

console.log(`CLI package contract passed: ${pack.files.length} files, ${pack.size} packed bytes.`);
