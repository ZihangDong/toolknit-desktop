import { createLifecycleScope } from './tool-lifecycle.js';
import { createRecordingModeAdapter } from '../platform/recording-mode-runtime.js';
import { createRecordingModeState, recordingFailureCode, RECORDING_PROMPT_KEY } from './recording-mode-state.js';
import '../styles/pages/recording-mode.css';

export function createRecordingModeRuntime({ root = document, storage = localStorage, isTauri = false, adapter = createRecordingModeAdapter({ isTauri }), translate: t = key => key, onLanguageChange, onOpenHelp = () => {}, notify = () => {} } = {}) {
  const scope = createLifecycleScope();
  const byId = id => root.getElementById(id);
  const prompt = byId('recordingModePrompt'), menu = byId('recordingModeDismissMenu'), dismiss = byId('recordingModeDismiss');
  const toggles = [byId('recordingModeToggle'), byId('recordingModePromptToggle')].filter(Boolean);
  let status = { state: null, busy: false, enabled: false }, closed = false, failed = false, queued = false;
  let permanent = false;
  let failureCode = '';
  const diagnose = (error, stage = 'read') => {
    const code = recordingFailureCode(error);
    console.warn('[Recording Mode]', { stage, code });
    return t('recordingMode.failureDetail', { step: t(`recordingMode.steps.${stage}`), code });
  };
  try { permanent = storage.getItem(RECORDING_PROMPT_KEY) === 'true'; } catch { /* A disabled store must not crash startup. */ }
  const setMenu = open => {
    if (menu) menu.hidden = !open;
    dismiss?.setAttribute('aria-expanded', String(open));
  };
  const render = () => {
    for (const toggle of toggles) { toggle.disabled = status.busy || !adapter.available; toggle.setAttribute('aria-pressed', String(status.enabled)); }
    const label = byId('recordingModeStatus');
    if (label) label.textContent = t(!adapter.available ? 'recordingMode.unavailable' : status.busy ? 'recordingMode.busy' : failed ? 'recordingMode.statusError' : status.enabled ? 'recordingMode.on' : 'recordingMode.off');
    if (label) label.title = failureCode;
    if (prompt) prompt.hidden = status.enabled || closed || permanent || !status.state;
    root.documentElement?.toggleAttribute('data-recording-mode-busy', status.busy);
    if (prompt?.hidden) setMenu(false);
  };
  const model = createRecordingModeState({ adapter, storage, onChange: value => { status = value; failed = false; render(); } });
  const refresh = async () => {
    try { await model.refresh(); if (!scope.disposed) { failureCode = ''; render(); } }
    catch (error) { if (!scope.disposed) { failed = true; failureCode = diagnose(error); render(); } }
  };
  const schedule = () => {
    if (queued || scope.disposed) return;
    queued = true;
    scope.timeout(() => { queued = false; void refresh(); }, 600);
  };
  for (const toggle of toggles) scope.event(toggle, 'click', async () => {
    if (toggle.disabled || model.busy) return;
    // A failed initial read must not permanently lock the switch. Retry the
    // read first, and never mutate settings while their state is unknown.
    if (failed || !status.state) {
      await refresh();
      if (scope.disposed || model.busy) return;
      if (failed || !status.state) { notify(`${t('recordingMode.statusError')} ${failureCode}`); return; }
    }
    const enabled = !status.enabled;
    try {
      if (await model.setEnabled(enabled) && !scope.disposed) notify(t(enabled ? 'recordingMode.enabled' : 'recordingMode.disabled'));
    } catch (error) {
      if (!scope.disposed) {
        failureCode = diagnose(error, error.stage || 'read');
        notify(`${t(error.message === 'recording:rollback-failed' ? 'recordingMode.rollbackError' : 'recordingMode.error')} ${failureCode}`);
      }
    } finally { if (!scope.disposed) { render(); schedule(); } }
  });
  for (const link of root.querySelectorAll('[data-recording-mode-help]')) scope.event(link, 'click', event => { event.preventDefault(); onOpenHelp('recording-mode'); });
  if (dismiss) scope.event(dismiss, 'click', () => setMenu(true));
  const dismissal = byId('recordingModeDismissal');
  if (dismissal) {
    scope.event(dismissal, 'pointerenter', () => setMenu(true));
    scope.event(dismissal, 'pointerleave', () => { if (!dismissal.contains(root.activeElement)) setMenu(false); });
    scope.event(dismissal, 'focusin', () => setMenu(true));
    scope.event(dismissal, 'focusout', event => { if (!dismissal.contains(event.relatedTarget)) setMenu(false); });
    scope.event(dismissal, 'keydown', event => { if (event.key === 'Escape') { dismiss.focus(); setMenu(false); event.stopPropagation(); } });
  }
  for (const button of root.querySelectorAll('[data-recording-mode-dismiss]')) scope.event(button, 'click', () => {
    if (button.dataset.recordingModeDismiss === 'permanent') {
      try { storage.setItem(RECORDING_PROMPT_KEY, 'true'); permanent = true; } catch { notify(t('recordingMode.error')); return; }
    }
    closed = true;
    const focus = root.activeElement;
    if (prompt?.contains(focus)) focus.blur();
    render();
  });
  if (adapter.available) void adapter.subscribe(schedule).then(release => scope.use(release)).catch(error => { if (!scope.disposed) diagnose(error, 'listen'); });
  if (onLanguageChange) scope.use(onLanguageChange(render));
  if (root.defaultView?.addEventListener) {
    scope.event(root.defaultView, 'focus', schedule);
    scope.event(root.defaultView, 'pagehide', () => { model.dispose(); scope.dispose(); }, { once: true });
  }
  scope.use(model.dispose);
  scope.use(() => root.documentElement?.removeAttribute('data-recording-mode-busy'));
  render(); void refresh();
  return { refresh, dispose: scope.dispose };
}
