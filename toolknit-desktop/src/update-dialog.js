import './update-dialog.css';
import { t, onLangChange } from './i18n.js';
import { createLifecycleScope } from './app/tool-lifecycle.js';
import { setModalInteractivity } from './app/modal-runtime.js';
import { compareVersions, normalizeVersion, stableTagVersion, UPDATE_DOWNLOAD_PAGE } from './update-service.js';

export function initUpdateDialog({ openExternalUrl, refreshBackgroundRendering, refreshIcons } = {}) {
  const dialog = document.getElementById('updateDialog');
  if (!dialog) return null;
  const scope = createLifecycleScope();
  const button = dialog.querySelector('[data-update-download]');
  const closeButton = dialog.querySelector('[data-update-close]');
  let release = null;
  let status = 'idle';
  let busy = false;
  let returnFocus = null;

  function render() {
    closeButton.setAttribute('aria-label', t('common.close'));
    if (!release) return;
    dialog.querySelector('[data-update-current]').textContent = `v${release.currentVersion}`;
    dialog.querySelector('[data-update-latest]').textContent = `v${release.version}`;
    const quip = [...release.version].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
    dialog.querySelector('#updateDialogCopy').textContent = t(`updateDialog.quip${quip}`);
    button.querySelector('span').textContent = t(`updateDialog.${busy ? 'opening' : status === 'failed' ? 'retry' : 'download'}`);
    const message = dialog.querySelector('.update-dialog-status');
    message.textContent = status === 'idle' ? '' : t(`updateDialog.${status}`);
    message.dataset.error = String(status === 'failed');
  }

  function close() {
    if (dialog.open) dialog.close();
    dialog.classList.remove('visible');
    setModalInteractivity(dialog, false);
    document.body.classList.remove('update-dialog-open');
    refreshBackgroundRendering?.();
    if (returnFocus?.isConnected && !returnFocus.closest('[inert], [aria-hidden="true"]')) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function open(value) {
    const version = stableTagVersion(value?.version);
    const currentVersion = normalizeVersion(value?.currentVersion)?.raw;
    if (scope.disposed || !version || !currentVersion || compareVersions(version, currentVersion) <= 0) return false;
    if (release && compareVersions(version, release.version) < 0) return false;
    release = { version, currentVersion };
    render();
    if (!dialog.open) {
      returnFocus = document.activeElement;
      setModalInteractivity(dialog, true);
      dialog.showModal();
      dialog.classList.add('visible');
      document.body.classList.add('update-dialog-open');
      refreshBackgroundRendering?.();
      button.focus({ preventScroll: true });
    }
    return true;
  }

  async function download() {
    if (busy || !release || scope.disposed) return;
    busy = true;
    button.disabled = true;
    render();
    const token = scope.token();
    try {
      const opened = await openExternalUrl?.(UPDATE_DOWNLOAD_PAGE);
      if (scope.isCurrent(token)) status = opened === true ? 'opened' : 'failed';
    } catch {
      if (scope.isCurrent(token)) status = 'failed';
    } finally {
      if (scope.isCurrent(token)) {
        busy = false;
        button.disabled = false;
        render();
        if (dialog.open) button.focus({ preventScroll: true });
      }
    }
  }

  scope.event(button, 'click', () => void download());
  scope.event(closeButton, 'click', close);
  scope.event(dialog, 'cancel', event => {
    event.preventDefault();
    close();
  });
  scope.event(document, 'keydown', event => {
    if (!dialog.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = [closeButton, button].filter(item => !item.disabled);
      const index = items.indexOf(document.activeElement);
      const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }
  }, true);
  scope.use(onLangChange(render));
  const dispose = () => {
    if (scope.disposed) return;
    scope.dispose();
    close();
  };
  scope.event(window, 'pagehide', dispose);
  refreshIcons?.();
  return { open, dispose };
}
