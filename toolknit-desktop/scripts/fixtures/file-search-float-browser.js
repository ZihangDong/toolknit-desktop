import '../../src/features/file-search/floating.css';
import '../../src/styles/components/input-focus.css';
import {createResults,resultsMarkup} from '../../src/features/file-search/results.js';
import {t} from '../../src/i18n.js';
import {createIcons,icons} from 'lucide';
import {checkSearchScroll} from './file-search-scroll-check.js';
const root=document.getElementById('fileSearchRoot');root.innerHTML=`<section class="fs-card" data-visible="true">${resultsMarkup()}</section>`;
const rows=Array.from({length:50},(_,i)=>({id:String(i),name:`合同${i+1}.pdf`,parent:'C:\\QA\\样本',extension:'pdf',size:1024,modified:1793664000}));
const results=createResults({root:root.firstElementChild,tr:(key,vars)=>t(`fileSearch.${key}`,vars),refreshIcons:()=>createIcons({icons}),runtime:{call:async(action,payload)=>{
  if(action==='query-invalidate'||action==='reveal')return null;
  if(action==='search'){
    const matches=(payload.query.text||payload.query.extension)&&(!payload.query.extension||payload.query.extension==='pdf')?rows:[];
    return {result:{rows:matches,total:matches.length,extensions:['pdf','docx','png','unusually-long-extension-for-geometry-check']},index:{phase:'ready',generation:1},ticket:'fixture',generation:1};
  }
  throw Error(action);
}}});
results.session.set({text:new URLSearchParams(location.search).has('empty')?'':'合同'});results.session.start();
window.addEventListener('pagehide',()=>results.dispose(),{once:true});
if(new URLSearchParams(location.search).has('scrollTest')) {
  const report=document.createElement('pre');report.id='qa-scroll-report';
  report.style.cssText='position:fixed;bottom:0;right:0;font-size:11px;max-width:65vw;max-height:150px;overflow:auto;background:#fff;color:#000;pointer-events:none;z-index:10';
  report.textContent='Running';document.body.append(report);
  setTimeout(async()=>{
    try { report.textContent='PASS\n'+(await checkSearchScroll(root.querySelector('.fs-list'))).join('\n'); }
    catch(error){ report.textContent='FAIL: '+error.message; }
  },200);
}
