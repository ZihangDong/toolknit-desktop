import { readAppMarkup } from './lib/app-markup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, specs, tool, workspace, interaction, thumbnailQueue, documentOwner, exporter, view, core, featureCss, themeCss, themeIndex] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/workspace.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/interaction.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/shared/pdf-render-queue.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/document.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/core.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/pdf-crop.css', import.meta.url), 'utf8'),
  Promise.all(['pdf-crop-light.css', 'pdf-workbench-light.css'].map(name =>
    readFile(new URL(`../src/styles/themes/${name}`, import.meta.url), 'utf8'))).then(parts => parts.join('\n')),
  readFile(new URL('../src/styles/themes/index.css', import.meta.url), 'utf8')
]);

for (const id of [
  'pdfCropOverlay', 'pdfCropBack', 'pdfCropDropZone', 'pdfCropFileInput',
  'pdfCropEmptyAdd', 'pdfCropFilmstrip', 'pdfCropPreviewCanvas',
  'pdfCropInteractionLayer', 'pdfCropExportCurrent', 'pdfCropExport', 'pdfCropProcessMask',
  'pdfCropProcessCancel', 'pdfCropSuccessOverlay',
  'pdfCropSuccessOpenFolder', 'pdfCropSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF Crop DOM contract: ${id}`);
}

assert.match(specs, /'pdf-crop':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-crop\/tool\.js'\)/);
assert.doesNotMatch(main, /pdf-crop-ui\.js|initPdfCropTool|openPdfCropTool/);
assert.doesNotMatch(html, /<link[^>]+pdf-crop\.css/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /createPdfCropWorkspace/);
assert.match(tool, /createPdfCropExporter/);
assert.match(tool, /createPdfCropView/);
assert.match(tool, /import ['"]\.\/pdf-crop\.css['"]/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /isCurrent:\s*\(\) => activeOperation === operation && isOpenSession\(owner\)/);
assert.match(tool, /cancelOperation\(\{ silent: true, detach: true \}\)/);
assert.match(tool, /workspace\.hasCurrentCrop\(\)/);
assert.match(tool, /exportDocument\('current', session\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,140}pdf-crop-demo/);
assert.match(tool, /return \{ open: openTool, close: closeTool, dispose \}/);
assert.doesNotMatch(tool, /audio-list-item\[data-tool=["']pdf-crop/);
assert.doesNotMatch(tool, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(workspace, /new IntersectionObserver/);
assert.match(workspace, /new ResizeObserver/);
assert.match(workspace, /previewTask\?\.cancel\(\)/);
assert.match(workspace, /renderTask\.cancel\(\)/);
assert.match(workspace, /title\.textContent = text\('home\.pdfCrop\.pageLabel'/);
assert.match(workspace, /owner\.event\(button, 'click'/);
assert.match(workspace, /lifecycle\.event\(target, type, handler, options\)/);
assert.match(workspace, /createLatestFrameScheduler/);
assert.match(workspace, /pointerFrame\.schedule\(state\.latestRect\)/);
assert.match(workspace, /setThumbnailsPaused\(true\)/);
assert.match(workspace, /createPausableRenderQueue/);
assert.match(workspace, /listen\(document, 'pointercancel', abortCropPointer\)/);
const pointerMove = workspace.match(/function handleCropPointerMove\([\s\S]*?\n  }\n\n  function cancelPointer/)?.[0] || '';
assert.doesNotMatch(pointerMove, /applyRectToScope|updateThumbStates|emitChange/);
assert.doesNotMatch(workspace, /\.addEventListener\(|\.innerHTML\s*=/);

assert.match(interaction, /export function calculatePdfCropInteractionRect/);
assert.match(interaction, /export function createLatestFrameScheduler/);
assert.match(thumbnailQueue, /renderTasks\.forEach\(cancelRenderTask\)/);
assert.match(thumbnailQueue, /requeue: key => enqueue\(key, \{ front: true \}\)/);

assert.match(documentOwner, /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
assert.match(documentOwner, /pdf\.worker\.mjs\?url/);
assert.match(documentOwner, /await destroyPdfDocument\(source\.pdfDoc\)/);
assert.match(documentOwner, /source\.bytes = null/);
assert.match(documentOwner, /active\.loadingTasks\.add\(source\.loadingTask\)/);

assert.match(exporter, /URL\.createObjectURL/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /assertOperation\(active\)/);
assert.match(exporter, /shouldCancel:\s*\(\) => active\.cancelled \|\| !active\.isCurrent\(\)/);
assert.match(exporter, /write_unique_file_bytes/);
assert.match(exporter, /exportCroppedPdfPage/);
assert.match(exporter, /target === 'current'/);
assert.match(view, /element\.inert = !visible/);
assert.match(core, /export async function exportCroppedPdf/);
assert.match(core, /export async function exportCroppedPdfPage/);
assert.match(featureCss, /\.pdf-crop-layout/);
assert.match(featureCss, /flex:\s*0 0 132px/);
assert.match(featureCss, /flex-basis:\s*110px/);
assert.match(featureCss, /\.pdf-crop-export-actions/);
assert.match(featureCss, /@media \(max-height: 520px\)[\s\S]*?grid-template-rows: 48px minmax\(64px, 1fr\) 36px 86px/);
assert.match(themeIndex, /@import url\('\.\/pdf-crop-light\.css'\)/);
assert.match(themeCss, /html\[data-theme="light"\] \.pdf-crop-v2/);
assert.match(themeCss, /\.pdf-crop-selection/);
assert.match(themeCss, /#pdfCropProcessMask/);
assert.match(themeCss, /#pdfCropSuccessOverlay/);
assert.match(themeCss, /\.pdf-crop-export-secondary/);

for (const [name, source] of [
  ['tool', tool],
  ['workspace', workspace],
  ['interaction', interaction],
  ['thumbnail queue', thumbnailQueue],
  ['document', documentOwner],
  ['exporter', exporter],
  ['view', view]
]) {
  assert.ok(source.split(/\r?\n/).length <= 800, `PDF Crop ${name} module exceeds the oversized-module limit`);
}

console.log('PDF Crop lazy-loading, lifecycle, preview, interaction and export contracts passed');
