import { lstat, link, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AUDIO_CONVERT_LIMITS,
  AUDIO_SOURCE_EXTENSIONS,
  AudioConvertError,
  getAudioConversionProfile
} from './core/audio-convert-core.js';
import { ToolKnitError } from './errors.mjs';
import {
  checkFfmpegAvailability,
  compactFfmpegError,
  parseProgressSeconds,
  probeFfmpegDuration,
  resolveFfmpeg,
  runFfmpeg
} from './ffmpeg-runtime.mjs';

const SOURCE_EXTENSIONS = new Set(AUDIO_SOURCE_EXTENSIONS);
const MAX_OUTPUT_NAME_ATTEMPTS = 10_000;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

let activeAudioBatch = false;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be an object.`);
  }
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty path string.`);
  }
  return value.trim();
}

function report(options, progress, message) {
  try {
    options.reportProgress?.(Math.max(0, Math.min(100, progress)), message);
  } catch {
    // A progress consumer cannot change the file operation outcome.
  }
}

function sourceExtension(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

async function inspectAudioInput(inputPath) {
  const requestedPath = assertString(inputPath, 'input_paths item');
  const resolvedPath = path.resolve(requestedPath);
  let metadata;
  try {
    metadata = await lstat(resolvedPath);
  } catch {
    throw new ToolKnitError('INPUT_NOT_FOUND', `Audio input does not exist: ${resolvedPath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `Audio input must be a non-empty regular file: ${resolvedPath}`);
  }
  if (!SOURCE_EXTENSIONS.has(sourceExtension(resolvedPath))) {
    throw new ToolKnitError('INPUT_INVALID', `Unsupported audio input format: ${path.basename(resolvedPath)}`);
  }
  if (metadata.size > AUDIO_CONVERT_LIMITS.maxBytesPerFile) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `Audio input exceeds the ${AUDIO_CONVERT_LIMITS.maxBytesPerFile}-byte limit: ${path.basename(resolvedPath)}`);
  }
  let canonicalPath;
  try {
    canonicalPath = await realpath(resolvedPath);
  } catch {
    throw new ToolKnitError('INPUT_INVALID', `Audio input cannot be resolved: ${resolvedPath}`);
  }
  return { path: canonicalPath, name: path.basename(canonicalPath), bytes: metadata.size };
}

async function inspectAudioInputs(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'input_paths must contain at least one audio file.');
  }
  if (inputPaths.length > AUDIO_CONVERT_LIMITS.maxFiles) {
    throw new ToolKnitError('INVALID_ARGUMENT', `input_paths can contain at most ${AUDIO_CONVERT_LIMITS.maxFiles} audio files.`);
  }
  const inputs = [];
  const seen = new Set();
  for (const inputPath of inputPaths) {
    const input = await inspectAudioInput(inputPath);
    if (seen.has(input.path)) {
      throw new ToolKnitError('INPUT_INVALID', `Duplicate audio input: ${input.path}`);
    }
    seen.add(input.path);
    inputs.push(input);
  }
  return inputs;
}

export async function prepareAudioOutputDirectory(outputDirectory) {
  const requestedDirectory = assertString(outputDirectory, 'output_dir');
  const resolvedDirectory = path.resolve(requestedDirectory);
  try {
    await mkdir(resolvedDirectory, { recursive: true });
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Cannot create output directory: ${resolvedDirectory}`);
  }
  let metadata;
  try {
    metadata = await lstat(resolvedDirectory);
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Output directory cannot be inspected: ${resolvedDirectory}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  }
  try {
    return await realpath(resolvedDirectory);
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Output directory cannot be resolved: ${resolvedDirectory}`);
  }
}

export function sanitizedAudioOutputStem(inputPath) {
  const rawStem = path.basename(inputPath, path.extname(inputPath));
  const normalized = rawStem
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 96);
  if (!normalized || WINDOWS_RESERVED_NAMES.has(normalized.toUpperCase())) return 'audio';
  return normalized;
}

export async function createAudioTemporaryOutput(outputDirectory, extension) {
  try {
    const temporaryDirectory = await mkdtemp(path.join(outputDirectory, '.toolknit-audio-'));
    return {
      directory: temporaryDirectory,
      path: path.join(temporaryDirectory, `encoded${extension}`)
    };
  } catch {
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Cannot prepare a temporary output in: ${outputDirectory}`);
  }
}

export async function discardAudioTemporaryOutput(temporary) {
  if (!temporary?.directory) return;
  try { await rm(temporary.directory, { recursive: true, force: true }); } catch {}
}

export async function publishAudioTemporaryOutput(temporary, outputDirectory, sourcePath, extension, outputStem = null) {
  const stem = outputStem ? sanitizedAudioOutputStem(outputStem) : sanitizedAudioOutputStem(sourcePath);
  for (let index = 0; index < MAX_OUTPUT_NAME_ATTEMPTS; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(outputDirectory, `${stem}${suffix}${extension}`);
    try {
      // link() gives us an exclusive, same-volume publication without replacing an existing file.
      await link(temporary.path, candidate);
      await discardAudioTemporaryOutput(temporary);
      return candidate;
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Cannot publish audio output in: ${outputDirectory}`);
    }
  }
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve a unique audio output filename.');
}


async function convertOneAudio({ command, input, outputDirectory, profile, position, total, reportProgress }) {
  const temporary = await createAudioTemporaryOutput(outputDirectory, profile.extension);
  try {
    const duration = await probeFfmpegDuration(command, input.path);
    let stdoutBuffer = '';
    const result = await runFfmpeg(command, [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i', input.path,
      '-map', '0:a:0',
      '-map_metadata', '0',
      '-c:a', profile.encoder,
      ...profile.args,
      '-progress', 'pipe:1',
      '-nostats',
      temporary.path
    ], {
      onStdout(chunk) {
        stdoutBuffer += chunk.toString('utf8');
        let lineEnd;
        while ((lineEnd = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.slice(0, lineEnd).trim();
          stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);
          const elapsed = parseProgressSeconds(line);
          if (elapsed === null || duration === null) continue;
          const fraction = Math.max(0, Math.min(0.98, elapsed / duration));
          reportProgress(((position - 1 + fraction) / total) * 96, `Converting ${position}/${total}: ${input.name}`);
        }
      }
    });
    if (result.code !== 0 || result.signal) {
      throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(result.stderr));
    }
    let outputMetadata;
    try {
      outputMetadata = await stat(temporary.path);
    } catch {
      throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg completed without producing an audio file.');
    }
    if (!outputMetadata.isFile() || outputMetadata.size < 1) {
      throw new ToolKnitError('PROCESSING_FAILED', 'FFmpeg produced an empty audio file.');
    }
    const outputPath = await publishAudioTemporaryOutput(temporary, outputDirectory, input.path, profile.extension);
    return { input_path: input.path, path: outputPath, bytes: outputMetadata.size, format: profile.format };
  } catch (error) {
    await discardAudioTemporaryOutput(temporary);
    throw error;
  }
}

export async function convertAudioBatch(args, options = {}) {
  assertObject(args, 'arguments');
  assertOnlyKeys(args, new Set(['input_paths', 'output_dir', 'target_format', 'quality']));
  if (activeAudioBatch) {
    throw new ToolKnitError('PROCESSING_FAILED', 'Another ToolKnit audio conversion is already running. Wait for it to finish before starting a new batch.');
  }

  activeAudioBatch = true;
  try {
    report(options, 0, 'Validating audio inputs.');
    const inputs = await inspectAudioInputs(args.input_paths);
    const outputDirectory = await prepareAudioOutputDirectory(args.output_dir);
    let profile;
    try {
      profile = getAudioConversionProfile(args.target_format, args.quality);
    } catch (error) {
      const message = error instanceof AudioConvertError ? error.message : 'Unsupported audio conversion settings.';
      throw new ToolKnitError('INVALID_ARGUMENT', message);
    }
    const command = await resolveFfmpeg();
    const engine = await runFfmpeg(command, ['-version']);
    if (engine.code !== 0) {
      throw new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it or configure TOOLKNIT_FFMPEG_PATH.');
    }

    report(options, 2, `Converting ${inputs.length} audio file${inputs.length === 1 ? '' : 's'} to ${profile.format}.`);
    const outputs = [];
    const errors = [];
    for (const [index, input] of inputs.entries()) {
      const position = index + 1;
      report(options, ((position - 1) / inputs.length) * 96, `Preparing ${position}/${inputs.length}: ${input.name}`);
      try {
        outputs.push(await convertOneAudio({
          command,
          input,
          outputDirectory,
          profile,
          position,
          total: inputs.length,
          reportProgress: (progress, message) => report(options, progress, message)
        }));
      } catch (error) {
        const normalized = error instanceof ToolKnitError
          ? error
          : new ToolKnitError('PROCESSING_FAILED', 'FFmpeg could not convert this audio file.');
        errors.push({
          input_path: input.path,
          name: input.name,
          code: normalized.code,
          message: normalized.message
        });
        report(options, (position / inputs.length) * 96, `Failed ${position}/${inputs.length}: ${input.name}`);
      }
    }
    if (outputs.length === 0) {
      throw new ToolKnitError('PROCESSING_FAILED', 'No audio files could be converted.', { details: { errors } });
    }

    report(options, 100, `Converted ${outputs.length}/${inputs.length} audio file${inputs.length === 1 ? '' : 's'}.`);
    return {
      tool: 'audio.convert',
      target_format: profile.format,
      quality: profile.quality,
      inputs: inputs.map(input => ({ path: input.path, bytes: input.bytes })),
      output_dir: outputDirectory,
      success_count: outputs.length,
      fail_count: errors.length,
      outputs,
      errors,
      ...(errors.length > 0 ? { warnings: [`${errors.length} audio file${errors.length === 1 ? '' : 's'} could not be converted.`] } : {})
    };
  } finally {
    activeAudioBatch = false;
  }
}

export { checkFfmpegAvailability };
