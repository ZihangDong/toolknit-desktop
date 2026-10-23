import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listSourceFiles } from './lib/source-inventory.mjs';

const project = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm.');
const run = (command, args, cwd, inherit = false) => execFileSync(command, args, {
  cwd, encoding: 'utf8', windowsHide: true, timeout: 300000,
  stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 20 * 1024 * 1024
});
function audit(cwd) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return JSON.parse(run(process.execPath, [npmCli, 'audit', '--json', '--registry=https://registry.npmjs.org'], cwd)); }
    catch (error) {
      let response;
      try { response = JSON.parse(error.stdout); } catch { /* A connection can fail before JSON is returned. */ }
      if (response?.metadata || attempt === 2 || !/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed/.test(String(error.stdout) + String(error.stderr))) throw error;
      console.log(`Official audit endpoint disconnected; retry ${attempt + 2}/3.`);
    }
  }
}
// Use a directory outside the checkout so Node cannot resolve missing packages
// through an ancestor node_modules left by an earlier development session.
const temporary = await mkdtemp(path.join(tmpdir(), 'toolknit-desktop-clean-'));
const snapshot = path.join(temporary, 'source', 'toolknit-desktop');
try {
  const repository = run('git', ['rev-parse', '--show-toplevel'], project).trim();
  const prefix = path.relative(repository, project).replaceAll('\\', '/') + '/';
  const files = listSourceFiles(repository).filter(file => file.startsWith(prefix));
  for (const file of files) {
    const destination = path.join(temporary, 'source', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(repository, file), destination);
  }
  assert.equal(await stat(path.join(snapshot, 'node_modules')).then(() => true, () => false), false);
  const originalLock = await readFile(path.join(snapshot, 'package-lock.json'));
  run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], snapshot, true);
  assert.deepEqual(await readFile(path.join(snapshot, 'package-lock.json')), originalLock, 'Clean installation must not rewrite the lockfile.');
  for (const check of ['test:dependency-lock', 'test:markdown-editor', 'test:pdf-split', 'build']) {
    run(process.execPath, [npmCli, 'run', check], snapshot, true);
  }
  const auditResult = audit(snapshot);
  assert.equal(auditResult.metadata.vulnerabilities.total, 0);
  if (process.argv.includes('--browser')) {
    for (const script of ['test-markdown-diagrams-browser.mjs', 'test-pdf-split-workbench-browser.mjs']) {
      run(process.execPath, [path.join(snapshot, 'scripts', script)], snapshot, true);
    }
  }
  console.log(`Clean desktop install passed: ${files.length} current source files, npm ci, exact dependency files, Markdown/PDF checks, production frontend build and official dependency audit.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
