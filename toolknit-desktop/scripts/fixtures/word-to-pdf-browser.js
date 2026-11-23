import template from '../../src/features/word-to-pdf/template.js';
import { createWordPdfController } from '../../src/features/word-to-pdf/controller.js';
import '../../src/features/word-to-pdf/word-to-pdf.css';
import { createIcons, icons } from 'lucide';
import { setLangWithoutFade, getLang, t, onLangChange, applyTranslations } from '../../src/i18n.js';
import { prepareToolPageChrome } from '../../src/shared/tool-page-chrome.js';
import editorTemplate from '../../src/features/pdf-editor/template.html?raw';
import { initPdfEditorTool } from '../../src/features/pdf-editor/controller.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { applyTheme, readAppearancePreference } from '../../src/app/theme-palette.js';
import productivityTemplate from '../../src/features/productivity/template.js';
import { initProductivityTool } from '../../src/features/productivity/tool.js';
import { createTaskCenter } from '../../src/app/task-center.js';

applyTheme(document.documentElement, readAppearancePreference(window));
document.body.insertAdjacentHTML('afterbegin', template + editorTemplate);
const q = suffix => document.getElementById('wordPdf' + suffix);
const output = document.getElementById('qa-result');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertions = [];
const assert = (value, message) => { if (!value) throw new Error(message); assertions.push(message); };
async function until(predicate) { for (let n = 0; n < 250; n++) { if (predicate()) return; await delay(40); } throw new Error('Timed out: ' + predicate); }
let events = new Set(), nextPick = [], calls = [], mode = 'success', ready = true;
let cancelled = false, gateCalls = 0, checkDelay = 0, editorFailure = false;
let archiveDelay = 0;
let historyProbeMode = 'normal', historyDelay = 0;
let partialProgress;
const archivePath = 'C:\\QA\\资料包.zip';
const paths = ['C:\\QA\\合同.docx', 'C:\\QA\\旧文档.doc'];
const pdfBytes = await (await fetch('/tmp/word-pdf-native/single.pdf')).arrayBuffer();
const editor = initPdfEditorTool({ isTauri: false, t, onLangChange, pdfWorkerUrl, getOutputDir: async () => '', displayFilesystemPath: String, initStandardToolPlasma: () => {}, disposeStandardToolPlasma: () => {} });
const controller = createWordPdfController({
  overlay: document.getElementById('wordToPdfOverlay'), isTauri: true,
  getOutputDir: async () => 'C:\\QA\\output',
  checkLibreOfficeAvailable: async () => { await delay(checkDelay); return ready; },
  requestLibreOfficeRuntime: () => gateCalls++, chooseWordFiles: async () => nextPick,
  refreshIcons: () => createIcons({ icons }), showToast: message => calls.push({ command: 'toast', message }),
  openLazyTool: async id => {
    calls.push({ command: 'openLazyTool', id });
    if (editorFailure) return null;
    editor.open();
    return { raw: { openWithFile: async file => {
      calls.push({ command: 'import', file });
      return editor.openWithFile(new File([pdfBytes], file.name, { type: 'application/pdf' }));
    } } };
  },
  nativeListen: async (_, handler) => { events.add(handler); return () => events.delete(handler); },
  nativeInvoke: async (command, args) => {
    calls.push({ command, args });
    if (command === 'cancel_word_to_pdf') { cancelled = true; return true; }
    if (command === 'open_path') return;
    if (command === 'inspect_word_history') {
      await delay(historyDelay);
      return args.items.map((item, index) => ({ sourceState: (historyProbeMode === 'source-changed' && index === 0 || historyProbeMode === 'mixed' && index === 2) ? 'changed' : (historyProbeMode === 'source-missing' && index === 0 || historyProbeMode === 'mixed' && index === 3) ? 'missing' : 'available',
        sourceHash: (historyProbeMode === 'source-changed' && index === 0 || historyProbeMode === 'mixed' && index === 2) ? item.archive ? null : 'e'.repeat(64) : item.sourceHash || 'a'.repeat(64),
        outputState: !item.outputPath || item.outputPath.includes('missing') ? 'missing' : historyProbeMode === 'output-changed' ? 'changed' : 'available', outputBytes: item.outputBytes || pdfBytes.byteLength }));
    }
    if (command === 'inspect_word_zip') {
      await delay(archiveDelay);
      if (args.path.includes('unsafe')) throw 'word-render:invalid-archive';
      return { archivePath: args.path, archiveHash: 'a'.repeat(64), skipped: 1,
        entries: [{ entryName: '合同/同名.docx', size: 100 }, { entryName: '资料/旧版.doc', size: 200 }] };
    }
    if (command !== 'convert_word_to_pdf') throw new Error('Unexpected command: ' + command);
    if (mode === 'archive-changed') throw 'word-render:archive-changed';
    if (mode === 'field-error') throw 'word-render:field-update-failed';
    if (mode === 'watermark-error') throw 'word-render:watermark-failed';
    if (mode === 'encryption-error') throw 'word-render:encryption-failed';
    cancelled = false;
    const files = [];
    if (mode === 'partial') {
      for (const [index, inputPath] of args.inputPaths.entries()) {
        const file = { inputPath, status: 'pending' };
        for (const event of events) event({ payload: { jobId: args.jobId, index, total: args.inputPaths.length, phase: 'converting', file } });
      }
      partialProgress = {
        staged: q('ProgressBar').style.width,
        stagedText: q('ProgressText').textContent,
      };
    }
    for (const [index, inputPath] of args.inputPaths.entries()) {
      const file = { inputPath, outputPath: null, status: 'converting' };
      const emit = phase => { for (const event of events) event({ payload: { jobId: args.jobId, index, total: args.inputPaths.length, phase, file } }); };
      emit('converting');
      if (mode === 'cancel') await until(() => cancelled); else await delay(90);
      Object.assign(file, cancelled ? { status: 'cancelled', error: 'word-render:cancelled' } : mode === 'partial' && index === 1 ? { status: 'failed', error: 'word-render:invalid-document' } : { status: 'success', outputPath: inputPath.startsWith('zip:') ? `C:\\QA\\output\\archive-${index}.pdf` : inputPath + '.pdf', outputBytes: pdfBytes.byteLength, pageCount: 2 });
      file.fontNotices = file.status === 'success' && inputPath === paths[0] ? [
        { code: 'missing-font', font: 'Missing <Font> 中文', replacement: 'Noto Sans SC' },
        { code: 'embedding-restricted', font: 'Restricted Font', replacement: '' },
      ] : [];
      file.fieldUpdate = file.status === 'success' && args.refreshFields ? { enabled: true, fields: 3, indexes: 1, skippedFields: 2, skippedIndexes: 0, passes: 2, stabilized: true, pages: 2 } : null;
      file.watermarkPages = file.status === 'success' && args.watermark ? 2 : null;
      file.encrypted = file.status === 'success' && Boolean(args.encryption);
      file.sourceHash = args.expectedHashes?.find(item => item.inputPath === inputPath)?.sourceHash || 'a'.repeat(64);
      file.outputHash = file.status === 'success' ? 'b'.repeat(64) : null;
      files.push(file); emit('done');
      if (mode === 'partial' && index === 0) {
        emit('done');
        partialProgress.first = q('ProgressBar').style.width;
      }
    }
    return { jobId: args.jobId, files, cancelled };
  },
});
prepareToolPageChrome(document.getElementById('wordToPdfOverlay'));
prepareToolPageChrome(document.getElementById('pdfEditorOverlay'));
await controller.open();
const hideQa = document.createElement('button');
hideQa.textContent = 'Hide QA';
hideQa.onclick = () => document.getElementById('qa-controls').hidden = true;
document.getElementById('qa-controls').prepend(hideQa);
document.getElementById('qa-light').onclick = () => applyTheme(document.documentElement, { mode: 'light' });
document.getElementById('qa-dark').onclick = () => applyTheme(document.documentElement, { mode: 'dark' });
document.getElementById('qa-en').onclick = () => setLangWithoutFade('en');
document.getElementById('qa-zh').onclick = () => setLangWithoutFade('zh');
async function pick(files = paths, expected = files.length) { nextPick = files; q('Pick').click(); await delay(0); await until(() => !controller.busy && q('Files').children.length === expected); }
async function success(files = paths) { mode = 'success'; await pick(files); q('Convert').click(); await until(() => !controller.busy && q('Success').classList.contains('visible')); }
document.getElementById('qa-demo').onclick = async () => { q('Done').click(); mode = 'success'; await pick([archivePath], 2); };
document.getElementById('qa-run').onclick = async () => {
  const originalLanguage = getLang();
  try {
    output.textContent = 'Running'; assertions.length = 0; calls = [];
    assert(document.activeElement === q('Pick') || q('Empty').hidden === false, 'initial empty conversion page');
    assert(!document.getElementById('wordPdfStage'), 'Word tool has no result canvas or PDF preview');
    assert(!q('RefreshFields').checked, 'internal field refresh defaults off');
    await pick(); ready = false; checkDelay = 400;
    q('Convert').click();
    assert(q('Process').classList.contains('visible'), 'mask opens in click handler before slow dependency check');
    await delay(40);
    assert(document.getElementById('wordToPdfOverlay').inert && document.activeElement === q('Cancel'), 'processing owns focus');
    await until(() => !controller.busy);
    assert(gateCalls === 1 && !q('Process').classList.contains('visible') && !q('Convert').disabled, 'missing runtime closes mask and retains queue');
    ready = true;
    q('Convert').click(); q('Cancel').click(); await until(() => !controller.busy);
    assert(!calls.some(call => call.command === 'convert_word_to_pdf'), 'cancel during preparation never launches native conversion');
    checkDelay = 0; mode = 'partial'; q('Convert').click(); await until(() => !controller.busy);
    assert(partialProgress?.staged === '0%' && /1\s*\/\s*2/.test(partialProgress.stagedText), 'native staging retains the first document and zero completed progress');
    assert(partialProgress?.first === '50%', 'repeated completion retains the count of distinct completed documents');
    assert(!q('Retry').hidden && !q('Success').classList.contains('visible'), 'partial success retains retryable queue');
    assert(q('Files').textContent.includes('Noto Sans SC') && !q('Files').querySelector('font'), 'queue shows escaped font replacement notices');
    assert(events.size === 0, 'progress listener released after partial batch');
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.refreshFields === false, 'default request does not opt in to field refresh');
    mode = 'success'; q('Retry').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.inputPaths.join() === paths[1], 'retry converts only failed file');
    assert(q('Success').classList.contains('visible') && !q('ResultChoice').hidden, 'batch results have a selector');
    q('ResultSelect').value = paths[1]; q('ResultSelect').dispatchEvent(new Event('change'));
    q('SuccessFolder').click(); await delay(30);
    assert(calls.at(-1).command === 'open_path' && calls.at(-1).args.path === paths[1] + '.pdf', 'show in folder passes selected file, not parent');
    assert(q('Success').classList.contains('visible'), 'show in folder keeps results available');
    for (const lang of ['en', 'zh']) {
      setLangWithoutFade(lang); applyTranslations(); await delay(30);
      assert(q('SuccessEditor').textContent.includes(lang === 'en' ? 'PDF Editor' : 'PDF 编辑器'), `result actions translated (${lang})`);
      assert(q('SuccessFonts').hidden, 'switching to a clean result clears font notices');
      q('ResultSelect').value = paths[0]; q('ResultSelect').dispatchEvent(new Event('change'));
      assert(q('SuccessFonts').textContent.includes('Noto Sans SC') && q('SuccessFonts').textContent.includes(lang === 'en' ? 'embedding restricted' : '限制嵌入'), `font replacement and restriction notices translated (${lang})`);
      q('ResultSelect').value = paths[1]; q('ResultSelect').dispatchEvent(new Event('change'));
    }
    q('SuccessEditor').click(); await until(() => !controller.busy);
    await until(() => document.querySelector('#pdfEditorCanvasScroll canvas'));
    assert(!document.getElementById('wordToPdfOverlay').classList.contains('visible') && q('Files').children.length === 0, 'handoff destroys Word queue and leaves conversion page');
    assert(document.getElementById('pdfEditorFileName').textContent === '旧文档.doc.pdf', 'real PDF Editor receives selected output');
    assert(document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 2, 'real editor loads both PDF pages');
    await editor.close(); await controller.open();
    assert(!q('Empty').hidden && q('Files').children.length === 0, 'reopen is clean');
    await success([paths[0]]); q('Done').click();
    assert(!q('Success').classList.contains('visible') && !q('Empty').hidden && q('SuccessPath').textContent === '', 'close clears result paths, queue and modal');
    await success([paths[0]]);
    q('Success').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay(30);
    assert(!q('Success').classList.contains('visible') && q('Files').children.length === 0, 'Escape uses the same result reset');
    mode = 'cancel'; await pick([paths[0]]); q('Convert').click(); await until(() => calls.at(-1).command === 'convert_word_to_pdf');
    controller.close(); await controller.open(); await until(() => !controller.busy);
    assert(!q('Success').classList.contains('visible') && q('Files').children.length === 0 && events.size === 0, 'close and reopen isolates stale cancellation/results');
    editorFailure = true; await success([paths[0]]); q('SuccessEditor').click(); await until(() => !controller.busy);
    assert(calls.at(-1).command === 'toast', 'failed navigation gives saved-file recovery feedback');
    editorFailure = false; await controller.open();
    await success([paths[0]]); q('Done').click();
    assert(!q('Convert').disabled === false && document.activeElement === q('Pick'), 'ready for next file after closing results');
    assert(!calls.some(call => ['read_pdf_to_image_source', 'open_image_pdf_result'].includes(call.command)), 'conversion never reads or renders saved PDF');
    await pick([archivePath], 2);
    assert(q('Files').textContent.includes('资料包.zip / 合同/同名.docx'), 'ZIP entries show escaped archive and entry origins');
    assert(q('Status').textContent.includes('1'), 'ignored non-Word entries are reported');
    await pick([archivePath], 2);
    assert(q('Files').children.length === 2, 'repeated archive entries are de-duplicated');
    mode = 'partial'; q('Convert').click(); await until(() => !controller.busy);
    const archiveCall = calls.filter(call => call.command === 'convert_word_to_pdf').at(-1);
    assert(archiveCall.args.archiveInputs.length === 2 && archiveCall.args.archiveInputs[0].archiveHash === 'a'.repeat(64), 'conversion receives immutable archive descriptors');
    mode = 'success'; q('Retry').click(); await until(() => !controller.busy);
    const retriedArchive = calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args;
    assert(retriedArchive.inputPaths.length === 1 && retriedArchive.archiveInputs[0].entryName === '资料/旧版.doc', 'retry reads only the failed archive entry');
    q('Done').click();
    nextPick = ['C:\\QA\\unsafe.zip', paths[0]]; q('Pick').click(); await until(() => !controller.busy && q('Files').children.length === 1);
    assert(q('Status').textContent.includes('1'), 'invalid ZIP leaves other selected documents available');
    q('Clear').click();
    await pick(Array.from({ length: 19 }, (_, i) => `C:\\QA\\${i}.docx`));
    nextPick = [archivePath]; q('Pick').click(); await delay(30);
    assert(q('Files').children.length === 19 && !q('Status').hidden, 'expanded queue limit rejects entire archive addition');
    q('Clear').click(); archiveDelay = 200; nextPick = [archivePath]; q('Pick').click(); await delay(20);
    assert(controller.busy && q('Convert').disabled && q('Clear').disabled && q('RefreshFields').disabled, 'archive inspection locks queue mutations');
    controller.close(); await controller.open(); await pick([paths[0]]); await delay(230);
    assert(q('Files').children.length === 1 && !q('Files').textContent.includes('资料包.zip'), 'late ZIP inspection cannot populate a reopened session');
    archiveDelay = 0; q('Clear').click(); await pick([archivePath], 2); mode = 'archive-changed';
    q('Convert').click(); await until(() => !controller.busy);
    assert(!q('Retry').hidden && q('Files').querySelectorAll('[data-word-result]').length === 0, 'changed archives fail without publishing stale inputs');
    q('Clear').click(); mode = 'success';
    for (const lang of ['en', 'zh']) {
      setLangWithoutFade(lang); applyTranslations(); assert(q('Pick').textContent.includes('ZIP'), `ZIP picker translated (${lang})`);
      assert(q('RefreshFields').closest('label').textContent.includes(t('home.wordPdf.refreshFields')), `field refresh label translated (${lang})`);
    }
    await pick([paths[0]]); q('RefreshFields').checked = true; q('Convert').click();
    assert(q('RefreshFields').disabled, 'field refresh option is locked for the running request');
    await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.refreshFields === true, 'opt-in is passed to the native conversion');
    assert(q('SuccessFonts').querySelector('.word-pdf-field-summary')?.textContent.includes('3'), 'result displays supported update and skipped counts');
    q('Done').click(); assert(!q('RefreshFields').checked, 'clearing results resets the opt-in');
    await pick([paths[0]]); q('RefreshFields').checked = true; mode = 'field-error'; q('Convert').click(); await until(() => !controller.busy);
    assert(!q('Retry').hidden && !q('Files').querySelector('[data-word-result]'), 'field failure retains retryable input without a published result');
    q('RefreshFields').checked = false; mode = 'success'; q('Retry').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.refreshFields === false && !q('SuccessFonts').querySelector('.word-pdf-field-summary'), 'retry can turn refresh off and clears stale update metadata');
    q('Done').click(); await pick([paths[0]]); q('RefreshFields').checked = true; mode = 'cancel'; q('Convert').click();
    await until(() => calls.at(-1).command === 'convert_word_to_pdf'); controller.close(); await controller.open(); await until(() => !controller.busy);
    assert(!q('RefreshFields').checked && q('Files').children.length === 0, 'closing a refresh request cancels it and resets the next session');
    mode = 'success';
    assert(!q('WatermarkEnabled').checked && q('WatermarkSettings').hidden, 'watermark defaults off');
    await pick([paths[0]]); q('WatermarkEnabled').click();
    q('WatermarkText').value = '内部资料 DRAFT'; q('WatermarkText').dispatchEvent(new Event('input'));
    q('WatermarkPreview').click(); await until(() => !q('WatermarkCanvas').hidden);
    assert(q('WatermarkCanvas').width > 0 && q('WatermarkPreviewStatus').textContent.length > 20, 'actual embedded-font PDF watermark renders with a labeled placement-only preview');
    q('WatermarkPages').value = '0'; q('WatermarkPages').dispatchEvent(new Event('input'));
    assert(q('WatermarkCanvas').hidden, 'changing settings invalidates the previous preview');
    const beforeWatermarkCalls = calls.filter(call => call.command === 'convert_word_to_pdf').length;
    q('Convert').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeWatermarkCalls && !q('Retry').hidden, 'invalid watermark pages fail before native conversion and remain retryable');
    q('WatermarkPages').value = '1-2'; q('WatermarkPages').dispatchEvent(new Event('input'));
    q('Retry').click(); await until(() => document.getElementById('wordPdfSuccess').classList.contains('visible'));
    const watermarkArgs = calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.watermark;
    assert(watermarkArgs.pages === '1-2' && atob(watermarkArgs.pdfBase64).startsWith('%PDF-'), 'conversion receives exactly the prepared PDF layer and page range');
    assert(q('SuccessFonts').textContent.includes('2'), 'result includes the applied watermark page count');
    q('Done').click(); assert(!q('WatermarkEnabled').checked && !q('WatermarkText').value, 'clearing results resets watermark content and opt-in');
    await pick([paths[0]]); q('WatermarkEnabled').click(); q('WatermarkType').value = 'image'; q('WatermarkType').dispatchEvent(new Event('input'));
    const stamp = document.createElement('canvas'); stamp.width = 100; stamp.height = 50;
    const ctx = stamp.getContext('2d'); ctx.fillStyle = '#cc3333'; ctx.fillRect(0,0,100,50);
    const blob = await new Promise(resolve => stamp.toBlob(resolve)); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'stamp.png', {type:'image/png'}));
    q('WatermarkImage').files = transfer.files; q('WatermarkImage').dispatchEvent(new Event('input'));
    q('WatermarkPreview').click(); await until(() => !q('WatermarkCanvas').hidden);
    assert(q('WatermarkTextField').hidden && !q('WatermarkImageField').hidden, 'image mode accepts local PNG and renders its actual PDF layer');
    mode = 'watermark-error'; q('Convert').click(); await until(() => !controller.busy);
    assert(!q('Retry').hidden && !q('Files').querySelector('[data-word-result]'), 'watermark failure exposes no result and keeps its retryable input');
    q('WatermarkEnabled').click(); mode = 'success'; q('Retry').click(); await until(() => !controller.busy);
    assert(!calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.watermark && !q('SuccessFonts').textContent.includes('watermark'), 'retry can turn watermark off without a stale payload');
    q('Done').click(); q('WatermarkEnabled').click(); q('WatermarkText').value = 'Closing'; q('WatermarkPreview').click();
    controller.close(); await controller.open(); await delay(150);
    assert(!q('WatermarkEnabled').checked && q('WatermarkCanvas').hidden && q('WatermarkImage').files.length === 0, 'closing destroys pending preview work and clears image/text from the next session');
    assert(!q('EncryptionEnabled').checked && q('EncryptionSettings').hidden, 'encryption defaults off');
    await pick([paths[0]]); q('EncryptionEnabled').click();
    q('EncryptionPassword').value = 'short'; q('EncryptionConfirm').value = 'different';
    const beforeEncryption = calls.filter(call => call.command === 'convert_word_to_pdf').length;
    q('Convert').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeEncryption && !q('Retry').hidden, 'mismatched encryption passwords do not invoke native conversion');
    q('EncryptionConfirm').value = 'short'; q('Retry').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeEncryption, 'short passwords stay local and require correction');
    q('EncryptionPassword').value = q('EncryptionConfirm').value = '中文安全密码-QA-😀';
    q('EncryptionCopying').checked = false; q('EncryptionPrinting').value = 'lowResolution';
    q('Retry').click();
    assert(!q('EncryptionPassword').value && !q('EncryptionConfirm').value && q('EncryptionPrinting').disabled, 'valid passwords clear immediately while permissions lock for the run');
    await until(() => !controller.busy);
    const protectedArgs = calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.encryption;
    assert(protectedArgs.password === '' && protectedArgs.permissions.copying === false && protectedArgs.permissions.printing === 'lowResolution', 'native request preserves permissions and drops the password reference after completion');
    assert(q('SuccessEditor').disabled && q('SuccessFonts').textContent.includes('AES-256'), 'encrypted result names the algorithm and prevents unsupported editor handoff');
    q('Done').click();
    assert(!q('EncryptionEnabled').checked && !q('EncryptionPassword').value && q('EncryptionCopying').checked, 'clear resets encryption opt-in, passwords and permissions');
    await pick([paths[0]]); q('EncryptionEnabled').click(); q('EncryptionPassword').value = q('EncryptionConfirm').value = 'failure-test-123';
    mode = 'encryption-error'; q('Convert').click(); await until(() => !controller.busy);
    assert(!q('Retry').hidden && !q('Files').querySelector('[data-word-result]') && !q('EncryptionPassword').value, 'encryption failure retains input without result or password');
    const beforeEmptyRetry = calls.filter(call => call.command === 'convert_word_to_pdf').length;
    q('Retry').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeEmptyRetry, 'encrypted retry requires a newly entered password');
    q('EncryptionEnabled').click(); mode = 'success'; q('Retry').click(); await until(() => !controller.busy);
    assert(!q('SuccessEditor').disabled && !calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.encryption, 'retry can explicitly turn encryption off and restores editor handoff');
    q('Done').click(); await pick([paths[0]]); q('EncryptionEnabled').click(); q('EncryptionPassword').value = q('EncryptionConfirm').value = 'cancel-prepare-123'; checkDelay = 250;
    const beforeCloseEncryption = calls.filter(call => call.command === 'convert_word_to_pdf').length;
    q('Convert').click(); controller.close(); await controller.open(); await until(() => !controller.busy); checkDelay = 0;
    assert(!q('EncryptionEnabled').checked && !q('EncryptionPassword').value && !q('EncryptionConfirm').value && q('Files').children.length === 0, 'closing cancels preparation and clears encryption state across sessions');
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeCloseEncryption, 'cancelled encryption preparation publishes no native request');
    const recipe = { version: 1, refreshFields: true, watermarkRequired: false, encryptionRequired: false, files: [
      { inputPath: paths[0], sourceHash: 'a'.repeat(64), status: 'success', outputPath: 'C:/QA/kept.pdf', outputHash: 'b'.repeat(64), outputBytes: pdfBytes.byteLength, pageCount: 2 },
      { inputPath: paths[1], sourceHash: 'a'.repeat(64), status: 'success', outputPath: 'C:/QA/missing.pdf', outputHash: 'b'.repeat(64), outputBytes: pdfBytes.byteLength, pageCount: 2 }
    ] };
    const beforeRestore = calls.filter(call => call.command === 'convert_word_to_pdf').length;
    assert(await controller.restoreHistory(recipe), 'history recipe restores through the actual Word controller');
    assert(q('Files').children.length === 2 && q('Files').querySelectorAll('[data-word-result]').length === 1 && q('RefreshFields').checked, 'retained outputs stay available while missing output becomes pending');
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeRestore, 'restoration never starts conversion automatically');
    assert(!await controller.restoreHistory(recipe) && q('Files').children.length === 2, 'restoration refuses to overwrite an existing queue');
    q('Convert').click(); await until(() => !controller.busy);
    const recoveredCall = calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args;
    assert(recoveredCall.inputPaths.length === 1 && recoveredCall.inputPaths[0] === paths[1] && recoveredCall.expectedHashes[0].sourceHash === 'a'.repeat(64), 'only missing output is regenerated and its source fingerprint is checked natively');
    q('Done').click(); historyProbeMode = 'source-changed'; await controller.restoreHistory({ ...recipe, files: [{ ...recipe.files[0], status: 'failed', outputPath: null }] });
    assert(q('Convert').disabled && q('Files').querySelector('[data-word-accept-current]'), 'changed sources block conversion until explicitly accepted');
    q('Files').querySelector('[data-word-accept-current]').click(); q('Convert').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').at(-1).args.expectedHashes[0].sourceHash === 'e'.repeat(64), 'current-version confirmation replaces the expected source fingerprint');
    q('Done').click(); historyProbeMode = 'source-missing'; await controller.restoreHistory({ ...recipe, files: [recipe.files[0]] });
    assert(q('Files').querySelector('[data-word-result]') && q('Convert').disabled, 'missing source still permits viewing a retained PDF');
    q('HistoryRegenerate').click(); assert(q('Convert').disabled && !q('Files').querySelector('[data-word-result]'), 'regenerating a missing source is blocked without inventing a download cache');
    q('Clear').click(); historyProbeMode = 'source-changed';
    await controller.restoreHistory({ ...recipe, files: [{ inputPath: `zip:${JSON.stringify([archivePath, '合同/同名.docx'])}`, archive: { archivePath, entryName: '合同/同名.docx', archiveHash: 'a'.repeat(64) }, status: 'failed' }] });
    assert(q('Convert').disabled && !q('Files').querySelector('[data-word-accept-current]'), 'changed ZIP requires re-adding the archive instead of silently selecting new entry contents');
    q('Clear').click(); historyProbeMode = 'output-changed'; await controller.restoreHistory({ ...recipe, files: [recipe.files[0]] });
    assert(!q('Convert').disabled && !q('Files').querySelector('[data-word-result]'), 'changed output is marked for a new conversion instead of trusted as the old result');
    q('Clear').click(); historyProbeMode = 'normal';
    await controller.restoreHistory({ ...recipe, watermarkRequired: true, encryptionRequired: true, permissions: { printing: false, copying: false }, files: [{ ...recipe.files[0], status: 'failed', outputPath: null }] });
    assert(q('WatermarkEnabled').checked && q('EncryptionEnabled').checked && !q('WatermarkText').value && !q('EncryptionPassword').value && q('EncryptionPrinting').value === 'none', 'protected history restores nonsecret settings and requires password/watermark re-entry');
    const beforeProtectedRetry = calls.filter(call => call.command === 'convert_word_to_pdf').length; q('Convert').click(); await until(() => !controller.busy);
    assert(calls.filter(call => call.command === 'convert_word_to_pdf').length === beforeProtectedRetry, 'protected history cannot silently regenerate an unencrypted result');
    q('Clear').click(); historyDelay = 120; const lateRestore = controller.restoreHistory(recipe); controller.close(); await controller.open(); await lateRestore; historyDelay = 0;
    assert(q('Files').children.length === 0 && q('History').hidden, 'closing a history probe cannot populate a reopened queue');
    controller.close(); document.body.insertAdjacentHTML('beforeend', productivityTemplate);
    const historyStore = new Map(), storage = { getItem: key => historyStore.get(key), setItem: (key, value) => historyStore.set(key, value) };
    const beforeRestart = createTaskCenter({ storage }); beforeRestart.begin({ label: 'Word recovery QA', tool: 'word-to-pdf', recovery: recipe }).finish({ outputs: ['C:/QA/kept.pdf'] });
    const restarted = createTaskCenter({ storage }); let recoveryNavigations = 0;
    const productivity = initProductivityTool({ overlay: document.getElementById('productivityOverlay'), isTauri: true, center: restarted,
      nativeInvoke: async command => command === 'undo_batch_rename' ? 0 : undefined,
      openLazyTool: async id => { if (id !== 'word-to-pdf') throw Error('wrong route'); recoveryNavigations++; await controller.open(); return { raw: controller }; } });
    productivity.open('task-center'); const recoveryButton = document.querySelector('[data-task-recovery="word"]');
    assert(recoveryButton && !recoveryButton.disabled, 'Task Center offers recovery after rebuilding its storage-backed instance');
    recoveryButton.click(); await until(() => recoveryNavigations === 1 && !controller.busy && q('Files').children.length === 2);
    assert(q('History').hidden === false && document.getElementById('productivityOverlay').inert, 'Task Center recovery navigates to the real Word queue and releases modal ownership');
    restarted.clearFinished(); assert(historyStore.get('toolknit.tasks.v1') === '[]', 'clearing task history removes metadata without a filesystem delete call');
    productivity.dispose(); document.getElementById('productivityOverlay').remove(); q('Clear').click();
    setLangWithoutFade(originalLanguage);
    output.textContent = `PASS ${assertions.length}\n` + assertions.join('\n');
  } catch (error) { output.textContent = `FAIL ${error.stack}\n` + assertions.join('\n'); }
};
if (new URL(location.href).searchParams.has('zip-demo')) {
  document.getElementById('qa-controls').hidden = true;
  await pick([archivePath], 2);
  if (new URL(location.href).searchParams.has('fields')) q('RefreshFields').checked = true;
  if (new URL(location.href).searchParams.has('watermark-demo')) {
    q('WatermarkEnabled').click(); q('WatermarkText').value = '内部资料 DRAFT'; q('WatermarkText').dispatchEvent(new Event('input'));
    q('WatermarkPreview').click(); await until(() => !q('WatermarkCanvas').hidden);
  }
  if (new URL(location.href).searchParams.has('encryption-demo')) {
    q('EncryptionEnabled').click(); q('EncryptionPrinting').value = 'lowResolution'; q('EncryptionCopying').checked = false;
  }
}
window.wordHistoryDemo = async () => {
  controller.close(); await controller.open(); historyProbeMode = 'mixed'; mode = 'success';
  return controller.restoreHistory({ version: 1, refreshFields: true, files: [
    { inputPath: 'C:/QA/合同.docx', sourceHash: 'a'.repeat(64), status: 'success', outputPath: 'C:/QA/retained.pdf', outputHash: 'b'.repeat(64), outputBytes: pdfBytes.byteLength, pageCount: 2 },
    { inputPath: 'C:/QA/丢失输出.docx', sourceHash: 'a'.repeat(64), status: 'success', outputPath: 'C:/QA/missing.pdf', outputHash: 'b'.repeat(64), outputBytes: pdfBytes.byteLength, pageCount: 2 },
    { inputPath: 'C:/QA/已变化.docx', sourceHash: 'a'.repeat(64), status: 'failed' },
    { inputPath: 'C:/QA/源文件已移动.docx', sourceHash: 'a'.repeat(64), status: 'failed' }
  ] });
};
if (new URL(location.href).searchParams.has('history-demo')) { document.getElementById('qa-controls').hidden = true; await window.wordHistoryDemo(); }
