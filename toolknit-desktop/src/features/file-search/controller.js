import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { createFileSearchRuntime } from '../../platform/file-search-runtime.js';
import { applyTranslations, t, getLang, onLangChange } from '../../i18n.js';
import { createResults } from './results.js';
import { errorText, errorCode } from './core.js';

export function createFileSearchController({ overlay, isTauri = false, fileSearchRuntime, refreshIcons = () => {} } = {}) {
  const runtime = fileSearchRuntime || createFileSearchRuntime({ isTauri });
  const lifetime = createLifecycleScope(), doc = overlay.ownerDocument;
  const q = id => doc.getElementById(`fileSearch${id}`), tr = (key, vars) => t(`fileSearch.${key}`, vars);
  let session = null, results = null, ready = false, capsuleMode = false, modeBusy = false, busy = false, nativeBusy = false, returnFocus, polling = false, composing = false;
  let latestState=null, windowGeneration=-1, statusAgain=false;
  const visible = () => session && !session.disposed;
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const context = () => runtime.call('context', { lang: getLang(), theme: doc.documentElement.dataset.theme || 'dark', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
  function message(error) { if (!visible()) return; const target = q(!ready ? 'SetupStatus' : capsuleMode ? 'CapsuleStatus' : 'Status'); target.hidden = false; target.textContent = errorText(error, tr); }
  function controls() {
    const pending = busy || nativeBusy || modeBusy;
    for (const [name, disabled] of [['Enable',pending],['Ordinary',pending],['Float',!ready||pending],['UseWindow',pending],...['Stop','Resume','Rebuild','Repair'].map(name=>[name,pending])]) {
      if (q(name).disabled !== disabled) q(name).disabled = disabled;
    }
    if (q('Setup').getAttribute('aria-busy') !== String(pending)) q('Setup').setAttribute('aria-busy', String(pending));
  }
  function applyState(data) {
    const generation=Number(data.window?.generation ?? windowGeneration);
    if (generation<windowGeneration && latestState) data={...data,window:latestState.window};
    else windowGeneration=generation;
    latestState=data;
    nativeBusy = data.setupBusy === true;
    const nextReady = data.automatic === true, nextCapsule = data.window?.enabled === true;
    const changed = ready !== nextReady || capsuleMode !== nextCapsule; ready = nextReady; capsuleMode = nextCapsule;
    const canSearch = ready && !capsuleMode && !modeBusy;
    if (!canSearch) { composing = false; q('Maintenance').open = false; results?.closeFilters(); results?.session.pause(); }
    for (const [name, shown] of [['Setup', !ready], ['Workbench', ready && !capsuleMode], ['CapsuleGuide', ready && capsuleMode]]) {
      const panel = q(name);
      if (!shown && panel.contains(doc.activeElement)) moveFocusOutOfHiddenRegion(panel);
      if (panel.hidden !== !shown) panel.hidden = !shown;
      if (panel.inert !== !shown) panel.inert = !shown;
      if (panel.getAttribute('aria-hidden') !== String(!shown)) panel.setAttribute('aria-hidden', String(!shown));
    }
    if (q('Float').checked !== (data.window?.enabled === true)) q('Float').checked = data.window?.enabled === true;
    if (q('Repair').hidden !== (data.needsServiceRepair !== true)) q('Repair').hidden = data.needsServiceRepair !== true;
    const phase = data.index?.phase || 'unconfigured';
    const stopped = ['stopped', 'unconfigured', 'error'].includes(phase);
    if (q('Stop').hidden !== stopped) q('Stop').hidden = stopped;
    if (q('Resume').hidden !== !stopped) q('Resume').hidden = !stopped;
    text(q('IndexProgress'), tr(['loading', 'indexing'].includes(phase) ? 'automaticIndexing'
      : phase === 'stopped' ? 'indexPaused' : phase === 'error' ? 'phases.error'
      : data.index?.accelerationError ? 'automaticFallback'
      : phase === 'partial' || data.index?.unavailable?.length ? 'automaticPartial' : 'automaticReady'));
    if (canSearch) { results?.setIndex(data.index); if (!results.session.active) results.session.start(); }
    controls();
    if (changed) { refreshIcons(); q(!ready ? 'Enable' : capsuleMode ? 'UseWindow' : 'Query').focus({ preventScroll: true }); }
    if (data.index?.error) message(data.index.error);
  }
  async function readStatus() {
    if (!visible()) return;
    if (polling) {statusAgain=true;return;}
    const owner = session; polling = true;
    try { const data = await runtime.call('status'); if (owner === session) applyState(data); }
    catch (error) { if (owner === session) message(error); }
    finally { if (owner === session) {polling=false;if(statusAgain){statusAgain=false;void readStatus();}} }
  }
  async function setup(ordinary = false) {
    if (busy || nativeBusy || !visible()) return;
    const owner = session; busy = true; controls();
    const feedback = q(ready ? 'Status' : 'SetupStatus');
    feedback.hidden = false; feedback.textContent = tr(ordinary ? 'preparingSearch' : 'fastAuthorizing'); q('Ordinary').hidden = true;
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const data = await runtime.call('automatic-setup', { ordinary });
      if (owner !== session) return;
      q('SetupStatus').hidden = true; q('Status').hidden = true; applyState(data);
    } catch (error) { if (owner === session) { message(error); q('Ordinary').hidden = errorCode(error) === 'cancelled'; } }
    finally { busy = false; if (visible()) { controls(); void readStatus(); } }
  }
  async function maintain(action) {
    if (busy || modeBusy || capsuleMode || !visible()) return;
    const owner = session; busy = true; controls(); q('Maintenance').open = false; q('Status').hidden = true;
    try { const data = await runtime.call(action); if (owner === session) { applyState(data); results.session.refresh(); } }
    catch (error) { if (owner === session) message(error); }
    finally { busy = false; if (visible()) controls(); }
  }
  lifetime.event(q('Enable'), 'click', () => void setup());
  lifetime.event(q('Ordinary'), 'click', () => void setup(true));
  lifetime.event(q('Stop'), 'click', () => void maintain('index-stop'));
  lifetime.event(q('Resume'), 'click', () => void maintain('automatic-resume'));
  lifetime.event(q('Rebuild'), 'click', () => void maintain('automatic-rebuild'));
  lifetime.event(q('Repair'), 'click', () => { q('Maintenance').open = false; void setup(); });
  lifetime.event(doc, 'pointerdown', event => { if (!q('Maintenance').contains(event.target)) q('Maintenance').open = false; });
  async function switchMode(enabled) {
    if (modeBusy || busy || nativeBusy || !visible()) return;
    const owner=session; modeBusy=true; controls(); results?.closeFilters(); results?.session.pause();
    q('CapsuleStatus').hidden=true;
    try {
      await context(); const next=await runtime.call('configure', { enabled });
      if(owner===session && latestState && typeof next?.enabled==='boolean') applyState({...latestState,window:next,index:next.index||latestState.index});
    }
    catch (error) { if (owner === session) message(error); }
    finally { modeBusy=false; if (visible()) { controls(); await readStatus(); } }
  }
  lifetime.event(q('Float'), 'change', () => void switchMode(q('Float').checked));
  lifetime.event(q('UseWindow'), 'click', () => void switchMode(false));
  lifetime.event(q('Query'), 'input', () => { q('Clear').hidden = !q('Query').value; results?.session.set({ text: q('Query').value }); });
  lifetime.event(q('Query'), 'compositionstart', () => { composing = true; results?.session.composition(true); });
  lifetime.event(q('Query'), 'compositionend', () => { composing = false; results?.session.set({ text: q('Query').value }); results?.session.composition(false); });
  lifetime.event(q('Clear'), 'click', () => { q('Query').value = ''; q('Clear').hidden = true; results?.session.set({ text: '' }, { immediate: true }); q('Query').focus(); });
  lifetime.event(q('Query'), 'keydown', event => {
    if (!event.isComposing && !composing && ['ArrowDown','ArrowUp','PageDown','PageUp','Enter'].includes(event.key)) { event.preventDefault(); results?.navigate(event.key); }
  });
  for (const button of overlay.querySelectorAll('[data-file-search-close]')) lifetime.event(button, 'click', close);
  lifetime.event(doc, 'keydown', event => {
    if (visible() && event.key === 'Escape' && !event.isComposing && !composing && event.target.tagName !== 'SELECT' && !event.defaultPrevented) {
      event.preventDefault(); if (q('Maintenance').open) q('Maintenance').open = false; else close();
    }
  });
  lifetime.use(onLangChange(() => { if (visible()) { applyTranslations(); results?.render(); void context().catch(message); void readStatus(); } }));
  function close() {
    if (!session) return;
    composing = false; polling = false; statusAgain=false; q('Maintenance').open = false;
    session.dispose(); session = null; results?.closeFilters(); results?.session.pause();
    moveFocusOutOfHiddenRegion(overlay, returnFocus); overlay.classList.remove('visible'); setModalInteractivity(overlay, false);
  }
  async function open() {
    if (visible()) return;
    session = createLifecycleScope(); returnFocus = doc.activeElement; q('Status').hidden = true; q('SetupStatus').hidden = true; q('CapsuleStatus').hidden = true;
    overlay.classList.add('visible'); setModalInteractivity(overlay, true); applyTranslations(); controls(); refreshIcons();
    if (!results) results = createResults({ root: q('Results'), runtime, tr, refreshIcons });
    if (!runtime.available) { message('file-search:desktop-only'); return; }
    const owner = session;
    try {
      await context(); if (owner !== session) return;
      await readStatus(); if (owner !== session) return;
      session.interval(() => { if (!doc.hidden) void readStatus(); }, 1500);
      session.event(doc, 'visibilitychange', () => { if (!doc.hidden) void readStatus(); });
      const unlisten = await runtime.listen(next => {
        if (!visible()) return;
        if (latestState && typeof next?.enabled==='boolean') applyState({...latestState,window:next,index:next.index||latestState.index});
        void readStatus();
      });
      if (owner !== session) { unlisten(); return; } session.use(unlisten);
      const observer = new MutationObserver(() => void context().catch(message)); observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); session.use(() => observer.disconnect());
      q(!ready ? 'Enable' : capsuleMode ? 'UseWindow' : 'Query').focus({ preventScroll: true });
    } catch (error) { if (owner === session) message(error); }
  }
  return { open, close, dispose() { close(); results?.dispose(); results = null; lifetime.dispose(); } };
}
