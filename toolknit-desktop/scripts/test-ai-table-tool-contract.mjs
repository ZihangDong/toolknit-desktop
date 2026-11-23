import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeAiTableData } from '../src/ai-table-core.js';
import { createSerializedRequestSession } from '../src/core/serialized-request-session.js';
import { buildAiTablePdf } from '../src/features/ai-table/pdf.js';
import { AI_TABLE_DEMO_DATA } from '../src/features/ai-table/prompts.js';

const [html, main, styles, specs, tool, editor, charts, exporter, pdf, prompts, sharedCss, featureCss, fontBytes] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/editor.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/charts.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/pdf.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/prompts.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-workbench/ai-workbench-shared.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-table/ai-table.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/assets/fonts/NotoSansSC-Regular.ttf', import.meta.url))
]);

for (const id of [
  'aiTableOverlay', 'aiTableBack', 'aiTableChatMessages', 'aiTableChatInput',
  'aiTableChatSend', 'aiTableCanvasEmpty', 'aiTablePreviewScroll',
  'aiTableCanvasToolbar', 'aiTableUndoBtn', 'aiTableResetBtn',
  'aiTableSuccessOverlay', 'aiTableSuccessOpenFolder', 'aiTableMask'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing AI Table DOM contract: ${id}`);
}

assert.match(specs, /'ai-table':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/ai-table\/tool\.js'\)/);
assert.match(main, /toolId === 'ai-doc' \|\| toolId === 'ai-table'/);
assert.match(main, /isAiTableDemoEntry[\s\S]*lazyFeatureRegistry\.open\('ai-table'\)/);
assert.doesNotMatch(main, /AI Table Tool|aiTableOverlay|openAiTableOverlay|AI_TABLE_LIMITS|aiDocFontRegularBytes/);

assert.match(tool, /createAiTableEditor/);
assert.match(tool, /createAiTableExporter/);
assert.match(tool, /createSerializedRequestSession/);
assert.match(tool, /REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS\.maxTimeoutMs/);
assert.match(tool, /timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low'/);
assert.match(tool, /error instanceof AiProviderError/);
assert.match(tool, /error\.code === 'timeout'/);
assert.match(tool, /import '\.\.\/ai-workbench\/ai-workbench-shared\.css'/);
assert.match(tool, /import '\.\/ai-table\.css'/);
assert.match(tool, /import '\.\/ai-table\.css';\s*import '\.\.\/\.\.\/styles\/components\/ai-workbench\.css'/);
assert.match(tool, /requests\.cancel\(\)/);
assert.match(tool, /owner\.use\(\(\) => requests\.cancel\(request\.id\)\)/);
assert.match(tool, /releaseRequest\(\)/);
assert.match(tool, /session\?\.dispose\(\)/);
assert.match(tool, /messageScope\.event\(bubble, 'click'/);
assert.doesNotMatch(tool, /\.innerHTML\s*=/);
assert.match(tool, /fillUserAvatar = container => appendToolKnitAvatar/);

assert.match(editor, /renderScope\.event\(/);
assert.match(editor, /event\.key !== 'Escape'[\s\S]*?scroll\?\.contains\(cell\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?cell\.blur\(\)/,
  'cell-edit Escape must not trigger tool-page fallback navigation');
assert.match(editor, /lifecycle\.event\(window, 'toolknit-interface-font-change'/);
assert.match(editor, /charts\.reset\(\)/);
assert.match(editor, /renderScope\?\.dispose\(\)/);
assert.doesNotMatch(editor, /\.innerHTML\s*=/);
assert.doesNotMatch(editor, /\.addEventListener\(/);
assert.ok(editor.split(/\r?\n/).length <= 800, 'AI Table editor must remain below the oversized-module limit');

assert.match(charts, /import\('chart\.js\/auto'\)/);
assert.match(charts, /entry\.instance\?\.destroy\(\)/);
assert.match(exporter, /fetch\('\/assets\/fonts\/NotoSansSC-Regular\.ttf'\)/);
assert.match(exporter, /buildAiTablePdf/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /current\(owner, id\)/);
assert.doesNotMatch(exporter, /aiDocFontRegularBytes|\.innerHTML\s*=/);
assert.match(pdf, /fontRegularBytes/);
assert.match(prompts, /AI_TABLE_DEMO_DATA/);
assert.match(sharedCss, /\.ai-doc-chat-messages/);
assert.match(sharedCss, /\.ai-doc-chat-input/);
assert.match(sharedCss, /\.ai-doc-pill-btn/);
assert.match(featureCss, /\.ai-table-v2/);
assert.doesNotMatch(featureCss, /\.ai-doc-edit-v2/);
assert.doesNotMatch(styles, /AI Document · Tool Page 2\.0|AI Table Tool/);

const timers = new Map();
let timerSeed = 0;
const requests = createSerializedRequestSession({
  timeoutMs: 100,
  setTimer(callback) {
    const id = ++timerSeed;
    timers.set(id, callback);
    return id;
  },
  clearTimer(id) { timers.delete(id); }
});
const first = requests.begin();
assert.ok(first);
assert.equal(requests.begin(), null, 'a second AI request must not start while one is active');
assert.equal(requests.cancel(), true);
assert.equal(first.signal.aborted, true);
const second = requests.begin();
timers.get([...timers.keys()][0])();
assert.equal(second.timedOut(), true);
assert.equal(second.signal.aborted, true);
assert.equal(requests.finish(second.id), true);
assert.equal(requests.busy, false);
const third = requests.begin();
assert.equal(requests.cancel(second.id), false, 'stale cleanup must not cancel a newer request');
assert.equal(requests.isCurrent(third.id), true);
assert.equal(requests.cancel(third.id), true);

const normalizedDemo = normalizeAiTableData(AI_TABLE_DEMO_DATA);
const pdfBytes = await buildAiTablePdf({
  data: normalizedDemo,
  fontRegularBytes: fontBytes
});
assert.ok(pdfBytes.byteLength > 10_000, 'AI Table PDF output should contain an embedded CJK font');
assert.equal(Buffer.from(pdfBytes.subarray(0, 4)).toString('ascii'), '%PDF');

console.log('AI Table lazy-loading, lifecycle, chart ownership and CJK PDF contracts passed');
