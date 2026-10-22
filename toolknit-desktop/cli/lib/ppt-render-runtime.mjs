import { execFile, spawn } from 'node:child_process';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const DEFAULT_CONVERT_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 10_000;
// LibreOffice takes a noticeable amount of time to start even for
// `--version` (especially when it is the managed runtime).  MCP keeps this
// module alive across calls, so retain a successful probe and coalesce probes
// that arrive at the same time.  A short negative cache prevents a burst of
// missing-runtime requests from spawning the same failed probes repeatedly,
// while still noticing a newly installed runtime promptly.
const MISSING_RUNTIME_CACHE_TTL_MS = 2_000;
let libreOfficeRuntimeCache = null;
let libreOfficeRuntimeProbe = null;

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importPptRenderCore() {
  const stagedPath = path.join(STAGED_CORE_ROOT, 'ppt-render-core.js');
  if (await fileExists(stagedPath)) return import(pathToFileURL(stagedPath).href);
  return import(pathToFileURL(path.join(PROJECT_ROOT, 'src', 'ppt-render-core.js')).href);
}

const pptRenderCore = await importPptRenderCore();
export const {
  PPT_RENDER_LIMITS,
  PptRenderError,
  createPptToImageManifest,
  createPptToPdfFileName,
  createPptToPdfManifest,
  inspectPptxRenderBytes,
  normalizePptToImageClarity,
  normalizePptToImageFormat,
  normalizePptToImagePages,
  sanitizePptRenderBaseName
} = pptRenderCore;

function trimProcessText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function terminateProcessTree(child) {
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return;
  // On Windows, `soffice.com` / `soffice.exe` hand off to `soffice.bin`, and a
  // plain child.kill() only terminates the direct launcher.  Orphaned
  // soffice.bin workers can keep holding the LibreOffice profile lock and
  // make the next conversion hang.  taskkill /T tears down the whole tree.
  if (process.platform === 'win32') {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }, () => {});
      return;
    } catch {
      // Fall through to the direct kill below.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Process already exited; nothing to do.
  }
}

function report(options, progress, message) {
  options.reportProgress?.(Math.max(0, Math.min(100, progress)), message);
}

export function mapPptRenderError(error, fallback = 'PPT rendering failed.') {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof PptRenderError) {
    const message = error.userMessage || error.message;
    if (['invalid_request', 'invalid_format', 'invalid_clarity', 'invalid_pages'].includes(error.code)) {
      return new ToolKnitError('INVALID_ARGUMENT', message);
    }
    if (['input_too_large', 'too_many_slides'].includes(error.code)) {
      return new ToolKnitError('INPUT_TOO_LARGE', message);
    }
    if (['invalid_extension', 'invalid_pptx', 'empty_ppt'].includes(error.code)) {
      return new ToolKnitError('INPUT_INVALID', message);
    }
    return new ToolKnitError('PROCESSING_FAILED', message);
  }
  return new ToolKnitError('PROCESSING_FAILED', String(error?.message || error || fallback));
}

export function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  }
}

export function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

export function assertPathValue(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty path.`);
  }
  return path.resolve(value.trim());
}

export async function inspectPptxRenderInput(inputPath) {
  const requested = assertPathValue(inputPath, 'input_path');
  if (path.extname(requested).toLowerCase() !== '.pptx') {
    throw new ToolKnitError('INPUT_INVALID', 'PPT rendering currently supports .pptx files only.');
  }
  let metadata;
  try {
    metadata = await lstat(requested);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ToolKnitError('INPUT_NOT_FOUND', `PPTX input does not exist: ${requested}`);
    throw new ToolKnitError('INPUT_INVALID', `PPTX input cannot be inspected: ${requested}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `PPTX input must be a non-empty regular file: ${requested}`);
  }
  if (metadata.size > PPT_RENDER_LIMITS.maxInputBytes) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `PPTX files for rendering must be ${PPT_RENDER_LIMITS.maxInputBytes / 1024 / 1024}MB or smaller.`);
  }
  return { path: await realpath(requested), name: path.basename(requested), size: metadata.size };
}

export async function readPptxRenderInput(input) {
  try {
    const bytes = await readFile(input.path);
    if (bytes.length !== input.size) {
      throw new ToolKnitError('INPUT_INVALID', `PPTX input changed while it was being read: ${input.path}`);
    }
    const manifest = await inspectPptxRenderBytes(bytes, { sourceName: input.name });
    return { ...input, bytes, manifest };
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw mapPptRenderError(error, `PPTX input cannot be read: ${input.path}`);
  }
}

export async function prepareOutputParent(value) {
  const requested = assertPathValue(value, 'output_dir');
  try {
    await mkdir(requested, { recursive: true });
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Cannot create output directory: ${requested}`);
  }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  }
  return realpath(requested);
}

export async function reservePptOutputDirectory(parentDirectory, baseName, suffixName) {
  const safeBaseName = sanitizePptRenderBaseName(baseName);
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(parentDirectory, `${safeBaseName}_${suffixName}${suffix}`);
    try {
      await lstat(candidate);
      continue;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ToolKnitError('OUTPUT_INVALID', `Output directory cannot be inspected: ${candidate}`);
      }
      return candidate;
    }
  }
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Could not reserve a unique PPT ${suffixName} output directory.`);
}

function normalizeCandidate(command, source) {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) return null;
  return { command: command.trim(), source };
}

function libreOfficeCandidateKey(candidates) {
  return JSON.stringify({
    candidates: candidates.map(candidate => ({ source: candidate.source, command: candidate.command })),
    environment: {
      TOOLKNIT_LIBREOFFICE_PATH: process.env.TOOLKNIT_LIBREOFFICE_PATH || '',
      ProgramFiles: process.env.ProgramFiles || '',
      ProgramFilesX86: process.env['ProgramFiles(x86)'] || '',
      LOCALAPPDATA: process.env.LOCALAPPDATA || '',
      APPDATA: process.env.APPDATA || '',
      PATH: process.env.PATH || ''
    }
  });
}

function cloneLibreOfficeRuntime(runtime) {
  return runtime ? { ...runtime } : runtime;
}

function invalidateLibreOfficeRuntime(runtime) {
  if (!libreOfficeRuntimeCache) return;
  if (!runtime || !libreOfficeRuntimeCache.runtime?.command
    || libreOfficeRuntimeCache.runtime.command === runtime.command) {
    libreOfficeRuntimeCache = null;
  }
}

async function cachedRuntimeIsPresent(runtime) {
  if (!runtime?.available || !runtime.command || !path.isAbsolute(runtime.command)) return true;
  try {
    const metadata = await lstat(runtime.command);
    return metadata.isFile();
  } catch {
    return false;
  }
}

function libreOfficeCandidates() {
  const candidates = [];
  const envPath = process.env.TOOLKNIT_LIBREOFFICE_PATH;
  if (envPath) candidates.push(normalizeCandidate(envPath, 'env:TOOLKNIT_LIBREOFFICE_PATH'));
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(normalizeCandidate(path.join(root, 'LibreOffice', 'program', 'soffice.com'), 'windows-install'));
      candidates.push(normalizeCandidate(path.join(root, 'LibreOffice', 'program', 'soffice.exe'), 'windows-install'));
    }
    const localAppData = process.env.LOCALAPPDATA || (process.env.APPDATA ? path.dirname(process.env.APPDATA) : null);
    if (localAppData) {
      candidates.push(normalizeCandidate(path.join(localAppData, 'ToolKnit', 'libreoffice', '26.2.5', 'program', 'soffice.com'), 'managed-runtime'));
      candidates.push(normalizeCandidate(path.join(localAppData, 'ToolKnit', 'libreoffice', '26.2.5', 'program', 'soffice.exe'), 'managed-runtime'));
    }
    candidates.push(normalizeCandidate(path.resolve(PROJECT_ROOT, '..', '_research', 'runtime-cache', 'libreoffice-26.2.5', 'program', 'soffice.com'), 'dev-runtime-cache'));
    candidates.push(normalizeCandidate('soffice.com', 'PATH'));
  } else if (process.platform === 'darwin') {
    candidates.push(normalizeCandidate('/Applications/LibreOffice.app/Contents/MacOS/soffice', 'macos-app'));
    candidates.push(normalizeCandidate('soffice', 'PATH'));
    candidates.push(normalizeCandidate('libreoffice', 'PATH'));
  } else {
    candidates.push(normalizeCandidate('/usr/bin/soffice', 'linux-system'));
    candidates.push(normalizeCandidate('/usr/bin/libreoffice', 'linux-system'));
    candidates.push(normalizeCandidate('/snap/bin/libreoffice', 'linux-system'));
    candidates.push(normalizeCandidate('soffice', 'PATH'));
    candidates.push(normalizeCandidate('libreoffice', 'PATH'));
  }
  const seen = new Set();
  return candidates.filter(Boolean).filter(candidate => {
    const key = process.platform === 'win32' ? candidate.command.toLowerCase() : candidate.command;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    throwIfAborted(options.signal);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timeout = Number(options.timeoutMs) > 0
      ? setTimeout(() => {
        if (settled) return;
        settled = true;
        terminateProcessTree(child);
        reject(new ToolKnitError('ENGINE_UNAVAILABLE', 'LibreOffice did not respond in time.'));
      }, options.timeoutMs)
      : null;
    const abort = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      terminateProcessTree(child);
      reject(new ToolKnitError('CANCELLED', 'PPT rendering was cancelled.'));
    };
    options.signal?.addEventListener?.('abort', abort, { once: true });
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener?.('abort', abort);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener?.('abort', abort);
      resolve({
        code,
        stdout: trimProcessText(Buffer.concat(stdout).toString('utf8')),
        stderr: trimProcessText(Buffer.concat(stderr).toString('utf8'))
      });
    });
  });
}

async function probeLibreOffice(candidate) {
  if (path.isAbsolute(candidate.command)) {
    try {
      const metadata = await lstat(candidate.command);
      if (metadata.isDirectory()) return null;
    } catch {
      return null;
    }
  }
  let profileDirectory = null;
  try {
    // Isolate every probe into its own profile.  LibreOffice can block on the
    // default profile lock, and the desktop app plus the CLI can probe
    // concurrently from separate processes; a shared profile makes `--version`
    // hang and leaves orphaned soffice workers behind.
    profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-lo-probe-'));
    const result = await runProcess(candidate.command, [
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      '--version'
    ], { timeoutMs: PROBE_TIMEOUT_MS });
    if (result.code !== 0) return null;
    const versionText = [result.stdout, result.stderr].filter(Boolean).join('\n') || 'LibreOffice';
    return {
      available: true,
      command: candidate.command,
      source: candidate.source,
      version: versionText.split(/\r?\n/)[0].trim() || 'LibreOffice'
    };
  } catch {
    return null;
  } finally {
    if (profileDirectory) {
      await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function resolveLibreOfficeRuntime() {
  const candidates = libreOfficeCandidates();
  const key = libreOfficeCandidateKey(candidates);
  const now = Date.now();
  if (libreOfficeRuntimeCache?.key === key) {
    const age = now - libreOfficeRuntimeCache.checkedAt;
    const isAvailable = libreOfficeRuntimeCache.runtime?.available === true;
    if ((isAvailable && await cachedRuntimeIsPresent(libreOfficeRuntimeCache.runtime))
      || (!isAvailable && age < MISSING_RUNTIME_CACHE_TTL_MS)) {
      return cloneLibreOfficeRuntime(libreOfficeRuntimeCache.runtime);
    }
    libreOfficeRuntimeCache = null;
  }

  if (libreOfficeRuntimeProbe?.key === key) {
    return cloneLibreOfficeRuntime(await libreOfficeRuntimeProbe.promise);
  }

  const promise = (async () => {
    for (const candidate of candidates) {
      const probed = await probeLibreOffice(candidate);
      if (probed) return probed;
    }
    return {
      available: false,
      command: null,
      source: null,
      version: null,
      message: 'LibreOffice runtime was not found. Install LibreOffice or set TOOLKNIT_LIBREOFFICE_PATH to soffice.com/soffice.exe.'
    };
  })();
  libreOfficeRuntimeProbe = { key, promise };
  try {
    const runtime = await promise;
    libreOfficeRuntimeCache = { key, checkedAt: Date.now(), runtime };
    return cloneLibreOfficeRuntime(runtime);
  } finally {
    if (libreOfficeRuntimeProbe?.promise === promise) libreOfficeRuntimeProbe = null;
  }
}

export async function checkLibreOfficeAvailability() {
  return resolveLibreOfficeRuntime();
}

async function findConvertedPdf(directory, inputName) {
  const expected = `${path.basename(inputName, path.extname(inputName))}.pdf`;
  const entries = await readdir(directory);
  const pdfs = entries.filter(name => /\.pdf$/i.test(name));
  if (pdfs.length < 1) return null;
  if (pdfs.some(name => name.toLowerCase() === expected.toLowerCase())) {
    return path.join(directory, pdfs.find(name => name.toLowerCase() === expected.toLowerCase()));
  }
  return path.join(directory, pdfs[0]);
}

export async function validateRenderedPdf(pdfPath, expectedSlideCount) {
  let metadata;
  try {
    metadata = await stat(pdfPath);
  } catch {
    throw new ToolKnitError('PROCESSING_FAILED', 'LibreOffice did not create a readable PDF output.');
  }
  if (!metadata.isFile() || metadata.size < 16) {
    throw new ToolKnitError('PROCESSING_FAILED', 'LibreOffice created an empty or invalid PDF output.');
  }
  let pdf;
  try {
    pdf = await PDFDocument.load(await readFile(pdfPath));
  } catch {
    throw new ToolKnitError('PROCESSING_FAILED', 'The rendered PDF cannot be reopened for validation.');
  }
  const pageCount = pdf.getPageCount();
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new ToolKnitError('PROCESSING_FAILED', 'The rendered PDF contains no pages.');
  }
  const warnings = [];
  if (Number.isSafeInteger(expectedSlideCount) && expectedSlideCount > 0 && pageCount !== expectedSlideCount) {
    warnings.push(`Rendered PDF page count (${pageCount}) differs from PPT slide count (${expectedSlideCount}).`);
  }
  return { page_count: pageCount, bytes: metadata.size, warnings };
}

function libreOfficeConvertEnv() {
  // `SAL_USE_VCLPLUGIN=svp` keeps LibreOffice headless, and
  // `SAL_DISABLE_PRINTERLIST=1` stops printer-list enumeration. An offline WSD
  // network printer otherwise makes Impress wait for the print spooler during
  // a purely file-based conversion.
  return {
    ...process.env,
    SAL_USE_VCLPLUGIN: 'svp',
    SAL_DISABLE_PRINTERLIST: '1'
  };
}

async function seedLibreOfficePrinterProfile(profileDir) {
  // Impress loads the document's embedded printer by default, which can stall
  // a conversion waiting for an offline printer. Pre-seed the profile so that
  // setting is disabled before LibreOffice ever reads it.
  const userDir = path.join(profileDir, 'user');
  await mkdir(userDir, { recursive: true });
  const xcuPath = path.join(userDir, 'registrymodifications.xcu');
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';
  const footer = '</oor:items>';
  const printerItem = '<item oor:path="/org.openoffice.Office.Common/LoadSave/General"><prop oor:name="LoadPrinterSettings" oor:op="fuse"><value>false</value></prop></item>';
  let existing = '';
  try {
    existing = await readFile(xcuPath, 'utf8');
  } catch {
    existing = '';
  }
  let updated;
  if (!existing.trim()) {
    updated = `${header}\n${printerItem}\n${footer}\n`;
  } else if (existing.includes('LoadPrinterSettings')) {
    updated = existing
      .split('\n')
      .map((line) => (line.includes('LoadPrinterSettings') ? printerItem : line))
      .join('\n');
  } else {
    const footerIndex = existing.lastIndexOf('</oor:items>');
    if (footerIndex >= 0) {
      updated = `${existing.slice(0, footerIndex)}${printerItem}\n${existing.slice(footerIndex)}`;
    } else {
      updated = existing;
    }
  }
  await writeFile(xcuPath, updated, 'utf8');
}

export async function renderPptxToPdfFile(input, targetDirectory, fileName, options = {}) {
  throwIfAborted(options.signal);
  const renderer = options.renderer || await resolveLibreOfficeRuntime();
  if (!renderer.available || !renderer.command) {
    invalidateLibreOfficeRuntime(renderer);
    throw new ToolKnitError('DEPENDENCY_MISSING', renderer.message || 'LibreOffice runtime is required for PPT rendering.');
  }
  await mkdir(targetDirectory, { recursive: true });
  // LibreOffice silently exits when nested output paths make its profile too
  // long on Windows. Keep the profile and conversion files in a short workspace.
  const workRoot = await mkdtemp(path.join(os.tmpdir(), 'toolknit-office-'));
  try {
    const outDir = path.join(workRoot, 'out');
    const profileDir = path.join(workRoot, 'profile');
    const inputName = `input${path.extname(input.name).toLowerCase()}`;
    const stagedInput = path.join(workRoot, inputName);
    if (input.bytes) await writeFile(stagedInput, input.bytes, { flag: 'wx', mode: 0o600 });
    else await copyFile(input.path, stagedInput);
    throwIfAborted(options.signal);
    await mkdir(outDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await seedLibreOfficePrinterProfile(profileDir);
    const userInstallation = pathToFileURL(profileDir).href;
    const args = [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--nodefault',
      '--nolockcheck',
      '--norestore',
      `-env:UserInstallation=${userInstallation}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      stagedInput
    ];
    let result;
    try {
      result = await runProcess(renderer.command, args, {
        signal: options.signal,
        timeoutMs: options.timeoutMs || DEFAULT_CONVERT_TIMEOUT_MS,
        env: libreOfficeConvertEnv()
      });
    } catch (error) {
      // A cached command can disappear between the probe and conversion
      // (runtime deletion, an interrupted install, or PATH changes).  Drop
      // only that stale success so the next request performs a fresh probe.
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        invalidateLibreOfficeRuntime(renderer);
      }
      throw error;
    }
    if (result.code !== 0) {
      throw new ToolKnitError('PROCESSING_FAILED', `LibreOffice conversion failed: ${result.stderr || result.stdout || `exit code ${result.code}`}`);
    }
    const generatedPdf = await findConvertedPdf(outDir, inputName);
    if (!generatedPdf) {
      throw new ToolKnitError('PROCESSING_FAILED', 'LibreOffice completed without producing a PDF file.');
    }
    const targetPath = path.join(targetDirectory, fileName);
    throwIfAborted(options.signal);
    try {
      await lstat(targetPath);
      throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite an existing file: ${targetPath}`);
    } catch (error) {
      if (error instanceof ToolKnitError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    await copyFile(generatedPdf, targetPath);
    const validation = await validateRenderedPdf(targetPath, input.manifest.slide_count);
    return {
      path: targetPath,
      file_name: fileName,
      page_count: validation.page_count,
      bytes: validation.bytes,
      warnings: validation.warnings,
      process: {
        stdout: result.stdout,
        stderr: result.stderr
      },
      renderer
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// The isolated LibreOffice conversion also serves validated XLSX workbooks.
export { renderPptxToPdfFile as renderOfficeToPdfFile };

export async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

export async function publishPptOutputDirectory(temporaryDirectory, finalDirectory) {
  try {
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    if (error?.code === 'EEXIST') throw new ToolKnitError('OUTPUT_EXISTS', `Output directory already exists: ${finalDirectory}`);
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Could not publish output directory: ${finalDirectory}`);
  }
}

export { report };
