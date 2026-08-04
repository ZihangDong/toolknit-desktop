import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVideoFrameFormat, normalizeVideoFrameTimestamp, VIDEO_FRAME_LIMITS } from './core/video-frame-core.js';
import { createAudioTemporaryOutput, discardAudioTemporaryOutput, prepareAudioOutputDirectory, publishAudioTemporaryOutput } from './audio-runtime.mjs';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, probeFfmpegDuration, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);

async function inspectInput(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  const requested = path.resolve(value.trim());
  let metadata;
  try { metadata = await lstat(requested); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Video input does not exist: ${requested}`); }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) throw new ToolKnitError('INPUT_INVALID', 'Video input must be a non-empty regular file.');
  if (metadata.size > VIDEO_FRAME_LIMITS.maxInputBytes || !VIDEO_EXTENSIONS.has(path.extname(requested).slice(1).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', 'Unsupported video input.');
  try { return { path: await realpath(requested), bytes: metadata.size }; } catch { throw new ToolKnitError('INPUT_INVALID', 'Video input cannot be resolved.'); }
}

export async function extractVideoFrame(args, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  const allowed = new Set(['input_path', 'output_dir', 'timestamp_ms', 'format']);
  Object.keys(args).forEach(key => { if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`); });
  const input = await inspectInput(args.input_path);
  if (typeof args.output_dir !== 'string' || !args.output_dir.trim() || args.output_dir.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path string.');
  let format;
  try { format = normalizeVideoFrameFormat(args.format || 'png'); } catch (error) { throw new ToolKnitError('INVALID_ARGUMENT', error.message); }
  const command = await resolveFfmpeg();
  const duration = await probeFfmpegDuration(command, input.path);
  let timestampMs;
  try { timestampMs = normalizeVideoFrameTimestamp(args.timestamp_ms, duration ?? undefined); } catch (error) { throw new ToolKnitError('INVALID_ARGUMENT', error.message); }
  const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
  const extension = format === 'png' ? '.png' : '.jpg';
  const temporary = await createAudioTemporaryOutput(outputDirectory, extension);
  options.reportProgress?.(0, 'Validating video and locating the requested frame.');
  try {
    const result = await runFfmpeg(command, [
      '-hide_banner', '-nostdin', '-y', '-i', input.path, '-ss', (timestampMs / 1000).toFixed(3),
      '-map', '0:v:0', '-frames:v', '1', ...(format === 'png' ? ['-c:v', 'png'] : ['-q:v', '2']), temporary.path
    ]);
    if (result.code !== 0 || result.signal) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr, 'FFmpeg could not extract the requested video frame.'));
    const metadata = await stat(temporary.path);
    if (!metadata.isFile() || metadata.size < 1) throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty frame image.');
    const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, extension, `${path.basename(input.path, path.extname(input.path))}_frame_${timestampMs}ms`);
    options.reportProgress?.(100, 'Published the extracted frame.');
    return { tool: 'video.frame', input_path: input.path, output_path: outputPath, output_dir: outputDirectory, timestamp_ms: timestampMs, format, bytes: metadata.size, duration_seconds: duration };
  } catch (error) {
    await discardAudioTemporaryOutput(temporary);
    throw error;
  }
}
