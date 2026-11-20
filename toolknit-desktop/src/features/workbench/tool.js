import { getLang,onLangChange } from '../../i18n.js';
import { tauriCorePromise,tauriEventPromise,loadTauriDialog } from '../../platform/tauri-runtime.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { copy,applyCopy } from './copy.js';
import { bindActions } from './ui.js';
import { createContentSearch } from './search-controller.js';
import { createDocumentComparison } from './compare-controller.js';
import { createSubtitleWorkbench } from './subtitle-controller.js';
import { createFolderAutomation } from './folder-controller.js';
import '../productivity/productivity.css';
import './workbench.css';

export function initDocumentWorkbenchTool(context){
  const {overlay}=context,q=selector=>overlay.querySelector(selector),events=new AbortController();
  const tr=key=>copy(key,getLang()),local=(zh,en)=>getLang()==='zh'?zh:en;
  let tab='content-search';
  const message=(value='',error=false)=>{q('[data-wb-message]').textContent=String(value);q('[data-wb-message]').classList.toggle('productivity-error',error);};
  const common={...context,tr,local,message,signal:events.signal,
    invoke:context.invoke||((command,args)=>tauriCorePromise.then(api=>api.invoke(command,args))),
    listen:context.listen||((name,fn)=>tauriEventPromise.then(api=>api.listen(name,fn))),
    choose:context.choose||(options=>loadTauriDialog().then(api=>api.open(options)))};
  const entries=[['content-search',createContentSearch],['document-compare',createDocumentComparison],['subtitle-workbench',createSubtitleWorkbench],['folder-automation',createFolderAutomation]];
  const controllers=new Map(entries.map(([id,create])=>[id,create({...common,panel:q(`[data-wb-panel="${id}"]`)})]));
  const modal=createModalSession({root:overlay,background:overlay.ownerDocument.querySelector('.app'),initialFocus:q('[data-wb-tab]'),onClose:()=>close()});
  function show(id){
    if(!controllers.has(id))return;controllers.get(tab)?.close?.();tab=id;message();
    overlay.querySelectorAll('[data-wb-panel]').forEach(panel=>{panel.hidden=panel.dataset.wbPanel!==id;});
    overlay.querySelectorAll('[data-wb-tab]').forEach(button=>{if(button.dataset.wbTab===id)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    if(!context.isTauri&&id==='folder-automation')message(tr('desktopOnly'));
    void Promise.resolve().then(()=>controllers.get(id).open?.()).catch(error=>message(error.message||error,true));
  }
  function close(){controllers.get(tab)?.close?.();modal.close();return true;}
  overlay.addEventListener('click',event=>{const button=event.target.closest('[data-wb-tab]');if(button)show(button.dataset.wbTab);},{signal:events.signal});
  const handlers=Object.assign({},...Array.from(controllers.values(),controller=>controller.actions));bindActions(overlay,handlers,message,events.signal);
  applyCopy(overlay,getLang());context.refreshIcons?.();
  const unsubscribe=onLangChange(()=>{applyCopy(overlay,getLang());for(const controller of controllers.values())controller.language?.();});
  return {open(id){applyCopy(overlay,getLang());modal.open();show(id);q(`[data-wb-tab="${tab}"]`).focus({preventScroll:true});},close,dispose(){unsubscribe();events.abort();modal.dispose();}};
}
