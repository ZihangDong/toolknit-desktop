// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { startScanAnimation } from '../../shared/curve-loading.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { createLocalOcrRuntime } from '../../platform/local-ocr-runtime.js';
import { t, onLangChange, applyTranslations } from '../../i18n.js';
import { LIMITS, wordError, validateInput, outputName } from './core/input.js';
import { analyzeWordDocument, publishWord } from './processor.js';
import { createWordPageSelector } from './page-selector.js';
import { downloadWord, wordErrorKey } from './output.js';
import { createConversionDeadline } from './deadline.js';

export function createPdfWordController({ overlay, isTauri = false, getOutputDir, displayFilesystemPath = value => value,
  refreshIcons = () => {}, openDocumentEditor, recognizePage: recognizeOverride } = {}) {
  const scope = createLifecycleScope(), byId = suffix => document.getElementById('pdfWord' + suffix);
  const tr = (key, params) => t('home.pdfWord.' + key, params);
  let owner = null, disposed = false, pdf = null, pdfjs = null, file = null, active = null, analysis = null;
  let result = null, status = null, progress = null, passwordUpdate = null, stopAnimation = null, pendingHandoff = null;
  const alive = session => Boolean(session && owner === session && !session.disposed);
  const current = op => active === op && alive(op.owner) && !op.cancelled;
  const processModal = createModalSession({ root: byId('ProgressOverlay'), background: overlay, initialFocus: byId('Cancel'), onClose: cancel, canClose: () => !active?.committing });
  const passwordModal = createModalSession({ root: byId('PasswordOverlay'), background: overlay, initialFocus: byId('Password'), onClose: cancel });
  const pagesModal = createModalSession({ root: byId('PagesOverlay'), background: overlay, initialFocus: byId('AllPages'), onClose: reset });
  const successModal = createModalSession({ root: byId('SuccessOverlay'), background: overlay, initialFocus: byId('EditDocument'), onClose: reset });
  const selector = createWordPageSelector({ root: byId('Selector'), tr, confirm: pages => { hideSelector(); void convert(pages); }, back: reset, refreshIcons });
  function setStatus(code, params = {}, error = false) { status = { code, params, error }; renderStatus(); }
  function renderStatus() { byId('Status').textContent = status ? tr(status.code, status.params) : ''; byId('Status').classList.toggle('is-error', Boolean(status?.error)); }
  function report(error) { const key = wordErrorKey(error); setStatus(key, {}, key !== 'cancelled'); }
  function setProgress(value) { progress = value; byId('ProgressTitle').textContent = tr(value.key, value); }
  function begin(kind) {
    const op = { owner, cancelled: false, committing: false, abort: new AbortController(), worker: null, renderTask: null, loadingTask: null, nativeCancel: null };
    op.check = () => { if (!current(op)) throw wordError('cancelled'); }; active = op;
    op.deadline = createConversionDeadline({ baseMs: LIMITS.timeoutMs, onTimeout: () => { if (current(op) && !op.committing) { cancel(); setStatus('error.timeout', {}, true); } } });
    op.addOcrBudget = () => op.deadline.addOcrPage();
    byId('EmptyPick').disabled = true; setProgress({ key: kind === 'load' ? 'loading' : 'preparing' });
    processModal.open(); stopAnimation?.(); stopAnimation = startScanAnimation(byId('ProgressCanvas'), byId('ProgressQuote'), tr); return op;
  }
  function end(op) {
    op.deadline.dispose(); if (active !== op) return;
    active = null; passwordUpdate = null; byId('Password').value = '';
    passwordModal.close({ restore: false }); processModal.close(); stopAnimation?.(); stopAnimation = null; byId('EmptyPick').disabled = false;
  }
  function cancel() {
    const op = active; if (!op || op.committing) return;
    op.cancelled = true; op.abort.abort(); op.nativeCancel?.(); op.worker?.dispose();
    try { op.renderTask?.cancel(); } catch {} void op.loadingTask?.destroy().catch(() => {});
    end(op); reset(); setStatus('cancelled');
  }
  function releasePdf() { const old = pdf; pdf = null; file = null; if (old) void destroyPdfDocument(old).catch(() => {}); }
  function hideSelector() { moveFocusOutOfHiddenRegion(byId('Selector')); byId('Selector').classList.remove('visible'); setModalInteractivity(byId('Selector'), false); selector.clear(); if (owner) setModalInteractivity(overlay, true); }
  function reset() {
    if (active) return;
    pagesModal.close({ restore: false }); successModal.close({ restore: false }); hideSelector();
    analysis?.worker?.dispose(); analysis = null; releasePdf(); result = null; status = null; pendingHandoff = null; byId('EmptyPick').disabled = false; renderStatus();
    if (owner && !overlay.inert) byId('EmptyPick').focus({ preventScroll: true });
  }
  async function loadFile(candidate) {
    if (!owner || active || result || pdf || disposed || pendingHandoff) return;
    const op = begin('load'); let task = null, adopted = false;
    try {
      // Give the processing mask a paint before PDF parsing or file decoding.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); op.check();
      let bytes;
      if (candidate.path) {
        const { invoke } = await tauriCorePromise; op.check();
        candidate = { ...candidate, size: Number(await invoke('get_file_size', { path: candidate.path })) }; op.check(); validateInput(candidate);
        bytes = Uint8Array.from(await invoke('read_file_bytes_limited', { path: candidate.path, maxBytes: LIMITS.inputBytes }));
      } else { validateInput(candidate); bytes = new Uint8Array(await candidate.arrayBuffer()); }
      op.check(); validateInput({ name: candidate.name, size: bytes.length });
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); op.check(); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes, isEvalSupported: false, enableXfa: false, fontExtraProperties: true, useSystemFonts: false })); op.loadingTask = task;
      task.onPassword = (callback, reason) => {
        if (!current(op)) return;
        passwordUpdate = callback; byId('Password').value = ''; byId('PasswordHint').textContent = tr(reason === 2 ? 'passwordWrong' : 'passwordHint');
        processModal.close({ restore: false }); stopAnimation?.(); stopAnimation = null; passwordModal.open();
      };
      const loaded = await task.promise; op.check();
      if (loaded.numPages > LIMITS.documentPages) throw wordError('pages');
      const permissions = await loaded.getPermissions(); op.check();
      if (permissions && !permissions.includes(pdfjs.PermissionFlag.COPY)) throw wordError('permission');
      pdf = loaded; file = candidate; adopted = true; op.loadingTask = null;
    } catch (error) { if (current(op)) report(error); }
    finally { if (task && !adopted) void task.destroy().catch(() => {}); end(op); }
    if (!adopted || !alive(op.owner)) return;
    if (pdf.numPages === 1) await convert([1]);
    else { byId('PagesMessage').textContent = tr('choosePagesHint', { count: pdf.numPages }) + (pdf.numPages > LIMITS.selectedPages ? ' ' + tr('choosePagesLimit') : ''); byId('AllPages').disabled = pdf.numPages > LIMITS.selectedPages; pagesModal.open(); }
  }
  async function pick() {
    if (!owner || active || pdf || result || pendingHandoff) return;
    if (!isTauri) { byId('FileInput').click(); return; }
    const session = owner;
    try { const { open } = await loadTauriDialog(); if (!alive(session)) return;
      const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (path && alive(session)) await loadFile({ path, name: path.split(/[\\/]/).pop() });
    } catch (error) { if (alive(session)) report(error); }
  }
  async function convert(pages) {
    if (!pdf || !file || active || !owner || !pages.length || pages.length > LIMITS.selectedPages) return;
    pagesModal.close({ restore: false }); const op = begin('convert'); const session = owner, name = outputName(file.name);
    let prepared;
    try {
      const localOcr = createLocalOcrRuntime({ isTauri });
      prepared = await analyzeWordDocument({ pdf, pages, ops: pdfjs.OPS, operation: op, preserveGeometry: true,
        preserveScanFigures: true, refineScanText: true,
        recognizePage: recognizeOverride || (isTauri ? async (canvas, signal) => {
          const resume = op.deadline.pause();
          try { await localOcr.ensure(signal); } finally { resume(); }
          op.check(); return localOcr.recognize(canvas.toDataURL('image/png'), signal);
        } : null),
        onProgress: value => { if (current(op)) setProgress(value); } }); op.check();
      setProgress({ key: 'assembling' });
      const output = await prepared.worker.request('finish', { document: prepared.document, options: { preserveGeometry: true, editableMath: true, strictMathGeometry: true } }); op.check();
      setProgress({ key: 'saving' });
      const path = await publishWord({ bytes: output.bytes, name, isTauri, getOutputDir, operation: op }); op.check();
      if (!isTauri) downloadWord(output.bytes, name, session);
      analysis = prepared; op.worker = null; result = { name: path ? path.split(/[\\/]/).pop() : name, path, quality: output.quality };
      releasePdf(); end(op); renderResult(); setStatus('success'); successModal.open();
    } catch (error) { if (current(op)) { prepared?.worker?.dispose(); end(op); reset(); report(error); } }
    finally { end(op); }
  }
  function renderResult() {
    if (!result) return;
    byId('ResultName').textContent = result.name; byId('ResultPath').textContent = result.path ? displayFilesystemPath(result.path) : tr('browserDownload');
    byId('OpenFolder').disabled = !result.path; byId('EditDocument').disabled = !openDocumentEditor;
    byId('ResultStatus').textContent = result.quality.imageCharacters ? tr('imageNotice') : '';
  }
  scope.event(byId('EditDocument'), 'click', async () => {
    if (!owner || !analysis || !result || !openDocumentEditor) return;
    const saved = result, converted = analysis, sourceOwner = owner; analysis = null; result = null;
    const ticket = pendingHandoff = Symbol('word-document'); byId('EmptyPick').disabled = true;
    successModal.close({ restore: false });
    // Detach before navigation closes this tool. The target editor owns release.
    const session = { document: converted.document, worker: converted.worker, name: saved.name, path: saved.path, canTransfer: () => alive(sourceOwner) && pendingHandoff === ticket,
      restore() { if (!alive(sourceOwner) || pendingHandoff !== ticket) return false; pendingHandoff = null; analysis = converted; result = saved; byId('EmptyPick').disabled = false; renderResult(); successModal.open(); return true; },
      release() { converted.worker.dispose(); } };
    try { await openDocumentEditor(session); }
    catch (error) { if (alive(sourceOwner) && analysis === converted) byId('ResultStatus').textContent = tr(wordErrorKey(error)); else if (!session.restore()) session.release(); }
  });
  scope.event(byId('OpenFolder'), 'click', async () => { if (!result?.path || !owner) return;
    const session = owner, saved = result;
    try { const { invoke } = await tauriCorePromise; if (alive(session) && result === saved) await invoke('open_path', { path: saved.path }); }
    catch (error) { if (alive(session) && result === saved) byId('ResultStatus').textContent = tr(wordErrorKey(error)); }
  });
  scope.event(byId('EmptyPick'), 'click', () => { void pick(); });
  scope.event(byId('FileInput'), 'change', () => { const candidate = byId('FileInput').files?.[0]; byId('FileInput').value = ''; if (candidate) void loadFile(candidate); });
  scope.event(byId('Cancel'), 'click', cancel); scope.event(byId('PasswordCancel'), 'click', cancel);
  scope.event(byId('SuccessOk'), 'click', reset);
  scope.event(byId('AllPages'), 'click', () => { if (pdf) void convert(Array.from({ length: pdf.numPages }, (_, i) => i + 1)); });
  scope.event(byId('SelectPages'), 'click', () => {
    if (!pdf || active) return; pagesModal.close({ restore: false }); moveFocusOutOfHiddenRegion(overlay); setModalInteractivity(overlay, false);
    byId('Selector').classList.add('visible'); setModalInteractivity(byId('Selector'), true); selector.open(pdf, file.name);
    byId('Selector').querySelector('button')?.focus({ preventScroll: true }); refreshIcons();
  });
  scope.event(byId('PasswordForm'), 'submit', event => { event.preventDefault(); const callback = passwordUpdate; passwordUpdate = null;
    const value = byId('Password').value; byId('Password').value = '';
    if (callback && active && !active.cancelled) { passwordModal.close({ restore: false }); processModal.open(); stopAnimation = startScanAnimation(byId('ProgressCanvas'), byId('ProgressQuote'), tr); callback(value); }
  });
  scope.event(overlay, 'click', event => { if (event.target.closest('[data-pdf-word-close]')) close(); });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => { if (isTauri) return; event.preventDefault(); const files = event.dataTransfer?.files; if (files?.length === 1) void loadFile(files[0]); else setStatus('error.single', {}, true); });
  scope.event(document, 'keydown', event => {
    if (event.key !== 'Escape' || !owner) return;
    if (byId('Selector').classList.contains('visible')) { event.preventDefault(); reset(); }
    else if (!overlay.inert) { event.preventDefault(); close(); }
  });
  function translate() { for (const id of ['', 'ProgressOverlay', 'PasswordOverlay', 'PagesOverlay', 'SuccessOverlay']) applyTranslations(id ? byId(id) : overlay); renderStatus(); renderResult(); if (progress) setProgress(progress); }
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', () => close(true));
  async function nativeDrop(session) {
    try { const { getCurrentWebview } = await loadTauriWebview(); if (!alive(session)) return;
      session.use(await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (!alive(session) || overlay.inert || payload.type !== 'drop') return;
        if (payload.paths.length !== 1) { setStatus('error.single', {}, true); return; }
        const path = payload.paths[0]; void loadFile({ path, name: path.split(/[\\/]/).pop() });
      }));
    } catch { if (alive(session)) setStatus('dropUnavailable'); }
  }
  function open() { if (disposed) return; close(true); owner = createLifecycleScope(); status = null;
    overlay.classList.add('visible'); setModalInteractivity(overlay, true); translate(); refreshIcons(); byId('EmptyPick').focus({ preventScroll: true }); if (isTauri) void nativeDrop(owner);
  }
  function close(force = false) {
    if (active?.committing && !force) return false;
    const session = owner; owner = null;
    if (active) { active.cancelled = true; active.abort.abort(); active.worker?.dispose(); active.nativeCancel?.(); active.deadline.dispose();
      try { active.renderTask?.cancel(); } catch {} void active.loadingTask?.destroy().catch(() => {}); }
    active = null; passwordUpdate = null; byId('Password').value = ''; session?.dispose(); stopAnimation?.(); stopAnimation = null;
    processModal.close({ restore: false }); passwordModal.close({ restore: false }); reset();
    moveFocusOutOfHiddenRegion(overlay); overlay.classList.remove('visible'); setModalInteractivity(overlay, false); byId('EmptyPick').disabled = false;
  }
  translate();
  return { open, close, dispose() { if (disposed) return; close(true); disposed = true; selector.dispose(); scope.dispose(); for (const modal of [processModal, passwordModal, pagesModal, successModal]) modal.dispose(); } };
}
