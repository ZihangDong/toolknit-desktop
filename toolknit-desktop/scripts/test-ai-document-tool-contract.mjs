import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAiDocumentRequestSession } from '../src/features/ai-document/request-session.js';

const [html, main, styles, specs, tool, editor, preview, exporter, prompts, sharedCss, featureCss, editorCss] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readGlobalStyles(import.meta.url),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/editor.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/preview.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/prompts.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-workbench/ai-workbench-shared.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/ai-document.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ai-document/ai-document-editor.css', import.meta.url), 'utf8')
]);

for (const id of [
  'aiDocOverlay', 'aiDocBack', 'aiDocChatMessages', 'aiDocChatInput', 'aiDocChatSend',
  'aiDocThumbScroll', 'aiDocOpenEditorBtn', 'aiDocExportBtn', 'aiDocEditOverlay',
  'aiDocEditScroll', 'aiDocUndoBtn', 'aiDocRedoBtn', 'aiDocSuccessOverlay'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing AI Document DOM contract: ${id}`);
}

assert.match(specs, /'ai-doc':\s*Object\.freeze\(\{[\s\S]*?import\('\.\/ai-document\/tool\.js'\)/);
assert.match(main, /toolId === 'ai-polish'[\s\S]{0,180}toolId === 'ai-doc'/);
assert.match(main, /isAiDocEditorDemoEntry[\s\S]*lazyFeatureRegistry\.open\('ai-doc'\)/);
assert.doesNotMatch(main, /AI Document Tool|aiDocOverlay|openAiDocOverlay|AI_DOC_LIMITS|buildAiDocPdf/);

assert.match(tool, /createAiDocumentEditor/);
assert.match(tool, /createAiDocumentPreview/);
assert.match(tool, /createAiDocumentExporter/);
assert.match(tool, /AI_DOC_SYSTEM_PROMPT/);
assert.match(tool, /createLifecycleScope/);
assert.match(tool, /createAiDocumentRequestSession/);
assert.match(tool, /REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS\.maxTimeoutMs/);
assert.match(tool, /timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low'/);
assert.match(tool, /error instanceof AiProviderError/);
const requestRuntime = await readFile(new URL('../src/app/ai-request-runtime.js', import.meta.url), 'utf8');
assert.match(requestRuntime, /timeoutMs: options\.timeoutMs/);
assert.match(requestRuntime, /reasoningEffort: options\.reasoningEffort/);
assert.match(requestRuntime, /new AiProviderError\(error\.code, error\.status,/);
assert.match(requestRuntime, /error\.diagnostics/);
assert.match(requestRuntime, /diagnostics: options\.diagnostics === true && \(isTauri \|\| Boolean\(import\.meta\.env\?\.DEV\)\)/);
assert.match(tool, /diagnostics: true/);
assert.match(tool, /\[AI Doc\] API diagnostics:/);
assert.doesNotMatch(tool, /console\.(?:log|error)\([^\n]*(?:apiKey|messages|content)/);
assert.match(tool, /import '\.\.\/ai-workbench\/ai-workbench-shared\.css'/);
assert.match(tool, /import '\.\/ai-document\.css'/);
assert.match(tool, /import '\.\/ai-document-editor\.css'/);
assert.match(tool, /import '\.\/ai-document\.css';\s*import '\.\/ai-document-editor\.css';\s*import '\.\.\/\.\.\/styles\/components\/ai-workbench\.css'/);
assert.match(tool, /requests\.cancel\(\)/);
assert.match(tool, /owner\.use\(\(\) => requests\.cancel\(request\.id\)\)/);
assert.match(tool, /releaseRequest\(\)/);
assert.match(tool, /session\?\.dispose\(\)/);
assert.match(tool, /isCurrent\(owner, id\)/);
assert.match(tool, /messageScope\.event\(bubble, 'click'/);
assert.doesNotMatch(tool, /\.innerHTML\s*=/);

assert.match(editor, /renderScope\.event\(document, 'mousemove'/);
assert.match(editor, /renderScope\.event\(document, 'mouseup'/);
assert.match(editor, /session\.event\(document, 'keydown'/);
assert.match(editor, /renderScope\?\.dispose\(\)/);
assert.match(editor, /reader\.abort\(\)/);
assert.match(editor, /isOpenSession\(owner\)/);
assert.doesNotMatch(editor, /document\.addEventListener/);
assert.doesNotMatch(editor, /\.innerHTML\s*=/);
assert.ok(editor.split(/\r?\n/).length <= 1200, 'AI Document editor must remain below the oversized-module limit');

assert.match(exporter, /cloneAiDocLayout/);
assert.match(exporter, /buildAiDocPdf/);
assert.match(exporter, /URL\.revokeObjectURL/);
assert.match(exporter, /current\(owner, id\)/);
assert.doesNotMatch(preview, /\.innerHTML\s*=/);
assert.match(prompts, /AI_DOC_EDITOR_DEMO_LAYOUT/);
assert.match(prompts, /坐标系：x 范围 0-794, y 范围 0-1123/);
assert.match(sharedCss, /\.ai-doc-chat-messages/);
assert.match(sharedCss, /\.ai-doc-chat-input/);
assert.match(sharedCss, /\.ai-doc-pill-btn/);
assert.match(featureCss, /\.ai-doc-v2/);
assert.doesNotMatch(featureCss, /\.ai-doc-edit-v2/);
assert.doesNotMatch(featureCss, /\.ai-table-v2/);
assert.match(editorCss, /\.ai-doc-edit-v2/);
assert.doesNotMatch(editorCss, /\.ai-table-v2/);
assert.ok(featureCss.split(/\r?\n/).length <= 1200, 'AI Document tool CSS must remain below the oversized-module limit');
assert.ok(editorCss.split(/\r?\n/).length <= 1200, 'AI Document editor CSS must remain below the oversized-module limit');
assert.doesNotMatch(styles, /AI Document · Tool Page 2\.0|AI Table Tool/);

const timers = new Map();
let timerSeed = 0;
const requests = createAiDocumentRequestSession({
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
assert.equal(requests.busy, true);
assert.equal(requests.begin(), null, 'a second request must not start while one is active');
assert.equal(requests.isCurrent(first.id), true);
assert.equal(requests.cancel(), true);
assert.equal(first.signal.aborted, true);
assert.equal(requests.isCurrent(first.id), false, 'cancelled work must become stale before it settles');
assert.equal(requests.finish(first.id), false, 'a cancelled request must not finish as current');
const second = requests.begin();
timers.get([...timers.keys()][0])();
assert.equal(second.signal.aborted, true);
assert.equal(second.timedOut(), true);
assert.equal(requests.finish(second.id), true);
assert.equal(requests.busy, false);
const third = requests.begin();
assert.equal(requests.cancel(second.id), false, 'stale cleanup must not cancel a newer request');
assert.equal(requests.isCurrent(third.id), true);
assert.equal(requests.cancel(third.id), true);

console.log('AI Document lazy-loading, module ownership, lifecycle and injection contracts passed');
