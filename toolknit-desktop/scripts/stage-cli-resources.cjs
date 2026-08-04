const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src-tauri', 'resources', 'qpdf');
const destination = path.join(root, 'cli', 'vendor', 'qpdf');
const whisperSource = path.join(root, 'src-tauri', 'resources', 'whisper', 'Release');
const whisperDestination = path.join(root, 'cli', 'vendor', 'whisper');
const whisperFiles = [
  'whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll',
  'ggml-cpu-alderlake.dll', 'ggml-cpu-cannonlake.dll', 'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll', 'ggml-cpu-icelake.dll', 'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll', 'ggml-cpu-sse42.dll', 'ggml-cpu-x64.dll'
];
const coreSource = path.join(root, 'src');
const coreDestination = path.join(root, 'cli', 'lib', 'core');
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
  'pdf-split-core.js',
  'pdf-rotate-core.js',
  'pdf-encrypt-core.js',
  'pdf-decrypt-core.js',
  'pdf-compress-core.js',
  'pdf-enhance-core.js',
  'pdf-enhance-engine.js',
  'audio-convert-core.js',
  'audio-clip-core.js',
  'audio-extract-core.js',
  'video-convert-core.js',
  'video-frame-core.js',
  'video-gif-core.js',
  'image-stitch-core.js',
  'text-stats-core.js',
  'color-extractor-core.js',
  'bpm-detect-core.js',
  'ai-doc-core.js',
  'ai-doc-project-core.js',
  'ai-provider-core.js',
  'ai-table-core.js',
  'ai-table-project-core.js',
  'ai-doc-pdf-core.js',
  'pdf-lib-fontkit.js'
];

if (!fs.existsSync(source)) {
  throw new Error(`qpdf resources are missing: ${source}`);
}
if (!fs.existsSync(whisperSource)) {
  throw new Error(`whisper resources are missing: ${whisperSource}`);
}
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true });
fs.rmSync(whisperDestination, { recursive: true, force: true });
fs.mkdirSync(whisperDestination, { recursive: true });
for (const fileName of whisperFiles) {
  const filePath = path.join(whisperSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`whisper resource is missing: ${filePath}`);
  fs.copyFileSync(filePath, path.join(whisperDestination, fileName));
}
fs.rmSync(coreDestination, { recursive: true, force: true });
fs.mkdirSync(coreDestination, { recursive: true });
for (const fileName of coreFiles) {
  const filePath = path.join(coreSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI core source is missing: ${filePath}`);
  fs.copyFileSync(filePath, path.join(coreDestination, fileName));
}
fs.rmSync(guideDestination, { recursive: true, force: true });
fs.mkdirSync(guideDestination, { recursive: true });
for (const fileName of guideFiles) {
  const filePath = path.join(guideSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI guide source is missing: ${filePath}`);
  fs.copyFileSync(filePath, path.join(guideDestination, fileName));
}
fs.rmSync(fontDestination, { recursive: true, force: true });
fs.mkdirSync(fontDestination, { recursive: true });
for (const fileName of fontFiles) {
  const filePath = path.join(fontSource, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`CLI font resource is missing: ${filePath}`);
  fs.copyFileSync(filePath, path.join(fontDestination, fileName));
}
console.log('Staged CLI runtime resources: qpdf, whisper, core modules, guides, and fonts. FFmpeg is downloaded on demand by ToolKnit Desktop or resolved from PATH.');
