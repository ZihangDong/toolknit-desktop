import { createContextMenu } from '../../shared/context-menu.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';

export async function createController({runtime,tr,q,refresh},data){
  const scope=createLifecycleScope();let disposed=false,token=null;
  q('MenuError').hidden=true;
  // Warm the existing menu font while the native window is still hidden.
  if(document.fonts?.load)void document.fonts.load(`13px ${getComputedStyle(q('Menu')).fontFamily}`,tr('historyMenu')).catch(()=>{});
  const dismiss=async focusParent=>{if(!data.menu)return;try{await runtime.call('menu-dismiss',{token,focusParent});}catch{/* a later menu owns the window */}};
  const items=()=>data.menu.entryId?[
    {action:'view',icon:data.menu.kind==='image'?'pin':'eye',label:tr(data.menu.kind==='image'?'pinViewer':'historyView')},
    {action:'copy',icon:'copy',label:tr('historyCopy')},
    {action:data.menu.kind==='phrase'?'phrase-edit':'note',icon:data.menu.kind==='phrase'?'pencil':'sticky-note',label:tr(data.menu.kind==='phrase'?'phraseEdit':'historyNote')},
    ...(data.menu.kind==='text'?[{action:'phrase-add',icon:'notebook-pen',label:tr('phraseAdd')}]:[]),
    {separator:true},{action:'delete',icon:'trash-2',label:tr(data.menu.kind==='phrase'?'phraseDelete':'historyDelete'),danger:true}]:[
    {action:'toggle',icon:data.menu.expanded?'minimize-2':'maximize-2',label:tr(data.menu.expanded?'collapseHistory':'expandHistory')},
    {action:'main',icon:'app-window',label:tr('openMain')},
    {action:'open',icon:'clipboard-list',label:tr('openHistory')},
    {action:'monitor',icon:data.menu.recording?'pause':'play',checked:data.menu.recording,label:tr(data.menu.recording?'historyRecording':'historyPaused')},
    {separator:true},{action:'hide',icon:'eye-off',label:tr('historyHideUntilRestart')},
    {action:'close',icon:'x',label:tr('historyTurnOff')}
  ];
  const menu=createContextMenu({root:q('Menu'),refreshIcons:refresh,onDismiss:focus=>void dismiss(focus),onSelect:async selected=>{
    const owner=token;
    try{await runtime.call('menu-select',{token:owner,selected});}catch(error){if(!disposed&&token===owner&&!String(error).includes('expired')){q('MenuError').hidden=false;q('MenuError').textContent=tr('failed');}}
  }});
  scope.event(document,'pointerdown',event=>{if(!q('Menu').contains(event.target))void dismiss(false);});
  scope.event(document,'contextmenu',event=>event.preventDefault());
  async function update(next){
    if(disposed)return;
    data=next;q('MenuError').hidden=true;q('Menu').hidden=!data.menu;
    if(!data.menu){token=null;menu.render([]);return;}
    if(token===data.menu.token)return;
    token=data.menu.token;menu.render(items());
    try{await runtime.call('menu-ready',{token});}catch(error){if(!String(error).includes('expired'))throw error;}
  }
  try{await update(data);}catch(error){disposed=true;scope.dispose();menu.dispose();throw error;}
  return {update,contextChanged(){if(!disposed&&data.menu)menu.render(items());},dispose(){disposed=true;scope.dispose();menu.dispose();}};
}
