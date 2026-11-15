// glob 7 is retained by ExcelJS's archive tree. minimatch 11 fixes
// GHSA-g3hv-75wg-m249 but represents a compiled segment as Matcher.pattern
// instead of RegExp._glob. Preserve the caller's sync/callback API with this
// narrowly checked compatibility correction; never change the matcher itself.
const { createRequire } = require('node:module');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const resolve = createRequire(path.join(root, 'package.json'));
const globManifest = resolve.resolve('glob/package.json', { paths: [path.dirname(resolve.resolve('exceljs'))] });
if (JSON.parse(readFileSync(globManifest, 'utf8')).version !== '7.2.3') throw new Error('Review glob compatibility for the new version.');
const caller = createRequire(globManifest);
if (caller('minimatch/package.json').version !== '11.0.3') throw new Error('Expected the audited minimatch 11.0.3.');
for (const name of ['glob.js', 'sync.js']) {
  const file = path.join(path.dirname(globManifest), name);
  let source = readFileSync(file, 'utf8');
  const previous = 'var rawGlob = pn._glob';
  const patched = 'var rawGlob = pn._glob || pn.pattern // ToolKnit: minimatch 11 Matcher metadata';
  if (!source.includes(patched)) {
    if (source.split(previous).length !== 2) throw new Error('Unexpected glob source; compatibility correction aborted.');
    source = source.replace(previous, patched);
  }
  // Matcher exposes test(), without RegExp's Symbol.match coercion.
  if (!source.includes('pn.test(e)')) {
    if (source.split('e.match(pn)').length !== 3) throw new Error('Unexpected glob segment matching source.');
    source = source.replaceAll('e.match(pn)', 'pn.test(e)');
  }
  writeFileSync(file, source);
}
console.log('Applied glob 7 / minimatch 11 compatibility correction.');
