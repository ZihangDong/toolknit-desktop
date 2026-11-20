import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
export function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
export function action(label, callback, { disabled = false, title } = {}) {
  const button = element('button', label); button.type = 'button'; button.disabled = disabled; if (title) button.title = title;
  button.addEventListener('click', () => { Promise.resolve().then(callback).catch(error => console.error(error)); }); return button;
}
export async function saveText({ text, name, isTauri, invoke, getOutputDir, folder = 'Documents' }) {
  const bytes = new TextEncoder().encode(text);
  if (isTauri) return writeUniqueBinaryFile(invoke, { directory: await getOutputDir(folder), fileName: name, bytes });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); return '';
}
export function bindActions(root, handlers, showMessage, signal) {
  root.addEventListener('click', event => {
    const control = event.target.closest('[data-wb-action]');
    if (!control || control.disabled || !handlers[control.dataset.wbAction]) return;
    void Promise.resolve().then(handlers[control.dataset.wbAction]).catch(error => showMessage(error.message || error, true));
  }, { signal });
}
export const basename = value => String(value || '').split(/[\\/]/).pop();
