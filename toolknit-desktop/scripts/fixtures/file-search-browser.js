import template from '../../src/features/file-search/template.js';
import { createFileSearchController } from '../../src/features/file-search/controller.js';
import '../../src/features/file-search/file-search.css';
import { createIcons, icons } from 'lucide';
import { setLangWithoutFade } from '../../src/i18n.js';
import { prepareToolPageChrome } from '../../src/shared/tool-page-chrome.js';
import { checkSearchScroll } from './file-search-scroll-check.js';

document.body.insertAdjacentHTML('afterbegin', template);
const samples = Array.from({ length: 160 }, (_, i) => ({ id: String(i + 1), name: `装修合同${i + 1}.${i % 2 ? 'pdf' : 'docx'}`, parent: 'C:\\QA\\文件资料', extension: i % 2 ? 'pdf' : 'docx', size: 1024 * (i + 1), modified: 1793664000 + i }));
let windowState = { enabled: false, hidden: false }, callbacks = new Set(), calls = [], failure = false;
let configuredRoots = ['C:\\QA\\文件资料'], automatic = false, setupFailure = false, setupBusy = false;
const nativeIndex = { phase: 'ready', generation: 1, indexed: 160 };
let lastQuery={},lastFingerprint='';
const matching=query=>nativeIndex.phase!=='unconfigured'&&(query.text||query.extension)?samples.filter(r=>(!query.text||r.name.includes(query.text))&&(!query.extension||r.extension===query.extension)):[];
const fingerprint=rows=>JSON.stringify(rows);
const status = () => structuredClone({ automatic, setupBusy, window: windowState, index: nativeIndex, roots: configuredRoots, defaultRoots: [] });
const runtime = { available: true, listen: async cb => { callbacks.add(cb); return () => callbacks.delete(cb); },
  call: async (action, payload = {}) => {
    calls.push(action);
    if (action === 'status') return status();
    if (action === 'automatic-setup') {
      await new Promise(resolve => setTimeout(resolve, 70));
      if (setupFailure) throw Error('file-search:authorization-cancelled');
      automatic = true; configuredRoots = ['C:\\','D:\\']; return status();
    }
    if (action === 'automatic-resume' || action === 'automatic-rebuild') { nativeIndex.phase = 'ready'; nativeIndex.generation++; return status(); }
    if (action === 'context' || action === 'query-invalidate') return null;
    if (action === 'query-check') return {changed:fingerprint(matching(lastQuery))!==lastFingerprint,generation:nativeIndex.generation,extensions:['pdf','docx']};
    if (action === 'acceleration-status') return { supported: true, installed: false, enabled: false, volumes: ['C:\\', 'D:\\'] };
    if (action === 'configure') { windowState.enabled = payload.enabled; callbacks.forEach(cb => cb()); return structuredClone(windowState); }
    if (action === 'index-stop') { nativeIndex.phase = 'stopped'; return status(); }
    if (action === 'index-clear') { configuredRoots = []; nativeIndex.phase = 'unconfigured'; nativeIndex.indexed = 0; nativeIndex.generation++; return structuredClone({ roots: [], index: nativeIndex }); }
    if (action === 'index-configure') { configuredRoots = payload.roots; nativeIndex.phase = 'ready'; nativeIndex.generation++; nativeIndex.indexed = 160; return structuredClone({ roots: payload.roots, index: nativeIndex }); }
    if (action === 'reveal') { if (failure) throw Error('file-search:unavailable'); return null; }
    if (action === 'search') {
      if(windowState.enabled)throw Error('file-search:cancelled');
      lastQuery=payload.query;lastFingerprint=fingerprint(matching(lastQuery));
      const { query, cursor } = payload; let rows = nativeIndex.phase !== 'unconfigured' && (query.text || query.extension) ? samples.filter(r => (!query.text || r.name.includes(query.text)) && (!query.extension || r.extension === query.extension)) : [];
      if (query.sort === 'largest') rows.sort((a, b) => b.size - a.size);
      if (query.sort === 'name-asc') rows.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }));
      const offset = cursor?.offset || 0;
      return structuredClone({ result: { rows: rows.slice(offset, offset + 50), total: rows.length, extensions: ['pdf', 'docx'], more: offset + 50 < rows.length }, cursor: offset + 50 < rows.length ? { offset: offset + 50 } : null, ticket: 'fixture-only', generation: nativeIndex.generation, index: nativeIndex });
    }
    throw Error(`Unexpected action ${action}`);
  }
};
const overlay = document.getElementById('fileSearchOverlay'), output = document.getElementById('qa-result');
const controller = createFileSearchController({ overlay, fileSearchRuntime: runtime, isTauri: true, chooseFolders: async () => ['C:\\QA\\extra'], refreshIcons: () => createIcons({ icons }) });
prepareToolPageChrome(overlay); await controller.open();
const q = id => document.getElementById(`fileSearch${id}`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(30); } throw Error('UI did not reach expected state'); }
document.getElementById('qa-open').onclick = () => void controller.open();
document.getElementById('qa-light').onclick = () => document.documentElement.dataset.theme = 'light';
document.getElementById('qa-dark').onclick = () => document.documentElement.dataset.theme = 'dark';
document.getElementById('qa-en').onclick = () => setLangWithoutFade('en');
document.getElementById('qa-zh').onclick = () => setLangWithoutFade('zh');
document.getElementById('qa-hide').onclick = () => document.getElementById('qa-controls').hidden = true;
document.getElementById('qa-run').onclick = async () => {
  const checks = []; const assert = (test, message) => { if (!test) throw Error(message); checks.push(message); };
  try {
    output.textContent = 'Running';
    assert(!q('Setup').hidden && q('Workbench').hidden, 'first entry shows the centered onboarding instead of configuration');
    assert(!q('Scopes') && !q('Fast'), 'scope and acceleration panels are absent');
    setupBusy = true; controller.close(); await controller.open();
    assert(q('Enable').disabled, 'reopening during native setup cannot start another authorization');
    setupBusy = false; callbacks.forEach(cb => cb()); await until(() => !q('Enable').disabled);
    setupFailure = true; q('Enable').click(); q('Enable').click();
    await until(() => !q('Enable').disabled);
    assert(calls.filter(v=>v==='automatic-setup').length===1 && !automatic && configuredRoots[0].includes('QA'), 'cancelled authorization preserves old scopes and rejects duplicate clicks');
    setupFailure = false; q('Enable').click();
    await until(() => !q('Workbench').hidden && !q('Enable').disabled);
    assert(q('Setup').hidden && !q('Query').closest('[inert]'), 'successful setup enters an interactive search workspace');
    q('Query').focus();
    assert(getComputedStyle(q('Query')).backgroundImage === 'none', 'main search has no focused underline');
    await until(()=>q('Results').querySelector('.fs-empty-logo')?.complete);
    assert(q('Results').querySelector('.fs-empty-logo').getAttribute('src')==='/logo.png','idle empty state reuses the recording capsule logo');
    const emptyNode=q('Results').querySelector('.fs-empty'); await delay(1700);
    assert(q('Results').querySelector('.fs-empty')===emptyNode,'idle status refresh does not recreate or replay empty-state animation');
    q('Query').value = '合同'; q('Query').dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => q('Results').querySelector('.fs-count').textContent.includes('160'));
    assert(q('Results').querySelectorAll('.fs-row').length < 30, 'large results use a bounded DOM window');
    assert(q('Results').querySelectorAll('.fs-row button').length === q('Results').querySelectorAll('.fs-row').length, 'exactly one action per result');
    await until(() => [...q('Results').querySelectorAll('.fs-file-icon img')].every(img => img.complete && img.naturalWidth));
    assert(q('Results').querySelector('.fs-file-icon[data-file-type=word] img') || q('Results').querySelector('.fs-file-icon[data-file-type=pdf] img'), 'file-type colors load from bundled SVG assets');
    checks.push(...await checkSearchScroll(q('Results').querySelector('.fs-list'), { loadMore:true }));
    const ext = q('Results').querySelector('.fs-extension');
    const extButton=ext.nextElementSibling.querySelector('button'); extButton.click();
    const extMenu=docMenu(extButton), extSearch=extMenu.querySelector('input');
    const beforeSearch=calls.filter(v=>v==='search').length;
    extSearch.value='.PDF';extSearch.dispatchEvent(new Event('input',{bubbles:true}));
    assert([...extMenu.querySelectorAll('[role=option]')].filter(e=>!e.hidden).map(e=>e.textContent).join(',')==='PDF','extension lookup ignores case and a leading dot');
    assert(ext.value==='' && calls.filter(v=>v==='search').length===beforeSearch,'typing an extension does not change the file query before selection');
    extSearch.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    extSearch.value='DOCX';extSearch.dispatchEvent(new Event('input',{bubbles:true}));
    extSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
    assert(ext.value===''&&!extMenu.hidden,'IME confirmation does not select an extension');
    extSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert(!extMenu.hidden&&overlay.classList.contains('visible'),'IME Escape does not close the picker or tool');
    extSearch.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    extSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await until(()=>q('Results').querySelector('.fs-count').textContent.includes('80'));
    assert(ext.value==='docx'&&extMenu.hidden,'committed extension search selects with Enter');
    extButton.click();extSearch.value='no-such-suffix';extSearch.dispatchEvent(new Event('input',{bubbles:true}));
    assert(!extMenu.querySelector('.tool-custom-select-empty').hidden,'missing extension has a visible empty state');
    extSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert(extMenu.hidden&&overlay.classList.contains('visible')&&document.activeElement===extButton,'Escape closes only the picker and restores its trigger');
    ext.value = 'pdf'; ext.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => q('Results').querySelector('.fs-count').textContent.includes('80'));
    assert([...q('Results').querySelectorAll('.fs-file-name')].every(e => e.textContent.endsWith('.pdf')), 'extension filter applies live');
    const sort = q('Results').querySelector('.fs-sort'); sort.value = 'largest'; sort.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => q('Results').querySelector('.fs-file-name')?.textContent === '装修合同160.pdf');
    assert(true, 'sort orders results');
    calls = []; q('Query').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await delay(50);
    assert(!calls.includes('reveal'), 'Enter without selection does not open a file');
    q('Query').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); q('Query').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => calls.includes('reveal')); assert(true, 'explicit keyboard selection uses the same reveal action');
    failure = true; q('Results').querySelector('[data-fs-reveal]').click();
    await until(() => !q('Results').querySelector('.fs-message').hidden); failure = false;
    assert(overlay.classList.contains('visible'), 'failed reveal retains the page');
    controller.close(); await controller.open(); await until(() => callbacks.size === 1);
    assert(!overlay.inert, 'reopen restores interaction and one subscription');
    setLangWithoutFade('en'); await delay(50);
    assert(q('Title').textContent === 'Quick file search', 'English strings render');
    setLangWithoutFade('zh');
    const savedQuery=q('Query').value,savedExtension=ext.value,savedSort=sort.value;
    q('Float').checked=true;q('Float').dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>!q('CapsuleGuide').hidden&&!q('UseWindow').disabled);
    assert(q('Workbench').hidden&&q('Workbench').inert,'capsule mode hides and pauses the main search workspace');
    const whileCapsule=calls.filter(v=>v==='search').length;
    for(let i=0;i<8;i++){nativeIndex.generation++;callbacks.forEach(cb=>cb());await delay(40);}
    assert(calls.filter(v=>v==='search').length===whileCapsule,'capsule state and index ticks cannot query the hidden main workspace');
    windowState.expanded=false;windowState.hidden=true;callbacks.forEach(cb=>cb());await delay(50);
    assert(!q('CapsuleGuide').hidden,'collapsed or temporarily hidden capsule keeps its selected mode');
    setLangWithoutFade('en');await delay(30);assert(q('UseWindow').textContent.includes('Switch to window'),'guide supports English');setLangWithoutFade('zh');
    q('UseWindow').click();await until(()=>!q('Workbench').hidden&&!q('Float').checked&&q('Results').querySelector('[data-fs-reveal]:not(:disabled)'));
    assert(q('Query').value===savedQuery&&ext.value===savedExtension&&sort.value===savedSort,'switching back restores the main query and filters');
    q('Results').querySelector('[data-fs-row]').click();
    const beforeUnrelated=calls.filter(v=>v==='search').length;nativeIndex.generation++;callbacks.forEach(cb=>cb());
    await delay(1800);
    assert(q('Results').querySelector('.fs-refresh').hidden&&calls.filter(v=>v==='search').length===beforeUnrelated,'unrelated index changes neither refresh nor show an update badge');
    samples.at(-1).name='装修合同160-更新.pdf';nativeIndex.generation++;callbacks.forEach(cb=>cb());
    await until(() => !q('Results').querySelector('.fs-refresh').hidden);
    assert(true, 'index updates wait while a result is selected');
    q('Results').querySelector('.fs-refresh').click();
    await until(() => q('Results').querySelector('.fs-refresh').hidden && !!q('Results').querySelector('[data-fs-reveal]:not(:disabled)') && q('Results').querySelector('.fs-file-name')?.textContent==='装修合同160-更新.pdf');
    assert(true, 'explicit refresh applies current results');
    assert(q('Results').querySelector('.fs-file-name').textContent==='装修合同160-更新.pdf','same-count rename is detected and applied');
    nativeIndex.generation++;callbacks.forEach(cb=>cb());await delay(1800);
    assert(q('Results').querySelector('.fs-refresh').hidden,'acknowledged results do not immediately raise the same badge again');
    q('Stop').click(); await until(() => !q('Resume').hidden && !q('Resume').disabled);
    assert(!q('Workbench').hidden && q('Results').querySelectorAll('.fs-row').length > 0, 'pausing background indexing retains existing search results');
    q('Resume').click(); await until(() => !q('Stop').hidden && !q('Stop').disabled);
    q('Rebuild').click(); await until(() => !q('Rebuild').disabled);
    assert(calls.includes('automatic-rebuild') && q('Setup').hidden, 'rebuild keeps automatic mode without repeating authorization');
    nativeIndex.phase = 'partial'; callbacks.forEach(cb => cb());
    await until(() => q('IndexProgress').textContent.includes('部分'));
    assert(true, 'partial coverage never claims the whole index is ready');
    nativeIndex.phase = 'error'; callbacks.forEach(cb => cb());
    await until(() => q('IndexProgress').textContent.includes('检查'));
    assert(true, 'failed index has explicit recovery status');
    nativeIndex.phase = 'ready'; callbacks.forEach(cb => cb());
    for (let i = 0; i < 500; i++) {
      const filter = q('Results').querySelector('.fs-extension'); filter.value = i % 2 ? 'pdf' : 'docx'; filter.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => q('Results').querySelector('.fs-count').textContent.includes('80'));
      if (q('Results').querySelectorAll('.fs-row').length >= 30) throw Error('result DOM grew during stress');
    }
    assert(true, '500 filter changes keep bounded result DOM');
    for (let i = 0; i < 50; i++) { controller.close(); await controller.open(); }
    assert(callbacks.size === 1, '50 reopen cycles retain one native subscription');
    output.textContent = 'PASS\n' + checks.join('\n');
  } catch (error) { output.textContent = 'FAIL: ' + error.message; }
};
function docMenu(button) {return document.getElementById(button.getAttribute('aria-controls'));}
document.getElementById('qa-soak').onclick = async () => {
  const run=document.getElementById('qa-soak');run.disabled=true;document.getElementById('qa-run').disabled=true;
  const began=performance.now();let cycles=0,maxRows=0,maxMenus=0;
  try {
    automatic=true;nativeIndex.phase='ready';controller.close();await controller.open();
    while(performance.now()-began<900000){
      const iteration=performance.now();
      q('Query').value=cycles%2?'合同':'装修';q('Query').dispatchEvent(new Event('input',{bubbles:true}));
      const filter=q('Results').querySelector('.fs-extension');filter.value=cycles%3?'pdf':'';filter.dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>!q('Results').querySelector('.fs-count').textContent.includes('搜索中')&&q('Results').querySelector('[data-fs-reveal]:not(:disabled)'));
      const list=q('Results').querySelector('.fs-list');list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll'));
      await delay(35);const more=list.querySelector('[data-fs-more]');if(more&&!more.disabled){more.click();await delay(50);}
      maxRows=Math.max(maxRows,list.querySelectorAll('.fs-row').length);
      maxMenus=Math.max(maxMenus,document.querySelectorAll('.tool-custom-select-menu').length);
      if(maxRows>=30||maxMenus!==2||callbacks.size!==1)throw Error('DOM or listener ownership grew');
      controller.close();const closedCalls=calls.length;await delay(70);
      if(callbacks.size||calls.length!==closedCalls)throw Error('closed tool continued native work');
      await controller.open();calls=[];cycles++;
      if(cycles%10===0)output.textContent=JSON.stringify({state:'running',elapsedSeconds:Math.round((performance.now()-began)/1000),cycles,maxRows,maxMenus,subscriptions:callbacks.size});
      await delay(Math.max(0,500-(performance.now()-iteration)));
    }
    controller.close();output.textContent=JSON.stringify({state:'PASS',elapsedSeconds:Math.round((performance.now()-began)/1000),cycles,maxRows,maxMenus,subscriptions:callbacks.size});
  } catch(error){output.textContent=JSON.stringify({state:'FAIL',cycles,error:error.message});}
  finally{run.disabled=false;document.getElementById('qa-run').disabled=false;}
};
