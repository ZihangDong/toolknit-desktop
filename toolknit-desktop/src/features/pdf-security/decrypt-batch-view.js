import { t } from '../../i18n.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';

export const decryptText = (key, params) => t(`home.pdfDecrypt.${key}`, params);
export function decryptErrorText(code) {
  const keys = {
    'invalid-password': 'wrongPassword', 'input-too-large': 'fileTooLarge',
    'too-many-pages': 'tooManyPages', 'invalid-pdf': 'invalidPdf',
    'desktop-only': 'desktopOnly', 'qpdf-unavailable': 'engineUnavailable',
    'output-path': 'outputPathError', 'too-many-files': 'tooManyFiles',
    'password-unsupported': 'passwordUnsupported'
  };
  return decryptText(keys[code] || 'decryptFailed');
}

export function createDecryptBatchView({ overlay, getRows, getOperation, getNotice, onRemove, onRetry, onCancel, onClear, onReveal, refreshIcons = () => {} }) {
  const scope = createLifecycleScope(), doc = overlay.ownerDocument;
  const q = id => doc.getElementById(`pdfDecrypt${id}`);
  const files = q('Files');
  const node = (tag, className, text) => {
    const value = doc.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };
  function button(label, action, id) {
    const value = node('button', 'pdf-decrypt-row-action', label);
    value.type = 'button'; value.dataset[action] = id;
    return value;
  }
  function render() {
    const rows = getRows(), operation = getOperation(), busy = Boolean(operation);
    const focused = doc.activeElement;
    const restore = focused?.closest('[data-decrypt-row]')?.dataset.decryptRow;
    const field = focused?.dataset.decryptField;
    const fragment = doc.createDocumentFragment();
    for (const row of rows) {
      const item = node('div', 'pdf-decrypt-batch-row');
      item.dataset.decryptRow = row.id; item.dataset.status = row.status;
      const heading = node('div', 'pdf-decrypt-row-heading');
      const name = node('span', 'audio-convert-file-name', row.file.name);
      name.title = row.file.path || row.file.name;
      const status = node('span', 'pdf-decrypt-row-status', decryptText(`states.${row.status}`));
      heading.append(name, status);
      const controls = node('div', 'pdf-decrypt-row-controls');
      const modeLabel = node('label', 'pdf-decrypt-password-mode');
      const modeText = node('span', '', decryptText('filePasswordMode'));
      const mode = node('select');
      mode.dataset.decryptField = 'mode'; mode.dataset.decryptId = row.id;
      mode.setAttribute('aria-label', `${decryptText('filePasswordMode')} · ${row.file.name}`);
      for (const [value, label] of [['shared', 'sharedPassword'], ['own', 'ownPassword']]) {
        const option = node('option', '', decryptText(label)); option.value = value; mode.append(option);
      }
      mode.value = row.passwordMode;
      mode.disabled = busy || row.status === 'succeeded';
      modeLabel.append(modeText, mode);
      const password = node('input', 'pdf-decrypt-file-password');
      password.type = 'password'; password.autocomplete = 'off'; password.maxLength = 1024;
      password.spellcheck = false; password.dataset.decryptField = 'password'; password.dataset.decryptId = row.id;
      password.setAttribute('aria-label', `${decryptText('ownPassword')} · ${row.file.name}`);
      password.placeholder = decryptText('ownPasswordHint');
      password.hidden = row.passwordMode !== 'own';
      password.disabled = busy || row.status === 'succeeded'; password.value = row.password;
      controls.append(modeLabel, password);
      const actions = node('div', 'pdf-decrypt-row-actions');
      if (row.outputPath) actions.append(button(decryptText('revealResult'), 'decryptReveal', row.id));
      if (['failed', 'cancelled'].includes(row.status)) actions.append(button(decryptText('retryFile'), 'decryptRetry', row.id));
      const remove = button(decryptText('removeFile'), 'decryptRemove', row.id);
      remove.setAttribute('aria-label', `${decryptText('removeFile')} · ${row.file.name}`);
      actions.append(remove);
      actions.querySelectorAll('button').forEach(value => { value.disabled = busy; });
      item.append(heading);
      if (row.status !== 'succeeded') item.append(controls);
      if (row.error) item.append(node('p', 'pdf-decrypt-row-error', decryptErrorText(row.error)));
      if (row.outputPath) {
        const output = node('p', 'pdf-decrypt-row-output', row.outputPath);
        output.title = row.outputPath; item.append(output);
      }
      item.append(actions); fragment.append(item);
    }
    if (!rows.length) fragment.append(node('p', 'pdf-decrypt-queue-empty', decryptText('emptyQueue')));
    files.replaceChildren(fragment);
    files.classList.toggle('has-files', rows.length > 0);
    if (restore && field) {
      const row = [...files.children].find(value => value.dataset.decryptRow === restore);
      const target = row?.querySelector(`[data-decrypt-field="${field}"]`);
      if (target && !target.disabled && !target.hidden) target.focus({ preventScroll: true });
    }
    const retries = rows.some(row => ['failed', 'cancelled'].includes(row.status));
    const pending = rows.some(row => row.status === 'pending');
    q('ProcessBtn').disabled = busy || !pending;
    q('Cta').disabled = busy;
    q('Input').disabled = busy;
    q('BatchRetry').hidden = !retries;
    q('BatchRetry').disabled = busy;
    q('BatchClear').disabled = busy || !rows.length;
    q('BatchCancel').hidden = !busy;
    q('BatchCancel').disabled = Boolean(operation?.controller.signal.aborted);
    q('BatchCancel').textContent = decryptText(operation?.controller.signal.aborted ? 'stopping' : 'stopQueue');
    q('BatchProgress').hidden = !busy;
    q('BatchProgress').value = operation?.done || 0;
    q('BatchProgress').max = operation?.total || 1;
    const notice = getNotice();
    q('BatchSummary').textContent = notice ? decryptText(notice.key, notice.params) : decryptText('queueCount', { count: rows.length });
    q('BatchSummary').classList.toggle('is-error', Boolean(notice?.error));
    refreshIcons();
  }
  scope.event(files, 'input', event => {
    if (getOperation() || event.target.dataset.decryptField !== 'password') return;
    const row = getRows().find(value => value.id === event.target.dataset.decryptId);
    if (row && row.status !== 'succeeded') row.password = event.target.value;
  });
  scope.event(files, 'change', event => {
    if (getOperation() || event.target.dataset.decryptField !== 'mode') return;
    const row = getRows().find(value => value.id === event.target.dataset.decryptId);
    if (!row || row.status === 'succeeded') return;
    row.passwordMode = event.target.value === 'own' ? 'own' : 'shared';
    row.password = ''; render();
  });
  scope.event(files, 'click', event => {
    const control = event.target.closest('button');
    if (!control || control.disabled) return;
    if (control.dataset.decryptRemove) onRemove(control.dataset.decryptRemove);
    else if (control.dataset.decryptRetry) onRetry([control.dataset.decryptRetry]);
    else if (control.dataset.decryptReveal) void onReveal(control.dataset.decryptReveal);
  });
  scope.event(q('BatchRetry'), 'click', () => onRetry(getRows().filter(row => ['failed', 'cancelled'].includes(row.status)).map(row => row.id)));
  scope.event(q('BatchCancel'), 'click', onCancel);
  scope.event(q('BatchClear'), 'click', onClear);
  return { render, dispose: () => scope.dispose() };
}
