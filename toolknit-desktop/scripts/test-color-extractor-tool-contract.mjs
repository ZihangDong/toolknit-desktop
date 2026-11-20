import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const [tool, controller, picker, featureStyles, appStyles, main] = await Promise.all([
  readFile(new URL('../src/features/color-extractor/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/color-extractor/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/color-extractor/screen-picker.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/color-extractor/color-extractor.css', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8')
]);

assert.equal(LAZY_TOOL_SPECS['color-extractor']?.overlayId, 'colorExtractorOverlay');
assert.match(LAZY_TOOL_SPECS['color-extractor'].load.toString(), /color-extractor\/tool\.js/);
assert.match(tool, /bindToolPageChrome/);
assert.match(tool, /createColorExtractorController/);
assert.match(tool, /color-extractor\.css/);
assert.match(tool, /import '\.\/color-extractor\.css'/);
assert.match(tool, /import '\.\.\/\.\.\/styles\/components\/tool-empty-hero\.css'/);
assert.match(controller, /createLifecycleScope\(/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//);
assert.match(controller, /assertColorExtractorImageBytes/);
assert.match(controller, /onDragDropEvent/);
assert.match(controller, /scope\.event\(window, ['"]toolknit:screen-color-picked/);
assert.match(controller, /URL\.createObjectURL/);
assert.match(controller, /URL\.revokeObjectURL/);
assert.doesNotMatch(controller, /\.innerHTML\s*=/);
assert.match(picker, /bootstrapScreenPickerOverlay/);
assert.match(picker, /createLifecycleScope\(/);
assert.match(picker, /screen-picker-opened/);
assert.match(picker, /closed = false;\s*reset\(event\?\.payload\)/);
assert.match(picker, /screen-picker-ready/);
assert.match(picker, /screen-color-picked/);
assert.match(picker, /screen_color_sample/);
assert.match(featureStyles, /\.color-extractor-v2/);
assert.match(featureStyles, /#screenPickerOverlay/);
assert.doesNotMatch(appStyles, /\.color-extractor-v2-panel|\.color-extractor-v2-workspace|\.screen-picker-crosshair/);
assert.match(appStyles, /html:not\(\[data-screen-picker\]\) #screenPickerOverlay/);
assert.match(main, /import\('\.\/features\/color-extractor\/screen-picker\.js'\)/);
assert.doesNotMatch(main, /from ['"]\.\/color-extractor-core\.js['"]/);
assert.doesNotMatch(main, /openColorExtractorOverlay/);

console.log('Color extractor feature lifecycle and lazy contract checks passed');
