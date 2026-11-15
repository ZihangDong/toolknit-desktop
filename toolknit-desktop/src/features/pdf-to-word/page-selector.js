// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { applyTranslations, onLangChange } from '../../i18n.js';
import { parsePageRange, LIMITS, wordError } from './core/input.js';
import { wordButton } from './template.js';

export function createWordPageSelector({ root, tr, confirm, back: onBack, refreshIcons }) {
  const scope = createLifecycleScope(), strip = document.createElement('div'), back = document.createElement('button'), actions = document.createElement('div');
  back.type = 'button'; actions.className = 'pdf-workbench-actions';
  actions.innerHTML = `<div class="pdf-word-select-buttons">${wordButton('SelectAll', 'check-check', 'selectAll')}${wordButton('SelectNone', 'square', 'selectNone')}${wordButton('SelectInvert', 'flip-horizontal-2', 'selectInvert')}</div><form id="pdfWordSelectForm"><label for="pdfWordSelectRange" data-i18n="home.pdfWord.selectRange"></label><div class="pdf-word-range-row"><input id="pdfWordSelectRange" type="text" maxlength="1000" placeholder="1-10, 15-20"><button type="submit" class="pdf-word-button" data-i18n="home.pdfWord.selectAppend"></button></div><p class="pdf-word-hint" data-i18n="home.pdfWord.selectHint"></p></form><p id="pdfWordSelectStatus" class="pdf-word-status" role="status"></p>${wordButton('SelectConfirm', 'check', 'selectConfirm', 'data-export-primary disabled')}`;
  const get = id => actions.querySelector('#pdfWord' + id);
  const workbench = createPdfWorkbench({ root, pageStrip: strip, back, actions, tag: 'PDF TO WORD · SELECT PAGES', layout: 'select-right',
    labels: { back: 'home.pdfWord.selectBack', selectedCount: 'home.pdfWord.selectedCount', sourcePage: 'home.pdfWord.pageLabel' }, refreshIcons,
    onChange: ({ count }) => { get('SelectConfirm').disabled = count < 1 || count > LIMITS.selectedPages;
      get('SelectStatus').textContent = count > LIMITS.selectedPages ? tr('error.selection-large') : tr('selectedCount', { count }); } });
  scope.event(back, 'click', onBack);
  for (const [id, mode] of [['SelectAll', 'all'], ['SelectNone', 'none'], ['SelectInvert', 'invert']]) scope.event(get(id), 'click', () => {
    workbench.getPages().forEach(page => { page.selected = mode === 'all' || mode === 'invert' && !page.selected; }); workbench.refresh();
  });
  scope.event(get('SelectForm'), 'submit', event => { event.preventDefault();
    try {
      const input = get('SelectRange'); if (!input.value.trim()) throw wordError('range');
      const numbers = new Set(parsePageRange(input.value, workbench.getPages().length));
      workbench.getPages().forEach(page => { if (numbers.has(page.pageIndex)) page.selected = true; });
      input.value = ''; workbench.refresh(); input.focus();
    } catch (error) { get('SelectStatus').textContent = tr('error.' + error.code); }
  });
  scope.event(get('SelectConfirm'), 'click', () => {
    const pages = workbench.getPages().filter(page => page.selected).map(page => page.pageIndex);
    if (pages.length && pages.length <= LIMITS.selectedPages) confirm(pages);
  });
  const translate = () => { applyTranslations(actions); root.setAttribute('aria-label', tr('selectPages')); workbench.refresh(); };
  scope.use(onLangChange(translate)); translate();
  return { open(pdf, name) { workbench.setPages(Array.from({ length: pdf.numPages }, (_, index) => ({ pageIndex: index + 1, fileName: name, selected: false })), entry => pdf.getPage(entry.pageIndex)); },
    clear() { workbench.clear(); get('SelectRange').value = ''; get('SelectStatus').textContent = ''; },
    dispose() { workbench.dispose(); scope.dispose(); } };
}
