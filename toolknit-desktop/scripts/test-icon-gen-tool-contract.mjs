import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const [main, index, styles, tool, controller, template, featureStyles, generator, publisher] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readAppMarkup(import.meta.url),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/icon-generator/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/icon-generator/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/icon-generator/template.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/icon-generator/icon-generator.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/icon-generator/generator.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/icon-generator/publisher.js', import.meta.url), 'utf8')
]);

assert.equal(LAZY_TOOL_SPECS['icon-gen']?.overlayId, 'iconGenOverlay');
assert.match(LAZY_TOOL_SPECS['icon-gen'].load.toString(), /\.\/icon-generator\/tool\.js/);
assert.match(tool, /iconGeneratorPageTemplate\(\)/);
assert.match(tool, /iconGeneratorPortalTemplate\(\)/);
assert.match(tool, /import ['"]\.\/icon-generator\.css['"]/);
assert.match(controller, /createLifecycleScope\(\)/);
assert.match(controller, /owner\.use\(unlisten\)/);
assert.match(controller, /isCurrentSourceRequest\(request\)/);
assert.match(controller, /isCurrentOperation\(operation\)/);
assert.match(controller, /name\.textContent =/);
assert.doesNotMatch(controller, /\.innerHTML\s*=/);
assert.match(controller, /discardArchive\(operation, tauriCore\)/);
assert.match(generator, /releaseCanvas\(canvas\)/);
assert.match(publisher, /discard_icon_archive_write/);
assert.match(template, /id="iconGenProcessMask"/);
assert.match(template, /id="iconGenSuccessOverlay"/);
assert.match(template, /id="iconGenSuccessPath"/);
assert.match(template, /audio-convert-success-btn-secondary[^>]*id="iconGenOpenFolder"/);
assert.match(featureStyles, /#iconGenFiles \.audio-convert-file-item\s*\{[^}]*display:\s*flex/);
assert.match(featureStyles, /#iconGenFiles \.audio-convert-file-name\s*\{[^}]*text-align:\s*left/);
assert.match(featureStyles, /html\[data-theme="light"\] \.icon-gen-v2 \.audio-convert-file-size/);
assert.doesNotMatch(controller, /openFolder\.style\.display/);
assert.match(controller, /openFolder\.disabled = !canOpenFolder \|\| openingFolder/);
assert.match(controller, /await openOutputFolder\(outputPath\)/);
assert.match(controller, /isCurrentResult\(\) && opened !== false/);
assert.match(controller, /if \(isCurrentResult\(\)\) showError\(t\('common.openFolderFailed'\)\)/);
for (const lang of ['zh', 'en']) {
  const locale = JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'));
  for (const key of ['successPath', 'browserDownloadLocation', 'browserOpenFolderUnavailable']) {
    assert.ok(locale.home.iconGen[key], `${lang}: missing icon generator result text ${key}`);
  }
}
assert.match(featureStyles, /\.icon-gen-v2/);
assert.doesNotMatch(main, /\/\/ ===== Icon Generator Tool =====/);
assert.doesNotMatch(main, /from ['"]\.\/icon-gen-core\.js['"]/);
assert.doesNotMatch(styles, /\.icon-gen-v2/);
assert.match(index, /id="iconGenOverlay"[^>]*aria-hidden="true"[^>]*><\/div>/);
assert.doesNotMatch(index, /id="iconGenProcessMask"/);
assert.doesNotMatch(index, /id="iconGenSuccessOverlay"/);

console.log('Icon generator lazy tool contract checks passed');
