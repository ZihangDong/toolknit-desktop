import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, styles, specs, tool, processor, featureCss] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-compress/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-compress/processor.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-compress/pdf-compress.css', import.meta.url), 'utf8')
]);

for (const id of [
  'pdfCompressOverlay', 'pdfCompressPlasmaBg', 'pdfCompressBack',
  'pdfCompressDropZone', 'pdfCompressCta', 'pdfCompressLevelOptions',
  'pdfCompressFiles', 'pdfCompressProcessBtn', 'pdfCompressProcessMask',
  'pdfCompressWorkflowOptions', 'pdfCompressRegularOptions', 'pdfCompressTargetOptions',
  'pdfCompressTargetSize', 'pdfCompressTargetSizeControls',
  'pdfCompressModeOptions', 'pdfCompressClarity', 'pdfCompressTargetValue', 'pdfCompressTargetUnit',
  'pdfCompressCustomTarget', 'pdfCompressTargetHint', 'pdfCompressCancel', 'pdfCompressResults',
  'pdfCompressProcessText', 'pdfCompressProcessBarFill',
  'pdfCompressSuccessOverlay', 'pdfCompressSuccessMeta',
  'pdfCompressSuccessFileName', 'pdfCompressSuccessOriginalSize',
  'pdfCompressSuccessCompressedSize', 'pdfCompressSuccessCount',
  'pdfCompressSuccessPath', 'pdfCompressSuccessOpenFolder', 'pdfCompressSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF Compress DOM contract: ${id}`);
}

const cancelButtonMarkup = html.match(/<button[^>]*id="pdfCompressCancel"[^>]*>/)?.[0] || '';
assert.match(cancelButtonMarkup, /class="[^"]*\baudio-convert-cancel-btn\b[^"]*"/,
  'processing cancel must use the dedicated cancel-button primitive');
assert.doesNotMatch(cancelButtonMarkup, /\baudio-convert-success-btn\b/,
  'processing cancel must not inherit the flex-growing success-dialog button');
assert.match(featureCss, /#pdfCompressCancel\s*\{[^}]*flex:\s*0 0 auto;[^}]*align-self:\s*center;/s,
  'processing cancel geometry must not stretch inside the full-screen column');

assert.match(specs, /'pdf-compress':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-compress\/tool\.js'\)/);
assert.doesNotMatch(main, /pdfCompressOverlay|selectedPdfCompressFiles|renderCompressResults|pdfCompressDrawer/);
assert.doesNotMatch(styles, /\.pdf-compress-result-/);
assert.doesNotMatch(html, /pdfCompressDrawer/);
assert.doesNotMatch(html, /结果抽屉|底部抽屉/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /applyTranslations\(root\)/);
assert.match(tool, /if \(!visible\) moveFocusOutOfHiddenRegion\(element\)/);
assert.match(tool, /bindPointerSortableFileList/);
assert.match(tool, /enhanceToolSelects\(\[targetSize, claritySelect, targetUnit\]\)/);
assert.match(tool, /customSelectControls\.forEach\(control => control\.dispose\(\)\)/);
assert.match(tool, /customSelectControls\.forEach\(control => control\.refresh\(\)\)/);
assert.match(tool, /customSelectControls\.forEach\(control => control\.close\(\)\)/);
assert.match(tool, /const targetRequiresRaster = \(\) => workflow === 'target'/);
assert.match(tool, /if \(regularOptions\) regularOptions\.hidden = targetWorkflow/);
assert.match(tool, /if \(targetOptions\) targetOptions\.hidden = !targetWorkflow/);
assert.match(tool, /workflowOptions\?\.querySelectorAll\('\[data-workflow\]'\)/);
assert.match(tool, /const processingMode = workflow === 'target' \? 'raster' : mode/);
assert.match(tool, /targetSizeMb = workflow === 'target' \? targetSelectionMegabytes\(\) : null/);
assert.match(tool, /function retryWithCompactClarity\(\)/);
assert.match(tool, /pageTooLargeGuidance/);
assert.match(tool, /mode: processingMode, clarity, targetBytes, targetSizeMb/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /if \(!isOpenSession\(owner\)\) \{\s*unlisten\(\)/);
assert.match(tool, /isCurrent:\s*\(\) => activeOperation === operation && isOpenSession\(owner\)/);
assert.match(tool, /cancelOperation\(\{ silent: true, detach: true \}\)/);
assert.match(tool, /operation\.isCurrent\(\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,160}pdf-compress-demo/);
assert.match(tool, /fileList\.replaceChildren\(\)/);
assert.match(tool, /name\.textContent = String\(file\?\.name/);
assert.match(tool, /successPath\.textContent = path/);
assert.match(tool, /invoke\('open_path', \{ path: target \}\)/);
assert.match(tool, /import ['"]\.\/pdf-compress\.css['"]/);
assert.doesNotMatch(tool, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(processor, /compress_pdf/);
assert.match(processor, /assertPdfCompressSelection/);
assert.match(processor, /assertPdfCompressLevel/);
assert.match(processor, /normalizePdfCompressTarget/);
assert.match(processor, /targetSizeMb/);
assert.match(processor, /targetReached/);
assert.match(processor, /invoke\('cancel_convert', \{ toolknitTaskTool: 'pdf-compress' \}\)/);
assert.match(processor, /operation\.cancelPromise/);
assert.match(await readFile(new URL('../src-tauri/src/native_runtime/pdf/compress.rs', import.meta.url), 'utf8'), /if status == "compressed"/);
assert.match(processor, /rasterizePdfForCompression/);
assert.match(processor, /begin_pdf_compress_write/);
assert.match(processor, /append_pdf_compress_chunk/);
assert.match(processor, /finalize_pdf_compress_write/);
assert.match(processor, /discard_pdf_compress_write/);
assert.match(processor, /operation\.controller\?\.abort\(\)/);
assert.match(processor, /arrayBuffer: \(\) => file\.arrayBuffer\(\)/);
assert.match(await readFile(new URL('../src-tauri/src/native_runtime/pdf/compress.rs', import.meta.url), 'utf8'), /CURRENT_CHILD_ID\.store/);
assert.match(await readFile(new URL('../src-tauri/src/native_runtime/pdf/compress.rs', import.meta.url), 'utf8'), /pdf-compress:output-invalid/);
assert.match(featureCss, /pdf-compress-target-field/);
assert.match(featureCss, /pdf-compress-option-panels/);
assert.match(featureCss, /pdf-compress-target-size-controls\.is-custom/);
assert.match(featureCss, /pdf-compress-retry-compact/);
assert.match(processor, /operation\.isCurrent\(\)/);
assert.match(processor, /PdfCompressCancelledError/);
assert.doesNotMatch(processor, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(featureCss, /#pdfCompressSuccessOverlay/);
assert.match(featureCss, /max-height: calc\(100vh - 24px\)/);
assert.match(featureCss, /max-width: 980px\) and \(max-height: 420px\)/);

for (const [name, source] of [['tool', tool], ['processor', processor]]) {
  assert.ok(source.split(/\r?\n/).length <= 800, `PDF Compress ${name} module exceeds the oversized-module limit`);
}

console.log('PDF Compress lazy loading, lifecycle, queue, output and safety contracts passed');
