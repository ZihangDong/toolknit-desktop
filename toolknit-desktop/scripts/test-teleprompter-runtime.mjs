import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createTeleprompterRecognitionController,
  resampleTeleprompterAudio
} from '../src/features/teleprompter/recognition.js';

const source = await readFile(new URL('../src/features/teleprompter/controller.js', import.meta.url), 'utf8');
const templateSource = await readFile(new URL('../src/features/teleprompter/template.js', import.meta.url), 'utf8');
const toolSource = await readFile(new URL('../src/features/teleprompter/tool.js', import.meta.url), 'utf8');
const lightThemeSource = await readFile(
  new URL('../src/features/teleprompter/teleprompter.css', import.meta.url),
  'utf8'
);
const themeIndexSource = await readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8');
const recognitionSource = await readFile(
  new URL('../src/features/teleprompter/recognition.js', import.meta.url),
  'utf8'
);
const start = recognitionSource.indexOf('function startSystemRecognition');
const end = recognitionSource.indexOf('async function stopOfflineRecognition');
assert.ok(start >= 0 && end > start, 'system recognition implementation must exist');
const system = recognitionSource.slice(start, end);

assert.match(source, /toolknit\.teleprompter\.preferences\.v2/);
assert.match(source, /LEGACY_PREF_KEY\s*=\s*'toolknit\.teleprompter\.preferences\.v1'/);
assert.match(source, /engine:\s*isTauri\s*\?\s*'offline'\s*:\s*'auto'/,
  'desktop preferences must default to local recognition');
assert.match(system, /recognition\.onstart\s*=\s*\(\)\s*=>[\s\S]*setStatus\('listening', 'engineListening'\)/,
  'listening is shown only after SpeechRecognition confirms onstart');
assert.doesNotMatch(system, /recognition\.start\(\);\s*setEngineStatus\('listening'/,
  'calling start alone must not claim that recognition is listening');
assert.match(recognitionSource, /systemStartTimeoutMs:\s*3_500/);
assert.match(recognitionSource, /systemFirstResultTimeoutMs:\s*12_000/);
assert.match(system, /createSystemSpeechTranscriptState\(\)/,
  'system finals must survive events and automatic recognition restarts');
assert.match(recognitionSource, /const shouldUseSystem = engine === 'system' \|\| \(!isTauri && engine === 'auto'\)/,
  'desktop automatic mode must use offline recognition first');
assert.match(source, /function usesAutomaticScroll\(\)[\s\S]*recognitionRuntime === 'fallback'/,
  'failed recognition must fall back to normal scrolling');
assert.match(source, /if \(usesAutomaticScroll\(\)\)[\s\S]*setVirtualScrollTop/,
  'the animation loop must continue during recognition fallback');
assert.match(source, /async function chooseEngine[\s\S]*await recognitionController\?\.stop\(\{ updateStatus: false \}\)/,
  'switching engines during playback must release the previous microphone session first');
assert.match(source, /createTeleprompterRecognitionController\(/,
  'the UI entry must inject playback and transcript callbacks into recognition');
assert.match(toolSource, /from ['"]\.\/controller\.js['"]/, 'the feature entry must delegate behavior to its controller');
assert.match(toolSource, /import ['"]\.\/teleprompter\.css['"]/, 'the teleprompter feature must own its lazy stylesheet');
assert.match(templateSource, /data-tele-action="play"/, 'the feature template must retain playback controls');
assert.match(templateSource, /data-tele-engine/, 'the feature template must retain engine controls');
assert.match(lightThemeSource, /html:root\[data-theme\] \.teleprompter-overlay \{[\s\S]*--tele-light-surface:\s*var\(--tk-page-bg\)/,
  'light mode must define a local, maintainable workbench palette');
assert.match(lightThemeSource, /\.teleprompter-input \{[\s\S]*color:\s*var\(--tele-light-ink\)[\s\S]*background-color:\s*var\(--tk-vertical-stripe-surface-color\)/,
  'light mode must keep the script editor readable and preserve the shared stripe surface');
assert.match(lightThemeSource, /\.teleprompter-screen \{[\s\S]*background:\s*#030304/,
  'the prompt screen must stay dark in light mode');
assert.match(lightThemeSource, /\.teleprompter-overlay\.is-focus \{[\s\S]*color-scheme:\s*dark[\s\S]*background:\s*#030304 !important/,
  'focus mode must explicitly remain a dark reading environment');
assert.match(lightThemeSource, /\.teleprompter-overlay\.is-focus \.teleprompter-controls \{[\s\S]*background:\s*rgba\(6, 6, 7, \.96\)/,
  'focus-mode controls must not inherit the light toolbar');
assert.match(lightThemeSource, /body:has\(\.teleprompter-overlay\.visible\) \.tool-custom-select-menu/,
  'the portaled engine menu must be adapted while the teleprompter is visible');
assert.doesNotMatch(source, /let audioContext = null/,
  'AudioContext must be owned by the recognition controller');
assert.match(recognitionSource, /audioProcessor\.onaudioprocess = event =>/);
assert.match(recognitionSource, /stopOfflineRecognition\(\)/);

const timers = new Map();
let nextTimerId = 1;
const fakeWindow = {
  setTimeout(callback) {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    if (id) timers.delete(id);
  }
};
class FakeRecognition {
  static last = null;
  constructor() {
    FakeRecognition.last = this;
    this.startCalls = 0;
    this.abortCalls = 0;
  }
  start() { this.startCalls += 1; }
  abort() { this.abortCalls += 1; }
}
fakeWindow.SpeechRecognition = FakeRecognition;
let playing = true;
const runtimeStates = [];
const statusStates = [];
const transcripts = [];
const recognition = createTeleprompterRecognitionController({
  windowRef: fakeWindow,
  isPlaying: () => playing,
  getVoiceFollow: () => true,
  getEngine: () => 'system',
  getLanguage: () => 'zh',
  setRuntime: value => runtimeStates.push(value),
  setStatus: (state, key) => statusStates.push([state, key]),
  applyTranscript: (...args) => transcripts.push(args),
  copy: key => key
});
await recognition.start();
assert.equal(FakeRecognition.last.startCalls, 1);
assert.equal(statusStates.some(([state, key]) => state === 'listening' && key === 'engineListening'), false,
  'system recognition must not claim listening before onstart');
FakeRecognition.last.onstart();
assert.equal(statusStates.at(-1)[0], 'listening');
FakeRecognition.last.onresult({
  resultIndex: 0,
  results: [{ isFinal: true, 0: { transcript: '你好' } }]
});
assert.equal(transcripts[0][0], '你好');
assert.equal(transcripts[0][1], true);
await recognition.stop();
assert.equal(FakeRecognition.last.abortCalls, 1);
assert.equal(runtimeStates.at(-1), 'idle');
playing = false;
const samples = resampleTeleprompterAudio(new Float32Array([0, 0.5, -0.5, 1]), 16_000);
assert.deepEqual([...samples], [0, 16384, -16384, 32767]);

console.log('teleprompter runtime contract passed');
