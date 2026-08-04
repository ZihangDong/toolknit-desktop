import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeBpmPcm,
  BPM_DETECT_LIMITS,
  BpmDetectError,
  isBpmSupportedAudioName
} from './core/bpm-detect-core.js';
import { ToolKnitError } from './errors.mjs';
import { compactFfmpegError, parseFfmpegDuration, resolveFfmpeg, runFfmpeg } from './ffmpeg-runtime.mjs';

let activeBpmAnalysis = false;

function report(options, progress, message) {
  try { options.reportProgress?.(Math.max(0, Math.min(100, progress)), message); } catch {}
}

function assertArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  }
  for (const key of Object.keys(args)) {
    if (key !== 'input_path') throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
  if (typeof args.input_path !== 'string' || args.input_path.trim().length === 0 || args.input_path.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'input_path must be a non-empty path string.');
  }
}

function parseAudioMetadata(ffmpegOutput) {
  const audioLine = ffmpegOutput.split(/\r?\n/).find(line => /\bAudio:\s/i.test(line));
  if (!audioLine) throw new ToolKnitError('INPUT_INVALID', 'The selected file does not contain a readable audio stream.');
  const sampleRate = /,\s*(\d+)\s*Hz\s*,/i.exec(audioLine)?.[1];
  const layout = /,\s*(mono|stereo|\d+\.\d+(?:\([^)]*\))?)\s*(?:,|$)/i.exec(audioLine)?.[1]?.toLowerCase();
  const explicitChannels = /,\s*(\d+)\s+channels?\s*(?:,|$)/i.exec(audioLine)?.[1];
  const channels = layout === 'mono'
    ? 1
    : layout === 'stereo'
      ? 2
      : layout
        ? layout.split('(')[0].split('.').reduce((total, value) => total + Number(value), 0)
        : explicitChannels !== undefined
          ? Number(explicitChannels)
          : null;
  if (!Number.isInteger(channels) || channels < 1 || channels > BPM_DETECT_LIMITS.maxChannels) {
    throw new ToolKnitError('INPUT_INVALID', 'BPM detection supports mono or stereo audio only.');
  }
  const rate = Number(sampleRate);
  if (!Number.isFinite(rate) || rate < 1000 || rate > 384000) {
    throw new ToolKnitError('INPUT_INVALID', 'The selected audio stream has an unsupported sample rate.');
  }
  return { sampleRate: rate, channels };
}

async function inspectInput(inputPath) {
  const resolved = path.resolve(inputPath.trim());
  let metadata;
  try { metadata = await lstat(resolved); } catch { throw new ToolKnitError('INPUT_NOT_FOUND', `Audio input does not exist: ${resolved}`); }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `Audio input must be a non-empty regular file: ${resolved}`);
  }
  if (!isBpmSupportedAudioName(resolved)) {
    throw new ToolKnitError('INPUT_INVALID', `Unsupported BPM audio input format: ${path.basename(resolved)}`);
  }
  if (metadata.size > BPM_DETECT_LIMITS.maxInputBytes) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `BPM detection accepts audio files up to ${BPM_DETECT_LIMITS.maxInputBytes / 1024 / 1024}MB.`);
  }
  try {
    return { path: await realpath(resolved), name: path.basename(resolved), bytes: metadata.size };
  } catch {
    throw new ToolKnitError('INPUT_INVALID', `Audio input cannot be resolved: ${resolved}`);
  }
}

export async function detectAudioBpm(args, options = {}) {
  assertArguments(args);
  if (activeBpmAnalysis) {
    throw new ToolKnitError('PROCESSING_FAILED', 'Another ToolKnit BPM analysis is already running. Wait for it to finish.');
  }
  activeBpmAnalysis = true;
  try {
    report(options, 0, 'Validating BPM audio input.');
    const input = await inspectInput(args.input_path);
    const command = await resolveFfmpeg();
    const engine = await runFfmpeg(command, ['-version']);
    if (engine.code !== 0) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it or configure TOOLKNIT_FFMPEG_PATH.');

    report(options, 12, 'Reading audio stream metadata.');
    const probe = await runFfmpeg(command, ['-hide_banner', '-nostdin', '-i', input.path]);
    const probeOutput = `${probe.stdout}\n${probe.stderr}`;
    const duration = parseFfmpegDuration(probeOutput);
    if (!duration) throw new ToolKnitError('INPUT_INVALID', 'The selected file has no readable audio duration.');
    if (duration > BPM_DETECT_LIMITS.maxDurationSeconds) {
      throw new ToolKnitError('INPUT_INVALID', `BPM detection supports audio up to ${BPM_DETECT_LIMITS.maxDurationSeconds / 60} minutes.`);
    }
    const source = parseAudioMetadata(probeOutput);
    const decodedBytes = Math.ceil(duration * source.sampleRate) * source.channels * Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > BPM_DETECT_LIMITS.maxDecodedPcmBytes) {
      throw new ToolKnitError('INPUT_TOO_LARGE', 'The decoded audio is too large for safe BPM analysis.');
    }

    const analysisSeconds = Math.min(duration, BPM_DETECT_LIMITS.maxAnalysisSeconds);
    const expectedBytes = Math.ceil(analysisSeconds * BPM_DETECT_LIMITS.analysisSampleRate) * Float32Array.BYTES_PER_ELEMENT;
    let emittedBytes = 0;
    let lastDecodeProgress = 25;
    report(options, 25, `Decoding the first ${Math.ceil(analysisSeconds)} seconds of audio.`);
    const decoded = await runFfmpeg(command, [
      '-hide_banner', '-nostdin', '-v', 'error', '-t', String(analysisSeconds), '-i', input.path,
      '-map', '0:a:0', '-ac', '1', '-ar', String(BPM_DETECT_LIMITS.analysisSampleRate), '-f', 'f32le', '-'
    ], {
      maxStdoutBytes: expectedBytes + Float32Array.BYTES_PER_ELEMENT,
      onStdout(chunk) {
        emittedBytes += chunk.length;
        const progress = Math.floor(25 + Math.min(55, emittedBytes / expectedBytes * 55));
        if (progress >= lastDecodeProgress + 2 || progress === 80) {
          lastDecodeProgress = progress;
          report(options, progress, 'Decoding audio for BPM analysis.');
        }
      }
    });
    if (decoded.code !== 0 || decoded.signal || decoded.stdoutTruncated) {
      throw new ToolKnitError('PROCESSING_FAILED', compactFfmpegError(decoded.stderr, 'FFmpeg could not decode this audio file for BPM analysis.'));
    }
    if (decoded.stdoutBuffer.length < Float32Array.BYTES_PER_ELEMENT * 8) {
      throw new ToolKnitError('INPUT_INVALID', 'The selected audio did not produce enough PCM samples for BPM analysis.');
    }
    const alignedBytes = decoded.stdoutBuffer.length - decoded.stdoutBuffer.length % Float32Array.BYTES_PER_ELEMENT;
    const pcm = new Float32Array(decoded.stdoutBuffer.buffer, decoded.stdoutBuffer.byteOffset, alignedBytes / Float32Array.BYTES_PER_ELEMENT);
    report(options, 84, 'Estimating beat intervals.');
    let analysis;
    try { analysis = analyzeBpmPcm(pcm, BPM_DETECT_LIMITS.analysisSampleRate); } catch (error) {
      if (error instanceof BpmDetectError) throw new ToolKnitError('INPUT_INVALID', error.message);
      throw error;
    }
    report(options, 100, analysis.bpm === null ? 'No reliable BPM was detected.' : `Detected ${analysis.bpm} BPM.`);
    return {
      tool: 'audio.bpm',
      input: { path: input.path, bytes: input.bytes, duration_seconds: Math.round(duration * 1000) / 1000, channels: source.channels },
      analysis: {
        sample_rate: BPM_DETECT_LIMITS.analysisSampleRate,
        analyzed_seconds: Math.round(analysis.analyzedSeconds * 1000) / 1000,
        max_analysis_seconds: BPM_DETECT_LIMITS.maxAnalysisSeconds
      },
      bpm: analysis.bpm,
      confidence: analysis.confidence,
      candidates: analysis.candidates,
      ...(analysis.bpm === null ? { warnings: ['No reliable beat pattern was found. Try a clearer music or metronome track.'] } : {})
    };
  } finally {
    activeBpmAnalysis = false;
  }
}
