import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml',
  '--locked', '--filter-platform', 'x86_64-pc-windows-msvc', '--format-version', '1'],
{ cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }));
const application = metadata.packages.find(item => item.id === metadata.resolve.root);
assert.ok(application?.rust_version, 'The desktop package must declare a Rust minimum.');
const tuple = version => {
  assert.match(version, /^\d+\.\d+(?:\.\d+)?$/, 'Use stable Rust version requirements.');
  const parts = version.split('.').map(Number);
  return [parts[0], parts[1], parts[2] || 0];
};
const minimum = tuple(application.rust_version);
const newer = version => {
  const parts = tuple(version);
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return false;
};
const resolved = new Set(metadata.resolve.nodes.map(node => node.id));
const incompatible = metadata.packages.filter(item => resolved.has(item.id) && item.rust_version && newer(item.rust_version));
assert.deepEqual(incompatible.map(item => `${item.name} ${item.version}: Rust ${item.rust_version}`), [],
  'The declared compiler must meet all resolved Windows dependency minimums.');
for (const file of ['README.md', 'README_EN.md']) {
  const text = await readFile(path.join(root, '..', file), 'utf8');
  assert.ok(text.includes(`Rust stable **${application.rust_version}+**`), `${file}: compiler guidance matches Cargo metadata`);
}
console.log(`Rust ${application.rust_version} minimum covers the locked Windows dependency graph and bilingual build guidance.`);
