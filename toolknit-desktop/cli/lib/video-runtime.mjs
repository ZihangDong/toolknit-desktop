import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { VIDEO_CONVERT_LIMITS, VideoConvertError, normalizeVideoTargetFormat } from './core/video-convert-core.js';
import { createAudioTemporaryOutput, discardAudioTemporaryOutput, prepareAudioOutputDirectory, publishAudioTemporaryOutput } from './audio-runtime.mjs';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, parseProgressSeconds, probeFfmpegDuration, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

const SOURCE_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);
const PROFILES = Object.freeze({
  MP4: { extension: '.mp4', videoEncoder: 'libx264', audioEncoder: 'aac', videoArgs: ['-preset', 'fast', '-crf', '23'] },
  MKV: { extension: '.mkv', videoEncoder: 'libx264', audioEncoder: 'aac', videoArgs: ['-preset', 'fast', '-crf', '23'] },
  MOV: { extension: '.mov', videoEncoder: 'libx264', audioEncoder: 'aac', videoArgs: ['-preset', 'fast', '-crf', '23'] },
  AVI: { extension: '.avi', videoEncoder: 'mpeg4', audioEncoder: 'libmp3lame', videoArgs: [] },
  WEBM: { extension: '.webm', videoEncoder: 'libvpx-vp9', audioEncoder: 'libopus', videoArgs: ['-row-mt', '1', '-speed', '2', '-crf', '32', '-b:v', '0'] },
  FLV: { extension: '.flv', videoEncoder: 'libx264', audioEncoder: 'aac', videoArgs: ['-preset', 'fast', '-crf', '23'] },
  WMV: { extension: '.wmv', videoEncoder: 'wmv2', audioEncoder: 'wmav2', videoArgs: [] },
  TS: { extension: '.ts', videoEncoder: 'libx264', audioEncoder: 'aac', videoArgs: ['-preset', 'fast', '-crf', '23'] }
});
let activeVideoBatch = false;

function report(options, value, message) {
  try { options.reportProgress?.(Math.max(0, Math.min(100, value)), message); } catch {}
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
}

async function inspectInputs(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0 || inputPaths.length > VIDEO_CONVERT_LIMITS.maxFiles) {
    throw new ToolKnitError('INVALID_ARGUMENT', `input_paths must contain 1 to ${VIDEO_CONVERT_LIMITS.maxFiles} video paths.`);
  }
  const seen = new Set();
  const inputs = [];
  for (const rawPath of inputPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'Every input path must be a non-empty path string.');
    const requested = path.resolve(rawPath.trim());
    let metadata;
    try { metadata = await lstat(requested); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Video input does not exist: ${requested}`); }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) throw new ToolKnitError('INPUT_INVALID', `Video input must be a non-empty regular file: ${requested}`);
    if (!SOURCE_EXTENSIONS.has(path.extname(requested).slice(1).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', `Unsupported video input format: ${path.basename(requested)}`);
    if (metadata.size > VIDEO_CONVERT_LIMITS.maxInputBytes) throw new ToolKnitError('INPUT_TOO_LARGE', 'Video files must be 10GB or smaller.');
    let canonical;
    try { canonical = await realpath(requested); } catch { throw new ToolKnitError('INPUT_INVALID', `Video input cannot be resolved: ${requested}`); }
    if (seen.has(canonical)) throw new ToolKnitError('INPUT_INVALID', `Duplicate video input: ${canonical}`);
    seen.add(canonical);
    inputs.push({ path: canonical, name: path.basename(canonical), bytes: metadata.size });
  }
  return inputs;
}

function profileFor(targetFormat) {
  try {
    const format = normalizeVideoTargetFormat(targetFormat);
    return { format, ...PROFILES[format] };
  } catch (error) {
    throw new ToolKnitError('INVALID_ARGUMENT', error instanceof VideoConvertError ? error.message : 'Unsupported target video format.');
  }
}

async function convertOne({ command, input, outputDirectory, profile, index, total, options }) {
  const temporary = await createAudioTemporaryOutput(outputDirectory, profile.extension);
  try {
    const duration = await probeFfmpegDuration(command, input.path);
    let progressBuffer = '';
    const result = await runFfmpeg(command, [
      '-hide_banner', '-nostdin', '-y', '-i', input.path,
      '-map', '0:v:0?', '-map', '0:a?', '-map_metadata', '0',
      '-c:v', profile.videoEncoder, '-c:a', profile.audioEncoder, '-pix_fmt', 'yuv420p',
      ...profile.videoArgs,
      '-progress', 'pipe:1', '-nostats', temporary.path
    ], {
      onStdout(chunk) {
        progressBuffer += chunk.toString('utf8');
        let lineEnd;
        while ((lineEnd = progressBuffer.indexOf('\n')) !== -1) {
          const elapsed = parseProgressSeconds(progressBuffer.slice(0, lineEnd).trim());
          progressBuffer = progressBuffer.slice(lineEnd + 1);
          if (elapsed === null || !duration) continue;
          const fraction = Math.max(0, Math.min(0.98, elapsed / duration));
          report(options, ((index - 1 + fraction) / total) * 96, `Converting ${index}/${total}: ${input.name}`);
        }
      }
    });
    if (result.code !== 0 || result.signal) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr, 'FFmpeg could not convert this video.'));
    const metadata = await stat(temporary.path);
    if (!metadata.isFile() || metadata.size < 1) throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty video file.');
    const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, profile.extension, `${path.basename(input.path, path.extname(input.path))}_converted`);
    return { input_path: input.path, path: outputPath, bytes: metadata.size, format: profile.format, video_encoder: profile.videoEncoder, audio_encoder: profile.audioEncoder, hardware_acceleration: false };
  } catch (error) {
    await discardAudioTemporaryOutput(temporary);
    throw error;
  }
}

export async function convertVideoBatch(args, options = {}) {
  assertObject(args);
  assertOnlyKeys(args, new Set(['input_paths', 'output_dir', 'target_format']));
  if (activeVideoBatch) throw new ToolKnitError('PROCESSING_FAILED', 'Another ToolKnit video conversion is already running. Wait for it to finish.');
  activeVideoBatch = true;
  try {
    report(options, 0, 'Validating video inputs.');
    const inputs = await inspectInputs(args.input_paths);
    if (typeof args.output_dir !== 'string' || !args.output_dir.trim() || args.output_dir.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path string.');
    const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
    const profile = profileFor(args.target_format);
    const command = await resolveFfmpeg();
    if ((await runFfmpeg(command, ['-version'])).code !== 0) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it or configure TOOLKNIT_FFMPEG_PATH.');

    const outputs = [];
    const errors = [];
    for (const [offset, input] of inputs.entries()) {
      const index = offset + 1;
      report(options, ((index - 1) / inputs.length) * 96, `Preparing ${index}/${inputs.length}: ${input.name}`);
      try {
        outputs.push(await convertOne({ command, input, outputDirectory, profile, index, total: inputs.length, options }));
      } catch (error) {
        const normalized = error instanceof ToolKnitError ? error : new ToolKnitError('PROCESSING_FAILED', 'FFmpeg could not convert this video.');
        errors.push({ input_path: input.path, name: input.name, code: normalized.code, message: normalized.message });
        report(options, (index / inputs.length) * 96, `Failed ${index}/${inputs.length}: ${input.name}`);
      }
    }
    if (outputs.length === 0) throw new ToolKnitError('PROCESSING_FAILED', 'No video files could be converted.', { details: { errors } });
    report(options, 100, `Converted ${outputs.length}/${inputs.length} video file${inputs.length === 1 ? '' : 's'}.`);
    return {
      tool: 'video.convert', target_format: profile.format, output_dir: outputDirectory,
      inputs: inputs.map(input => ({ path: input.path, bytes: input.bytes })), success_count: outputs.length, fail_count: errors.length,
      outputs, errors, ...(errors.length ? { warnings: [`${errors.length} video file${errors.length === 1 ? '' : 's'} could not be converted.`] } : {})
    };
  } finally {
    activeVideoBatch = false;
  }
}
