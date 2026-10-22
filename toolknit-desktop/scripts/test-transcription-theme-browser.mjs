import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'vite';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = path.resolve('tmp/theme-audit-v32/transcription');
await mkdir(output, { recursive: true });
const transcript = '1\n00:00:01,000 --> 00:00:03,000\nA readable subtitle line.\n\n2\n00:00:03,500 --> 00:00:06,000\nSecond line with numbers 12345.\n';
const entry = `
import '/src/styles/index.css';
import '/src/tool-page-v2-final.css';
import '/src/tool-custom-select.css';
import '/src/tool-nav-unified.css';
import '/src/styles/themes/index.css';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createIcons, icons } from 'lucide';
import { t, onLangChange, setLangWithoutFade, applyTranslations } from '/src/i18n.js';
import { prepareToolPageChrome } from '/src/shared/tool-page-chrome.js';
import template from '/src/features/transcription/template.html?raw';
mockWindows('main');
window.notices = []; window.calls = []; window.failNext = false;
mockIPC(async (command, args) => {
  window.calls.push(command);
  if (command === 'check_transcription_engine') return true;
  if (command === 'plugin:dialog|open') return 'C:/synthetic/theme-sample.wav';
  if (command === 'transcribe_media') {
    await new Promise(resolve => { window.finishTranscription = resolve; });
    if (window.failNext) { window.failNext = false; throw 'transcription:engine-failed'; }
    return { raw_srt_path: 'C:/synthetic/theme-sample.srt', raw_txt_path: 'C:/synthetic/theme-sample.txt' };
  }
  if (command === 'read_file_bytes_limited') return [...new TextEncoder().encode(args.path.endsWith('.srt') ? ${JSON.stringify(transcript)} : ${JSON.stringify('A readable subtitle line.\nSecond line with numbers 12345.')})];
  return null;
}, { shouldMockEvents: true });
const { initTranscriptionTool } = await import('/src/features/transcription/tool.js');
document.documentElement.dataset.theme = localStorage.getItem('toolknit.theme.v3') || 'dark';
document.body.innerHTML = template;
prepareToolPageChrome(document);
applyTranslations();
createIcons({ icons });
window.tool = initTranscriptionTool({ overlay: document.querySelector('#transcriptionOverlay'), isTauri: true,
  t, onLangChange, notify: message => window.notices.push(message), getOutputDir: async () => 'C:/synthetic',
  displayFilesystemPath: value => value, ensureFfmpegAvailable: async () => true,
  refreshTranscriptionModels: async () => {}, activeTranscriptionModel: () => ({ id: 'fixture' }),
  initStandardToolPlasma: () => () => {}, refreshIcons: () => createIcons({ icons }) });
window.setTestLanguage = setLangWithoutFade;
await window.tool.open(); window.ready = true;
`;
const bundle = await build({ configFile: false, logLevel: 'error',
  plugins: [{ name: 'transcription-theme-fixture', resolveId(id) { if (id === 'virtual:transcription-theme') return '\0transcription-theme'; }, load(id) { if (id === '\0transcription-theme') return entry; } }],
  build: { write: false, cssCodeSplit: false, rollupOptions: { input: 'virtual:transcription-theme', output: { entryFileNames: 'test.js' } } } });
const assets = new Map(bundle.output.map(asset => [`/${asset.fileName}`, asset]));
const styles = bundle.output.filter(asset => asset.fileName.endsWith('.css')).map(asset => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
const publicRoot = path.resolve('public');
const server = createServer(async (request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  const asset = assets.get(route);
  if (asset) {
    response.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : route.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    response.end(asset.type === 'chunk' ? asset.code : asset.source);
  } else if (route === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html data-tk-auxiliary><head>${styles}</head><body><script type="module" src="/test.js"></script></body></html>`);
  } else {
    const file = path.resolve(publicRoot, `.${route}`);
    try {
      if (!file.startsWith(publicRoot + path.sep)) throw new Error('outside fixture assets');
      const bytes = await readFile(file);
      response.setHeader('Content-Type', route.endsWith('.png') ? 'image/png' : 'application/octet-stream');
      response.end(bytes);
    } catch { response.statusCode = 404; response.end(); }
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { source: 'Native engine/file commands are fixtures. This validates actual transcription UI, not Whisper or FFmpeg execution.', checks: [], errors: [] };
try {
  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(({ theme, language }) => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', language);
      }, { theme, language });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.ready);
      const check = async (state, root) => {
        await page.waitForTimeout(450);
        const audit = await page.evaluate(auditVisibleColors, root);
        report.checks.push({ theme, language, state, ...audit });
        await page.screenshot({ path: path.join(output, `${theme}-${language}-${state}.png`) });
        assert.deepEqual(audit.findings.filter(f => !f.ambiguous && f.opacity === 1 && f.contrast < 3), [], `${theme}/${language}/${state}`);
      };
      await check('empty', '#transcriptionOverlay');
      await page.locator('#transcriptionCta').click();
      await check('selected', '#transcriptionOperationView');
      await page.locator('#transcriptionRefine').uncheck();
      await page.locator('#transcriptionProcessBtn').click();
      await page.waitForFunction(() => typeof window.finishTranscription === 'function');
      await check('processing', '#transcriptionProcessMask');
      await page.evaluate(() => window.finishTranscription());
      await page.locator('#transcriptionSuccessOverlay.visible').waitFor();
      await check('success', '#transcriptionSuccessOverlay');
      await page.locator('#transcriptionSuccessOk').click();
      assert.ok((await page.locator('#transcriptionPreview').textContent()).includes('A readable subtitle line.'));
      await check('result', '#transcriptionResultView');
      await page.setViewportSize({ width: 1000, height: 650 });
      await check('compact-result', '#transcriptionResultView');
      await page.locator('#transcriptionResetBtn').click();
      assert.equal(await page.locator('#transcriptionResultView').isVisible(), false);
      await page.evaluate(() => { window.tool.close(); return window.tool.open(); });
      await check('reopened', '#transcriptionOverlay');
      await page.evaluate(() => window.tool.dispose());
      await page.close();
      console.log(`PASS transcription ${theme}/${language}: file, progress, success, subtitles, reset and reopen`);
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
