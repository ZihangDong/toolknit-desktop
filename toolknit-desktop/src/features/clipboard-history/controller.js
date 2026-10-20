import { applyTranslations, getLang, onLangChange, t } from '../../i18n.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { bindToolPageChrome, moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { enhanceToolSelect } from '../../tool-custom-select.js';
import { createClipboardRuntime } from '../../platform/clipboard-runtime.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { DEFAULT_SETTINGS, dateRange, dayLabel, timeLabel, sizeLabel, normalizeExcludedApps, validateSettings, errorKey } from './core.js';

export function createClipboardHistoryController({ overlay, isTauri = false, clipboardRuntime, refreshIcons = () => {}, notify = () => {}, getOutputDir = async () => '' } = {}) {
  const runtime = clipboardRuntime || createClipboardRuntime({ isTauri });
  const documentRef = overlay.ownerDocument;
  const q = id => documentRef.getElementById(`clipboard${id}`);
  const tr = (key, values) => t(`home.clipboardHistory.${key}`, values);
  const lifecycle = createLifecycleScope();
  let session = null, disposed = false, queryRevision = 0, detailRevision = 0, statusRevision = 0;
  let status = { enabled: false, total: 0, today: 0, bytes: 0, settings: { ...DEFAULT_SETTINGS }, captured: 0, skipped: 0, failed: 0 };
  let entries = [], detail = null, next = null, snapshot = null, favorites = false, batch = false, loading = false;
  let selected = new Set(), busy = false, selectControls = [], newCount = 0, searchTimer = null, eventTimer = null;
  let returnFocus = null, dialogAction = null, dialogKind = '', dialogBusy = false;
  const dialog = q('HistoryDialog');
  const modal = createModalSession({ root: dialog, background: overlay, initialFocus: q('DialogCancel'), onClose: closeDialog, canClose: () => !dialogBusy });
  const current = owner => owner && session === owner && !owner.disposed && !disposed;
  const node = (tag, className, text) => { const value = documentRef.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; };
  const icon = name => { const value = node('i'); value.dataset.lucide = name; value.setAttribute('aria-hidden', 'true'); return value; };
  const kindKey = kind => ({ text: 'typeText', image: 'typeImage', files: 'typeFiles' })[kind] || 'typeText';
  function showError(error) { q('Error').textContent = tr(errorKey(error)); q('Error').hidden = false; q('Restart').hidden = !['keyMissing','keyInvalid','keyUnavailable','keyMismatch'].includes(errorKey(error)); }
  function clearError() { q('Error').hidden = true; q('Error').textContent = ''; q('Restart').hidden = true; }

  function renderStatus() {
    q('MonitorStatus').textContent = tr(!runtime.available ? 'desktopBadge' : status.enabled ? 'recording' : 'paused');
    q('Toggle').setAttribute('aria-checked', String(status.enabled)); q('Toggle').disabled = busy || !runtime.available;
    q('Started').textContent = status.startedAt ? tr('started', { time: timeLabel(status.startedAt, getLang()) }) : tr('startHint');
    q('Today').textContent = String(status.today); q('Total').textContent = String(status.total); q('Storage').textContent = sizeLabel(status.bytes);
    q('Health').textContent = tr('health', { captured: status.captured, skipped: status.skipped, failed: status.failed });
    for (const [id, field] of [['Text', 'text'], ['Images', 'images'], ['Files', 'files']]) { q(id).checked = status.settings[field]; q(id).disabled = busy || !runtime.available; }
    q('Settings').disabled = busy || !runtime.available; q('Clear').disabled = busy || !runtime.available || !status.total;
    if (status.lastError) showError(status.lastError);
    renderEmpty();
  }
  function renderEmpty() {
    const filtered = Boolean(q('Search').value || q('Kind').value || q('Date').value || favorites);
    const key = !runtime.available ? 'desktopOnly' : loading ? 'loading' : filtered ? 'noMatches' : status.enabled ? 'waiting' : 'empty';
    q('Empty').hidden = entries.length > 0;
    q('EmptyTitle').textContent = tr(`${key}Title`); q('EmptyDescription').textContent = tr(`${key}Description`);
    q('DetailEmpty').hidden = Boolean(detail); q('DetailContent').hidden = !detail;
  }
  function renderList() {
    const list = q('List'), position = list.parentElement.scrollTop;
    list.replaceChildren(); let day = '';
    for (const entry of entries) {
      const label = dayLabel(entry.capturedAt, getLang());
      if (label !== day) { list.append(node('h3', 'clipboard-day', label)); day = label; }
      const row = node('div', 'clipboard-row'); row.classList.toggle('is-selected', entry.id === detail?.id);
      if (batch) {
        const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(entry.id); checkbox.dataset.selectId = entry.id; checkbox.setAttribute('aria-label', tr('selectItem', { time: timeLabel(entry.capturedAt, getLang()) })); row.append(checkbox);
      }
      const button = node('button', 'clipboard-entry'); button.type = 'button'; button.dataset.entryId = entry.id; button.setAttribute('aria-pressed', String(entry.id === detail?.id));
      const visual = node('span', 'clipboard-entry-visual');
      if (entry.thumbnail?.startsWith('data:image/png;base64,')) { const image = node('img'); image.src = entry.thumbnail; image.alt = tr('typeImage'); image.loading = 'lazy'; visual.append(image); }
      else visual.append(icon({ text: 'text', image: 'image', files: 'files' }[entry.kind] || 'clipboard'));
      const copy = node('span', 'clipboard-entry-copy');
      const heading = node('span', 'clipboard-entry-heading'); heading.append(node('time', '', timeLabel(entry.capturedAt, getLang())), node('span', 'clipboard-muted', tr(kindKey(entry.kind))));
      if (entry.favorite) heading.append(icon('star'));
      copy.append(heading, node('span', 'clipboard-entry-preview', entry.kind === 'image' ? `${entry.width} × ${entry.height}` : entry.preview), node('span', 'clipboard-entry-source', `${entry.source || tr('unknownSource')} · ${sizeLabel(entry.bytes)}`));
      if(entry.note)copy.append(node('span','clipboard-entry-preview',entry.note));
      button.append(visual, copy); row.append(button); list.append(row);
    }
    list.parentElement.scrollTop = position; q('More').hidden = !next; q('More').disabled = loading;
    q('BatchBar').hidden = !batch; q('SelectionCount').textContent = tr('selectedCount', { count: selected.size });
    q('SelectAll').checked = entries.length > 0 && entries.every(entry => selected.has(entry.id));
    q('SelectAll').indeterminate = selected.size > 0 && !q('SelectAll').checked;
    q('DeleteSelected').disabled = !selected.size || busy;
    q('New').hidden = !newCount; q('New').textContent = tr('newRecords', { count: newCount });
    renderEmpty(); refreshIcons();
  }
  function renderDetail() {
    renderEmpty(); if (!detail) { q('Preview').replaceChildren(); q('Metadata').replaceChildren(); return; }
    q('DetailType').textContent = tr(kindKey(detail.kind));
    const values = [['recordedAt', timeLabel(detail.capturedAt, getLang(), true, detail.offsetMinutes)], ['source', detail.source || tr('unknownSource')], ['size', sizeLabel(detail.bytes)]];
    if (detail.kind === 'text') values.push(['characters', String(detail.count)]);
    if (detail.kind === 'image') values.push(['dimensions', `${detail.width} × ${detail.height}`]);
    if (detail.kind === 'files') values.push(['fileCount', String(detail.count)]);
    if (detail.usedAt) values.push(['usedAt', timeLabel(detail.usedAt, getLang(), true)]);
    if (detail.note) values.push(['recordNote', detail.note]);
    q('Metadata').replaceChildren(...values.map(([label,value]) => { const row = node('div'); row.append(node('dt', '', tr(label)), node('dd', '', value)); return row; }));
    q('Preview').replaceChildren();
    if (detail.kind === 'text') q('Preview').append(node('pre', '', detail.text || ''));
    if (detail.kind === 'image' && detail.image?.startsWith('data:image/png;base64,')) { const image = node('img'); image.src = detail.image; image.alt = tr('typeImage'); q('Preview').append(image); }
    if (detail.kind === 'files') { const list = node('ul'); for (const path of detail.paths) list.append(node('li', '', path)); q('Preview').append(list); }
    q('DetailNote').textContent = detail.rich ? tr('richNote') : detail.kind === 'files' ? tr('filesNote') : '';
    for (const id of ['SaveImage', 'Zoom', 'OpenPinned']) { q(id).hidden = detail.kind !== 'image'; q(id).disabled = busy; }
    q('CopyPaths').hidden = detail.kind !== 'files'; q('Copy').disabled = busy;
    q('Favorite').setAttribute('aria-pressed', String(detail.favorite));
    q('Favorite').querySelector('span').textContent = tr(detail.favorite ? 'unfavorite' : 'favorite');
    q('Favorite').title = tr(detail.favorite ? 'unfavorite' : 'favorite'); refreshIcons();
  }
  async function refreshStatus(owner = session) {
    const revision = ++statusRevision;
    const value = await runtime.request({ action: 'status' });
    if (!current(owner) || revision !== statusRevision) return;
    const previous = status.latestId || 0; status = value;
    if (entries.length && status.latestId > previous) { newCount += status.latestId - previous; q('New').hidden = false; q('New').textContent = tr('newRecords', { count: newCount }); }
    renderStatus();
  }
  async function loadList(append = false) {
    const owner = session, revision = ++queryRevision; if (!current(owner) || !runtime.available) return;
    loading = true; renderEmpty();
    try {
      const query = { search: q('Search').value.trim(), kind: q('Kind').value, favorites, ...dateRange(q('Date').value), ...(append ? { before: next, snapshot } : {}) };
      const page = await runtime.request({ action: 'list', query });
      if (!current(owner) || revision !== queryRevision) return;
      entries = append ? [...entries, ...page.items] : page.items; next = page.next; snapshot = page.snapshot;
      if (!append) { selected.clear(); newCount = 0; q('List').parentElement.scrollTop = 0; }
    } catch (error) { if (current(owner) && revision === queryRevision && !String(error).includes('cancelled')) showError(error); }
    finally { if (current(owner) && revision === queryRevision) { loading = false; renderList(); } }
  }
  async function selectEntry(id) {
    const owner = session, revision = ++detailRevision;
    try {
      const value = await runtime.request({ action: 'detail', id });
      if (!current(owner) || revision !== detailRevision) return;
      detail = value; overlay.classList.add('has-detail'); renderList(); renderDetail();
    } catch (error) { if (current(owner) && revision === detailRevision) showError(error); }
  }
  async function mutate(request, { reload = false } = {}) {
    if (busy || !session || !runtime.available) return false;
    const owner = session; busy = true; statusRevision++; clearError(); renderStatus(); renderDetail();
    try {
      const result = await runtime.request(request);
      if (!current(owner)) return false;
      status = result; renderStatus();
      if (reload) await loadList();
      return true;
    } catch (error) { if (current(owner)) showError(error); return false; }
    finally { if (current(owner)) { busy = false; renderStatus(); renderDetail(); } }
  }
  function closeDialog() {
    if (dialogBusy) return;
    modal.close(); dialogAction = null; dialogKind = ''; dialog.classList.remove('is-image'); q('DialogBody').replaceChildren();
  }
  function openDialog(title, body, action, kind = '') {
    if (dialogBusy) return;
    closeDialog(); dialogKind = kind; q('DialogTitle').textContent = tr(title); q('DialogBody').replaceChildren(body);
    dialogAction = action; q('DialogConfirm').hidden = !action; modal.open(); refreshIcons();
  }
  function confirm(title, description, action) { openDialog(title, node('p', '', tr(description)), action); }
  function settingsDialog() {
    const body = node('div', 'clipboard-settings-fields');
    const settings = status.settings;
    for (const [key, min, max] of [['retentionDays', 1, 365], ['maxRecords', 100, 10000], ['maxMegabytes', 32, 2048]]) {
      const label = node('label'); label.append(node('span', '', tr(key)));
      const input = node('input'); input.type = 'number'; input.min = min; input.max = max; input.step = '1'; input.value = settings[key]; input.dataset.setting = key; label.append(input); body.append(label);
    }
    const excludedLabel = node('label'); excludedLabel.append(node('span', '', tr('excludedApps')));
    const excluded = node('textarea'); excluded.rows = 3; excluded.value = settings.excludedApps.join('\n'); excluded.placeholder = 'example.exe'; excluded.dataset.setting = 'excludedApps'; excludedLabel.append(excluded); body.append(excludedLabel, node('p', 'clipboard-muted', tr('settingsNote')));
    openDialog('settings', body, async () => {
      const value = { ...status.settings };
      for (const input of body.querySelectorAll('[data-setting]')) value[input.dataset.setting] = input.tagName === 'TEXTAREA' ? normalizeExcludedApps(input.value) : Number(input.value);
      if (!validateSettings(value)) { notify(tr('invalidSettings')); return false; }
      return mutate({ action: 'settings', settings: value }, { reload: true });
    }, 'settings');
  }
  function showImage() {
    if (!detail?.image) return;
    const body = node('div', 'clipboard-image-dialog'); const image = node('img'); image.src = detail.image; image.alt = tr('typeImage');
    const stage = node('div', 'clipboard-image-stage'); stage.append(image);
    const controls = node('div', 'clipboard-image-controls');
    const label = node('label'); label.textContent = tr('zoom'); const range = node('input'); range.type = 'range'; range.min = '25'; range.max = '200'; range.value = '100';
    range.addEventListener('input', () => { image.style.width = `${range.value}%`; image.style.maxWidth = 'none'; image.style.maxHeight = 'none'; }); label.append(range); controls.append(label); body.append(stage, controls);
    openDialog('imagePreview', body, null, 'image'); dialog.classList.add('is-image');
  }
  async function saveImage() {
    const owner = session, selectedDetail = detail; if (!selectedDetail?.image) return;
    try {
      const encoded = selectedDetail.image.split(',')[1]; const bytes = Array.from(atob(encoded), c => c.charCodeAt(0));
      const { invoke } = await tauriCorePromise; const outputDir = await getOutputDir('clipboard-history');
      if (!current(owner)) return;
      await invoke('write_unique_file_bytes', { directory: outputDir, fileName: `clipboard-${selectedDetail.id}.png`, bytes });
      if (current(owner)) notify(tr('imageSaved'));
    } catch (error) { if (current(owner)) showError(error); }
  }
  const listen = (id, event, callback) => lifecycle.event(q(id), event, callback);
  listen('Toggle', 'click', () => {
    if (status.enabled) void mutate({ action: 'stop' });
    else confirm('startTitle', 'startDescription', () => mutate({ action: 'start' }, { reload: true }));
  });
  listen('Settings', 'click', settingsDialog);
  listen('Restart', 'click', () => confirm('restartHistory', 'restartDescription', () => mutate({action:'restart'}, {reload:true})));
  for (const [id, field] of [['Text', 'text'], ['Images', 'images'], ['Files', 'files']]) listen(id, 'change', () => { void mutate({ action: 'settings', settings: { ...status.settings, [field]: q(id).checked } }); });
  listen('Search', 'input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void loadList(); }, 220); });
  for (const id of ['Kind', 'Date']) listen(id, 'change', () => { void loadList(); });
  listen('Favorites', 'click', () => { favorites = !favorites; q('Favorites').setAttribute('aria-pressed', String(favorites)); void loadList(); });
  listen('Batch', 'click', () => { batch = !batch; selected.clear(); q('Batch').setAttribute('aria-pressed', String(batch)); renderList(); });
  listen('SelectAll', 'change', () => { selected = q('SelectAll').checked ? new Set(entries.map(e => e.id)) : new Set(); renderList(); });
  listen('List', 'click', event => { const button = event.target.closest('[data-entry-id]'); if (button) void selectEntry(Number(button.dataset.entryId)); });
  listen('List', 'change', event => { const id = Number(event.target.dataset.selectId); if (!id) return; if (event.target.checked) selected.add(id); else selected.delete(id); renderList(); });
  listen('More', 'click', () => { void loadList(true); }); listen('New', 'click', () => { void loadList(); });
  listen('DetailBack', 'click', () => { overlay.classList.remove('has-detail'); });
  listen('Copy', 'click', async () => { if (detail && await mutate({ action: 'copy', id: detail.id })) { notify(tr('copied')); if (detail) void selectEntry(detail.id); } });
  listen('CopyPaths', 'click', async () => { if (detail && await mutate({ action: 'copy', id: detail.id, paths: true })) notify(tr('copied')); });
  listen('OpenPinned', 'click', async () => { if (detail?.kind === 'image') await mutate({ action: 'pin', id: detail.id }); });
  listen('Favorite', 'click', async () => { if (!detail) return; const id = detail.id; if (await mutate({ action: 'favorite', id, favorite: !detail.favorite }, { reload: true })) await selectEntry(id); });
  const deleteItems = ids => confirm('deleteTitle', 'deleteDescription', async () => { if (!await mutate({ action: 'delete', ids }, { reload: true })) return false; if (ids.includes(detail?.id)) { detail = null; renderDetail(); } return true; });
  listen('Delete', 'click', () => { if (detail) deleteItems([detail.id]); }); listen('DeleteSelected', 'click', () => deleteItems([...selected]));
  listen('Clear', 'click', () => {
    const body = node('div'); body.append(node('p', '', tr('clearDescription')));
    const label = node('label', 'clipboard-check-label'), checkbox = node('input'); checkbox.type = 'checkbox'; label.append(checkbox, node('span', '', tr('includeFavorites'))); body.append(label);
    openDialog('clearTitle', body, async () => { if (!await mutate({ action: 'clear', includeFavorites: checkbox.checked }, { reload: true })) return false; detail = null; renderDetail(); return true; });
  });
  listen('Zoom', 'click', showImage); listen('Preview', 'dblclick', showImage); listen('SaveImage', 'click', () => { void saveImage(); });
  listen('DialogCancel', 'click', closeDialog);
  listen('DialogConfirm', 'click', async () => {
    if (!dialogAction || dialogBusy) return;
    const owner = session; dialogBusy = true; q('DialogConfirm').disabled = true; q('DialogCancel').disabled = true;
    let done = false;
    try { done = await dialogAction(); } catch (error) { if (current(owner)) showError(error); }
    finally { dialogBusy = false; q('DialogConfirm').disabled = false; q('DialogCancel').disabled = false; if (current(owner) && done !== false) closeDialog(); }
  });
  lifecycle.event(documentRef, 'keydown', event => {
    if (!session || dialog.classList.contains('visible') || event.key !== 'Escape' || event.defaultPrevented) return;
    if (overlay.querySelector('.tool-custom-select-trigger[aria-expanded="true"]')) return;
    event.preventDefault(); api.close();
  });
  lifecycle.use(onLangChange(() => { if (!session) return; applyTranslations(overlay); applyTranslations(dialog); selectControls.forEach(control => control?.refresh?.()); renderStatus(); renderList(); renderDetail(); if (dialogKind && !dialogBusy) closeDialog(); }));
  const api = {
    open() {
      if (disposed || session) return;
      const owner = session = createLifecycleScope(); returnFocus = documentRef.activeElement;
      overlay.classList.add('visible'); overlay.inert = false; overlay.setAttribute('aria-hidden', 'false');
      applyTranslations(overlay); applyTranslations(dialog);
      selectControls = ['Kind', 'Date'].map(id => enhanceToolSelect(q(id))); selectControls.forEach(control => owner.use(() => control?.dispose?.()));
      renderStatus(); renderList(); renderDetail(); refreshIcons(); q('Toggle').focus({ preventScroll: true });
      if (!runtime.available) return;
      void (async () => {
        try {
          owner.use(await runtime.subscribe(payload => {
            if(current(owner)&&payload?.recordId){
              void runtime.request({action:'entry',id:payload.recordId}).then(value=>{
                if(!current(owner))return;entries=entries.map(entry=>entry.id===value.id?value:entry);
                if(detail?.id===value.id)detail={...detail,note:value.note};renderList();renderDetail();
              }).catch(error=>{if(current(owner))showError(error);});
            }
            if (!current(owner)) return; clearTimeout(eventTimer);
            eventTimer = setTimeout(() => { void refreshStatus(owner).then(() => { if (current(owner) && !entries.length) void loadList(); }).catch(error => { if (current(owner)) showError(error); }); }, 120);
          }));
          if (!current(owner)) return; await refreshStatus(owner); if (current(owner)) await loadList();
        } catch (error) { if (current(owner)) showError(error); }
      })();
    },
    close() {
      if (!session || dialogBusy) return dialogBusy ? false : undefined;
      closeDialog(); const owner = session; session = null; owner.dispose();
      queryRevision++; detailRevision++; statusRevision++; clearTimeout(searchTimer); clearTimeout(eventTimer);
      // Native monitoring is application-owned and intentionally survives this view.
      entries = []; detail = null; selected.clear(); next = null; snapshot = null; newCount = 0; busy = false; loading = false;
      q('List').replaceChildren(); q('Preview').replaceChildren(); q('Metadata').replaceChildren(); clearError();
      moveFocusOutOfHiddenRegion(overlay, returnFocus); overlay.classList.remove('visible', 'has-detail'); overlay.inert = true; overlay.setAttribute('aria-hidden', 'true'); returnFocus = null;
    },
    dispose() { if (disposed) return; dialogBusy = false; api.close(); disposed = true; modal.dispose(); lifecycle.dispose(); }
  };
  lifecycle.use(bindToolPageChrome(overlay, () => api.close()));
  return api;
}
