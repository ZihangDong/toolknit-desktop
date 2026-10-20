// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const tr = key => '<span data-i18n="home.pdfWord.' + key + '"></span>';
const button = (id, icon, key, attrs = '', iconOnly = false) => '<button id="pdfWord' + id + '" type="button" class="pdf-word-button" data-i18n-title="home.pdfWord.' + key + '" data-i18n-aria-label="home.pdfWord.' + key + '" ' + attrs + '><i data-lucide="' + icon + '"></i>' + (iconOnly ? '' : tr(key)) + '</button>';
const icon = (id, name, key, attrs = '') => button(id, name, key, attrs, true);
const modal = (id, title, contents) => '<div id="pdfWord' + id + 'Overlay" class="pdf-word-modal" role="dialog" aria-modal="true" aria-labelledby="pdfWord' + id + 'Title" aria-hidden="true" inert><div class="pdf-word-dialog"><h2 id="pdfWord' + id + 'Title" data-i18n="home.pdfWord.' + title + '"></h2>' + contents + '</div></div>';
export default '<div id="pdfWordOverlay" class="pdf-word tool-page-v2-overlay" role="dialog" aria-modal="true" aria-hidden="true" inert><div class="pdf-word-shell">'
  + toolTopbarMarkup({ tag: 'PDF TO WORD · TOOL PAGE 3.2', closeAttr: 'data-pdf-word-close' })
  + '<div class="pdf-word-toolbar"><h1 data-i18n="home.pdfWord.title"></h1><span id="pdfWordFileName" class="pdf-word-file"></span>'
  + button('Pick', 'folder-open', 'pick')
  + '<input id="pdfWordFileInput" type="file" accept="application/pdf,.pdf" hidden></div>'
  + '<div id="pdfWordEmpty" class="pdf-word-empty"><div class="pdf-word-empty-icon"><i data-lucide="file-pen-line"></i></div>'
  + '<span class="pdf-word-kicker">LOCAL PDF WORKSPACE</span><h2 data-i18n="home.pdfWord.empty"></h2><p data-i18n="home.pdfWord.emptyHint"></p>'
  + button('EmptyPick', 'upload', 'pick', 'data-export-primary')
  + '<small data-i18n="home.pdfWord.limit"></small></div>'
  + '<div id="pdfWordLoaded" class="pdf-word-body" hidden><aside class="pdf-word-options">'
  + '<div class="pdf-word-settings"><label data-i18n="home.pdfWord.mode"></label><div class="pdf-word-segments" role="group" data-i18n-aria-label="home.pdfWord.mode">'
  + button('Local', 'hard-drive', 'local', 'data-word-mode="local" aria-pressed="true"')
  + button('Ai', 'sparkles', 'ai', 'data-word-mode="ai" aria-pressed="false"') + '</div><p id="pdfWordPrivacy" class="pdf-word-hint"></p>'
  + '<label for="pdfWordRange" data-i18n="home.pdfWord.range"></label><input id="pdfWordRange" type="text" placeholder="1-3, 5" maxlength="1000"><span id="pdfWordMeta" class="pdf-word-hint"></span>'
  + '<label data-i18n="home.pdfWord.layout"></label><div class="pdf-word-segments" role="group" data-i18n-aria-label="home.pdfWord.layout">'
  + button('Faithful', 'panels-top-left', 'faithful', 'data-word-layout="faithful" aria-pressed="true"')
  + button('Flow', 'align-left', 'flow', 'data-word-layout="flow" aria-pressed="false"') + '</div><p class="pdf-word-hint" data-i18n="home.pdfWord.scope"></p></div>'
  + '<div class="pdf-word-primary">' + button('Reset', 'rotate-ccw', 'reset', 'disabled') + button('Export', 'download', 'export', 'disabled data-export-primary') + '</div>'
  + '<p id="pdfWordStatus" class="pdf-word-status" role="status" aria-live="polite"></p></aside>'
  + '<main class="pdf-word-workspace"><div class="pdf-word-preview-toolbar"><span id="pdfWordPreviewLabel" data-i18n="home.pdfWord.originalPreview"></span><div class="pdf-word-zoom">'
  + icon('Undo', 'undo-2', 'undo', 'disabled') + icon('Redo', 'redo-2', 'redo', 'disabled')
  + icon('ZoomOut', 'zoom-out', 'zoomOut') + button('ZoomFit', 'maximize', 'fit') + icon('ZoomIn', 'zoom-in', 'zoomIn')
  + icon('PagesToggle', 'panel-right', 'pages', 'aria-expanded="true" aria-controls="pdfWordPages"') + '</div></div>'
  + '<div id="pdfWordPreview" class="pdf-word-preview"><div id="pdfWordPaper" class="pdf-word-paper"><canvas id="pdfWordCanvas"></canvas><div id="pdfWordRegions" class="pdf-word-regions"></div></div></div>'
  + '<div id="pdfWordSelection" class="pdf-word-selection" hidden><span id="pdfWordSelectionType"></span>'
  + button('Edit', 'pencil', 'edit') + button('Replace', 'image-plus', 'replace') + button('Delete', 'trash-2', 'delete')
  + icon('Deselect', 'x', 'deselect') + '<input id="pdfWordImageInput" type="file" accept="image/png,image/jpeg" hidden></div></main>'
  + '<aside id="pdfWordPages" class="pdf-word-pages"><div class="pdf-word-pagination">'
  + icon('Prev', 'chevron-left', 'previous') + '<label class="pdf-word-page-field"><input id="pdfWordPageInput" type="number" min="1" step="1" data-i18n-aria-label="home.pdfWord.pageJump"><span id="pdfWordPageNumber"></span></label>' + icon('Next', 'chevron-right', 'next') + '</div>'
  + button('Structure', 'scan', 'structure', 'aria-pressed="false"') + '<div id="pdfWordThumbnails" class="pdf-word-thumbnails" data-i18n-aria-label="home.pdfWord.pages"></div></aside></div>'
  + '<p id="pdfWordEmptyStatus" class="pdf-word-empty-status" role="status" aria-live="polite"></p></div></div>'
  + '<div id="pdfWordProgressOverlay" class="pdf-word-process" role="dialog" aria-modal="true" aria-labelledby="pdfWordProgressTitle" aria-hidden="true" inert><canvas id="pdfWordProgressCanvas" aria-hidden="true"></canvas>'
  + '<h2 id="pdfWordProgressTitle"></h2><p data-i18n="home.pdfWord.processingHint"></p><p id="pdfWordProgressQuote" class="pdf-word-hint"></p>' + button('Cancel', 'x', 'cancel') + '</div>'
  + modal('Password', 'passwordTitle', '<form id="pdfWordPasswordForm"><p id="pdfWordPasswordHint"></p><input id="pdfWordPassword" type="password" autocomplete="off" data-i18n-aria-label="home.pdfWord.passwordTitle"><div class="pdf-word-dialog-actions">'
    + button('PasswordCancel', 'x', 'cancel') + '<button class="pdf-word-button" type="submit" data-export-primary>' + tr('unlock') + '</button></div></form>')
  + modal('Success', 'success', '<div class="pdf-word-success-icon"><i data-lucide="check"></i></div><p id="pdfWordResultName"></p><p id="pdfWordResultQuality" class="pdf-word-hint"></p><p id="pdfWordResultPath" class="pdf-word-path"></p><div class="pdf-word-dialog-actions">'
    + button('OpenFolder', 'folder-open', 'openFolder') + button('OpenFile', 'file-text', 'openFile') + button('SuccessOk', 'check', 'done', 'data-export-primary') + '</div>')
  + modal('Edit', 'editText', '<form id="pdfWordEditForm"><textarea id="pdfWordEditText" rows="6" maxlength="10000" data-i18n-aria-label="home.pdfWord.editText"></textarea><p id="pdfWordEditError" class="pdf-word-status is-error" role="status"></p><div class="pdf-word-dialog-actions">'
    + button('EditCancel', 'x', 'cancel') + '<button class="pdf-word-button" type="submit" data-export-primary>' + tr('apply') + '</button></div></form>')
  + modal('Confirm', 'confirmTitle', '<p id="pdfWordConfirmMessage"></p><div class="pdf-word-dialog-actions">' + button('ConfirmCancel', 'x', 'cancel') + button('ConfirmOk', 'check', 'continue', 'data-export-primary') + '</div>');
