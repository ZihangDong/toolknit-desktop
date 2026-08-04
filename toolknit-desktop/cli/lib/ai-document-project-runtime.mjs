import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ToolKnitError } from './errors.mjs';
import { renderAiDocumentPreviews } from './ai-document-preview.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const PROJECT_SUFFIX = '.toolknit.json';
const DATA_SUFFIX = '.toolknit';
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_COPY_ENTRIES = 5000;

async function importCore(fileName) {
  const stagedPath = path.join(STAGED_CORE_ROOT, fileName);
  try {
    await readFile(stagedPath);
    return import(pathToFileURL(stagedPath).href);
  } catch {
    return import(new URL(`../../src/${fileName}`, import.meta.url));
  }
}

const [projectCore, pdfCore] = await Promise.all([
  importCore('ai-doc-project-core.js'),
  importCore('ai-doc-pdf-core.js')
]);

const {
  AiDocProjectError,
  applyAiDocProjectOperations,
  createAiDocProjectFromLayout,
  inspectAiDocProject,
  normalizeAiDocProject,
  projectToAiDocLayout,
  validateAiDocProject
} = projectCore;
const { buildAiDocPdf } = pdfCore;

function assertObject(value, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be an object.`);
  }
}

function assertOnlyKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function mapProjectError(error) {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof AiDocProjectError) {
    return new ToolKnitError(
      ['invalid_operation', 'invalid_style', 'control_not_found', 'control_locked'].includes(error.code)
        ? 'INVALID_ARGUMENT'
        : 'INPUT_INVALID',
      error.message,
      { details: { projectCode: error.code, ...(error.details || {}) } }
    );
  }
  return new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not process the AI document project.');
}

export function projectPathsFromPdf(outputPath) {
  const pdfPath = path.resolve(assertString(outputPath, 'output_path'));
  if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'output_path must end with .pdf.');
  }
  const basePath = pdfPath.slice(0, -4);
  return {
    basePath,
    pdfPath,
    projectPath: `${basePath}${PROJECT_SUFFIX}`,
    dataPath: `${basePath}${DATA_SUFFIX}`
  };
}

export function projectPathsFromJson(projectPathValue) {
  const projectPath = path.resolve(assertString(projectPathValue, 'project_path'));
  if (!projectPath.toLowerCase().endsWith(PROJECT_SUFFIX)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `project_path must end with ${PROJECT_SUFFIX}.`);
  }
  const basePath = projectPath.slice(0, -PROJECT_SUFFIX.length);
  return {
    basePath,
    pdfPath: `${basePath}.pdf`,
    projectPath,
    dataPath: `${basePath}${DATA_SUFFIX}`
  };
}

async function pathMetadata(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new ToolKnitError('INPUT_INVALID', `Path cannot be inspected: ${target}`);
  }
}

export async function assertAiDocumentOutputAvailable(outputPath, overwrite = false) {
  const paths = projectPathsFromPdf(outputPath);
  if (overwrite === true) return paths;
  const existing = [];
  for (const target of [paths.pdfPath, paths.projectPath, paths.dataPath]) {
    if (await pathMetadata(target)) existing.push(target);
  }
  if (existing.length) {
    throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite existing AI document artifacts: ${existing.join(', ')}`);
  }
  return paths;
}

async function readRegularFile(filePath, { maxBytes, label }) {
  const metadata = await pathMetadata(filePath);
  if (!metadata) throw new ToolKnitError('INPUT_NOT_FOUND', `${label} does not exist: ${filePath}`);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ToolKnitError('INPUT_INVALID', `${label} must be a regular file: ${filePath}`);
  }
  if (metadata.size < 1 || metadata.size > maxBytes) {
    throw new ToolKnitError('INPUT_INVALID', `${label} has an invalid size: ${filePath}`);
  }
  return readFile(filePath);
}

export async function loadAiDocumentProject(projectPathValue) {
  const paths = projectPathsFromJson(projectPathValue);
  try {
    const bytes = await readRegularFile(paths.projectPath, { maxBytes: MAX_PROJECT_BYTES, label: 'AI document project' });
    const project = normalizeAiDocProject(JSON.parse(bytes.toString('utf8')));
    return { project, paths, bytes: bytes.length };
  } catch (error) {
    if (error instanceof SyntaxError) throw new ToolKnitError('INPUT_INVALID', 'AI document project JSON is invalid.');
    throw mapProjectError(error);
  }
}

async function loadFontBytes() {
  const fontRoot = path.join(CLI_ROOT, 'resources', 'fonts');
  try {
    return await Promise.all([
      readFile(path.join(fontRoot, 'NotoSansSC-Regular.ttf')),
      readFile(path.join(fontRoot, 'NotoSansSC-Semibold.ttf'))
    ]);
  } catch {
    throw new ToolKnitError('ENGINE_UNAVAILABLE', 'ToolKnit AI document fonts are unavailable. Reinstall the CLI package.');
  }
}

async function hydrateProjectAssets(project, paths, inlineAssets = new Map()) {
  const layout = projectToAiDocLayout(project);
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  for (const page of layout.pages) {
    for (const region of page.regions) {
      if (!region.assetId) continue;
      const asset = assets.get(region.assetId);
      if (!asset) throw new ToolKnitError('INPUT_INVALID', `Missing asset for control ${region.controlNumber}.`);
      const assetPath = path.resolve(paths.dataPath, asset.relativePath);
      const dataRoot = `${path.resolve(paths.dataPath)}${path.sep}`;
      const comparableRoot = process.platform === 'win32' ? dataRoot.toLowerCase() : dataRoot;
      const comparableAsset = process.platform === 'win32' ? assetPath.toLowerCase() : assetPath;
      if (!comparableAsset.startsWith(comparableRoot)) {
        throw new ToolKnitError('INPUT_INVALID', `Asset path escapes the project directory: ${asset.relativePath}`);
      }
      const bytes = inlineAssets.get(asset.relativePath)
        || await readRegularFile(assetPath, { maxBytes: MAX_ASSET_BYTES, label: 'AI document asset' });
      if (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
        throw new ToolKnitError('INPUT_INVALID', `AI document asset checksum failed: ${asset.relativePath}`);
      }
      region.imageData = `data:${asset.mimeType};base64,${bytes.toString('base64')}`;
    }
  }
  return layout;
}

async function renderProject(project, paths, { previews = true, inlineAssets = new Map() } = {}) {
  const [[regularFontBytes, boldFontBytes], layout] = await Promise.all([
    loadFontBytes(),
    hydrateProjectAssets(project, paths, inlineAssets)
  ]);
  const rendered = await buildAiDocPdf({
    layout,
    fontRegularBytes: regularFontBytes,
    fontBoldBytes: boldFontBytes,
    footerText: project.locale === 'en'
      ? (current, total) => `Page ${current} of ${total}`
      : (current, total) => `第 ${current} 页 / 共 ${total} 页`,
    imagePlaceholder: project.locale === 'en' ? 'Image placeholder' : '图片位置'
  });
  const diagnostics = validateAiDocProject(project, rendered.renderedControls);
  if (rendered.pageCount !== project.pages.length) {
    diagnostics.push({
      severity: 'error',
      code: 'page_count_changed',
      expectedPages: project.pages.length,
      actualPages: rendered.pageCount,
      message: `The rendered document has ${rendered.pageCount} pages; the editable project requires exactly ${project.pages.length}.`
    });
  }
  return {
    ...rendered,
    diagnostics,
    previewArtifacts: previews ? await renderAiDocumentPreviews(rendered.bytes, rendered.renderedControls) : null
  };
}

async function safeCopyTree(source, destination, state = { entries: 0 }) {
  const metadata = await pathMetadata(source);
  if (!metadata) return;
  if (metadata.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', `Project data contains a symbolic link: ${source}`);
  state.entries += 1;
  if (state.entries > MAX_COPY_ENTRIES) throw new ToolKnitError('INPUT_INVALID', 'Project data contains too many files.');
  if (metadata.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  if (!metadata.isDirectory()) throw new ToolKnitError('INPUT_INVALID', `Project data contains an unsupported entry: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', `Project data contains a symbolic link: ${path.join(source, entry.name)}`);
    await safeCopyTree(path.join(source, entry.name), path.join(destination, entry.name), state);
  }
}

async function writeProjectStage({ project, paths, rendered, revisionRecord, newAssets, preserveExisting }) {
  const parent = path.dirname(paths.projectPath);
  await mkdir(parent, { recursive: true });
  const stageRoot = path.join(parent, `.${path.basename(paths.basePath)}.${process.pid}.${randomUUID()}.toolknit-stage`);
  const stage = {
    root: stageRoot,
    pdfPath: path.join(stageRoot, path.basename(paths.pdfPath)),
    projectPath: path.join(stageRoot, path.basename(paths.projectPath)),
    dataPath: path.join(stageRoot, path.basename(paths.dataPath))
  };
  await mkdir(stage.dataPath, { recursive: true });
  try {
    if (preserveExisting) {
      await safeCopyTree(path.join(paths.dataPath, 'assets'), path.join(stage.dataPath, 'assets'));
      await safeCopyTree(path.join(paths.dataPath, 'revisions'), path.join(stage.dataPath, 'revisions'));
    }
    await rm(path.join(stage.dataPath, 'preview'), { recursive: true, force: true });
    await rm(path.join(stage.dataPath, 'demo'), { recursive: true, force: true });
    await Promise.all([
      mkdir(path.join(stage.dataPath, 'assets'), { recursive: true }),
      mkdir(path.join(stage.dataPath, 'revisions'), { recursive: true }),
      mkdir(path.join(stage.dataPath, 'preview'), { recursive: true }),
      mkdir(path.join(stage.dataPath, 'demo'), { recursive: true })
    ]);
    for (const [relativePath, bytes] of newAssets || []) {
      const target = path.resolve(stage.dataPath, relativePath);
      const root = `${path.resolve(stage.dataPath)}${path.sep}`;
      const comparableRoot = process.platform === 'win32' ? root.toLowerCase() : root;
      const comparableTarget = process.platform === 'win32' ? target.toLowerCase() : target;
      if (!comparableTarget.startsWith(comparableRoot)) throw new ToolKnitError('INVALID_ARGUMENT', 'Asset target escapes the project directory.');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    }
    if (revisionRecord) {
      const revisionPath = path.join(stage.dataPath, 'revisions', `revision-${String(project.revision).padStart(4, '0')}.json`);
      await writeFile(revisionPath, `${JSON.stringify(revisionRecord, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    for (const preview of rendered.previewArtifacts.previews) {
      await writeFile(path.join(stage.dataPath, 'preview', preview.fileName), preview.bytes, { flag: 'wx' });
    }
    for (const demo of rendered.previewArtifacts.demos) {
      await writeFile(path.join(stage.dataPath, 'demo', demo.fileName), demo.bytes, { flag: 'wx' });
    }
    await writeFile(
      path.join(stage.dataPath, 'demo', rendered.previewArtifacts.overview.fileName),
      rendered.previewArtifacts.overview.bytes,
      { flag: 'wx' }
    );
    await Promise.all([
      writeFile(stage.pdfPath, rendered.bytes, { flag: 'wx', mode: 0o600 }),
      writeFile(stage.projectPath, `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    ]);
    return stage;
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function publishStage(stage, paths, overwrite) {
  const entries = [
    { source: stage.pdfPath, target: paths.pdfPath },
    { source: stage.projectPath, target: paths.projectPath },
    { source: stage.dataPath, target: paths.dataPath }
  ];
  const existing = [];
  for (const entry of entries) {
    const metadata = await pathMetadata(entry.target);
    if (metadata) existing.push(entry.target);
  }
  if (existing.length && !overwrite) {
    await rm(stage.root, { recursive: true, force: true });
    throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite existing AI document artifacts: ${existing.join(', ')}`);
  }

  const backups = [];
  const published = [];
  try {
    for (const entry of entries) {
      const metadata = await pathMetadata(entry.target);
      if (!metadata) continue;
      const backup = `${entry.target}.${process.pid}.${randomUUID()}.toolknit-backup`;
      await rename(entry.target, backup);
      backups.push({ target: entry.target, backup });
    }
    for (const entry of entries) {
      await rename(entry.source, entry.target);
      published.push(entry.target);
    }
  } catch (error) {
    for (const target of published.reverse()) await rm(target, { recursive: true, force: true }).catch(() => {});
    for (const backup of backups.reverse()) await rename(backup.backup, backup.target).catch(() => {});
    await rm(stage.root, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'AI document artifacts could not be published. Existing artifacts were restored.');
  }
  await rm(stage.root, { recursive: true, force: true }).catch(() => {});
  for (const backup of backups) await rm(backup.backup, { recursive: true, force: true }).catch(() => {});
}

function revisionRecord({ project, parentRevision, operations, changes }) {
  return {
    schema: 'toolknit.ai-document.revision',
    schemaVersion: 1,
    revision: project.revision,
    parentRevision,
    createdAt: project.updatedAt,
    operations,
    changes,
    project
  };
}

function resultOutputs(paths, rendered) {
  const demoDirectory = path.join(paths.dataPath, 'demo');
  return [
    { kind: 'pdf', path: paths.pdfPath, bytes: rendered.bytes.length, pages: rendered.pageCount },
    { kind: 'project', path: paths.projectPath, revision: null },
    { kind: 'preview', path: path.join(paths.dataPath, 'preview'), pages: rendered.previewArtifacts.previews.length },
    {
      kind: 'demo',
      path: path.join(demoDirectory, 'controls-overview.png'),
      directory: demoDirectory,
      pages: rendered.previewArtifacts.demos.length,
      page_files: rendered.previewArtifacts.demos.map(demo => path.join(demoDirectory, demo.fileName))
    }
  ];
}

function blockingDiagnostics(diagnostics) {
  return diagnostics.filter(diagnostic => diagnostic.severity === 'error');
}

export async function createAiDocumentProjectArtifacts({ layout, outputPath, locale, overwrite, expectedPageCount, reportProgress }) {
  const paths = projectPathsFromPdf(outputPath);
  const project = createAiDocProjectFromLayout(layout, { locale, title: layout.summary || 'ToolKnit AI Document' });
  reportProgress?.(68, 'Created the editable ToolKnit document project.');
  const rendered = await renderProject(project, paths);
  const blocking = blockingDiagnostics(rendered.diagnostics);
  if (blocking.length) {
    throw new ToolKnitError('AI_LAYOUT_INVALID', 'The generated document has blocking layout diagnostics.', {
      details: { diagnostics: blocking }
    });
  }
  if (rendered.pageCount !== expectedPageCount) {
    throw new ToolKnitError('AI_LAYOUT_INVALID', `The rendered document contained ${rendered.pageCount} pages instead of ${expectedPageCount}.`);
  }
  reportProgress?.(82, 'Rendered the PDF and stable control geometry.');
  reportProgress?.(90, 'Rendered clean previews and numbered control maps.');
  const record = revisionRecord({ project, parentRevision: null, operations: [{ type: 'create' }], changes: [] });
  const stage = await writeProjectStage({ project, paths, rendered, revisionRecord: record, newAssets: new Map(), preserveExisting: false });
  await publishStage(stage, paths, overwrite === true);
  reportProgress?.(96, 'Published the editable project and its artifacts.');
  const outputs = resultOutputs(paths, rendered);
  outputs.find(output => output.kind === 'project').revision = project.revision;
  return { project, paths, rendered, outputs };
}

export async function inspectAiDocumentProject(argsValue) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path']));
  const loaded = await loadAiDocumentProject(assertString(argsValue.project_path, 'project_path'));
  const inspection = inspectAiDocProject(loaded.project);
  const demoDirectory = path.join(loaded.paths.dataPath, 'demo');
  return {
    tool: 'ai.document.inspect',
    project: { path: loaded.paths.projectPath, bytes: loaded.bytes, ...inspection },
    artifacts: {
      pdf: loaded.paths.pdfPath,
      preview: path.join(loaded.paths.dataPath, 'preview'),
      demo: path.join(demoDirectory, 'controls-overview.png'),
      demoDirectory,
      numberedPages: loaded.project.pages.map((_, index) => path.join(
        demoDirectory,
        `page-${String(index + 1).padStart(2, '0')}-controls.png`
      )),
      revisions: path.join(loaded.paths.dataPath, 'revisions')
    }
  };
}

async function inspectImageAsset(sourcePathValue) {
  const sourcePathInput = assertString(sourcePathValue, 'source_path');
  if (!path.isAbsolute(sourcePathInput)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'Inserted image source_path must be an absolute PNG or JPEG path.');
  }
  const sourcePath = path.normalize(sourcePathInput);
  const extension = path.extname(sourcePath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : null;
  if (!mimeType) throw new ToolKnitError('INVALID_ARGUMENT', 'Inserted images must be PNG or JPEG files.');
  const bytes = await readRegularFile(sourcePath, { maxBytes: MAX_ASSET_BYTES, label: 'Image asset' });
  try {
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(bytes);
    return { sourcePath, bytes, mimeType, width: image.width, height: image.height, extension: mimeType === 'image/png' ? '.png' : '.jpg' };
  } catch {
    throw new ToolKnitError('INPUT_INVALID', `Image asset cannot be decoded: ${sourcePath}`);
  }
}

async function prepareAssetOperations(projectValue, operations) {
  const project = normalizeAiDocProject(projectValue);
  const prepared = operations.map(operation => {
    const copy = { ...operation };
    if (operation.control && typeof operation.control === 'object') copy.control = { ...operation.control };
    return copy;
  });
  const newAssets = new Map();
  for (const operation of prepared) {
    if (operation.type !== 'insert_control' || operation.control?.type !== 'image') continue;
    if (typeof operation.control.source_path !== 'string' || !operation.control.source_path.trim()) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'insert_control with type=image requires an absolute source_path.');
    }
    const image = await inspectImageAsset(operation.control.source_path);
    const assetId = `asset-${randomUUID()}`;
    const relativePath = `assets/${assetId}${image.extension}`;
    project.assets.push({
      id: assetId,
      relativePath,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      bytes: image.bytes.length,
      sha256: createHash('sha256').update(image.bytes).digest('hex')
    });
    operation.control.assetId = assetId;
    delete operation.control.source_path;
    newAssets.set(relativePath, image.bytes);
  }
  return { project: normalizeAiDocProject(project), operations: prepared, newAssets };
}

async function loadRevisionProject(loaded, revision) {
  const revisionPath = path.join(loaded.paths.dataPath, 'revisions', `revision-${String(revision).padStart(4, '0')}.json`);
  const bytes = await readRegularFile(revisionPath, { maxBytes: MAX_PROJECT_BYTES * 2, label: 'AI document revision' });
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    const project = normalizeAiDocProject(value.project);
    if (project.projectId !== loaded.project.projectId || project.revision !== revision) {
      throw new ToolKnitError('INPUT_INVALID', 'AI document revision does not belong to this project.');
    }
    return project;
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw mapProjectError(error instanceof SyntaxError ? new ToolKnitError('INPUT_INVALID', 'AI document revision JSON is invalid.') : error);
  }
}

export async function editAiDocumentProject(argsValue, options = {}) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path', 'operations', 'dry_run']));
  if (!Array.isArray(argsValue.operations) || argsValue.operations.length === 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'operations must be a non-empty array.');
  }
  if (argsValue.dry_run !== undefined && typeof argsValue.dry_run !== 'boolean') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'dry_run must be true or false.');
  }
  const loaded = await loadAiDocumentProject(assertString(argsValue.project_path, 'project_path'));
  const now = new Date().toISOString();
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  reportProgress(10, 'Loaded and validated the editable document project.');

  try {
    let editedProject;
    let changes;
    let normalizedOperations;
    let newAssets = new Map();
    if (argsValue.operations.length === 1 && argsValue.operations[0]?.type === 'undo') {
      const steps = argsValue.operations[0].steps === undefined ? 1 : argsValue.operations[0].steps;
      if (!Number.isSafeInteger(steps) || steps < 1 || steps >= loaded.project.revision) {
        throw new ToolKnitError('INVALID_ARGUMENT', 'undo steps must target an available earlier revision.');
      }
      const targetRevision = loaded.project.revision - steps;
      const restored = await loadRevisionProject(loaded, targetRevision);
      editedProject = normalizeAiDocProject({ ...restored, revision: loaded.project.revision + 1, updatedAt: now });
      normalizedOperations = [{ type: 'undo', steps, targetRevision }];
      changes = [{ type: 'undo', fromRevision: loaded.project.revision, restoredRevision: targetRevision }];
    } else {
      if (argsValue.operations.some(operation => operation?.type === 'undo')) {
        throw new ToolKnitError('INVALID_ARGUMENT', 'undo must be the only operation in an edit request.');
      }
      const prepared = await prepareAssetOperations(loaded.project, argsValue.operations);
      newAssets = prepared.newAssets;
      normalizedOperations = prepared.operations;
      const applied = applyAiDocProjectOperations(prepared.project, normalizedOperations, { now });
      editedProject = applied.project;
      changes = applied.changes;
    }
    reportProgress(35, 'Applied the operations atomically.');
    const rendered = await renderProject(editedProject, loaded.paths, {
      previews: argsValue.dry_run !== true,
      inlineAssets: newAssets
    });
    reportProgress(70, 'Validated the rendered page geometry and document diagnostics.');
    if (argsValue.dry_run === true) {
      return {
        tool: 'ai.document.edit',
        dry_run: true,
        project: { path: loaded.paths.projectPath, current_revision: loaded.project.revision, proposed_revision: editedProject.revision },
        changes,
        diagnostics: rendered.diagnostics
      };
    }
    const blocking = blockingDiagnostics(rendered.diagnostics);
    if (blocking.length) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'The proposed edit has blocking layout diagnostics. Run dry_run and correct them before committing.', {
        details: { diagnostics: blocking }
      });
    }
    const record = revisionRecord({
      project: editedProject,
      parentRevision: loaded.project.revision,
      operations: normalizedOperations,
      changes
    });
    const stage = await writeProjectStage({
      project: editedProject,
      paths: loaded.paths,
      rendered,
      revisionRecord: record,
      newAssets,
      preserveExisting: true
    });
    await publishStage(stage, loaded.paths, true);
    reportProgress(95, 'Published the new revision and refreshed artifacts.');
    const outputs = resultOutputs(loaded.paths, rendered);
    outputs.find(output => output.kind === 'project').revision = editedProject.revision;
    return {
      tool: 'ai.document.edit',
      dry_run: false,
      project: { path: loaded.paths.projectPath, revision: editedProject.revision, previous_revision: loaded.project.revision },
      changes,
      diagnostics: rendered.diagnostics,
      outputs
    };
  } catch (error) {
    throw mapProjectError(error);
  }
}

export async function renderAiDocumentProject(argsValue, options = {}) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path']));
  const loaded = await loadAiDocumentProject(assertString(argsValue.project_path, 'project_path'));
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  reportProgress(15, 'Loaded and validated the editable document project.');
  const rendered = await renderProject(loaded.project, loaded.paths);
  const blocking = blockingDiagnostics(rendered.diagnostics);
  if (blocking.length) {
    throw new ToolKnitError('INPUT_INVALID', 'The project has blocking layout diagnostics and was not rendered.', {
      details: { diagnostics: blocking }
    });
  }
  reportProgress(75, 'Rendered the PDF, previews, and numbered control maps.');
  const stage = await writeProjectStage({
    project: loaded.project,
    paths: loaded.paths,
    rendered,
    revisionRecord: null,
    newAssets: new Map(),
    preserveExisting: true
  });
  await publishStage(stage, loaded.paths, true);
  reportProgress(95, 'Refreshed the document artifacts.');
  const outputs = resultOutputs(loaded.paths, rendered);
  outputs.find(output => output.kind === 'project').revision = loaded.project.revision;
  return {
    tool: 'ai.document.render',
    project: { path: loaded.paths.projectPath, revision: loaded.project.revision },
    diagnostics: rendered.diagnostics,
    outputs
  };
}
