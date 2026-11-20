import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, lazy, tool, styles, themeIndex, calculatorLightStyles] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/interest-calculator/tool.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/components/calculator-form.css', import.meta.url), 'utf8')
]);

for (const id of ['interestCalcOverlay', 'interestCalcBack', 'interestCalcModeTabs', 'interestCalcFreqTabs', 'interestCalcBtn', 'interestCalcScheduleBody']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(lazy, /'interest-calc':[\s\S]*import\('\.\/interest-calculator\/tool\.js'\)/);
assert.doesNotMatch(main, /interestCalcOverlay|openInterestCalcOverlay|calcInterest/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /lifecycle\.event\(back, 'click'/);
assert.match(tool, /updateModeFields\(\)/);
assert.match(tool, /function syncSelection\(/);
assert.match(tool, /mode = tab\.dataset\.mode \|\| 'simple';\s*syncSelection\(\)/);
assert.match(tool, /frequency = tab\.dataset\.freq \|\| 'yearly';\s*syncSelection\(\)/);
assert.match(tool, /tab\.setAttribute\('aria-pressed', String\(selected\)\)/);
const featureStyles = await readFile(new URL('../src/features/interest-calculator/interest-calculator.css', import.meta.url), 'utf8');
assert.match(featureStyles, /#interestCalcFreqField\s*\{\s*grid-column: 1 \/ -1;/);
assert.match(featureStyles, /#interestCalcFreqTabs\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
assert.match(tool, /lifecycle\.use\(onLangChange/);
assert.match(tool, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)/);
assert.doesNotMatch(styles, /#interestCalcOverlay|\.interest-calc-v2/);
assert.match(calculatorLightStyles, /html:root\[data-theme\][\s\S]*\.interest-calc-v2/);
assert.match(calculatorLightStyles, /interest-calc-v2 \.mortgage-calc-method-tab/);
console.log('Interest calculator feature contract passed');
