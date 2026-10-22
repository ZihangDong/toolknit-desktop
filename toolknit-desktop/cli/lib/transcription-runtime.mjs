import { spawn } from 'node:child_process';
import { access, copyFile, link, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compactFfmpegError, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';
import { cancellationError, ToolKnitError, throwIfAborted } from './errors.mjs';
import { downloadVerifiedModel } from './model-download.mjs';
import { assertNoLinkedParents, writeOutputFile } from './safe-files.mjs';
import { createWhisperWorkspace, stageWhisperModel } from './transcription-workspace.mjs';
import { isPlaceholderAiApiKey, requestAiCompletion } from './core/ai-provider-core.js';
import { simplifyChineseText, simplifyTranscriptionJson } from './core/core/chinese-text.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const CONFIG_ROOT = process.env.APPDATA || process.env.XDG_CONFIG_HOME
  || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : path.join(process.cwd(), '.toolknit'));
const MODEL_ROOT = path.join(CONFIG_ROOT, 'ToolKnit', 'models');
const MODEL_CONFIG = path.join(CONFIG_ROOT, 'ToolKnit', 'transcription-model.json');
const MAX_INPUT_BYTES = 10 * 1024 * 1024 * 1024;
const EXTENSIONS = new Set(['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts']);
let transcriptionActive = false;
const MODELS = Object.freeze([
  { id: 'base', display_name: 'Base', file_name: 'ggml-base.bin', bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  { id: 'small', display_name: 'Small', file_name: 'ggml-small.bin', bytes: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  { id: 'medium', display_name: 'Medium', file_name: 'ggml-medium.bin', bytes: 1533763059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' }
]);

function report(options, progress, message) {
  try { options.reportProgress?.(Math.max(0, Math.min(100, progress)), message); } catch {}
}

function modelById(value) {
  const model = MODELS.find(item => item.id === String(value || '').trim().toLowerCase());
  if (!model) throw new ToolKnitError('INVALID_ARGUMENT', 'model_id must be base, small, or medium.');
  return model;
}

function modelPath(model) { return path.join(MODEL_ROOT, model.file_name); }

async function regularFile(filePath) {
  try { const info = await lstat(filePath); return info.isFile() && !info.isSymbolicLink(); } catch { return false; }
}

async function installed(model) {
  try { await assertNoLinkedParents(modelPath(model)); const info = await lstat(modelPath(model)); return info.isFile() && !info.isSymbolicLink() && info.size === model.bytes; } catch { return false; }
}

async function config() {
  try {
    const value = JSON.parse(await readFile(MODEL_CONFIG, 'utf8'));
    return typeof value?.current_model === 'string' ? { current_model: value.current_model } : { current_model: null };
  } catch { return { current_model: null }; }
}

async function saveConfig(value) {
  await writeOutputFile(MODEL_CONFIG, Buffer.from(JSON.stringify(value, null, 2)), { overwrite: true });
}

function sourceUrl(model, source) {
  const selected = String(source || 'auto').trim().toLowerCase();
  const base = selected === 'china'
    ? 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main'
    : selected === 'official' || selected === 'auto'
      ? 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
      : null;
  if (!base) throw new ToolKnitError('INVALID_ARGUMENT', '--source must be auto, official, or china.');
  return `${base}/${model.file_name}`;
}

export async function listTranscriptionModels() {
  const current = (await config()).current_model;
  return Promise.all(MODELS.map(async model => ({ ...model, installed: await installed(model), current: current === model.id && await installed(model) })));
}

export async function setCurrentTranscriptionModel({ model_id }) {
  const model = modelById(model_id);
  if (!await installed(model)) throw new ToolKnitError('INPUT_INVALID', `Install the ${model.id} model before selecting it.`);
  await saveConfig({ current_model: model.id });
  return { tool: 'model.use', model_id: model.id, path: modelPath(model) };
}

export async function installTranscriptionModel({ model_id, source = 'auto' }, options = {}) {
  const model = modelById(model_id);
  const normalizedSource = String(source || 'auto').trim().toLowerCase();
  if (!['auto', 'official', 'china'].includes(normalizedSource)) {
    throw new ToolKnitError('INVALID_ARGUMENT', '--source must be auto, official, or china.');
  }
  throwIfAborted(options.signal);
  await assertNoLinkedParents(MODEL_ROOT);
  await mkdir(MODEL_ROOT, { recursive: true });
  const destination = modelPath(model);
  const candidates = normalizedSource === 'auto' ? ['auto', 'china'] : [normalizedSource];
  const result = await downloadVerifiedModel({ model, destination, signal: options.signal,
    reportProgress: (value, message) => report(options, value, message),
    sources: candidates.map(candidate => ({ name: candidate === 'auto' ? 'official' : candidate, url: sourceUrl(model, candidate) })) });
  const current = await config();
  if (!result.already_installed && (!current.current_model || model.id === 'small')) await saveConfig({ current_model: model.id });
  report(options, 100, `${model.display_name} model is ready.`);
  return { tool: 'model.install', model_id: model.id, path: destination, current: (await config()).current_model === model.id, ...result };
}

async function resolveWhisper() {
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidates = [
    path.join(CLI_ROOT, 'vendor', 'whisper', executable),
    path.join(PROJECT_ROOT, 'src-tauri', 'resources', 'whisper', 'Release', executable)
  ];
  for (const candidate of candidates) if (await regularFile(candidate)) return candidate;
  return executable;
}

async function prepareOutputDir(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path.');
  const output = path.resolve(value);
  await assertNoLinkedParents(output, 'OUTPUT_INVALID');
  await mkdir(output, { recursive: true });
  const metadata = await lstat(output);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  return output;
}

async function inputFile(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path.');
  const input = path.resolve(value);
  await assertNoLinkedParents(input);
  let metadata;
  try { metadata = await lstat(input); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Input does not exist: ${input}`); }
  const extension = path.extname(input).slice(1).toLowerCase();
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES || !EXTENSIONS.has(extension)) {
    throw new ToolKnitError('INPUT_INVALID', 'input_path must be a supported non-empty audio or video file no larger than 10 GB.');
  }
  return input;
}

function safeStem(input) {
  const name = path.basename(input, path.extname(input)).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 96);
  return name || 'transcript';
}

async function spawnChecked(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      reject(error);
      return;
    }
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let aborted = false;
    let forceKillTimer = null;
    const cleanupAbort = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      options.signal?.removeEventListener?.('abort', onAbort);
    };
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      reject(error);
    };
    const onAbort = () => {
      aborted = true;
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch {}
        forceKillTimer = setTimeout(() => {
          try {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          } catch {}
        }, 2500);
        forceKillTimer.unref?.();
      }
    };
    options.signal?.addEventListener?.('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdout.resume();
    child.stderr.resume();
    child.once('error', () => {
      rejectOnce(aborted || options.signal?.aborted
        ? cancellationError(options.signal)
        : new ToolKnitError('ENGINE_UNAVAILABLE', 'The bundled offline transcription engine is unavailable. Reinstall ToolKnit CLI.'));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      if (aborted || options.signal?.aborted) {
        reject(cancellationError(options.signal));
        return;
      }
      code === 0 ? resolve() : reject(new ToolKnitError('PROCESSING_FAILED', 'The local speech engine could not complete recognition.', { details: { exit_code: code } }));
    });
  });
}

function parseSrt(value) {
  return String(value).replace(/^\uFEFF/, '').trim().split(/\r?\n\s*\r?\n/).map(block => {
    const lines = block.split(/\r?\n/);
    const id = Number(lines.shift());
    const timing = lines.shift() || '';
    const match = /^(\S+)\s+-->\s+(\S+)$/.exec(timing.trim());
    return Number.isInteger(id) && match && lines.length ? { id, start: match[1], end: match[2], text: simplifyChineseText(lines.join('\n').trim()) } : null;
  }).filter(Boolean);
}

export function parseRefinement(value, expected) {
  const text = String(value || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const objectStart = text.indexOf('{');
  let parsed;
  try { parsed = JSON.parse(objectStart >= 0 ? text.slice(objectStart) : text); } catch { throw new ToolKnitError('PROCESSING_FAILED', 'AI refinement returned invalid JSON. Original files were kept.'); }
  if (!Array.isArray(parsed?.segments) || parsed.segments.length !== expected.size) throw new ToolKnitError('PROCESSING_FAILED', 'AI refinement changed subtitle segment count. Original files were kept.');
  const result = new Map();
  for (const segment of parsed.segments) {
    const id = Number(segment?.id);
    const content = typeof segment?.text === 'string' ? segment.text.trim() : '';
    if (!expected.has(id) || result.has(id) || !content || content.length > 1200) throw new ToolKnitError('PROCESSING_FAILED', 'AI refinement returned invalid subtitle IDs. Original files were kept.');
    result.set(id, simplifyChineseText(content));
  }
  if (result.size !== expected.size) throw new ToolKnitError('PROCESSING_FAILED', 'AI refinement omitted subtitle segments. Original files were kept.');
  return result;
}

async function refineSrt(rawSrt, options) {
  const apiKey = [process.env.TOOLKNIT_AI_API_KEY, process.env.DEEPSEEK_API_KEY].find(value => !isPlaceholderAiApiKey(value));
  if (!apiKey) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'AI refinement requires DEEPSEEK_API_KEY (or TOOLKNIT_AI_API_KEY) in the CLI/MCP process environment. Original files were kept.');
  const segments = parseSrt(rawSrt);
  if (!segments.length) throw new ToolKnitError('PROCESSING_FAILED', 'No subtitle segments were produced for AI refinement. Original files were kept.');
  const edits = new Map();
  for (let offset = 0; offset < segments.length; offset += 42) {
    throwIfAborted(options.signal);
    const chunk = segments.slice(offset, offset + 42);
    report(options, 96 + Math.round(offset / segments.length * 3), 'Refining subtitle text with AI.');
    let completion;
    try {
      completion = await requestAiCompletion({
        url: process.env.TOOLKNIT_AI_API_URL || 'https://api.deepseek.com/v1/chat/completions', apiKey,
        model: process.env.TOOLKNIT_AI_MODEL || 'deepseek-chat', maxTokens: 4000, signal: options.signal, timeoutMs: 120000,
        messages: [
          { role: 'system', content: 'Return JSON only: {"segments":[{"id":number,"text":string}]}. Proofread speech-recognition subtitles. Keep exactly the supplied IDs in the same order. Never add, remove, merge, or split segments; do not invent missing words, names, numbers, or facts. Correct punctuation, grammar, and only clearly contextual recognition errors.' },
          { role: 'user', content: JSON.stringify({ segments: chunk.map(({ id, text }) => ({ id, text })) }) }
        ]
      });
    } catch (error) {
      if (options.signal?.aborted) throw cancellationError(options.signal);
      if (error?.code === 'timeout') throw new ToolKnitError('PROVIDER_TIMEOUT', 'AI refinement timed out. Original files were kept.');
      throw new ToolKnitError('PROCESSING_FAILED', 'AI refinement request failed. Original files were kept.');
    }
    parseRefinement(completion, new Set(chunk.map(segment => segment.id))).forEach((text, id) => edits.set(id, text));
  }
  const finalSegments = segments.map(segment => ({ ...segment, text: edits.get(segment.id) || segment.text }));
  return {
    srt: finalSegments.map((segment, index) => `${index + 1}\n${segment.start} --> ${segment.end}\n${segment.text}`).join('\n\n') + '\n',
    txt: finalSegments.map(segment => segment.text.replace(/\n/g, ' ')).join('\n') + '\n'
  };
}

export async function transcribeMedia(args, options = {}) {
  throwIfAborted(options.signal);
  if (transcriptionActive) throw new ToolKnitError('PROCESSING_FAILED', 'A local transcription job is already active. Wait for it to finish or cancel it.');
  transcriptionActive = true;
  try { return await performTranscription(args, options); }
  finally { transcriptionActive = false; }
}

async function performTranscription({ input_path, output_dir, language = 'auto', refine = false }, options) {
  throwIfAborted(options.signal);
  const input = await inputFile(input_path);
  const output = await prepareOutputDir(output_dir);
  const normalizedLanguage = String(language).trim().toLowerCase();
  if (!['auto', 'zh', 'en'].includes(normalizedLanguage)) throw new ToolKnitError('INVALID_ARGUMENT', 'language must be auto, zh, or en.');
  if (typeof refine !== 'boolean') throw new ToolKnitError('INVALID_ARGUMENT', 'refine must be true or false.');
  const configured = await config();
  if (!configured.current_model) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'No current offline transcription model is installed. Run: toolknit model install small');
  const model = modelById(configured.current_model);
  if (!await installed(model)) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'No current offline transcription model is installed. Run: toolknit model install small');
  const temporary = path.join(output, `.toolknit-transcription-${process.pid}-${Date.now()}`);
  await mkdir(temporary, { recursive: false });
  let workspace;
  try {
    workspace = await createWhisperWorkspace(temporary);
    const modelFile = await stageWhisperModel(modelPath(model), workspace.path, options.signal);
    const wav = path.join(workspace.path, 'input.wav');
    report(options, 3, 'Preparing audio for local recognition.');
    const ffmpeg = await resolveFfmpeg();
    const converted = await runFfmpeg(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { signal: options.signal });
    throwIfAborted(options.signal);
    if (converted.code !== 0 || !await regularFile(wav)) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(converted.stderr, 'FFmpeg could not prepare this media file.'));
    report(options, 16, `Recognizing speech with the ${model.display_name} model.`);
    const whisper = await resolveWhisper();
    await spawnChecked(whisper, ['-m', modelFile, '-f', wav, '-l', normalizedLanguage, '-otxt', '-osrt', '-oj', '-ojf', '-np', '-of', path.join(workspace.path, 'transcript')], { signal: options.signal });
    throwIfAborted(options.signal);
    if (workspace.path !== temporary) {
      for (const extension of ['json', 'srt', 'txt']) await copyFile(path.join(workspace.path, `transcript.${extension}`), path.join(temporary, `transcript.${extension}`));
    }
    const sources = { json: path.join(temporary, 'transcript.json'), srt: path.join(temporary, 'transcript.srt'), txt: path.join(temporary, 'transcript.txt') };
    if (!await regularFile(sources.json) || !await regularFile(sources.srt) || !await regularFile(sources.txt)) throw new ToolKnitError('PROCESSING_FAILED', 'The transcription engine did not create every expected output.');
    // Whisper sometimes answers in traditional characters; publish simplified.
    for (const filePath of [sources.json, sources.srt, sources.txt]) {
      const content = await readFile(filePath, 'utf8');
      const simplified = filePath === sources.json
        ? JSON.stringify(simplifyTranscriptionJson(JSON.parse(content)))
        : simplifyChineseText(content);
      if (simplified !== content) await writeFile(filePath, simplified, 'utf8');
    }
    report(options, 94, 'Publishing transcription results.');
    const stem = safeStem(input);
    let suffix = 0;
    let outputs;
    while (suffix < 10_000) {
      const ending = suffix === 0 ? '' : `_${suffix}`;
      outputs = { raw_json_path: path.join(output, `${stem}_transcript${ending}.json`), raw_srt_path: path.join(output, `${stem}_transcript${ending}.srt`), raw_txt_path: path.join(output, `${stem}_transcript${ending}.txt`) };
      try { await access(outputs.raw_json_path); suffix++; continue; } catch {}
      try { await access(outputs.raw_srt_path); suffix++; continue; } catch {}
      try { await access(outputs.raw_txt_path); suffix++; continue; } catch {}
      if (refine === true) {
        try { await access(outputs.raw_srt_path.replace(/\.srt$/i, '_refined.srt')); suffix++; continue; } catch {}
        try { await access(outputs.raw_txt_path.replace(/\.txt$/i, '_refined.txt')); suffix++; continue; } catch {}
      }
      try {
        throwIfAborted(options.signal);
        // link() is exclusive and stays within output_dir's volume. This prevents
        // partially publishing a JSON/SRT/TXT trio if another process wins a name.
        await link(sources.json, outputs.raw_json_path);
        try {
          await link(sources.srt, outputs.raw_srt_path);
          try {
            await link(sources.txt, outputs.raw_txt_path);
            break;
          } catch (error) {
            await rm(outputs.raw_json_path, { force: true });
            await rm(outputs.raw_srt_path, { force: true });
            if (error?.code === 'EEXIST') { suffix++; continue; }
            throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not publish the transcription TXT output.');
          }
        } catch (error) {
          await rm(outputs.raw_json_path, { force: true });
          if (error?.code === 'EEXIST') { suffix++; continue; }
          throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not publish the transcription SRT output.');
        }
      } catch (error) {
        if (error?.code === 'EEXIST') { suffix++; continue; }
        if (error instanceof ToolKnitError) throw error;
        throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not publish the transcription JSON output.');
      }
    }
    if (suffix >= 10_000) throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve unique output file names.');
    let refined = {};
    if (refine === true) {
      throwIfAborted(options.signal);
      const refinedText = await refineSrt(await readFile(outputs.raw_srt_path, 'utf8'), options);
      throwIfAborted(options.signal);
      const srtPath = outputs.raw_srt_path.replace(/\.srt$/i, '_refined.srt');
      const txtPath = outputs.raw_txt_path.replace(/\.txt$/i, '_refined.txt');
      await writeFile(srtPath, refinedText.srt, { encoding: 'utf8', flag: 'wx' });
      try { await writeFile(txtPath, refinedText.txt, { encoding: 'utf8', flag: 'wx' }); } catch (error) { await rm(srtPath, { force: true }); throw error; }
      refined = { refined_srt_path: srtPath, refined_txt_path: txtPath };
    }
    report(options, 100, 'Transcription complete.');
    return { tool: 'transcribe', model_id: model.id, input_path: input, output_dir: output, language: normalizedLanguage, ...outputs, ...refined, outputs: [...Object.values(outputs), ...Object.values(refined)].map(path => ({ path })) };
  } finally {
    try { await workspace?.dispose(); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
