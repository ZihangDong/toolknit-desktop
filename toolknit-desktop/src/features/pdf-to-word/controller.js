// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { startScanAnimation } from '../../shared/curve-loading.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { t, onLangChange, applyTranslations } from '../../i18n.js';
import { LIMITS, wordError, validateInput, parsePageRange, outputName } from './core/input.js';
import { analyzeWordDocument, enhanceWordStructure, publishWord } from './processor.js';
import { createWordAiCache, wordInputDigest } from './ai-runtime.js';
import { createWordPageStrip } from './page-strip.js';
import { createWordResultEditor } from './result-editor.js';
import { pageAssetIds, renderResultPage } from './result-preview.js';

export function createPdfWordController({ overlay, isTauri = false, getOutputDir, displayFilesystemPath = value => value,
  refreshIcons = () => {}, requestAi, getAiApiKey, getAiPlatformConfig, requestAiKeyConfiguration } = {}) {
  const scope = createLifecycleScope(), byId = suffix => document.getElementById('pdfWord' + suffix);
  const tr = (key, params) => t('home.pdfWord.' + key, params);
  const aiCache = createWordAiCache();
  let owner = null, disposed = false, pdf = null, pdfjs = null, file = null, active = null, analysis = null, inputDigest = '';
  let pageNumber = 1, previewRevision = 0, previewTask = null, mode = 'local', layout = 'faithful', zoom = 1;
  let status = null, progress = null, passwordUpdate = null, result = null, strip = null, stopAnimation = null, confirmation = null, aiReview = null;
  const key = () => JSON.stringify([byId('Range').value.trim(), layout]);
  const alive = session => session && owner === session && !session.disposed;
  const current = op => active === op && alive(op.owner) && !op.cancelled;
  const editor = createWordResultEditor({ overlay, byId, tr, enabled: () => Boolean(owner && !active && analysis),
    pageNumber: () => pageNumber, report, changed: () => { update(); editor.render(); void showPage(); } });
  const processModal = createModalSession({ root: byId('ProgressOverlay'), background: overlay, initialFocus: byId('Cancel'), onClose: cancel, canClose: () => !active?.committing });
  const passwordModal = createModalSession({ root: byId('PasswordOverlay'), background: overlay, initialFocus: byId('Password'), onClose: cancel });
  const successModal = createModalSession({ root: byId('SuccessOverlay'), background: overlay, initialFocus: byId('SuccessOk'), onClose: () => successModal.close() });
  const confirmModal = createModalSession({ root: byId('ConfirmOverlay'), background: overlay, initialFocus: byId('ConfirmCancel'), onClose: () => finishConfirm(false) });
  function finishConfirm(value) { const resolve = confirmation; confirmation = null; confirmModal.close(); resolve?.(value); }
  async function confirm(message) {
    if (confirmation) return false;
    byId('ConfirmMessage').textContent = tr(message); confirmModal.open();
    return new Promise(resolve => { confirmation = resolve; });
  }
  async function allowDiscard() { return !editor.dirty || await confirm('discardEdits'); }
  function setStatus(code, params = {}, error = false) { status = { code, params, error }; renderStatus(); }
  function renderStatus() {
    for (const id of ['Status', 'EmptyStatus']) {
      byId(id).textContent = status && (id === 'Status' || !pdf) ? tr(status.code, status.params) : '';
      byId(id).classList.toggle('is-error', Boolean(status?.error));
    }
  }
  function update() {
    const busy = Boolean(active) || editor.busy;
    for (const id of ['Pick', 'EmptyPick', 'Range', 'Local', 'Ai', 'Faithful', 'Flow', 'Structure', 'PageInput']) byId(id).disabled = busy;
    byId('Export').disabled = busy || !pdf;
    byId('Prev').disabled = busy || !pdf || pageNumber <= 1;
    byId('Next').disabled = busy || !pdf || pageNumber >= pdf.numPages;
    byId('PageInput').value = String(pageNumber); byId('PageInput').max = String(pdf?.numPages || 1);
    byId('PageNumber').textContent = '/ ' + (pdf?.numPages || 0);
    byId('FileName').textContent = file?.name || ''; byId('FileName').title = file?.name || '';
    byId('Meta').textContent = pdf ? tr('meta', { pages: pdf.numPages, size: (file.size / 1024 / 1024).toFixed(2) }) : '';
    byId('Privacy').textContent = tr(mode === 'ai' ? 'aiPrivacy' : 'localPrivacy');
    byId('PreviewLabel').textContent = tr(editor.dirty ? 'editedPreview' : 'originalPreview');
    byId('Export').querySelector('span').textContent = tr(editor.dirty ? 'exportEdited' : 'export');
    const editKey = byId('Structure').getAttribute('aria-pressed') === 'true' ? 'exitEdit' : 'structure';
    byId('Structure').dataset.i18nTitle = byId('Structure').dataset.i18nAriaLabel = 'home.pdfWord.' + editKey;
    byId('Structure').title = tr(editKey); byId('Structure').setAttribute('aria-label', tr(editKey));
    byId('Structure').querySelector('span').dataset.i18n = 'home.pdfWord.' + editKey;
    byId('Structure').querySelector('span').textContent = tr(editKey);
    for (const button of overlay.querySelectorAll('[data-word-mode]')) button.setAttribute('aria-pressed', String(button.dataset.wordMode === mode));
    for (const button of overlay.querySelectorAll('[data-word-layout]')) button.setAttribute('aria-pressed', String(button.dataset.wordLayout === layout));
    let pages = null; try { if (pdf) pages = parsePageRange(byId('Range').value, pdf.numPages); } catch {}
    strip?.update(pageNumber, pages); editor.render(); renderStatus();
  }
  function setProgress(value) { progress = value; byId('ProgressTitle').textContent = tr(value.key, value); }
  function begin(kind) {
    const session = owner;
    const op = { owner: session, kind, cancelled: false, committing: false, abort: new AbortController(), worker: null, renderTask: null, loadingTask: null, nativeCancel: null };
    op.check = () => { if (!current(op)) throw wordError('cancelled'); };
    active = op; strip?.pause(); previewRevision++; try { previewTask?.cancel(); } catch {}
    const timer = setTimeout(() => { if (current(op) && !op.committing) { cancel(); setStatus('error.timeout', {}, true); } }, LIMITS.timeoutMs);
    op.releaseTimer = session.use(() => clearTimeout(timer));
    update(); byId('Cancel').disabled = false; setProgress({ key: kind === 'load' ? 'loading' : 'preparing' }); processModal.open();
    stopAnimation?.(); stopAnimation = startScanAnimation(byId('ProgressCanvas'), byId('ProgressQuote'), tr);
    return op;
  }
  function cancel() {
    const op = active; if (!op || op.committing) return;
    op.cancelled = true; op.abort.abort(); op.nativeCancel?.(); op.releaseTimer();
    // An analyzed worker owns the result assets. A pending pack may finish in the
    // background, but its cancelled operation can never publish a file.
    if (op.worker && op.worker !== analysis?.worker) op.worker.dispose();
    try { op.renderTask?.cancel(); } catch {}
    void op.loadingTask?.destroy().catch(() => {});
    passwordUpdate = null; byId('Password').value = '';
    passwordModal.close(); end(op); setStatus('cancelled'); void showPage();
  }
  function end(op) {
    op.releaseTimer(); if (active !== op) return;
    active = null; passwordUpdate = null; byId('Password').value = '';
    passwordModal.close(); processModal.close(); stopAnimation?.(); stopAnimation = null; strip?.resume(); update();
  }
  function report(error) {
    if (error?.code === 'cancelled' || error?.name === 'RenderingCancelledException' || error?.code === 'aborted') return setStatus('cancelled');
    const known = new Set(['type', 'empty', 'input-large', 'pages', 'selection-large', 'range', 'page-size', 'complexity', 'text-large', 'geometry', 'coverage', 'layout-quality', 'a4-fit', 'asset-large', 'output-large', 'worker', 'timeout', 'image', 'structure', 'ai-response', 'ai-request-large', 'ai-config', 'output-invalid', 'output-path', 'output-name', 'permission', 'busy', 'session', 'read', 'edit-text', 'edit-fit', 'edit-image']);
    let code = known.has(error?.code) ? error.code : 'failed';
    if (/^pdf-to-word:/.test(String(error))) code = String(error).split('pdf-to-word:')[1].split(/[\s:]/)[0];
    if (!known.has(code)) code = 'failed';
    if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') code = 'read';
    if (error?.code === 'invalid_config') code = 'ai-config';
    else if (['http_error', 'timeout', 'network_error', 'invalid_response', 'response_truncated'].includes(error?.code)) code = 'ai-request';
    setStatus('error.' + code, {}, true);
  }
  function dropAnalysis() { analysis?.worker?.dispose(); analysis = null; aiReview = null; editor.clear(); }
  function releaseDocument() {
    previewRevision++; try { previewTask?.cancel(); } catch {} previewTask = null;
    strip?.dispose(); strip = null; dropAnalysis(); aiCache.clear(); inputDigest = '';
    const old = pdf; pdf = null; file = null; if (old) void destroyPdfDocument(old).catch(() => {});
    byId('Canvas').width = byId('Canvas').height = 0;
  }
  async function loadFile(candidate) {
    if (!owner || active || disposed) return;
    const session = owner; if (!await allowDiscard() || !alive(session)) return;
    const op = begin('load'); let task = null, adopted = false;
    try {
      let bytes;
      if (candidate.path) {
        const { invoke } = await tauriCorePromise; op.check();
        candidate = { ...candidate, size: Number(await invoke('get_file_size', { path: candidate.path })) }; op.check(); validateInput(candidate);
        bytes = Uint8Array.from(await invoke('read_file_bytes_limited', { path: candidate.path, maxBytes: LIMITS.inputBytes }));
      } else { validateInput(candidate); bytes = new Uint8Array(await candidate.arrayBuffer()); }
      op.check(); validateInput({ name: candidate.name, size: bytes.length });
      const digest = await wordInputDigest(bytes); op.check();
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); op.check(); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes, isEvalSupported: false, enableXfa: false, fontExtraProperties: true, useSystemFonts: false })); op.loadingTask = task;
      task.onPassword = (callback, reason) => {
        if (!current(op)) return;
        passwordUpdate = callback; byId('Password').value = ''; byId('PasswordHint').textContent = tr(reason === 2 ? 'passwordWrong' : 'passwordHint');
        processModal.close(); stopAnimation?.(); stopAnimation = null; passwordModal.open();
      };
      const loaded = await task.promise; op.check();
      if (loaded.numPages > LIMITS.documentPages) throw wordError('pages');
      const permissions = await loaded.getPermissions(); op.check();
      if (permissions && !permissions.includes(pdfjs.PermissionFlag.COPY)) throw wordError('permission');
      releaseDocument(); pdf = loaded; file = candidate; inputDigest = digest; adopted = true; op.loadingTask = null;
      pageNumber = 1; zoom = 1; byId('Range').value = loaded.numPages > LIMITS.selectedPages ? '1-' + LIMITS.selectedPages : '';
      moveFocusOutOfHiddenRegion(byId('Empty')); byId('Empty').hidden = true; byId('Loaded').hidden = false;
      byId('Structure').setAttribute('aria-pressed', 'false'); byId('Paper').style.width = '';
      strip = createWordPageStrip({ root: byId('Thumbnails'), pdf, select: number => { if (!active) { pageNumber = number; void showPage(); } }, label: number => tr('pageLabel', { page: number }) });
      strip.pause(); setStatus('ready');
    } catch (error) { if (current(op)) report(error); }
    finally { if (task && !adopted) void task.destroy().catch(() => {}); end(op); if (adopted && alive(op.owner)) void showPage(); }
  }
  async function pick() {
    if (!owner || active) return;
    if (!isTauri) { byId('FileInput').click(); return; }
    const session = owner;
    try {
      const { open } = await loadTauriDialog(); if (!alive(session)) return;
      const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (path && alive(session)) await loadFile({ path, name: path.split(/[\\/]/).pop() });
    } catch (error) { if (alive(session)) report(error); }
  }
  async function showPage() {
    if (!pdf || !owner || active) return;
    const revision = ++previewRevision, session = owner, snapshot = pdf, number = pageNumber;
    try { previewTask?.cancel(); } catch {}
    const valid = () => alive(session) && revision === previewRevision && pdf === snapshot && !active;
    const check = () => { if (!valid()) throw wordError('cancelled'); };
    let canvas;
    try {
      const page = await snapshot.getPage(number); if (!valid()) return;
      const viewport = page.getViewport({ scale: 1 }), scale = Math.min(2, 1600 / Math.max(viewport.width, viewport.height));
      canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width * scale); canvas.height = Math.ceil(viewport.height * scale);
      const editedPage = editor.dirty && editor.document()?.pages.find(item => item.number === number);
      if (editedPage && analysis?.worker) {
        const assets = await analysis.worker.request('assets', { ids: pageAssetIds(editedPage) }); check();
        await renderResultPage(editedPage, canvas, new Map([...assets, ...editor.assets.values()].map(asset => [asset.id, asset])), check); check();
      } else {
        const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale }), background: '#fff' }); previewTask = task;
        try { await task.promise; } finally { if (previewTask === task) previewTask = null; }
        if (!valid()) return;
      }
      const target = byId('Canvas'); target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas, 0, 0); update();
    } catch (error) { if (valid()) report(error); }
    finally { if (canvas) canvas.width = canvas.height = 0; }
  }
  async function prepare(op) {
    const requestKey = key();
    if (analysis?.key === requestKey && analysis.worker && !analysis.worker.disposed) return analysis;
    const pages = parsePageRange(byId('Range').value, pdf.numPages), previous = previewTask;
    try { previous?.cancel(); } catch {} if (previous) await previous.promise.catch(() => {}); op.check();
    const value = await analyzeWordDocument({ pdf, pages, ops: pdfjs.OPS, operation: op, preserveGeometry: layout === 'faithful', continuous: layout === 'flow',
      onProgress: value => { if (current(op)) setProgress(value); } }); op.check();
    const preserveEdits = analysis?.key === requestKey && editor.baseline;
    analysis?.worker?.dispose(); analysis = { ...value, key: requestKey, ai: preserveEdits && analysis?.ai };
    if (!preserveEdits) editor.setBaseline(value.document);
    return analysis;
  }
  async function structure() {
    if (!owner || !pdf || active) return;
    const on = byId('Structure').getAttribute('aria-pressed') !== 'true';
    if (on && (!analysis?.worker || analysis.worker.disposed || analysis.key !== key())) {
      const op = begin('analyze');
      try { await prepare(op); op.check(); op.worker = null; }
      catch (error) { if (current(op)) report(error); return; }
      finally { end(op); }
    }
    byId('Structure').setAttribute('aria-pressed', String(on)); update(); void showPage();
  }
  async function exportWord() {
    if (!pdf || active || !owner || editor.busy) return;
    const session = owner;
    try { parsePageRange(byId('Range').value, pdf.numPages); } catch (error) { report(error); return; }
    if (mode === 'ai') {
      const config = getAiPlatformConfig?.(), apiKey = await getAiApiKey?.();
      if (!alive(session) || active) return;
      if (!apiKey || !config?.url || !config?.model) { setStatus('error.ai-config', {}, true); requestAiKeyConfiguration?.(); return; }
    }
    const op = begin('export');
    try {
      const prepared = await prepare(op); op.check(); op.worker = prepared.worker;
      const provider = getAiPlatformConfig?.();
      const providerKey = JSON.stringify([provider?.url, provider?.model, provider?.allowPrivateHttp]);
      if (mode === 'ai' && prepared.ai !== providerKey && !editor.dirty) {
        const enhanced = await enhanceWordStructure({ document: prepared.document, pdf, requestAi, operation: op, inputDigest, cache: aiCache,
          getProvider: getAiPlatformConfig, selectedPages: [pageNumber], expectedProvider: getAiPlatformConfig?.(),
          onProgress: value => { if (current(op)) setProgress(value); } }); op.check();
        editor.setBaseline(enhanced.document); prepared.ai = providerKey; aiReview = enhanced.review;
      }
      setProgress({ key: 'assembling' });
      const output = await prepared.worker.request('finish', { document: editor.document(), editedAssets: editor.editedAssets(),
        options: { continuous: layout === 'flow', preserveGeometry: layout === 'faithful' } }); op.check();
      setProgress({ key: 'saving' });
      const name = outputName(file.name), path = await publishWord({ bytes: output.bytes, name, isTauri, getOutputDir, operation: op }); op.check();
      if (!isTauri) {
        const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        const revoke = session.use(() => URL.revokeObjectURL(url)); session.timeout(revoke, 30000);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
      }
      result = { name: path ? path.split(/[\\/]/).pop() : name, path, quality: output.quality }; editor.markSaved();
      renderResult(); setStatus('success'); end(op); successModal.open();
    } catch (error) { if (current(op)) report(error); }
    finally { op.worker = null; end(op); if (alive(session)) void showPage(); }
  }
  function renderResult() {
    if (!result) return;
    byId('ResultName').textContent = result.name;
    byId('ResultQuality').textContent = result.quality.imageCharacters ? tr('imageNotice') : '';
    byId('ResultPath').textContent = result.path ? displayFilesystemPath(result.path) : tr('browserDownload');
    byId('OpenFolder').hidden = byId('OpenFile').hidden = !result.path;
  }
  function translate() {
    for (const id of ['', 'Progress', 'Password', 'Success', 'Edit', 'Confirm']) applyTranslations(id ? byId(id + 'Overlay') : overlay);
    overlay.setAttribute('aria-label', tr('title')); update(); renderResult(); if (progress) setProgress(progress);
  }
  for (const id of ['Pick', 'EmptyPick']) scope.event(byId(id), 'click', () => { void pick(); });
  scope.event(byId('FileInput'), 'change', () => { const candidate = byId('FileInput').files?.[0]; byId('FileInput').value = ''; if (candidate) void loadFile(candidate); });
  scope.event(byId('Export'), 'click', () => { void exportWord().catch(report); });
  scope.event(byId('Structure'), 'click', () => { void structure().catch(report); });
  scope.event(byId('Cancel'), 'click', cancel); scope.event(byId('PasswordCancel'), 'click', cancel);
  scope.event(byId('SuccessOk'), 'click', () => successModal.close());
  scope.event(byId('ConfirmCancel'), 'click', () => finishConfirm(false)); scope.event(byId('ConfirmOk'), 'click', () => finishConfirm(true));
  scope.event(byId('Reset'), 'click', async () => { const session = owner; if (await confirm('resetConfirm') && alive(session) && !active) { editor.reset(); setStatus('resetDone'); } });
  scope.event(byId('Range'), 'change', async () => {
    const old = analysis?.key ? JSON.parse(analysis.key)[0] : '', session = owner;
    if (!await allowDiscard() || !alive(session)) { byId('Range').value = old; return; }
    dropAnalysis(); update(); setStatus('ready');
  });
  scope.event(byId('PasswordForm'), 'submit', event => {
    event.preventDefault(); const callback = passwordUpdate; passwordUpdate = null;
    const value = byId('Password').value; byId('Password').value = '';
    if (callback && active && !active.cancelled) {
      passwordModal.close(); processModal.open();
      stopAnimation?.(); stopAnimation = startScanAnimation(byId('ProgressCanvas'), byId('ProgressQuote'), tr); callback(value);
    }
  });
  scope.event(overlay, 'click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-pdf-word-close')) { const session = owner; if ((!editor.unsaved || await confirm('discardEdits')) && alive(session)) close(); }
    const nextMode = button.dataset.wordMode, nextLayout = button.dataset.wordLayout;
    if ((nextMode && nextMode !== mode) || (nextLayout && nextLayout !== layout)) {
      const session = owner; if (!await allowDiscard() || !alive(session) || active) return;
      if (nextMode) { mode = nextMode; if (analysis) { analysis.ai = false; editor.setBaseline(analysis.document); } }
      if (nextLayout) { layout = nextLayout; dropAnalysis(); }
      update(); if (pdf) setStatus('ready'); void showPage();
    }
  });
  for (const [id, delta] of [['Prev', -1], ['Next', 1]]) scope.event(byId(id), 'click', () => {
    if (!pdf || active) return; pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber + delta)); void showPage();
  });
  scope.event(byId('PageInput'), 'change', () => { if (pdf && !active) { pageNumber = Math.max(1, Math.min(pdf.numPages, Math.floor(Number(byId('PageInput').value)) || 1)); void showPage(); } });
  for (const [id, delta] of [['ZoomOut', -.25], ['ZoomIn', .25], ['ZoomFit', 0]]) scope.event(byId(id), 'click', () => {
    zoom = delta ? Math.min(3, Math.max(.5, zoom + delta)) : 1;
    byId('Paper').style.width = zoom === 1 ? '' : Math.round(Math.min(760, byId('Preview').clientWidth - 48) * zoom) + 'px';
    byId('Paper').style.maxWidth = zoom === 1 ? '' : 'none';
  });
  scope.event(byId('PagesToggle'), 'click', () => {
    const collapsed = byId('Loaded').classList.toggle('pages-collapsed'); byId('PagesToggle').setAttribute('aria-expanded', String(!collapsed));
  });
  for (const [id, command] of [['OpenFolder', 'open_path'], ['OpenFile', 'open_pdf_to_word_result']]) scope.event(byId(id), 'click', async () => {
    if (!result?.path || !owner) return;
    try { const { invoke } = await tauriCorePromise; await invoke(command, { path: result.path }); }
    catch (error) { successModal.close(); report(error); }
  });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => { if (isTauri) return; event.preventDefault(); const files = event.dataTransfer?.files; if (files?.length === 1) void loadFile(files[0]); else setStatus('error.single', {}, true); });
  scope.event(document, 'keydown', async event => {
    if (event.key === 'Escape' && owner && !overlay.inert) {
      const session = owner; if ((!editor.unsaved || await confirm('discardEdits')) && alive(session)) close();
    }
  });
  scope.event(window, 'pagehide', close); scope.use(onLangChange(translate));
  async function nativeDrop(session) {
    try {
      const { getCurrentWebview } = await loadTauriWebview(); if (!alive(session)) return;
      session.use(await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (!alive(session) || overlay.inert || payload.type !== 'drop') return;
        if (payload.paths.length !== 1) { setStatus('error.single', {}, true); return; }
        const path = payload.paths[0]; void loadFile({ path, name: path.split(/[\\/]/).pop() });
      }));
    } catch { if (alive(session)) setStatus('dropUnavailable'); }
  }
  function open() {
    if (disposed) return;
    close(); owner = createLifecycleScope(); overlay.classList.add('visible'); setModalInteractivity(overlay, true);
    byId('Empty').hidden = false; byId('Loaded').hidden = true; byId('Range').value = ''; status = null; result = null;
    translate(); refreshIcons(); byId('EmptyPick').focus({ preventScroll: true }); if (isTauri) void nativeDrop(owner);
  }
  function close() {
    const session = owner; owner = null;
    if (active) {
      active.cancelled = true; active.abort.abort(); active.worker?.dispose(); active.nativeCancel?.(); active.releaseTimer();
      try { active.renderTask?.cancel(); } catch {} void active.loadingTask?.destroy().catch(() => {});
    }
    active = null; passwordUpdate = null; byId('Password').value = ''; session?.dispose(); stopAnimation?.(); stopAnimation = null;
    processModal.close({ restore: false }); passwordModal.close({ restore: false }); successModal.close({ restore: false }); finishConfirm(false);
    releaseDocument(); result = null; moveFocusOutOfHiddenRegion(overlay); overlay.classList.remove('visible'); setModalInteractivity(overlay, false);
  }
  translate();
  return { open, close, dispose() { if (disposed) return; close(); disposed = true; editor.dispose(); scope.dispose(); } };
}
