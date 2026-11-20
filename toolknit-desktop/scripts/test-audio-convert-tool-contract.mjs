import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import { audioConvertTemplate } from '../src/features/audio-convert/template.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, tool, controller, template, featureStyles, appStyles] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/audio-convert/tool.js'),
  read('src/features/audio-convert/controller.js'),
  read('src/features/audio-convert/template.js'),
  read('src/features/audio-convert/audio-convert.css'),
  readGlobalStyles(import.meta.url)
]);

const spec = LAZY_TOOL_SPECS.convert;
assert.equal(spec?.overlayId, 'audioConvertFeatureOverlay');
assert.equal(spec?.init, 'initAudioConvertTool');
assert.match(spec.load.toString(), /audio-convert\/tool\.js/);
assert.match(lazyTools, /convert:\s*Object\.freeze\(/);
assert.match(html, /<div class="[^"]*feature-tool-overlay[^"]*audio-convert-feature-host[^"]*" id="audioConvertFeatureOverlay"[^>]*><\/div>/);
assert.doesNotMatch(html, /audioConvertOverlay|audioConvertProcessMask|audioConvertSuccessOverlay/);
assert.doesNotMatch(main, /audioConvert(?:Overlay|ProcessMask|SuccessOverlay|Cta|ProcessBtn|Files|FormatOptions)/);
assert.doesNotMatch(main, /from ['"]\.\/audio-convert-core\.js['"]/);
assert.match(tool, /from ['"]\.\/template\.js['"]/);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/audio-convert\.css['"]/);
assert.match(controller, /createLifecycleScope\(/);
assert.match(controller, /queueLifecycle\.dispose\(\)/);
assert.match(controller, /convert_audio_batch/);
assert.match(controller, /cancel_convert/);
assert.match(controller, /convert-progress/);
assert.match(controller, /tauriEvents/);
assert.match(controller, /readNativeAudioFiles/);
assert.doesNotMatch(controller, /size:\s*0\s*\}/, 'native selections must read their actual file sizes');
const { readNativeAudioFiles } = await import('../src/features/audio-convert/selection.js');
const { validateAudioBatchSelection } = await import('../src/audio-convert-core.js');
const calls = [];
const nativeFiles = await readNativeAudioFiles(['C:/qa/one.wav', 'C:/qa/two.mp3'], async (command, args) => {
  calls.push([command, args.path]); return 4096;
});
assert.equal(validateAudioBatchSelection(nativeFiles).length, 2);
assert.deepEqual(calls, [['get_file_size', 'C:/qa/one.wav'], ['get_file_size', 'C:/qa/two.mp3']]);
let current = true;
assert.equal(await readNativeAudioFiles('C:/qa/old.wav', async () => { current = false; return 4096; }, () => current), null,
  'late metadata cannot enter a closed/reopened tool');
const emptyFiles = await readNativeAudioFiles('C:/qa/empty.wav', async () => 0);
assert.throws(() => validateAudioBatchSelection(emptyFiles), /invalid size/, 'real empty files remain rejected');
assert.match(controller, /data-audio-convert-files/);
assert.match(controller, /querySelectorAll\('\[data-audio-convert-action\]'\)/);
assert.match(controller, /website:.*openExternalUrl/s);
assert.match(controller, /support:.*openSupport/s);
assert.doesNotMatch(controller, /document\./);
assert.match(template, /data-audio-convert-action="back"/);
assert.match(template, /data-audio-convert-action="start"/);
assert.match(template, /data-audio-convert-success-path/);
assert.match(featureStyles, /\.audio-convert-feature\.audio-convert-v2/);
assert.doesNotMatch(appStyles, /\.audio-convert-v2 \.pdf-merge-v2-poster::after/);
const lightStyles = await read('src/styles/components/tool-pages.css');
assert.match(lightStyles, /html:root\[data-theme\] \.pdf-merge-v2 :is\(\[data-audio-convert-files\], #videoConvertFiles\) \.audio-convert-file-item:has\(> \.audio-convert-file-size\)\s*\{\s*grid-template-columns: 28px minmax\(0, 1fr\) max-content 30px;/);
assert.match(lightStyles, /:is\(\[data-audio-convert-files\], #videoConvertFiles\) \.audio-convert-file-size\s*\{\s*color: var\(--tk-muted\);/);

const ids = [...audioConvertTemplate().matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, 0, 'audio convert template must use scoped data hooks instead of global IDs');
assert.match(audioConvertTemplate(), /data-audio-convert-action="choose"/);
assert.match(audioConvertTemplate(), /data-audio-convert-action="open-folder"/);

console.log('Audio conversion lazy tool, template and lifecycle contract checks passed');
