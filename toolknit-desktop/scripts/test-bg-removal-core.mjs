import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  applyAlphaDabValue,
  canTransitionBgRemovalState,
  commitEditStroke,
  createEditHistory,
  joinNativePath,
  parentDirectoryFromPath,
  redoEditStroke,
  resetEditHistory,
  selectInstalledModels,
  transitionBgRemovalState,
  undoEditStroke
} from '../src/features/bg-removal/core.js';

let state = 'empty';
for (const next of ['processing', 'ready', 'processing', 'editing', 'saving', 'saved']) {
  state = transitionBgRemovalState(state, next);
}
assert.equal(state, 'saved');
assert.equal(canTransitionBgRemovalState('saved', 'editing'), true);
assert.equal(canTransitionBgRemovalState('ready', 'saved'), false);
assert.throws(() => transitionBgRemovalState('ready', 'saved'), /Invalid background-removal transition/);

const history = createEditHistory();
const restore = { mode: 'restore', radius: 10, points: [{ x: 2, y: 3 }] };
const erase = { mode: 'erase', radius: 8, points: [{ x: 5, y: 6 }] };
assert.equal(commitEditStroke(history, restore), true);
assert.equal(commitEditStroke(history, erase), true);
assert.equal(history.strokes.length, 2);
assert.equal(undoEditStroke(history), erase);
assert.equal(history.strokes.length, 1);
assert.equal(history.redo.length, 1);
assert.equal(redoEditStroke(history), erase);
assert.equal(history.strokes.length, 2);
undoEditStroke(history);
commitEditStroke(history, { ...erase, points: [{ x: 9, y: 9 }] });
assert.equal(history.redo.length, 0, 'a new edit must clear the redo branch');
resetEditHistory(history);
assert.deepEqual(history, { strokes: [], redo: [] });

assert.equal(applyAlphaDabValue(0.8, 1, 'erase'), 0);
assert.equal(applyAlphaDabValue(0.2, 1, 'restore'), 1);
assert.ok(Math.abs(applyAlphaDabValue(0.8, 0.5, 'erase') - 0.4) < 1e-9);
assert.ok(Math.abs(applyAlphaDabValue(0.2, 0.5, 'restore') - 0.6) < 1e-9);

const selection = selectInstalledModels([
  { id: 'missing', installed: false, current: true },
  { id: 'modnet', installed: true, current: true },
  { id: 'isnet', installed: true, current: false }
], 'isnet');
assert.deepEqual(selection.installed.map(model => model.id), ['modnet', 'isnet']);
assert.equal(selection.preferred.id, 'isnet');
assert.equal(selectInstalledModels([{ id: 'missing', installed: false }]).preferred, null);

assert.equal(joinNativePath('C:\\Users\\test\\Downloads\\ToolKnit', '背景移除'), 'C:\\Users\\test\\Downloads\\ToolKnit\\背景移除');
assert.equal(joinNativePath('C:\\Users\\test\\Downloads\\ToolKnit\\', '/背景移除/'), 'C:\\Users\\test\\Downloads\\ToolKnit\\背景移除');
assert.equal(joinNativePath('/home/test/ToolKnit/', '背景移除'), '/home/test/ToolKnit/背景移除');
assert.equal(parentDirectoryFromPath('C:\\Users\\test\\Downloads\\ToolKnit\\背景移除\\result.png'), 'C:\\Users\\test\\Downloads\\ToolKnit\\背景移除');
assert.equal(parentDirectoryFromPath('/home/test/ToolKnit/背景移除/result.png'), '/home/test/ToolKnit/背景移除');

const css = await readFile(new URL('../src/features/bg-removal/bg-removal.css', import.meta.url), 'utf8');
const lightCss = await readFile(new URL('../src/styles/themes/bg-removal-light.css', import.meta.url), 'utf8');
assert.match(css, /\.bg-removal-overlay \[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
assert.match(css, /max-width:\s*839px/);
assert.match(css, /\.is-compare[\s\S]*\.bg-removal-canvas-original/);
assert.match(lightCss, /@media \(max-width:\s*839px\)[\s\S]*\.bg-removal-params-button\s*\{[^}]*background:\s*#f5f6f7;[^}]*color:\s*#171717;/,
  'the compact parameter drawer trigger must remain visible in light mode');

const ui = await readFile(new URL('../src/features/bg-removal/tool.js', import.meta.url), 'utf8');
const template = await readFile(new URL('../src/features/bg-removal/template.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const native = await readFile(new URL('../src-tauri/src/onnx_segmenter.rs', import.meta.url), 'utf8');
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
assert.equal((ui.match(/function handleAction\(/g) || []).length, 1, 'actions must be bound through one dispatcher');
assert.equal((ui.match(/function startNativeDragListener\(/g) || []).length, 1, 'native drag listener must have one implementation');
assert.doesNotMatch(ui, /scheduleSave|saveWorking|debounceSegment/);
assert.match(template, /data-bgr-success/, 'export completion must use the standard success dialog');
assert.doesNotMatch(ui + template, /data-bgr-toast|showInlineToast/, 'background removal must not use inline toast feedback');
assert.doesNotMatch(ui + template, /data-bgr-result-path/, 'the workspace must not duplicate the saved output path');
assert.match(ui, /invoke\('open_path', \{ path: savedPath \}\)/, 'open folder must use the exported file path returned by Rust');
assert.doesNotMatch(ui, /invoke\('open_path', \{ path: outputDir \}\)/, 'open folder must not use a predicted output directory');
assert.match(ui, /enhanceToolSelects\(\[modelSelect\]\)/, 'model selection must use the shared white custom dropdown');
assert.match(ui, /modelSelectControl\?\.dispose\(\)/, 'the model dropdown must release its detached menu on disposal');
assert.doesNotMatch(ui, /\[toolbar, zoombar\][\s\S]{0,600}?addEventListener\('pointerdown'/, 'floating controls must not intercept their own pointer-down events during capture');
assert.match(ui, /compareButton\.setPointerCapture\(event\.pointerId\)/, 'hold-to-compare must retain its pointer until release');
assert.match(ui, /compareButton\.addEventListener\('lostpointercapture', releaseCompare/, 'hold-to-compare must recover when pointer capture is lost');
const releaseCompareSource = ui.slice(
  ui.indexOf('const releaseCompare = event => {'),
  ui.indexOf("compareButton.addEventListener('pointerdown'")
);
assert.match(releaseCompareSource, /setCompareHeld\(false\);/, 'releasing compare must restore the processed result');
assert.doesNotMatch(releaseCompareSource, /releaseCompare\(\);/, 'compare release must not recurse');
assert.match(ui, /viewport\.addEventListener\('lostpointercapture'/, 'canvas interactions must recover after lost pointer capture');
assert.match(ui, /window\.addEventListener\('pointerup'/, 'canvas interactions must recover when release happens outside the viewport');
assert.match(ui, /window\.addEventListener\('blur'/, 'canvas interactions must recover when the window loses focus');
assert.match(ui, /document\.elementFromPoint\(clientX, clientY\)/, 'the brush cursor must honor the real pointer hit target');
assert.match(ui, /cursorBlockedByControls/, 'floating controls must explicitly block stale brush-cursor frames');
assert.doesNotMatch(ui, /querySelector\('\.bg-removal-brush-cursor'\)\?\.remove\(\)/, 'the brush cursor must remain a stable node instead of being recreated at control boundaries');
assert.match(ui, /bgRemovalTemplate/, 'the tool entry must delegate markup to the feature template');
assert.doesNotMatch(ui, /function htmlTemplate\(/, 'the tool entry must not retain the markup template');
assert.match(css, /\.bg-removal-zoom-value\s*\{[^}]*font-size:\s*15px/s);
assert.match(css, /\.bg-removal-brush-cursor\s*\{[^}]*pointer-events:\s*none/s, 'the custom brush cursor must never become a pointer target');
assert.match(css, /\.bg-removal-brush-cursor\.is-visible\s*\{[^}]*visibility:\s*visible/s, 'the persistent brush cursor must use an explicit visible state');

const modelCatalog = native.match(/pub const MATTING_MODELS:[\s\S]*?=\s*\[([\s\S]*?)\];/)?.[1] || '';
assert.match(modelCatalog, /id:\s*"modnet"/, 'the supported matting catalog must expose MODNet');
assert.doesNotMatch(modelCatalog, /id:\s*"(?:isnet|u2net)"/, 'models without complete official sources must not be exposed');
assert.doesNotMatch(native, /matting:no-official-source|matting:download-busy/, 'download coordination must not leak internal busy/source errors');
const onnxLoader = await readFile(new URL('../src-tauri/src/platform/onnx_runtime.rs', import.meta.url), 'utf8');
assert.match(native, /crate::platform::onnx_runtime::prepare\(\)/, 'matting must share the process ONNX loader');
assert.match(onnxLoader, /preload_onnx_libraries\(&dll\)/, 'ONNX Runtime must be preloaded before the worker starts');
assert.match(onnxLoader, /static LIBRARIES: OnceLock<Mutex<Vec<libloading::Library>>>/, 'native DLL handles must remain alive for the process');
for (const resource of [
  'resources/onnxruntime/onnxruntime.dll',
  'resources/onnxruntime/DirectML.dll',
  'resources/onnxruntime/msvcp140.dll',
  'resources/onnxruntime/msvcp140_1.dll',
  'resources/onnxruntime/vcruntime140.dll',
  'resources/onnxruntime/vcruntime140_1.dll'
]) {
  assert.ok(tauriConfig.bundle.resources.includes(resource), `Tauri must bundle ${resource}`);
  await access(new URL(`../src-tauri/${resource}`, import.meta.url));
}
assert.match(ui, /runtimeMissing/, 'runtime load failures must have a user-facing error state');
assert.match(template, /data-bgr-execution-mode/, 'compatibility mode must be exposed in tool parameters');
assert.match(ui, /forceCpu:\s*executionModeSelect.value === 'cpu'/, 'the explicit CPU choice must reach the native command');
assert.match(ui, /executionModeControl\?\.dispose\(\)/, 'the execution-mode dropdown must release its detached menu');
assert.match(native, /force_cpu:\s*Option<bool>/, 'old callers must remain compatible without the new CPU argument');
assert.match(native, /pub used_cpu_fallback:\s*bool/, 'callers must be able to distinguish automatic fallback from explicit CPU mode');
for (const language of ['zh', 'en']) {
  const locale = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'));
  for (const key of ['executionModeLabel', 'executionAuto', 'executionCpu', 'cpuFallback', 'backendFailed']) {
    assert.ok(locale.home.bgRemoval[key]?.trim(), `${language} must explain ${key}`);
  }
}
assert.match(main, /let mattingDownloadPromise = null;/, 'matting downloads must share one frontend promise');
assert.match(main, /await installMattingModel\(mattingDownloadSource\)/, 'the dependency gate must reuse the shared matting download and source setting');
assert.match(main, /function openMattingModelManager\(\)\s*\{\s*openSettingsOverlay\(\);/, 'model management must reveal its parent settings page before opening the dialog');
assert.doesNotMatch(main, /console\.info\('\[BgRemoval\] matting model (?:present|missing)/, 'normal model-gate flow must not pollute the console');

console.log('background removal core tests passed');
