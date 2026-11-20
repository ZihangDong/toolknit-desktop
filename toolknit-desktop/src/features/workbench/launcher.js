import { getLang,onLangChange } from '../../i18n.js';
import { tauriCorePromise,tauriEventPromise } from '../../platform/tauri-runtime.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { copy,applyCopy } from './copy.js';
import { element } from './ui.js';
import { rankLauncherTools,toolsForFilename } from './launcher-core.js';
import './workbench.css';
let singleton;
export function createQuickLauncher({ isTauri=false,openTool,getActivePage,notify=()=>{} }={}){
  if(singleton)return singleton;
  const root=element('div',undefined,'quick-launcher-overlay');root.id='quickLauncherOverlay';root.inert=true;root.setAttribute('aria-hidden','true');
  root.innerHTML=`<section class="quick-launcher" role="dialog" aria-modal="true" aria-labelledby="quickLauncherTitle"><h1 id="quickLauncherTitle" data-wb-copy="launcher"></h1><input data-launcher-query data-wb-placeholder="launcherPlaceholder" aria-label="Search tools" autocomplete="off" spellcheck="false"><p data-wb-copy="launcherHint"></p><p data-launcher-kind></p><div class="quick-launcher-results" data-launcher-results></div><p data-wb-copy="pasteHint"></p><details><summary data-wb-copy="shortcut"></summary><p data-wb-copy="shortcutHint"></p><div class="wb-toolbar"><input data-launcher-shortcut aria-label="Global shortcut" value="Ctrl+Shift+Space"><button type="button" data-launcher-save data-wb-copy="saveShortcut"></button><button type="button" data-launcher-disable data-wb-copy="disableShortcut"></button></div><p data-launcher-status role="status"></p></details></section>`;
  document.body.append(root);
  const q=selector=>root.querySelector(selector),tr=key=>copy(key,getLang()),events=new AbortController();
  const invoke=(command,args)=>tauriCorePromise.then(api=>api.invoke(command,args));
  let modal,results=[],selected=0,recent=[],unlisten;
  try{const saved=JSON.parse(localStorage.getItem('toolknit.launcher-recent.v1')||'[]');if(Array.isArray(saved))recent=saved.filter(id=>typeof id==='string').slice(0,8);}catch{}
  function catalog(){return [...document.querySelectorAll('.content-section:not([data-category="home"]) .audio-list-item[data-tool]')].filter(node=>node.dataset.availability!=='planned').map(node=>({id:node.dataset.tool,name:node.querySelector('.audio-list-title')?.textContent.trim()||node.dataset.tool,description:node.querySelector('.audio-list-desc')?.textContent.trim()||''}));}
  function render(){
    const query=q('[data-launcher-query]').value;results=rankLauncherTools(catalog(),query,recent);selected=Math.min(Math.max(0,selected),Math.max(0,results.length-1));
    q('[data-launcher-kind]').textContent=tr(toolsForFilename(query).length?'suggestions':query.trim()?'allTools':'recent');
    const list=q('[data-launcher-results]');list.replaceChildren();
    if(!results.length)list.append(element('p',tr('noMatches')));
    results.forEach((tool,index)=>{
      const button=element('button');button.type='button';button.dataset.launcherTool=tool.id;button.setAttribute('aria-selected',String(index===selected));button.append(element('strong',tool.name),element('small',tool.description));button.addEventListener('click',()=>void launch(index));list.append(button);
    });
  }
  async function launch(index){
    const tool=results[index];if(!tool)return;close();
    recent=[tool.id,...recent.filter(id=>id!==tool.id)].slice(0,8);try{localStorage.setItem('toolknit.launcher-recent.v1',JSON.stringify(recent));}catch{}
    try{if(openTool)await openTool(tool.id);else document.querySelector(`.audio-list-item[data-tool="${tool.id}"]`)?.click();}catch(error){notify(error.message||error);}
  }
  function open(){
    if(root.classList.contains('visible')){q('[data-launcher-query]').focus();if(isTauri)void invoke('launcher_settings',{request:{action:'ack'}}).catch(()=>{});return;}
    applyCopy(root,getLang());selected=0;q('[data-launcher-query]').value='';render();
    modal=createModalSession({root,background:getActivePage?.()||document.querySelector('.app'),initialFocus:q('[data-launcher-query]'),onClose:close});modal.open();
    if(isTauri)void invoke('launcher_settings',{request:{action:'ack'}}).catch(()=>{});
  }
  function close(){modal?.close();modal=null;}
  q('[data-launcher-query]').addEventListener('input',()=>{selected=0;render();},{signal:events.signal});
  q('[data-launcher-query]').addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+Math.max(1,results.length))%Math.max(1,results.length);render();q(`[data-launcher-tool="${results[selected]?.id}"]`)?.scrollIntoView({block:'nearest'});}
    else if(event.key==='Enter'){event.preventDefault();void launch(selected);}
  },{signal:events.signal});
  root.addEventListener('click',event=>{if(event.target===root)close();},{signal:events.signal});
  root.addEventListener('dragover',event=>event.preventDefault(),{signal:events.signal});root.addEventListener('drop',event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file){q('[data-launcher-query]').value=file.name;selected=0;render();}},{signal:events.signal});
  q('[data-launcher-query]').addEventListener('paste',event=>{const file=event.clipboardData?.files?.[0];if(file){event.preventDefault();q('[data-launcher-query]').value=file.name;selected=0;render();}},{signal:events.signal});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey){event.preventDefault();open();}},{signal:events.signal});
  async function configure(shortcut){try{const status=await invoke('launcher_settings',{request:{action:'save',shortcut}});q('[data-launcher-shortcut]').value=status.shortcut||'';q('[data-launcher-status]').textContent=status.error||(getLang()==='zh'?'快捷键设置已保存。':'Shortcut saved.');}catch(error){q('[data-launcher-status]').textContent=error.message||error;}}
  q('[data-launcher-save]').addEventListener('click',()=>void configure(q('[data-launcher-shortcut]').value),{signal:events.signal});q('[data-launcher-disable]').addEventListener('click',()=>void configure(null),{signal:events.signal});
  if(isTauri){void tauriEventPromise.then(api=>api.listen('toolknit-launcher-open',open)).then(fn=>{unlisten=fn;return invoke('launcher_settings',{request:{action:'status'}});}).then(status=>{q('[data-launcher-shortcut]').value=status.shortcut||'';q('[data-launcher-status]').textContent=status.error||'';if(status.pending)open();}).catch(error=>{q('[data-launcher-status]').textContent=error.message||error;});}
  else{q('[data-launcher-save]').disabled=true;q('[data-launcher-disable]').disabled=true;q('[data-launcher-shortcut]').disabled=true;}
  const unsubscribe=onLangChange(()=>{applyCopy(root,getLang());if(root.classList.contains('visible'))render();});applyCopy(root,getLang());
  singleton={open,close,dispose(){close();events.abort();unlisten?.();unsubscribe();root.remove();singleton=null;}};
  window.addEventListener('pagehide',()=>singleton?.dispose(),{once:true});return singleton;
}
export function initQuickLauncherTool(context){const launcher=singleton||createQuickLauncher({...context,openTool:context.openLazyTool});return{open:launcher.open,close:()=>{launcher.close();return true;},dispose:()=>{}};}
