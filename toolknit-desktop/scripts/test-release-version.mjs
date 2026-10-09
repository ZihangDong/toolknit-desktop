import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = filePath => readFile(path.join(projectRoot, filePath), 'utf8');
const readJson = async filePath => JSON.parse(await readText(filePath));
const readStaticHtml = async () => (await Promise.all([
  'index.html',
  'src/app/templates/settings.html',
  'src/app/templates/feedback.html',
  'src/app/templates/donation.html',
  'src/app/templates/update-preview.html'
].map(readText))).join('\n');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function captures(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].map(match => match[1]);
}

function captureExactlyOnce(text, pattern, label) {
  const values = captures(text, pattern);
  assert.equal(values.length, 1, `${label} must occur exactly once, found ${values.length}`);
  return values[0];
}

function elementTextById(html, id) {
  const escapedId = escapeRegExp(id);
  return captureExactlyOnce(
    html,
    new RegExp(`<[^>]*\\bid=["']${escapedId}["'][^>]*>\\s*([^<]*?)\\s*</[^>]+>`),
    `#${id}`
  );
}

function tomlSection(text, sectionName) {
  const heading = new RegExp(`^\\[${escapeRegExp(sectionName)}\\]\\s*$`, 'm').exec(text);
  assert.ok(heading, `Cargo.toml must contain [${sectionName}]`);
  const remainder = text.slice(heading.index + heading[0].length);
  const nextHeading = remainder.search(/^\s*\[/m);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

function cargoManifestVersion(text) {
  return captureExactlyOnce(
    tomlSection(text, 'package'),
    /^version\s*=\s*"([^"]+)"\s*$/m,
    'Cargo.toml [package] version'
  );
}

function cargoLockPackageVersion(text, packageName) {
  const blocks = text.split(/(?=^\[\[package\]\]\s*$)/m);
  const matches = blocks.filter(block => new RegExp(`^name\\s*=\\s*"${escapeRegExp(packageName)}"\\s*$`, 'm').test(block));
  assert.equal(matches.length, 1, `Cargo.lock must contain exactly one ${packageName} package, found ${matches.length}`);
  return captureExactlyOnce(matches[0], /^version\s*=\s*"([^"]+)"\s*$/m, `Cargo.lock ${packageName} version`);
}

async function listUiSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listUiSourceFiles(entryPath));
    } else if (entry.isFile() && /\.(?:m?js|html)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function splitExactlyOnce(text, marker, label) {
  const index = text.indexOf(marker);
  assert.notEqual(index, -1, `${label} marker must exist`);
  assert.equal(text.indexOf(marker, index + marker.length), -1, `${label} marker must occur exactly once`);
  return [text.slice(0, index), text.slice(index + marker.length)];
}

function sourceMentions(text, pattern, source) {
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(regex)].map(match => ({
    source,
    line: text.slice(0, match.index).split(/\r?\n/).length,
    version: match[1]
  }));
}

const [
  desktopPackage,
  desktopLock,
  cliPackage,
  cliLock,
  tauriConfig,
  cargoManifest,
  cargoLock,
  cliEntry,
  mcpServer,
  mainSource,
  indexHtml,
  legalSource,
  zhLocale,
  enLocale,
  zhHelpSource,
  enHelpSource,
  repositoryReadme,
  releaseNotes
] = await Promise.all([
  readJson('package.json'),
  readJson('package-lock.json'),
  readJson('cli/package.json'),
  readJson('cli/npm-shrinkwrap.json'),
  readJson('src-tauri/tauri.conf.json'),
  readText('src-tauri/Cargo.toml'),
  readText('src-tauri/Cargo.lock'),
  readText('cli/toolknit.mjs'),
  readText('cli/lib/mcp-server.mjs'),
  readText('src/main.js'),
  readStaticHtml(),
  readText('src/legal-data.js'),
  readJson('src/locales/zh.json'),
  readJson('src/locales/en.json'),
  readText('src/help-data.js'),
  readText('src/help-data-en.js'),
  readText('../README.md'),
  readText('../docs/desktop-update.md')
]);

const fullVersion = desktopPackage.version;
assert.match(fullVersion, /^\d+\.\d+\.\d+$/, 'package.json version must use MAJOR.MINOR.PATCH');
const seriesVersion = fullVersion.split('.').slice(0, 2).join('.');

assert.match(repositoryReadme, new RegExp(`<h1>ToolKnit Desktop ${escapeRegExp(seriesVersion)}<\\/h1>`), 'Repository README heading must match the current release series');
const desktopToolCount = Object.keys(LAZY_TOOL_SPECS).length;
assert.match(repositoryReadme, new RegExp(`<h3>${desktopToolCount}<\\/h3><strong>桌面工具<\\/strong>`), 'Repository README must match the current desktop catalog');
assert.match(zhHelpSource, new RegExp(`${desktopToolCount} 个桌面工具`), 'Chinese help overview must match the desktop catalog');
assert.match(enHelpSource, new RegExp(`${desktopToolCount} desktop tools`), 'English help overview must match the desktop catalog');
assert.match(repositoryReadme, /<h3>46<\/h3><strong>MCP 能力<\/strong>/, 'Repository README must state the 46-capability MCP contract');
assert.match(releaseNotes, new RegExp(`^# ToolKnit Desktop ${escapeRegExp(fullVersion)}\\s*$`, 'm'), 'Release notes heading must match package.json version');
// Published notes retain their release catalog while the next version is developed.
const releasedToolCount = Number(captureExactlyOnce(releaseNotes,
  /^- \d+ 个分类、(\d+) 项工具/m, 'Published desktop catalog'));
const publishedSeriesVersion = captureExactlyOnce(releaseNotes,
  /^## (V\d+\.\d+) 正式版记录/m, 'Published release series');
assert.ok(releasedToolCount > 0 && releasedToolCount <= desktopToolCount,
  'Published catalog must be valid and no larger than the current catalog');
if (releasedToolCount !== desktopToolCount) {
  assert.match(repositoryReadme, new RegExp(`已发布 ${escapeRegExp(publishedSeriesVersion)} 为 ${releasedToolCount} 项`),
    'README must distinguish the published catalog from development additions');
  assert.match(repositoryReadme, /V\d+\.\d+ 开发中/, 'Additional tools must be documented as development work');
}
assert.match(releaseNotes, /46 项已发布能力/, 'Release notes must state the 46-capability CLI and MCP contract');

const manifestVersions = new Map([
  ['package-lock.json version', desktopLock.version],
  ['package-lock.json root package version', desktopLock.packages?.['']?.version],
  ['cli/package.json version', cliPackage.version],
  ['cli/npm-shrinkwrap.json version', cliLock.version],
  ['cli/npm-shrinkwrap.json root package version', cliLock.packages?.['']?.version],
  ['src-tauri/tauri.conf.json version', tauriConfig.version],
  ['src-tauri/Cargo.toml package version', cargoManifestVersion(cargoManifest)],
  ['src-tauri/Cargo.lock package version', cargoLockPackageVersion(cargoLock, 'toolknit-desktop')]
]);

for (const [label, actual] of manifestVersions) {
  assert.equal(actual, fullVersion, `${label} must match package.json version`);
}

const mainWindowConfig = tauriConfig.app?.windows?.find(windowConfig => windowConfig.label === 'main');
assert.ok(mainWindowConfig, 'Tauri config must define the main window');
assert.equal(mainWindowConfig.devtools, false, 'release window configuration must disable DevTools');
assert.doesNotMatch(
  tomlSection(cargoManifest, 'dependencies'),
  /^tauri\s*=.*\bdevtools\b.*$/m,
  'the Tauri release dependency must not enable the devtools feature'
);

const runtimeVersions = new Map([
  ['CLI VERSION', captureExactlyOnce(cliEntry, /const VERSION\s*=\s*'([^']+)'/, 'CLI VERSION')],
  ['MCP SERVER_INFO version', captureExactlyOnce(mcpServer, /const SERVER_INFO\s*=\s*Object\.freeze\(\{[^}]*\bversion:\s*'([^']+)'[^}]*\}\)/, 'MCP SERVER_INFO version')],
  ['APP_VERSION_FALLBACK', captureExactlyOnce(mainSource, /const APP_VERSION_FALLBACK\s*=\s*'([^']+)'/, 'APP_VERSION_FALLBACK')]
]);
runtimeVersions.set('Application runtime fallback', captureExactlyOnce(
  await readText('src/application-runtime.js'),
  /const APP_VERSION_FALLBACK\s*=\s*'([^']+)'/,
  'Application runtime APP_VERSION_FALLBACK'
));

for (const [label, actual] of runtimeVersions) {
  assert.equal(actual, fullVersion, `${label} must match package.json version`);
}

for (const source of [
  'cli/lib/transcription-runtime.mjs',
  'src-tauri/src/ai_provider.rs',
  'src-tauri/src/onnx_segmenter.rs',
  'src-tauri/src/native_runtime/dependencies.rs',
  'src-tauri/src/native_runtime/transcription.rs'
]) {
  const versions = captures(await readText(source), /ToolKnit\/(\d+\.\d+\.\d+)\b/);
  assert.ok(versions.length > 0, `${source} must identify its ToolKnit user agent version`);
  for (const version of versions) assert.equal(version, fullVersion, `${source} user agent version must match package.json`);
}

const previewSource = await readText('src/update-preview.js');
for (const name of ['current', 'latest']) {
  assert.equal(captureExactlyOnce(previewSource, new RegExp(`${name}: '([^']+)'`), `Preview ${name} version`), fullVersion);
  assert.equal(captureExactlyOnce(indexHtml, new RegExp(`data-update-version="${name}">([^<]+)<`), `Preview ${name} markup version`), fullVersion);
}
assert.equal(captureExactlyOnce(indexHtml, /data-update-release="brand-version">(\d+\.\d+) PREVIEW</, 'Preview brand version'), seriesVersion);
assert.equal(captureExactlyOnce(indexHtml, /data-update-release="edition">TOOLKNIT DESKTOP · V(\d+\.\d+)</, 'Preview edition version'), seriesVersion);
for (const source of [previewSource, indexHtml]) {
  for (const version of captures(source, /WHAT(?:\\)?'S NEW · (\d+\.\d+)/)) assert.equal(version, seriesVersion);
}
for (const source of [zhHelpSource, enHelpSource, previewSource, await readText('src/app/templates/update-preview.html')]) {
  for (const version of captures(source, /\bToolKnit (\d+\.\d+)\b/)) assert.equal(version, seriesVersion);
}
assert.match(await readText('../README_EN.md'), new RegExp(`<h1>ToolKnit Desktop ${escapeRegExp(seriesVersion)}<\\/h1>`));
assert.match(await readText('../README_EN.md'), new RegExp(`<h3>${desktopToolCount}<\\/h3><strong>Desktop tools<\\/strong>`), 'English README must match the desktop catalog');

assert.equal(elementTextById(indexHtml, 'settings-version'), `v${fullVersion}`, 'Settings version must match package.json');
assert.equal(elementTextById(indexHtml, 'sidebarVersion'), `v${fullVersion}`, 'Sidebar version must match package.json');
assert.equal(
  captureExactlyOnce(indexHtml, /<footer class="footer-note">[\s\S]*?TOOLKNIT DESKTOP (\d+\.\d+\.\d+)\b[\s\S]*?<\/footer>/, 'Home footer version'),
  fullVersion,
  'Home footer version must match package.json'
);

assert.equal(
  captureExactlyOnce(indexHtml, /ToolKnit (\d+\.\d+) Settings/, 'Settings branding version'),
  seriesVersion,
  'Settings branding must match the current release series'
);
assert.equal(
  captureExactlyOnce(indexHtml, /ToolKnit (\d+\.\d+) Feedback/, 'Feedback branding version'),
  seriesVersion,
  'Feedback branding must match the current release series'
);

const brandVersions = captures(indexHtml, /<span class="home-v2-brand-version">\s*(\d+\.\d+)\s*<\/span>/);
assert.ok(brandVersions.length > 0, 'Current UI must expose at least one home brand version');
assert.equal(
  brandVersions.every(version => version === seriesVersion),
  true,
  `Home brand versions must all be ${seriesVersion}, found: ${brandVersions.join(', ')}`
);

assert.equal(zhLocale.home?.posterKicker, `TOOLKNIT / DESKTOP ${seriesVersion}`, 'Chinese poster branding must match the current release series');
assert.equal(enLocale.home?.posterKicker, `TOOLKNIT / DESKTOP ${seriesVersion}`, 'English poster branding must match the current release series');
assert.equal(
  captureExactlyOnce(zhHelpSource, /<h2>(\d+\.\d+) 开发者工具<\/h2>/, 'Chinese developer-tools help version'),
  seriesVersion,
  'Chinese developer-tools help must match the current release series'
);
assert.equal(
  captureExactlyOnce(enHelpSource, /<h2>Developer Tools in (\d+\.\d+)<\/h2>/, 'English developer-tools help version'),
  seriesVersion,
  'English developer-tools help must match the current release series'
);

const toolPageMentions = sourceMentions(indexHtml, /\bTOOL PAGE (\d+\.\d+)\b/, 'index.html');
for (const filePath of await listUiSourceFiles(path.join(projectRoot, 'src'))) {
  const source = path.relative(projectRoot, filePath).replaceAll('\\', '/');
  toolPageMentions.push(...sourceMentions(await readFile(filePath, 'utf8'), /\bTOOL PAGE (\d+\.\d+)\b/, source));
}
assert.ok(toolPageMentions.length > 0, 'Current UI must expose at least one TOOL PAGE release-series label');
const staleToolPageMentions = toolPageMentions.filter(mention => mention.version !== seriesVersion);
assert.equal(
  staleToolPageMentions.length,
  0,
  `TOOL PAGE labels must all be ${seriesVersion}: ${staleToolPageMentions.map(({ source, line, version }) => `${source}:${line}=${version}`).join(', ')}`
);

const [, afterZhLegalMarker] = splitExactlyOnce(legalSource, 'const LEGAL_CONTENT_ZH = {', 'Chinese legal object');
const [zhLegalSource, afterEnLegalMarker] = splitExactlyOnce(afterZhLegalMarker, 'const LEGAL_CONTENT_EN = {', 'English legal object');
const [enLegalSource] = splitExactlyOnce(afterEnLegalMarker, 'export function getLegalContent()', 'Legal exports');
const [, afterZhDeclarationMarker] = splitExactlyOnce(zhLegalSource, "'declaration': {", 'Chinese declaration');
const [zhDeclarationSource, zhUsageSource] = splitExactlyOnce(afterZhDeclarationMarker, "'usage-policy': {", 'Chinese usage policy');
const [, afterEnDeclarationMarker] = splitExactlyOnce(enLegalSource, "'declaration': {", 'English declaration');
const [enDeclarationSource, enUsageSource] = splitExactlyOnce(afterEnDeclarationMarker, "'usage-policy': {", 'English usage policy');

const legalVersions = new Map([
  ['Chinese declaration footer', captureExactlyOnce(zhDeclarationSource, /适用版本：ToolKnit Desktop (\d+\.\d+\.\d+)/, 'Chinese declaration footer')],
  ['Chinese usage-policy footer', captureExactlyOnce(zhUsageSource, /适用版本：ToolKnit Desktop (\d+\.\d+\.\d+)/, 'Chinese usage-policy footer')],
  ['English declaration footer', captureExactlyOnce(enDeclarationSource, /Applies to: ToolKnit Desktop (\d+\.\d+\.\d+)/, 'English declaration footer')],
  ['English usage-policy footer', captureExactlyOnce(enUsageSource, /Applies to: ToolKnit Desktop (\d+\.\d+\.\d+)/, 'English usage-policy footer')],
  ['Chinese declaration introduction', captureExactlyOnce(zhDeclarationSource, /本声明适用于 ToolKnit Desktop (\d+\.\d+\.\d+)/, 'Chinese declaration introduction')],
  ['English declaration introduction', captureExactlyOnce(enDeclarationSource, /This declaration applies to ToolKnit Desktop (\d+\.\d+\.\d+)/, 'English declaration introduction')]
]);
for (const [label, actual] of legalVersions) {
  assert.equal(actual, fullVersion, `${label} must match package.json version`);
}
assert.match(zhUsageSource, /随当前功能边界更新/, 'Chinese usage policy must use a version-independent feature boundary');
assert.match(enUsageSource, /with the current feature boundary/, 'English usage policy must use a version-independent feature boundary');

assert.match(zhLocale.home?.supportCostNote ?? '', /500/, 'Chinese home support copy must state the monthly AI cost');
assert.match(enLocale.home?.supportCostNote ?? '', /500/, 'English home support copy must state the monthly AI cost');
assert.match(zhLocale.home?.supportPage?.supporterBenefit ?? '', /灰度体验群/, 'Chinese support copy must explain preview-group access');
assert.match(enLocale.home?.supportPage?.supporterBenefit ?? '', /preview group/i, 'English support copy must explain preview-group access');
assert.match(zhLegalSource, /灰度体验群/, 'Chinese legal copy must define the preview-group boundary');
assert.match(enLegalSource, /preview group/i, 'English legal copy must define the preview-group boundary');

console.log(`Release version contract passed for ${fullVersion}: ${manifestVersions.size} manifests, ${runtimeVersions.size} runtime constants, ${toolPageMentions.length} tool-page labels, and 4 legal notices.`);
