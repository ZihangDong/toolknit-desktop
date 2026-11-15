import { readAppMarkup } from './lib/app-markup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, specs, tool, workspace, exporter, view, featureCss] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/workspace.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/pdf-page-number.css', import.meta.url), 'utf8')
]);

const [themeIndex, sharedTheme, pageTheme] = await Promise.all([
  readFile(new URL('../src/styles/themes/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/themes/pdf-workbench-light.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/themes/pdf-page-number-light.css', import.meta.url), 'utf8')
]);
assert.match(themeIndex, /@import url\('\.\/pdf-workbench-light\.css'\)/);
assert.match(themeIndex, /@import url\('\.\/pdf-page-number-light\.css'\)/);
assert.match(sharedTheme, /\.pdf-crop-v2/);
assert.match(sharedTheme, /\.pdf-page-number-v2/);
assert.match(sharedTheme, /input:disabled \+ span/);
assert.doesNotMatch(sharedTheme + pageTheme, /\.pdf-page-number-live-(?:text|background)/,
  'UI themes must not override the actual PDF annotation colors');

for (const id of [
  'pdfPageNumberOverlay', 'pdfPageNumberBack', 'pdfPageNumberDropZone',
  'pdfPageNumberFileInput', 'pdfPageNumberAdd', 'pdfPageNumberEmptyAdd',
  'pdfPageNumberPageList', 'pdfPageNumberPreviewCanvas', 'pdfPageNumberExport',
  'pdfPageNumberProcessMask', 'pdfPageNumberProcessCancel',
  'pdfPageNumberSuccessOverlay', 'pdfPageNumberSuccessOpenFolder',
  'pdfPageNumberSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF page-number DOM contract: ${id}`);
}

assert.match(specs, /'pdf-page-number':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-page-number\/tool\.js'\)/);
assert.doesNotMatch(main, /pdf-page-number-ui\.js|initPdfPageNumberTool|openPdfPageNumberTool/);
assert.doesNotMatch(html, /<link[^>]+pdf-page-number\.css/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /createPdfPageNumberWorkspace/);
assert.match(tool, /createPdfPageNumberExporter/);
assert.match(tool, /createPdfPageNumberView/);
assert.match(tool, /import ['"]\.\/pdf-page-number\.css['"]/);
assert.match(tool, /function handleKeydown\(event\)\s*\{\s*if \(event\.defaultPrevented\) return;/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /isCurrent:\s*\(\) => activeOperation === operation && isOpenSession\(owner\)/);
assert.match(tool, /cancelOperation\(\{ silent: true, detach: true \}\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,140}pdf-page-number-demo/);
assert.match(tool, /return \{ open: openTool, close: closeTool, dispose \}/);
assert.doesNotMatch(tool, /audio-list-item\[data-tool=["']pdf-page-number/);
assert.doesNotMatch(tool, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(workspace, /new IntersectionObserver/);
assert.match(workspace, /new ResizeObserver/);
assert.match(workspace, /previewTask\?\.cancel\(\)/);
assert.match(workspace, /task\.cancel\(\)/);
assert.match(workspace, /destroyPdfDocument\(source\.pdfDoc\)/);
assert.match(workspace, /sourceName\.textContent = page\.sourceName/);
assert.match(workspace, /pageScope\.event\(item/);
assert.match(workspace, /lifecycle\.event\(document, 'pointermove'/);
assert.doesNotMatch(workspace, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(exporter, /URL\.createObjectURL/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /assertOperation\(active\)/);
assert.match(exporter, /shouldCancel:\s*\(\) => active\.cancelled \|\| !active\.isCurrent\(\)/);
assert.match(exporter, /writeUniqueBinaryFile/);
assert.match(view, /\.inert\s*=/);
assert.match(view, /element\.closest\('\[inert\], \[aria-hidden="true"\]'\)/);
assert.match(featureCss, /\.pdf-page-number-layout/);
assert.match(featureCss, /@media \(max-width: 780px\)[\s\S]*?grid-template-rows: minmax\(360px, auto\) minmax\(360px, auto\) minmax\(480px, auto\)/);
assert.match(featureCss, /@media \(max-width: 780px\)[\s\S]*?\.pdf-page-number-settings \{[\s\S]*?min-height: 480px/);

for (const [name, source] of [
  ['tool', tool],
  ['workspace', workspace],
  ['exporter', exporter],
  ['view', view]
]) {
  assert.ok(
    source.split(/\r?\n/).length <= 800,
    `PDF page-number ${name} module exceeds the oversized-module limit`
  );
}

console.log('PDF page-number lazy-loading, lifecycle, preview and export contracts passed');
