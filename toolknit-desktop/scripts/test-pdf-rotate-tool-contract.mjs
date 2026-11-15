import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, styles, specs, tool, preview, exporter, featureCss] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-rotate/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-rotate/preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-rotate/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-rotate/pdf-rotate.css', import.meta.url), 'utf8')
]);

for (const id of [
  'pdfRotateOverlay', 'pdfRotateBack', 'pdfRotateDropZone', 'pdfRotateFiles',
  'pdfRotateCta', 'pdfRotateInput', 'pdfRotateProcessBtn', 'pdfRotateProcessMask',
  'pdfRotateWorkspace', 'pdfRotateWorkspaceClose', 'pdfRotatePageStrip',
  'pdfRotateRotateAllBtn', 'pdfRotateDownloadAllBtn', 'pdfRotateSuccessOverlay',
  'pdfRotateSuccessOpenFolder', 'pdfRotateSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF Rotate DOM contract: ${id}`);
}

assert.match(specs, /'pdf-rotate':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-rotate\/tool\.js'\)/);
assert.doesNotMatch(main, /PDF Rotate Overlay|pdfRotateOverlay|openPdfRotateOverlay|selectedPdfRotateFiles/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /createPdfRotatePreview/);
assert.match(tool, /createPdfRotateExporter/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /isCurrentRun\(owner, runId\)/);
assert.match(tool, /preview\.releaseResources\(\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,120}pdf-rotate-demo/);
assert.doesNotMatch(tool, /\.innerHTML\s*=|\.addEventListener\(/);

assert.match(preview, /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
assert.match(preview, /pdf\.worker\.mjs\?url/);
assert.match(preview, /createPdfWorkbench/);
assert.match(preview, /view\.clear\(\)/);
assert.match(preview, /loadingTask\?\.destroy\(\)/);
assert.match(preview, /destroyPdfDocument\(loadedDocument\.doc\)/);
assert.match(preview, /getRotation: page => page.rotation/);
assert.match(preview, /view\.refreshPages/);
assert.match(preview, /selectedOnly/);
assert.match(exporter, /createPdfRotateExportJob/);
assert.match(exporter, /activeJob\?\.cancel/);
assert.match(exporter, /createModalSession/);
for (const attribute of ['data-rotate-actions', 'data-rotate-scope', 'data-rotate-turn', 'data-rotate-export', 'data-rotate-cancel']) {
  assert.ok(html.includes(attribute), 'missing rotation workbench contract: ' + attribute);
}
assert.doesNotMatch(preview, /\.innerHTML\s*=|\.addEventListener\(/);

assert.match(exporter, /writeUniqueBinaryFile/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /assertCurrent\(owner, id\)/);
assert.match(exporter, /function close\(\)/);
assert.doesNotMatch(exporter, /this\.close\(\)/);

assert.match(featureCss, /\.pdf-rotate-v2 \.pdf-merge-v2-poster::after/);
assert.match(featureCss, /\.pdf-rotate-v2 \.pdf-merge-v2-workspace/);
assert.doesNotMatch(styles, /\.pdf-rotate-v2 \.pdf-merge-v2-poster::after|\.pdf-rotate-v2 \.pdf-merge-v2-workspace/);
assert.ok(tool.split(/\r?\n/).length <= 800, 'PDF Rotate tool module must remain below the oversized-module limit');
assert.ok(preview.split(/\r?\n/).length <= 800, 'PDF Rotate preview module must remain below the oversized-module limit');
assert.ok(exporter.split(/\r?\n/).length <= 800, 'PDF Rotate exporter module must remain below the oversized-module limit');

console.log('PDF Rotate lazy-loading, preview, export and lifecycle contracts passed');
