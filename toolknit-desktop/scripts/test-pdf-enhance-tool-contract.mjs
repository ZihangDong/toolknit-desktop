import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, styles, specs, tool, processor, featureCss, engine] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-enhance/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-enhance/processor.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-enhance/pdf-enhance.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/pdf-enhance-engine.js', import.meta.url), 'utf8')
]);

for (const id of [
  'pdfEnhanceOverlay', 'pdfEnhancePlasmaBg', 'pdfEnhanceBack',
  'pdfEnhanceDropZone', 'pdfEnhanceCta', 'pdfEnhanceStrengthOptions',
  'pdfEnhanceStrengthHint', 'pdfEnhanceFiles', 'pdfEnhanceProcessBtn',
  'pdfEnhanceProcessMask', 'pdfEnhanceProcessText', 'pdfEnhanceProcessBarFill',
  'pdfEnhanceSuccessOverlay', 'pdfEnhanceSuccessMeta', 'pdfEnhanceSuccessCount',
  'pdfEnhanceSuccessPath', 'pdfEnhanceSuccessOpenFolder', 'pdfEnhanceSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF Enhance DOM contract: ${id}`);
}

assert.match(specs, /'pdf-enhance':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-enhance\/tool\.js'\)/);
assert.doesNotMatch(main, /openPdfEnhanceOverlay|selectedPdfEnhanceFiles|enhanceImageCanvas|closePdfEnhanceOverlayFull/);
assert.doesNotMatch(main, /begin_pdf_enhance_write|append_pdf_enhance_chunk|finalize_pdf_enhance_write|discard_pdf_enhance_write/);
assert.doesNotMatch(styles, /\.pdf-enhance-v2|\.pdf-enhance-strength-hint/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /if \(!isOpenSession\(owner\)\) \{\s*unlisten\(\)/);
assert.match(tool, /filesElement\.replaceChildren\(\)/);
assert.match(tool, /name\.textContent = sourceName\(selectedFile\)/);
assert.match(tool, /processor\.cancel\(operation\)/);
assert.match(tool, /operation\.isCurrent\(\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,150}pdf-enhance-demo/);
assert.match(tool, /import ['"]\.\/pdf-enhance\.css['"]/);
assert.doesNotMatch(tool, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(processor, /pdfjs\.getDocument/);
assert.match(processor, /destroyLoadingTask\(operation\.loadingTask\)/);
assert.match(processor, /pending\?\.catch/);
assert.match(processor, /operation\.renderTask\?\.cancel\(\)/);
assert.match(processor, /destroyPdfDocument\(documentHandle\)/);
assert.match(processor, /releaseCanvas\(canvas\)/);
assert.match(processor, /enhanceRgbaImage\(/);
assert.match(processor, /begin_pdf_enhance_write/);
assert.match(processor, /append_pdf_enhance_chunk/);
assert.match(processor, /finalize_pdf_enhance_write/);
assert.match(processor, /discard_pdf_enhance_write/);
assert.match(processor, /assertOperation\(operation\)/);
assert.doesNotMatch(processor, /\.addEventListener\(|\.innerHTML\s*=/);
assert.match(tool, /showSuccess\(\{\s*path: result\.path,[\s\S]*?pageCount: result\.pageCount\s*\}\)/);

assert.match(engine, /export function enhanceRgbaImage/);
assert.match(featureCss, /\.pdf-enhance-v2/);
assert.match(featureCss, /\.pdf-enhance-strength-hint/);
assert.match(featureCss, /@media \(max-height: 420px\)[\s\S]*?#pdfEnhanceSuccessOverlay/);
assert.match(featureCss, /max-height: calc\(100vh - 24px\)/);

for (const [name, source] of [['tool', tool], ['processor', processor]]) {
  assert.ok(source.split(/\r?\n/).length <= 800, `PDF Enhance ${name} module exceeds the oversized-module limit`);
}

console.log('PDF Enhance lazy loading, lifecycle, rendering and output contracts passed');
