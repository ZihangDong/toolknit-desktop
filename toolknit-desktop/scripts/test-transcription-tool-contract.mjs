import { readAppMarkup } from './lib/app-markup.mjs';
import './test-chinese-text.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRefinedTranscriptionResponse, parseTranscriptionSrt } from '../src/features/transcription/core.js';

const [controller, template, tool, featureStyles, lightStyles, themeIndex, lazy, main, index] = await Promise.all([
  readFile(new URL('../src/features/transcription/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/transcription/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/transcription/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/transcription/transcription.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/pages/transcription.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readAppMarkup(import.meta.url)
]);

const parsed = parseTranscriptionSrt('1\n00:00:00,000 --> 00:00:01,000\n你好\n\n2\n00:00:01,000 --> 00:00:02,000\n世界');
assert.deepEqual(parsed.map(segment => segment.text), ['你好', '世界']);
assert.deepEqual(parseTranscriptionSrt('7\n00:00:01,000 --> 00:00:02,000\n總有細碎的溫暖治癒人心 English')[0], {
  id: 7, start: '00:00:01,000', end: '00:00:02,000', text: '总有细碎的温暖治愈人心 English'
});
assert.equal(parseRefinedTranscriptionResponse('{"segments":[{"id":7,"text":"視頻 English"}]}', new Set([7])).get(7), '视频 English');
assert.throws(() => parseRefinedTranscriptionResponse('{"segments":[{"id":1,"text":""}]}', new Set([1])), /Invalid refinement/);
assert.deepEqual([...parseRefinedTranscriptionResponse('```json\n{"segments":[{"id":1,"text":"你好。"}]}\n```', new Set([1])).values()], ['你好。']);

assert.match(tool, /from ['"]\.\/controller\.js['"]/, 'transcription entry must delegate behavior to its controller');
assert.match(tool, /import ['"]\.\/transcription\.css['"]/, 'transcription entry must own its lazy stylesheet');
assert.match(controller, /createLifecycleScope\(\)/, 'transcription controller must own lifecycle cleanup');
assert.match(controller, /lifecycle\.event\(transcriptionProcessBtn/, 'transcription process listener must be scoped');
assert.match(controller, /nativeDragUnlisten = await webview\.onDragDropEvent/, 'native drag listener must be retained');
assert.match(controller, /lifecycle\.use\(\(\) => \{ try \{ nativeDragUnlisten/, 'native drag listener must be released');
assert.match(controller, /transcriptionRemoveFileBtn/, 'transcription must expose a clear-file action');
assert.match(controller, /function clearTranscriptionFile\(\)/, 'clear-file action must reset the selected file');
assert.match(controller, /function resetTranscriptionSession\(/, 'transcription results must expose a full session reset');
assert.match(controller, /setTranscriptionView\('result', \{ focus: true \}\)/, 'completed recognition must replace the operation view with the result view');
assert.match(controller, /setTranscriptionView\('operation', \{ focus: true \}\)/, 'reset must restore and focus the operation view');
assert.match(controller, /const operationToken = lifecycle\.invalidate\(\)/, 'transcription processing must invalidate stale work');
assert.match(controller, /!lifecycle\.isCurrent\(operationToken\)/, 'transcription results must be guarded by the active lifecycle token');
assert.match(controller, /setTranscriptionSuccessVisible\(true\)/, 'transcription completion dialog must become visible');
assert.match(controller, /return \{ open: openTranscriptionTool, close: closeTranscriptionTool, dispose \}/, 'transcription must implement the lifecycle contract');
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//, 'transcription must use the platform boundary');
assert.match(await readFile(new URL('../src-tauri/src/native_runtime/transcription.rs', import.meta.url), 'utf8'), /create_whisper_workspace/, 'Whisper must use a dedicated working directory');
assert.match(await readFile(new URL('../src-tauri/src/native_runtime/transcription.rs', import.meta.url), 'utf8'), /stage_whisper_model/, 'Whisper model must be staged before invoking the Windows CLI');
assert.match(lazy, /transcription:[\s\S]*?\.\/transcription\/tool\.js/, 'transcription must be lazy-registered');
assert.match(main, /toolId === 'transcription'[\s\S]*check_transcription_engine/, 'transcription dependency gate must run before open');
assert.match(featureStyles, /transcription-v2-preview/, 'transcription styles must load with the feature');
assert.match(featureStyles, /transcription-v2-view\[hidden\][\s\S]*display:\s*none\s*!important/, 'inactive transcription views must not occupy workspace space');
assert.match(featureStyles, /transcription-v2-result-view[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/, 'the result view must dedicate its flexible track to subtitle preview');
assert.match(featureStyles, /transcription-v2-preview\.is-empty[\s\S]*min-height:\s*0/, 'empty preview must be allowed to shrink in short windows');
assert.match(lightStyles, /html:root\[data-theme\] \.transcription-v2 \.transcription-v2-preview/, 'transcription preview must define a light surface');
assert.match(lightStyles, /#transcriptionProcessMask/, 'transcription progress mask must support light mode');
assert.match(lightStyles, /#transcriptionSuccessOverlay/, 'transcription success dialog must support light mode');
assert.match(index, /id="transcriptionOverlay"/, 'transcription overlay DOM contract must remain present');
assert.match(index, /id="transcriptionRemoveFileBtn"/, 'transcription selected-file remove button must be present');
assert.match(template, /id="transcriptionOperationView"[^>]*aria-hidden="false"/, 'transcription operation view must be the initial state');
assert.match(template, /id="transcriptionResultView"[^>]*aria-hidden="true"[^>]*hidden[^>]*inert/, 'transcription result view must remain hidden until recognition completes');
assert.match(template, /id="transcriptionEmptyState"/, 'transcription operation view must expose a shared empty state');
assert.match(template, /id="transcriptionResetBtn"/, 'transcription result view must expose a reset action');
assert.doesNotMatch(template, /data-empty=/, 'transcription must not render empty output placeholders before recognition');
assert.doesNotMatch(template, /id="transcriptionFiles"/, 'transcription result view must not render an output file list');
assert.doesNotMatch(template, /transcription-v2-result-files/, 'transcription result view must not render a result attachment list');
assert.match(controller, /transcriptionEmptyState\.hidden = hasFile/, 'empty state must follow whether a media file is selected');
assert.doesNotMatch(controller, /transcriptionFiles/, 'transcription controller must not manage a removed output file list');

console.log('transcription tool contract passed');
