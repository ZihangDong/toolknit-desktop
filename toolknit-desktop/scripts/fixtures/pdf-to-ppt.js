import markup from '../../src/features/pdf-to-ppt/template.js';
import { initPdfPptTool } from '../../src/features/pdf-to-ppt/tool.js';
import { applyTheme } from '../../src/app/theme-palette.js';
import { setLangWithoutFade } from '../../src/i18n.js';
import { createTaskCenter } from '../../src/app/task-center.js';
import { createIcons, icons } from 'lucide';
const params = new URLSearchParams(location.search);
applyTheme(document.documentElement, { mode: params.get('theme') }); setLangWithoutFade(params.get('lang') || 'zh');
document.body.insertAdjacentHTML('beforeend', markup);
const center = createTaskCenter(), calls = [], workers = new Set();
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); workers.add(this); }
  terminate() { workers.delete(this); return super.terminate(); }
  postMessage(data, ...args) {
    if (data.type === 'page') window.pptTest.pagesSent++;
    if (window.pptTest.holdPage && data.type === 'page') return;
    return super.postMessage(data, ...args);
  }
};
const native = params.has('native');
const controller = initPdfPptTool({ overlay: document.getElementById('pdfPptOverlay'), isTauri: native, center,
  refreshIcons: () => createIcons({ icons }), getOutputDir: async category => { calls.push({ category }); return 'C:/QA 输出'; },
  invokeNative: async (command, payload, options) => {
    calls.push({ command, size: payload?.byteLength, options });
    if (command === 'write_unique_file_binary') {
      if (pptTest.failSave) throw new Error('synthetic disk failure');
      while (pptTest.holdSave) await new Promise(resolve => setTimeout(resolve, 20));
      pptTest.savedBytes = payload;
      return 'C:/QA 输出/合同_slides_1.pptx';
    }
    if (command === 'open_path') { pptTest.revealed = payload.path; return; }
    throw new Error('Unexpected native call: ' + command);
  }
});
window.pptTest = { controller, center, calls, workers, pagesSent: 0, holdPage: false, failSave: false, holdSave: false,
  setTheme: mode => applyTheme(document.documentElement, { mode }), setLang: setLangWithoutFade };
controller.open();
if (params.has('sample')) {
  const bytes = await (await fetch('/tmp/pdf-ppt-browser/合同%20mixed.pdf')).arrayBuffer();
  await controller.openWithFile(new File([bytes], '合同 mixed.pdf', { type: 'application/pdf' }));
}
