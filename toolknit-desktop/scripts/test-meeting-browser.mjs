import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { resolveFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright'), run = promisify(execFile), root = path.resolve('tmp/meeting-browser');
await mkdir(root, { recursive: true }); await mkdir(path.join(root, 'native-outputs'), { recursive: true });
const speech = path.join(root, 'speech-original.wav'), wave = path.join(root, 'speech.wav');
const script = "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try {$s.SetOutputToWaveFile($env:TOOLKNIT_MEETING_SPEECH); $s.Speak('This is the ToolKnit meeting. Alice will send the report on Friday. We agreed to ship the patch. Budget approval is still pending.')} finally {$s.Dispose()}";
await run('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, TOOLKNIT_MEETING_SPEECH: speech }, timeout: 30000 });
const ffmpeg = await resolveFfmpeg();
await run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-i',speech,'-ar','48000','-ac','1','-c:a','pcm_s16le',wave], { windowsHide: true, timeout: 30000 });
const text = 'Alice will send the report on Friday. We agreed to ship the patch. Budget approval is still pending.';
await writeFile(path.join(root, 'transcript.txt'), text);
const report = { checks: [], errors: [], audioFiles: [] }, check = (value, message) => { assert.ok(value, message); report.checks.push(message); };
const server = await createServer({ configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**','**/src-tauri/**','**/cli/**'] } },
  optimizeDeps: { entries: ['scripts/fixtures/meeting.html'], include: ['lucide'] },
  plugins: [{ name: 'isolated-meeting-output', configureServer(server) {
    server.middlewares.use('/__meeting-write', async (request, response) => {
      try {
        const data = JSON.parse(Buffer.from(request.headers['x-toolknit-output'], 'base64').toString());
        if (data.directory !== 'QA Meetings' || /[\\/]/.test(data.fileName) || !/\.(webm|m4a|ogg|txt|md)$/.test(data.fileName)) throw Error('invalid fixture path');
        const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 130 * 1024 * 1024) throw Error('too large'); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks); let target;
        for (let i = 0; i < 100; i++) {
          target = path.join(root, 'native-outputs', i ? `${path.parse(data.fileName).name}_${i}${path.extname(data.fileName)}` : data.fileName);
          let file; try { file = await open(target, 'wx'); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
          try { await file.writeFile(bytes); } finally { await file.close(); } break;
        }
        response.setHeader('content-type','application/json'); response.end(JSON.stringify({ path: target }));
      } catch (error) { response.statusCode = 400; response.end(String(error.message)); }
    });
  } }] });
let browser, page, production;
try {
  await server.listen();
  const launch = { headless: true, channel: 'msedge', args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${wave}`] };
  browser = await chromium.launch(launch);
  const profile = await mkdtemp(path.join(root, 'draft-profile-'));
  const fixtureUrl = server.resolvedUrls.local[0] + 'scripts/fixtures/meeting.html?lang=en&native=1';
  for (const session of ['record', 'restore']) {
    const context = await chromium.launchPersistentContext(profile, launch);
    try {
      const draftPage = context.pages()[0];
      await draftPage.goto(fixtureUrl);
      const record = draftPage.locator('#meetingRecord');
      await record.waitFor();
      await draftPage.waitForFunction(() => !document.querySelector('#meetingRecord').disabled);
      if (session === 'record') {
        await draftPage.locator('#meetingTranscript').fill(text);
        await draftPage.locator('#meetingName').fill('Persistent meeting');
        await record.click();
        await draftPage.waitForFunction(() => meetingTest.streams?.length && !document.querySelector('#meetingPause').disabled);
        await draftPage.waitForTimeout(1200);
        await draftPage.locator('#meetingStop').evaluate(button => {
          button.click();
          document.querySelector('[data-meeting-close]').click();
        });
        await draftPage.waitForFunction(() => document.querySelector('#meetingOverlay').inert);
        check(true, 'Stop and immediate return saves the draft before the page closes');
      } else {
        check(await draftPage.locator('#meetingTranscript').inputValue() === text, 'transcript restored after browser process restart');
        check(await draftPage.locator('#meetingName').inputValue() === 'Persistent meeting', 'meeting title restored after restart');
        await draftPage.locator('#meetingAudio').evaluate(async audio => {
          audio.muted = true;
          await audio.play();
        });
        await draftPage.waitForFunction(() => document.querySelector('#meetingAudio').currentTime > 0);
        check(true, 'restored recording plays after process restart');
        await draftPage.evaluate(() => { meetingTest.failSave = true; });
        await draftPage.locator('#meetingSaveAudio').click();
        await draftPage.waitForFunction(() => meetingTest.center.list()[0]?.state === 'failed');
        check(await draftPage.locator('#meetingAudio').isVisible(), 'unwritable export retains the recording');
        await draftPage.evaluate(() => {
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = () => { throw new DOMException('Injected draft storage failure', 'QuotaExceededError'); };
          meetingTest.restoreStore = () => { IDBObjectStore.prototype.put = put; };
        });
        await draftPage.locator('[data-meeting-close]').click();
        await draftPage.waitForFunction(() => document.querySelector('#meetingStatus').textContent.includes('could not be saved'));
        check(await draftPage.locator('#meetingTranscript').inputValue() === text, 'failed local write keeps the tool open with the original text');
        await draftPage.evaluate(() => meetingTest.restoreStore());
        await draftPage.locator('[data-meeting-close]').click();
        await draftPage.waitForFunction(() => document.querySelector('#meetingOverlay').inert);
        check(true, 'return succeeds after retrying local storage');
      }
    } finally { await context.close(); }
  }
  async function fixture(theme = 'light', lang = 'en', native = false) {
    await page?.close(); page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + `scripts/fixtures/meeting.html?theme=${theme}&lang=${lang}${native ? '&native=1' : ''}`);
    await page.waitForFunction(() => !!window.meetingTest && document.getElementById('meetingOverlay').classList.contains('visible'));
  }
  async function idle() { await page.waitForFunction(() => !meetingTest.controller.busy); }
  async function fillTranscript() {
    const tab = page.locator('#meetingTranscriptTab');
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    await page.locator('#meetingTranscript').fill(text);
  }
  async function generate() { await page.locator('#meetingGenerate').click(); await idle(); }
  for (const theme of ['light','dark']) for (const lang of ['zh','en']) {
    await fixture(theme, lang); await fillTranscript();
    await page.locator('#meetingName').fill('ToolKnit review'); await generate();
    check((await page.locator('#meetingMinutes').inputValue()).includes('Alice'), `${theme}/${lang}: grounded minutes are editable`);
    check(await page.evaluate(() => meetingTest.ai[0].messages.every(message => typeof message.content === 'string')), `${theme}/${lang}: AI receives text only`);
    const output = page.waitForEvent('download'); await page.locator('#meetingExportMinutes').click();
    const item = await output; const file = path.join(root, `minutes-${theme}-${lang}.md`); await item.saveAs(file); await idle();
    check((await readFile(file,'utf8')).includes('Friday'), `${theme}/${lang}: Markdown export retains actions and evidence`);
    for (const width of [1440,1024,720,390]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.locator('#meetingOverlay').evaluate(node => node.scrollWidth <= node.clientWidth + 2), `${theme}/${lang}/${width}: no horizontal overflow`);
      await page.screenshot({ path: path.join(root, `${theme}-${lang}-${width}.png`) });
      if (width === 390) {
        await page.locator('#meetingJumpEditor').click();
        const generateBox = await page.locator('#meetingGenerate').boundingBox();
        check(generateBox && generateBox.y >= 0 && generateBox.y + generateBox.height < 900, `${theme}/${lang}: one-click mobile document access`);
        await page.locator('#meetingJumpRecord').click();
        check(await page.evaluate(() => document.activeElement.id === 'meetingRecord'), `${theme}/${lang}: mobile return to recording`);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#meetingTranscriptTab').click(); await page.locator('#meetingTranscript').fill(text + ' Updated.');
  check(await page.locator('#meetingStale').isVisible(), 'transcript edits flag stale minutes');
  await fillTranscript();
  const previous = await page.locator('#meetingMinutes').inputValue();
  for (const mode of ['bad','evidence','failure']) {
    await page.evaluate(mode => { meetingTest.mode = mode; }, mode); await generate();
    check(await page.locator('#meetingMinutes').inputValue() === previous, `${mode}: failed AI result preserves existing minutes`);
  }
  const sentBefore = await page.evaluate(() => meetingTest.ai.length);
  await page.evaluate(() => { meetingTest.key = ''; meetingTest.mode = 'valid'; }); await generate();
  check(await page.evaluate(before => meetingTest.ai.length === before, sentBefore), 'missing key never sends text');
  await page.evaluate(() => { meetingTest.key = 'synthetic-key'; });
  await page.locator('#meetingTranscript').fill('x'.repeat(120001)); await generate();
  check(await page.evaluate(before => meetingTest.ai.length === before, sentBefore), 'oversized transcript is rejected without silent truncation or upload');
  const long = text + '\n' + 'x'.repeat(23840) + '\nSecond part.';
  await page.locator('#meetingTranscript').fill(long + 'y'.repeat(300));
  await page.evaluate(() => { meetingTest.mode = 'chunk-failure'; });
  await generate();
  check(await page.locator('#meetingMinutes').inputValue() === previous &&
    await page.evaluate(before => meetingTest.ai.length === before + 2, sentBefore), 'second chunk failure preserves the prior draft');
  await page.evaluate(() => { meetingTest.mode = 'chunk'; });
  await generate();
  const merged = await page.locator('#meetingMinutes').inputValue();
  check(merged.includes('Alice') && merged.includes('Second part covered'), 'long transcript produces one draft with both chunks');
  check(await page.evaluate(() => meetingTest.ai.slice(-2).every(call => JSON.parse(call.messages[1].content).transcript.length <= 24000)), 'each provider request respects the existing per-request limit');
  await page.locator('#meetingMinutes').fill(previous);
  await fillTranscript();
  await page.evaluate(() => { meetingTest.mode = 'hold'; meetingTest.resolveAI = null; });
  await page.locator('#meetingGenerate').click(); await page.waitForFunction(() => !!meetingTest.resolveAI);
  await page.evaluate(() => { meetingTest.provider.model = 'changed-model'; meetingTest.resolveAI(); }); await idle();
  check(await page.locator('#meetingMinutes').inputValue() === previous, 'provider changes reject in-flight results');
  await page.evaluate(() => { meetingTest.key = 'synthetic-key'; meetingTest.mode = 'hold'; meetingTest.resolveAI = null; });
  await page.locator('#meetingGenerate').click(); await page.waitForFunction(() => !!meetingTest.resolveAI);
  await page.locator('#meetingCancel').click(); await idle();
  check(await page.evaluate(() => meetingTest.center.list()[0].state === 'cancelled'), 'AI cancellation retains transcript and task state');
  await page.evaluate(() => { meetingTest.mode = 'late'; meetingTest.resolveAI = null; });
  await page.locator('#meetingGenerate').click(); await page.waitForFunction(() => !!meetingTest.resolveAI);
  await page.evaluate(() => { meetingTest.controller.close(); meetingTest.controller.open(); meetingTest.resolveAI(); });
  await page.waitForTimeout(100);
  check(await page.locator('#meetingMinutes').inputValue() === '' && await page.locator('#meetingTranscript').inputValue() === '', 'late AI response cannot repaint reopened session');
  await page.locator('#meetingFileInput').setInputFiles(path.join(root, 'transcript.txt')); await idle();
  check(await page.locator('#meetingTranscript').inputValue() === text, 'UTF-8 transcript import works without AI or a model');
  // Use real Chromium media capture/Opus encoding with synthetic speech as its input.
  await fixture('dark','en',true);
  check(!await page.locator('#meetingLive').isChecked(), 'live transcription starts off');
  await page.locator('#meetingLive').check();
  await page.locator('#meetingLanguage').selectOption('en');
  await page.locator('#meetingRecord').click();
  await page.waitForFunction(() => !document.getElementById('meetingPause').disabled);
  await page.waitForTimeout(700); await page.locator('#meetingPause').click();
  check(await page.locator('#meetingPause').getAttribute('aria-pressed') === 'true', 'real MediaRecorder pauses');
  check(await page.evaluate(() => meetingTest.controller.close() === false), 'active recording vetoes page close');
  await page.waitForTimeout(400); await page.locator('#meetingPause').click();
  await page.waitForFunction(() => document.getElementById('meetingTranscript').value.includes('[00:00:00.000–00:00:08.000]'));
  check(await page.locator('#meetingStop').isEnabled(), 'live text and timestamp arrive before recording stops');
  await page.screenshot({ path: path.join(root, 'live-dark-en.png') });
  const pcm = await page.evaluate(() => meetingTest.liveSegments[0]);
  check(pcm.length === 128000 && pcm.some(sample => Math.abs(sample) > 200), 'actual AudioWorklet captures 8 seconds of signal at 16 kHz');
  const raw = Buffer.alloc(pcm.length * 2);
  pcm.forEach((sample, index) => raw.writeInt16LE(sample, index * 2));
  await writeFile(path.join(root, 'live-segment.pcm'), raw);
  await page.waitForTimeout(900);
  await page.locator('#meetingStop').click(); await idle();
  check(await page.evaluate(() => meetingTest.calls.some(call => call.command === 'stop_meeting_recognition') &&
    meetingTest.liveSegments.length === 2), 'stop flushes the final window and releases the native recognition session');
  check(await page.locator('#meetingAudio').isVisible(), 'stopped recording has local playback');
  check(await page.evaluate(() => meetingTest.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), 'stopping releases every microphone track');
  await page.evaluate(() => { meetingTest.failSave = true; }); await page.locator('#meetingSaveAudio').click(); await idle();
  check(await page.locator('#meetingSaveAudio').isEnabled(), 'failed audio save retains recording for retry');
  await page.evaluate(() => { meetingTest.failSave = false; meetingTest.holdSave = true; });
  const writesBefore = await page.evaluate(() => meetingTest.calls.filter(call => call.command === 'write_unique_file_binary').length);
  await page.locator('#meetingSaveAudio').click(); await page.waitForFunction(count => meetingTest.calls.filter(call => call.command === 'write_unique_file_binary').length > count, writesBefore);
  check(await page.locator('#meetingCancel').isDisabled() && await page.evaluate(() => meetingTest.controller.close() === false), 'native writing holds ownership until save finishes');
  await page.evaluate(() => { meetingTest.holdSave = false; }); await idle();
  const audioPath = await page.evaluate(() => meetingTest.center.list().find(task => task.state === 'succeeded' && task.outputs.some(path => /\.webm$/.test(path)))?.outputs[0]);
  assert.ok(audioPath); const recorded = path.join(root, 'recorded.webm'); await writeFile(recorded, await readFile(audioPath));
  await run(ffmpeg, ['-hide_banner','-loglevel','error','-i',recorded,'-f','null','-'], { windowsHide: true, timeout: 30000 });
  report.audioFiles.push(recorded); check(true, 'saved WebM decodes with real FFmpeg');
  const aiBefore = await page.evaluate(() => meetingTest.ai.length);
  await page.evaluate(() => { meetingTest.ready = false; }); await page.locator('#meetingTranscribe').click(); await idle();
  check(await page.evaluate(() => !meetingTest.calls.some(call => call.command === 'transcribe_meeting_media')), 'missing dependencies preserve saved recording and block native start');
  await page.evaluate(() => { meetingTest.ready = true; meetingTest.holdTranscription = true; });
  await page.locator('#meetingTranscribe').click(); await page.waitForFunction(() => !!meetingTest.activeJob);
  check(await page.locator('#meetingCancel').isEnabled(), 'unrelated progress cannot enter publishing state');
  await page.locator('#meetingCancel').click(); await idle();
  check(await page.evaluate(() => meetingTest.listeners.size === 0 && meetingTest.center.list()[0].state === 'cancelled'), 'local transcription cancels by job ID and releases listener');
  await page.evaluate(() => { meetingTest.holdTranscription = false; }); await page.locator('#meetingTranscribe').click(); await idle();
  check(await page.locator('#meetingTranscript').inputValue() === `[00:00:00.125–00:00:06.000] ${text}`, 'recording → saved file → timestamped local transcript flow');
  check(await page.evaluate(() => meetingTest.publicationLocked), 'native transcript publication disables cancellation');
  check(await page.evaluate(before => meetingTest.ai.length === before, aiBefore), 'local transcription never calls AI');
  await page.locator('#meetingGenerate').click(); await idle();
  check((await page.locator('#meetingMinutes').inputValue()).includes('Alice'), 'recording → transcript → explicit minutes flow');
  const history = await page.evaluate(() => localStorage.getItem('toolknit.tasks.v1'));
  check(!history.includes(text) && !history.includes('synthetic-key') && !history.includes('Budget approval'), 'task persistence contains no transcript, minutes or key');
  production = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } });
  await page.close(); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(production.resolvedUrls.local[0]); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await page.locator('[data-tool="meeting-notes"]').evaluate(node => node.click()); await page.waitForSelector('#meetingOverlay.visible');
  await page.locator('#meetingTranscript').fill(text);
  const download = page.waitForEvent('download'); await page.locator('#meetingExportText').click(); await (await download).saveAs(path.join(root,'built-transcript.txt'));
  check(await readFile(path.join(root,'built-transcript.txt'),'utf8') === text, 'production home, lazy tool and transcript download');
  await page.locator('[data-meeting-close]').click(); await page.waitForFunction(() => !document.getElementById('meetingOverlay').classList.contains('visible'));
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(`Meeting browser: ${report.checks.length} checks; real MediaRecorder/FFmpeg audio and production entry passed.`);
} catch (error) { report.failure = String(error.stack || error); await page?.screenshot({ path: path.join(root,'failure.png') }).catch(() => {}); throw error; }
finally { await writeFile(path.join(root,'report.json'), JSON.stringify(report,null,2)); await browser?.close(); await server.close(); await production?.close(); }
