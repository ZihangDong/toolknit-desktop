import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ToolKnitError } from './errors.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

function managedFfmpegDirectory() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ToolKnit', 'ffmpeg');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ToolKnit', 'ffmpeg');
}

function ffmpegExecutableName() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function regularFile(candidate) {
  try {
    const metadata = await lstat(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function resolveFfmpeg() {
  const configured = process.env.TOOLKNIT_FFMPEG_PATH?.trim();
  if (configured) {
    if (configured.includes('\0')) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'TOOLKNIT_FFMPEG_PATH contains an invalid path.');
    const configuredPath = path.resolve(configured);
    if (!await regularFile(configuredPath)) {
      throw new ToolKnitError('ENGINE_UNAVAILABLE', `FFmpeg is unavailable at TOOLKNIT_FFMPEG_PATH: ${configuredPath}`);
    }
    return configuredPath;
  }

  const executable = ffmpegExecutableName();
  const managedCandidates = [
    path.join(managedFfmpegDirectory(), executable),
    // Development-only compatibility. This path is never part of the published CLI.
    path.join(PROJECT_ROOT, 'src-tauri', 'resources', 'ffmpeg', executable)
  ];
  for (const candidate of managedCandidates) {
    if (await regularFile(candidate)) return candidate;
  }
  return executable;
}

function readLimited(stream, maxBytes, onChunk) {
  return new Promise(resolve => {
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    stream.on('data', chunk => {
      if (bytes < maxBytes) {
        const allowed = Math.min(chunk.length, maxBytes - bytes);
        if (allowed > 0) chunks.push(chunk.subarray(0, allowed));
        bytes += allowed;
        truncated ||= allowed !== chunk.length;
      } else {
        truncated = true;
      }
      onChunk?.(chunk);
    });
    stream.once('end', () => resolve({ buffer: Buffer.concat(chunks), truncated }));
    stream.once('error', () => resolve({ buffer: Buffer.concat(chunks), truncated }));
  });
}

export async function runFfmpeg(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg could not start.'));
      return;
    }
    child.once('error', error => {
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
        reject(new ToolKnitError('ENGINE_UNAVAILABLE', 'FFmpeg is unavailable. Install it in ToolKnit Desktop Settings, add it to PATH, or configure TOOLKNIT_FFMPEG_PATH.'));
      } else {
        reject(new ToolKnitError('PROCESSING_FAILED', 'FFmpeg could not start.'));
      }
    });
    const stdout = readLimited(child.stdout, options.maxStdoutBytes ?? MAX_PROCESS_OUTPUT_BYTES, options.onStdout);
    const stderr = readLimited(child.stderr, options.maxStderrBytes ?? MAX_PROCESS_OUTPUT_BYTES, options.onStderr);
    child.once('close', async (code, signal) => {
      const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
      resolve({
        code,
        signal,
        stdout: stdoutResult.buffer.toString('utf8'),
        stderr: stderrResult.buffer.toString('utf8'),
        stdoutBuffer: stdoutResult.buffer,
        stderrBuffer: stderrResult.buffer,
        stdoutTruncated: stdoutResult.truncated,
        stderrTruncated: stderrResult.truncated
      });
    });
  });
}

export function parseFfmpegDuration(output) {
  const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i.exec(output);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function parseProgressSeconds(line) {
  const equalIndex = line.indexOf('=');
  if (equalIndex < 1) return null;
  const key = line.slice(0, equalIndex);
  const value = line.slice(equalIndex + 1).trim();
  if (key === 'out_time') {
    const match = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  if (key === 'out_time_us' || key === 'out_time_ms') {
    const microseconds = Number(value);
    return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : null;
  }
  return null;
}

export async function probeFfmpegDuration(command, inputPath) {
  const result = await runFfmpeg(command, ['-hide_banner', '-nostdin', '-i', inputPath]);
  return parseFfmpegDuration(`${result.stdout}\n${result.stderr}`);
}

export function compactFfmpegError(stderr, fallback = 'FFmpeg could not process this file.') {
  const details = stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .find(line => !/^ffmpeg version/i.test(line) && !/^built with/i.test(line) && !/^configuration:/i.test(line));
  return details ? details.slice(0, 480) : fallback;
}

export async function checkFfmpegAvailability() {
  try {
    const command = await resolveFfmpeg();
    const result = await runFfmpeg(command, ['-version']);
    return { available: result.code === 0, command: result.code === 0 ? command : null };
  } catch {
    return { available: false, command: null };
  }
}
