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
const indexHtml = await readFile(new URL('index.html', root), 'utf8');
const zh = JSON.parse(await readFile(new URL('src/locales/zh.json', root), 'utf8'));
const en = JSON.parse(await readFile(new URL('src/locales/en.json', root), 'utf8'));

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
  ['pdf-rotate', 'pdf-rotate'],
  ['pdf-encrypt', 'pdf-encrypt'],
  ['pdf-decrypt', 'pdf-decrypt'],
  ['pdf-compress', 'pdf-compress'],
  ['pdf-enhance', 'pdf-enhance'],
  ['image-convert', 'img-convert'],
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
  ['text-stats', 'text-stats'],
  ['text-format', 'text-format'],
  ['bmi-calc', 'bmi-calc'],
  ['timestamp-calc', 'timestamp-calc'],
  ['mortgage-calc', 'mortgage-calc'],
  ['interest-calc', 'interest-calc'],
  ['password-gen', 'password-gen'],
  ['color-extractor', 'color-extractor'],
  ['typing-test', 'typing-test'],
  ['ai-polish', 'ai-polish'],
  ['ai-translate', 'ai-translate'],
  ['ai-doc', 'ai-doc'],
  ['ai-table', 'ai-table'],
]);

const desktopTools = unique(valuesForAttribute(indexHtml, 'data-tool'));
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
  assert.match(visibleHelp, /30/, 'Visible help must state the current 30 MCP capabilities.');
  assert.doesNotMatch(visibleHelp, /16\s*(项能力|capabilities)/i, 'Visible help must not advertise the retired 16-capability count.');
  assert.doesNotMatch(visibleHelp, /(自动检查更新|automatically checks.*update|forced update)/i, 'Visible help must not promise unsupported auto or forced updates.');
}

console.log(`Help center contract passed: ${helpSections.length} visible sections, ${desktopTools.length} desktop tools.`);
