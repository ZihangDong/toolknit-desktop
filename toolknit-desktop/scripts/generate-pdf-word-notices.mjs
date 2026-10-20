import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const seen = new Set(), entries = [];
async function visit(name, parent) {
  if (name.startsWith('@types/') || name === 'undici-types') return;
  const require = createRequire(path.join(parent, 'package.json'));
  let entry;
  try { entry = require.resolve(`${name}/package.json`); } catch { entry = require.resolve(name); }
  if (!path.isAbsolute(entry)) throw new Error(`Could not locate the npm package ${name}`);
  let folder = path.dirname(entry);
  while (folder !== path.dirname(folder)) {
    try { const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')); if (pkg.name === name) break; } catch {}
    folder = path.dirname(folder);
  }
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const id = `${pkg.name}@${pkg.version}`; if (seen.has(id)) return; seen.add(id);
  const candidates = (await readdir(folder)).filter(file => /^(license|licence|copying)(\.|$)/i.test(file));
  let text = '';
  if (!candidates.length) {
    const readme = (await readdir(folder)).find(file => /^readme\.md$/i.test(file));
    const source = readme ? await readFile(path.join(folder, readme), 'utf8') : '';
    const start = source.search(/^#{1,6}\s+licen[sc]e\s*$/im);
    if (start < 0) throw new Error(`Missing license for ${id}`);
    text = source.slice(start);
  }
  for (const file of candidates) text += `\n${file}\n${await readFile(path.join(folder, file), 'utf8')}\n`;
  if (name === 'jszip') text = `Selected license: MIT (the package offers MIT OR GPL).\n${text}`;
  entries.push({ id, license: pkg.license, text });
  for (const dependency of Object.keys(pkg.dependencies || {})) await visit(dependency, folder);
}
await visit('docx', root); await visit('pdfjs-dist', root); await visit('@pdf-lib/fontkit', root);
entries.push({ id: 'quick-xml@0.41.0 (native DOCX validation)', license: 'MIT', text: await readFile(path.join(root, 'LICENSES/quick-xml-MIT.txt'), 'utf8') });
const assets = path.join(root, 'node_modules/pdfjs-dist');
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const file of (await readdir(path.join(assets, directory))).filter(file => /LICENSE|NOTICE/i.test(file))) {
    entries.push({ id: `pdfjs-dist/${directory}/${file}`, license: 'See full text', text: await readFile(path.join(assets, directory, file), 'utf8') });
  }
}
const text = ['ToolKnit PDF to Word third-party notices', '', 'Generated from pinned installed packages. Third-party terms remain unchanged.',
  'Research-only pdf2docx and PyMuPDF packages are not product dependencies.', '',
  ...entries.sort((a, b) => a.id.localeCompare(b.id)).map(entry => `${entry.id}\nDeclared license: ${entry.license}\n${entry.text}\n`)]
  .join('\n').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
const output = path.join(root, 'public/assets/licenses/pdf-word-dependencies.txt');
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('PDF to Word notices need regeneration.');
} else { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, text); }
console.log(`PDF to Word notices: ${entries.length} package/resource entries.`);
