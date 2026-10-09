import { readGlobalStyles } from './lib/global-styles.mjs';
import { readAppMarkup } from './lib/app-markup.mjs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function collectFiles(relativeDirectory, extensions) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(relativePath, extensions));
    else if (extensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

function matches(source, expression) {
  return [...source.matchAll(expression)];
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function sourceMetric(relativePath) {
  const source = await read(relativePath);
  const metadata = await stat(path.join(root, relativePath));
  return {
    path: relativePath.replaceAll('\\', '/'),
    lines: source.split('\n').length,
    bytes: metadata.size
  };
}

function gitValue(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const [html, mainSource, css, rustFiles, frontendFiles, mcpRegistry] = await Promise.all([
  readAppMarkup(import.meta.url),
  read('src/main.js'),
  readGlobalStyles(import.meta.url),
  collectFiles('src-tauri/src', new Set(['.rs'])),
  collectFiles('src', new Set(['.js', '.mjs'])),
  read('cli/lib/tool-registry.mjs')
]);
const [rustSources, frontendSources, sourceFiles] = await Promise.all([
  Promise.all(rustFiles.map(async file => ({ file, source: await read(file) }))),
  Promise.all(frontendFiles.map(async file => ({ file, source: await read(file) }))),
  Promise.all([
    sourceMetric('src/main.js'),
    sourceMetric('src/styles.css'),
    sourceMetric('src/styles/index.css'),
    sourceMetric('index.html'),
    sourceMetric('src-tauri/src/lib.rs')
  ])
]);

const architectureModulePaths = [
  'src/application.js',
  'src/application-runtime.js',
  'src-tauri/src/native_runtime.rs',
  ...(await collectFiles('src/app', new Set(['.js']))),
  ...(await collectFiles('src/styles', new Set(['.css']))),
  ...(await collectFiles('src-tauri/src/commands', new Set(['.rs']))),
  ...(await collectFiles('src-tauri/src/platform', new Set(['.rs']))),
  ...(await collectFiles('src-tauri/src/runtime', new Set(['.rs'])))
];
const architectureModules = await Promise.all(architectureModulePaths.map(sourceMetric));
const nativeRuntimeFiles = await Promise.all(
  rustFiles
    .filter(file => file.replaceAll('\\', '/').includes('src-tauri/src/native_runtime/'))
    .map(sourceMetric)
);
const nativeRuntimeLargest = [...nativeRuntimeFiles]
  .sort((left, right) => right.lines - left.lines)
  .slice(0, 12);
const sourceFilesOver2000 = [...rustFiles, ...frontendFiles]
  .filter((file, index, files) => files.indexOf(file) === index)
  .map(sourceMetric);
const measuredSourceFiles = await Promise.all(sourceFilesOver2000);

const tauriCommands = unique(rustSources.flatMap(({ source }) =>
  matches(source, /#\[tauri::command\][\s\S]{0,500}?\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/g)
    .map(match => match[1])
));
const tauriCommandAttributeCount = rustSources.reduce((total, { source }) =>
  total + matches(source, /#\[tauri::command\]/g).length, 0);
const rustTestCount = rustSources.reduce((total, { source }) =>
  total + matches(source, /#\[(?:tokio::)?test\]/g).length, 0);
const frontendText = frontendSources.map(({ source }) => source).join('\n');
const htmlIds = matches(html, /\bid="([^"]+)"/g).map(match => match[1]);
const toolIds = unique(matches(html, /\bdata-tool="([^"]+)"/g).map(match => match[1]));
const duplicateHtmlIds = unique(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index));
const frontendInvokes = unique(matches(frontendText, /\binvoke\(\s*['"]([^'"]+)['"]/g).map(match => match[1]));
const frontendEvents = unique(matches(frontendText, /\blisten\(\s*['"]([^'"]+)['"]/g).map(match => match[1]));
const literalStorageKeys = unique(matches(frontendText, /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g).map(match => match[1]));
const mcpTools = unique(matches(mcpRegistry, /\bname:\s*['"](toolknit_[^'"]+)['"]/g).map(match => match[1]));

const report = {
  generatedAt: new Date().toISOString(),
  gitBaseline: {
    branch: gitValue(['branch', '--show-current'], 'unknown'),
    checkpoint: gitValue(['rev-parse', '--short', 'HEAD'], 'unknown')
  },
  sourceFiles,
  architectureModules,
  sourceFilesOver2000: measuredSourceFiles.filter(file => file.lines > 2000),
  nativeRuntime: {
    fileCount: nativeRuntimeFiles.length,
    largestFiles: nativeRuntimeLargest,
    filesOver2000: nativeRuntimeFiles.filter(file => file.lines > 2000)
  },
  desktopCatalog: {
    count: toolIds.length,
    toolIds
  },
  htmlContract: {
    idCount: htmlIds.length,
    uniqueIdCount: unique(htmlIds).length,
    duplicateIds: duplicateHtmlIds
  },
  frontend: {
    staticMainImports: matches(mainSource, /^\s*import\s/gm).length,
    dynamicMainImports: matches(mainSource, /\bimport\s*\(/g).length,
    documentListenersInMain: matches(mainSource, /document\.addEventListener\(/g).length,
    windowListenersInMain: matches(mainSource, /window\.addEventListener\(/g).length,
    timeoutsInMain: matches(mainSource, /(?:window\.)?setTimeout\(/g).length,
    intervalsInMain: matches(mainSource, /(?:window\.)?setInterval\(/g).length,
    objectUrlsInMain: matches(mainSource, /URL\.createObjectURL\(/g).length,
    invokeCount: frontendInvokes.length,
    invokes: frontendInvokes,
    eventCount: frontendEvents.length,
    events: frontendEvents,
    literalStorageKeyCount: literalStorageKeys.length,
    literalStorageKeys
  },
  css: {
    importantCount: matches(css, /!important/g).length,
    zIndexCount: matches(css, /z-index\s*:/g).length,
    mediaQueryCount: matches(css, /@media\b/g).length
  },
  rust: {
    commandAttributeCount: tauriCommandAttributeCount,
    commandCount: tauriCommands.length,
    commands: tauriCommands,
    testCount: rustTestCount
  },
  mcp: {
    toolCount: mcpTools.length,
    tools: mcpTools
  },
  productionBundleBaseline: {
    mainJavaScriptBytes: 2_811_765,
    mainCssBytes: 816_198,
    indexHtmlBytes: 784_455,
    warnings: [
      'pdf-lib dynamic import is ineffective because static consumers keep it in the graph',
      'pdf-encrypt-core dynamic import is ineffective because pdf-editor-core imports it statically',
      'multiple production chunks exceed 500 kB'
    ]
  }
};

if (process.argv.includes('--check')) {
  const failures = [];
  if (report.desktopCatalog.count !== 69) failures.push(`expected 69 desktop tools, found ${report.desktopCatalog.count}`);
  if (report.htmlContract.duplicateIds.length) failures.push(`duplicate HTML ids: ${report.htmlContract.duplicateIds.join(', ')}`);
  if (report.rust.commandAttributeCount !== 137) failures.push(`expected 137 Tauri command implementations, found ${report.rust.commandAttributeCount}`);
  if (report.rust.commandCount !== 136) failures.push(`expected 136 unique Tauri command names, found ${report.rust.commandCount}`);
  if (report.rust.testCount < 93) failures.push(`expected at least 93 Rust tests, found ${report.rust.testCount}`);
  if (report.mcp.toolCount !== 46) failures.push(`expected 46 MCP tools, found ${report.mcp.toolCount}`);
  if (failures.length) {
    failures.forEach(failure => console.error(`Architecture baseline failure: ${failure}`));
    process.exit(1);
  }
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log('ToolKnit V3 architecture baseline');
  for (const file of report.sourceFiles) console.log(`- ${file.path}: ${file.lines} lines, ${file.bytes} bytes`);
  console.log(`- desktop tools: ${report.desktopCatalog.count}`);
  console.log(`- HTML ids: ${report.htmlContract.idCount} (${report.htmlContract.duplicateIds.length} duplicates)`);
  console.log(`- Tauri commands: ${report.rust.commandAttributeCount} implementations, ${report.rust.commandCount} unique names`);
  console.log(`- Rust tests: ${report.rust.testCount}`);
  console.log(`- MCP tools: ${report.mcp.toolCount}`);
  console.log(`- frontend invoke names: ${report.frontend.invokeCount}`);
  console.log(`- frontend event names: ${report.frontend.eventCount}`);
}
