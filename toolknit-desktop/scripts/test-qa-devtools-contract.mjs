import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertReleaseFilePolicy, isPrivateSkillFile } from './lib/release-file-policy.mjs';

const [runner, devtoolsModule, shortcut, cargo, releaseConfigText, testConfigText] = await Promise.all([
  readFile(new URL('../src-tauri/src/native_runtime/runner.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/platform/qa_devtools.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/platform/qa-devtools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/tauri.test.conf.json', import.meta.url), 'utf8')
]);

const releaseConfig = JSON.parse(releaseConfigText);
const testConfig = JSON.parse(testConfigText);
const releaseWindow = releaseConfig.app.windows.find(window => window.label === 'main');
const testWindow = testConfig.app.windows.find(window => window.label === 'main');

assert.equal(releaseWindow.devtools, false, 'production package must keep DevTools disabled');
assert.deepEqual(releaseConfig.app.security.capabilities, ['default', 'screenshot-windows', 'desktop-feedback'],
  'production must retain only the explicitly scoped capabilities');
assert.match(cargo, /^default\s*=\s*\["custom-protocol"\]/m, 'production default features must not enable QA');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.scripts['build:release-package'], 'tauri build', 'production build must not use QA features or config');
const platform = await readFile(new URL('../src-tauri/src/platform/mod.rs', import.meta.url), 'utf8');
assert.match(platform, /#\[cfg\(feature = "qa-devtools"\)\]\s*pub mod qa_devtools;/,
  'the QA module must be compiled out of production');
assert.equal(testWindow.devtools, true, 'F12 test package must enable DevTools');
assert.match(cargo, /qa-devtools\s*=\s*\["tauri\/devtools"\]/, 'QA feature must enable the Tauri DevTools dependency');
assert.match(runner, /cfg\(feature = "qa-devtools"\)[\s\S]*qa_devtools::install/, 'QA shortcut must only install in the QA build');
assert.match(devtoolsModule, /include_str!\("qa-devtools\.js"\)/, 'QA installer must inject the shortcut script');
assert.match(shortcut, /event\.code !== 'F12'/, 'QA shortcut must listen for F12');
assert.match(shortcut, /plugin:webview\|internal_toggle_devtools/, 'QA shortcut must use the internal DevTools command');
const capabilityIds = testConfig.app.security.capabilities.map(capability => (
  typeof capability === 'string' ? capability : capability.identifier
));
assert.ok(capabilityIds.includes('default'), 'QA config must retain default capabilities');
assert.ok(capabilityIds.includes('screenshot-windows'), 'QA config must retain screenshot auxiliary window capabilities');
assert.ok(capabilityIds.includes('desktop-feedback'), 'QA config must retain desktop feedback listeners');
const feedbackCapability=JSON.parse(await readFile(new URL('../src-tauri/capabilities/desktop-feedback.json',import.meta.url),'utf8'));
assert.deepEqual(feedbackCapability.windows,['screenshot-toast']);
assert.deepEqual(feedbackCapability.permissions,['core:event:allow-listen','core:event:allow-unlisten']);
assert.ok(capabilityIds.includes('qa-devtools'), 'QA config must include the QA capability');

assertReleaseFilePolicy(['dist/assets/main.js', 'dist/assets/fonts/OFL-1.1.txt', 'resources/qpdf/LICENSE.html']);
for (const file of ['dist/SKILL.md', 'public/skills/guide.md', 'dist\\.codex\\skills\\guide.md',
  'dist/.codex-backups/changelog.md', 'dist/docs/V3_STABILITY_REVIEW.zh-CN.md',
  'dist/AGENTS.md', 'dist/tauri.test.conf.json', 'dist/scripts/check.mjs', 'dist/assets/main.js.map']) {
  assert.throws(() => assertReleaseFilePolicy([file]), /must not ship/, `${file} must be excluded`);
}
assert.ok(isPrivateSkillFile('toolknit-desktop/SKILL.md'));
assert.ok(!isPrivateSkillFile('toolknit-desktop/docs/skill-integration.md'));

console.log('QA DevTools contract passed');
