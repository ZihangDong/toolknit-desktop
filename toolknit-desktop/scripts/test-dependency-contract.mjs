import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDependencyHelpers, updateDependencyProgress, overallDependencyProgress } from '../src/app/dependency-helpers.js';

const [html, main, styles, rust, zh, en] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8').then(async main => `${main}\n${await readFile(new URL('../src/application-runtime.js', import.meta.url), 'utf8')}`),
  readGlobalStyles(import.meta.url),
  Promise.all([
    'native_runtime.rs',
    'native_runtime/core.rs',
    'native_runtime/dependencies.rs',
    'platform/dependency_download.rs',
    'platform/runtime_discovery.rs',
    'native_runtime/dependencies/libreoffice_install.rs',
    'native_runtime/dependencies/libreoffice_extract.rs',
    'native_runtime/office/probe.rs',
    'native_runtime/transcription.rs',
    'native_runtime/pdf.rs',
    'native_runtime/image.rs',
    'native_runtime/media.rs',
    'native_runtime/system.rs',
    'native_runtime/office.rs',
    'native_runtime/office/ppt.rs',
    'native_runtime/runner.rs',
    'native_runtime/tests.rs'
  ].map(relativePath => readFile(new URL(`../src-tauri/src/${relativePath}`, import.meta.url), 'utf8')))
    .then(parts => parts.join('\n')),
  readFile(new URL('../src/locales/zh.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8').then(JSON.parse)
]);

const audioSection = html.match(/<div class="content-section" data-category="audio">[\s\S]*?<div class="content-section" data-category="video">/)?.[0] || '';
const textSection = html.match(/<div class="content-section" data-category="text">[\s\S]*?<div class="content-section" data-category="calculator">/)?.[0] || '';
assert.doesNotMatch(audioSection, /data-tool="transcription"/, 'transcription must not remain in the audio category');
assert.match(textSection, /data-tool="transcription"[\s\S]*?home\.toolNames\.textCategoryTag/, 'transcription must be listed under text tools');

assert.match(html, /id="dependencyGateOverlay"[\s\S]*?audio-convert-success-dialog dependency-gate-dialog/, 'dependency gate must reuse the white result-dialog layout');
assert.match(html, /id="dependencyGateCancel"[\s\S]*?id="dependencyGateInstall"/, 'dependency gate must provide cancel and install-all actions');
assert.match(styles, /\.dependency-gate-overlay\s*\{[\s\S]*?z-index:\s*1400/, 'dependency gate must stay above tool overlays');

assert.match(main, /showDependencyGate\(\{ openFn, needsFfmpeg: true, needsModel: false \}\)/, 'FFmpeg tools must open the dependency gate');
assert.match(main, /download_transcription_model'[\s\S]*?modelId:\s*'small'/, 'transcription dependency install must default to Whisper Small');
assert.match(main, /invoke\('cancel_dependency_downloads'\)/, 'dependency downloads must be cancellable');
assert.match(main, /function resolvedModelDownloadSource\(\)[\s\S]*?'auto-official' : 'auto-china'/, 'legacy automatic source preferences remain accepted');

assert.match(rust, /https:\/\/toolknit-downloads-u1ll6equ\.cdn\.7caiyun\.com\/runtime\/ffmpeg\/ffmpeg-6\.1\.6-toolknit-r3-win32-x64\.gz/, 'FFmpeg downloads must use the versioned traceable build at the pinned 7Caiyun origin');
assert.doesNotMatch(rust, /cdn\.npmmirror\.com\/binaries\/ffmpeg-static|gh-proxy\.com\/https:\/\/github\.com\/eugeneware/, 'old FFmpeg mirrors must not remain active');
assert.match(rust, /const FFMPEG_ARCHIVE_BYTES: u64 = 14_642_939;/, 'FFmpeg download must use the verified traceable binary size');
assert.match(rust, /c4f982b2f82dda95e079bd26129435640bc31d36d05308fada77cebc47a61fe3/, 'FFmpeg archive hash must match the published traceable build');
assert.match(rust, /reqwest::header::RANGE/, 'FFmpeg downloads must support resume');
assert.match(rust, /FFMPEG_ARCHIVE_SHA256/, 'FFmpeg downloads must be integrity checked');
assert.match(rust, /TOOLKNIT_FFMPEG_PATH/, 'FFmpeg detection must support an explicit system path');
assert.match(rust, /Microsoft[\s\S]*WinGet[\s\S]*Links/, 'FFmpeg detection must check the Winget link directory');
assert.match(rust, /system:scoop/, 'FFmpeg detection must check the Scoop shim directory');
assert.match(rust, /system:chocolatey/, 'FFmpeg detection must check the Chocolatey bin directory');
assert.match(rust, /FFMPEG_PROBE_TIMEOUT_MS/, 'FFmpeg candidates must be verified with a bounded process probe');
assert.match(rust, /fn libreoffice_candidates\(\)/, 'LibreOffice detection must use bounded known-path candidates');
assert.match(rust, /ProgramFiles\(x86\)/, 'LibreOffice detection must include standard Windows install directories');
assert.match(main, /isManagedRuntime\(ffmpegRuntimeStatus\)/, 'system FFmpeg installations must not expose ToolKnit delete actions');
assert.match(main, /isManagedRuntime\(libreOfficeRuntimeStatus\)/, 'system LibreOffice installations must not expose ToolKnit delete actions');
assert.match(rust, /fn cancel_dependency_downloads\(\)/, 'the native layer must expose dependency cancellation');

for (const locale of [zh, en]) {
  assert.ok(locale.home?.dependencies?.installAll);
  assert.ok(locale.home?.dependencies?.transcriptionDesc);
  const translate = (key, values = {}) => key.split('.').reduce((value, part) => value?.[part], locale)
    ?.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  const helpers = createDependencyHelpers({ translate });
  for (const [code, key] of Object.entries({ timeout: 'downloadTimeout', network: 'downloadNetwork', range: 'downloadIntegrity', storage: 'downloadStorage', cancelled: 'downloadCancelled' })) {
    assert.equal(helpers.dependencyErrorMessage(`mirror: dependency-download:${code}`), locale.home.dependencies[key]);
    assert.equal(typeof locale.home.dependencies[key], 'string');
  }
  const state = { needsLibreOffice: true, downloading: true, libreOfficeProgress: null, libreOfficeComplete: false };
  assert.equal(updateDependencyProgress(state, 'libreoffice', { phase: 'downloading', downloaded_bytes: 50, total_bytes: 100 }), true);
  assert.equal(overallDependencyProgress(state), 50);
  assert.ok(helpers.dependencyStatusText('libreoffice', state.libreOfficeProgress, state.libreOfficeComplete).endsWith('50%'));
  for (const phase of ['installing', 'verifying', 'complete']) {
    updateDependencyProgress(state, 'libreoffice', { phase });
    assert.equal(helpers.dependencyStatusText('libreoffice', state.libreOfficeProgress, state.libreOfficeComplete), locale.home.dependencies[phase === 'complete' ? 'ready' : phase]);
  }
  assert.equal(state.libreOfficeComplete, true);
  state.downloading = false;
  assert.equal(updateDependencyProgress(state, 'libreoffice', { phase: 'downloading' }), false);
  state.downloading = true;
  updateDependencyProgress(state, 'libreoffice', { phase: 'downloading' });
  assert.equal(state.libreOfficeComplete, false, 'retry clears stale completion');
  assert.equal(overallDependencyProgress(state), 0);
  const mixed = { needsFfmpeg: true, needsModel: true, needsLibreOffice: true, downloading: true };
  updateDependencyProgress(mixed, 'ffmpeg', { phase: 'complete' });
  updateDependencyProgress(mixed, 'model', { phase: 'downloading', downloaded_bytes: 50, total_bytes: 100 });
  updateDependencyProgress(mixed, 'libreoffice', { phase: 'downloading', downloaded_bytes: 0, total_bytes: 100 });
  assert.equal(overallDependencyProgress(mixed), 50);
  assert.equal(updateDependencyProgress(mixed, '__proto__', {}), false);
  assert.equal(helpers.dependencyErrorMessage('libreoffice-runtime:missing-library:0xC0000135'), `${locale.home.dependencies.officeMissingLibrary} (missing-library: 0xC0000135)`);
  assert.equal(helpers.dependencyErrorMessage('network error'), 'network error');
  assert.equal(helpers.dependencyStatusText('libreoffice', { phase: 'installing' }, false, true), locale.home.dependencies.failedStatus);
  for (const [code, key] of [
    ['extract-stalled', 'officeExtractStalled'], ['extract-timeout', 'officeExtractTimeout'],
    ['installer-busy', 'officeInstallerBusy'], ['installer-policy', 'officeInstallerPolicy']
  ]) {
    const detail = 'action=InstallFiles_elapsed=310s_idle=300s_files=12000';
    assert.ok(locale.home.dependencies[key], `${key} has a translation`);
    assert.equal(helpers.dependencyErrorMessage(new Error(`libreoffice-runtime:${code}:${detail}`)),
      `${locale.home.dependencies[key]} (${code}: ${detail})`);
  }
  for (const progress of [undefined, { phase: 'installing' }, { extraction: {} }, { extraction: { elapsed_seconds: NaN } }]) {
    assert.equal(helpers.dependencyInstallingDetail('LibreOffice', progress), translate('home.dependencies.installingDetail', { name: 'LibreOffice' }), 'older progress events keep the existing detail');
  }
  const extraction = { elapsed_seconds: 181.9, extracted_files: 12000, extracted_bytes: 1048576 };
  assert.equal(helpers.dependencyInstallingDetail('LibreOffice', { extraction }),
    translate('home.dependencies.officeExtractingDetail', { files: 12000, size: '1.0 MB', elapsed: '3:01' }));
  assert.equal(helpers.dependencyInstallingDetail('LibreOffice', { extraction: { elapsed_seconds: -1, extracted_files: 0 } }),
    translate('home.dependencies.officePreparingDetail', { elapsed: '0:00' }));
  updateDependencyProgress(state, 'libreoffice', { phase: 'installing', extraction });
  assert.equal(state.libreOfficeProgress.extraction, extraction, 'additional extraction fields survive the state mapping');
}

assert.match(main, /updateDependencyProgress\(dependencyGateState, type, progress\)/);
assert.match(main, /overallDependencyProgress\(state\)/);
assert.match(rust, /if resume_from < LIBREOFFICE_ARCHIVE_BYTES/);
assert.match(rust, /IDLE_LIMIT: Duration = Duration::from_secs\(300\)/);
assert.match(rust, /TOTAL_LIMIT: Duration = Duration::from_secs\(1800\)/);
assert.match(rust, /"\/L\*v"/);
assert.doesNotMatch(rust, /\/L\*v!/, 'per-file verbose log flushing must not slow down extraction');
assert.match(main, /dependencyInstallingDetail\('LibreOffice', libreOfficeRuntimeProgress\)/);
assert.match(main, /dependencyStatusText\('libreoffice', libreOfficeRuntimeProgress, false\)/);
assert.doesNotMatch(rust, /PPT runtime validation failed; the downloaded runtime was removed/);

console.log('Dependency gate and runtime contract checks passed');
