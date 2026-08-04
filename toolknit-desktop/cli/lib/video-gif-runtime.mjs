import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVideoGifRequest, VIDEO_GIF_LIMITS } from './core/video-gif-core.js';
import { createAudioTemporaryOutput, discardAudioTemporaryOutput, prepareAudioOutputDirectory, publishAudioTemporaryOutput } from './audio-runtime.mjs';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, probeFfmpegDuration, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);

async function inspectInput(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  const requested = path.resolve(value.trim());
  let metadata;
  try { metadata = await lstat(requested); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Video input does not exist: ${requested}`); }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1 || metadata.size > VIDEO_GIF_LIMITS.maxInputBytes || !VIDEO_EXTENSIONS.has(path.extname(requested).slice(1).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', 'Video input must be a supported non-empty regular file no larger than 10 GB.');
  try { return { path: await realpath(requested), bytes: metadata.size }; } catch { throw new ToolKnitError('INPUT_INVALID', 'Video input cannot be resolved.'); }
}

function normalizeRequest(args, duration) {
  try {
    return normalizeVideoGifRequest({ start_ms: args.start_ms, end_ms: args.end_ms, frame_rate: args.frame_rate, width: args.width, quality: args.quality }, duration ?? undefined);
  } catch (error) {
    throw new ToolKnitError('INVALID_ARGUMENT', error?.message || 'Invalid GIF settings.');
  }
}

function gifQualitySettings(quality) {
  switch (quality) {
    case 'high': return { maxColors: 256, dither: 'sierra2_4a' };
    case 'small': return { maxColors: 128, dither: 'bayer:bayer_scale=4' };
    case 'tiny': return { maxColors: 96, dither: 'bayer:bayer_scale=5' };
    case 'balanced':
    default: return { maxColors: 192, dither: 'bayer:bayer_scale=3' };
  }
}

export async function extractVideoGif(args, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  const allowed = new Set(['input_path', 'output_dir', 'start_ms', 'end_ms', 'frame_rate', 'width', 'quality']);
  Object.keys(args).forEach(key => { if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`); });
  const input = await inspectInput(args.input_path);
  if (typeof args.output_dir !== 'string' || !args.output_dir.trim() || args.output_dir.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path string.');
  const command = await resolveFfmpeg();
  const duration = await probeFfmpegDuration(command, input.path);
  const settings = normalizeRequest(args, duration);
  const quality = gifQualitySettings(settings.quality);
  const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
  const temporary = await createAudioTemporaryOutput(outputDirectory, '.gif');
  options.reportProgress?.(0, 'Validating video and preparing GIF export.');
  const filter = `fps=${settings.frame_rate},scale=w='min(${settings.width},iw)':h=-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${quality.maxColors}:stats_mode=diff[p];[b][p]paletteuse=dither=${quality.dither}:diff_mode=rectangle[out]`;
  try {
    const result = await runFfmpeg(command, [
      '-hide_banner', '-nostdin', '-y', '-i', input.path, '-ss', (settings.start_ms / 1000).toFixed(3), '-t', (settings.duration_ms / 1000).toFixed(3),
      '-filter_complex', filter, '-map', '[out]', '-loop', '0', temporary.path
    ]);
    if (result.code !== 0 || result.signal) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr, 'FFmpeg could not create the GIF.'));
    const metadata = await stat(temporary.path);
    if (!metadata.isFile() || metadata.size < 1) throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty GIF file.');
    if (metadata.size > VIDEO_GIF_LIMITS.maxOutputBytes) throw new ToolKnitError('PROCESSING_FAILED', 'The GIF exceeds the 500 MB safety limit. Choose a shorter selection or lower quality.');
    const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, '.gif', `${path.basename(input.path, path.extname(input.path))}_clip_${settings.start_ms}-${settings.end_ms}ms`);
    options.reportProgress?.(100, 'Published the GIF.');
    return { tool: 'video.gif', input_path: input.path, output_path: outputPath, output_dir: outputDirectory, bytes: metadata.size, ...settings, duration_seconds: duration };
  } catch (error) {
    await discardAudioTemporaryOutput(temporary);
    throw error;
  }
}
