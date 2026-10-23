import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const runtime = process.env.TOOLKNIT_CLI_ENTRY
  ? pathToFileURL(path.join(path.dirname(process.env.TOOLKNIT_CLI_ENTRY), 'lib/transcription-runtime.mjs')).href
  : new URL('../cli/lib/transcription-runtime.mjs', import.meta.url).href;
const { listTranscriptionModels, transcribeMedia } = await import(runtime);

const models = await listTranscriptionModels();
if (process.platform !== 'win32' || !models.some(model => model.installed && model.current)) {
  console.log('Native transcription skipped: requires Windows speech synthesis and an already selected local model. No models downloaded.');
} else {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-speech-'));
  const source = path.join(root, 'voice.wav'), output = path.join(root, '中文输出');
  try {
    const script = "Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice.SetOutputToWaveFile($env:TOOLKNIT_QA_SPEECH_FILE); $voice.Speak('This is a local speech recognition test. The document has three pages. All files stay on this computer.'); } finally { $voice.Dispose() }";
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 30000, env: { ...process.env, TOOLKNIT_QA_SPEECH_FILE: source } });
    const hash = createHash('sha256').update(await readFile(source)).digest('hex');
    const first = transcribeMedia({ input_path: source, output_dir: output, language: 'en' });
    await assert.rejects(transcribeMedia({ input_path: source, output_dir: output, language: 'en' }), /already active/);
    const result = await first;
    assert.equal(result.outputs.length, 3);
    for (const item of result.outputs) assert.ok((await stat(item.path)).size > 0);
    const text = await readFile(result.raw_txt_path, 'utf8');
    assert.match(text, /document|computer|speech/i);
    assert.match(await readFile(result.raw_srt_path, 'utf8'), /\d{2}:\d{2}:\d{2},\d{3} -->/);
    assert.ok(JSON.parse(await readFile(result.raw_json_path, 'utf8')).transcription.length > 0);
    const controller = new AbortController();
    await assert.rejects(transcribeMedia({ input_path: source, output_dir: output, language: 'en' }, {
      signal: controller.signal, reportProgress: progress => { if (progress >= 16) controller.abort(); }
    }), error => error.code === 'CANCELLED');
    assert.equal((await readdir(output)).length, 3, 'Cancellation leaves original outputs and removes staging files.');
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), hash);
    console.log('Native transcription passed: installed model, synthesized speech, Unicode model/output paths, JSON/SRT/TXT, concurrent rejection, cancellation and unchanged source.');
  } finally { await rm(root, { recursive: true, force: true }); }
}
