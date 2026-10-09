import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compactPdfEditorComponent,
  pdfEditorPageIdsInDocumentOrder,
  pdfEditorSnapshotsEqual
} from '../src/pdf-editor-state.js';
import { createPdfEditorStateController } from '../src/features/pdf-editor/state.js';

const imageBytes = new Uint8Array([10, 20, 30, 40]);
const imageLocator = compactPdfEditorComponent({
  type: 'inserted-image',
  pageId: 'page-2',
  key: 'image-9',
  object: {
    bytes: imageBytes,
    previewUrl: 'blob:large-image',
    width: 320,
    height: 180
  }
});
assert.deepEqual(imageLocator, {
  type: 'inserted-image',
  pageId: 'page-2',
  key: 'image-9'
});
assert.equal('object' in imageLocator, false);
assert.equal('bytes' in imageLocator, false);

const textLocator = compactPdfEditorComponent({
  type: 'text',
  pageId: 'page-4',
  key: 'page-4:7:2',
  segment: { text: 'large source segment' }
});
assert.deepEqual(textLocator, {
  type: 'text',
  pageId: 'page-4',
  key: 'page-4:7:2',
  lineIndex: 7,
  segmentIndex: 2
});
assert.equal(compactPdfEditorComponent({ type: 'unknown', pageId: 'page-1', key: 'x' }), null);
assert.equal(compactPdfEditorComponent({ type: 'text', pageId: 'page-1', key: 'invalid' }), null);
assert.equal(compactPdfEditorComponent({
  type: 'text',
  pageId: 'page-1',
  key: 'page-1:2:3',
  lineIndex: 2,
  segmentIndex: 4
}), null);

const pages = [{ id: 'page-1' }, { id: 'page-2' }, { id: 'page-3' }];
assert.deepEqual(
  pdfEditorPageIdsInDocumentOrder(pages, new Set(['page-3', 'page-1']), 'page-2'),
  ['page-1', 'page-3']
);
assert.deepEqual(pdfEditorPageIdsInDocumentOrder(pages, new Set(), 'page-2'), ['page-2']);
assert.deepEqual(pdfEditorPageIdsInDocumentOrder(pages, new Set(['stale']), 'page-2'), ['page-2']);
assert.deepEqual(pdfEditorPageIdsInDocumentOrder(pages, new Set(), 'missing'), []);

const cleanSnapshot = { pages: [{ id: 'page-1', rotation: 0 }], edits: [] };
assert.equal(pdfEditorSnapshotsEqual(cleanSnapshot, structuredClone(cleanSnapshot)), true);
assert.equal(pdfEditorSnapshotsEqual(cleanSnapshot, {
  pages: [{ id: 'page-1', rotation: 90 }],
  edits: []
}), false);
assert.equal(pdfEditorSnapshotsEqual(null, cleanSnapshot), false);

const state = {
  sources: [{ id: 'source-1', name: 'sample.pdf' }],
  sourceStore: new Map([['source-1', { id: 'source-1', name: 'sample.pdf' }]]),
  pages: [{ id: 'page-1', sourceRotation: 90, rotation: 0 }],
  selectedIds: new Set(['page-1']),
  currentId: 'page-1',
  selectionAnchorId: 'page-1',
  editMode: true,
  componentMode: true,
  selectedComponent: { type: 'text', pageId: 'page-1', key: 'page-1:0:0' },
  zoom: { viewMode: 'manual', zoomPercent: 125 },
  idCounter: 4,
  textEdits: new Map(),
  insertedTexts: [{ id: 'text-1', pageId: 'page-1', text: 'hello' }],
  insertedImages: [],
  insertedShapes: []
};
const textLinesCache = new Map([[
  'page-1',
  { lines: [{ segments: [{ text: 'source text', fontSize: 12 }] }] }
]]);
let lockCalls = 0;
let zoomState = { ...state.zoom };
const controller = createPdfEditorStateController({
  getSources: () => state.sources,
  setSources: value => { state.sources = value; },
  getSourceStore: () => state.sourceStore,
  getPages: () => state.pages,
  setPages: value => { state.pages = value; },
  getSelectedIds: () => state.selectedIds,
  setSelectedIds: value => { state.selectedIds = value; },
  getCurrentId: () => state.currentId,
  setCurrentId: value => { state.currentId = value; },
  getSelectionAnchorId: () => state.selectionAnchorId,
  setSelectionAnchorId: value => { state.selectionAnchorId = value; },
  getEditMode: () => state.editMode,
  setEditMode: value => { state.editMode = value; },
  getComponentMode: () => state.componentMode,
  setComponentMode: value => { state.componentMode = value; },
  getSelectedComponent: () => state.selectedComponent,
  setSelectedComponent: value => { state.selectedComponent = value; },
  getZoom: () => ({
    getState: () => zoomState,
    setState: value => { zoomState = { viewMode: value.viewMode, zoomPercent: value.zoomPercent }; }
  }),
  getIdCounter: () => state.idCounter,
  setIdCounter: value => { state.idCounter = value; },
  getTextEdits: () => state.textEdits,
  setTextEdits: value => { state.textEdits = value; },
  getInsertedTexts: () => state.insertedTexts,
  setInsertedTexts: value => { state.insertedTexts = value; },
  getInsertedImages: () => state.insertedImages,
  setInsertedImages: value => { state.insertedImages = value; },
  getInsertedImageStore: () => new Map(),
  getInsertedShapes: () => state.insertedShapes,
  setInsertedShapes: value => { state.insertedShapes = value; },
  getTextLinesCache: () => textLinesCache,
  compactComponent: compactPdfEditorComponent,
  hasDocument: () => true,
  getSavedSnapshot: () => null,
  getHistory: () => ({ withLock(callback) { lockCalls += 1; return callback(); } })
});
const captured = controller.captureEditorSnapshot();
assert.equal(captured.pages[0].sourceRotation, undefined, 'snapshots must omit derived source rotation');
assert.deepEqual(captured.sourceIds, ['source-1']);
assert.deepEqual(captured.selectedComponent, {
  type: 'text', pageId: 'page-1', key: 'page-1:0:0', lineIndex: 0, segmentIndex: 0
});
state.pages = [{ id: 'page-2', rotation: 180 }];
state.selectedIds = new Set();
state.currentId = null;
state.selectedComponent = null;
controller.applyEditorSnapshot(captured);
assert.equal(lockCalls, 1, 'snapshot application must lock history commits');
assert.deepEqual(state.pages, [{ id: 'page-1', rotation: 0 }]);
assert.deepEqual([...state.selectedIds], ['page-1']);
assert.equal(state.currentId, 'page-1');
assert.equal(state.selectedComponent.segment.text, 'source text');
assert.deepEqual(zoomState, { viewMode: 'manual', zoomPercent: 125 });

const uiSource = await readFile(new URL('../src/features/pdf-editor/controller.js', import.meta.url), 'utf8');
const templateSource = await readFile(new URL('../src/features/pdf-editor/template.html', import.meta.url), 'utf8');
const compatibilitySource = await readFile(new URL('../src/pdf-editor-ui.js', import.meta.url), 'utf8');
const stateControllerSource = await readFile(
  new URL('../src/features/pdf-editor/state.js', import.meta.url),
  'utf8'
);
const exporterSource = await readFile(new URL('../src/features/pdf-editor/exporter.js', import.meta.url), 'utf8');
const textLayoutSource = await readFile(new URL('../src/features/pdf-editor/text-layout.js', import.meta.url), 'utf8');
const componentRendererSource = await readFile(
  new URL('../src/features/pdf-editor/component-renderer.js', import.meta.url),
  'utf8'
);
const componentControlsSource = await readFile(
  new URL('../src/features/pdf-editor/component-controls.js', import.meta.url),
  'utf8'
);
const insertAssetsSource = await readFile(
  new URL('../src/features/pdf-editor/insert-assets.js', import.meta.url),
  'utf8'
);
const componentInteractionSource = await readFile(
  new URL('../src/features/pdf-editor/component-interaction.js', import.meta.url),
  'utf8'
);
const contentEditingSource = await readFile(
  new URL('../src/features/pdf-editor/content-editing.js', import.meta.url),
  'utf8'
);
const pageOperationsSource = await readFile(
  new URL('../src/features/pdf-editor/page-operations.js', import.meta.url),
  'utf8'
);
const pageSelectionSource = await readFile(
  new URL('../src/features/pdf-editor/page-selection.js', import.meta.url),
  'utf8'
);
const fileSessionSource = await readFile(
  new URL('../src/features/pdf-editor/file-session.js', import.meta.url),
  'utf8'
);
const viewSource = await readFile(
  new URL('../src/features/pdf-editor/view.js', import.meta.url),
  'utf8'
);
const operationSource = await readFile(
  new URL('../src/features/pdf-editor/operation.js', import.meta.url),
  'utf8'
);
const eventsSource = await readFile(
  new URL('../src/features/pdf-editor/events.js', import.meta.url),
  'utf8'
);
const controlsSource = await readFile(
  new URL('../src/features/pdf-editor/controls.js', import.meta.url),
  'utf8'
);

assert.match(stateControllerSource, /function captureEditorSnapshot\(\)/);
assert.match(stateControllerSource, /selectedComponent:\s*compactComponent\(getSelectedComponent\(\)\)/);
assert.match(stateControllerSource, /sourceRotation:\s*_sourceRotation/);
assert.match(stateControllerSource, /function applyEditorSnapshot\(snapshot\)/);
assert.match(stateControllerSource, /setSelectedComponent\(restoreSelectedComponent\(snapshot\.selectedComponent\)\)/);
assert.match(stateControllerSource, /URL\.revokeObjectURL\(image\.previewUrl\)/);
assert.match(stateControllerSource, /URL\.createObjectURL\(new Blob/);
assert.match(stateControllerSource, /if \(history\?\.withLock\) history\.withLock\(apply\); else apply\(\);/);
assert.match(uiSource, /import \{ createPdfEditorStateController \} from '\.\/state\.js';/);
assert.match(uiSource, /pdfEditorState = createPdfEditorStateController\(/);
assert.match(uiSource, /return pdfEditorState\?\.captureEditorSnapshot\?\.\(\) \|\| null/);
assert.match(uiSource, /return pdfEditorState\?\.applyEditorSnapshot\(snapshot\)/);
assert.doesNotMatch(uiSource, /selectedComponent:\s*compactPdfEditorComponent\(selectedComponent\)/);
assert.doesNotMatch(uiSource, /sourceRotation:\s*_sourceRotation/);
assert.match(compatibilitySource, /from ['"]\.\/features\/pdf-editor\/controller\.js['"]/);
assert.match(uiSource, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(uiSource, /@tauri-apps\//);
assert.doesNotMatch(fileSessionSource, /@tauri-apps\//);
assert.doesNotMatch(eventsSource, /@tauri-apps\//);

const appendStart = fileSessionSource.indexOf('async function appendPdfBytes(');
const appendEnd = fileSessionSource.indexOf('function chooseMainFile()', appendStart);
const appendSource = fileSessionSource.slice(appendStart, appendEnd);
const limitCheckIndex = appendSource.indexOf('assertPdfEditorMergeSelection(');
const sourceMutationIndex = appendSource.indexOf('sources.push(source)');
assert.ok(limitCheckIndex >= 0, 'append must enforce total PDF editor limits');
assert.ok(sourceMutationIndex > limitCheckIndex, 'append limits must be checked before editor state changes');

const loadStart = fileSessionSource.indexOf('async function loadMainFile(');
const loadEnd = fileSessionSource.indexOf('async function appendPdfBytes(', loadStart);
const loadSource = fileSessionSource.slice(loadStart, loadEnd);
const stagedLoadIndex = loadSource.indexOf('const loaded = await documents.loadBytes(bytes');
const stagedDocumentIndex = loadSource.indexOf('stagedDocument = loaded.document');
const resetDocumentIndex = loadSource.indexOf('await resetDocument()');
assert.ok(stagedLoadIndex >= 0, 'replacement PDF must be opened before it is committed');
assert.ok(stagedDocumentIndex > stagedLoadIndex, 'replacement loading must yield a validated staged document');
assert.ok(resetDocumentIndex > stagedDocumentIndex, 'the current document must survive replacement validation failures');
assert.match(loadSource, /if \(documentCommitted\) await resetDocument\(\)/);
assert.match(viewSource, /confirmDiscardChanges\('close'\)/);
assert.match(uiSource, /return pdfEditorView\?\.closeOverlay\(\)/);
assert.match(operationSource, /function beginOperation\(type\)/);
assert.match(operationSource, /function cancelActiveOperation\(\)/);
assert.doesNotMatch(uiSource, /let activeOperation = null/);
assert.match(eventsSource, /onDragDropEvent/);
assert.match(eventsSource, /function createPdfEditorEvents/);
assert.match(uiSource, /pdfEditorEvents = createPdfEditorEvents\(/);
assert.match(controlsSource, /function updateControls\(\)/);
assert.match(uiSource, /pdfEditorControls = createPdfEditorControls\(/);
assert.match(fileSessionSource, /confirmDiscardChanges\('replace'\)/);
assert.match(uiSource, /confirmDiscardChanges\('reset'\)/);
assert.match(uiSource, /savedSnapshot = captureEditorSnapshot\(\)/);

assert.match(componentControlsSource, /\['text', 'inserted-text'\]\.includes\(selectedComponent\?\.type\)/);
assert.match(componentControlsSource, /function positionComponentMenu\(\)/);
assert.match(componentControlsSource, /function syncShapePanel\(\)/);
assert.match(componentControlsSource, /function appendResizeHandles\(container, component, pageId, object\)/);
assert.doesNotMatch(uiSource, /componentMenu\.hidden = !visible;/);
assert.doesNotMatch(uiSource, /const xmlns = 'http:\/\/www\.w3\.org\/2000\/svg';/);
assert.match(uiSource, /openEditModal\(object\.id, object, object, 'edit-inserted-text'\)/);
assert.match(templateSource, /id="pdfEditorEditText"/);
assert.match(componentRendererSource, /if \(editMode\) \{\s*openEditModal\(key, segmentData, segmentData\);/);
assert.match(uiSource, /event\.key === 'Enter' \|\| event\.key === 'F2'/);
assert.match(contentEditingSource, /modalMode === 'edit-inserted-text'/);
assert.match(contentEditingSource, /setInsertedShapes\(insertedShapes\)/);
assert.match(uiSource, /return pageOperations\?\.rotateSelected\(delta\)/);
assert.match(uiSource, /return pageOperations\?\.deleteSelected\(\)/);
assert.match(pageOperationsSource, /function duplicateSelectedPages\(\)/);
assert.match(pageOperationsSource, /insertedImageStore\.delete\(selectedComponent\.key\)/);
assert.match(uiSource, /return pageSelection\?\.selectRange\(pageState\)/);
assert.match(pageSelectionSource, /pdfEditorPageIdsInDocumentOrder/);
assert.match(pageSelectionSource, /function invertPageSelection\(\)/);
assert.match(exporterSource, /textBox: getEditedTextVisualBox\(edit, edit\.segment\)/);
assert.match(uiSource, /componentRenderer\.render\(lines, cssViewport, scale, pageId\)/);
assert.match(componentRendererSource, /Number\(segmentData\.rotation\) \|\| 0/);
assert.match(componentRendererSource, /function ensureTextMask\(/);
assert.match(componentRendererSource, /dataset\?\.maskKey === `\$\{key\}:rotated`/);
assert.match(componentRendererSource, /pdf-editor-inserted-image-wrap/);
assert.match(componentRendererSource, /pdf-editor-inserted-shape/);
assert.doesNotMatch(uiSource, /textLayer\.replaceChildren\(\)/);
assert.match(textLayoutSource, /export function editedTextVisualBox\(edit, segment\)/);
assert.match(textLayoutSource, /export function insertedTextVisualBox\(object\)/);
assert.match(textLayoutSource, /estimateInsertedTextWidth\(object\?\.text, fontSize\)/);
assert.doesNotMatch(uiSource, /function editedTextVisualBox\(edit, segment\)/);
assert.doesNotMatch(uiSource, /function insertedTextVisualBox\(object\)/);
assert.match(contentEditingSource, /IMAGE_BATCH_LIMITS\.maxBytesPerFile/);
assert.match(insertAssetsSource, /limits\.maxPixelsPerFile/);
assert.match(insertAssetsSource, /export function readEncodedImageDimensions\(bytes, mimeType\)/);
assert.match(insertAssetsSource, /export function assertImagePixelLimit\(dimensions/);
assert.match(insertAssetsSource, /export async function readImageDimensions\(bytes, mimeType/);
assert.doesNotMatch(uiSource, /function readEncodedImageDimensions\(bytes, mimeType\)/);
assert.match(componentInteractionSource, /function beginComponentDrag\(event, component\)/);
assert.match(componentInteractionSource, /function beginComponentResize\(event, component, handle = 'se'\)/);
assert.match(componentInteractionSource, /function beginComponentRotate\(event\)/);
assert.match(componentInteractionSource, /function reset\(\)/);
assert.doesNotMatch(uiSource, /function beginComponentDrag\(event, component\)\s*\{\s*if \(!componentMode/);
const imagePrepareStart = contentEditingSource.indexOf('async function prepareInsertImage(');
const imagePrepareEnd = contentEditingSource.indexOf('function saveEditModal(', imagePrepareStart);
const imagePrepareSource = contentEditingSource.slice(imagePrepareStart, imagePrepareEnd);
assert.ok(imagePrepareStart >= 0 && imagePrepareEnd > imagePrepareStart);
assert.ok(
  imagePrepareSource.indexOf('readEncodedImageDimensions(bytes, mimeType)')
    < imagePrepareSource.indexOf('await readImageDimensions(bytes, mimeType)'),
  'encoded image dimensions must be checked before browser decoding'
);
assert.match(componentRendererSource, /segmentElement\.style\.transformOrigin = '50% 50%'/);

const editModeStart = contentEditingSource.indexOf('function setEditMode(');
const editModeEnd = contentEditingSource.indexOf('function openEditModal(', editModeStart);
const editModeSource = contentEditingSource.slice(editModeStart, editModeEnd);
assert.ok(editModeStart >= 0 && editModeEnd > editModeStart);
assert.match(editModeSource, /if \(!page \|\| !pageSupportsContentEditing\(page\)\)/);
assert.doesNotMatch(editModeSource, /page\?\.rotation/);

console.log('PDF editor state and source contract regression checks passed');
