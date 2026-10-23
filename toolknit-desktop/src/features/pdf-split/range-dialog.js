import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { selectPdfSplitRange } from './selection.js';

export function createPdfSplitRangeDialog({ root, workspace, trigger, getPages, isLocked, onSelect }) {
  const scope = createLifecycleScope();
  const find = selector => root.querySelector(selector);
  const input = find('[data-range-input]');
  const status = find('[data-range-status]');
  const error = find('[data-range-error]');
  let feedback = null;
  const modal = createModalSession({ root, background: workspace, initialFocus: input, onClose: () => close() });

  function update() {
    applyTranslations(root);
    const pages = getPages();
    find('[data-range-count]').textContent = t('home.pdfSplit.selectionStatus', { selected: pages.filter(page => page.selected).length, total: pages.length });
    find('[data-range-limit]').textContent = t('home.pdfSplit.rangeLimit', { total: pages.length });
    status.textContent = feedback?.result ? t(feedback.result.added ? 'home.pdfSplit.rangeAdded' : 'home.pdfSplit.rangeAlreadySelected', feedback.result) : '';
    error.textContent = feedback?.error ? t(`home.pdfSplit.${feedback.error}`, { total: pages.length }) : '';
    error.hidden = !feedback?.error;
    input.setAttribute('aria-invalid', String(Boolean(feedback?.error)));
  }
  function reset() { input.value = ''; feedback = null; update(); }
  function close(options) { modal.close(options); reset(); }
  function open() {
    if (isLocked() || !getPages().length || !workspace.classList.contains('visible') || workspace.inert) return;
    reset(); modal.open();
  }
  scope.event(trigger, 'click', open);
  root.querySelectorAll('[data-range-close]').forEach(button => scope.event(button, 'click', () => close()));
  scope.event(root, 'click', event => { if (event.target === root) close(); });
  scope.event(input, 'input', () => { feedback = null; update(); });
  scope.event(find('form'), 'submit', event => {
    event.preventDefault();
    if (isLocked() || root.inert || !workspace.classList.contains('visible')) return;
    try {
      feedback = { result: selectPdfSplitRange(getPages(), input.value) };
      input.value = '';
      onSelect();
    } catch (failure) { feedback = { error: failure.code || 'rangeFormat' }; }
    update(); input.focus({ preventScroll: true });
  });
  scope.use(onLangChange(update));
  return { close, dispose() { close({ restore: false }); modal.dispose(); scope.dispose(); } };
}
