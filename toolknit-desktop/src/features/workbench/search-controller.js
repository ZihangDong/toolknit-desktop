import { readTextDocument } from '../../shared/text-document-reader.js';
import { taskCenter } from '../../app/task-center.js';
import { searchTextRecords, highlightedParts } from './search-core.js';
import { element, action, basename } from './ui.js';

export function createContentSearch({ panel, isTauri, invoke, choose, tr, local, message, signal }) {
  const q = selector => panel.querySelector(selector);
  const memory = new Map();
  let busy = false, controller, revision = 0, count = 0;
  const call = request => invoke('document_content_index', { request });
  function setBusy(value) {
    busy = value; q('[data-wb-action="cancel-index"]').hidden = !value; q('[data-index-progress]').hidden = !value;
    for (const name of ['index-folder','index-files','clear-index']) q(`[data-wb-action="${name}"]`).disabled = value;
  }
  async function status() {
    if (isTauri) count = (await call({ action: 'status' })).count; else count = memory.size;
    q('[data-index-status]').textContent = local(`${count} 份文档已建立索引`, `${count} documents indexed`);
  }
  async function search() {
    const request = ++revision, query = q('[data-content-query]').value.trim();
    if (query.length < 2) { q('[data-content-results]').replaceChildren(element('p', tr('searchEmpty'), 'productivity-empty')); return; }
    const response = isTauri ? await call({ action: 'search', query }) : { results: searchTextRecords([...memory.values()], query) };
    if (request !== revision || signal.aborted) return;
    const rows = response.results, container = q('[data-content-results]'); container.replaceChildren();
    if (!rows.length) container.append(element('p', tr('noMatches'), 'productivity-empty'));
    for (const record of rows) {
      const row = element('article', undefined, 'wb-result'); row.append(element('h3', record.name), element('small', record.path || record.name));
      const snippet = element('p');
      for (const part of highlightedParts(record.snippet, query)) snippet.append(element(part.match ? 'mark' : 'span', part.text));
      row.append(snippet); if (record.truncated) row.append(element('small', tr('truncated')));
      if (isTauri) row.append(action(tr('openLocation'), () => invoke('open_path', { path: record.path }).catch(error => message(error.message || error, true))));
      container.append(row);
    }
    if (response.limited) container.append(element('p', local('仅显示前 100 个结果，请缩小关键词范围。', 'Showing the first 100 results. Refine your query.'), 'productivity-muted'));
  }
  async function index(files, root = '', scan = {}) {
    if (busy) return;
    if(files.length>2000)throw new Error(local('每次最多索引 2000 份文档。','Maximum 2,000 documents per scan.'));
    if (!files.length) {
      if(isTauri&&root&&!scan.partial&&!scan.limited&&!scan.skipped){await call({action:'finalize',root,paths:[]});await status();await search();}
      message(local('没有找到支持的文档。', 'No supported documents found.')); return;
    }
    setBusy(true); controller = new AbortController();
    const errors = [], changed = [], options = { files, root, scan };
    const task = taskCenter.begin({ label: tr('search'), tool: 'content-search', cancel: () => controller.abort(), retry: () => index(options.files, options.root, options.scan) });
    const check = () => { if (controller.signal.aborted || signal.aborted) throw new DOMException('已取消 / Cancelled', 'AbortError'); };
    try {
      const known = isTauri && root ? await call({ action: 'known', root }) : [];
      const cached = new Map(known.map(item => [item.path, item])); let processed = 0, skipped = 0;
      let extractedBytes=0;
      for (let i = 0; i < files.length; i++) {
        check(); const file = files[i], previous = cached.get(file.path);
        if(extractedBytes+(file.bytes||file.size||0)>512*1024*1024)throw new Error('本次读取达到 512 MB 限制，请分批索引 / Scan limit reached (512 MB); index in smaller batches');
        const percent = Math.floor(i / files.length * 99); task.progress(percent, file.name); q('[data-index-progress]').value = percent;
        q('[data-index-status]').textContent = `${i + 1} / ${files.length} · ${file.name}`;
        if (previous && previous.bytes === file.bytes && previous.modified === file.modified) { skipped++; continue; }
        try {
          const parsed = await readTextDocument(file, { isTauri }); check();
          extractedBytes+=parsed.bytes;
          const record = { path: file.path || file.webkitRelativePath || file.name, name: parsed.name, bytes: parsed.bytes, text: parsed.text.slice(0, 200000), truncated: parsed.truncated || parsed.text.length > 200000 };
          if (isTauri && root) await call({ action: 'put', root, path: file.path, bytes: file.bytes, modified: file.modified, text: record.text, truncated: record.truncated });
          else {if(memory.size>=5000&&!memory.has(file.webkitRelativePath||file.path||file.name))throw new Error('Index limit reached (5000 documents)');memory.set(file.webkitRelativePath || file.path || file.name, record);}
          processed++; changed.push(file.path || file.name);
        } catch (error) {
          check(); errors.push(`${file.name}: ${error.message || error}`);
          if (isTauri && file.path) await call({ action: 'remove', path: file.path });
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      check();
      if (isTauri && root && !scan.partial && !scan.limited && !scan.skipped) await call({ action: 'finalize', root, paths: files.map(file => file.path) });
      const summary = local(`新增或更新 ${processed} 份，复用 ${skipped} 份，读取失败 ${errors.length} 份。`, `${processed} indexed, ${skipped} reused, ${errors.length} unreadable.`);
      if (errors.length) task.fail(new Error(summary)); else task.finish({ message: summary });
      message(summary + (scan.limited ? local(' 本次扫描达到数量限制。', ' Scan limit reached.') : ''), !!errors.length);
      await status(); await search();
    } catch (error) { task.fail(error); message(error.message || error, error.name !== 'AbortError'); }
    finally {
      setBusy(false); q('[data-index-errors]').hidden = !errors.length;
      q('[data-index-errors] pre').textContent = errors.slice(0, 100).join('\n');
    }
  }
  async function folder() {
    if (!isTauri) { q('[data-content-folder]').click(); return; }
    const root = await choose({ directory: true, multiple: false }); if (!root) return;
    message(local('正在扫描文档目录…', 'Scanning document folder…'));
    const scan = await call({ action: 'scan', root });
    await index(scan.files.map(file => ({ ...file, size: file.bytes })), scan.root, scan);
  }
  async function files() {
    if (!isTauri) { q('[data-content-files]').click(); return; }
    const selected = await choose({ multiple:true, filters:[{name:'Documents',extensions:['pdf','docx','txt','md','markdown','csv','tsv','json','html','htm']}] });
    if(!selected)return;
    const values=await call({action:'inspect',paths:Array.isArray(selected)?selected:[selected]});
    const groups=new Map();for(const file of values){if(!groups.has(file.root))groups.set(file.root,[]);groups.get(file.root).push({...file,size:file.bytes});}
    for(const [root,files]of groups)await index(files,root,{partial:true});
  }
  for (const selector of ['[data-content-files]', '[data-content-folder]']) q(selector).addEventListener('change', event => {
    const files = [...event.target.files].filter(file => /\.(pdf|docx|txt|md|markdown|csv|tsv|json|html|htm)$/i.test(file.name));
    void index(files).catch(error => message(error.message, true)); event.target.value = '';
  }, { signal });
  q('[data-content-query]').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void search().catch(error => message(error.message || error, true)); } }, { signal });
  signal.addEventListener('abort', () => controller?.abort(), { once: true });
  q('[data-content-results]').append(element('p', tr('searchEmpty'), 'productivity-empty'));
  return { actions: { 'index-folder': folder, 'index-files': files, search, 'cancel-index': () => controller?.abort(), 'clear-index': async () => {
    if (busy) return; if (isTauri) await call({ action: 'clear' }); else memory.clear(); await status(); await search();
  } }, open: status, language: () => { if (!busy) void status().then(search).catch(() => {}); } };
}
