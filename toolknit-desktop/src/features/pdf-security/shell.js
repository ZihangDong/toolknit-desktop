import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';

function setInteractiveLayer(element, visible) {
  if (!element) return;
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

function safeFocus(element) {
  if (!element || element.closest?.('[inert], [aria-hidden="true"]')) return;
  try { element.focus({ preventScroll: true }); } catch (_) {}
}

function fileName(file) {
  return String(file?.name || file?.fileName || file?.path?.split(/[\\/]/).pop() || 'document.pdf');
}

function outputFolder(path) {
  return String(path || '').replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
}

export function createPdfSecurityShell({
  kind,
  overlay,
  isTauri = false,
  displayFilesystemPath,
  notify,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance,
  isBusy = () => false,
  allowBrowserDrop = false
} = {}) {
  const isEncrypt = kind === 'encrypt';
  const prefix = isEncrypt ? 'pdfEncrypt' : 'pdfDecrypt';
  const textBase = isEncrypt ? 'home.pdfEncrypt' : 'home.pdfDecrypt';
  const byId = id => document.getElementById(id);
  const plasmaBg = byId(`${prefix}PlasmaBg`);
  const backButton = byId(`${prefix}Back`);
  const dropZone = byId(`${prefix}DropZone`);
  const filesElement = byId(`${prefix}Files`);
  const ctaButton = byId(`${prefix}Cta`);
  const fileInput = byId(`${prefix}Input`);
  const processButton = byId(`${prefix}ProcessBtn`);
  const processMask = byId(`${prefix}ProcessMask`);
  const processFill = byId(`${prefix}ProcessBarFill`);
  const processText = byId(`${prefix}ProcessText`);
  const successOverlay = byId(`${prefix}SuccessOverlay`);
  const successPath = byId(`${prefix}SuccessPath`);
  const successMeta = byId(`${prefix}SuccessMeta`);
  const successCount = byId(`${prefix}SuccessCount`);
  const successOpenFolder = byId(`${prefix}SuccessOpenFolder`);
  const successOk = byId(`${prefix}SuccessOk`);
  const passwordDialog = byId(`${prefix}PasswordDialog`);
  const passwordInput = byId(`${prefix}PasswordInput`);
  const confirmInput = isEncrypt ? byId('pdfEncryptConfirmInput') : null;
  const passwordCancel = byId(`${prefix}PasswordCancel`);
  const passwordConfirm = byId(`${prefix}PasswordConfirm`);
  const topbar = overlay?.querySelector('.pdf-merge-v2-topbar');
  const topbarNextSibling = topbar?.nextSibling;
  const backLabel = backButton?.querySelector('[data-i18n]');
  const eyeButtons = isEncrypt
    ? [byId('pdfEncryptEyeBtn1'), byId('pdfEncryptEyeBtn2')]
    : [byId('pdfDecryptEyeBtn')];
  const permissionInputs = isEncrypt
    ? [
        'pdfEncryptPermPrinting',
        'pdfEncryptPermCopying',
        'pdfEncryptPermModifying',
        'pdfEncryptPermAnnotating',
        'pdfEncryptPermFilling',
        'pdfEncryptPermAccessibility',
        'pdfEncryptPermAssembly',
        'pdfEncryptPermHighQualityPrint'
      ].map(byId)
    : [];

  if (!overlay || !filesElement || !processButton || !passwordDialog) {
    return {
      open() {},
      close() {},
      dispose() {},
      setActions() {}
    };
  }
  if (typeof displayFilesystemPath !== 'function') {
    throw new Error(`pdf-${kind}:missing-path-display`);
  }

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  let disposed = false;
  let session = null;
  let selectedFile = null;
  let plasmaInstance = null;
  let returnFocus = null;
  let savedPath = '';
  let successResult = null;
  let actions = {};
  let buttonRevision = 0;
  const passwordSession = createModalSession({
    root: passwordDialog,
    background: overlay,
    initialFocus: passwordInput,
    onClose: () => hidePassword({ focusProcess: true }),
    canClose: () => !isBusy()
  });

  function renderBackLabel() {
    const key = passwordDialog.classList.contains('visible') ? 'common.backToPrevious' : 'settings.back';
    if (backLabel) {
      backLabel.dataset.i18n = key;
      backLabel.textContent = t(key);
    }
    if (backButton) {
      backButton.dataset.i18nTitle = key;
      backButton.title = t(key);
    }
  }

  const showToast = (message, duration = 7000) => {
    if (disposed) return;
    if (typeof notify === 'function') notify(message, { duration, dismissible: true });
    else window.showToast?.(message, { duration, dismissible: true });
  };

  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible');

  function setActions(nextActions) {
    actions = nextActions && typeof nextActions === 'object' ? nextActions : {};
  }

  function setProgress(percent, message) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processFill) processFill.style.width = `${value}%`;
    if (message && processText) processText.textContent = message;
    processMask?.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(value));
  }

  function setProcessing(visible, percent = 0, message = '') {
    setInteractiveLayer(processMask, visible);
    setProgress(percent, message);
  }

  function hideDropZone() {
    dropZone?.classList.remove('visible');
    overlay.classList.remove('drag-over');
  }

  function showDropZone() {
    if (isBusy() || passwordDialog.classList.contains('visible')) return;
    dropZone?.classList.add('visible');
    overlay.classList.add('drag-over');
  }

  function clearPassword() {
    [passwordInput, confirmInput].forEach(input => {
      if (!input) return;
      input.value = '';
      input.type = 'password';
    });
    eyeButtons.forEach(button => button?.classList.remove('show'));
  }

  function hidePassword({ focusProcess = false } = {}) {
    passwordSession.close({ restore: focusProcess });
    setInteractiveLayer(passwordDialog, false);
    if (topbar?.parentElement === passwordDialog) {
      overlay.insertBefore(topbar, topbarNextSibling?.parentNode === overlay ? topbarNextSibling : null);
    }
    renderBackLabel();
    clearPassword();
    if (focusProcess) safeFocus(processButton);
  }

  function showPassword() {
    if (!selectedFile || isBusy() || passwordDialog.classList.contains('visible')) return;
    clearPassword();
    permissionInputs.forEach(input => { if (input) input.checked = true; });
    // Reparent the actual tool bar: no cloned IDs, duplicate controls or
    // independent navigation styling to drift from the template page.
    if (topbar) passwordDialog.prepend(topbar);
    passwordSession.open();
    renderBackLabel();
  }

  function hideSuccess({ focusProcess = false } = {}) {
    setInteractiveLayer(successOverlay, false);
    if (focusProcess) safeFocus(processButton);
  }

  function renderSuccess() {
    if (!successResult) return;
    if (successCount) successCount.textContent = String(successResult.count);
    if (successPath) {
      successPath.textContent = displayFilesystemPath(successResult.path);
      successPath.title = displayFilesystemPath(successResult.path);
    }
    if (successMeta) successMeta.textContent = t(`${textBase}.successMeta`);
  }

  function showSuccess(path, count = 1) {
    savedPath = String(path || '');
    successResult = { path: savedPath, count };
    renderSuccess();
    setInteractiveLayer(successOverlay, true);
    safeFocus(successOk || successOpenFolder);
  }

  function updateProcessButton() {
    const revision = ++buttonRevision;
    if (selectedFile) {
      processButton.style.display = '';
      const owner = session;
      const frame = requestAnimationFrame(() => {
        if (revision === buttonRevision && (!owner || isOpenSession(owner))) {
          processButton.classList.add('visible');
        }
      });
      owner?.use(() => cancelAnimationFrame(frame));
      return;
    }
    processButton.classList.remove('visible');
    const finish = () => {
      if (revision === buttonRevision && !selectedFile) processButton.style.display = 'none';
    };
    if (!session) {
      finish();
      return;
    }
    const release = session.event(processButton, 'transitionend', event => {
      if (event.propertyName !== 'opacity') return;
      release();
      finish();
    });
    session.timeout(() => {
      release();
      finish();
    }, 320);
  }

  function renderFiles() {
    filesElement.replaceChildren();
    filesElement.classList.toggle('has-files', Boolean(selectedFile));
    if (selectedFile) {
      const item = document.createElement('div');
      item.className = 'audio-convert-file-item';
      item.dataset.index = '0';
      const index = document.createElement('span');
      index.className = 'audio-convert-file-index';
      index.textContent = '1';
      const name = document.createElement('span');
      name.className = 'audio-convert-file-name';
      name.textContent = fileName(selectedFile);
      name.title = fileName(selectedFile);
      const remove = document.createElement('button');
      remove.className = 'audio-convert-file-remove';
      remove.type = 'button';
      remove.dataset.action = 'remove-file';
      remove.setAttribute('aria-label', 'remove');
      const icon = document.createElement('i');
      icon.dataset.lucide = 'x';
      remove.append(icon);
      item.append(index, name, remove);
      filesElement.append(item);
      refreshIcons();
    }
    updateProcessButton();
  }

  function setFileList(fileList, owner = session) {
    const files = Array.from(fileList || []);
    if (!isOpenSession(owner) || !files.length || isBusy()
      || passwordDialog.classList.contains('visible')) return false;
    if (files.length !== 1) {
      window.alert(t(`${textBase}.singleFileOnly`));
      return false;
    }
    selectedFile = files[0];
    renderFiles();
    return true;
  }

  function clearFile() {
    if (isBusy()) return;
    selectedFile = null;
    renderFiles();
  }

  async function requestFile() {
    const owner = session;
    if (!isOpenSession(owner) || isBusy() || passwordDialog.classList.contains('visible')) return;
    if (!isTauri) {
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      if (!isOpenSession(owner) || typeof selected !== 'string') return;
      setFileList([{
        name: selected.split(/[\\/]/).pop() || selected,
        path: selected,
        size: 0
      }], owner);
    } catch (error) {
      if (isOpenSession(owner)) console.error(`[PDF ${isEncrypt ? 'Encrypt' : 'Decrypt'}] file selection failed:`, error);
    }
  }

  async function registerNativeDrop(owner) {
    if (!isTauri || !isOpenSession(owner)) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      if (!isOpenSession(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || isBusy() || passwordDialog.classList.contains('visible')) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') showDropZone();
        else if (payload.type === 'leave') hideDropZone();
        else if (payload.type === 'drop') {
          hideDropZone();
          const files = Array.from(payload.paths || [])
            .filter(path => path.toLowerCase().endsWith('.pdf'))
            .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
          if (files.length) setFileList(files, owner);
        }
      });
      if (!isOpenSession(owner)) {
        unlisten();
        return;
      }
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error(`[PDF ${isEncrypt ? 'Encrypt' : 'Decrypt'}] native drag-drop setup failed:`, error);
    }
  }

  async function openSavedFolder() {
    if (!isTauri || !savedPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: savedPath });
    } catch (error) {
      console.error(`[PDF ${isEncrypt ? 'Encrypt' : 'Decrypt'}] open folder failed:`, error);
    }
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || overlay.inert || !overlay.classList.contains('visible') || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (passwordDialog.classList.contains('visible')) hidePassword({ focusProcess: true });
    else if (successOverlay?.classList.contains('visible')) hideSuccess({ focusProcess: true });
    else if (isBusy()) showToast(t(`${textBase}.${isEncrypt ? 'encrypting' : 'decrypting'}`));
    else void close();
  }

  function bindSession(owner) {
    if (allowBrowserDrop && !isTauri) {
      owner.event(overlay, 'dragover', event => {
        event.preventDefault();
        showDropZone();
      });
      owner.event(overlay, 'dragleave', event => {
        if (!overlay.contains(event.relatedTarget)) hideDropZone();
      });
      owner.event(overlay, 'drop', event => {
        event.preventDefault();
        hideDropZone();
        setFileList(event.dataTransfer?.files, owner);
      });
    }
    void registerNativeDrop(owner);
  }

  function open() {
    if (disposed) return;
    if (isOpenSession(session)) return;
    returnFocus = document.activeElement;
    session?.dispose();
    session = createLifecycleScope();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.inert = false;
    if (plasmaBg && !plasmaInstance) plasmaInstance = initStandardToolPlasma(plasmaBg);
    hideDropZone();
    setProcessing(false);
    hidePassword();
    hideSuccess();
    bindSession(session);
    renderFiles();
    const owner = session;
    requestAnimationFrame(() => {
      if (isOpenSession(owner)) safeFocus(selectedFile ? processButton : ctaButton || backButton);
    });
    void actions.afterOpen?.(owner);
  }

  async function close({ force = false, restoreFocus = true } = {}) {
    if (isBusy() && !force) {
      showToast(t(`${textBase}.${isEncrypt ? 'encrypting' : 'decrypting'}`));
      return false;
    }
    const focusTarget = returnFocus;
    returnFocus = null;
    const owner = session;
    session = null;
    owner?.dispose();
    hideDropZone();
    setProcessing(false);
    hidePassword();
    hideSuccess();
    selectedFile = null;
    savedPath = '';
    successResult = null;
    if (fileInput) fileInput.value = '';
    renderFiles();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    if (restoreFocus) safeFocus(focusTarget);
    return true;
  }

  listen(backButton, 'click', () => {
    if (passwordDialog.classList.contains('visible')) hidePassword({ focusProcess: true });
    else void close();
  });
  listen(ctaButton, 'click', () => { void requestFile(); });
  listen(fileInput, 'change', event => {
    setFileList(event.target.files, session);
    event.target.value = '';
  });
  listen(filesElement, 'click', event => {
    const remove = event.target.closest('[data-action="remove-file"]');
    if (!remove) return;
    event.stopPropagation();
    clearFile();
  });
  listen(processButton, 'click', showPassword);
  listen(passwordCancel, 'click', () => hidePassword({ focusProcess: true }));
  listen(passwordConfirm, 'click', () => { void actions.confirm?.(session); });
  eyeButtons.forEach(button => {
    const input = button?.parentElement?.querySelector('input');
    if (!button || !input) return;
    listen(button, 'click', event => {
      event.preventDefault();
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.classList.toggle('show', hidden);
      safeFocus(input);
    });
  });
  if (confirmInput) {
    listen(passwordInput, 'keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      safeFocus(confirmInput);
    });
    listen(confirmInput, 'keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void actions.confirm?.(session);
    });
  } else {
    listen(passwordInput, 'keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void actions.confirm?.(session);
    });
  }
  listen(successOk, 'click', () => hideSuccess({ focusProcess: true }));
  listen(successOpenFolder, 'click', () => { void openSavedFolder(); });
  listen(document, 'keydown', handleKeydown);
  lifecycle.use(onLangChange(() => { renderSuccess(); renderBackLabel(); }) || (() => {}));
  listen(window, 'beforeunload', () => { void dispose(); }, { once: true });

  setInteractiveLayer(passwordDialog, false);
  setInteractiveLayer(successOverlay, false);
  setProcessing(false);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  renderFiles();

  async function dispose() {
    if (disposed) return;
    await close({ force: true, restoreFocus: false });
    disposed = true;
    lifecycle.dispose();
  }

  return {
    clearPassword,
    close,
    dispose,
    getConfirmPassword: () => confirmInput?.value || '',
    getFile: () => selectedFile,
    getPassword: () => passwordInput?.value || '',
    getPermission: id => Boolean(byId(id)?.checked),
    getSession: () => session,
    hidePassword,
    isOpenSession,
    open,
    setActions,
    setFileList,
    setProcessing,
    setProgress,
    showPassword,
    showSuccess,
    showToast
  };
}
