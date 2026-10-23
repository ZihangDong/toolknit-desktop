import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, styles, specs, tool, preview, exporter, featureCss, sortable] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-split/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-split/preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-split/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-split/pdf-split.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/shared/sortable-file-list.js', import.meta.url), 'utf8')
]);

for (const id of [
  'pdfSplitOverlay', 'pdfSplitBack', 'pdfSplitDropZone', 'pdfSplitFiles',
  'pdfSplitCta', 'pdfSplitProcessBtn', 'pdfSplitProcessMask',
  'pdfSplitWorkspace', 'pdfSplitWorkspaceClose', 'pdfSplitPageStrip',
  'pdfSplitSelectAllBtn', 'pdfSplitDownloadAllBtn', 'pdfSplitDownloadCurrentBtn',
  'pdfSplitDownloadZipBtn', 'pdfSplitWorkbenchActions', 'pdfSplitProcessCancel', 'pdfSplitSuccessOverlay',
  'pdfSplitRangeBtn', 'pdfSplitSelectionTitle', 'pdfSplitRangeDialog', 'pdfSplitRangeTitle', 'pdfSplitRangeInput',
  'pdfSplitRangeLimit', 'pdfSplitRangeHelp', 'pdfSplitRangeError',
  'pdfSplitSuccessOpenFolder', 'pdfSplitSuccessOk'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing PDF Split DOM contract: ${id}`);
}

assert.match(specs, /'pdf-split':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/pdf-split\/tool\.js'\)/);
assert.doesNotMatch(main, /PDF Split Overlay|pdfSplitOverlay|openPdfSplitOverlay|selectedPdfSplitFiles/);

assert.match(tool, /createLifecycleScope/);
assert.match(tool, /createPdfSplitPreview/);
assert.match(tool, /createPdfSplitExporter/);
assert.match(tool, /bindSortableFileList/);
assert.match(tool, /owner\.use\(unlisten\)/);
assert.match(tool, /isCurrentRun\(owner, runId\)/);
assert.match(tool, /preview\.releaseResources\(\)/);
assert.match(tool, /import\.meta\.env\.DEV[\s\S]{0,120}pdf-split-demo/);
assert.doesNotMatch(tool, /\.innerHTML\s*=|\.addEventListener\(/);

assert.match(preview, /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
assert.match(preview, /pdf\.worker\.mjs\?url/);
assert.match(preview, /createPdfWorkbench/);
assert.match(preview, /selected: false/);
assert.match(preview, /createPdfSplitRangeDialog/);
assert.match(preview, /rangeDialog\.close\(\{ restore: false \}\)/);
const rangeDialog = await readFile(new URL('../src/features/pdf-split/range-dialog.js', import.meta.url), 'utf8');
assert.match(rangeDialog, /createModalSession\(\{ root, background: workspace, initialFocus: input/);
assert.match(rangeDialog, /selectPdfSplitRange/);
assert.match(rangeDialog, /modal\.dispose\(\); scope\.dispose\(\)/);
assert.doesNotMatch(rangeDialog, /\.innerHTML\s*=|\.addEventListener\(/);
for (const language of ['zh', 'en']) {
  const strings = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).home.pdfSplit;
  for (const key of ['selectionTitle', 'totalPages', 'selectionHint', 'rangeSelect', 'rangeTitle', 'rangeLabel', 'rangePlaceholder', 'rangeLimit', 'rangeHelp', 'rangeApply', 'rangeDone', 'rangeAdded', 'rangeAlreadySelected', 'rangeEmpty', 'rangeFormat', 'rangeOrder', 'rangeBounds']) {
    assert.equal(typeof strings[key], 'string', `Missing PDF Split ${language} message: ${key}`);
  }
}
assert.match(preview, /loadingTask\?\.destroy\(\)/);
assert.match(preview, /destroyPdfDocument\(doc\)/);
const workbench = await readFile(new URL('../src/shared/pdf-workbench.js', import.meta.url), 'utf8');
const sharedToolShell = await readFile(new URL('../src/shared/tool-page-shell.js', import.meta.url), 'utf8');
const unifiedNavigation = await readFile(new URL('../src/tool-nav-unified.css', import.meta.url), 'utf8');
assert.match(workbench, /mainTask\?\.cancel\(\)/);
assert.match(workbench, /task\.cancel\(\)/);
assert.match(workbench, /renderScope\.event\(check/);
assert.match(workbench, /IntersectionObserver/);
assert.match(workbench, /activeThumbs < 2/);
assert.match(workbench, /version !== previewRevision \|\| owner !== generation/);
assert.doesNotMatch(workbench, /from.*features\//);
assert.match(workbench, /toolTopbarMarkup/);
assert.match(sharedToolShell, /export function toolTopbarMarkup/);
assert.match(sharedToolShell, /export function bindGlobalToolPageChrome/);
assert.match(unifiedNavigation, /\.tk-tool-nav \.home-v2-window-cluster\s*\{/);
assert.match(unifiedNavigation, /font-size: 14px;/);
assert.match(unifiedNavigation, /transition: background-color 150ms ease, color 150ms ease;/);
assert.doesNotMatch(preview, /\.innerHTML\s*=|\.addEventListener\(/);

assert.match(exporter, /write_unique_file_bytes/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /assertCurrent\(owner, id\)/);
assert.match(exporter, /createPdfSplitExportJob/);
assert.match(exporter, /downloadZip:/);
assert.match(exporter, /createModalSession/);
assert.match(exporter, /function close\(\)/);
assert.match(sortable, /scope\.event\(row, 'dragstart'/);

assert.match(workbench, /styles\/components\/pdf-workbench\.css/);
assert.match(workbench, /pdf-workbench-shell tool-page-v2-shell/);
assert.match(workbench, /import \{ prepareToolPageChrome \} from '\.\/tool-page-chrome\.js'/);
assert.ok(workbench.indexOf('prepareToolPageChrome(shell)') > workbench.indexOf('root.replaceChildren(shell)'),
  'Dynamically constructed sibling workspaces prepare the final shared navigation after mounting.');
assert.match(preview, /stageId: 'pdfSplitPageStage'/);
assert.match(featureCss, /#pdfSplitProcessCancel/);
const exportRuntime = await readFile(new URL('../src/features/pdf-split/export-runtime.js', import.meta.url), 'utf8');
assert.match(exportRuntime, /createPdfExportJob/);
const sharedExportJob = await readFile(new URL('../src/shared/pdf-export-job.js', import.meta.url), 'utf8');
assert.match(sharedExportJob, /worker\?\.terminate\(\)/);
assert.match(exportRuntime, /fileData\.slice\(\)/);
assert.doesNotMatch(styles, /\.pdf-split-workspace-tile/);
for (const [name, source] of [['tool', tool], ['preview', preview], ['exporter', exporter]]) {
  assert.ok(source.split(/\r?\n/).length <= 800, `PDF Split ${name} module exceeds the oversized-module limit`);
}

console.log('PDF Split lazy-loading, preview, export and lifecycle contracts passed');
