import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatePassword as compatibleGenerate } from '../src/password-core.js';
import { generatePassword as featureGenerate } from '../src/features/password-generator/core.js';

const [html, main, lazyTools, tool, styles, featureStyles, compatibleCore] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/password-generator/tool.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/password-generator/password-generator.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/password-core.js', import.meta.url), 'utf8')
]);

for (const id of [
  'passwordGenOverlay',
  'passwordGenBack',
  'passwordGenStrengthTabs',
  'passwordGenLengthSlider',
  'passwordGenBtn',
  'passwordGenOutput',
  'passwordGenHistoryList'
]) assert.match(html, new RegExp(`id="${id}"`));

assert.equal(compatibleGenerate, featureGenerate);
assert.equal(compatibleCore.trim(), "export * from './features/password-generator/core.js';");
assert.match(lazyTools, /'password-gen':[\s\S]*import\('\.\/password-generator\/tool\.js'\)/);
assert.doesNotMatch(main, /passwordGenOverlay|generateSecurePassword|assessPasswordStrength/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /lifecycle\.event\(back, 'click'/);
assert.match(tool, /lifecycle\.use\(onLangChange/);
assert.match(tool, /onLangChange\(\(\) => \{\s*renderPresetDescription\(\);\s*renderStrength\(\);\s*renderHistory\(\);/);
assert.match(tool, /clearTransientTasks\(\)/);
assert.match(tool, /clearSensitiveContent\(\)/);
assert.match(tool, /if \(copyButton\) copyButton\.textContent = t\('home\.passwordGen\.copy'\)/);
assert.match(tool, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)/);
assert.match(tool, /import '\.\/password-generator\.css'/);
assert.match(tool, /import '\.\/password-generator\.css'/);
assert.match(tool, /import '\.\.\/\.\.\/styles\/components\/calculator-form\.css'/);
assert.doesNotMatch(tool, /localStorage|sessionStorage/);
assert.doesNotMatch(styles, /\.password-gen/);
assert.doesNotMatch(styles, /#passwordGenOverlay/);
assert.match(featureStyles, /\.password-gen-v2/);
assert.match(featureStyles, /#passwordGenOverlay/);

console.log('Password generator feature contract passed');
