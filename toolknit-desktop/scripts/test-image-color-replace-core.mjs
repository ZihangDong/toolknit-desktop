import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COLOR_REPLACE_LIMITS, deltaE76, hexToRgb, replaceImageColors, rgbToHex, sampleRgbaPixel } from '../src/features/image-color-replace/core.js';
import { rgbToHex as compatibleRgbToHex } from '../src/image-color-replace-core.js';

assert.equal(COLOR_REPLACE_LIMITS.maxBytes, 100 * 1024 * 1024);
assert.equal(COLOR_REPLACE_LIMITS.maxPixels, 160_000_000);

assert.deepEqual(hexToRgb('#2D7AD2'), [45, 122, 210]);
assert.equal(rgbToHex([45, 122, 210]), '#2D7AD2');
assert.equal(compatibleRgbToHex, rgbToHex, 'the legacy core path must re-export the feature implementation');
assert.equal(deltaE76([50, 0, 0], [50, 0, 0]), 0);

const source = new Uint8ClampedArray([
  255,255,255,255, 255,255,255,255, 0,0,0,255, 255,255,255,255,
  255,255,255,255, 255,255,255,255, 0,0,0,255, 255,255,255,255,
  0,0,0,255,       0,0,0,255,       0,0,0,255, 255,255,255,255
]);
const smart = replaceImageColors(source, 4, 3, { source:[255,255,255], target:[0,0,255], threshold:2, softness:0, smart:true, seedX:0, seedY:0, preserveLuminance:false });
assert.equal(smart.changedPixels, 4, 'only the connected white region must change');
assert.deepEqual(sampleRgbaPixel(smart.data, 4, 3, 0, 0), [0,0,255,255]);
assert.deepEqual(sampleRgbaPixel(smart.data, 4, 3, 3, 2), [255,255,255,255]);
const global = replaceImageColors(source, 4, 3, { source:[255,255,255], target:[0,0,255], threshold:2, softness:0, smart:false, preserveLuminance:false });
assert.equal(global.changedPixels, 7, 'global mode must replace disconnected matches');

const featherSource = new Uint8ClampedArray([255,255,255,255, 250,250,250,255]);
const hardEdge = replaceImageColors(featherSource, 2, 1, { source:[255,255,255], target:[0,0,255], threshold:5, softness:0, smart:false, preserveLuminance:false });
assert.deepEqual(sampleRgbaPixel(hardEdge.data, 2, 1, 1, 0), [0,0,255,255], 'softness=0 must produce a hard replacement edge');

const uiSource = await readFile(new URL('../src/features/image-color-replace/tool.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/features/image-color-replace/controller.js', import.meta.url), 'utf8');
const templateSource = await readFile(new URL('../src/features/image-color-replace/template.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/features/image-color-replace/worker.js', import.meta.url), 'utf8');
const uiStyles = await readFile(new URL('../src/features/image-color-replace/image-color-replace.css', import.meta.url), 'utf8');
const lazyToolsSource = await readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8');
const compatibilitySource = await readFile(new URL('../src/image-color-replace-ui.js', import.meta.url), 'utf8');
const globalStyles = await readGlobalStyles(import.meta.url);
const finalToolStyles = await readFile(new URL('../src/tool-page-v2-final.css', import.meta.url), 'utf8');
const themeIndex = await readFile(new URL('../src/styles/index.css', import.meta.url), 'utf8');
const lightTheme = await readFile(new URL('../src/features/image-color-replace/image-color-replace.css', import.meta.url), 'utf8');

assert.match(uiSource, /from ['"]\.\/template\.js['"]/, 'the tool must delegate its markup to the feature template');
assert.match(uiSource, /from ['"]\.\/controller\.js['"]/, 'the tool entry must delegate runtime behavior to the feature controller');
assert.match(uiSource, /import ['"]\.\/image-color-replace\.css['"]/, 'the lazy feature must own and load its stylesheet');
assert.match(uiSource, /isTauri = false/, 'the tool entry must receive the current runtime mode');
assert.match(uiSource, /createImageColorReplaceController\(\{ overlay, isTauri, notify \}\)/, 'the tool entry must pass the runtime mode to the controller');
assert.doesNotMatch(uiSource, /<main class="tool-page-v2-body color-replace-main">/, 'the controller must not retain the page template');
assert.match(templateSource, /data-cr-eyedropper/, 'the feature template must retain the eyedropper contract');
assert.match(templateSource, /data-cr-export/, 'the feature template must retain the export contract');
assert.match(templateSource, /color-replace-empty tk-empty-hero/, 'the empty workspace must reuse the shared image-tool hero');
assert.match(controllerSource, /new URL\('\.\/worker\.js',\s*import\.meta\.url\)/, 'the preview Worker must resolve inside the feature boundary');
assert.match(controllerSource, /createLifecycleScope\(\)/, 'the controller must own permanent DOM listener cleanup');
assert.match(controllerSource, /return \{ open, close, dispose \}/, 'the controller must expose the complete lifecycle contract');
assert.match(controllerSource, /q\('\[data-cr-eyedropper\]'\)\.classList\.add\('is-active'\)/, 'reopening must restore the eyedropper button and canvas to the same active state');
assert.match(controllerSource, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/, 'native commands must cross the platform boundary');
assert.doesNotMatch(controllerSource, /from ['"]@tauri-apps\/api\/core['"]/, 'the feature controller must not import Tauri core directly');
assert.doesNotMatch(controllerSource, /import\(['"]@tauri-apps\/plugin-dialog['"]\)/, 'the feature controller must load dialogs through the platform boundary');
assert.match(controllerSource, /if \(isTauri\) \{[\s\S]*?loadTauriDialog\(\)/, 'desktop image selection must retain the native dialog path');
assert.match(controllerSource, /input\.type = 'file'/, 'browser preview must use a browser file input');
assert.match(controllerSource, /URL\.createObjectURL\(file\)/, 'browser preview must decode the selected File locally');
assert.match(controllerSource, /if \(!isTauri\) \{[\s\S]*?renderBrowserExport\(operationId\)/, 'browser export must avoid native commands');
assert.match(controllerSource, /new Worker\(new URL\('\.\/worker\.js', import\.meta\.url\)/, 'browser full-resolution export must stay off the renderer thread');
assert.match(workerSource, /from ['"]\.\/core\.js['"]/, 'the Worker must consume the feature core directly');
assert.match(lazyToolsSource, /'image-color-replace':[\s\S]*?import\('\.\/image-color-replace\/tool\.js'\)/, 'the lazy registry must load the feature entry directly');
assert.match(compatibilitySource, /from ['"]\.\/features\/image-color-replace\/tool\.js['"]/, 'the legacy UI path must only forward to the feature entry');
assert.doesNotMatch(globalStyles, /(?:\.color-replace|\.color-pair|\.color-swatch|\.color-target-picker)/, 'global styles must not retain image-color-replace selectors');
assert.doesNotMatch(finalToolStyles, /(?:\.color-replace|\.color-pair|\.color-swatch|\.color-target-picker)/, 'the final shared layer must not retain image-color-replace selectors');
assert.match(controllerSource, /className = 'color-replace-output-link'/, 'export result must render a dedicated clickable path');
assert.match(controllerSource, /invoke\('open_path', \{ path \}\)/, 'clicking the exported path must open its containing folder');
assert.match(controllerSource, /rawPath\.startsWith\('\\\\\\\\\?\\\\'\)/, 'Windows extended path prefix must be removed for Explorer');
assert.match(uiStyles, /\.color-replace-output-link\s*\{[^}]*color:\s*#0969da/s, 'exported path must use blue link styling');
assert.match(lightTheme, /html:root\[data-theme\] \.color-replace-shell/, 'color replacement light styles must stay scoped to the feature shell');
assert.match(lightTheme, /\.color-replace-shell > \.tool-page-v2-bg\s*\{[^}]*display:\s*none/s, 'the light workspace must not expose the shared dark background layer');
assert.doesNotMatch(lightTheme, /tool-page-v2-back|--tool-back-static-outline|--tool-back-hover-outline/, 'feature light themes defer back button visuals to shared navigation');
assert.match(lightTheme, /\.color-replace-stage-actions \[data-cr-export\]:disabled/, 'the light theme must preserve a distinct disabled export state');
console.log('image color replacement core tests passed');
