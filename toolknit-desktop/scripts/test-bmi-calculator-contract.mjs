import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, lazy, tool, styles, featureStyles, themeIndex, calculatorLightStyles] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/bmi-calculator/tool.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/bmi-calculator/bmi-calculator.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/components/calculator-form.css', import.meta.url), 'utf8')
]);

for (const id of ['bmiCalcOverlay', 'bmiCalcBack', 'bmiCalcModeTabs', 'bmiCalcGenderTabs', 'bmiCalcResultContent', 'bmiCalcWarnDialog']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(lazy, /'bmi-calc':[\s\S]*import\('\.\/bmi-calculator\/tool\.js'\)/);
assert.doesNotMatch(main, /bmiCalcOverlay|openBmiCalcOverlay|calcBmiResult/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /lifecycle\.event\(back, 'click'/);
assert.match(tool, /lifecycle\.use\(onLangChange/);
assert.match(tool, /clearWarnings\(\)/);
assert.match(tool, /root\.getElementById\('bmiCalcWarnDialog'\)/);
assert.match(tool, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)/);
assert.match(tool, /import '\.\/bmi-calculator\.css'/);
assert.doesNotMatch(styles, /\.bmi-calc|#bmiCalcOverlay/);
assert.match(featureStyles, /\.bmi-calc-v2-workspace/);
assert.match(calculatorLightStyles, /html:root\[data-theme\][\s\S]*\.bmi-calc-v2/);
assert.match(calculatorLightStyles, /bmi-calc-card-tag\.tag-normal/);
console.log('BMI calculator feature contract passed');
