import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import { audioExtractTemplate } from '../src/features/audio-extract/template.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, tool, controller, template, featureStyles, appStyles] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/audio-extract/tool.js'),
  read('src/features/audio-extract/controller.js'),
  read('src/features/audio-extract/template.js'),
  read('src/features/audio-extract/audio-extract.css'),
  readGlobalStyles(import.meta.url)
]);

assert.equal(LAZY_TOOL_SPECS['audio-extract']?.overlayId, 'audioExtractFeatureOverlay');
assert.equal(LAZY_TOOL_SPECS['audio-extract']?.init, 'initAudioExtractTool');
assert.match(LAZY_TOOL_SPECS['audio-extract'].load.toString(), /audio-extract\/tool\.js/);
assert.match(lazyTools, /'audio-extract':\s*Object\.freeze\(/);
assert.match(html, /<div class="[^\"]*feature-tool-overlay[^\"]*audio-extract-feature-host[^\"]*" id="audioExtractFeatureOverlay"[^>]*><\/div>/);
assert.doesNotMatch(html, /audioExtractOverlay|audioExtractProcessMask|audioExtractSuccessOverlay/);
assert.doesNotMatch(main, /audioExtract(?:Overlay|ProcessMask|SuccessOverlay|Cta|Start|TrackSelect)/);
assert.doesNotMatch(main, /from ['"]\.\/audio-extract-core\.js['"]/);
assert.match(main, /from ['"]\.\/shared\/file-size\.js['"]/);
assert.match(tool, /from ['"]\.\/template\.js['"]/);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/audio-extract\.css['"]/);
assert.match(controller, /createLifecycleScope\(/);
assert.match(controller, /isCurrent\(/);
assert.match(controller, /cancel_convert/);
assert.match(controller, /audio-extract-progress/);
assert.match(controller, /openOutputFolder\(state\.outputPath\)/);
assert.doesNotMatch(controller, /copy\(\{\s*probe:/);
assert.match(template, /data-audio-extract-action="back"/);
assert.match(template, /audio-extract-feature tool-page-v2-shell/);
assert.match(template, /audio-extract-v2-topbar tool-page-v2-topbar/);
assert.match(featureStyles, /\.audio-extract-start\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/);
assert.match(template, /data-audio-extract-action="success-ok"/);
assert.match(featureStyles, /\.audio-extract-feature/);
assert.doesNotMatch(appStyles, /\.audio-extract-v2\s+\.audio-extract-body/);
assert.doesNotMatch(appStyles, /\.audio-extract-overlay/);

const ids = [...audioExtractTemplate().matchAll(/\sid="([^\"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, 0, 'audio extract template must use scoped data hooks instead of global IDs');
assert.match(audioExtractTemplate(), /data-audio-extract-action="choose"/);
assert.match(audioExtractTemplate(), /data-audio-extract-success-path/);

const [themeIndex, sharedTheme, theme] = await Promise.all([
  read('src/styles/themes/index.css'),
  read('src/styles/themes/pdf-tools-light.css'),
  read('src/styles/themes/audio-extract-light.css')
]);
assert.match(template, /tool-page-v2-shell tool-page-v2-light/);
assert.match(sharedTheme, /:is\(\.pdf-merge-v2, \.excel-to-pdf-overlay, \.tool-page-v2-light\)/);
assert.match(themeIndex, /@import url\('\.\/audio-extract-light\.css'\)/);
assert.doesNotMatch(theme, /\.pdf-merge-v2-back|\.pdf-merge-v2-topbar/, 'navigation stays in the shared theme');
for (const selector of ['.audio-extract-info-main', '.audio-extract-info-meta', '.audio-clip-file-remove',
  '.audio-convert-format-option:not(.active)', '.audio-extract-track-select option',
  '[data-audio-extract-process]', '[data-audio-extract-success]']) {
  assert.ok(theme.includes(selector), `daytime theme covers ${selector}`);
}
assert.match(theme, /\.audio-extract-info-main\s*\{\s*min-width: 0/);
assert.match(theme, /max-height: calc\(100dvh - 40px\)/);
assert.match(template, /data-audio-extract-action="open-folder"/);

console.log('Audio extraction lazy tool, template and lifecycle contract checks passed');
