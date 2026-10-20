import { createLifecycleScope } from '../app/tool-lifecycle.js';

export function createContextMenu({root,onSelect,onDismiss,refreshIcons=()=>{}}){
  const scope=createLifecycleScope();
  let disposed=false,busy=false,revision=0;
  const buttons=()=>[...root.querySelectorAll('button:not(:disabled)')];
  function render(items){
    if(disposed)return;
    revision++;root.replaceChildren();busy=false;
    for(const item of items){
      if(item.separator){const line=document.createElement('div');line.className='tk-context-separator';line.setAttribute('role','separator');root.append(line);continue;}
      const button=document.createElement('button');button.type='button';button.className='tk-context-item';button.dataset.menuAction=item.action;button.tabIndex=-1;
      button.setAttribute('role',typeof item.checked==='boolean'?'menuitemcheckbox':'menuitem');
      if(typeof item.checked==='boolean')button.setAttribute('aria-checked',String(item.checked));
      if(item.danger)button.classList.add('is-danger');
      const icon=document.createElement('i');icon.dataset.lucide=item.icon;icon.setAttribute('aria-hidden','true');
      const label=document.createElement('span');label.textContent=item.label;button.append(icon,label);
      if(item.checked){const check=document.createElement('i');check.dataset.lucide='check';check.className='tk-context-check';button.append(check);}
      root.append(button);
    }
    refreshIcons();
    buttons()[0]?.focus({preventScroll:true});
  }
  async function choose(action){
    if(busy||disposed)return;busy=true;const owner=revision;
    for(const button of buttons())button.disabled=true;
    try{await onSelect(action);}finally{if(!disposed&&owner===revision){busy=false;for(const button of root.querySelectorAll('button'))button.disabled=false;}}
  }
  scope.event(root,'click',event=>{const button=event.target.closest('[data-menu-action]');if(button)void choose(button.dataset.menuAction);});
  scope.event(root,'keydown',event=>{
    const list=buttons(),index=list.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length;list[next]?.focus();
    }
    if(event.key==='Escape'){event.preventDefault();onDismiss(true);}
    if(event.key==='Tab'){event.preventDefault();onDismiss(true);}
  });
  return {render,dispose(){disposed=true;scope.dispose();root.replaceChildren();}};
}
