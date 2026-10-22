const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src-tauri', 'resources', 'qpdf');
const destination = path.join(root, 'cli', 'vendor', 'qpdf');
const whisperSource = path.join(root, 'src-tauri', 'resources', 'whisper', 'Release');
const whisperLegalSource = path.join(root, 'src-tauri', 'resources', 'whisper');
const whisperDestination = path.join(root, 'cli', 'vendor', 'whisper');
const whisperFiles = [
  'whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll',
  'ggml-cpu-alderlake.dll', 'ggml-cpu-cannonlake.dll', 'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll', 'ggml-cpu-icelake.dll', 'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll', 'ggml-cpu-sse42.dll', 'ggml-cpu-x64.dll'
];
const whisperLegalFiles = ['LICENSE.txt', 'NOTICE.txt'];
const coreSource = path.join(root, 'src');
const coreDestination = path.join(root, 'cli', 'lib', 'core');
const sharedSource = path.join(root, 'shared');
const sharedDestination = path.join(root, 'cli', 'lib', 'shared');
const guideSource = path.join(root, 'docs');
const guideDestination = path.join(root, 'cli', 'guides');
const guideFiles = [
  'agent-guide.zh-CN.md',
  'agent-guide.en.md',
  'ai-document-project-spec.md',
  'ai-document-project.schema.json'
];
const fontSource = path.join(root, 'public', 'assets', 'fonts');
const fontDestination = path.join(root, 'cli', 'resources', 'fonts');
const fontFiles = ['NotoSansSC-Regular.ttf', 'NotoSansSC-Semibold.ttf'];
const coreFiles = [
  'pdf-merge-core.js',
  'pdf-document-structure.js',
  'pdf-split-core.js',
  'pdf-rotate-core.js',
  'pdf-encrypt-core.js',
  'pdf-decrypt-core.js',
  'pdf-compress-core.js',
  'core/pdf-compression.js',
  'core/pdf-raster-candidate.js',
  'core/limits/bytes.js',
  'core/image-dimensions.js',
  'core/limits/pdf.js',
  'core/limits/ai.js',
  'core/limits/image.js',
  'core/limits/markdown.js',
  'pdf-enhance-core.js',
  'pdf-enhance-engine.js',
  'pdf-to-image-core.js',
  'ppt-image-extract-core.js',
  'ppt-text-extract-core.js',
  'ppt-compress-core.js',
  'ppt-render-core.js',
  'ppt-outline-core.js',
  'ppt-draft-core.js',
  'ppt-draft-export.js',
  'ppt-draft-package.js',
  'ppt-draft-slide-dispatch.js',
  'audio-convert-core.js',
  'audio-clip-core.js',
  'audio-extract-core.js',
  'video-convert-core.js',
  'video-frame-core.js',
  'video-gif-core.js',
  'image-stitch-core.js',
  'text-stats-core.js',
  'teleprompter-core.js',
  'core/chinese-text.js',
  'core/opencc/t2s.json',
  'core/opencc/LICENSE.txt',
  'core/opencc/NOTICE.txt',
  'color-extractor-core.js',
  'bpm-detect-core.js',
  'ai-doc-core.js',
  'ai-doc-project-core.js',
  'ai-provider-core.js',
  'core/bounded-response.js',
  'ai-table-core.js',
  'ai-table-project-core.js',
  'ai-doc-pdf-core.js',
  'pdf-lib-fontkit.js'
];
const sharedFiles = [
  'task-contract.mjs',
  'task-runtime.mjs'
];
const lockPath = path.join(root, 'cli', '.stage-cli-resources.lock');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireStageLock({ timeoutMs = 120000, staleMs = 300000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      return fd;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for CLI resource staging lock: ${lockPath}`);
      }
      sleep(100);
    }
  }
}

function releaseStageLock(fd) {
  try { fs.closeSync(fd); } catch {}
  try { fs.rmSync(lockPath, { force: true }); } catch {}
}

function copyFileAtomic(sourceFile, destinationFile) {
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
  const tempFile = `${destinationFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.copyFileSync(sourceFile, tempFile);
    try {
      fs.renameSync(tempFile, destinationFile);
    } catch (error) {
      // Windows cannot rename over an existing file. The staging lock keeps
      // this fallback serialized while copyFileSync replaces the destination.
      if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.copyFileSync(tempFile, destinationFile);
    }
  } finally {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
  }
}

const stageLockFd = acquireStageLock();
let stageLockReleased = false;
function releaseStageLockOnce() {
  if (stageLockReleased) return;
  stageLockReleased = true;
  releaseStageLock(stageLockFd);
}
process.once('exit', releaseStageLockOnce);

if (!fs.existsSync(source)) {
  throw new Error(`qpdf resources are missing: ${source}`);
}
if (!fs.existsSync(whisperSource)) {
  throw new Error(`whisper resources are missing: ${whisperSource}`);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
fs.mkdirSync(whisperDestination, { recursive: true });
for (const fileName of whisperFiles) {
  const filePath = path.join(whisperSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`whisper resource is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(whisperDestination, fileName));
}
for (const fileName of whisperLegalFiles) {
  const filePath = path.join(whisperLegalSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`whisper legal notice is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(whisperDestination, fileName));
}
fs.mkdirSync(coreDestination, { recursive: true });
for (const fileName of coreFiles) {
  const filePath = path.join(coreSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI core source is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(coreDestination, fileName));
}
fs.mkdirSync(sharedDestination, { recursive: true });
for (const fileName of sharedFiles) {
  const filePath = path.join(sharedSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI shared source is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(sharedDestination, fileName));
}
fs.mkdirSync(guideDestination, { recursive: true });
for (const fileName of guideFiles) {
  const filePath = path.join(guideSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI guide source is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(guideDestination, fileName));
}
fs.mkdirSync(fontDestination, { recursive: true });
for (const fileName of fontFiles) {
  const filePath = path.join(fontSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI font resource is missing: ${filePath}`);
  copyFileAtomic(filePath, path.join(fontDestination, fileName));
}
for (const fileName of ['LICENSE', 'NOTICE', 'LICENSES/Apache-2.0.txt', 'LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md']) {
  copyFileAtomic(path.join(root, fileName), path.join(root, 'cli', fileName));
}
releaseStageLockOnce();
console.log('Staged CLI runtime resources: qpdf, whisper binaries and legal notices, core modules, shared task contracts, guides, and fonts. FFmpeg is downloaded on demand by ToolKnit Desktop or resolved from PATH.');
