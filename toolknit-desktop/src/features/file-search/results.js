import { SORTS, createQuerySession, errorText, normalizeQuery } from './core.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { enhanceToolSelect } from '../../tool-custom-select.js';
import '../../tool-custom-select.css';
import './filters.css';
import './results.css';
import { fileIcon } from './file-icons.js';
import { createElement as createLucideElement, FolderOpen, FolderSearch } from 'lucide';

export function resultsMarkup() {
  return `<div class="fs-filter-row"><label><i data-lucide="list-filter"></i><select class="fs-extension" data-fs-label="extension"></select></label><label><i data-lucide="arrow-down-up"></i><select class="fs-sort" data-fs-label="sort"></select></label></div>
  <div class="fs-list" role="list" data-fs-label="results"></div><footer class="fs-footer"><span class="fs-count" role="status" aria-live="polite"></span><span class="fs-index-status"></span><button class="fs-refresh" type="button" hidden></button></footer><p class="fs-message" role="status" aria-live="polite" hidden></p>`;
}
export function createResults({ root, runtime, tr, refreshIcons = () => {}, onFilter = null }) {
  const scope = createLifecycleScope(), doc = root.ownerDocument;
  const list = root.querySelector('.fs-list'), extension = root.querySelector('.fs-extension'), sort = root.querySelector('.fs-sort');
  const count = root.querySelector('.fs-count'), status = root.querySelector('.fs-index-status'), message = root.querySelector('.fs-message');
  let model = { rows: [], query: normalizeQuery(), loading: false, total: 0, extensions: [] }, selected = -1, opening = new Set(), disposed = false, renderFrame, pointerInside = false, emptySignature = '';
  const refresh = root.querySelector('.fs-refresh');
  let rowsSignature = '', filterSignature = '', dateLocale = '', dateFormatter;
  let checkedGeneration = null, checking = false, checkTimer = null, lastCheck = 0;
  const filtersUI = [];
  const closeFilters = () => { const wasOpen = filtersUI.some(filter => filter.isOpen()); filtersUI.forEach(filter => filter.close()); return wasOpen; };
  const rowHeight = 74, overscan = 4;
  const el = (tag, className, text) => { const value = doc.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; };
  // Scroll paints belong to this list; a global Lucide pass replaces unrelated
  // icons across the entire desktop document on every virtual-window change.
  const iconTemplates = new Map();
  const icon = name => {
    if (!iconTemplates.has(name)) {
      const value = createLucideElement(name === 'folder-open' ? FolderOpen : FolderSearch);
      value.setAttribute('class', `lucide lucide-${name}`); value.setAttribute('aria-hidden', 'true'); value.setAttribute('focusable', 'false');
      iconTemplates.set(name, value);
    }
    return iconTemplates.get(name).cloneNode(true);
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  function showError(error) { if (disposed) return; message.textContent = errorText(error,tr); message.hidden = false; }
  async function reveal(row) {
    if (disposed || !row || model.loading || !model.ticket || opening.has(row.id)) return;
    opening.add(row.id); renderRows();
    try { await runtime.call('reveal', { id: row.id, ticket: model.ticket }); }
    catch (error) { if (!disposed) showError(error); }
    finally { opening.delete(row.id); if (!disposed) renderRows(); }
  }
  function renderRows() {
    if (renderFrame != null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    if (disposed) return;
    const activeId = doc.activeElement?.dataset?.fsReveal;
    // Read before replacing rows. Reading scrollTop after emptying the list
    // forces layout at height zero and clamps every scroll back to the top.
    const scrollTop = list.scrollTop, viewportHeight = list.clientHeight || 300;
    const content = doc.createDocumentFragment();
    if (!model.rows.length) {
      rowsSignature = '';
      const configured = model.index && model.index.phase !== 'unconfigured';
      const key = model.loading ? 'searching' : !configured ? 'setupTitle' : !model.query.text && !model.query.extension ? 'emptyTitle' : 'noResults';
      const title=tr(key), hint=tr(!configured?'setupHint':'emptyHint');
      const signature=JSON.stringify([key,title,hint,!configured&&Boolean(onFilter),tr('openTool')]);
      if (signature===emptySignature && list.firstElementChild?.classList.contains('fs-empty')) return;
      emptySignature=signature;
      const empty = el('div', 'fs-empty');
      const mark=key==='emptyTitle'?el('img','fs-empty-logo'):icon('folder-search');
      if(key==='emptyTitle'){mark.src='/logo.png';mark.alt='';mark.draggable=false;mark.width=44;mark.height=44;}
      empty.append(mark, el('strong', '', title), el('span', '', hint));
      if (!configured && onFilter) { const setup = el('button','fs-more',tr('openTool')); setup.type='button'; setup.dataset.fsSetup=''; empty.append(setup); }
      list.replaceChildren(empty); return;
    }
    emptySignature='';
    const first = Math.min(model.rows.length - 1, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
    const last = Math.min(model.rows.length, first + Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    const locale = doc.documentElement.lang || 'zh-CN';
    const labels = { unknown: tr('unknown'), stale: tr('stale'), reveal: tr('reveal'), more: tr('more') };
    // A native state tick or a few pixels of scrolling usually leaves the
    // virtual window unchanged. Preserve its nodes, focus and decoded icons.
    const signature = JSON.stringify([first, last, model.rows.length, model.total, Boolean(model.cursor),
      model.loading, selected, [...opening], locale, labels, model.rows.slice(first, last)]);
    if (signature === rowsSignature) return;
    rowsSignature = signature;
    if (dateLocale !== locale || !dateFormatter) { dateLocale = locale; dateFormatter = new Intl.DateTimeFormat(locale); }
    const top = el('div', 'fs-list-spacer'); top.style.height = `${first * rowHeight}px`; top.setAttribute('aria-hidden', 'true'); content.append(top);
    for (let i = first; i < last; i++) {
      const row = model.rows[i]; const item = el('div', `fs-row${i === selected ? ' is-selected' : ''}`);
      item.setAttribute('role', 'listitem'); item.dataset.fsRow = String(i);
      item.setAttribute('aria-posinset', String(i + 1)); item.setAttribute('aria-setsize', String(model.total || model.rows.length));
      const mark = el('span', 'fs-file-icon'), picture = el('img');
      const type = fileIcon(row.extension); picture.src = type.url; picture.alt = ''; picture.draggable = false;
      picture.width = 24; picture.height = 24; mark.dataset.fileType = type.kind; mark.append(picture);
      const main = el('div', 'fs-file-main'); const name = el('div', 'fs-file-name'); name.title = row.name;
      const split = row.name.lastIndexOf('.');
      name.append(el('span', 'fs-name-stem', split > 0 ? row.name.slice(0, split) : row.name));
      if (split > 0) name.append(el('span', 'fs-name-extension', row.name.slice(split)));
      const path = el('div', 'fs-file-path', row.parent.replace(/^\\\\\?\\/, '') + (row.stale ? ` · ${labels.stale}` : '')); path.title = row.parent;
      main.append(name, path);
      const modified = row.modified == null ? null : new Date(row.modified * 1000);
      const date = modified && Number.isFinite(modified.getTime()) ? dateFormatter.format(modified) : labels.unknown;
      const meta = el('div', 'fs-file-meta', `${size(row.size)} · ${date}`);
      const button = el('button', 'fs-icon'); button.type = 'button'; button.dataset.fsReveal = row.id; button.disabled = model.loading || opening.has(row.id);
      button.title = labels.reveal; button.setAttribute('aria-label', `${labels.reveal}：${row.name} · ${row.parent}`); button.append(icon('folder-open'));
      item.append(mark, main, meta, button); content.append(item);
    }
    const bottom = el('div', 'fs-list-spacer'); bottom.style.height = `${(model.rows.length - last) * rowHeight}px`; bottom.setAttribute('aria-hidden', 'true'); content.append(bottom);
    if (model.cursor) { const next = el('button', 'fs-more', labels.more); next.type = 'button'; next.disabled = model.loading; next.dataset.fsMore = ''; content.append(next); }
    list.replaceChildren(content);
    list.scrollTop = scrollTop;
    if (activeId) [...list.querySelectorAll('[data-fs-reveal]')].find(b => b.dataset.fsReveal === activeId)?.focus({ preventScroll: true });
  }
  function size(bytes) { if (bytes == null) return tr('unknown'); if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`; if (bytes < 1073741824) return `${(bytes/1048576).toFixed(1)} MB`; return `${(bytes/1073741824).toFixed(1)} GB`; }
  function filters() {
    const values = ['', ...new Set(['pdf','docx','doc','xlsx','pptx','png','jpg','txt','zip',...(model.extensions || []), model.query.extension].filter(Boolean)), '__none__'];
    const options = [...new Set(values)].map(value => [value, value === '' ? tr('allExtensions') : value === '__none__' ? tr('noExtension') : value.toUpperCase()]);
    const sorts = SORTS.map(value => [value, tr(`sorts.${value}`)]);
    const labels = [...root.querySelectorAll('[data-fs-label]')].map(node => [node, tr(node.dataset.fsLabel)]);
    const signature = JSON.stringify([options, sorts, labels.map(([,label]) => label), tr('extensionSearch'), tr('extensionEmpty')]);
    const changed = signature !== filterSignature;
    if (changed) {
      filterSignature = signature;
      for (const [node, label] of labels) if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
      const makeOptions = items => items.map(([value, label]) => { const option = el('option', '', label); option.value = value; return option; });
      extension.replaceChildren(...makeOptions(options)); sort.replaceChildren(...makeOptions(sorts));
    }
    const selectionChanged = extension.value !== model.query.extension || sort.value !== model.query.sort;
    if (extension.value !== model.query.extension) extension.value = model.query.extension;
    if (sort.value !== model.query.sort) sort.value = model.query.sort;
    if (changed || selectionChanged) filtersUI.forEach(filter => filter.refresh());
  }
  function render() {
    if (disposed) return;
    filters(); text(count, model.loading && !model.background ? tr('searching') : tr('found', { count: model.total || 0 }));
    text(status, tr(`phases.${model.index?.phase || 'unconfigured'}`)); renderRows();
  }
  const session = createQuerySession({
    search: data => runtime.call('search', data), invalidate: () => runtime.call('query-invalidate'),
    check: data => runtime.call('query-check', data),
    changed: next => {
      const same = JSON.stringify(model.query) === JSON.stringify(next.query);
      const selectedId = model.rows[selected]?.id;
      model = { ...model, ...next }; message.hidden = true;
      if (next.generation != null) checkedGeneration=next.generation;
      selected = same && selectedId ? model.rows.findIndex(row => row.id === selectedId) : -1;
      refresh.hidden = true;
      if (!same) { selected = -1; model.total = 0; list.scrollTop = 0; }
      render();
    }, failed: showError
  });
  async function checkUpdates() {
    checkTimer=null;
    if (disposed || checking || !session.active || model.loading || !model.ticket || model.index?.phase==='unconfigured') return;
    const current=model.index?.generation;
    if (current == null || current<=Math.max(checkedGeneration ?? -1,model.generation ?? -1)) return;
    checking=true; lastCheck=Date.now();
    try {
      const value=await session.checkUpdate();
      if (!value || disposed || !session.active) return;
      if (value.expired) { session.refreshBackground(); return; }
      checkedGeneration=value.generation;
      if (!value.changed) {
        model.generation=value.generation;
        if (value.extensions) { model.extensions=value.extensions; filters(); }
        refresh.hidden=true;
      } else if (!pointerInside && selected<0 && list.scrollTop===0 && !filtersUI.some(filter=>filter.isOpen())) {
        session.refreshBackground();
      } else { refresh.hidden=false; text(refresh,tr('refreshResults')); }
    } finally { checking=false; }
  }
  const scheduleCheck=()=>{
    if (checkTimer!=null || checking || !session.active || model.loading) return;
    checkTimer=setTimeout(()=>void checkUpdates(),Math.max(0,1500-(Date.now()-lastCheck)));
  };
  scope.event(list, 'pointerenter', () => { pointerInside = true; });
  scope.event(list, 'pointerleave', () => { pointerInside = false; });
  scope.event(refresh, 'click', () => { selected = -1; session.refresh(); });
  for (const select of [extension, sort]) scope.event(select, 'change', () => {
    const query = { ...session.query, extension: extension.value, sort: sort.value };
    if (onFilter) void onFilter(query); else session.set(query, { immediate: true });
  });
  scope.event(list, 'click', event => {
    if (event.target.closest('[data-fs-setup]')) { void runtime.call('open-tool').catch(showError); return; }
    const button = event.target.closest('[data-fs-reveal]');
    if (button) { void reveal(model.rows.find(row => row.id === button.dataset.fsReveal)); return; }
    if (event.target.closest('[data-fs-more]')) { void session.more(); return; }
    const row = event.target.closest('[data-fs-row]'); if (row) { selected = Number(row.dataset.fsRow); renderRows(); }
  });
  scope.event(list, 'scroll', () => { if (renderFrame == null) renderFrame = requestAnimationFrame(renderRows); }, { passive: true });
  function navigate(key) {
    if (disposed) return;
    closeFilters();
    if (!model.rows.length || model.loading) return;
    if (key === 'Enter') { if (selected >= 0) void reveal(model.rows[selected]); return; }
    const page = Math.max(1, Math.floor(list.clientHeight / rowHeight));
    selected = Math.max(0, Math.min(model.rows.length - 1, key === 'Home' ? 0 : key === 'End' ? model.rows.length - 1 : selected + ({ ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }[key] || 0)));
    if (selected * rowHeight < list.scrollTop) list.scrollTop = selected * rowHeight;
    if ((selected + 1) * rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = (selected + 1) * rowHeight - list.clientHeight;
    renderRows();
  }
  scope.event(root, 'keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.target.tagName === 'SELECT' || e.target.closest('button,.tool-custom-select-menu')) return;
    if (['ArrowDown','ArrowUp','Home','End','PageDown','PageUp','Enter'].includes(e.key)) { e.preventDefault(); navigate(e.key); }
  });
  render();
  for (const select of [extension, sort]) {
    const enhanced = enhanceToolSelect(select, { boundary: root, menuClass: 'fs-select-menu', controlClass: 'fs-select-control',
      searchable: select === extension, searchPlaceholder: () => tr('extensionSearch'), emptyLabel: () => tr('extensionEmpty') });
    if (enhanced) filtersUI.push(enhanced);
  }
  refreshIcons();
  return { session, navigate, closeFilters, markPending() { if (disposed) return; model.loading = true; model.ticket = ''; renderRows(); }, setIndex(index) {
    if (disposed) return;
    if (index?.phase!=='unconfigured' && Number(index?.generation)<Number(model.index?.generation)) return;
    model.index = index; text(status, tr(`phases.${index?.phase || 'unconfigured'}`));
    if (index?.phase === 'unconfigured') { model.rows = []; model.ticket = ''; model.cursor = null; model.total = 0; selected = -1; count.textContent = tr('found', { count: 0 }); renderRows(); return; }
    if (model.generation != null && index?.generation>Math.max(model.generation,checkedGeneration ?? -1)) scheduleCheck();
    if (!model.rows.length) renderRows();
  }, render,
    dispose() {
      if (disposed) return;
      disposed = true; session.dispose(); cancelAnimationFrame(renderFrame); clearTimeout(checkTimer);
      filtersUI.forEach(filter => filter.dispose()); filtersUI.length = 0; scope.dispose();
      model = { rows: [], query: normalizeQuery(), loading: false, total: 0, extensions: [] };
      opening.clear(); iconTemplates.clear(); rowsSignature = ''; filterSignature = ''; emptySignature = '';
      dateFormatter = null; selected = -1; list.replaceChildren();
    }
  };
}
