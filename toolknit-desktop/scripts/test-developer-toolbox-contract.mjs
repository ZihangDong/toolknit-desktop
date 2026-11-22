import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, lazyTools, lazyRegistry, ui, core, styles, finalStyles, featureStyles, compatibleUi, compatibleCore] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/lazy-tool-registry.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/developer-toolbox/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/developer-toolbox/core.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/tool-page-v2-final.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/developer-toolbox/developer-toolbox.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/developer-toolbox-ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/developer-toolbox-core.js', import.meta.url), 'utf8')
]);

for (const id of ['json-tools', 'xml-tools', 'base64', 'url-codec', 'uuid', 'jwt']) assert.match(html, new RegExp(`data-tool="${id}"`));
assert.match(html, /id="developerToolboxOverlay"/);
assert.match(lazyTools, /instanceKey: 'developer-toolbox'/);
assert.match(lazyTools, /import\('\.\/developer-toolbox\/tool\.js'\)/);
assert.match(lazyRegistry, /await instance\.open\(toolId\)/);
assert.match(main, /createLazyToolRegistry\([\s\S]*specs:\s*LAZY_TOOL_SPECS/);
assert.match(ui, /clearTimeout\(timer\)/);
assert.match(ui, /createLifecycleScope/);
assert.match(ui, /lifecycle\.event\(overlay, 'click'/);
assert.match(ui, /clearSessionData\(\)[\s\S]*data-jwt-header[\s\S]*data-jwt-payload/);
assert.match(ui, /close\(\)[\s\S]*clearSessionData\(\)/);
assert.match(ui, /dispose\(\)[\s\S]*lifecycle\.dispose\(\)[\s\S]*overlay\.replaceChildren\(\)/);
assert.match(ui, /import '\.\/developer-toolbox\.css'/);
assert.doesNotMatch(ui, /overlay\.addEventListener/);
assert.doesNotMatch(ui, /localStorage|sessionStorage/);
assert.doesNotMatch(ui, /data-dev-run/);
assert.match(ui, /data-json-indent-trigger/);
assert.match(ui, /data-json-indent-option/);
assert.match(core, /DEVELOPER_TOOL_MAX_TEXT/);
assert.match(core, /describeDeveloperToolError/);
assert.doesNotMatch(styles, /\.developer-toolbox/);
assert.doesNotMatch(finalStyles, /\.developer-toolbox/);
assert.match(featureStyles, /\.developer-toolbox-overlay/);
assert.match(featureStyles, /\.developer-toolbox-status\.is-error/);
assert.match(featureStyles, /grid-template-rows: 28px minmax\(0,1fr\)/);
assert.match(featureStyles, /\.developer-toolbox-select-menu/);
assert.match(featureStyles, /background: #e9eaec/);
assert.equal(compatibleUi.trim(), "export * from './features/developer-toolbox/tool.js';");
assert.equal(compatibleCore.trim(), "export * from './features/developer-toolbox/core.js';");
console.log('developer toolbox contract passed');
