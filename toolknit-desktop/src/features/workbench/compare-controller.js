import { readTextDocument } from '../../shared/text-document-reader.js';
import { taskCenter } from '../../app/task-center.js';
import { exportComparison } from './diff-core.js';
import { element, saveText, basename } from './ui.js';

export function createDocumentComparison({ panel, isTauri, invoke, choose, getOutputDir, tr, local, message, signal }) {
  const q = selector => panel.querySelector(selector);
  let result, worker, busy = false, revision = 0, currentChange = -1;
  function render() {
    const container = q('[data-diff-result]'); container.replaceChildren();
    if (!result) { container.append(element('p', tr('compareEmpty'), 'productivity-empty'));q('[data-diff-summary]').textContent='';for(const name of ['previous-change','next-change'])q(`[data-wb-action="${name}"]`).disabled=true;return; }
    const onlyChanges = q('[data-changes-only]').checked;
    const fragment = document.createDocumentFragment();
    for (const edit of result.edits) {
      if (onlyChanges && edit.kind === 'equal') continue;
      const row = element('div', undefined, 'wb-diff-row'); row.dataset.kind = edit.kind;
      for (const side of ['left','right']) {
        const cell = element('div', undefined, 'wb-diff-cell'); cell.append(element('span', edit[`${side}Line`] ?? '', 'wb-line-number'), element('pre', edit[side])); row.append(cell);
      }
      fragment.append(row);
    }
    container.append(fragment);
    q('[data-diff-summary]').textContent = local(`新增 ${result.added} 行 · 删除 ${result.removed} 行`, `${result.added} lines added · ${result.removed} lines removed`)
      + (result.coarse ? local(' · 修改范围较大，按整块展示。', ' · Large edit displayed as a replaced block.') : '');
    for (const name of ['previous-change','next-change']) q(`[data-wb-action="${name}"]`).disabled = !result.added && !result.removed;
  }
  async function load(side, file) {
    const token = ++revision;
    if (!file) {
      if (!isTauri) { q(`[data-${side}-file]`).click(); return; }
      const path = await choose({ multiple: false, filters: [{ name: 'Documents', extensions: ['pdf','docx','txt','md','markdown','csv','tsv','json','html','htm'] }] });
      if (!path) return; file = { path, name: basename(path) };
    }
    const parsed = await readTextDocument(file, { isTauri });
    if (signal.aborted || revision !== token) return;
    q(`[data-${side}]`).value = parsed.text; message(`${tr(side)} · ${parsed.name}${parsed.truncated ? ` · ${tr('truncated')}` : ''}`);
    invalidate();
  }
  function invalidate() { result = null; q('[data-wb-action="export-diff"]').disabled = true; render(); }
  async function compare() {
    if (busy) return; busy = true; q('[data-wb-action="compare"]').disabled = true;
    const before = q('[data-before]').value, after = q('[data-after]').value, options = { ignoreSpace: q('[data-ignore-space]').checked };
    const token = ++revision;
    const task = taskCenter.begin({ label: tr('compare'), tool: 'document-compare' });
    try {
      worker = new Worker(new URL('./diff-worker.js', import.meta.url), { type: 'module' });
      const next = await new Promise((resolve, reject) => {
        let settled=false;
        const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);callback(value);};
        const timer = setTimeout(() => { worker?.terminate(); finish(reject,new Error('Document comparison timed out')); }, 30000);
        worker.onmessage = ({ data }) => { data.error ? finish(reject,new Error(data.error)) : finish(resolve,data.result); };
        worker.onerror = event => { finish(reject,new Error(event.message)); };
        const abort = () => { worker?.terminate(); finish(reject,new DOMException('Cancelled','AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        worker.postMessage({ before, after, options });
      });
      if (signal.aborted) throw new DOMException('Cancelled','AbortError');
      if (token !== revision) { task.finish({ message: local('输入已变化，请重新对比。', 'Inputs changed; compare again.') }); return; }
      result = next; currentChange = -1; render(); q('[data-wb-action="export-diff"]').disabled = false; task.finish();
    } catch (error) { task.fail(error); message(error.message || error, true); }
    finally { worker?.terminate(); worker = null; busy = false; q('[data-wb-action="compare"]').disabled = false; }
  }
  function jump(direction) {
    const rows = [...q('[data-diff-result]').querySelectorAll('[data-kind="add"], [data-kind="delete"]')];
    if (!rows.length) return; currentChange = (currentChange + direction + rows.length) % rows.length; rows[currentChange].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  for (const side of ['before','after']) {
    q(`[data-${side}-file]`).addEventListener('change', event => { const file = event.target.files[0]; if (file) void load(side, file).catch(error => message(error.message || error, true)); event.target.value = ''; }, { signal });
    q(`[data-${side}]`).addEventListener('input', () => { revision++; invalidate(); }, { signal });
  }
  q('[data-changes-only]').addEventListener('change', render, { signal });
  q('[data-ignore-space]').addEventListener('change', () => { revision++; invalidate(); }, { signal });
  render();
  return { actions: { 'load-before': () => load('before'), 'load-after': () => load('after'), compare, 'previous-change': () => jump(-1), 'next-change': () => jump(1),
    'export-diff': async () => { if (!result) return; const path = await saveText({ text: exportComparison(result), name: 'ToolKnit_diff.txt', isTauri, invoke, getOutputDir, folder: 'Document_Comparisons' }); message(path || local('差异报告已下载。', 'Comparison report downloaded.')); }
  }, language: render };
}
