import { AI_DOC_PAGE, AiDocLayoutError, cloneAiDocLayout } from './ai-doc-core.js';

export const AI_DOC_PROJECT_SCHEMA = 'toolknit.ai-document';
export const AI_DOC_PROJECT_VERSION = 1;

const REGION_TYPES = new Set([
  'title', 'subtitle', 'section-heading', 'sub-heading', 'body', 'body-indent',
  'list-item', 'image', 'signature', 'date', 'divider', 'page-header',
  'page-footer', 'table-row', 'note', 'emphasis'
]);
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const LAYOUT_MODES = new Set(['flow', 'absolute']);
const STYLE_COLOR_KEYS = new Set(['textColor', 'backgroundColor', 'borderColor', 'dividerColor']);
const STYLE_NUMBER_LIMITS = Object.freeze({
  borderWidth: [0, 12],
  dividerWidth: [0, 12],
  padding: [0, 80],
  opacity: [0.05, 1],
  lineHeight: [1, 3]
});
const TYPOGRAPHY_KEYS = new Set(['fontSize', 'bold', 'align']);
const EDITABLE_STYLE_KEYS = new Set([
  ...STYLE_COLOR_KEYS,
  ...Object.keys(STYLE_NUMBER_LIMITS),
  ...TYPOGRAPHY_KEYS
]);
const OPERATION_KEYS = Object.freeze({
  update_text: new Set(['type', 'control', 'text']),
  update_style: new Set(['type', 'control', 'style']),
  update_document_style: new Set(['type', 'style', 'types']),
  move: new Set(['type', 'control', 'x', 'y', 'layoutMode']),
  resize: new Set(['type', 'control', 'w', 'h']),
  swap_positions: new Set(['type', 'first', 'second']),
  insert_control: new Set(['type', 'before', 'after', 'page', 'control']),
  delete_control: new Set(['type', 'control']),
  lock_control: new Set(['type', 'control', 'locked']),
  group_controls: new Set(['type', 'controls', 'group']),
  ungroup_controls: new Set(['type', 'controls', 'group']),
  align_controls: new Set(['type', 'controls', 'anchor', 'alignment']),
  resolve_overlaps: new Set(['type', 'controls', 'direction', 'gap'])
});
const INSERT_CONTROL_KEYS = new Set([
  'type', 'layoutMode', 'x', 'y', 'w', 'h', 'text', 'label', 'assetId',
  'fontSize', 'bold', 'align', 'style'
]);
const PROJECT_KEYS = new Set(['schema', 'schemaVersion', 'projectId', 'title', 'summary', 'locale', 'createdAt', 'updatedAt', 'revision', 'pages', 'assets']);
const PAGE_KEYS = new Set(['id', 'width', 'height', 'controls']);
const CONTROL_KEYS = new Set(['id', 'number', 'type', 'layoutMode', 'x', 'y', 'w', 'h', 'text', 'label', 'assetId', 'groupId', 'fontSize', 'bold', 'align', 'locked', 'style']);
const ASSET_KEYS = new Set(['id', 'relativePath', 'mimeType', 'width', 'height', 'bytes', 'sha256']);

export class AiDocProjectError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AiDocProjectError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, message) {
  if (!isPlainObject(value)) throw new AiDocProjectError('invalid_project', message);
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new AiDocProjectError('invalid_project', `${label} contains an unsupported property: ${key}`);
  }
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cleanText(value, maxLength, fieldName) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new AiDocProjectError('invalid_project', `${fieldName} must be a string.`);
  if (value.length > maxLength) throw new AiDocProjectError('invalid_project', `${fieldName} is too long.`);
  return value.replace(/\u0000/g, '').trim();
}

function finiteNumber(value, fallback, minimum, maximum, fieldName) {
  const number = value === undefined ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new AiDocProjectError('invalid_project', `${fieldName} must be a finite number.`);
  }
  return Math.round(Math.max(minimum, Math.min(maximum, number)) * 100) / 100;
}

function normalizeColor(value, fieldName, { nullable = true } = {}) {
  if ((value === undefined || value === null || value === '') && nullable) return null;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new AiDocProjectError('invalid_style', `${fieldName} must use #RRGGBB format.`);
  }
  return value.toUpperCase();
}

function normalizeStyle(value = {}) {
  assertPlainObject(value, 'Control style must be an object.');
  for (const key of Object.keys(value)) {
    if (!EDITABLE_STYLE_KEYS.has(key)) throw new AiDocProjectError('invalid_style', `Unsupported style property: ${key}`);
  }
  const style = {};
  for (const key of STYLE_COLOR_KEYS) {
    if (value[key] !== undefined) style[key] = normalizeColor(value[key], key);
  }
  for (const [key, [minimum, maximum]] of Object.entries(STYLE_NUMBER_LIMITS)) {
    if (value[key] !== undefined) style[key] = finiteNumber(value[key], minimum, minimum, maximum, key);
  }
  return style;
}

function normalizeAsset(asset, index) {
  assertPlainObject(asset, `Asset ${index + 1} must be an object.`);
  assertOnlyKeys(asset, ASSET_KEYS, `Asset ${index + 1}`);
  const id = cleanText(asset.id, 120, 'Asset id');
  const relativePath = cleanText(asset.relativePath, 500, 'Asset relativePath').replace(/\\/g, '/');
  if (!id || !relativePath || relativePath.startsWith('/') || /^[a-z]:/i.test(relativePath) || relativePath.split('/').includes('..')) {
    throw new AiDocProjectError('invalid_project', `Asset ${index + 1} must use a safe project-relative path.`);
  }
  const mimeType = cleanText(asset.mimeType, 100, 'Asset mimeType').toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(mimeType)) {
    throw new AiDocProjectError('invalid_project', `Asset ${index + 1} uses an unsupported image type.`);
  }
  const normalized = {
    id,
    relativePath,
    mimeType,
    width: finiteNumber(asset.width, 0, 0, 100000, 'Asset width'),
    height: finiteNumber(asset.height, 0, 0, 100000, 'Asset height'),
    bytes: finiteNumber(asset.bytes, 0, 0, 10 * 1024 * 1024, 'Asset bytes')
  };
  if (!Number.isSafeInteger(normalized.bytes)) throw new AiDocProjectError('invalid_project', `Asset ${index + 1} bytes must be an integer.`);
  if (asset.sha256 !== undefined && asset.sha256 !== null && asset.sha256 !== '') {
    const sha256 = cleanText(asset.sha256, 64, 'Asset sha256').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AiDocProjectError('invalid_project', `Asset ${index + 1} sha256 is invalid.`);
    normalized.sha256 = sha256;
  }
  return normalized;
}

function normalizeControl(control, pageIndex, controlIndex) {
  assertPlainObject(control, `Control ${pageIndex + 1}.${controlIndex + 1} must be an object.`);
  assertOnlyKeys(control, CONTROL_KEYS, `Control ${pageIndex + 1}.${controlIndex + 1}`);
  const id = cleanText(control.id, 120, 'Control id');
  const number = cleanText(control.number, 40, 'Control number');
  if (!id || !number) throw new AiDocProjectError('invalid_project', 'Every control requires a stable id and number.');
  if (!REGION_TYPES.has(control.type)) throw new AiDocProjectError('invalid_project', `Unsupported control type: ${control.type}`);
  const x = finiteNumber(control.x, 56, 0, AI_DOC_PAGE.width, 'Control x');
  const y = finiteNumber(control.y, 60, 0, AI_DOC_PAGE.height, 'Control y');
  const w = finiteNumber(control.w, 682, 2, AI_DOC_PAGE.width, 'Control width');
  const h = finiteNumber(control.h, control.type === 'divider' ? 2 : 40, 2, AI_DOC_PAGE.height, 'Control height');
  const result = {
    id,
    number,
    type: control.type,
    layoutMode: LAYOUT_MODES.has(control.layoutMode) ? control.layoutMode : 'flow',
    x,
    y,
    w,
    h,
    text: cleanText(control.text, 2000, 'Control text'),
    fontSize: finiteNumber(control.fontSize, 14, 6, 96, 'Control fontSize'),
    bold: Boolean(control.bold),
    align: ALIGNMENTS.has(control.align) ? control.align : 'left',
    locked: Boolean(control.locked),
    style: normalizeStyle(control.style || {})
  };
  if (control.label !== undefined) result.label = cleanText(control.label, 300, 'Control label');
  if (control.assetId !== undefined && control.assetId !== null && control.assetId !== '') {
    result.assetId = cleanText(control.assetId, 120, 'Control assetId');
  }
  if (control.groupId !== undefined && control.groupId !== null && control.groupId !== '') {
    result.groupId = cleanText(control.groupId, 120, 'Control groupId');
  }
  return result;
}

function normalizePage(page, pageIndex) {
  assertPlainObject(page, `Page ${pageIndex + 1} must be an object.`);
  assertOnlyKeys(page, PAGE_KEYS, `Page ${pageIndex + 1}`);
  if (!Array.isArray(page.controls) || page.controls.length === 0) {
    throw new AiDocProjectError('invalid_project', `Page ${pageIndex + 1} must contain at least one control.`);
  }
  const id = cleanText(page.id, 120, 'Page id');
  if (!id) throw new AiDocProjectError('invalid_project', `Page ${pageIndex + 1} requires a stable id.`);
  return {
    id,
    width: finiteNumber(page.width, AI_DOC_PAGE.width, 100, 10000, 'Page width'),
    height: finiteNumber(page.height, AI_DOC_PAGE.height, 100, 10000, 'Page height'),
    controls: page.controls.map((control, controlIndex) => normalizeControl(control, pageIndex, controlIndex))
  };
}

export function normalizeAiDocProject(value) {
  assertPlainObject(value, 'AI document project must be an object.');
  assertOnlyKeys(value, PROJECT_KEYS, 'AI document project');
  if (value.schema !== AI_DOC_PROJECT_SCHEMA || value.schemaVersion !== AI_DOC_PROJECT_VERSION) {
    throw new AiDocProjectError('unsupported_project', 'Unsupported ToolKnit AI document project version.');
  }
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    throw new AiDocProjectError('invalid_project', 'The project must contain at least one page.');
  }
  const project = {
    schema: AI_DOC_PROJECT_SCHEMA,
    schemaVersion: AI_DOC_PROJECT_VERSION,
    projectId: cleanText(value.projectId, 120, 'Project id'),
    title: cleanText(value.title, 300, 'Project title'),
    summary: cleanText(value.summary, 500, 'Project summary'),
    locale: value.locale === 'en' ? 'en' : 'zh-CN',
    createdAt: cleanText(value.createdAt, 80, 'Project createdAt'),
    updatedAt: cleanText(value.updatedAt, 80, 'Project updatedAt'),
    revision: finiteNumber(value.revision, 1, 1, Number.MAX_SAFE_INTEGER, 'Project revision'),
    pages: value.pages.map(normalizePage),
    assets: Array.isArray(value.assets) ? value.assets.map(normalizeAsset) : []
  };
  if (!project.projectId) throw new AiDocProjectError('invalid_project', 'The project requires a stable id.');
  if (!Number.isSafeInteger(project.revision)) throw new AiDocProjectError('invalid_project', 'Project revision must be an integer.');
  if (project.assets.length > 100) throw new AiDocProjectError('invalid_project', 'The project contains too many assets.');
  if (project.assets.reduce((sum, asset) => sum + asset.bytes, 0) > 40 * 1024 * 1024) {
    throw new AiDocProjectError('invalid_project', 'The project asset budget has been exceeded.');
  }

  const ids = new Set();
  const numbers = new Set();
  for (const page of project.pages) {
    if (ids.has(page.id)) throw new AiDocProjectError('invalid_project', `Duplicate id: ${page.id}`);
    ids.add(page.id);
    for (const control of page.controls) {
      if (ids.has(control.id)) throw new AiDocProjectError('invalid_project', `Duplicate id: ${control.id}`);
      if (numbers.has(control.number)) throw new AiDocProjectError('invalid_project', `Duplicate control number: ${control.number}`);
      ids.add(control.id);
      numbers.add(control.number);
    }
  }
  const assetIds = new Set();
  for (const asset of project.assets) {
    if (assetIds.has(asset.id)) throw new AiDocProjectError('invalid_project', `Duplicate asset id: ${asset.id}`);
    assetIds.add(asset.id);
  }
  for (const page of project.pages) {
    for (const control of page.controls) {
      if (control.assetId && !assetIds.has(control.assetId)) {
        throw new AiDocProjectError('invalid_project', `Control ${control.number} references a missing asset.`);
      }
    }
  }
  return project;
}

export function cloneAiDocProject(project) {
  return normalizeAiDocProject(deepClone(project));
}

export function createAiDocProjectFromLayout(layout, options = {}) {
  let source;
  try {
    source = cloneAiDocLayout(layout);
  } catch (error) {
    if (error instanceof AiDocLayoutError) {
      throw new AiDocProjectError('invalid_project', error.message);
    }
    throw error;
  }
  const createId = typeof options.createId === 'function' ? options.createId : defaultId;
  const now = typeof options.now === 'string' && options.now ? options.now : new Date().toISOString();
  const pages = source.pages.map((page, pageIndex) => ({
    id: createId('page'),
    width: AI_DOC_PAGE.width,
    height: AI_DOC_PAGE.height,
    controls: page.regions.map((region, controlIndex) => ({
      type: region.type,
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      text: region.text,
      ...(region.label === undefined ? {} : { label: region.label }),
      ...(region.assetId === undefined ? {} : { assetId: region.assetId }),
      ...(region.groupId === undefined ? {} : { groupId: region.groupId }),
      fontSize: region.fontSize,
      bold: region.bold,
      align: region.align,
      id: createId('control'),
      number: `P${pageIndex + 1}-${String(controlIndex + 1).padStart(2, '0')}`,
      layoutMode: 'flow',
      locked: false,
      style: normalizeStyle(region.style || {})
    }))
  }));
  return normalizeAiDocProject({
    schema: AI_DOC_PROJECT_SCHEMA,
    schemaVersion: AI_DOC_PROJECT_VERSION,
    projectId: options.projectId || createId('project'),
    title: options.title || source.summary || 'ToolKnit AI Document',
    summary: source.summary,
    locale: options.locale || 'zh-CN',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    pages,
    assets: options.assets || []
  });
}

export function projectToAiDocLayout(project) {
  const source = normalizeAiDocProject(project);
  return {
    ready: true,
    summary: source.summary,
    pages: source.pages.map(page => ({
      regions: page.controls.map(control => ({
        ...deepClone(control),
        controlId: control.id,
        controlNumber: control.number,
        editorId: control.id
      }))
    }))
  };
}

function findControl(project, reference) {
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new AiDocProjectError('invalid_operation', 'A control id or number is required.');
  }
  const query = reference.trim();
  for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex++) {
    const controlIndex = project.pages[pageIndex].controls.findIndex(control => control.id === query || control.number === query);
    if (controlIndex >= 0) return { pageIndex, controlIndex, control: project.pages[pageIndex].controls[controlIndex] };
  }
  throw new AiDocProjectError('control_not_found', `Control not found: ${query}`);
}

function findDistinctControls(project, references, { minimum = 1, label = 'controls' } = {}) {
  if (!Array.isArray(references) || references.length < minimum) {
    throw new AiDocProjectError('invalid_operation', `${label} must contain at least ${minimum} control reference${minimum === 1 ? '' : 's'}.`);
  }
  const found = references.map(reference => findControl(project, reference));
  if (new Set(found.map(item => item.control.id)).size !== found.length) {
    throw new AiDocProjectError('invalid_operation', `${label} cannot contain duplicate controls.`);
  }
  return found;
}

function assertUnlocked(control, operationType) {
  if (control.locked && operationType !== 'lock_control') {
    throw new AiDocProjectError('control_locked', `Control ${control.number} is locked.`);
  }
}

function nextControlNumber(project, pageIndex) {
  const prefix = `P${pageIndex + 1}-`;
  let maximum = 0;
  for (const page of project.pages) {
    for (const control of page.controls) {
      if (!control.number.startsWith(prefix)) continue;
      const number = Number.parseInt(control.number.slice(prefix.length), 10);
      if (Number.isSafeInteger(number)) maximum = Math.max(maximum, number);
    }
  }
  return `${prefix}${String(maximum + 1).padStart(2, '0')}`;
}

function normalizeOperation(value, index) {
  assertPlainObject(value, `Operation ${index + 1} must be an object.`);
  const type = cleanText(value.type, 80, 'Operation type');
  if (!type) throw new AiDocProjectError('invalid_operation', `Operation ${index + 1} requires a type.`);
  const allowedKeys = OPERATION_KEYS[type];
  if (!allowedKeys) throw new AiDocProjectError('invalid_operation', `Unsupported operation type: ${type}`);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new AiDocProjectError('invalid_operation', `Unsupported ${type} property: ${key}`);
  }
  return { ...deepClone(value), type };
}

function applyOperation(project, operation, options) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultId;
  if (operation.type === 'update_text') {
    const found = findControl(project, operation.control);
    assertUnlocked(found.control, operation.type);
    if (found.control.type === 'image' || found.control.type === 'divider') {
      throw new AiDocProjectError('invalid_operation', `Control ${found.control.number} does not support text.`);
    }
    const before = found.control.text;
    found.control.text = cleanText(operation.text, 2000, 'Control text');
    return { type: operation.type, control: found.control.number, before, after: found.control.text };
  }
  if (operation.type === 'update_style') {
    const found = findControl(project, operation.control);
    assertUnlocked(found.control, operation.type);
    assertPlainObject(operation.style, 'update_style requires a style object.');
    const style = normalizeStyle(operation.style);
    const before = { fontSize: found.control.fontSize, bold: found.control.bold, align: found.control.align, style: deepClone(found.control.style) };
    if (operation.style.fontSize !== undefined) {
      found.control.fontSize = finiteNumber(operation.style.fontSize, found.control.fontSize, 6, 96, 'fontSize');
    }
    if (operation.style.bold !== undefined) {
      if (typeof operation.style.bold !== 'boolean') throw new AiDocProjectError('invalid_style', 'bold must be true or false.');
      found.control.bold = operation.style.bold;
    }
    if (operation.style.align !== undefined) {
      if (!ALIGNMENTS.has(operation.style.align)) throw new AiDocProjectError('invalid_style', 'align must be left, center, or right.');
      found.control.align = operation.style.align;
    }
    found.control.style = { ...found.control.style, ...style };
    return {
      type: operation.type,
      control: found.control.number,
      before,
      after: { fontSize: found.control.fontSize, bold: found.control.bold, align: found.control.align, style: deepClone(found.control.style) }
    };
  }
  if (operation.type === 'update_document_style') {
    assertPlainObject(operation.style, 'update_document_style requires a style object.');
    const style = normalizeStyle(operation.style);
    const types = operation.types === undefined
      ? null
      : (() => {
          if (!Array.isArray(operation.types) || !operation.types.length) {
            throw new AiDocProjectError('invalid_operation', 'types must be a non-empty array when supplied.');
          }
          const unique = new Set(operation.types);
          for (const type of unique) {
            if (typeof type !== 'string' || !REGION_TYPES.has(type)) {
              throw new AiDocProjectError('invalid_operation', `Unsupported control type in types: ${String(type)}`);
            }
          }
          return unique;
        })();
    const typography = ['fontSize', 'bold', 'align'];
    const changed = [];
    const skippedLocked = [];
    project.pages.forEach((page, pageIndex) => page.controls.forEach(control => {
      const included = types
        ? types.has(control.type)
        : !['image', 'divider', 'page-header', 'page-footer'].includes(control.type);
      if (!included) return;
      if (control.locked) { skippedLocked.push(control.number); return; }
      const before = { fontSize: control.fontSize, bold: control.bold, align: control.align, style: deepClone(control.style) };
      if (operation.style.fontSize !== undefined) {
        control.fontSize = finiteNumber(operation.style.fontSize, control.fontSize, 6, 96, 'fontSize');
      }
      if (operation.style.bold !== undefined) {
        if (typeof operation.style.bold !== 'boolean') throw new AiDocProjectError('invalid_style', 'bold must be true or false.');
        control.bold = operation.style.bold;
      }
      if (operation.style.align !== undefined) {
        if (!ALIGNMENTS.has(operation.style.align)) throw new AiDocProjectError('invalid_style', 'align must be left, center, or right.');
        control.align = operation.style.align;
      }
      const stylePatch = Object.fromEntries(Object.entries(style).filter(([key]) => !typography.includes(key)));
      control.style = { ...control.style, ...stylePatch };
      changed.push({ control: control.number, before, after: { fontSize: control.fontSize, bold: control.bold, align: control.align, style: deepClone(control.style) } });
    }));
    if (!changed.length) {
      throw new AiDocProjectError('invalid_operation', 'update_document_style did not match any unlocked controls.');
    }
    return { type: operation.type, types: types ? [...types] : null, changed, skippedLocked };
  }
  if (operation.type === 'move') {
    const found = findControl(project, operation.control);
    assertUnlocked(found.control, operation.type);
    const before = { x: found.control.x, y: found.control.y, layoutMode: found.control.layoutMode };
    found.control.x = finiteNumber(operation.x, found.control.x, 0, AI_DOC_PAGE.width, 'Control x');
    found.control.y = finiteNumber(operation.y, found.control.y, 0, AI_DOC_PAGE.height, 'Control y');
    if (operation.layoutMode !== undefined) {
      if (!LAYOUT_MODES.has(operation.layoutMode)) throw new AiDocProjectError('invalid_operation', 'layoutMode must be flow or absolute.');
      found.control.layoutMode = operation.layoutMode;
    }
    return { type: operation.type, control: found.control.number, before, after: { x: found.control.x, y: found.control.y, layoutMode: found.control.layoutMode } };
  }
  if (operation.type === 'resize') {
    const found = findControl(project, operation.control);
    assertUnlocked(found.control, operation.type);
    const before = { w: found.control.w, h: found.control.h };
    found.control.w = finiteNumber(operation.w, found.control.w, 2, AI_DOC_PAGE.width, 'Control width');
    found.control.h = finiteNumber(operation.h, found.control.h, 2, AI_DOC_PAGE.height, 'Control height');
    return { type: operation.type, control: found.control.number, before, after: { w: found.control.w, h: found.control.h } };
  }
  if (operation.type === 'swap_positions') {
    const first = findControl(project, operation.first);
    const second = findControl(project, operation.second);
    if (first.control.id === second.control.id) throw new AiDocProjectError('invalid_operation', 'swap_positions requires two different controls.');
    assertUnlocked(first.control, operation.type);
    assertUnlocked(second.control, operation.type);
    const firstPlacement = { x: first.control.x, y: first.control.y, w: first.control.w, h: first.control.h, layoutMode: first.control.layoutMode };
    const secondPlacement = { x: second.control.x, y: second.control.y, w: second.control.w, h: second.control.h, layoutMode: second.control.layoutMode };
    const firstControl = first.control;
    const secondControl = second.control;
    Object.assign(firstControl, secondPlacement);
    Object.assign(secondControl, firstPlacement);
    project.pages[first.pageIndex].controls[first.controlIndex] = secondControl;
    project.pages[second.pageIndex].controls[second.controlIndex] = firstControl;
    return { type: operation.type, first: firstControl.number, second: secondControl.number };
  }
  if (operation.type === 'insert_control') {
    const hasBefore = operation.before !== undefined;
    const hasAfter = operation.after !== undefined;
    if (hasBefore && hasAfter) throw new AiDocProjectError('invalid_operation', 'insert_control accepts before or after, not both.');
    let pageIndex;
    let controlIndex;
    if (hasBefore || hasAfter) {
      const anchor = findControl(project, hasBefore ? operation.before : operation.after);
      pageIndex = anchor.pageIndex;
      controlIndex = anchor.controlIndex + (hasAfter ? 1 : 0);
    } else {
      pageIndex = operation.page === undefined ? 0 : operation.page - 1;
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= project.pages.length) {
        throw new AiDocProjectError('invalid_operation', 'insert_control page is outside the project.');
      }
      controlIndex = project.pages[pageIndex].controls.length;
    }
    assertPlainObject(operation.control, 'insert_control requires a control object.');
    for (const key of Object.keys(operation.control)) {
      if (!INSERT_CONTROL_KEYS.has(key)) throw new AiDocProjectError('invalid_operation', `Unsupported inserted control property: ${key}`);
    }
    const draft = {
      type: operation.control.type,
      id: createId('control'),
      number: nextControlNumber(project, pageIndex),
      layoutMode: operation.control.layoutMode || 'flow',
      x: operation.control.x,
      y: operation.control.y,
      w: operation.control.w,
      h: operation.control.h,
      text: operation.control.text,
      label: operation.control.label,
      assetId: operation.control.assetId,
      fontSize: operation.control.fontSize,
      bold: operation.control.bold,
      align: operation.control.align,
      locked: false,
      style: operation.control.style || {}
    };
    const control = normalizeControl(draft, pageIndex, controlIndex);
    project.pages[pageIndex].controls.splice(controlIndex, 0, control);
    return { type: operation.type, control: control.number, id: control.id, page: pageIndex + 1, index: controlIndex };
  }
  if (operation.type === 'delete_control') {
    const found = findControl(project, operation.control);
    assertUnlocked(found.control, operation.type);
    if (project.pages[found.pageIndex].controls.length === 1) {
      throw new AiDocProjectError('invalid_operation', 'A page cannot be left without controls.');
    }
    project.pages[found.pageIndex].controls.splice(found.controlIndex, 1);
    return { type: operation.type, control: found.control.number, id: found.control.id };
  }
  if (operation.type === 'lock_control') {
    const found = findControl(project, operation.control);
    if (typeof operation.locked !== 'boolean') throw new AiDocProjectError('invalid_operation', 'lock_control requires locked=true or false.');
    const before = found.control.locked;
    found.control.locked = operation.locked;
    return { type: operation.type, control: found.control.number, before, after: found.control.locked };
  }
  if (operation.type === 'group_controls') {
    const found = findDistinctControls(project, operation.controls, { minimum: 2 });
    for (const item of found) assertUnlocked(item.control, operation.type);
    const groupId = operation.group === undefined
      ? createId('group')
      : cleanText(operation.group, 120, 'Group id');
    if (!groupId) throw new AiDocProjectError('invalid_operation', 'group_controls requires a non-empty group id when group is provided.');
    const before = found.map(item => ({ control: item.control.number, groupId: item.control.groupId || null }));
    found.forEach(item => { item.control.groupId = groupId; });
    return { type: operation.type, groupId, controls: found.map(item => item.control.number), before };
  }
  if (operation.type === 'ungroup_controls') {
    let found;
    if (operation.controls !== undefined && operation.group !== undefined) {
      throw new AiDocProjectError('invalid_operation', 'ungroup_controls accepts controls or group, not both.');
    }
    if (operation.controls !== undefined) {
      found = findDistinctControls(project, operation.controls);
    } else {
      const groupId = cleanText(operation.group, 120, 'Group id');
      if (!groupId) throw new AiDocProjectError('invalid_operation', 'ungroup_controls requires controls or group.');
      found = project.pages.flatMap((page, pageIndex) => page.controls
        .map((control, controlIndex) => ({ pageIndex, controlIndex, control }))
        .filter(item => item.control.groupId === groupId));
      if (!found.length) throw new AiDocProjectError('control_not_found', `Control group not found: ${groupId}`);
    }
    for (const item of found) assertUnlocked(item.control, operation.type);
    const before = found.map(item => ({ control: item.control.number, groupId: item.control.groupId || null }));
    found.forEach(item => { delete item.control.groupId; });
    return { type: operation.type, controls: found.map(item => item.control.number), before };
  }
  if (operation.type === 'align_controls') {
    const found = findDistinctControls(project, operation.controls, { minimum: 2 });
    for (const item of found) assertUnlocked(item.control, operation.type);
    if (new Set(found.map(item => item.pageIndex)).size !== 1) {
      throw new AiDocProjectError('invalid_operation', 'align_controls requires controls on the same project page.');
    }
    const alignments = new Set(['left', 'center', 'right', 'top', 'middle', 'bottom']);
    if (!alignments.has(operation.alignment)) {
      throw new AiDocProjectError('invalid_operation', 'alignment must be left, center, right, top, middle, or bottom.');
    }
    const anchor = operation.anchor === undefined ? found[0] : findControl(project, operation.anchor);
    if (!found.some(item => item.control.id === anchor.control.id)) {
      throw new AiDocProjectError('invalid_operation', 'align_controls anchor must also appear in controls.');
    }
    const before = found.map(item => ({
      control: item.control.number,
      x: item.control.x,
      y: item.control.y,
      layoutMode: item.control.layoutMode
    }));
    const anchorControl = anchor.control;
    for (const item of found) {
      const control = item.control;
      if (operation.alignment === 'left') control.x = anchorControl.x;
      if (operation.alignment === 'center') control.x = anchorControl.x + (anchorControl.w - control.w) / 2;
      if (operation.alignment === 'right') control.x = anchorControl.x + anchorControl.w - control.w;
      if (operation.alignment === 'top') control.y = anchorControl.y;
      if (operation.alignment === 'middle') control.y = anchorControl.y + (anchorControl.h - control.h) / 2;
      if (operation.alignment === 'bottom') control.y = anchorControl.y + anchorControl.h - control.h;
      control.x = Math.round(control.x * 100) / 100;
      control.y = Math.round(control.y * 100) / 100;
      if (['top', 'middle', 'bottom'].includes(operation.alignment)) control.layoutMode = 'absolute';
    }
    return { type: operation.type, alignment: operation.alignment, anchor: anchorControl.number, controls: found.map(item => item.control.number), before };
  }
  if (operation.type === 'resolve_overlaps') {
    const direction = operation.direction === undefined ? 'vertical' : operation.direction;
    if (!['vertical', 'horizontal'].includes(direction)) {
      throw new AiDocProjectError('invalid_operation', 'resolve_overlaps direction must be vertical or horizontal.');
    }
    const gap = finiteNumber(operation.gap, 12, 0, 100, 'Overlap gap');
    const selected = operation.controls === undefined
      ? project.pages.flatMap((page, pageIndex) => page.controls
        .map((control, controlIndex) => ({ pageIndex, controlIndex, control }))
        .filter(item => item.control.layoutMode === 'absolute'))
      : findDistinctControls(project, operation.controls);
    if (!selected.length) throw new AiDocProjectError('invalid_operation', 'resolve_overlaps did not find any absolute-layout controls.');
    for (const item of selected) assertUnlocked(item.control, operation.type);
    if (selected.some(item => item.control.layoutMode !== 'absolute')) {
      throw new AiDocProjectError('invalid_operation', 'resolve_overlaps only accepts absolute-layout controls.');
    }
    const selectedIds = new Set(selected.map(item => item.control.id));
    const before = selected.map(item => ({ control: item.control.number, x: item.control.x, y: item.control.y }));
    let moved = 0;
    for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex++) {
      const targets = selected
        .filter(item => item.pageIndex === pageIndex)
        .sort((left, right) => direction === 'vertical'
          ? left.control.y - right.control.y || left.control.x - right.control.x
          : left.control.x - right.control.x || left.control.y - right.control.y);
      const obstacles = project.pages[pageIndex].controls.filter(control => !selectedIds.has(control.id));
      const placed = [...obstacles];
      for (const item of targets) {
        const control = item.control;
        let guard = 0;
        while (guard++ < 200) {
          const collisions = placed.filter(other => rectanglesOverlap(control, other));
          if (!collisions.length) break;
          if (direction === 'vertical') control.y = Math.max(...collisions.map(other => other.y + other.h + gap));
          else control.x = Math.max(...collisions.map(other => other.x + other.w + gap));
        }
        const original = before.find(entry => entry.control === control.number);
        if (original && (original.x !== control.x || original.y !== control.y)) moved += 1;
        placed.push(control);
      }
    }
    return { type: operation.type, direction, gap, controls: selected.map(item => item.control.number), moved, before };
  }
  throw new AiDocProjectError('invalid_operation', `Unsupported operation type: ${operation.type}`);
}

export function applyAiDocProjectOperations(projectValue, operationsValue, options = {}) {
  const project = cloneAiDocProject(projectValue);
  if (!Array.isArray(operationsValue) || operationsValue.length === 0) {
    throw new AiDocProjectError('invalid_operation', 'At least one edit operation is required.');
  }
  if (operationsValue.length > 100) throw new AiDocProjectError('invalid_operation', 'A single edit may contain at most 100 operations.');
  const operations = [];
  for (let index = 0; index < operationsValue.length; index++) {
    try {
      operations.push(normalizeOperation(operationsValue[index], index));
    } catch (error) {
      if (error instanceof AiDocProjectError) {
        error.details = { ...(error.details || {}), operationIndex: index, operationType: operationsValue[index]?.type || null };
      }
      throw error;
    }
  }
  const changes = [];
  for (let index = 0; index < operations.length; index++) {
    try {
      changes.push(applyOperation(project, operations[index], options));
    } catch (error) {
      if (error instanceof AiDocProjectError) {
        error.details = { ...(error.details || {}), operationIndex: index, operationType: operations[index].type };
      }
      throw error;
    }
  }
  const now = typeof options.now === 'string' && options.now ? options.now : new Date().toISOString();
  project.updatedAt = now;
  project.revision += 1;
  const normalized = normalizeAiDocProject(project);
  return {
    project: normalized,
    changes,
    diagnostics: validateAiDocProject(normalized, options.renderedControls)
  };
}

function parseHexColor(value, fallback) {
  const color = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(color) {
  const channels = color.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function rectanglesOverlap(first, second) {
  return first.x < second.x + second.w && first.x + first.w > second.x
    && first.y < second.y + second.h && first.y + first.h > second.y;
}

export function validateAiDocProject(projectValue, renderedControls = undefined) {
  const project = normalizeAiDocProject(projectValue);
  const diagnostics = [];
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const renderedById = new Map(Array.isArray(renderedControls)
    ? renderedControls.map(control => [control.controlId || control.id, control])
    : []);

  project.pages.forEach((page, pageIndex) => {
    const geometry = [];
    page.controls.forEach(control => {
      const rendered = renderedById.get(control.id);
      const box = rendered
        ? { x: rendered.x, y: rendered.y, w: rendered.w, h: rendered.h, pageIndex: rendered.pageIndex ?? pageIndex }
        : { x: control.x, y: control.y, w: control.w, h: control.h, pageIndex };
      if (box.x < 0 || box.y < 0 || box.x + box.w > page.width || box.y + box.h > page.height) {
        diagnostics.push({ severity: 'error', code: 'control_out_of_bounds', control: control.number, message: `${control.number} extends beyond its page.` });
      }
      if (rendered || control.layoutMode === 'absolute') geometry.push({ ...box, control });

      const foreground = parseHexColor(control.style.textColor, control.type === 'emphasis' ? '#FFFFFF' : '#1A1A1A');
      const background = parseHexColor(control.style.backgroundColor, control.type === 'emphasis' ? '#1B1B1B' : '#FFFFFF');
      const ratio = contrastRatio(foreground, background);
      if (control.text && ratio < 4.5) {
        diagnostics.push({ severity: 'warning', code: 'low_contrast', control: control.number, value: Math.round(ratio * 100) / 100, message: `${control.number} has low text contrast.` });
      }

      if (control.layoutMode === 'absolute' && control.text && !['table-row', 'divider', 'image'].includes(control.type)) {
        const padding = control.style.padding ?? 0;
        const charactersPerLine = Math.max(1, Math.floor((control.w - padding * 2) / Math.max(4, control.fontSize)));
        const lineCount = control.text.split('\n').reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / charactersPerLine)), 0);
        const neededHeight = lineCount * control.fontSize * (control.style.lineHeight ?? 1.58) + padding * 2;
        if (neededHeight > control.h + 1) {
          diagnostics.push({ severity: 'warning', code: 'text_may_overflow', control: control.number, message: `${control.number} may not have enough height for its text.` });
        }
      }

      if (control.type === 'image' && control.assetId) {
        const asset = assets.get(control.assetId);
        if (asset && asset.width > 0 && asset.height > 0) {
          const requiredWidth = control.w * 2;
          const requiredHeight = control.h * 2;
          if (asset.width < requiredWidth || asset.height < requiredHeight) {
            diagnostics.push({ severity: 'warning', code: 'low_resolution_image', control: control.number, message: `${control.number} may be soft at print resolution.` });
          }
        }
      }
    });
    for (let firstIndex = 0; firstIndex < geometry.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < geometry.length; secondIndex++) {
        const first = geometry[firstIndex];
        const second = geometry[secondIndex];
        if (first.pageIndex === second.pageIndex && rectanglesOverlap(first, second)) {
          diagnostics.push({
            severity: 'warning',
            code: 'controls_overlap',
            controls: [first.control.number, second.control.number],
            message: `${first.control.number} overlaps ${second.control.number}.`
          });
        }
      }
    }
  });
  return diagnostics;
}

export function inspectAiDocProject(projectValue) {
  const project = normalizeAiDocProject(projectValue);
  return {
    schema: project.schema,
    schemaVersion: project.schemaVersion,
    projectId: project.projectId,
    title: project.title,
    locale: project.locale,
    revision: project.revision,
    pages: project.pages.map((page, pageIndex) => ({
      page: pageIndex + 1,
      id: page.id,
      controls: page.controls.map((control, index) => ({
        index: index + 1,
        id: control.id,
        number: control.number,
        type: control.type,
        text: control.text,
        assetId: control.assetId || null,
        locked: control.locked,
        layoutMode: control.layoutMode,
        box: { x: control.x, y: control.y, w: control.w, h: control.h },
        typography: { fontSize: control.fontSize, bold: control.bold, align: control.align },
        style: deepClone(control.style)
      }))
    })),
    assets: project.assets.map(asset => ({ ...asset })),
    diagnostics: validateAiDocProject(project)
  };
}
