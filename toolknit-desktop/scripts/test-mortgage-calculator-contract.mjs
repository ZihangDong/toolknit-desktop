import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, lazy, tool, styles, themeIndex, calculatorLightStyles] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/mortgage-calculator/tool.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/components/calculator-form.css', import.meta.url), 'utf8')
]);

for (const id of ['mortgageCalcOverlay', 'mortgageCalcBack', 'mortgageCalcMethodTabs', 'mortgageCalcBtn', 'mortgageCalcScheduleBody']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(lazy, /'mortgage-calc':[\s\S]*import\('\.\/mortgage-calculator\/tool\.js'\)/);
assert.doesNotMatch(main, /mortgageCalcOverlay|openMortgageCalcOverlay|calcMortgage/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /lifecycle\.event\(back, 'click'/);
assert.match(tool, /function syncSelection\(/);
assert.match(tool, /method = 'equalPayment';\s*syncSelection\(\)/);
assert.match(tool, /method = tab\.dataset\.method \|\| 'equalPayment';\s*syncSelection\(\)/);
assert.match(tool, /tab\.classList\.toggle\('active', selected\)/);
assert.match(tool, /tab\.setAttribute\('aria-pressed', String\(selected\)\)/);
assert.match(tool, /replaceChildren\(fragment\)/);
assert.match(tool, /lifecycle\.use\(onLangChange/);
assert.match(tool, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)/);
assert.doesNotMatch(styles, /#mortgageCalcOverlay|\.mortgage-calc-v2/);
assert.match(calculatorLightStyles, /html:root\[data-theme\][\s\S]*\.mortgage-calc-v2/);
assert.match(calculatorLightStyles, /mortgage-calc-schedule-header/);
console.log('Mortgage calculator feature contract passed');
