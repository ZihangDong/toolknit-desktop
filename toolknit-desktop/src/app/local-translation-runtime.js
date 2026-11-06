import { createLocalTranslationRuntime } from '../platform/local-translation-runtime.js';
import { createLifecycleScope } from './tool-lifecycle.js';
import { createModalSession } from './modal-runtime.js';
import { formatDependencyBytes } from './dependency-helpers.js';
import '../styles/components/local-translation.css';

export function createLocalTranslationSettings({root=document,isTauri=false,translate=key=>key,onLanguageChange,notify=()=>{}}={}) {
  const q=id=>root.getElementById(`localTranslation${id}`);
  if (!q('Overlay')) return {dispose(){}};
  const scope=createLifecycleScope(),runtime=createLocalTranslationRuntime({isTauri});
  const tr=(key,vars)=>translate(`settings.localTranslation.${key}`,vars);
  let state={ready:false,installing:false,progress:{}},pending=false,error='',source='auto';
  let revision=0;
  const modal=createModalSession({root:q('Overlay'),background:root.getElementById('settingsOverlay'),initialFocus:q('Install'),onClose:close});
  function render() {
    if(scope.disposed)return;
    const busy=pending||state.installing;
    q('Summary').textContent=tr(state.ready?'ready':state.installing?'installing':'missing');
    q('Status').textContent=error?tr(error):tr(state.installing?({download:'downloading',verify:'verifying',testing:'testing'}[state.progress?.phase]||'installing'):state.ready?'ready':'missing');
    const sourceKey={official:'sourceOfficial',accelerated:'sourceAccelerated',mozilla:'sourceMozilla','7caiyun':'source7caiyun'}[state.progress?.source];
    if(!error&&state.installing&&state.progress?.phase==='download'&&sourceKey)q('Status').textContent=tr('downloadingFrom',{source:tr(sourceKey)});
    q('SourceHint').textContent=tr('sourceHint');
    for(const button of q('SourceOptions').querySelectorAll('[data-source]')){
      button.disabled=busy;button.classList.toggle('active',button.dataset.source===source);button.setAttribute('aria-pressed',String(button.dataset.source===source));
      button.textContent=button.dataset.source==='accelerated'?tr('sourceAccelerated'):translate(`home.transcription.source${button.dataset.source==='auto'?'Auto':'Official'}`);
    }
    q('Install').disabled=!isTauri||busy;q('Install').textContent=tr(state.ready?'repair':'install');
    q('Remove').hidden=!state.ready;q('Remove').disabled=busy;
    q('Cancel').hidden=!state.installing;
    q('Progress').hidden=!state.installing;
    const progress=state.progress||{};
    q('Progress').value=Math.min(Number(progress.received)||0,Number(progress.total)||1);q('Progress').max=Number(progress.total)||1;
    q('Bytes').hidden=!state.installing;q('Bytes').textContent=`${formatDependencyBytes(progress.received)} / ${formatDependencyBytes(progress.total)}`;
    const focused=root.activeElement;
    if(q('Overlay').contains(focused)&&(focused.hidden||focused.disabled))q('Close').focus({preventScroll:true});
  }
  async function refresh(){
    if(!isTauri||pending||state.installing||scope.disposed)return;
    const current=++revision;
    try{const value=await runtime.call('status');if(!scope.disposed&&current===revision){state=value;render();}}catch{if(!scope.disposed&&current===revision){error='error';render();}}
  }
  function close(){modal.close();}
  scope.event(q('Manage'),'click',()=>{error='';modal.open();render();void refresh();});scope.event(q('Close'),'click',close);
  scope.event(q('Cancel'),'click',()=>{void runtime.call('cancel-install').catch(()=>notify(tr('error')));});
  scope.event(q('SourceOptions'),'click',event=>{
    const button=event.target.closest('[data-source]');
    if(!button||!q('SourceOptions').contains(button)||pending||state.installing)return;
    source=button.dataset.source;render();
  });
  async function change(action){
    if(pending||state.installing)return;revision++;pending=true;error='';render();
    try{const value=await runtime.call(action,action==='install'?{source}:{});if(!scope.disposed){state=value;notify(tr(action==='install'?'installed':'removed'));}}
    catch(e){if(!scope.disposed){error=String(e).includes('cancelled')?'cancelled':String(e).includes('checksum')?'checksumError':String(e).includes('translation:download')?'downloadError':'error';notify(tr(error));}}
    finally{pending=false;if(!scope.disposed){state.installing=false;render();void refresh();}}
  }
  scope.event(q('Install'),'click',()=>void change('install'));scope.event(q('Remove'),'click',()=>void change('remove'));
  for(const [name,handler] of [
    ['local-translation-progress',progress=>{state={...state,installing:true,progress};render();}],
    ['local-translation-changed',value=>{state=value;render();}]
  ]) void runtime.listen(name,value=>{if(!scope.disposed){revision++;handler(value);}}).then(unlisten=>scope.use(unlisten)).catch(()=>{});
  if(onLanguageChange)scope.use(onLanguageChange(render));scope.use(()=>modal.dispose());
  if(root.defaultView){scope.event(root.defaultView,'focus',()=>void refresh());scope.event(root.defaultView,'pagehide',()=>{if(state.installing)void runtime.call('cancel-install').catch(()=>{});scope.dispose();},{once:true});}
  render();void refresh();return {refresh,dispose:scope.dispose};
}
