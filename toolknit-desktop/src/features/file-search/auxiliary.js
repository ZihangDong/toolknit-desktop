import { createIcons, Search, ChevronDown, ChevronsLeft, X, ListFilter, ArrowDownUp, AppWindow, EyeOff, Power } from 'lucide';
import { t, getLang, setLangWithoutFade } from '../../i18n.js';
import { createFileSearchRuntime } from '../../platform/file-search-runtime.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import './floating.css';
import '../../styles/components/input-focus.css';
import { createResults, resultsMarkup } from './results.js';
import { createInputPublisher, queryKey } from './core.js';
import { createContextMenu } from '../../shared/context-menu.js';
import '../../styles/components/context-menu.css';

const root = document.getElementById('fileSearchRoot');
const role = new URLSearchParams(location.search).get('role');
const runtime = createFileSearchRuntime({ isTauri: Boolean(window.__TAURI_INTERNALS__) });
const scope = createLifecycleScope();
const tr = (key, vars) => t(`fileSearch.${key}`, vars);
const icons = () => createIcons({ icons: { Search, ChevronDown, ChevronsLeft, X, ListFilter, ArrowDownUp, AppWindow, EyeOff, Power } });
let disposed = false, generation = -1, expanded = false, composing = false, drag = null, suppressClick = false, morph;
let barActive = false, draftDirty = false;
let renderedLanguage = '';
const attribute = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
const styleValue = (node, name, value) => { if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value); };

root.innerHTML = role === 'bar' ? `<section class="fs-bar" data-expanded="false">
  <button type="button" class="fs-capsule"><i data-lucide="search"></i><span data-fs-text="capsule"></span></button>
  <div class="fs-input-row" inert aria-hidden="true">
    <button type="button" class="fs-icon fs-grip" data-fs-label="drag"><i data-lucide="search"></i></button>
    <input class="fs-query" type="text" autocomplete="off" spellcheck="false" maxlength="256" data-fs-label="query">
    <button type="button" class="fs-icon fs-clear" data-fs-label="clear" hidden><i data-lucide="x"></i></button>
    <button type="button" class="fs-icon fs-collapse" data-fs-label="collapse"><i data-lucide="chevrons-left"></i></button>
  </div>
</section>` : role === 'menu' ? `<nav class="tk-context-menu fs-context-menu" role="menu"></nav>` : `<section class="fs-card">${resultsMarkup()}</section>`;

const bar = root.querySelector('.fs-bar');
const capsule = root.querySelector('.fs-capsule');
const inputRow = root.querySelector('.fs-input-row');
const input = root.querySelector('.fs-query');
const clear = root.querySelector('.fs-clear');
const publisher = bar ? createInputPublisher({ invalidate: () => runtime.call('query-invalidate'),
  publish: async text => { const state = await call('query', { text }); if (state && input.value === text) draftDirty = false; }, failed: error }) : null;
const results = role === 'results' ? createResults({ root: root.querySelector('.fs-card'), runtime, tr, refreshIcons: icons, onFilter: query => call('query', query) }) : null;
let panelQueryKey = '', panelOpened = false;
let polling = false;
let menuToken = null;
const menu = role === 'menu' ? createContextMenu({ root: root.querySelector('.fs-context-menu'), refreshIcons: icons,
  onSelect: selected => call('menu-select', { token: menuToken, selected }), onDismiss: () => void call('menu-dismiss', { token: menuToken }) }) : null;
function translate() {
  if (renderedLanguage === getLang()) return false;
  renderedLanguage = getLang();
  for (const el of root.querySelectorAll('[data-fs-text]')) el.textContent = tr(el.dataset.fsText);
  for (const el of root.querySelectorAll('[data-fs-label]')) el.setAttribute('aria-label', tr(el.dataset.fsLabel));
  capsule?.setAttribute('aria-label', tr('expand'));
  if (input) input.placeholder = tr('placeholder');
  icons();
  return true;
}
function error() {
  const message = root.querySelector('.fs-message');
  if (message) message.textContent = tr('failed');
  if (capsule) capsule.setAttribute('aria-label', tr('retry'));
}
async function call(action, payload) {
  try { const next = await runtime.call(action, payload); if (!disposed && next) update(next); return next; }
  catch { if (!disposed) error(); return null; }
}
function update(state) {
  if (disposed || !state || Number(state.generation) < generation) return;
  if (state.context?.lang) setLangWithoutFade(state.context.lang);
  const reduced = state.context?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.documentElement.dataset.reducedMotion !== String(reduced)) document.documentElement.dataset.reducedMotion = String(reduced);
  const languageChanged = translate();
  if (menu) {
    generation = Number(state.generation) || 0;
    if (state.menuToken && (state.menuToken !== menuToken || languageChanged)) {
      menuToken = state.menuToken;
      menu.render([{ action: 'open', icon: 'app-window', label: tr('openTool') }, { action: 'hide', icon: 'eye-off', label: tr('hideUntilRestart') }, { separator: true }, { action: 'disable', icon: 'power', label: tr('disableCapsule') }]);
    } else if (!state.menuToken) { menuToken = null; }
    return;
  }
  if (!bar) {
    if (results) {
      generation = Number(state.generation) || 0;
      const active = state.expanded && state.enabled && !state.hidden && !state.suspended;
      const card = root.querySelector('.fs-card');
      if (!active) results.closeFilters();
      if(!active && card.contains(document.activeElement)) document.activeElement.blur();
      if (card.inert !== !active) card.inert = !active;
      attribute(card, 'aria-hidden', String(!active));
      attribute(card, 'data-visible', String(active));
      styleValue(card, '--fs-entry-y', state.layout?.above ? '-5px' : '5px');
      if (queryKey(state.query || {}) !== panelQueryKey) { results.closeFilters(); panelQueryKey = queryKey(state.query || {}); results.session.set(state.query || {}, { immediate: true }); }
      if (active && !panelOpened) { results.session.start(); }
      else if (!active && panelOpened) { results.closeFilters(); results.session.pause(); }
      panelOpened = active; if (languageChanged) results.render();
      if (state.index) results.setIndex(state.index);
    }
    return;
  }
  const changed = expanded !== Boolean(state.expanded);
  let current = null;
  if (changed && morph) {
    const bounds = bar.getBoundingClientRect(), style = getComputedStyle(bar);
    current = { width: `${bounds.width}px`, height: `${bounds.height}px`, borderRadius: style.borderRadius, transform: style.transform };
  }
  generation = Number(state.generation) || 0;
  const layout = state.layout;
  if (layout && state.expanded) {
    styleValue(bar, '--fs-width', `${layout.bar.width / layout.scale}px`);
    styleValue(bar, '--fs-origin-x', `${layout.originX}px`);
    styleValue(bar, '--fs-origin-y', `${layout.originY}px`);
  }
  expanded = Boolean(state.expanded);
  const wasActive = barActive;
  barActive = expanded && state.enabled && !state.hidden && !state.suspended;
  if (!barActive) { publisher.cancel(); composing = false; }
  if (!expanded && inputRow.contains(document.activeElement)) document.activeElement.blur();
  if (inputRow.inert !== !expanded) inputRow.inert = !expanded;
  attribute(inputRow, 'aria-hidden', String(!expanded));
  if (capsule.disabled !== expanded) capsule.disabled = expanded;
  attribute(capsule, 'aria-hidden', String(expanded));
  attribute(capsule, 'aria-expanded', String(expanded));
  attribute(bar, 'data-expanded', String(expanded));
  if (changed) {
    morph?.cancel();
    const capsuleFrame = { width: '148px', height: '48px', borderRadius: '24px', transform: `translate(${bar.style.getPropertyValue('--fs-origin-x') || '0px'}, ${bar.style.getPropertyValue('--fs-origin-y') || '0px'})` };
    const expandedFrame = { width: bar.style.getPropertyValue('--fs-width') || '500px', height: '56px', borderRadius: '28px', transform: 'translate(0,0)' };
    morph = bar.animate([current || (expanded ? capsuleFrame : expandedFrame), expanded ? expandedFrame : capsuleFrame],
      { duration: reduced ? 0 : 320, easing: 'cubic-bezier(.18,.88,.24,1)', fill: 'forwards' });
  }
  if (state.query && !draftDirty && !composing && document.activeElement !== input && input.value !== (state.query.text || '')) input.value = state.query.text || '';
  if (clear.hidden !== !input.value) clear.hidden = !input.value;
  if (barActive && !wasActive && draftDirty) publisher.submit(input.value, { immediate: true });
  if (changed && expanded) requestAnimationFrame(() => { if (!disposed && expanded) input.focus({ preventScroll: true }); });
}
if (bar) {
  scope.event(root, 'contextmenu', event => { event.preventDefault(); void call('menu-open'); });
  scope.event(capsule, 'click', () => { if (!suppressClick) void call('expand'); suppressClick = false; });
  scope.event(root.querySelector('.fs-collapse'), 'click', () => void call('collapse'));
  scope.event(clear, 'click', () => { input.value = ''; clear.hidden = true; composing = false; draftDirty = true; input.focus(); publisher.submit('', { immediate: true }); });
  scope.event(input, 'compositionstart', () => { composing = true; if (barActive) publisher.invalidate(); });
  const query = () => {
    clear.hidden = !input.value; draftDirty = true;
    if (!barActive) return;
    if (composing) publisher.invalidate(); else publisher.submit(input.value);
  };
  scope.event(input, 'input', query);
  scope.event(input, 'compositionend', () => { composing = false; query(); });
  for (const handle of [capsule, root.querySelector('.fs-grip')]) {
    scope.event(handle, 'pointerdown', e => { if (e.button === 0) { suppressClick = false; drag = { x: e.screenX, y: e.screenY }; } });
    scope.event(handle, 'pointermove', e => {
      if (!drag || !(e.buttons & 1)) return;
      if (Math.hypot(e.screenX - drag.x, e.screenY - drag.y) > 6) {
        drag = null; suppressClick = true; void call('drag');
      }
    });
  }
  scope.event(window, 'pointerup', () => { drag = null; });
}
if (results) scope.event(root, 'contextmenu', event => event.preventDefault());
scope.event(window, 'keydown', e => {
  if (menu || e.defaultPrevented) return;
  if (bar && expanded && !e.isComposing && !composing && ['ArrowDown','ArrowUp','PageDown','PageUp','Enter'].includes(e.key)) {
    e.preventDefault(); if (!publisher.pending) void call('navigate', { key: e.key });
  }
  if (e.key === 'Escape' && !e.isComposing && !composing && e.target.tagName !== 'SELECT') {
    e.preventDefault(); void call(bar ? 'navigate' : 'collapse', bar ? { key: 'Escape' } : undefined);
  }
});
scope.event(window, 'pagehide', () => { disposed = true; publisher?.dispose(); morph?.cancel(); results?.dispose(); menu?.dispose(); scope.dispose(); });
translate();
void (async () => {
  const unlisten = await runtime.listen(update);
  if (disposed) { unlisten(); return; }
  scope.use(unlisten);
  const unlistenSettled = await runtime.onSettled(value => {
    if (bar && value === generation) {
      morph?.cancel();morph = null;
      if(!expanded){bar.style.setProperty('--fs-origin-x', '0px');bar.style.setProperty('--fs-origin-y', '0px');}
    }
  });
  scope.use(unlistenSettled);
  if (results) {
    scope.use(await runtime.onPanelEvent('file-search-navigate', key => {
      if (key === 'Escape') { if (!results.closeFilters()) void call('collapse'); }
      else results.navigate(key);
    }));
    scope.use(await runtime.onPanelEvent('file-search-pending', () => results.markPending()));
    scope.interval(async () => {
      if (!panelOpened || polling || disposed || document.hidden) return; polling = true;
      try { const state = await runtime.call('status'); if (!disposed && panelOpened) results.setIndex(state.index); }
      catch { /* retry next visible poll; query failures keep their own feedback */ }
      finally { polling = false; }
    }, 1500);
  }
  const initial = await runtime.call('boot');
  if (disposed) return;
  update(initial);
  await call('ready');
})().catch(error);
