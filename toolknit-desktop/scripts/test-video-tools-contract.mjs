import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, shared, convert, frame, gif, featureStyles, appStyles, nativeRunner, nativeCancel] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/video-tools/shared.js'),
  read('src/features/video-tools/convert-controller.js'),
  read('src/features/video-tools/frame-controller.js'),
  read('src/features/video-tools/gif-controller.js'),
  read('src/features/video-tools/video-tools.css'),
  readGlobalStyles(import.meta.url),
  read('src-tauri/src/native_runtime/runner.rs'),
  read('src-tauri/src/native_runtime/media/preview_jobs.rs')
]);

for (const [toolId, overlayId, initializer] of [
  ['video-convert', 'videoConvertOverlay', 'initVideoConvertTool'],
  ['video-frame', 'videoFrameOverlay', 'initVideoFrameTool'],
  ['video-gif', 'videoGifOverlay', 'initVideoGifTool']
]) {
  const spec = LAZY_TOOL_SPECS[toolId];
  assert.equal(spec?.overlayId, overlayId);
  assert.equal(spec?.init, initializer);
  assert.match(spec.load.toString(), /video-tools\/tool\.js/);
  assert.match(lazyTools, new RegExp(`['"]${toolId}['"]?:\\s*Object\\.freeze\\(`));
  assert.match(html, new RegExp(`id="${overlayId}"`));
}

assert.doesNotMatch(main, /from ['"]\.\/video-(?:convert|frame|gif)-core\.js['"]/);
assert.doesNotMatch(main, /enableSortableFileList/);
assert.doesNotMatch(main, /Video Convert Tool|Video Frame Capture Tool|Video GIF Tool/);
assert.doesNotMatch(appStyles, /\.video-(?:convert|frame|gif)-v2|\.video-media-v2-/);
assert.match(featureStyles, /\.video-frame-body/);
assert.match(featureStyles, /\.video-convert-v2/);
assert.match(featureStyles, /\.video-media-v2-body/);
const lightStyles = await read('src/styles/components/tool-pages.css');
const videoTemplate = await read('src/features/video-tools/template.html');
const videoTool = await read('src/features/video-tools/tool.js');
const videoTheme = await read('src/features/video-tools/video-tools.css');
assert.match(lightStyles, /html:root\[data-theme\] \.pdf-merge-v2 :is\(\[data-audio-convert-files\], #videoConvertFiles\) \.audio-convert-file-item:has\(> \.audio-convert-file-size\)\s*\{\s*grid-template-columns: 28px minmax\(0, 1fr\) max-content 30px;/);
assert.match(lightStyles, /:is\(\[data-audio-convert-files\], #videoConvertFiles\) \.audio-convert-file-size\s*\{\s*color: var\(--tk-muted\);/);
assert.match(videoTemplate, /<select class="video-convert-format-select" id="videoConvertFormatOptions"/);
assert.doesNotMatch(videoTemplate, /id="videoConvertFormatOptions">\s*<button/);
assert.match(videoTool, /enhanceToolSelects/);
assert.match(videoTool, /#videoConvertFormatOptions/);
assert.match(videoTheme, /video-convert-format-select \+ \.tool-custom-select/);
assert.match(videoTemplate, /videoFrameEmpty[\s\S]*tk-empty-hero-action[\s\S]*data-video-pick="frame"/);
assert.match(videoTemplate, /videoGifEmpty[\s\S]*tk-empty-hero-action[\s\S]*data-video-pick="gif"/);
assert.doesNotMatch(videoTemplate, /id="videoFramePick"/);
assert.doesNotMatch(videoTemplate, /id="videoGifPick"/);
assert.match(videoTemplate, /video-frame-control-card/);
assert.match(videoTemplate, /videoFrameCurrentTime/);
assert.match(videoTemplate, /videoFrameDuration/);
for (const id of ['videoFrameResolution', 'videoFrameRate', 'videoFrameFileSize', 'videoFrameStart', 'videoFrameBackFive', 'videoFrameForwardFive', 'videoFrameEnd']) {
  assert.match(videoTemplate, new RegExp(`id="${id}"`));
  assert.match(frame, new RegExp(id));
}
assert.match(frame, /data-video-pick="frame"/);
assert.match(gif, /data-video-pick="gif"/);
assert.match(frame, /event\.key === 'ArrowLeft'|event\.key === "ArrowLeft"/);
assert.match(frame, /event\.key === ' '|'Space'/);
assert.match(frame, /formatFileSize/);
assert.match(featureStyles, /video-frame-control-card/);
assert.match(videoTheme, /video-media-v2-empty/);
assert.match(videoTemplate, /id="videoGifTimelineWrap"[\s\S]*video-gif-timeline-track[\s\S]*video-gif-timeline-selected[\s\S]*id="videoGifTimeline"/);
assert.doesNotMatch(videoTemplate, /video-gif-range-marker|video-gif-playhead|video-gif-connector/);
assert.match(featureStyles, /video-gif-timeline-input::-webkit-slider-thumb/);
assert.match(featureStyles, /video-gif-timeline-input::-moz-range-thumb/);
assert.match(featureStyles, /video-gif-v2-control-card \.audio-convert-format-option/);
assert.match(videoTheme, /html:root\[data-theme\] \.video-gif-v2 \.video-gif-v2-control-card/);
for (const id of ['videoGifSelectStart', 'videoGifSelectEnd', 'videoGifPrev', 'videoGifNext', 'videoGifFrameRate', 'videoGifResolution', 'videoGifQuality', 'videoGifEstimate', 'videoGifExport']) {
  assert.match(videoTemplate, new RegExp(`id="${id}"`));
  assert.match(gif, new RegExp(id));
}

assert.match(shared, /scope\?\.use \? scope\.use\(unlisten\) : unlisten/);
for (const [source, eventName, command] of [
  [convert, 'convert-progress', 'convert_video_batch'],
  [frame, 'video-frame-progress', 'extract_video_frame'],
  [gif, 'video-gif-progress', 'extract_video_gif']
]) {
  assert.match(source, /createLifecycleScope\(/);
  assert.match(source, /open\(\)/);
  assert.match(source, /close\(\)/);
  assert.match(source, /dispose\(\)/);
  assert.match(source, new RegExp(eventName));
  assert.match(source, new RegExp(command));
  assert.match(source, /operation(?:Id|ation)|runId/);
  assert.match(source, /current\(owner\)/);
  assert.match(source, /session\?\.use \? session\.use\(rawUnlisten\) : rawUnlisten/);
  assert.doesNotMatch(source, /innerHTML/);
}

assert.match(frame, /createPreviewPlayback/);
assert.match(frame, /playback\.dispose\(\)/);
assert.match(shared, /createPreviewRequest/);
assert.match(videoTemplate, /id="videoFrameExpandToggle"/);
assert.match(videoTemplate, /id="videoGifExpandToggle"/);
assert.match(gif, /videoGifExpandToggle/);
assert.match(gif, /function setExpanded\(expanded\)/);
assert.match(gif, /is-expanded/);
assert.match(frame, /is-expanded/);
assert.match(nativeRunner, /cancel_video_preview/);
assert.match(nativeCancel, /fn cancel_video_preview/);
assert.match(gif, /stepMs/);
assert.match(gif, /frame_rate/);
assert.match(convert, /disposed/);
assert.match(convert, /completionTimer/);

await import('./test-video-preview-playback.mjs');
console.log('Video tools lazy, lifecycle, CSS ownership and compatibility contract checks passed');
