const PDF_EDITOR_COMPONENT_TYPES = new Set([
  'text',
  'inserted-text',
  'inserted-image',
  'inserted-shape'
]);

function componentIndex(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function compactPdfEditorComponent(component) {
  if (!component || !PDF_EDITOR_COMPONENT_TYPES.has(component.type)) return null;
  const pageId = String(component.pageId || '');
  const key = String(component.key || '');
  if (!pageId || !key) return null;

  const locator = { type: component.type, pageId, key };
  if (component.type === 'text') {
    const keyParts = key.split(':');
    const lineIndex = componentIndex(component.lineIndex ?? keyParts.at(-2));
    const segmentIndex = componentIndex(component.segmentIndex ?? keyParts.at(-1));
    if (lineIndex === null || segmentIndex === null) return null;
    if (key !== `${pageId}:${lineIndex}:${segmentIndex}`) return null;
    locator.lineIndex = lineIndex;
    locator.segmentIndex = segmentIndex;
  }
  return locator;
}

export function pdfEditorPageIdsInDocumentOrder(pages, selectedIds, currentId = null) {
  const selected = selectedIds instanceof Set
    ? selectedIds
    : new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const ordered = (Array.isArray(pages) ? pages : [])
    .map(page => page?.id)
    .filter(id => id && selected.has(id));
  if (ordered.length) return ordered;

  const fallback = (Array.isArray(pages) ? pages : []).find(page => page?.id === currentId);
  return fallback ? [fallback.id] : [];
}

export function pdfEditorSnapshotsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  // Selection, zoom and insertion mode do not change the exported document.
  const content = ({ selectedIds, currentId, selectionAnchorId, editMode, componentMode,
    selectedComponent, viewMode, zoomPercent, idCounter, ...value }) => ({ ...value,
      ...(Array.isArray(value.pages) ? { pages: value.pages.map(({ sourceRotation, ...page }) => page) } : {}) });
  return JSON.stringify(content(left)) === JSON.stringify(content(right));
}
