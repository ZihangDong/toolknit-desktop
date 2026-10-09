import { readAppMarkup } from './lib/app-markup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const memoryStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
};
globalThis.document = {
  readyState: 'loading',
  addEventListener: () => {},
  body: { classList: { toggle: () => {} } },
  documentElement: {},
};
globalThis.window = {};

const { HELP_CONTENT, HELP_CONTENT_EN } = await import('../src/help-data.js');

const root = new URL('..', import.meta.url);
const themeIndex = await readFile(new URL('src/styles/themes/index.css', root), 'utf8');
const helpLight = await readFile(new URL('src/styles/themes/help-light.css', root), 'utf8');
assert.match(themeIndex, /@import url\('\.\/help-light\.css'\)/, 'Shared document theme is loaded by the theme entry.');
assert.match(helpLight, /html\[data-theme="light"\] \.help-overlay/, 'Help and legal colors stay scoped to light document pages.');
assert.doesNotMatch(helpLight, /!important|z-index\s*:/, 'Document theme must not compete with modal ownership.');
assert.match(helpLight, /border-color: #000000/, 'Light back hover keeps the requested black outline.');
const indexHtml = await readAppMarkup(import.meta.url);
const zh = JSON.parse(await readFile(new URL('src/locales/zh.json', root), 'utf8'));
const en = JSON.parse(await readFile(new URL('src/locales/en.json', root), 'utf8'));
const builtinI18nKeys = new Set([
  'home.toolNames.jsonTools',
  'home.toolNames.base64',
  'home.toolNames.urlCodec',
  'home.toolNames.uuid',
  'home.toolNames.jwt',
]);

function valuesForAttribute(html, attribute) {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))]
    .map((match) => match[1]);
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value && value[key], object);
}

function unique(values) {
  return [...new Set(values)];
}

const staticI18nKeys = unique([
  ...valuesForAttribute(indexHtml, 'data-i18n'),
  ...valuesForAttribute(indexHtml, 'data-i18n-title'),
  ...valuesForAttribute(indexHtml, 'data-i18n-aria-label'),
  ...valuesForAttribute(indexHtml, 'data-i18n-placeholder'),
  ...valuesForAttribute(indexHtml, 'data-i18n-html'),
]);
for (const key of staticI18nKeys) {
  if (builtinI18nKeys.has(key)) continue;
  assert.notEqual(getPath(zh, key), undefined, `Chinese translation is missing: ${key}`);
  assert.notEqual(getPath(en, key), undefined, `English translation is missing: ${key}`);
}

const helpSections = unique(valuesForAttribute(indexHtml, 'data-help-section'));
assert.ok(helpSections.length > 0, 'Help navigation must include at least one section.');

for (const section of helpSections) {
  assert.ok(HELP_CONTENT[section], `Chinese help content is missing section: ${section}`);
  assert.ok(HELP_CONTENT_EN[section], `English help content is missing section: ${section}`);
}

const visibleHelpSectionSet = new Set(helpSections);
for (const [locale, content] of [['Chinese', HELP_CONTENT], ['English', HELP_CONTENT_EN]]) {
  const retiredSections = Object.keys(content).filter((section) => !visibleHelpSectionSet.has(section));
  assert.deepEqual(retiredSections, [], `${locale} help contains retired sections with no navigation entry: ${retiredSections.join(', ')}`);
}

const helpNavI18n = [...indexHtml.matchAll(/data-help-section="[^"]+"[^>]*data-i18n="([^"]+)"/g)]
  .map((match) => match[1]);
for (const key of helpNavI18n) {
  assert.equal(typeof getPath(zh, key), 'string', `Chinese translation is missing: ${key}`);
  assert.equal(typeof getPath(en, key), 'string', `English translation is missing: ${key}`);
}

const toolToHelp = new Map([
  ['pdf-merge', 'pdf-merge'],
  ['pdf-split', 'pdf-split'],
  ['pdf-page-number', 'pdf-page-number'],
  ['pdf-crop', 'pdf-crop'],
  ['pdf-to-image', 'pdf-to-image'],
  ['pdf-to-scan', 'pdf-to-scan'],
  ['pdf-text-markdown', 'pdf-text-markdown'],
  ['pdf-ai-markdown', 'pdf-ai-markdown'],
  ['pdf-rotate', 'pdf-rotate'],
  ['pdf-encrypt', 'pdf-encrypt'],
  ['pdf-decrypt', 'pdf-decrypt'],
  ['pdf-compress', 'pdf-compress'],
  ['pdf-enhance', 'pdf-enhance'],
  ['pdf-editor', 'pdf-editor'],
  ['excel-to-pdf', 'excel-to-pdf'],
  ['ppt-to-pdf', 'ppt-tools'],
  ['ppt-to-image', 'ppt-tools'],
  ['ppt-images', 'ppt-tools'],
  ['ppt-text', 'ppt-tools'],
  ['ppt-compress', 'ppt-tools'],
  ['ppt-outline', 'ppt-tools'],
  ['ppt-draft', 'ppt-tools'],
  ['image-convert', 'img-convert'],
  ['image-crop', 'img-convert'],
  ['bg-removal', 'img-convert'],
  ['image-compress', 'img-compress'],
  ['image-stitch', 'image-stitch'],
  ['icon-gen', 'icon-gen'],
  ['convert', 'audio-convert'],
  ['bpm-detect', 'bpm-detect'],
  ['audio-clip', 'audio-clip'],
  ['audio-extract', 'audio-extract'],
  ['video-convert', 'video-convert'],
  ['video-frame', 'video-frame'],
  ['video-gif', 'video-gif'],
  ['transcription', 'transcription'],
  ['teleprompter', 'teleprompter'],
  ['text-stats', 'text-stats'],
  ['text-format', 'text-format'],
  ['bmi-calc', 'bmi-calc'],
  ['timestamp-calc', 'timestamp-calc'],
  ['mortgage-calc', 'mortgage-calc'],
  ['interest-calc', 'interest-calc'],
  ['password-gen', 'password-gen'],
  ['color-extractor', 'color-extractor'],
  ['color-space-compare', 'color-space-compare'],
  ['typing-test', 'typing-test'],
  ['large-file-cleanup', 'large-file-cleanup'],
  ['c-drive-cleanup', 'c-drive-cleanup'],
  ['hardware-overview', 'hardware-tools'],
  ['clipboard-history', 'clipboard-history'],
  ['hardware-cpu-memory', 'hardware-tools'],
  ['hardware-gpu-display', 'hardware-tools'],
  ['hardware-mainboard', 'hardware-tools'],
  ['hardware-storage', 'hardware-tools'],
  ['hardware-network-devices', 'hardware-tools'],
  ['hardware-power-sensors', 'hardware-tools'],
  ['markdown-editor', 'developer-tools'],
  ['image-color-replace', 'developer-tools'],
  ['hash-crypto', 'developer-tools'],
  ['json-tools', 'developer-tools'],
  ['base64', 'developer-tools'],
  ['url-codec', 'developer-tools'],
  ['uuid', 'developer-tools'],
  ['jwt', 'developer-tools'],
  ['ai-polish', 'ai-polish'],
  ['ai-translate', 'ai-translate'],
  ['ai-doc', 'ai-doc'],
  ['ai-table', 'ai-table'],
]);

const desktopTools = unique(valuesForAttribute(indexHtml, 'data-tool'));
assert.equal(desktopTools.length, 69, 'Current desktop catalog must contain exactly 69 unique tools.');
for (const tool of desktopTools) {
  const section = toolToHelp.get(tool);
  assert.ok(section, `Desktop tool has no help mapping: ${tool}`);
  assert.ok(HELP_CONTENT[section], `Chinese help is missing for desktop tool: ${tool}`);
  assert.ok(HELP_CONTENT_EN[section], `English help is missing for desktop tool: ${tool}`);
}

for (const content of [HELP_CONTENT, HELP_CONTENT_EN]) {
  const visibleHelp = helpSections.map((section) => `${content[section].title}\n${content[section].html}`).join('\n');
  assert.match(visibleHelp, /CLI/i, 'Visible help must explain CLI.');
  assert.match(visibleHelp, /MCP/i, 'Visible help must explain IDE Agent / MCP.');
  assert.match(visibleHelp, /46/, 'Visible help must state the current 46 MCP capabilities.');
  assert.doesNotMatch(visibleHelp, /16\s*(项能力|capabilities)/i, 'Visible help must not advertise the retired 16-capability count.');
  assert.doesNotMatch(visibleHelp, /(自动检查更新|automatically checks.*update|forced update)/i, 'Visible help must not promise unsupported auto or forced updates.');
}

for (const [locale, section] of [
  ['Chinese', HELP_CONTENT['pdf-to-image']],
  ['English', HELP_CONTENT_EN['pdf-to-image']],
]) {
  const text = `${section.title}\n${section.html}`;
  assert.match(text, /150\s*MB/i, `${locale} PDF-to-image help must state the 150 MB input limit.`);
  assert.match(text, /200\s*(?:页|pages?)/i, `${locale} PDF-to-image help must state the 200-page limit.`);
  for (const dpi of [144, 200, 300]) {
    assert.match(text, new RegExp(`${dpi}\\s*DPI`, 'i'), `${locale} PDF-to-image help must explain the ${dpi} DPI preset.`);
  }
  assert.match(text, /20\s*(?:页|selected pages?)/i, `${locale} PDF-to-image help must state the 20-page long-image limit.`);
  assert.match(text, /(?:每\s*5\s*页|groups? of five)/i, `${locale} PDF-to-image help must explain five-page grouping.`);
  assert.match(text, /(?:打开文件夹|Open Folder)/i, `${locale} PDF-to-image help must explain how to open the output folder.`);
  assert.match(text, /(?:本机|本地|locally)/i, `${locale} PDF-to-image help must explain local processing.`);
  assert.doesNotMatch(text, /(?:界面原型|UI prototype|does not write files yet)/i, `${locale} PDF-to-image help must not describe the retired prototype.`);
}

for (const [locale, content, localeData] of [
  ['Chinese', HELP_CONTENT['ppt-tools'], zh],
  ['English', HELP_CONTENT_EN['ppt-tools'], en],
]) {
  const text = `${content.title}\n${content.html}`;
  assert.match(text, /PNG\s*\/\s*JPG\s*\/\s*WebP/i, `${locale} PPT help must document the supported image formats.`);
  assert.match(
    text,
    locale === 'Chinese'
      ? /PPT 页面不会在此工具中拼成长图/
      : /PPT slides are not stitched into long images in this tool/,
    `${locale} PPT help must state that slides are not stitched into long images.`
  );
  assert.doesNotMatch(localeData.home.pptToImagePage.subtitle, /(?:长图|long[- ]image)/i, `${locale} PPT-to-image subtitle must not advertise long-image export.`);
  assert.doesNotMatch(localeData.home.toolNames.pptToImageDesc, /(?:长图|long[- ]image)/i, `${locale} PPT-to-image list description must not advertise long-image export.`);
  assert.doesNotMatch(localeData.home.toolNames.pptToImageMeta, /(?:长图|long[- ]image)/i, `${locale} PPT-to-image list metadata must not advertise long-image export.`);
}

console.log(`Help center contract passed: ${helpSections.length} visible sections, ${desktopTools.length} desktop tools, ${staticI18nKeys.length} static translation keys.`);
