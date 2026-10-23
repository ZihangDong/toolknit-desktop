import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, link, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertNoLinkedParents } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

const exec = promisify(execFile);
const ascii = value => /^[\x20-\x7e]+$/.test(value);
let userSid;
async function protectWindowsDirectory(directory) {
  if (!userSid) {
    const result = await exec('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 10000 });
    userSid = result.stdout.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
    if (!userSid) throw new Error('Windows identity unavailable.');
  }
  await exec('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${userSid}:(OI)(CI)F`, '/q'], { windowsHide: true, timeout: 10000 });
}

export async function createWhisperWorkspace(preferred) {
  // whisper.cpp's Windows argument conversion cannot consume Unicode paths.
  if (process.platform !== 'win32' || ascii(preferred)) return { path: preferred, dispose: async () => {} };
  for (const base of [os.tmpdir(), process.env.ProgramData, 'C:/Windows/Temp'].filter(Boolean)) {
    const root = path.join(base, 'ToolKnit', 'cli-transcription-work');
    if (!ascii(root)) continue;
    let directory;
    try {
      await assertNoLinkedParents(root);
      await mkdir(root, { recursive: true });
      directory = await mkdtemp(path.join(root, 'job-'));
      await protectWindowsDirectory(directory);
      return { path: directory, dispose: () => rm(directory, { recursive: true, force: true }) };
    } catch { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
  }
  throw new ToolKnitError('ENGINE_UNAVAILABLE', 'A private ASCII-path workspace could not be created for the Windows speech engine.');
}

export async function stageWhisperModel(source, workspace, signal) {
  throwIfAborted(signal);
  await assertNoLinkedParents(source);
  const metadata = await lstat(source), destination = path.join(workspace, 'model.bin');
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', 'The installed speech model is not a regular local file.');
  try { await link(source, destination); }
  catch { await copyFile(source, destination); }
  throwIfAborted(signal);
  if ((await lstat(destination)).size !== metadata.size) throw new ToolKnitError('PROCESSING_FAILED', 'The speech model changed while preparing recognition.');
  return destination;
}
