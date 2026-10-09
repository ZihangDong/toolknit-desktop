import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [
  tool,
  controller,
  template,
  previewSecurity,
  compatibilityUi,
  compatibilityCore,
  featureStyles,
  themeStyles,
  themeIndex,
  appStyles,
  finalToolStyles
] = await Promise.all([
  read('../src/features/markdown-editor/tool.js'),
  read('../src/features/markdown-editor/controller.js'),
  read('../src/features/markdown-editor/template.js'),
  read('../src/features/markdown-editor/preview-security.js'),
  read('../src/markdown-editor-ui.js'),
  read('../src/markdown-editor-core.js'),
  read('../src/features/markdown-editor/markdown-editor.css'),
  read('../src/styles/themes/markdown-editor-light.css'),
  read('../src/styles/themes/index.css'),
  readGlobalStyles(import.meta.url),
  read('../src/tool-page-v2-final.css')
]);

assert.match(tool, /from ['"]\.\/template\.js['"]/);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/markdown-editor\.css['"]/);
assert.match(controller, /createLifecycleScope\(\)/);
assert.match(controller, /lifecycle\.event\(overlay, ['"]click['"]/);
assert.match(controller, /lifecycle\.use\(bindToolPageChrome\(shell, close\)\)/);
assert.match(controller, /owner\.use\(mountToolPageBackground\(shell\)\)/);
assert.match(controller, /isOpenSession\(owner\)/);
assert.match(controller, /htmlLabels: false/, 'Mermaid labels must stay in sanitizable native SVG text');
assert.match(controller, /function importMarkdown\(markdownText, sourceName = ''\)/);
assert.match(controller, /localStorage\.removeItem\(MARKDOWN_ASSET_KEY\)/);
assert.match(controller, /return \{ open, close, dispose, importMarkdown \}/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//);
assert.doesNotMatch(controller, /\.addEventListener\(/);
assert.match(template, /data-lucide="save"/);
assert.doesNotMatch(template, /data-lucide="cloud-check"/);
assert.match(template, /data-md-export="md"/);
assert.match(template, /data-md-export="html"/);
assert.match(template, /data-lucide="file-down"/);
assert.match(template, /data-lucide="file-code-2"/);
assert.match(template, /data-md-expand aria-pressed="false"/);
assert.match(template, /id="mdExportSuccessTitle"/);
assert.match(template, /data-md-export-success aria-hidden="true" inert/);
assert.match(controller, /createModalSession\(\{ root: successOverlay, background: shell/);
assert.match(controller, /showExportResult\(\{ format, path: result\.markdown_path, directory: result\.directory/);
assert.match(controller, /getOutputDir\('Markdown'\)/);
assert.match(controller, /setModalInteractivity\(overlay, false\)/);
assert.match(template, /tool-page-v2-shell tool-page-v2-light md-tool-shell/, 'Markdown must opt into the shared daytime shell');
assert.match(previewSecurity, /template\.content\.querySelectorAll\(['"]img['"]\)/);
assert.match(previewSecurity, /template\.content\.querySelectorAll\(['"]a['"]\)/);
assert.match(previewSecurity, /link\.removeAttribute\(['"]target['"]\)/);
assert.match(previewSecurity, /link\.setAttribute\(['"]rel['"], ['"]noopener noreferrer['"]\)/);
assert.match(previewSecurity, /!\['http:', 'https:'\]\.includes\(parsed\.protocol\)/);
assert.match(compatibilityUi, /from ['"]\.\/features\/markdown-editor\/tool\.js['"]/);
assert.match(compatibilityCore, /from ['"]\.\/features\/markdown-editor\/core\.js['"]/);
assert.match(featureStyles, /\.md-workbench\s*\{/);
assert.match(featureStyles, /\.md-export-group\s*\{/);
const previewBackgrounds = [...featureStyles.matchAll(/^\.md-preview-pane[ \t]*\{([^\r\n}]*)\}/gm)]
  .map(match => /\bbackground:\s*([^;]+);/.exec(match[1])?.[1]).filter(Boolean);
assert.ok(previewBackgrounds.length > 0);
assert.ok(previewBackgrounds.every(color => color === '#fff'), 'preview backgrounds must stay opaque white');
assert.match(themeIndex, /@import url\('\.\/markdown-editor-light\.css'\);/, 'the daytime theme index must load Markdown styles');
assert.match(themeStyles, /\.md-tool-shell > \.tool-page-v2-bg[\s\S]*display: none !important/, 'the daytime theme must suppress the dark background runtime');
assert.match(themeStyles, /html\[data-theme="light"\] \.md-tool-shell \.md-outline-panel/, 'the daytime theme must cover the document rail');
assert.match(themeStyles, /html\[data-theme="light"\] \.md-tool-shell \.md-toolbar/, 'the daytime theme must cover the editor toolbar');
assert.match(themeStyles, /html\[data-theme="light"\] \.md-tool-shell \.md-codemirror \.cm-editor/, 'the daytime theme must cover CodeMirror');
assert.match(themeStyles, /html\[data-theme="light"\] \.md-tool-shell \.md-help-page/, 'the daytime theme must cover the syntax reference');
assert.match(
  featureStyles,
  /\.md-editor-view\[data-view="preview"\] \.md-input-pane,[\s\S]*\.md-editor-view\[data-view="editor"\] \.md-preview-pane[\s\S]*display: none !important/,
  'single-pane view modes must outrank the shared pane display rule'
);
assert.match(featureStyles, /\.markdown-body \.mermaid svg[\s\S]*width: 100% !important/, 'Mermaid diagrams must outrank the global overlay icon size');
assert.match(featureStyles, /@media \(max-width: 760px\)[\s\S]*data-view="split"[\s\S]*\.md-preview-pane[\s\S]*display: none !important/, 'narrow split mode must not leave an unreachable second pane');
assert.doesNotMatch(
  appStyles + finalToolStyles,
  /\.md-|\.markdown-body|\.markdown-editor-overlay/,
  'shared stylesheets must not retain Markdown editor selectors'
);
assert.equal(LAZY_TOOL_SPECS['markdown-editor']?.overlayId, 'markdownEditorOverlay');
assert.match(
  LAZY_TOOL_SPECS['markdown-editor'].load.toString(),
  /\.\/markdown-editor\/tool\.js/,
  'Markdown must load the feature entry directly'
);

console.log('markdown editor feature contract checks passed');
