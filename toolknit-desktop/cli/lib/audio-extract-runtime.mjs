import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_EXTRACT_LIMITS, AudioExtractError, normalizeAudioExtractFormat, normalizeAudioTrackIndex } from './core/audio-extract-core.js';
import { getAudioConversionProfile } from './core/audio-convert-core.js';
import { createAudioTemporaryOutput, discardAudioTemporaryOutput, prepareAudioOutputDirectory, publishAudioTemporaryOutput } from './audio-runtime.mjs';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, parseProgressSeconds, probeFfmpegDuration, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);
let activeAudioExtract = false;
const report = (options, value, message) => { try { options.reportProgress?.(Math.max(0, Math.min(100, value)), message); } catch {} };

async function inputFile(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  const resolved = path.resolve(value.trim()); let meta;
  try { meta = await lstat(resolved); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Video input does not exist: ${resolved}`); }
  if (meta.isSymbolicLink() || !meta.isFile() || meta.size < 1) throw new ToolKnitError('INPUT_INVALID', `Video input must be a non-empty regular file: ${resolved}`);
  if (!VIDEO_EXTENSIONS.has(path.extname(resolved).slice(1).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', `Unsupported video input format: ${path.basename(resolved)}`);
  if (meta.size > AUDIO_EXTRACT_LIMITS.maxInputBytes) throw new ToolKnitError('INPUT_TOO_LARGE', 'Video files for audio extraction must be 10GB or smaller.');
  try { return { path: await realpath(resolved), bytes: meta.size }; } catch { throw new ToolKnitError('INPUT_INVALID', `Video input cannot be resolved: ${resolved}`); }
}

export async function extractAudio(args, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  for (const key of Object.keys(args)) if (!new Set(['input_path', 'output_dir', 'target_format', 'track_index', 'quality']).has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  if (activeAudioExtract) throw new ToolKnitError('PROCESSING_FAILED', 'Another ToolKnit audio extraction is already running. Wait for it to finish.');
  activeAudioExtract = true;
  try {
    report(options, 0, 'Validating video input.');
    const input = await inputFile(args.input_path);
    if (typeof args.output_dir !== 'string' || !args.output_dir.trim() || args.output_dir.includes('\0')) throw new ToolKnitError('INVALID_ARGUMENT', 'output_dir must be a non-empty path string.');
    let format, track;
    try { format = normalizeAudioExtractFormat(args.target_format); track = normalizeAudioTrackIndex(args.track_index); } catch (error) { throw new ToolKnitError('INVALID_ARGUMENT', error instanceof AudioExtractError ? error.message : 'Invalid audio extraction options.'); }
    const profile = getAudioConversionProfile(format, args.quality);
    const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
    const command = await resolveFfmpeg();
    if ((await runFfmpeg(command, ['-version'])).code !== 0) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it or configure TOOLKNIT_FFMPEG_PATH.');
    const duration = await probeFfmpegDuration(command, input.path);
    report(options, 12, 'Probing video audio tracks.');
    let buffer = ''; const temporary = await createAudioTemporaryOutput(outputDirectory, profile.extension);
    try {
      const result = await runFfmpeg(command, ['-hide_banner', '-nostdin', '-y', '-i', input.path, '-vn', '-map', `0:a:${track ?? 0}`, '-c:a', profile.encoder, ...profile.args, '-progress', 'pipe:1', '-nostats', temporary.path], { onStdout(chunk) { buffer += chunk.toString('utf8'); let end; while ((end = buffer.indexOf('\n')) !== -1) { const seconds = parseProgressSeconds(buffer.slice(0, end).trim()); buffer = buffer.slice(end + 1); if (seconds !== null && duration) report(options, Math.min(92, 20 + seconds / duration * 70), 'Extracting audio track.'); } } });
      if (result.code !== 0 || result.signal) throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr, 'FFmpeg could not extract this audio track.'));
      const metadata = await stat(temporary.path); if (!metadata.isFile() || metadata.size < 1) throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty audio file.');
      report(options, 95, 'Publishing extracted audio.');
      const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, profile.extension, `${path.basename(input.path, path.extname(input.path))}_audio`);
      report(options, 100, 'Audio extraction completed.');
      return { tool: 'audio.extract', input: { path: input.path, bytes: input.bytes, duration_seconds: duration }, track_index: track ?? 0, target_format: profile.format, quality: profile.quality, output: { path: outputPath, bytes: metadata.size, format: profile.format } };
    } catch (error) { await discardAudioTemporaryOutput(temporary); throw error; }
  } finally { activeAudioExtract = false; }
}
