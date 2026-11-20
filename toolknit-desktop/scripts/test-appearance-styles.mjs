import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import postcss from 'postcss';

const directory = new URL('../src/', import.meta.url);
const files = await readdir(directory, { recursive: true });
const styles = files.filter(file => file.endsWith('.css'));
assert.equal(styles.filter(file => file.endsWith('-light.css')).length, 0, 'components own one stylesheet for every appearance');
for (const file of styles) {
  const source = await readFile(new URL(file.replaceAll('\\', '/'), directory), 'utf8');
  const tree = postcss.parse(source);
  tree.walkRules(rule => {
    assert.doesNotMatch(rule.selector, /\[data-theme\s*=/, `${file}: mode must not select a separate layout`);
  });
  assert.doesNotMatch(source, /var\(--var\(|-light\.css/, `${file}: no obsolete palette imports or malformed tokens`);
}
console.log(`Appearance ownership passed: ${styles.length} CSS modules, no separate mode layouts or light override files.`);
