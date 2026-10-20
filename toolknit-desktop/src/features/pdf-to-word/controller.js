// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { t, onLangChange, applyTranslations } from '../../i18n.js';
import { LIMITS, wordError, validateInput, parsePageRange, outputName } from './core/input.js';
import { leafBlocks } from './core/layout.js';
import { analyzeWordDocument, enhanceWordStructure, publishWord } from './processor.js';
import { createWordAiCache, wordInputDigest } from './ai-runtime.js';

export function createPdfWordController({ overlay, isTauri = false, getOutputDir, displayFilesystemPath = value => value,
  refreshIcons = () => {}, requestAi, getAiApiKey, getAiPlatformConfig, requestAiKeyConfiguration } = {}) {
  const scope = createLifecycleScope(), byId = suffix => document.getElementById(`pdfWord${suffix}`);
  const tr = (key, params) => t(`home.pdfWord.${key}`, params);
  const aiCache = createWordAiCache(); let inputDigest = '';
  let owner = null, disposed = false, pdf = null, pdfjs = null, file = null, active = null, analysis = null;
  let pageNumber = 1, previewRevision = 0, previewTask = null, mode = 'local', layout = 'faithful', pageModes = {};
  let status = null, progress = null, passwordUpdate = null, result = null, analysisKey = '';
  const processModal = createModalSession({ root: byId('ProgressOverlay'), background: overlay, initialFocus: byId('Cancel'), onClose: cancel, canClose: () => !active?.committing });
  const passwordModal = createModalSession({ root: byId('PasswordOverlay'), background: overlay, initialFocus: byId('Password'), onClose: cancel });
  const successModal = createModalSession({ root: byId('SuccessOverlay'), background: overlay, initialFocus: byId('SuccessOk'), onClose: () => successModal.close() });
  const alive = session => session && owner === session && !session.disposed;
  const current = operation => active === operation && alive(operation.owner) && !operation.cancelled;
  const key = () => JSON.stringify([byId('Range').value.trim(), pageModes, layout]);
  function setStatus(code, params = {}, error = false) { status = { code, params, error }; renderStatus(); }
  function renderStatus() { byId('Status').textContent = status ? tr(status.code, status.params) : ''; byId('Status').classList.toggle('is-error', Boolean(status?.error)); }
  function setProgress(value) { progress = value; byId('ProgressTitle').textContent = tr(value.key, value); }
  function update() {
    const busy = Boolean(active);
    for (const id of ['Pick', 'Range', 'Local', 'Ai', 'Faithful', 'Flow', 'Auto', 'Single', 'NoHeader']) byId(id).disabled = busy;
    byId('Analyze').disabled = busy || !pdf;
    const degraded = analysis?.document.quality.pages.some(page => page.risks.length);
    byId('Export').disabled = busy || !analysis || analysisKey !== key() || Boolean(degraded && !byId('Fallback').checked);
    byId('Prev').disabled = busy || !pdf || pageNumber <= 1; byId('Next').disabled = busy || !pdf || pageNumber >= pdf.numPages;
    byId('PageNumber').textContent = pdf ? `${pageNumber} / ${pdf.numPages}` : '';
    byId('FileName').textContent = file?.name || '';
    byId('Meta').textContent = pdf ? tr('meta', { pages: pdf.numPages, size: (file.size / 1024 / 1024).toFixed(2) }) : '';
    byId('Privacy').textContent = tr(mode === 'ai' ? 'aiPrivacy' : 'localPrivacy');
    for (const button of overlay.querySelectorAll('[data-word-mode]')) button.setAttribute('aria-pressed', String(button.dataset.wordMode === mode));
    for (const button of overlay.querySelectorAll('[data-word-layout]')) button.setAttribute('aria-pressed', String(button.dataset.wordLayout === layout));
    for (const button of overlay.querySelectorAll('[data-word-page-mode]')) button.setAttribute('aria-pressed', String(button.dataset.wordPageMode === (pageModes[pageNumber] || 'auto')));
  }
  function begin(kind) {
    const session = owner;
    const op = { owner: session, kind, cancelled: false, committing: false, abort: new AbortController(), worker: null, renderTask: null, loadingTask: null, nativeCancel: null };
    op.check = () => { if (!current(op)) throw wordError('cancelled'); };
    active = op;
    const timer = setTimeout(() => { if (current(op) && !op.committing) { cancel(); setStatus('error.timeout', {}, true); } }, LIMITS.timeoutMs);
    op.releaseTimer = session.use(() => clearTimeout(timer));
    update(); byId('Cancel').disabled = false; setProgress({ key: kind === 'load' ? 'loading' : 'preparing' }); processModal.open();
    return op;
  }
  function cancel() {
    const op = active;
    if (!op || op.committing) return;
    op.cancelled = true; op.abort.abort(); op.worker?.dispose(); op.nativeCancel?.(); op.releaseTimer();
    try { op.renderTask?.cancel(); } catch {}
    void op.loadingTask?.destroy().catch(() => {});
    passwordUpdate = null; byId('Password').value = '';
    passwordModal.close(); processModal.close(); setStatus('cancelled');
  }
  function end(op) {
    op.releaseTimer();
    if (active !== op) return;
    active = null; passwordUpdate = null; byId('Password').value = '';
    passwordModal.close(); processModal.close(); update();
  }
  function report(error) {
    if (error?.code === 'cancelled' || error?.name === 'RenderingCancelledException' || error?.code === 'aborted') return setStatus('cancelled');
    const known = new Set(['type', 'empty', 'input-large', 'pages', 'selection-large', 'range', 'page-size', 'complexity', 'text-large', 'geometry', 'coverage', 'layout-quality', 'a4-fit', 'asset-large', 'output-large', 'worker', 'timeout', 'image', 'structure', 'ai-response', 'ai-request-large', 'ai-config', 'output-invalid', 'output-path', 'output-name', 'permission', 'busy', 'session', 'read']);
    let code = known.has(error?.code) ? error.code : 'failed';
    if (/^pdf-to-word:/.test(String(error))) code = String(error).split('pdf-to-word:')[1].split(/[\s:]/)[0];
    if (!known.has(code)) code = 'failed';
    if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') code = 'read';
    if (error?.code === 'invalid_config') code = 'ai-config';
    else if (['http_error', 'timeout', 'network_error', 'invalid_response', 'response_truncated'].includes(error?.code)) code = 'ai-request';
    setStatus(`error.${code}`, {}, true);
  }
  function dropAnalysis() {
    analysis?.worker.dispose(); analysis = null; analysisKey = ''; byId('Review').hidden = true;
    byId('Fallback').checked = false; byId('Regions').replaceChildren(); update();
  }
  function releaseDocument() {
    previewRevision++; try { previewTask?.cancel(); } catch {} previewTask = null;
    dropAnalysis(); aiCache.clear(); inputDigest = ''; const old = pdf; pdf = null; file = null;
    if (old) void destroyPdfDocument(old).catch(() => {});
    byId('Canvas').width = byId('Canvas').height = 0;
  }
  async function loadFile(candidate) {
    if (!owner || active || disposed) return;
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
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); op.check();
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      // Bundled fallback fonts provide outlines for cell ownership and clipping;
      // browser-only system substitution otherwise loses that geometry.
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes, isEvalSupported: false, enableXfa: false,
        fontExtraProperties: true, useSystemFonts: false })); op.loadingTask = task;
      task.onPassword = (callback, reason) => {
        if (!current(op)) return;
        passwordUpdate = callback; byId('Password').value = ''; byId('PasswordHint').textContent = tr(reason === 2 ? 'passwordWrong' : 'passwordHint');
        processModal.close(); passwordModal.open();
      };
      const loaded = await task.promise; op.check();
      if (loaded.numPages > LIMITS.documentPages) throw wordError('pages');
      const permissions = await loaded.getPermissions(); op.check();
      if (permissions && !permissions.includes(pdfjs.PermissionFlag.COPY)) throw wordError('permission');
      releaseDocument(); pdf = loaded; file = candidate; inputDigest = digest; adopted = true; op.loadingTask = null;
      pageNumber = 1; pageModes = {}; byId('Range').value = loaded.numPages > LIMITS.selectedPages ? `1-${LIMITS.selectedPages}` : '';
      moveFocusOutOfHiddenRegion(byId('Empty')); byId('Empty').hidden = true; byId('Loaded').hidden = false;
      setStatus('ready');
    } catch (error) { if (alive(op.owner) && !op.cancelled) report(error); }
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
    if (!pdf || !owner) return;
    const revision = ++previewRevision, session = owner, snapshot = pdf;
    try { previewTask?.cancel(); } catch {}
    const valid = () => alive(session) && revision === previewRevision && pdf === snapshot;
    try {
      const page = await snapshot.getPage(pageNumber); if (!valid()) return;
      const viewport = page.getViewport({ scale: 1 }), scale = Math.min(2, 1400 / Math.max(viewport.width, viewport.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width * scale); canvas.height = Math.ceil(viewport.height * scale);
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale }), background: '#fff' }); previewTask = task;
      try {
        await task.promise; if (!valid()) return;
        const target = byId('Canvas'); target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas, 0, 0);
        renderRegions(); update();
      } finally { canvas.width = canvas.height = 0; if (previewTask === task) previewTask = null; }
    } catch (error) { if (valid() && error?.name !== 'RenderingCancelledException') report(error); }
  }
  function renderRegions() {
    const root = byId('Regions'); root.replaceChildren();
    if (byId('Structure').getAttribute('aria-pressed') !== 'true') return;
    const page = analysis?.document.pages.find(page => page.number === pageNumber); if (!page) return;
    for (const [role, blocks] of [['header', page.header], ['body', page.blocks], ['footer', page.footer]]) for (const block of leafBlocks(blocks)) {
      const box = document.createElement('span'); box.className = 'pdf-word-region'; box.dataset.role = role === 'body' ? block.type : role;
      box.style.left = `${block.rect.x / page.width * 100}%`; box.style.top = `${block.rect.y / page.height * 100}%`;
      box.style.width = `${block.rect.width / page.width * 100}%`; box.style.height = `${block.rect.height / page.height * 100}%`;
      root.append(box);
    }
  }
  function renderReview() {
    if (!analysis) return;
    byId('Review').hidden = false;
    const quality = analysis.document.quality;
    byId('Quality').textContent = tr('quality', { pages: quality.pages.length, editable: quality.editableCharacters, image: quality.imageCharacters });
    const risks = byId('Risks'); risks.replaceChildren();
    for (const page of quality.pages.filter(page => page.risks.length)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pdf-word-risk'; button.dataset.wordReviewPage = String(page.page);
      button.textContent = tr('riskPage', { page: page.page, reason: tr(page.risks.includes('image-page') ? 'scanned' : 'rasterRegion') }); risks.append(button);
    }
    byId('FallbackLabel').hidden = !quality.pages.some(page => page.risks.length);
    renderRegions(); update();
  }
  async function analyze() {
    if (!pdf || active || !owner) return;
    let pages;
    try { pages = parsePageRange(byId('Range').value, pdf.numPages); } catch (error) { report(error); return; }
    const source = pdf; dropAnalysis();
    const op = begin('analyze'), requestKey = key();
    try {
      const oldPreview = previewTask; try { oldPreview?.cancel(); } catch {} previewRevision++;
      if (oldPreview) await oldPreview.promise.catch(() => {}); op.check();
      const value = await analyzeWordDocument({ pdf: source, pages, ops: pdfjs.OPS, operation: op, pageModes, preserveGeometry: layout === 'faithful', continuous: layout === 'flow',
        onProgress: value => { if (current(op)) setProgress(value); } }); op.check();
      analysis = value; op.worker = null; analysisKey = requestKey; renderReview(); setStatus('analyzed');
    } catch (error) { if (alive(op.owner)) report(error); }
    finally { end(op); if (alive(op.owner)) void showPage(); }
  }
  async function exportWord() {
    if (!analysis || active || !owner || analysisKey !== key()) return;
    const session = owner;
    if (mode === 'ai') {
      const config = getAiPlatformConfig?.(), apiKey = await getAiApiKey?.();
      if (!alive(session)) return;
      if (!apiKey || !config?.url || !config?.model) { setStatus('error.ai-config', {}, true); requestAiKeyConfiguration?.(); return; }
    }
    const op = begin('export'), prepared = analysis;
    op.worker = prepared.worker;
    try {
      let plannedDocument = prepared.document, aiReview = null;
      if (mode === 'ai') {
        const enhanced = await enhanceWordStructure({ document: plannedDocument, pdf, requestAi, operation: op,
          inputDigest, cache: aiCache, getProvider: getAiPlatformConfig,
          selectedPages: [pageNumber], expectedProvider: getAiPlatformConfig?.(), onProgress: value => { if (current(op)) setProgress(value); } }); op.check();
        plannedDocument = enhanced.document; aiReview = enhanced.review;
      }
      setProgress({ key: 'assembling' });
      const output = await prepared.worker.request('finish', { document: plannedDocument, options: { continuous: layout === 'flow', preserveGeometry: layout === 'faithful' } }); op.check();
      setProgress({ key: 'saving' });
      const name = outputName(file.name), path = await publishWord({ bytes: output.bytes, name, isTauri, getOutputDir, operation: op }); op.check();
      if (!isTauri) {
        const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        const revoke = session.use(() => URL.revokeObjectURL(url)); session.timeout(revoke, 30_000);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; documentNodeAppend(anchor);
      }
      result = { name: path ? path.split(/[\\/]/).pop() : name, path, quality: output.quality, aiReview };
      renderResult(); setStatus('success'); end(op); successModal.open();
    } catch (error) {
      if (alive(op.owner)) report(error);
      if (op.cancelled) dropAnalysis();
    } finally { op.worker = null; end(op); }
  }
  function documentNodeAppend(anchor) { document.body.append(anchor); anchor.click(); anchor.remove(); }
  function renderResult() {
    if (!result) return;
    byId('ResultName').textContent = result.name;
    const paginationRisks = result.quality.pagination?.filter(page => page.limited).length || 0;
    byId('ResultQuality').textContent = tr('quality', { pages: result.quality.pages.length, editable: result.quality.editableCharacters, image: result.quality.imageCharacters })
      + (result.quality.layoutMode === 'continuous-a4' ? ' ' + tr('flowNotice') : '')
      + (paginationRisks ? ' ' + tr('paginationNotice', { count: paginationRisks }) : '')
      + (result.aiReview ? ' ' + tr('aiCoverage', result.aiReview) : '')
      + (result.aiReview?.pendingMath ? ' ' + tr('aiMathReview', { count: result.aiReview.pendingMath }) : '');
    byId('ResultPath').textContent = result.path ? displayFilesystemPath(result.path) : tr('browserDownload');
    byId('OpenFolder').hidden = byId('OpenFile').hidden = !result.path;
  }
  function translate() {
    for (const node of [overlay, byId('ProgressOverlay'), byId('PasswordOverlay'), byId('SuccessOverlay')]) applyTranslations(node);
    overlay.setAttribute('aria-label', tr('title')); update(); renderStatus(); renderReview(); renderResult();
    if (progress) setProgress(progress);
  }
  scope.event(byId('Pick'), 'click', () => { void pick(); });
  scope.event(byId('FileInput'), 'change', () => { const candidate = byId('FileInput').files?.[0]; byId('FileInput').value = ''; if (candidate) void loadFile(candidate); });
  scope.event(byId('Analyze'), 'click', () => { void analyze(); });
  scope.event(byId('Export'), 'click', () => { void exportWord().catch(report); });
  scope.event(byId('Cancel'), 'click', cancel); scope.event(byId('PasswordCancel'), 'click', cancel);
  scope.event(byId('SuccessOk'), 'click', () => successModal.close());
  scope.event(byId('Range'), 'input', () => { dropAnalysis(); });
  scope.event(byId('Fallback'), 'change', update);
  scope.event(byId('Structure'), 'click', () => { byId('Structure').setAttribute('aria-pressed', String(byId('Structure').getAttribute('aria-pressed') !== 'true')); renderRegions(); });
  scope.event(byId('PasswordForm'), 'submit', event => {
    event.preventDefault(); const callback = passwordUpdate; passwordUpdate = null;
    const value = byId('Password').value; byId('Password').value = '';
    if (callback && active && !active.cancelled) { passwordModal.close(); processModal.open(); callback(value); }
  });
  scope.event(overlay, 'click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-pdf-word-close')) close();
    if (button.dataset.wordMode) { mode = button.dataset.wordMode; update(); }
    if (button.dataset.wordLayout && button.dataset.wordLayout !== layout) {
      layout = button.dataset.wordLayout; dropAnalysis(); if (pdf) setStatus('ready'); update();
    }
    if (button.dataset.wordReviewPage) { pageNumber = Number(button.dataset.wordReviewPage); void showPage(); }
    if (button.dataset.wordPageMode && pdf) { pageModes[pageNumber] = button.dataset.wordPageMode; void analyze(); }
  });
  for (const [id, delta] of [['Prev', -1], ['Next', 1]]) scope.event(byId(id), 'click', () => { if (!pdf || active) return; pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber + delta)); void showPage(); });
  for (const [id, command] of [['OpenFolder', 'open_path'], ['OpenFile', 'open_pdf_to_word_result']]) scope.event(byId(id), 'click', async () => {
    if (!result?.path || !owner) return;
    try { const { invoke } = await tauriCorePromise; await invoke(command, { path: result.path }); } catch (error) { report(error); }
  });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => { if (isTauri) return; event.preventDefault(); const files = event.dataTransfer?.files; if (files?.length === 1) void loadFile(files[0]); else setStatus('error.single', {}, true); });
  scope.event(document, 'keydown', event => { if (event.key === 'Escape' && owner && !overlay.inert) close(); });
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
    translate(); refreshIcons(); byId('Pick').focus({ preventScroll: true }); if (isTauri) void nativeDrop(owner);
  }
  function close() {
    const session = owner; owner = null;
    if (active) {
      active.cancelled = true; active.abort.abort(); active.worker?.dispose(); active.nativeCancel?.(); active.releaseTimer();
      try { active.renderTask?.cancel(); } catch {} void active.loadingTask?.destroy().catch(() => {});
    }
    active = null; passwordUpdate = null; byId('Password').value = ''; session?.dispose();
    processModal.close({ restore: false }); passwordModal.close({ restore: false }); successModal.close({ restore: false });
    releaseDocument(); result = null; moveFocusOutOfHiddenRegion(overlay); overlay.classList.remove('visible'); setModalInteractivity(overlay, false);
  }
  translate();
  return { open, close, dispose() { if (disposed) return; close(); disposed = true; scope.dispose(); } };
}
