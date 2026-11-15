import template from '../../src/features/word-to-pdf/template.js';
import { createWordPdfController } from '../../src/features/word-to-pdf/controller.js';
import '../../src/features/word-to-pdf/word-to-pdf.css';
import { createIcons, icons } from 'lucide';
import { setLangWithoutFade, getLang, t, onLangChange, applyTranslations } from '../../src/i18n.js';
import { prepareToolPageChrome } from '../../src/shared/tool-page-chrome.js';
import editorTemplate from '../../src/features/pdf-editor/template.html?raw';
import { initPdfEditorTool } from '../../src/features/pdf-editor/controller.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

document.body.insertAdjacentHTML('afterbegin', template + editorTemplate);
const q = suffix => document.getElementById('wordPdf' + suffix);
const output = document.getElementById('qa-result');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertions = [];
const assert = (value, message) => { if (!value) throw new Error(message); assertions.push(message); };
async function until(predicate) { for (let n = 0; n < 250; n++) { if (predicate()) return; await delay(40); } throw new Error('Timed out: ' + predicate); }
let events = new Set(), nextPick = [], calls = [], mode = 'success', ready = true;
let cancelled = false, gateCalls = 0, checkDelay = 0, editorFailure = false;
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
    if (command !== 'convert_word_to_pdf') throw new Error('Unexpected command: ' + command);
    cancelled = false;
    const files = [];
    for (const [index, inputPath] of args.inputPaths.entries()) {
      const file = { inputPath, outputPath: null, status: 'converting' };
      const emit = phase => { for (const event of events) event({ payload: { jobId: args.jobId, index, total: args.inputPaths.length, phase, file } }); };
      emit('converting');
      if (mode === 'cancel') await until(() => cancelled); else await delay(90);
      Object.assign(file, cancelled ? { status: 'cancelled', error: 'word-render:cancelled' } : mode === 'partial' && index === 1 ? { status: 'failed', error: 'word-render:invalid-document' } : { status: 'success', outputPath: inputPath + '.pdf', outputBytes: pdfBytes.byteLength, pageCount: 2 });
      files.push(file); emit('done');
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
document.getElementById('qa-light').onclick = () => document.documentElement.dataset.theme = 'light';
document.getElementById('qa-dark').onclick = () => document.documentElement.dataset.theme = 'dark';
document.getElementById('qa-en').onclick = () => setLangWithoutFade('en');
document.getElementById('qa-zh').onclick = () => setLangWithoutFade('zh');
async function pick(files = paths) { nextPick = files; q('Pick').click(); await until(() => q('Files').children.length === files.length); }
async function success(files = paths) { mode = 'success'; await pick(files); q('Convert').click(); await until(() => !controller.busy && q('Success').classList.contains('visible')); }
document.getElementById('qa-demo').onclick = async () => { q('Done').click(); mode = 'success'; await pick(); };
document.getElementById('qa-run').onclick = async () => {
  const originalLanguage = getLang();
  try {
    output.textContent = 'Running'; assertions.length = 0; calls = [];
    assert(document.activeElement === q('Pick') || q('Empty').hidden === false, 'initial empty conversion page');
    assert(!document.getElementById('wordPdfStage'), 'Word tool has no result canvas or PDF preview');
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
    assert(!q('Retry').hidden && !q('Success').classList.contains('visible'), 'partial success retains retryable queue');
    assert(events.size === 0, 'progress listener released after partial batch');
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
    setLangWithoutFade(originalLanguage);
    output.textContent = `PASS ${assertions.length}\n` + assertions.join('\n');
  } catch (error) { output.textContent = `FAIL ${error.stack}\n` + assertions.join('\n'); }
};
