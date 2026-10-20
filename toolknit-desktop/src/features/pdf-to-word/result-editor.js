// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { createSnapshotHistory } from '../../shared/snapshot-history.js';
import { applyResultEdits, resultTargets, layoutEditedText, editedTextRect } from './core/result-edit.js';
import { measureResultText } from './result-preview.js';
import { wordError } from './core/input.js';
import { readColorExtractorImageDimensions } from '../../color-extractor-core.js';

export function createWordResultEditor({ overlay, byId, tr, enabled, pageNumber, changed, report }) {
  const scope = createLifecycleScope(), context = document.createElement('canvas').getContext('2d');
  let baseline = null, edits = {}, derived = null, selected = null, revision = 0, saved = '{}', loadingImage = false;
  const assets = new Map(), targetCache = new Map();
  const targetsFor = page => {
    if (!page) return [];
    if (!targetCache.has(page.number)) targetCache.set(page.number, resultTargets(page));
    return targetCache.get(page.number);
  };
  const refresh = () => {
    byId('Undo').disabled = !enabled() || !history.canUndo();
    byId('Redo').disabled = !enabled() || !history.canRedo();
    byId('Reset').disabled = !enabled() || !Object.keys(edits).length;
  };
  const history = createSnapshotHistory({ capture: () => structuredClone(edits),
    apply: value => { edits = structuredClone(value); derived = null; revision++; selected = null; changed(); },
    equals: (left, right) => JSON.stringify(left) === JSON.stringify(right), onChange: refresh,
    limit: 30, measure: value => JSON.stringify(value).length * 2, maxBytes: 2 * 1024 * 1024 });
  const modal = createModalSession({ root: byId('EditOverlay'), background: overlay, initialFocus: byId('EditText'), onClose: () => modal.close() });
  const documentValue = () => baseline ? derived ||= applyResultEdits(baseline, edits) : null;
  const target = () => targetsFor(baseline?.pages.find(page => page.number === pageNumber())).find(value => value.key === selected);
  function commit(key, value) {
    const next = { ...edits, [key]: value };
    const checked = applyResultEdits(baseline, next);
    edits = next; derived = checked; revision++; history.commit(); changed();
  }
  function render() {
    const root = byId('Regions'); root.replaceChildren();
    const currentPage = baseline?.pages.find(page => page.number === pageNumber());
    const show = Boolean(currentPage && enabled() && byId('Structure').getAttribute('aria-pressed') === 'true');
    if (!show) selected = null;
    if (show) {
      const targets = [...targetsFor(currentPage)].sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text') || b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      for (const item of targets) {
        if (edits[item.key]?.type === 'delete') continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'pdf-word-region'; button.dataset.key = item.key; button.dataset.type = item.type;
        const r = editedTextRect(item, edits[item.key]);
        Object.assign(button.style, { left: r.x / currentPage.width * 100 + '%', top: r.y / currentPage.height * 100 + '%', width: r.width / currentPage.width * 100 + '%', height: r.height / currentPage.height * 100 + '%' });
        button.setAttribute('aria-label', tr(item.type === 'text' ? 'textRegion' : 'imageRegion'));
        button.setAttribute('aria-pressed', String(item.key === selected)); root.append(button);
      }
    }
    const value = target();
    byId('Selection').hidden = !show || !value || edits[selected]?.type === 'delete';
    byId('SelectionType').textContent = value ? tr(value.type === 'text' ? 'textRegion' : 'imageRegion') : '';
    byId('Edit').hidden = value?.type !== 'text'; byId('Replace').hidden = value?.type !== 'image';
    refresh();
  }
  function openEdit() {
    const value = target(); if (!enabled() || value?.type !== 'text') return;
    byId('EditText').value = edits[selected]?.text ?? value.text;
    byId('EditError').textContent = ''; modal.open();
  }
  function remove() {
    if (!enabled() || !target()) return;
    try { commit(selected, { type: 'delete' }); selected = null; render(); } catch (error) { report(error); }
  }
  scope.event(byId('Regions'), 'click', event => {
    const button = event.target.closest('[data-key]'); if (!enabled() || !button) return;
    selected = button.dataset.key; render();
  });
  scope.event(byId('Regions'), 'dblclick', event => {
    const button = event.target.closest('[data-key]'); if (!button || !enabled()) return;
    selected = button.dataset.key; openEdit();
  });
  scope.event(byId('Edit'), 'click', openEdit);
  scope.event(byId('Delete'), 'click', remove);
  scope.event(byId('Deselect'), 'click', () => { selected = null; render(); });
  scope.event(byId('EditCancel'), 'click', () => modal.close());
  scope.event(byId('EditForm'), 'submit', event => {
    event.preventDefault();
    if (!baseline || !target()) return;
    try {
      const value = layoutEditedText(target(), byId('EditText').value,
        (text, style) => measureResultText(text, style, context),
        { page: baseline.pages.find(page => page.number === pageNumber()), edits });
      commit(selected, value); modal.close(); render();
    } catch (error) { byId('EditError').textContent = tr('error.' + (error?.code || 'edit-text')); }
  });
  scope.event(byId('Replace'), 'click', () => { if (enabled() && !loadingImage) byId('ImageInput').click(); });
  scope.event(byId('ImageInput'), 'change', async () => {
    const file = byId('ImageInput').files?.[0]; byId('ImageInput').value = '';
    const value = target(), epoch = revision;
    if (!file || !enabled() || value?.type !== 'image' || loadingImage) return;
    loadingImage = true; byId('Replace').disabled = true; changed();
    let bitmap;
    try {
      if (file.size <= 0 || file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) throw wordError('edit-image');
      const input = new Uint8Array(await file.arrayBuffer());
      const dimensions = readColorExtractorImageDimensions(input);
      if (!dimensions || !(input[0] === 0x89 && input[1] === 0x50 || input[0] === 0xff && input[1] === 0xd8)
        || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192 || dimensions.height > 8192
        || dimensions.width * dimensions.height > 16000000) throw wordError('edit-image');
      if (epoch !== revision || !enabled()) return;
      bitmap = await createImageBitmap(file);
      if (epoch !== revision || !enabled()) return;
      if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16000000) throw wordError('edit-image');
      const canvas = document.createElement('canvas');
      const ratio = Math.min(2, 2048 / Math.max(value.rect.width, value.rect.height));
      canvas.width = Math.max(1, Math.ceil(value.rect.width * ratio)); canvas.height = Math.max(1, Math.ceil(value.rect.height * ratio));
      const fit = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (canvas.width - bitmap.width * fit) / 2, (canvas.height - bitmap.height * fit) / 2, bitmap.width * fit, bitmap.height * fit);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 0;
      if (!blob) throw wordError('image');
      const bytes = new Uint8Array(await blob.arrayBuffer()); if (epoch !== revision || !enabled()) return;
      if (bytes.length + [...assets.values()].reduce((sum, asset) => sum + asset.bytes.length, 0) > 24 * 1024 * 1024) throw wordError('edit-image');
      const id = 'word-edit-' + crypto.randomUUID();
      assets.set(id, { id, bytes, format: 'png' }); commit(value.key, { type: 'image', assetId: id }); render();
    } catch (error) { if (epoch === revision) report(error); }
    finally { bitmap?.close(); loadingImage = false; byId('Replace').disabled = false; changed(); }
  });
  scope.event(byId('Undo'), 'click', () => { if (enabled()) history.undo(); });
  scope.event(byId('Redo'), 'click', () => { if (enabled()) history.redo(); });
  scope.event(document, 'keydown', event => {
    if (!enabled() || overlay.inert || event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopImmediatePropagation();
      (event.key.toLowerCase() === 'y' || event.shiftKey ? history.redo : history.undo)();
    } else if (selected && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); remove(); }
    else if (selected && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); selected = null; render(); }
  }, true);
  return {
    document: documentValue, render,
    get dirty() { return Object.keys(edits).length > 0; },
    get unsaved() { return JSON.stringify(edits) !== saved; },
    get busy() { return loadingImage; },
    get baseline() { return baseline; },
    get assets() { return assets; },
    editedAssets() { return [...new Set(Object.values(edits).filter(edit => edit.type === 'image').map(edit => edit.assetId))].map(id => assets.get(id)); },
    markSaved() { saved = JSON.stringify(edits); },
    reset() { edits = {}; derived = null; selected = null; revision++; history.commit(); changed(); },
    setBaseline(value) { baseline = value; edits = {}; derived = null; selected = null; revision++; saved = '{}'; assets.clear(); targetCache.clear(); history.reset(); render(); },
    clear() { modal.close({ restore: false }); baseline = derived = null; edits = {}; selected = null; revision++; saved = '{}'; assets.clear(); targetCache.clear(); history.clear(); render(); },
    dispose() { modal.dispose(); scope.dispose(); assets.clear(); }
  };
}
