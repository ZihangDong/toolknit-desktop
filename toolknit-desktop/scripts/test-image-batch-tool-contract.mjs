import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import { imageBatchPageTemplate, imageBatchPortalTemplate } from '../src/features/image-batch/template.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, styles, controller, tool, featureStyles] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  readGlobalStyles(import.meta.url),
  read('src/features/image-batch/controller.js'),
  read('src/features/image-batch/tool.js'),
  read('src/features/image-batch/image-batch.css')
]);

for (const [toolId, overlayId, initializer] of [
  ['image-convert', 'imageConvertOverlay', 'initImageConvertTool'],
  ['image-compress', 'imageCompressOverlay', 'initImageCompressTool']
]) {
  const spec = LAZY_TOOL_SPECS[toolId];
  assert.equal(spec?.overlayId, overlayId);
  assert.equal(spec?.init, initializer);
  assert.match(spec.load.toString(), /\.\/image-batch\/tool\.js/);
  assert.match(html, new RegExp(`id="${overlayId}"[^>]*aria-hidden="true"[^>]*><\\/div>`));
}

for (const stale of [
  'selectedImageFiles', 'selectedImageCompressFiles',
  'convert_image_batch', 'compress_image_batch',
  'imageConvertProcessMask', 'imageCompressProcessMask',
  'ImageBatchError', 'validateImageCompressionSelection', 'validateImageBatchSelection'
]) assert.doesNotMatch(main, new RegExp(stale));

assert.doesNotMatch(html, /id="image(?:Convert|Compress)(?:ProcessMask|SuccessOverlay)"/);
assert.doesNotMatch(styles, /\.image-(?:convert|compress)-v2|#image(?:Convert|Compress)SuccessOverlay/);
assert.match(featureStyles, /\.image-convert-v2/);
assert.match(featureStyles, /\.image-compress-v2/);
assert.match(tool, /imageBatchPageTemplate\(mode\)/);
assert.match(tool, /imageBatchPortalTemplate\(mode\)/);
assert.match(tool, /import ['"]\.\/image-batch\.css['"]/);
assert.match(controller, /createLifecycleScope\(\)/);
assert.match(controller, /owner\.use\(unlisten\)/);
assert.match(controller, /isCurrentOperation\(operation\)/);
assert.match(controller, /operation === activeOperation/);
assert.match(controller, /name\.textContent =/);
assert.match(controller, /number\.className = 'audio-convert-file-index'/, 'both image queues must render the shared numbered row structure');
assert.match(controller, /item\.append\(number, name, remove\)/, 'image queue rows must preserve index, centered name, and remove column order');
assert.doesNotMatch(controller, /\.innerHTML\s*=/);
assert.match(controller, /setInteractiveLayer\(successOverlay, false\)/);
assert.match(controller, /getImageCompressionOutcome\(result, files.length\)/);
assert.match(controller, /openFolder.disabled = count === 0/);
assert.match(controller, /icon.dataset.resultState = count > 0 && failed === 0 \? 'success' : 'info'/);
assert.match(featureStyles, /#imageCompressSuccessOverlay .*\[data-result-state="info"\]/);
assert.match(controller, /invoke\('cancel_convert', \{ toolknitTaskTool: mode === 'convert' \? 'image-convert' : 'image-compress' \}\)/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(controller, /from ['"]@tauri-apps\/api\/(?:core|event)['"]/);

const pageMarkup = imageBatchPageTemplate('convert') + imageBatchPageTemplate('compress');
const portalMarkup = imageBatchPortalTemplate('convert') + imageBatchPortalTemplate('compress');
for (const id of [
  'imageConvertBack', 'imageConvertFiles', 'imageConvertFormatOptions', 'imageConvertProcessBtn',
  'imageCompressBack', 'imageCompressFiles', 'imageCompressQualityOptions', 'imageCompressProcessBtn'
]) assert.match(pageMarkup, new RegExp(`id="${id}"`));
for (const id of [
  'imageConvertProcessMask', 'imageConvertSuccessOverlay',
  'imageCompressProcessMask', 'imageCompressSuccessOverlay'
]) assert.match(portalMarkup, new RegExp(`id="${id}"`));

assert.throws(() => imageBatchPageTemplate('unknown'), /unknown-mode/);
console.log('Image batch lazy tool and lifecycle contract checks passed.');
