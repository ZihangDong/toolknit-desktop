import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AUDIO_CLIP_LIMITS,
  assertAudioClipSelection,
  AudioClipError,
  isAudioClipSupportedName
} from './core/audio-clip-core.js';
import {
  createAudioTemporaryOutput,
  discardAudioTemporaryOutput,
  prepareAudioOutputDirectory,
  publishAudioTemporaryOutput,
  sanitizedAudioOutputStem
} from './audio-runtime.mjs';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, probeFfmpegDuration, parseProgressSeconds, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

let activeAudioClip = false;

function report(options, progress, message) {
  try { options.reportProgress?.(Math.max(0, Math.min(100, progress)), message); } catch {}
}

function assertArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  for (const key of Object.keys(args)) {
    if (!new Set(['input_path', 'output_dir', 'start_seconds', 'end_seconds', 'target_format']).has(key)) {
      throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
    }
  }
  for (const key of ['input_path', 'output_dir']) {
    if (typeof args[key] !== 'string' || args[key].trim().length === 0 || args[key].includes('\0')) {
      throw new ToolKnitError('INVALID_ARGUMENT', `${key} must be a non-empty path string.`);
    }
  }
  if (args.target_format !== undefined && args.target_format !== 'mp3') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'target_format must be mp3 when supplied.');
  }
}

function parseChannelCount(ffmpegOutput) {
  const line = ffmpegOutput.split(/\r?\n/).find(value => /\bAudio:\s/i.test(value));
  if (!line) throw new ToolKnitError('INPUT_INVALID', 'The selected file does not contain a readable audio stream.');
  const layout = /,\s*(mono|stereo|\d+\.\d+(?:\([^)]*\))?)\s*(?:,|$)/i.exec(line)?.[1]?.toLowerCase();
  const explicitChannels = /,\s*(\d+)\s+channels?\s*(?:,|$)/i.exec(line)?.[1];
  const channels = layout === 'mono'
    ? 1
    : layout === 'stereo'
      ? 2
      : layout
        ? layout.split('(')[0].split('.').reduce((sum, item) => sum + Number(item), 0)
        : explicitChannels !== undefined
          ? Number(explicitChannels)
          : null;
  if (!Number.isInteger(channels) || channels < 1 || channels > AUDIO_CLIP_LIMITS.maxChannels) {
    throw new ToolKnitError('INPUT_INVALID', 'Audio clipping supports mono or stereo audio only.');
  }
  return channels;
}

async function inspectInput(inputPath) {
  const resolved = path.resolve(inputPath.trim());
  let metadata;
  try { metadata = await lstat(resolved); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Audio input does not exist: ${resolved}`); }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `Audio input must be a non-empty regular file: ${resolved}`);
  }
  if (!isAudioClipSupportedName(resolved)) {
    throw new ToolKnitError('INPUT_INVALID', `Unsupported audio clip input format: ${path.basename(resolved)}`);
  }
  if (metadata.size > AUDIO_CLIP_LIMITS.maxInputBytes) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `Audio clipping accepts files up to ${AUDIO_CLIP_LIMITS.maxInputBytes / 1024 / 1024}MB.`);
  }
  try {
    const canonicalPath = await realpath(resolved);
    return { path: canonicalPath, name: path.basename(canonicalPath), bytes: metadata.size, extension: path.extname(canonicalPath).toLowerCase() };
  } catch {
    throw new ToolKnitError('INPUT_INVALID', `Audio input cannot be resolved: ${resolved}`);
  }
}

async function trimWithFfmpeg({ command, input, temporaryPath, start, duration, copy, reportProgress }) {
  let progressBuffer = '';
  const args = [
    '-hide_banner', '-nostdin', '-y', '-i', input.path, '-ss', String(start), '-t', String(duration),
    '-map', '0:a:0', '-map_metadata', '0', ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-q:a', '2']),
    '-progress', 'pipe:1', '-nostats', temporaryPath
  ];
  const result = await runFfmpeg(command, args, {
    onStdout(chunk) {
      progressBuffer += chunk.toString('utf8');
      let lineEnd;
      while ((lineEnd = progressBuffer.indexOf('\n')) !== -1) {
        const seconds = parseProgressSeconds(progressBuffer.slice(0, lineEnd).trim());
        progressBuffer = progressBuffer.slice(lineEnd + 1);
        if (seconds !== null) reportProgress(Math.min(88, 35 + seconds / duration * 53));
      }
    }
  });
  if (result.code !== 0 || result.signal) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr, 'FFmpeg could not trim this audio file.'));
  let metadata;
  try { metadata = await stat(temporaryPath); } catch { throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg completed without producing an audio clip.'); }
  if (!metadata.isFile() || metadata.size < 1) throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty audio clip.');
  return metadata;
}

export async function clipAudio(args, options = {}) {
  assertArguments(args);
  if (activeAudioClip) throw new ToolKnitError('PROCESSING_FAILED', 'Another ToolKnit audio clip is already running. Wait for it to finish.');
  activeAudioClip = true;
  try {
    report(options, 0, 'Validating audio clip input.');
    const input = await inspectInput(args.input_path);
    const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
    const command = await resolveFfmpeg();
    const engine = await runFfmpeg(command, ['-version']);
    if (engine.code !== 0) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it or configure TOOLKNIT_FFMPEG_PATH.');

    report(options, 12, 'Reading audio stream metadata.');
    const probe = await runFfmpeg(command, ['-hide_banner', '-nostdin', '-i', input.path]);
    const sourceDuration = await probeFfmpegDuration(command, input.path);
    if (!sourceDuration) throw new ToolKnitError('INPUT_INVALID', 'The selected file has no readable audio duration.');
    if (sourceDuration > AUDIO_CLIP_LIMITS.maxDurationSeconds) throw new ToolKnitError('INPUT_INVALID', `Audio clipping supports audio up to ${AUDIO_CLIP_LIMITS.maxDurationSeconds / 60} minutes.`);
    const channels = parseChannelCount(`${probe.stdout}\n${probe.stderr}`);
    let selection;
    try { selection = assertAudioClipSelection(args.start_seconds, args.end_seconds, sourceDuration); } catch (error) {
      if (error instanceof AudioClipError) throw new ToolKnitError('INVALID_ARGUMENT', error.message);
      throw error;
    }
    const duration = selection.end - selection.start;
    const forceMp3 = args.target_format === 'mp3';
    const sourceExtension = forceMp3 ? '.mp3' : input.extension;
    const outputStem = `${sanitizedAudioOutputStem(input.path)}_clip`;
    let temporary = await createAudioTemporaryOutput(outputDirectory, sourceExtension);
    let streamCopy = !forceMp3;
    let outputMetadata;
    try {
      report(options, 28, streamCopy ? 'Trimming audio without re-encoding.' : 'Encoding MP3 audio clip.');
      outputMetadata = await trimWithFfmpeg({
        command, input, temporaryPath: temporary.path, start: selection.start, duration, copy: streamCopy,
        reportProgress: value => report(options, value, streamCopy ? 'Trimming audio without re-encoding.' : 'Encoding MP3 audio clip.')
      });
    } catch (error) {
      await discardAudioTemporaryOutput(temporary);
      if (forceMp3 || !(error instanceof ToolKnitError && error.code === 'PROCESSING_FAILED')) throw error;
      streamCopy = false;
      temporary = await createAudioTemporaryOutput(outputDirectory, '.mp3');
      report(options, 45, 'Source container cannot be stream-copied; encoding an MP3 clip.');
      outputMetadata = await trimWithFfmpeg({
        command, input, temporaryPath: temporary.path, start: selection.start, duration, copy: false,
        reportProgress: value => report(options, value, 'Encoding MP3 audio clip.')
      });
    }
    report(options, 92, 'Publishing audio clip.');
    const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, streamCopy ? input.extension : '.mp3', outputStem);
    report(options, 100, 'Audio clip completed.');
    return {
      tool: 'audio.clip',
      input: { path: input.path, bytes: input.bytes, duration_seconds: Math.round(sourceDuration * 1000) / 1000, channels },
      selection: { start_seconds: selection.start, end_seconds: selection.end, duration_seconds: Math.round(duration * 1000) / 1000 },
      output: { path: outputPath, bytes: outputMetadata.size, format: streamCopy ? input.extension.slice(1) : 'mp3', stream_copy: streamCopy },
      ...(streamCopy ? {} : { warnings: ['The clip was encoded as MP3 because stream copying was unavailable or MP3 was requested.'] })
    };
  } finally {
    activeAudioClip = false;
  }
}
