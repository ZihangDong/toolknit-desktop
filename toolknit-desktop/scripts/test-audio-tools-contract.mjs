import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, entry, bpm, clip, bpmStyles, clipStyles, appStyles, navStyles, themeEntry, bpmLight, clipLight] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/audio-tools/tool.js'),
  read('src/features/audio-tools/bpm-controller.js'),
  read('src/features/audio-tools/clip-controller.js'),
  read('src/features/audio-tools/bpm.css'),
  read('src/features/audio-tools/audio-clip.css'),
  readGlobalStyles(import.meta.url),
  read('src/tool-nav-unified.css'),
  read('src/styles/index.css'),
  read('src/features/audio-tools/bpm.css'),
  read('src/features/audio-tools/audio-clip.css')
]);

for (const [toolId, overlayId, initializer] of [
  ['bpm-detect', 'bpmDetectOverlay', 'initBpmDetectTool'],
  ['audio-clip', 'audioClipOverlay', 'initAudioClipTool']
]) {
  const spec = LAZY_TOOL_SPECS[toolId];
  assert.equal(spec?.overlayId, overlayId);
  assert.equal(spec?.init, initializer);
  assert.match(spec.load.toString(), /audio-tools\/tool\.js/);
  assert.match(lazyTools, new RegExp(`['"]${toolId}['"]?:\\s*Object\\.freeze\\(`));
  assert.match(html, new RegExp(`id="${overlayId}"`));
}

assert.match(entry, /from ['"]\.\/bpm-controller\.js['"]/);
assert.match(entry, /from ['"]\.\/clip-controller\.js['"]/);
assert.match(entry, /import ['"]\.\/bpm\.css['"]/);
assert.match(entry, /import ['"]\.\/audio-clip\.css['"]/);
assert.doesNotMatch(main, /from ['"]\.\/(?:bpm-detect|audio-clip)-core\.js['"]/);
assert.doesNotMatch(main, /BPM Detect Tool|Audio Clip Editor/);
assert.match(main, /toolId === ['"]audio-clip['"]/);

assert.doesNotMatch(appStyles, /\.bpm-(?:detect|demo|result)|\.audio-clip-(?:overlay|v2|waveform|selection|handle|controls|export)/);
assert.match(appStyles, /\.audio-clip-success-overlay/);
assert.match(bpmStyles, /\.bpm-detect-overlay/);
assert.match(bpmStyles, /\.bpm-demo-content/);
assert.doesNotMatch(bpmStyles, /\.audio-clip-(?:overlay|v2|waveform|selection|handle|controls|export)/);
assert.match(clipStyles, /\.audio-clip-overlay/);
assert.match(clipStyles, /\.audio-clip-v2/);
assert.doesNotMatch(clipStyles, /\.bpm-(?:detect|demo|result)/);
assert.match(bpmLight, /html:root\[data-theme\] \.bpm-detect-v2 \.bpm-demo-panel\.visible\s*\{[^}]*background:\s*var\(--bpm-surface\)/);
assert.match(bpmLight, /html:root\[data-theme\] #bpmProcessMask\s*\{[^}]*background:\s*rgba\(var\(--tk-rgb-page\), 0\.96\)/);
assert.match(bpmLight, /\.bpm-timeline-bar\s*\{[^}]*min-width:\s*0/);
assert.match(bpmLight, /grid-auto-rows:\s*max-content/);
assert.match(navStyles, /\.feature-tool-overlay, \.audio-clip-overlay, \.ai-doc-edit-overlay\):not\(\.visible\)/, 'lazy shells must be hidden before feature CSS loads');
assert.match(navStyles, /\.ai-doc-edit-overlay\.ai-doc-edit-v2\.visible\s*\{[\s\S]*?display:\s*grid\s*!important/, 'AI Document editor must restore its grid layout when opened');

for (const source of [bpm, clip]) {
  assert.match(source, /createLifecycleScope\(/);
  assert.match(source, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
  assert.doesNotMatch(source, /from ['"]@tauri-apps\//);
  assert.match(source, /function open\(\)/);
  assert.match(source, /function close\(\)/);
  assert.match(source, /dispose\(\)/);
  assert.match(source, /lifecycle\.use\(unlisten\)/);
}

assert.match(bpm, /import\(['"]music-tempo['"]\)/);
assert.match(bpm, /import\(['"]realtime-bpm-analyzer['"]\)/);
assert.match(bpm, /bpmAnalysisRunId/);
assert.match(bpm, /disposeBpmDemoPlayback/);
assert.match(clip, /loadRevision/);
assert.match(clip, /exportRevision/);
assert.match(clip, /closeAudioContext/);
assert.match(clip, /dragScope/);
assert.match(clip, /context\.setTransform\(dpr/);
assert.match(clip, /invoke\(['"]trim_audio['"]/);
assert.match(clipLight, /--clip-wave-ink:\s*var\(--tk-muted\)/);
assert.match(clipLight, /html:root\[data-theme\] #audioClipProcessMask\s*\{[^}]*background:\s*rgba\(var\(--tk-rgb-page\), 0\.96\)/);
assert.match(clipLight, /grid-auto-rows:\s*max-content/);
assert.match(clip, /getPropertyValue\('--clip-wave-ink'\)/);
assert.match(clip, /attributeFilter:\s*\['data-theme', 'data-theme-config'\]/);
assert.match(clip, /viewScope\.use\(\(\) => observer\.disconnect\(\)\)/);
assert.match(clip, /function close\(\)\s*\{\s*viewScope\?\.dispose\(\)/);

console.log('Audio tools lazy loading, lifecycle, CSS ownership and runtime contract checks passed');
