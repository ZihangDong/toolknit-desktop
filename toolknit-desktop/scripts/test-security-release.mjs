import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { startMcpServer } from '../cli/lib/mcp-server.mjs';
import { readResponseTextLimited, ResponseSizeLimitError } from '../src/core/bounded-response.js';
import { listSourceFiles } from './lib/source-inventory.mjs';

const root = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(root, '..');
const read = relativePath => readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const tauriConfig = JSON.parse(read('toolknit-desktop/src-tauri/tauri.conf.json'));
const releaseWindows = tauriConfig.app?.windows || [];
check(releaseWindows.length > 0, 'Tauri must define at least one release window');
check(releaseWindows.every(window => window.devtools === false), 'DevTools must be disabled on every release window');
check(
  releaseWindows.every(window => !/remote-debugging|auto-open-devtools-for-tabs/i.test(window.additionalBrowserArgs || '')),
  'Release browser arguments must not enable remote debugging or DevTools'
);

const cargoManifest = read('toolknit-desktop/src-tauri/Cargo.toml');
check(!/features\s*=\s*\[[^\]]*["']devtools["']/s.test(cargoManifest), 'The Tauri devtools Cargo feature must not be enabled');

const csp = tauriConfig.app?.security?.csp || '';
const cspDirectives = new Map(
  csp.split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const [name, ...sources] = value.split(/\s+/);
    return [name, sources];
  })
);
check(cspDirectives.get('script-src')?.join(' ') === "'self'", "script-src must be restricted to 'self'");
check(!csp.includes("'unsafe-eval'"), "CSP must not allow 'unsafe-eval'");
for (const directive of ['base-uri', 'object-src', 'frame-src', 'frame-ancestors', 'form-action']) {
  check(cspDirectives.get(directive)?.join(' ') === "'none'", `${directive} must be disabled`);
}

check(tauriConfig.app?.security?.assetProtocol?.enable === true, 'The asset protocol must be explicitly configured');
assert.deepEqual(
  tauriConfig.app.security.assetProtocol.scope,
  ['$DATA/ToolKnit/custom-fonts/**'],
  'The asset protocol must remain scoped to managed custom fonts'
);
checks += 1;

const capability = JSON.parse(read('toolknit-desktop/src-tauri/capabilities/default.json'));
const permissions = capability.permissions || [];
check(
  permissions.every(permission => !/^(?:shell|fs|process|http|opener):/i.test(permission)),
  'The frontend must not receive generic shell, filesystem, process, HTTP, or opener permissions'
);

for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/test-signing.yml']) {
  const workflow = read(workflowPath);
  const actionLines = workflow.match(/^\s*-?\s*uses:\s*[^\s#]+/gm) || [];
  check(actionLines.length > 0, `${workflowPath} must use at least one action`);
  for (const line of actionLines) {
    const reference = line.match(/@([^\s#]+)/)?.[1] || '';
    check(/^[0-9a-f]{40}$/i.test(reference), `${workflowPath} action is not pinned to a full commit SHA: ${line.trim()}`);
  }
}
const releaseWorkflow = read('.github/workflows/release.yml');
const testSigningWorkflow = read('.github/workflows/test-signing.yml');
check(testSigningWorkflow.includes('signing-policy-slug: test-signing'), 'Test signing must use the test policy');
check(!/release-signing|action-gh-release|contents:\s*write|pull_request_target/.test(testSigningWorkflow), 'Test signing must not publish releases, elevate repository access or sign untrusted PRs');
check(testSigningWorkflow.includes("github.ref == 'refs/heads/ToolKnit-Desktop-V3.0-正式版'"), 'Test signing must be restricted to the reviewed V3 branch');
check(testSigningWorkflow.includes('archive: false') && testSigningWorkflow.includes('skip-decompress: true'), 'The PE artifact configuration requires raw upload and download');
check(testSigningWorkflow.includes('./scripts/test-signpath-verifier.ps1') && testSigningWorkflow.includes('./scripts/verify-test-signature.ps1'), 'Test signing must exercise and run cryptographic verification');
check(testSigningWorkflow.includes("SIGNPATH_TEST_CERTIFICATE_THUMBPRINT: '6831FA4A3067EDCE07AD33005E16AD0997662B05'") && testSigningWorkflow.includes('-ExpectedThumbprint $env:SIGNPATH_TEST_CERTIFICATE_THUMBPRINT'), 'Test signing must pin the independently checked SignPath test certificate');
check(!releaseWorkflow.includes('$tag = "${{ github.ref_name }}"'), 'Release tags must not be interpolated directly into PowerShell');
check(releaseWorkflow.includes('RELEASE_TAG: ${{ github.ref_name }}') && releaseWorkflow.includes('$tag = $env:RELEASE_TAG'), 'Release tags must enter PowerShell through an environment variable');
check(releaseWorkflow.includes("github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'"), 'Manual releases must execute the reviewed main workflow');
check(releaseWorkflow.includes('DISPATCH_RELEASE_TAG: ${{ inputs.tag }}') && !releaseWorkflow.includes('$tag = "${{ inputs.tag }}"'), 'Manual release tags must not be interpolated into PowerShell');
check(releaseWorkflow.includes('refs/tags/${tag}^{commit}') && releaseWorkflow.includes('$tagCommit -ne $releaseCommit'), 'Release checkout must match an existing tag');
check(releaseWorkflow.includes('git merge-base --is-ancestor $releaseCommit origin/main'), 'The checked-out release commit must belong to main');
check(releaseWorkflow.includes('Get-Content src/app/templates/settings.html -Raw'), 'Release version validation must read the extracted settings template');

const installerTemplate = read('toolknit-desktop/src-tauri/windows/installer.nsi');
check(installerTemplate.includes('!include WinVer.nsh'), 'NSIS installer must load Windows version checks');
check(installerTemplate.includes('${IfNot} ${AtLeastWin10}'), 'NSIS installer must reject unsupported pre-Windows 10 systems');
check(installerTemplate.includes('${VersionCompare} "17134" "$0" $1'), 'NSIS installer must reject Windows 10 builds older than 1803');
check(installerTemplate.includes("ExecWait '\"$6\" ${WEBVIEW2INSTALLERARGS} /install' $1"), 'WebView2 bootstrapper path must be quoted for profiles containing spaces');
check(installerTemplate.includes('${OrIf} $1 = 3010'), 'WebView2 reboot-required success must not be reported as an installation failure');
check(installerTemplate.includes('code $WebView2ExitCode') && installerTemplate.includes('$(webview2Recovery)'), 'WebView2 failures must expose the bootstrapper exit code and recovery options to users');

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const trackedFileSet = new Set(trackedFiles);
const sourceFiles = listSourceFiles(repositoryRoot);
const sensitiveFilePattern = /(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|[^/]+\.(?:pem|pfx|p12|key))$/i;
check(!trackedFiles.some(file => sensitiveFilePattern.test(file)), 'Sensitive configuration or key material must not be tracked');
check(!sourceFiles.some(file => sensitiveFilePattern.test(file)), 'Sensitive configuration or key material must not enter the source inventory');

const desktopPackage = JSON.parse(read('toolknit-desktop/package.json'));
check(
  desktopPackage.scripts?.['test:security-release']?.startsWith('npm run stage:cli-resources &&'),
  'Security release tests must stage generated CLI runtime resources for clean checkouts'
);
const cliStageSource = read('toolknit-desktop/scripts/stage-cli-resources.cjs');
const stagedCoreFiles = new Set(
  [...cliStageSource.matchAll(/^\s*'([^']+\.js)',?\s*$/gm)].map(match => match[1])
);
check(stagedCoreFiles.size > 0, 'CLI staging must define an explicit core module manifest');
for (const fileName of stagedCoreFiles) {
  check(
    trackedFileSet.has(`toolknit-desktop/src/${fileName}`),
    `CLI staged core source must be tracked: toolknit-desktop/src/${fileName}`
  );
}
const referencedCoreFiles = new Set();
for (const cliFile of sourceFiles.filter(file => /^toolknit-desktop\/cli\/.*\.(?:mjs|js)$/i.test(file))) {
  const contents = readFileSync(resolve(repositoryRoot, cliFile), 'utf8');
  for (const match of contents.matchAll(/(?:from\s+|import\s*\()\s*['"]\.\/core\/([^'"]+\.js)['"]/g)) {
    referencedCoreFiles.add(match[1]);
  }
}
check(referencedCoreFiles.size > 0, 'CLI runtime modules must expose their generated core dependencies');
for (const fileName of referencedCoreFiles) {
  check(stagedCoreFiles.has(fileName), `CLI core import is missing from the staging manifest: ${fileName}`);
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/
];
const textExtensions = new Set(['', '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.nsi', '.nsh', '.rs', '.toml', '.txt', '.yaml', '.yml']);
const extensionOf = file => file.includes('.') ? file.slice(file.lastIndexOf('.')).toLowerCase() : '';
for (const file of sourceFiles.filter(file => textExtensions.has(extensionOf(file)))) {
  const contents = readFileSync(resolve(repositoryRoot, file), 'utf8');
  check(!secretPatterns.some(pattern => pattern.test(contents)), `Possible credential material found in source file: ${file}`);
}

const nativeSource = sourceFiles
  .filter(file => /^toolknit-desktop\/src-tauri\/src\/(?:native_runtime|platform)\/.*\.rs$/.test(file))
  .map(read).join('\n');
for (const required of [
  'fn validate_external_url',
  'value.len() > 2_048',
  'value.chars().any(char::is_control)',
  'parsed.username().is_empty()',
  'parsed.password().is_some()',
  'fn allow_webview_navigation',
  'on_navigation(|_webview, url| allow_webview_navigation(url))',
  'fn resolve_open_folder',
  'requested.is_absolute()',
  '.canonicalize()',
  'next_downloaded > model.bytes',
  'CryptProtectData',
  'CryptUnprotectData',
  'CRYPTPROTECT_UI_FORBIDDEN',
  'fn store_ai_api_key',
  'fn load_ai_api_key',
  'fn clear_ai_api_key'
]) {
  check(nativeSource.includes(required), `Native security boundary is missing: ${required}`);
}

const cleanupSource = read('toolknit-desktop/src-tauri/src/system_cleanup.rs');
check(cleanupSource.includes('fn normalize_system_drive'), 'SystemDrive must pass through a strict normalizer');
check(cleanupSource.includes('bytes.len() == 2'), 'SystemDrive must only accept a drive letter and colon');

const mainSource = `${read('toolknit-desktop/src/main.js')}\n${read('toolknit-desktop/src/application-runtime.js')}`;
const externalLinksSource = read('toolknit-desktop/src/app/external-links-runtime.js');
const keyStoreSource = read('toolknit-desktop/src/app/ai-key-store.js');
const i18nSource = read('toolknit-desktop/src/i18n.js');
check(externalLinksSource.includes("windowRef?.open?.(parsedUrl.href, '_blank', 'noopener,noreferrer')"), 'Browser external links must isolate the opener');
check(!externalLinksSource.includes("window.open(url, '_blank')"), 'Tauri external-link failures must not bypass native validation');
check(nativeSource.includes('.devtools(false)'), 'Dynamically created WebViews must explicitly disable DevTools');
check(nativeSource.includes('not(debug_assertions)') && nativeSource.includes('fn append_picker_debug(_line: &str) {}'), 'Release builds must disable the screen-picker debug file');
check(/#\[cfg\(all\(target_os = "windows", debug_assertions\)\)\]\s*pub\(super\) fn append_hardware_debug/.test(nativeSource), 'Hardware debug logging must be debug-only');
check(nativeSource.includes('fn append_hardware_debug(_line: &str) {}'), 'Release builds must disable the hardware debug file');
check(!nativeSource.includes('Custom background video converted: source='), 'Custom background logs must not include user paths');
check(nativeSource.includes('CUSTOM_BACKGROUND_SERVER_TOKEN'), 'The local background media server must use a per-process access token');
check(nativeSource.includes('request_token != access_token'), 'The local background media server must reject unauthenticated requests');
check(nativeSource.includes('/custom-background/{access_token}/{filename}'), 'Background media URLs must carry the local access token');
check(!mainSource.includes("localStorage.setItem('ai_api_key'"), 'AI API keys must not be written to localStorage');
check(!mainSource.includes("localStorage.setItem('deepseek_api_key'"), 'Legacy AI API keys must not be written to localStorage');
check(keyStoreSource.includes("invoke('store_ai_api_key'"), 'AI API keys must use native protected storage');
check(keyStoreSource.includes('clearLegacy();'), 'Protected-key migration must remove legacy plaintext storage');
check(!i18nSource.includes("querySelectorAll('[data-i18n-html]')"), 'Translations must not expose a generic innerHTML injection path');
const aiProviderSource = read('toolknit-desktop/src/ai-provider-core.js');
check(aiProviderSource.includes('async function readResponseTextLimited'), 'AI HTTPS responses must be read through a streaming size limit');
check(aiProviderSource.includes('received > AI_PROVIDER_LIMITS.maxResponseBytes'), 'AI HTTPS streams must stop above the response limit');
check(aiProviderSource.includes('await reader.cancel()'), 'Oversized AI HTTPS streams must be cancelled immediately');

const updateServiceSource = read('toolknit-desktop/src/update-service.js');
check(updateServiceSource.includes('readResponseTextLimited(response, MAX_UPDATE_API_BYTES)'), 'Update API responses must have a streaming size limit');
check(!updateServiceSource.includes('raw.githubusercontent.com'), 'Updates must not depend on raw release notes');
check(updateServiceSource.includes('https://api.atomgit.com/api/v5/repos/ZihangDong/toolknit-desktop/tags'), 'Updates must include AtomGit tags');
check(updateServiceSource.includes("UPDATE_DOWNLOAD_PAGE = 'https://toolknit.com/exe.html'"), 'Update destination must be fixed');
check(externalLinksSource.includes('readResponseTextLimited(response, GITHUB_RESPONSE_MAX_BYTES)'), 'Homepage GitHub responses must have a streaming size limit');
const boundedResponseSource = read('toolknit-desktop/src/core/bounded-response.js');
check(boundedResponseSource.includes('await reader.cancel()'), 'Oversized remote JSON streams must be cancelled immediately');

const smallBoundedResponse = await readResponseTextLimited(new Response('ToolKnit'), 16);
check(smallBoundedResponse === 'ToolKnit', 'Bounded response reader must preserve valid response text');
await assert.rejects(
  readResponseTextLimited(new Response('x'.repeat(32)), 16),
  error => error instanceof ResponseSizeLimitError
);
checks += 1;

const markdownControllerSource = read('toolknit-desktop/src/features/markdown-editor/controller.js');
const markdownPreviewSecuritySource = read('toolknit-desktop/src/features/markdown-editor/preview-security.js');
const markdownSource = `${markdownControllerSource}\n${markdownPreviewSecuritySource}`;
for (const required of [
  'function safeLivePreviewFragment',
  "template.content.querySelectorAll('img')",
  "template.content.querySelectorAll('a')",
  "link.removeAttribute('target')",
  "link.setAttribute('rel', 'noopener noreferrer')",
  "preview.replaceChildren(safeLivePreviewFragment(clean, assets))",
  "host.replaceChildren(safeLivePreviewFragment(html, []))",
  "invoke('open_url', { url: href })"
]) {
  check(markdownSource.includes(required), `Markdown preview security boundary is missing: ${required}`);
}
check(markdownControllerSource.includes("from '../../platform/tauri-runtime.js'"), 'Markdown must use the centralized Tauri platform boundary');
check(!markdownControllerSource.includes("from '@tauri-apps/"), 'Markdown must not import Tauri APIs directly');
check(markdownControllerSource.includes('isOpenSession(owner)'), 'Markdown async work must verify its owning open session');
check(markdownControllerSource.includes('return { open, close, dispose, importMarkdown }'), 'Markdown must expose the complete tool lifecycle and import contract');
const markdownCoreSource = read('toolknit-desktop/src/features/markdown-editor/core.js');
check(markdownCoreSource.includes("default-src 'none'"), 'Standalone Markdown exports must block network access by default');
check(markdownCoreSource.includes('img-src data:'), 'Standalone Markdown exports must allow embedded images only');
check(markdownCoreSource.includes('name="referrer" content="no-referrer"'), 'Standalone Markdown exports must not leak referrer data');

const imageCropControllerSource = read('toolknit-desktop/src/features/image-crop/controller.js');
const imageCropToolSource = read('toolknit-desktop/src/features/image-crop/tool.js');
check(!imageCropControllerSource.includes('.innerHTML ='), 'Image Crop runtime data must not be written through innerHTML');
check(imageCropControllerSource.includes('owner.use(unlisten)'), 'Image Crop native drag listeners must be lifecycle-owned');
check(imageCropControllerSource.includes('isCurrentLoad(owner, requestId)'), 'Image Crop loads must reject stale session results');
check(imageCropControllerSource.includes('isCurrentOperation(operation)'), 'Image Crop exports must reject stale operation results');
check(imageCropControllerSource.includes('URL.revokeObjectURL(objectUrl)'), 'Image Crop browser previews must revoke object URLs');
check(imageCropControllerSource.includes("invoke('crop_image'"), 'Image Crop must retain the native crop command boundary');
check(!imageCropControllerSource.includes("from '@tauri-apps/"), 'Image Crop must use the platform Tauri boundary');
check(imageCropToolSource.includes('imageCropTemplate()'), 'Image Crop must materialize only its trusted static template');

const imageBatchControllerSource = read('toolknit-desktop/src/features/image-batch/controller.js');
const imageBatchToolSource = read('toolknit-desktop/src/features/image-batch/tool.js');
check(!imageBatchControllerSource.includes('.innerHTML ='), 'Image batch runtime data must not be written through innerHTML');
check(imageBatchControllerSource.includes('name.textContent ='), 'Image batch filenames must use safe text nodes');
check(imageBatchControllerSource.includes('owner.use(unlisten)'), 'Image batch native drag listeners must be lifecycle-owned');
check(imageBatchControllerSource.includes('isCurrentOperation(operation)'), 'Image batch results must reject stale operations');
check(imageBatchControllerSource.includes("invoke('cancel_convert')"), 'Image batch cancellation must retain the native command boundary');
check(!imageBatchControllerSource.includes("from '@tauri-apps/api/core'"), 'Image batch tools must use the platform Tauri core boundary');
check(!imageBatchControllerSource.includes("from '@tauri-apps/api/event'"), 'Image batch tools must use the platform Tauri event boundary');
check(imageBatchToolSource.includes('imageBatchPageTemplate(mode)'), 'Image batch tools must materialize only their trusted static templates');

const iconGeneratorControllerSource = read('toolknit-desktop/src/features/icon-generator/controller.js');
const iconGeneratorToolSource = read('toolknit-desktop/src/features/icon-generator/tool.js');
const iconGeneratorPublisherSource = read('toolknit-desktop/src/features/icon-generator/publisher.js');
check(!iconGeneratorControllerSource.includes('.innerHTML ='), 'Icon Generator runtime data must not be written through innerHTML');
check(iconGeneratorControllerSource.includes('name.textContent ='), 'Icon Generator filenames must use safe text nodes');
check(iconGeneratorControllerSource.includes('owner.use(unlisten)'), 'Icon Generator native drag listeners must be lifecycle-owned');
check(iconGeneratorControllerSource.includes('isCurrentSourceRequest(request)'), 'Icon Generator source loads must reject stale sessions');
check(iconGeneratorControllerSource.includes('isCurrentOperation(operation)'), 'Icon Generator output must reject stale operations');
check(iconGeneratorControllerSource.includes('urlApi.revokeObjectURL'), 'Icon Generator must revoke preview object URLs');
check(iconGeneratorControllerSource.includes('discardArchive(operation, tauriCore)'), 'Icon Generator cancellation must discard partial native output');
check(!iconGeneratorControllerSource.includes("from '@tauri-apps/"), 'Icon Generator must use the platform Tauri boundary');
check(iconGeneratorPublisherSource.includes("invoke('discard_icon_archive_write'"), 'Icon Generator publisher must discard failed native write sessions');
check(iconGeneratorToolSource.includes('iconGeneratorPageTemplate()'), 'Icon Generator must materialize only its trusted static template');

const hardwareControllerSource = read('toolknit-desktop/src/features/hardware-inspector/controller.js');
const hardwareToolSource = read('toolknit-desktop/src/features/hardware-inspector/tool.js');
const hardwareRendererSource = [
  'overview.js', 'cpu-memory.js', 'gpu-display.js', 'mainboard.js',
  'storage.js', 'network-devices.js', 'power-sensors.js'
].map(file => read(`toolknit-desktop/src/features/hardware-inspector/${file}`)).join('\n');
check(hardwareControllerSource.includes('isCurrent(operation)'), 'Hardware inspection results must reject stale sessions');
check(hardwareControllerSource.includes('async function refreshLiveData()'), 'Hardware live metrics must use the shared session guard');
check(hardwareControllerSource.includes('stopLiveUpdates()'), 'Hardware live timers must stop with their owning session');
check(hardwareControllerSource.includes('content.replaceChildren(wrapper)'), 'Hardware loading and error data must use safe DOM nodes');
check(!hardwareControllerSource.includes("from '@tauri-apps/"), 'Hardware inspection must use the platform Tauri boundary');
check(hardwareToolSource.includes('controller.dispose()'), 'Hardware inspection must dispose feature lifecycle state');
check(hardwareToolSource.includes("import './hardware-inspector.css'"), 'Hardware inspection must own its lazy stylesheet');
check(hardwareRendererSource.includes('escapeHtml'), 'Hardware inspection result markup must escape runtime values');

const mcpSource = read('toolknit-desktop/cli/lib/mcp-server.mjs');
for (const required of [
  'const MAX_MCP_MESSAGE_BYTES = 8 * 1024 * 1024',
  'const MAX_ACTIVE_TOOL_CALLS = 4',
  "Buffer.byteLength(rawLine, 'utf8') > MAX_MCP_MESSAGE_BYTES",
  "Buffer.byteLength(buffer, 'utf8') > MAX_MCP_MESSAGE_BYTES",
  'activeCalls.has(message.id)',
  'activeCalls.size >= MAX_ACTIVE_TOOL_CALLS'
]) {
  check(mcpSource.includes(required), `MCP input boundary is missing: ${required}`);
}

const cliTranscription = read('toolknit-desktop/cli/lib/transcription-runtime.mjs');
const cliModelDownload = read('toolknit-desktop/cli/lib/model-download.mjs');
check(cliTranscription.includes('await downloadVerifiedModel('), 'Transcription must use the bounded verified model downloader');
check(cliModelDownload.includes('received > model.bytes'), 'CLI model downloads must stop above the signed catalog size');
check(cliModelDownload.includes("'content-range'") && cliModelDownload.includes('!== model.sha256'), 'CLI model downloads must verify resumed ranges and final integrity');

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
  }
}

const input = new PassThrough();
const output = new PassThrough();
const messages = [];
let outputBuffer = '';
const pendingExecutions = [];
output.setEncoding('utf8');
output.on('data', chunk => {
  outputBuffer += chunk;
  let newline;
  while ((newline = outputBuffer.indexOf('\n')) !== -1) {
    const line = outputBuffer.slice(0, newline).trim();
    outputBuffer = outputBuffer.slice(newline + 1);
    if (line) messages.push(JSON.parse(line));
  }
});
startMcpServer({
  input,
  output,
  list: () => [],
  execute: () => new Promise(resolvePromise => pendingExecutions.push(resolvePromise))
});

const send = message => input.write(`${JSON.stringify(message)}\n`);
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
await waitFor(() => messages.some(message => message.id === 1), 'MCP security test did not initialize');

send({ jsonrpc: '2.0', id: { invalid: true }, method: 'ping' });
await waitFor(() => messages.some(message => message.error?.message?.includes('JSON-RPC id')), 'MCP did not reject an invalid request id');
check(messages.some(message => message.error?.code === -32600 && message.error.message.includes('JSON-RPC id')), 'MCP must reject object request ids');

input.write(`${' '.repeat(8 * 1024 * 1024 + 1)}{}\n`);
await waitFor(() => messages.some(message => message.error?.message?.includes('8 MB')), 'MCP did not reject an oversized raw line');
check(messages.some(message => message.error?.code === -32700 && message.error.message.includes('8 MB')), 'MCP must enforce its limit before trimming whitespace');

for (let id = 10; id < 14; id += 1) {
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'test', arguments: {} } });
}
await waitFor(() => pendingExecutions.length === 4, 'MCP did not start the expected bounded calls');
send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'test', arguments: {} } });
send({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'test', arguments: {} } });
await waitFor(
  () => messages.some(message => message.id === 10 && message.error) && messages.some(message => message.id === 14 && message.error),
  'MCP did not reject duplicate and excessive active calls'
);
check(messages.some(message => message.id === 10 && message.error?.code === -32600), 'MCP must reject duplicate active request ids');
check(messages.some(message => message.id === 14 && message.error?.code === -32000), 'MCP must cap active tool calls');
pendingExecutions.forEach(resolvePromise => resolvePromise({ ok: true }));
await waitFor(
  () => [10, 11, 12, 13].every(id => messages.some(message => message.id === id && message.result)),
  'MCP security test did not flush completed calls'
);
input.end();
output.end();

console.log(`Security release checks passed: ${checks}`);
