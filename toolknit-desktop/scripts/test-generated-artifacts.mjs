import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const repository = path.dirname(desktop.replace(/[\\/]$/, ''));
const generated = ['.github-outreach/local/submission.json',
  'toolknit-desktop/cli/resources/office/word-to-pdf.py'];
const source = ['toolknit-desktop/src-tauri/resources/office/word-to-pdf.py',
  'toolknit-desktop/cli/lib/word-runtime.mjs'];
for (const file of [...generated, ...source]) {
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', file],
      { cwd: repository, stdio: 'pipe', windowsHide: true });
    ignored = true;
  } catch (error) { if (error.status !== 1) throw error; }
  assert.equal(ignored, generated.includes(file), file);
}

const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' },
  path.join(desktop, 'vite.config.js'));
assert.ok(loaded?.config.server.watch.ignored.length);
const scratch = await mkdtemp(path.join(tmpdir(), 'toolknit-generated-watch-'));
let server;
try {
  const paths = ['src/features/example.js', 'tmp/convert/result.tmp', 'output/result.pdf',
    '.cache/task.json', '.codex-build/build.json', 'cli/resources/office/word-to-pdf.py',
    'cli/lib/core/example.js', 'cli/lib/shared/example.js'];
  for (const file of paths) {
    await mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
    await writeFile(path.join(scratch, file), 'export const value = 1;');
  }
  server = await createServer({ configFile: false, root: scratch, publicDir: false,
    logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: {
      ...loaded.config.server.watch,
      ignored: loaded.config.server.watch.ignored.map(pattern =>
        pattern.replace(desktop.replaceAll('\\', '/'), scratch.replaceAll('\\', '/') + '/')),
    } } });
  if (!server.watcher._readyEmitted) await new Promise(resolve => server.watcher.once('ready', resolve));
  await server.transformRequest('/src/features/example.js');
  const subscriptions = () => new Set(Object.entries(server.watcher.getWatched())
    .flatMap(([directory, names]) => names.map(name => path.resolve(directory, name))));
  for (let attempt = 0; attempt < 50 && !subscriptions().has(path.resolve(scratch, paths[0])); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const watched = subscriptions();
  for (const [index, file] of paths.entries()) {
    assert.equal(watched.has(path.resolve(scratch, file)), index === 0,
      'source must be watched and generated files must stay outside the watcher: ' + file);
  }
} finally {
  await server?.close();
  assert.equal(path.dirname(scratch), path.resolve(tmpdir()));
  await rm(scratch, { recursive: true, force: true });
}
console.log('Generated artifact isolation passed: Git policy, actual watcher subscriptions and ignored outputs.');
