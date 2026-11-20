import { element,action,basename } from './ui.js';
export function createFolderAutomation({panel,isTauri,invoke,listen,choose,tr,local,message,signal}){
  const q=selector=>panel.querySelector(selector),form=q('[data-folder-form]'),field=name=>form.elements.namedItem(name);
  let rules=[],editing=null,unlisten;
  function reset(){editing=null;form.reset();field('format').value='PNG';field('quality').value='medium';}
  const call=request=>invoke('folder_automation',{request});
  async function apply(request){const state=await call(request);if(signal.aborted)return;rules=state.rules;render(state);}
  function render(state){
    const list=q('[data-folder-rules]'),history=q('[data-folder-history]');list.replaceChildren();history.replaceChildren();
    if(!rules.length)list.append(element('p',tr('folderEmpty'),'productivity-empty'));
    for(const rule of rules){
      const row=element('article',undefined,'wb-rule');row.dataset.enabled=String(rule.enabled);
      row.append(element('h3',rule.name),element('small',`${rule.input}\n→ ${rule.output}`),element('span',`${tr(rule.enabled?'enabled':'paused')} · ${tr(rule.action==='image-convert'?'imageConvert':rule.action==='image-compress'?'imageCompress':'archiveCopy')}`));
      if(state.statuses?.[rule.id])row.append(element('small',state.statuses[rule.id],'productivity-error'));
      const controls=element('div',undefined,'wb-actions');controls.append(action(tr('edit'),()=>{editing=rule.id;for(const key of ['name','input','output','action','format','quality'])field(key).value=rule[key];field('enabled').checked=rule.enabled;form.scrollIntoView({block:'start',behavior:'smooth'});}),
        action(tr(rule.enabled?'pause':'resume'),()=>apply({action:'save',rule:{...rule,enabled:!rule.enabled}}).catch(error=>message(error.message||error,true))),
        action(tr('delete'),()=>apply({action:'delete',id:rule.id}).catch(error=>message(error.message||error,true))));row.append(controls);list.append(row);
    }
    if(!state.history?.length)history.append(element('p',tr('noHistory'),'productivity-muted'));
    for(const item of state.history||[]){
      const row=element('article',undefined,'wb-history-row');row.append(element('strong',`${item.state==='succeeded'?'✓':'!'} ${basename(item.path)}`),element('small',new Date(item.created).toLocaleString()),element('small',item.message||item.output));
      if(item.output)row.append(action(tr('openLocation'),()=>invoke('open_path',{path:item.output}).catch(error=>message(error.message||error,true))));
      if(item.state==='failed')row.append(action(tr('retry'),()=>apply({action:'retry',id:item.id}).catch(error=>message(error.message||error,true))));history.append(row);
    }
  }
  async function refresh(){if(isTauri)await apply({action:'list'});}
  if(!isTauri){for(const control of form.elements)control.disabled=true;message(tr('desktopOnly'));render({rules:[],history:[]});}
  else void listen('toolknit-folder-state',()=>{void refresh().catch(error=>message(error.message||error,true));}).then(fn=>{if(signal.aborted)fn();else unlisten=fn;}).catch(error=>message(error.message||error,true));
  form.addEventListener('submit',event=>event.preventDefault(),{signal});
  signal.addEventListener('abort',()=>unlisten?.(),{once:true});
  return {actions:{'refresh-folders':refresh,'reset-rule':reset,'choose-input':async()=>{const value=await choose({directory:true,multiple:false});if(value)field('input').value=value;},'choose-output':async()=>{const value=await choose({directory:true,multiple:false});if(value)field('output').value=value;},
    'save-rule':async()=>{if(!isTauri)return;const rule={id:editing||crypto.randomUUID(),enabled:field('enabled').checked};for(const key of ['name','input','output','action','format','quality'])rule[key]=field(key).value;rule.name=rule.name.trim();await apply({action:'save',rule});reset();message(local('规则已保存。启用时已有文件会跳过。','Rule saved. Existing files are skipped when enabling.'));}
  },open:refresh,language:()=>{void refresh().catch(()=>{});}};
}
