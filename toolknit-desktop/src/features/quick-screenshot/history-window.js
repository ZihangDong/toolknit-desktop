import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createClipboardRuntime } from '../../platform/clipboard-runtime.js';
import { t } from '../../i18n.js';
import { clipboardErrorKey, historyTimeLabel } from '../../shared/clipboard-history-format.js';
import { createHistoryEditor } from './history-editor.js';
import { createHistoryMotion } from './history-motion.js';
import { createHistoryDrag } from './history-drag.js';

export async function createController({runtime,tr,q,refresh,getCurrentWindow,isTauri,clipboardRuntime,showDialog,closeDialog,createPageTransition,feedback},data){
  const scope=createLifecycleScope(),root=q('History'),panel=q('HistoryPanel'),bubble=q('HistoryBubble');
  const clipboard=clipboardRuntime||createClipboardRuntime({isTauri});
  let disposed=false,revision=0,detailRevision=0,state='collapsed',animation,drag,suppressClick=false;
  let kind='',entries=[],enabled=false,detail=null,busy=false,timer,progressFrame=0;
  let errorCode='',errorSource='';
  let mode='history',switching=false,modeRevision=0,loading=false,next=null,searchTimer,composing=false;
  const views={history:{search:'',loadedSearch:'',draft:'',scroll:0,entries:[]},phrases:{search:'',loadedSearch:'',draft:'',scroll:0,entries:[]}};
  const recentLimit=20;
  const cards=new Map(),reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion=createHistoryMotion({q,tr,scope,reduced,createPageTransition});
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const errorText=error=>String(error).includes('clipboard:drag-capacity')?tr('dragCapacity'):String(error).includes('clipboard:drag-')?tr('dragFailed'):String(error).includes('clipboard:order-changed')?tr('historyOrderChanged'):String(error?.message||error)==='screenshot:window-hide-failed'?tr('windowHideFailed'):String(error?.message||error).includes('clipboard:')?t(`home.clipboardHistory.${clipboardErrorKey(error)}`):tr(String(error).includes('viewer-limit')?'viewerLimit':'failed');
  const editor=createHistoryEditor({clipboard,tr,q,showDialog,closeDialog,errorText,onSaved:()=>void update()});
  const dragging=createHistoryDrag({list:q('HistoryList'),scope,allowed:()=>state==='expanded'&&!busy&&!switching&&!detail&&!q('Dialog').classList.contains('visible'),collection:()=>mode==='phrases'?'phrases':'history',request:request=>clipboard.request(request),onStart:()=>{revision++;loading=false;},onChanged:()=>update(),onError:showError});
  function setState(value){state=value;root.dataset.state=value;}
  function progress(){
    if(progressFrame||disposed)return;
    progressFrame=requestAnimationFrame(()=>{
      progressFrame=0;const list=q('HistoryList'),range=list.scrollHeight-list.clientHeight,bar=q('HistoryScroll');
      const ratio=range>1?Math.max(0,Math.min(1,list.scrollTop/range)):0;
      bar.style.visibility=range>1?'visible':'hidden';bar.setAttribute('aria-hidden',String(range<=1));
      bar.setAttribute('aria-valuenow',String(Math.round(ratio*100)));bar.firstElementChild.style.transform=`scaleX(${ratio})`;
    });
  }
  function recording(){
    q('HistoryRecordingLabel').textContent=tr(enabled?'historyRecording':'historyPaused');
    q('HistoryRecording').setAttribute('aria-checked',String(enabled));q('HistoryRecording').disabled=busy;
  }
  function origin(point={x:48,y:48}){root.style.setProperty('--shot-origin-x',`${point.x}px`);root.style.setProperty('--shot-origin-y',`${point.y}px`);}
  function showError(error,source='action'){
    if(disposed||String(error?.message||error)==='screenshot:expired')return;
    errorCode=String(error?.message||error);
    errorSource=source;
    q('HistoryMessage').textContent=errorText(error);
    q('HistoryStatus').hidden=false;bubble.dataset.error='true';
    bubble.title=errorText(error);
  }
  function clearError(){
    errorCode='';errorSource='';q('HistoryStatus').hidden=true;delete bubble.dataset.error;bubble.title=tr('recent');
  }
  function clearWindowError(){
    if(!errorCode.startsWith('screenshot:'))return;
    clearError();
  }
  async function animate(open){
    if(reduced())return;
    const x=parseFloat(root.style.getPropertyValue('--shot-origin-x'))-16,y=parseFloat(root.style.getPropertyValue('--shot-origin-y'))-16;
    const radius=Math.ceil(Math.hypot(Math.max(x,panel.clientWidth-x),Math.max(y,panel.clientHeight-y)));
    const clip=r=>`circle(${r}px at calc(var(--shot-origin-x) - 16px) calc(var(--shot-origin-y) - 16px))`;
    const frames=[{clipPath:clip(32),transform:'scale(.96)',opacity:.35},{clipPath:clip(radius),transform:'scale(1)',opacity:1}];
    animation=panel.animate(open?frames:frames.reverse(),{duration:open?380:260,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});
    try{await animation.finished;}catch{/* disposal cancels the reveal */}
  }
  async function expand(){
    if(disposed||state!=='collapsed')return;setState('opening');bubble.disabled=true;
    try{
      const layout=await runtime.call('expand',{expanded:true,reducedMotion:reduced()});if(disposed)return;
      origin(layout.origin);panel.inert=false;panel.setAttribute('aria-hidden','false');bubble.setAttribute('aria-expanded','true');
      root.classList.add('shot-history-ready');await animate(true);if(disposed)return;
      animation?.cancel();setState('expanded');progress();panel.querySelector('[data-shot-action="collapse-history"]').focus({preventScroll:true});
    }catch(error){root.classList.remove('shot-history-ready');panel.inert=true;panel.setAttribute('aria-hidden','true');bubble.setAttribute('aria-expanded','false');setState('collapsed');showError(error);}
    finally{if(!disposed)bubble.disabled=false;}
  }
  async function collapse(){
    if(disposed||state!=='expanded')return;modeRevision++;motion.cancel();editor.dispose();closeDialog();setState('closing');if(panel.contains(document.activeElement))document.activeElement.blur();panel.inert=true;
    await animate(false);if(disposed)return;
    try{
      await runtime.call('expand',{expanded:false,reducedMotion:reduced()});if(disposed)return;
      root.classList.remove('shot-history-ready');animation?.cancel();panel.setAttribute('aria-hidden','true');origin();setState('collapsed');bubble.setAttribute('aria-expanded','false');bubble.focus({preventScroll:true});
    }catch(error){animation?.cancel();panel.inert=false;setState('expanded');showError(error);}
  }
  function card(entry){
    const key=`${mode}:${entry.id}`,cached=cards.get(key);if(cached)return cached;
    const row=node('article','shot-history-item');row.dataset.entryId=entry.id;
    const open=node('button','shot-history-open');open.type='button';
    const grip=node('button','shot-history-grip');grip.type='button';grip.dataset.historyReorder='';grip.setAttribute('aria-label',tr('historyReorder'));grip.title=tr('historyReorder');
    const icon=node('i');icon.dataset.lucide='grip-vertical';grip.append(icon);
    row.dataset.kind=mode==='phrases'?'phrase':entry.kind;
    const label=node('span','shot-history-kind'),content=node('span','shot-history-content'),note=node('span','shot-history-note'),time=node('time','shot-history-info'),source=node('span','shot-history-source');
    if(entry.kind==='image'&&entry.thumbnail?.startsWith('data:image/png;base64,')){
      content.classList.add('is-image');
      const image=node('img');image.src=entry.thumbnail;image.alt='';image.draggable=false;image.loading='lazy';content.append(image);
    }else content.append(node('span','shot-history-preview',mode==='phrases'?entry.text:entry.preview));
    open.append(label,content,note,time,source);row.append(open,grip);cards.set(key,row);return row;
  }
  function render(){
    const list=q('HistoryList'),scroll=list.scrollTop;
    const nodes=entries.filter(entry=>mode==='phrases'||!kind||entry.kind===kind).map(entry=>{
      const row=card(entry);row.querySelector('.shot-history-kind').textContent=mode==='phrases'?entry.title:tr({image:'historyImages',text:'historyText',files:'historyFiles'}[entry.kind]);
      const text=row.querySelector('.shot-history-preview');if(text)text.textContent=mode==='phrases'?entry.text:entry.preview;
      const note=row.querySelector('.shot-history-note');const hasNote=mode==='history'&&Boolean(entry.note);note.textContent=hasNote?entry.note:'';note.hidden=!hasNote;row.classList.toggle('has-note',hasNote);
      const timestamp=mode==='phrases'?entry.updatedAt:entry.capturedAt;
      const time=row.querySelector('time');time.dateTime=new Date(timestamp).toISOString();time.textContent=historyTimeLabel(timestamp,data.context?.lang,true,mode==='phrases'?null:entry.offsetMinutes);
      row.querySelector('.shot-history-source').textContent=mode==='phrases'?tr('phraseStored'):entry.source||tr('historyUnknown');
      if(mode==='phrases')row.title=tr('copyText');
      row.querySelector('.shot-history-open').setAttribute('aria-label',`${row.querySelector('.shot-history-kind').textContent} ${time.textContent}`);
      row.querySelector('.shot-history-grip').title=tr('historyReorder');row.querySelector('.shot-history-grip').setAttribute('aria-label',tr('historyReorder'));return row;
    });
    nodes.forEach((row,index)=>{if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);});
    const activeNodes=new Set(nodes);for(const child of [...list.children])if(!activeNodes.has(child))child.remove();
    const retained=new Set(entries.map(entry=>`${mode}:${entry.id}`));for(const id of cards.keys())if(!retained.has(id))cards.delete(id);
    list.scrollTop=scroll;q('HistoryEmpty').hidden=nodes.length>0;
    if(mode==='history'){q('HistoryCount').textContent=String(entries.length);q('HistoryCount').hidden=!entries.length;}
    root.dataset.mode=mode;q('HistoryFilters').hidden=mode==='phrases';q('PhraseCreate').hidden=mode!=='phrases';
    motion.syncTitle(mode);motion.selectFilter(kind);
    q('HistorySearchClear').hidden=!q('HistorySearch').value;
    q('HistoryEmpty').textContent=tr(views[mode].search?'historyNoMatches':mode==='phrases'?'phraseEmpty':'noHistory');
    q('HistorySearch').placeholder=tr(mode==='phrases'?'phraseSearchPlaceholder':'historySearchPlaceholder');
    recording();refresh();progress();
  }
  async function update(append=false,filterDirection=0){
    if(busy||disposed||dragging.active||composing||q('HistorySearch').value.trim()!==views[mode].search||(append&&(loading||!next||mode!=='phrases')))return;
    const owner=++revision;
    loading=true;
    try{
      const status=await clipboard.request({action:'status'});if(disposed||owner!==revision)return;
      const search=views[mode].search;
      const page=await clipboard.request(mode==='phrases'?{action:'phraseList',query:{search,...(append?{before:next}:{})}}:{action:'list',query:{ordered:true,limit:recentLimit,search,...(search?{kind}:{})}});if(disposed||owner!==revision||dragging.active)return;
      if(mode==='phrases'&&!append){
        const keep=Math.max(50,entries.length);
        while(page.next&&page.items.length<keep){
          const extra=await clipboard.request({action:'phraseList',query:{search,before:page.next}});if(disposed||owner!==revision)return;
          page.items.push(...extra.items);page.next=extra.next;
        }
      }
      enabled=status.enabled;entries=append?[...entries,...page.items]:mode==='phrases'?page.items:page.items.slice(0,recentLimit);next=page.next;views[mode].entries=entries;
      views[mode].loadedSearch=search;
      if(!errorCode||errorSource==='read')clearError();
      render();if(filterDirection)motion.revealList(filterDirection);
    }catch(error){if(!disposed&&owner===revision){if(append&&String(error).includes('order-changed')){next=null;void update();}else if(!String(error).includes('cancelled'))showError(error,'read');}}
    finally{if(owner===revision)loading=false;}
  }
  async function switchMode(){
    if(switching||busy||dragging.active)return;switching=true;q('HistoryMode').disabled=true;revision++;const token=++modeRevision;
    clearTimeout(searchTimer);composing=false;
    views[mode].scroll=q('HistoryList').scrollTop;views[mode].draft=q('HistorySearch').value;
    views[mode].search=views[mode].draft.trim();
    closeDetail();editor.dispose();closeDialog();
    const list=q('HistoryList');
    try{
      list.inert=true;q('HistorySearch').disabled=true;await runtime.call('dismiss-history-menu');
      if(disposed||token!==modeRevision)return;
      await motion.changeView(()=>{
        if(disposed||token!==modeRevision)return;
        mode=mode==='history'?'phrases':'history';entries=views[mode].loadedSearch===views[mode].search?views[mode].entries:[];next=null;cards.clear();q('HistorySearch').value=views[mode].draft;render();list.scrollTop=views[mode].scroll;
        const desiredScroll=views[mode].scroll,initialScroll=list.scrollTop;
        void update().then(()=>{if(!disposed&&token===modeRevision&&list.scrollTop===initialScroll){list.scrollTop=desiredScroll;progress();}});
      });
    }catch(error){if(!disposed&&error?.name!=='AbortError')showError(error);}
    finally{switching=false;if(!disposed){q('HistoryMode').disabled=false;q('HistorySearch').disabled=false;list.inert=Boolean(detail);}}
  }
  function searchNow(){
    clearTimeout(searchTimer);if(disposed||switching||composing)return;
    const value=q('HistorySearch').value;views[mode].draft=value;
    q('HistorySearchClear').hidden=!value;
    views[mode].search=value.trim();closeDetail();q('HistoryList').scrollTop=0;next=null;void update();
  }
  function queueSearch(){
    clearTimeout(searchTimer);revision++;loading=false;next=null;
    views[mode].draft=q('HistorySearch').value;q('HistorySearchClear').hidden=!q('HistorySearch').value;
    if(!composing)searchTimer=setTimeout(searchNow,q('HistorySearch').value?180:0);
  }
  function closeDetail(){detailRevision++;detail=null;q('HistoryDetail').hidden=true;q('HistoryDetailBody').replaceChildren();q('HistoryList').inert=false;}
  async function select(id,viewOnly=false){
    const owner=++detailRevision;
    try{
      const entry=entries.find(e=>e.id===id);if(!entry)return;
      if(mode==='phrases'&&!viewOnly){await action({action:'copy',id,kind:'phrase'});return;}
      if(entry.kind==='image'){await clipboard.request({action:'pin',id});return;}
      const value=await clipboard.request({action:mode==='phrases'?'phraseDetail':'detail',id});if(disposed||owner!==detailRevision)return;
      detail={...value,kind:mode==='phrases'?'phrase':value.kind};q('HistoryDetailBody').replaceChildren(node('pre','',detail.kind==='files'?value.paths.join('\n'):value.text));
      if(value.note)q('HistoryDetailBody').append(node('p','shot-detail-note',value.note));
      q('HistoryDetail').hidden=false;q('HistoryList').inert=true;q('HistoryDetail').querySelector('button').focus();
    }catch(error){if(!disposed&&owner===detailRevision)showError(error);}
  }
  async function action(payload){
    if(disposed)return;
    const name=typeof payload==='string'?payload:payload.action,id=typeof payload==='object'?payload.id:null;
    const entryKind=typeof payload==='object'?payload.kind:null;
    if(id&&entryKind&&name!=='delete-confirmed'&&((entryKind==='phrase')!==(mode==='phrases')))return;
    if(name==='toggle'){if(state==='collapsed')await expand();else await collapse();return;}
    if(name==='error'){showError('screenshot:window-failed');return;}
    if(name==='open'||name==='open-history'){await runtime.call('navigate',{target:'clipboard-history'});return;}
    if(name==='main'){await runtime.call('navigate',{target:'main'});return;}
    if(name==='history-menu'){const box=panel.querySelector('[data-shot-action="history-menu"]').getBoundingClientRect();await runtime.call('history-menu',{toggle:true,anchor:{x:box.left,y:box.bottom,width:box.width,height:box.height}});clearWindowError();return;}
    if(name==='history-mode'){await switchMode();return;}
    if(name==='history-search-clear'){if(switching)return;q('HistorySearch').value='';composing=false;q('HistorySearch').focus({preventScroll:true});searchNow();return;}
    if(name==='phrase-create'||name==='phrase-edit'||name==='note'){await editor.open(name==='note'?'note':'phrase',id);return;}
    if(name==='hide'||name==='close'){await runtime.call(name==='hide'?'hide-history':'close-history');clearWindowError();return;}
    if(name==='history-back'){closeDetail();return;}
    if(name==='retry-history'){clearError();await update();return;}
    if(name==='view'&&id){await select(id,true);return;}
    if(name==='delete'&&id){
      const phrase=entryKind==='phrase',message=node('p','',tr(phrase?'phraseDeleteDescription':'historyDeleteDescription'));
      showDialog(tr(phrase?'phraseDelete':'historyDelete'),message,{confirmLabel:tr('historyDelete'),onConfirm:()=>run({action:'delete-confirmed',id,kind:entryKind})});return;
    }
    if(busy)return;busy=true;clearError();revision++;recording();
    let copied=false;
    try{
      if(name==='monitor'){const status=await clipboard.request({action:'status'});await clipboard.request({action:status.enabled?'stop':'start'});}
      if(name==='delete-confirmed'&&id){await clipboard.request(entryKind==='phrase'?{action:'phraseDelete',id}:{action:'delete',ids:[id]});if(detail?.id===id)closeDetail();}
      if(name==='phrase-add'&&id){await clipboard.request({action:'phraseFromHistory',id});}
      if((name==='history-copy'&&detail)||(name==='copy'&&id)){await clipboard.request({action:(entryKind||detail?.kind)==='phrase'?'phraseCopy':'copy',id:id||detail.id});copied=true;}
    }finally{busy=false;if(!disposed){recording();await update();}}
    if(copied&&!disposed)void feedback('copied');
    if(name==='phrase-add'&&!disposed)void feedback('phraseAdded');
  }
  const run=name=>void action(name).catch(error=>{if(!disposed)showError(error);});
  function bindDrag(handle,expectedState){
    scope.event(handle,'pointerdown',e=>{if(e.button!==0||state!==expectedState||(handle!==bubble&&e.target.closest('button')))return;suppressClick=false;drag={x:e.screenX,y:e.screenY};handle.setPointerCapture(e.pointerId);});
    scope.event(handle,'pointermove',e=>{if(!drag||Math.hypot(e.screenX-drag.x,e.screenY-drag.y)<6)return;drag=null;suppressClick=handle===bubble;handle.releasePointerCapture(e.pointerId);void Promise.resolve().then(()=>getCurrentWindow().startDragging()).catch(error=>{if(!disposed)showError(error);});});
    scope.event(handle,'pointerup',()=>{drag=null;});scope.event(handle,'pointercancel',()=>{drag=null;});
  }
  bindDrag(bubble,'collapsed');bindDrag(panel.querySelector('header'),'expanded');
  scope.event(panel.querySelector('[data-shot-action="history-menu"]'),'pointerdown',event=>{if(event.button===0)run('history-menu');});
  scope.event(root,'contextmenu',event=>{
    event.preventDefault();if(q('Dialog')?.classList.contains('visible')||busy)return;
    const item=event.target.closest('[data-entry-id]'),entry=entries.find(value=>value.id===Number(item?.dataset.entryId));
    void runtime.call('history-menu',entry?{id:entry.id,kind:mode==='phrases'?'phrase':entry.kind}:{}).then(clearWindowError).catch(showError);
  });
  scope.event(q('HistoryList'),'scroll',()=>{progress();const list=q('HistoryList');if(mode==='phrases'&&list.scrollHeight-list.scrollTop-list.clientHeight<80)void update(true);},{passive:true});
  scope.event(q('HistorySearchForm'),'submit',event=>{event.preventDefault();searchNow();});
  scope.event(q('HistorySearch'),'input',queueSearch);
  scope.event(q('HistorySearch'),'compositionstart',()=>{composing=true;clearTimeout(searchTimer);revision++;loading=false;});
  scope.event(q('HistorySearch'),'compositionend',()=>{composing=false;queueSearch();});
  scope.use(()=>clearTimeout(searchTimer));
  const observer=new ResizeObserver(progress);observer.observe(q('HistoryList'));scope.use(()=>observer.disconnect());
  scope.use(()=>cancelAnimationFrame(progressFrame));
  scope.event(root,'click',event=>{
    const filter=event.target.closest('[data-history-kind]');
    if(filter){
      if(switching||dragging.active||filter.dataset.historyKind===kind)return;
      const order=['','image','text','files'],direction=Math.sign(order.indexOf(filter.dataset.historyKind)-order.indexOf(kind));
      kind=filter.dataset.historyKind;closeDetail();q('HistoryList').scrollTop=0;motion.selectFilter(kind);
      if(views.history.search)void update(false,direction);else{render();motion.revealList(direction);}return;
    }
    const target=event.target.closest('[data-shot-action]')?.dataset.shotAction;
    if(target==='history-menu'&&event.detail>0)return;
    if(target==='expand-history'){if(suppressClick){suppressClick=false;return;}void expand();}
    else if(target==='collapse-history')void collapse();else if(target)run(target);
    const item=event.target.closest('[data-entry-id]');if(item&&state==='expanded')void select(Number(item.dataset.entryId));
  });
  scope.event(window,'keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!q('Dialog')?.classList.contains('visible')){event.preventDefault();if(detail)closeDetail();else void collapse();}});
  function dispose(){disposed=true;revision++;detailRevision++;modeRevision++;clearTimeout(timer);animation?.cancel();editor.dispose();scope.dispose();cards.clear();closeDialog();q('HistoryList').replaceChildren();q('HistoryDetailBody').replaceChildren();}
  try{
    scope.use(await clipboard.subscribe(payload=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(mode!=='phrases'||payload?.library){void update();return;}
      const owner=revision;if(busy||disposed)return;
      void clipboard.request({action:'status'}).then(status=>{if(!disposed&&owner===revision&&!busy){enabled=status.enabled;recording();}}).catch(error=>{if(!disposed&&owner===revision)showError(error);});
    },100);}));
    scope.use(await runtime.listen('screenshot-history-action',run));
    await runtime.call('expand',{expanded:false,reducedMotion:reduced()});origin();await update();
    scope.timeout(()=>{void runtime.call('prepare-history-menu').catch(()=>{});},100);
  }catch(error){dispose();throw error;}
  return {contextChanged:next=>{data.context=next;render();},dispose};
}
