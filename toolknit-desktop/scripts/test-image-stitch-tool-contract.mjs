import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import { imageStitchPageTemplate } from '../src/features/image-stitch/template.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, tool, controller, template, featureStyles, appStyles, themeIndex, lightTheme] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/image-stitch/tool.js'),
  read('src/features/image-stitch/controller.js'),
  read('src/features/image-stitch/template.js'),
  read('src/features/image-stitch/image-stitch.css'),
  readGlobalStyles(import.meta.url),
  read('src/styles/index.css'),
  read('src/features/image-stitch/image-stitch.css')
]);

assert.equal(LAZY_TOOL_SPECS['image-stitch']?.overlayId, 'imageStitchOverlay');
assert.equal(LAZY_TOOL_SPECS['image-stitch']?.init, 'initImageStitchTool');
assert.match(LAZY_TOOL_SPECS['image-stitch'].load.toString(), /image-stitch\/tool\.js/);
assert.match(lazyTools, /'image-stitch':\s*Object\.freeze\(/);
assert.match(html, /<div class="[^"]*feature-tool-overlay[^"]*image-stitch-v2[^"]*" id="imageStitchOverlay"[^>]*><\/div>/);
assert.doesNotMatch(main, /imageStitch(?:Overlay|Queue|Preview|Export|Processing)/);
assert.match(tool, /from ['"]\.\/template\.js['"]/);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/image-stitch\.css['"]/);
assert.match(controller, /createLifecycleScope\(/);
assert.match(controller, /isCurrentSession/);
assert.match(controller, /isCurrentOperation/);
assert.match(controller, /documentRef\.createElement\('canvas'\)/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//);
assert.match(template, /id="imageStitchBack"/);
assert.doesNotMatch(template, /id="imageStitchHelp"/);
assert.doesNotMatch(controller, /imageStitchHelp|openHelpOverlay/);
assert.doesNotMatch(tool, /openHelpOverlay/);
assert.equal((template.match(/class="image-stitch-number-field"/g) || []).length, 3);
assert.match(featureStyles, /\.image-stitch-command-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
assert.match(featureStyles, /\.image-stitch-number-field\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
assert.doesNotMatch(featureStyles, /\.image-stitch-number-setting em/);
assert.match(lightTheme, /\.image-stitch-v2 \.image-stitch-settings \.audio-convert-format-option\s*\{[^}]*background:\s*var\(--tk-inset\)/);
assert.match(template, /id="imageStitchSuccessOverlay"/);
assert.match(featureStyles, /\.image-stitch-v2/);
assert.match(controller, /bindPointerSortableFileList/);
assert.match(controller, /rowSelector: ':scope > \.image-stitch-row'/);
assert.match(controller, /imageStitchFiles\.splice\(to, 0, file\);\s*renderImageStitchQueue\(\)/);
assert.match(featureStyles, /\.audio-convert-hero-subtitle\s*\{\s*text-align: left/);
assert.match(featureStyles, /#imageStitchExport\s*\{\s*color: #000/);
assert.match(featureStyles, /grid-auto-rows: max-content/);
assert.match(featureStyles, /#imageStitchQualityWrap\[hidden\]\s*\{\s*display: none/);
for (const side of [2, 3, 4, 5]) assert.match(template, new RegExp(`data-mode="grid-${side}"`));
assert.doesNotMatch(appStyles, /\.image-stitch-v2\s+\.image-stitch-body/);
assert.match(featureStyles, /\.feature-tool-overlay\.image-stitch-overlay\s*\{[^}]*background:\s*#0a0a0f\s*!important/);
assert.match(lightTheme, /html:root\[data-theme\] \.image-stitch-v2\s*\{/);
assert.match(lightTheme, /\.feature-tool-overlay\.image-stitch-overlay\s*\{\s*background:\s*var\(--tk-page-bg\)\s*!important/);
assert.match(lightTheme, /:is\(\.image-stitch-control-card, \.image-stitch-preview-panel, \.image-stitch-settings\)[\s\S]*?border-radius:\s*8px/);
assert.match(lightTheme, /\.image-stitch-row\s*\{[\s\S]*?background:\s*var\(--tk-page-bg\)/);
assert.match(lightTheme, /\.audio-convert-format-option\.active\s*\{[\s\S]*?background:\s*var\(--tk-accent\)[\s\S]*?color:\s*var\(--tk-on-accent\)/);
assert.match(lightTheme, /\.image-stitch-processing\s*\{\s*background:\s*rgba\(var\(--tk-rgb-page\), 0\.96\)/);
assert.match(lightTheme, /#imageStitchSuccessOverlay \.audio-convert-success-dialog\s*\{[\s\S]*?background:\s*var\(--tk-page-bg\)/);

const ids = [...imageStitchPageTemplate().matchAll(/id="([^\"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'image stitch template contains duplicate IDs');
assert.ok(ids.includes('imageStitchQueue'));
assert.ok(ids.includes('imageStitchProcessing'));

console.log('Image Stitch lazy tool, template and lifecycle contract checks passed');
