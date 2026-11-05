import '../../src/features/file-search/floating.css';
import { createResults, resultsMarkup } from '../../src/features/file-search/results.js';
import { createIcons, icons } from 'lucide';
import { t } from '../../src/i18n.js';
const host = document.getElementById('fileSearchRoot');
host.innerHTML = `<section class="fs-card" data-visible="true">${resultsMarkup()}</section>`;
const root = host.firstElementChild, list = root.querySelector('.fs-list');
const sample = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), name: `合同${i + 1}.pdf`, parent: String.raw`C:\ToolKnit-Synthetic\Documents`, extension: 'pdf', size: i * 1024, modified: 1793664000 + i }));
const suffixes = Array.from({ length: 120 }, (_, i) => `type${i}`);
sample[0].modified=Number.MAX_SAFE_INTEGER;
let iconRefreshes = 0, queries = 0, reveals = 0, resultChanged=false;
const index = { phase: 'ready', generation: 1, indexed: 1000000 };
const results = createResults({ root, tr: (key, vars) => t(`fileSearch.${key}`, vars), refreshIcons: () => { iconRefreshes++; createIcons({ icons }); }, runtime: { call: async (action, payload = {}) => {
  if (action === 'query-invalidate') return null;
  if (action === 'reveal') { reveals++; return null; }
  if (action === 'query-check') return {changed:resultChanged,generation:index.generation,extensions:suffixes};
  if (action === 'search') { queries++;resultChanged=false;await new Promise(resolve=>setTimeout(resolve,40)); const offset = payload.cursor?.offset || 0; return { result: { rows: sample.slice(offset, offset + 500), total: sample.length, extensions: suffixes }, cursor: offset + 500 < sample.length ? { offset: offset + 500 } : null, ticket: 'synthetic-only', generation:index.generation,index:{...index} }; }
  throw Error(action);
} } });
results.session.set({ text: '合同' }); results.session.start();
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const until = async fn => { for (let i = 0; i < 120; i++) { if (fn()) return; await frame(); } throw Error('fixture did not settle'); };
const report = document.getElementById('qa-report');
document.getElementById('qa-run').onclick = async () => {
  const checks = [], metrics = {};
  const check = (valid, label) => { if (!valid) throw Error(label); checks.push(label); };
  try {
    await until(() => list.querySelector('.fs-row'));
    let mutations = 0, added = 0;
    const observer = new MutationObserver(records => { mutations += records.length; added += records.reduce((n,r) => n + r.addedNodes.length, 0); });
    observer.observe(root, { childList: true, subtree: true });
    const first = list.querySelector('.fs-row'), option = root.querySelector('.fs-extension option');
    const beforeIcons = iconRefreshes, start = performance.now();
    for (let i = 0; i < 200; i++) { results.render(); results.setIndex({ ...index }); }
    await frame(); await frame();
    metrics.unchanged = { elapsedMs: Math.round((performance.now()-start)*10)/10, mutations, added, iconRefreshes: iconRefreshes-beforeIcons, rowRetained: first===list.querySelector('.fs-row'), optionRetained: option===root.querySelector('.fs-extension option') };
    check(mutations===0 && iconRefreshes===beforeIcons, 'unchanged state creates no DOM mutations or icon refreshes');
    check(first===list.querySelector('.fs-row') && option===root.querySelector('.fs-extension option'), 'unchanged rows and options retain identity');
    check(first.querySelector('.fs-file-meta').textContent.includes(t('fileSearch.unknown')), 'out-of-range cached dates render an unknown value without breaking the list');
    mutations = 0; added = 0; const iconsAtScroll = iconRefreshes;
    for (let i = 1; i <= 20; i++) { list.scrollTop = i; list.dispatchEvent(new Event('scroll')); await frame(); }
    await frame();
    metrics.sameWindowScroll = { mutations, added, iconRefreshes: iconRefreshes-iconsAtScroll, scrollTop:list.scrollTop };
    check(mutations===0 && iconRefreshes===iconsAtScroll, 'scrolling inside the same virtual window does not rebuild nodes');
    observer.disconnect();
    check(list.scrollTop===20, 'scroll position is preserved');
    check(list.querySelectorAll('.fs-row').length<30, 'DOM window stays bounded');
    list.scrollTop=74*150; list.dispatchEvent(new Event('scroll')); await frame(); await frame();
    check(Number(list.querySelector('[data-fs-row]').dataset.fsRow)>=146, 'crossing a virtual window renders its new rows');
    const beforeAppend=list.scrollTop; await results.session.more(); await frame();
    check(list.scrollTop===beforeAppend, 'loading more preserves scroll');
    results.navigate('End'); await frame();
    check(list.querySelector('.is-selected .fs-file-name')?.textContent==='合同1000.pdf', 'keyboard End renders and selects the last loaded row');
    const beforeReveal=reveals; results.navigate('Enter'); await frame();
    check(reveals===beforeReveal+1, 'explicit selected result can be revealed');
    const ext=root.querySelector('.fs-extension'); ext.nextElementSibling.querySelector('button').click(); await frame();
    const menu=document.getElementById(ext.nextElementSibling.querySelector('button').getAttribute('aria-controls'));
    const input=menu.querySelector('input'); input.value='TYPE11'; input.dispatchEvent(new Event('input',{bubbles:true}));
    results.render(); await frame();
    check(input.value==='TYPE11' && !menu.hidden, 'unchanged render preserves an open filter draft');
    results.closeFilters();
    results.session.refresh();await until(()=>!list.querySelector('[data-fs-reveal]')?.disabled);
    list.scrollTop=0;list.dispatchEvent(new Event('scroll'));list.dispatchEvent(new PointerEvent('pointerleave'));await frame();
    // Clear keyboard selection with a different query, matching a new user search.
    results.session.set({text:'合同 changed'},{immediate:true});await until(()=>!!list.querySelector('[data-fs-reveal]:not(:disabled)'));
    const textChanges=[],footer=root.querySelector('.fs-footer');
    const stateObserver=new MutationObserver(()=>textChanges.push(footer.textContent));stateObserver.observe(footer,{childList:true,subtree:true,characterData:true});
    const searchesBefore=queries;
    for(let i=0;i<100;i++){index.generation++;results.setIndex({...index});}
    await new Promise(resolve=>setTimeout(resolve,1600));
    check(queries===searchesBefore && root.querySelector('.fs-refresh').hidden,'100 unrelated index changes neither search again nor prompt refresh');
    sample[0]={...sample[0],name:'合同已更新.pdf'};resultChanged=true;index.generation++;results.setIndex({...index});
    for(let i=0;i<100;i++){if(list.querySelector('.fs-file-name')?.textContent==='合同已更新.pdf'&&!list.querySelector('[data-fs-reveal]')?.disabled)break;await new Promise(resolve=>setTimeout(resolve,30));}
    check(list.querySelector('.fs-file-name')?.textContent==='合同已更新.pdf','idle result updates apply a same-count change');
    stateObserver.disconnect();
    check(!textChanges.some(value=>value.includes(t('fileSearch.searching'))),'background checks and updates never flash the searching label');
    results.session.pause();
    results.dispose(); results.dispose();
    results.render(); results.setIndex(index); results.markPending(); results.navigate('Enter'); await frame();
    check(!list.childElementCount && reveals===beforeReveal+1, 'disposed results ignore late status and navigation without rebuilding DOM');
    metrics.queries=queries; metrics.checks=checks;
    report.textContent=JSON.stringify(metrics,null,2); report.dataset.state='complete';
  } catch(error) { report.textContent=JSON.stringify({error:error.message,...metrics,checks},null,2); report.dataset.state='failed'; }
};
window.addEventListener('pagehide',()=>results.dispose(),{once:true});
