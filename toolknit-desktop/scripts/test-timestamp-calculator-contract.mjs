import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, lazyTools, tool, styles, featureStyles, themeIndex, calculatorLightStyles] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/timestamp-calculator/tool.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/timestamp-calculator/timestamp-calculator.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/components/calculator-form.css', import.meta.url), 'utf8')
]);

for (const id of [
  'tsCalcOverlay',
  'tsCalcBack',
  'tsCalcModeTabs',
  'tsCalcInput',
  'tsCalcDateInput',
  'tsCalcResultValue',
  'tsCalcCopyResult'
]) assert.match(html, new RegExp(`id="${id}"`));

assert.match(lazyTools, /'timestamp-calc':[\s\S]*import\('\.\/timestamp-calculator\/tool\.js'\)/);
assert.doesNotMatch(main, /tsCalcOverlay|openTsCalcOverlay|tsCalcNowTimer/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /lifecycle\.event\(back, 'click'/);
assert.match(tool, /lifecycle\.use\(onLangChange/);
assert.match(tool, /stopClock\(\)/);
assert.match(tool, /clearCopyTimers\(\)/);
assert.match(tool, /lifecycle\.isCurrent\(token\)/);
assert.match(tool, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)/);
assert.match(tool, /import '\.\/timestamp-calculator\.css'/);
assert.doesNotMatch(tool, /localStorage|sessionStorage/);
assert.doesNotMatch(styles, /\.ts-calc|\.timestamp-calc/);
assert.match(featureStyles, /\.timestamp-calc-v2-workspace/);
assert.match(featureStyles, /\.ts-calc-result-card/);
assert.match(calculatorLightStyles, /html:root\[data-theme\][\s\S]*\.timestamp-calc-v2/);
assert.match(calculatorLightStyles, /ts-calc-current-row/);

console.log('Timestamp calculator feature contract passed');
