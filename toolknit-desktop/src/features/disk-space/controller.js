import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { tauriCorePromise, tauriEventPromise, loadTauriDialog } from '../../platform/tauri-runtime.js';
import { t, onLangChange } from '../../i18n.js';
import { DISK_PAGE_SIZE, formatDiskBytes, diskPercent, diskTreemap, validateDiskSummary, validateDiskView, diskCancelled } from './core.js';

export function createDiskSpaceController({ overlay, isTauri=false, invokeNative, listenNative, chooseDirectory, center=taskCenter, refreshIcons=()=>{}, displayFilesystemPath=String }={}) {
  const scope=createLifecycleScope(),q=id=>overlay.querySelector(`#diskSpace${id}`),tr=(key,values)=>t(`home.diskSpace.${key}`,values);
  const invoke=async(...args)=>(invokeNative||(await tauriCorePromise).invoke)(...args),listen=async(...args)=>(listenNative||(await tauriEventPromise).listen)(...args);
  let owner=null,operation=null,summary=null,view=null,selected=null,notice=null,progress=null,viewRevision=0,viewLoading=false,disposed=false,picking=false;
  const modal=createModalSession({root:overlay,background:document.querySelector('.app'),initialFocus:q('Choose'),onClose:close});scope.use(modal.dispose);
  const current=op=>owner&&operation===op&&op.owner===owner;
  function stopListening(op){const unlisten=op?.unlisten;if(op)op.unlisten=null;try{void Promise.resolve(unlisten?.()).catch(()=>{});}catch{/* Event transport may already be closed. */}}
  const request=(action,jobId,extra={})=>invoke('disk_space',{request:{action,jobId,...extra}});
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  function setNotice(key,params={},error=false){notice={key,params,error};renderNotice();}
  function renderNotice(){q('Status').textContent=notice?tr(notice.key,notice.params):'';q('Status').classList.toggle('is-error',!!notice?.error);}
  function report(error){const code=/disk:([a-z-]+)/.exec(String(error?.message||error))?.[1]||'failed';const key=`error.${code}`;setNotice(error?.name==='AbortError'||code==='cancelled'?'cancelled':tr(key)===`home.diskSpace.${key}`?'error.failed':key,{},code!=='cancelled');}
  function controls(){
    const busy=!!operation||viewLoading;q('Choose').disabled=!isTauri||busy||picking;q('Rescan').disabled=!isTauri||busy||picking||!summary;q('Clear').disabled=busy||!summary;
    q('Cancel').hidden=!operation;q('Cancel').disabled=!!operation?.stopping;
    q('Results').inert=busy;q('Results').setAttribute('aria-busy',String(busy));q('Results').hidden=!summary;q('Empty').hidden=!!summary;
    q('Up').disabled=busy||!view||view.node.parent===null;q('Previous').disabled=busy||!view||view.offset===0;q('Next').disabled=busy||!view||view.offset+view.items.length>=view.total;
    q('Enter').disabled=busy||selected?.kind!=='directory'||selected?.id===view?.node.id;q('Reveal').disabled=busy||!selected||!isTauri;
  }
  function renderProgress(){
    q('Progress').hidden=!operation;q('ScanningPath').hidden=!operation||!progress?.currentPath;
    q('Progress').textContent=progress?tr('progress',{files:progress.files,directories:progress.directories,size:formatDiskBytes(progress.bytes),seconds:Math.floor(progress.elapsedMs/1000)}):tr('preparing');
    q('ScanningPath').textContent=progress?.currentPath?displayFilesystemPath(progress.currentPath):'';
  }
  function renderSummary(){
    if(!summary)return;q('Total').textContent=formatDiskBytes(summary.root.bytes);q('Files').textContent=String(summary.files);q('Directories').textContent=String(summary.directories);q('Skipped').textContent=String(summary.skipped);
    q('Issues').hidden=!summary.partial;q('IssueSummary').textContent=tr('issueSummary',{count:summary.issueCount,shown:summary.issues.length});q('IssueList').replaceChildren();
    if(summary.cancelled)q('IssueList').append(node('li',tr('cancelledPartial')));
    if(summary.limitReason)q('IssueList').append(node('li',tr(`limit.${summary.limitReason}`)));
    for(const issue of summary.issues)q('IssueList').append(node('li',`${tr(`reason.${issue.reason}`)} · ${displayFilesystemPath(issue.path)}`));
  }
  function renderSelection(){
    q('SelectedName').textContent=selected?.name||'';q('SelectedPath').textContent=selected?displayFilesystemPath(selected.path):'';
    q('SelectedInfo').textContent=selected?selected.duplicate?tr('duplicateInfo',{logical:formatDiskBytes(selected.logicalBytes)}):selected.reason?tr(`reason.${selected.reason}`):tr('selectedInfo',{size:formatDiskBytes(selected.bytes),kind:tr(`kind.${selected.kind}`)}):'';
    q('Rows').querySelectorAll('[data-select]').forEach(button=>{const active=Number(button.dataset.select)===selected?.id;button.setAttribute('aria-pressed',String(active));button.closest('tr').classList.toggle('is-selected',active);});
    q('Tiles').querySelectorAll('[data-select]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.select)===selected?.id)));controls();
  }
  function drawMap(){
    q('Tiles').replaceChildren();if(!view)return;const map=q('Map'),width=map.clientWidth,height=map.clientHeight;
    const items=[...view.tiles];if(view.otherCount&&view.otherBytes!=='0')items.push({id:'other',name:tr('other',{count:view.otherCount}),bytes:view.otherBytes});
    q('MapEmpty').hidden=!!items.length;
    for(const tile of diskTreemap(items,width,height)){
      const button=node('button',undefined,'disk-space-tile');button.type='button';if(tile.id==='other')button.dataset.other='true';else button.dataset.select=String(tile.id);
      button.title=`${tile.name} · ${formatDiskBytes(tile.bytes)}`;button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(tile.id===selected?.id));
      Object.assign(button.style,{left:`${tile.x/width*100}%`,top:`${tile.y/height*100}%`,width:`${tile.width/width*100}%`,height:`${tile.height/height*100}%`});
      button.classList.toggle('is-small',tile.width<92||tile.height<55);button.append(node('span',tile.name),node('span',formatDiskBytes(tile.bytes)));q('Tiles').append(button);
    }
  }
  function renderView(){
    if(!view)return;q('Breadcrumbs').replaceChildren();for(const crumb of view.breadcrumbs){const button=node('button',crumb.name);button.type='button';button.dataset.directory=String(crumb.id);button.title=displayFilesystemPath(crumb.path);if(crumb.id===view.node.id)button.setAttribute('aria-current','location');q('Breadcrumbs').append(button);}
    q('CurrentTotal').textContent=formatDiskBytes(view.node.bytes);q('MapNote').textContent=tr('mapNote',{other:view.otherCount,zero:view.zeroCount});q('ListCount').textContent=tr('childCount',{count:view.total});
    q('Rows').replaceChildren();for(const item of view.items){const row=node('tr'),name=node('td'),button=node('button',undefined,'disk-space-name');button.type='button';button.dataset.select=String(item.id);button.title=displayFilesystemPath(item.path);button.append(node('span',item.name),node('span',item.duplicate?tr('hardLink'):item.reason?tr(`reason.${item.reason}`):item.partial?tr('partialDirectory'):tr(`kind.${item.kind}`)));name.append(button);row.append(name,node('td',formatDiskBytes(item.bytes)),node('td',diskPercent(item.bytes,view.node.bytes)));q('Rows').append(row);}
    q('ListEmpty').hidden=!!view.total;q('Page').textContent=tr('page',{page:Math.floor(view.offset/DISK_PAGE_SIZE)+1,pages:Math.max(1,Math.ceil(view.total/DISK_PAGE_SIZE))});drawMap();renderSelection();
  }
  function select(id){if(operation||viewLoading||!view)return;selected=[view.node,...view.items,...view.tiles].find(item=>item.id===id)||selected;renderSelection();}
  async function navigate(id,offset=0){
    if(!owner||!summary||operation||viewLoading)return;const token=owner,jobId=summary.jobId,revision=++viewRevision;viewLoading=true;controls();
    try{const next=validateDiskView(await request('children',jobId,{nodeId:id,offset,limit:DISK_PAGE_SIZE}),jobId);if(owner!==token||revision!==viewRevision)return;view=next;selected=next.node;renderView();q('TableScroll').scrollTop=0;}
    catch(error){if(owner===token&&revision===viewRevision)report(error);}
    finally{if(owner===token&&revision===viewRevision){viewLoading=false;controls();}}
  }
  async function cancel(op=operation){
    if(!op||!current(op)||op.stopping)return;op.stopping=true;controls();setNotice('stopping');
    if(!op.started)return;
    try{await request('cancel',op.jobId);}catch(error){if(current(op)){op.stopping=false;controls();report(error);}throw error;}
  }
  async function scan(root){
    if(!owner||operation||viewLoading||!isTauri||!root)return;const op={owner,jobId:crypto.randomUUID(),root,started:false,stopping:false,unlisten:null};operation=op;progress=null;
    op.task=center.begin({label:tr('title'),tool:'disk-space',cancel:()=>cancel(op)});op.task.progress(null,tr('scanning'));setNotice('scanning');controls();renderProgress();
    try{
      op.unlisten=await listen('disk-space-progress',event=>{const value=event.payload;if(current(op)&&value?.jobId===op.jobId){try{formatDiskBytes(value.bytes);if(!Number.isFinite(value.files)||!Number.isFinite(value.directories))return;progress=value;renderProgress();}catch{/* Ignore malformed progress without disturbing the last valid counters. */}}});
      if(!current(op)||op.stopping)throw diskCancelled();op.started=true;
      const next=validateDiskSummary(await request('start',op.jobId,{root}),op.jobId);if(!current(op))throw diskCancelled();
      const first=validateDiskView(await request('children',op.jobId,{nodeId:0,offset:0,limit:DISK_PAGE_SIZE}),op.jobId);if(!current(op))throw diskCancelled();
      summary=next;view=first;selected=first.node;renderSummary();renderView();
      if(next.cancelled){op.task.fail(diskCancelled());setNotice('cancelledPartial');}else{op.task.finish({message:tr(next.partial?'partial':'complete')});setNotice(next.partial?'partial':'complete');}
    }catch(error){op.task.fail(error);if(summary?.jobId!==op.jobId)release(op.jobId);if(current(op))report(error);}
    finally{stopListening(op);if(operation===op){operation=null;progress=null;renderProgress();controls();}}
  }
  async function choose(){
    if(!owner||operation||viewLoading||!isTauri||picking)return;const token=owner;picking=true;controls();
    try{const picker=chooseDirectory||(options=>loadTauriDialog().then(api=>api.open(options)));const root=await picker({directory:true,multiple:false});if(owner===token&&typeof root==='string')await scan(root);}catch(error){if(owner===token)report(error);}finally{if(owner===token){picking=false;controls();}}
  }
  function release(id){if(id)void request('release',id).catch(()=>{});}
  function clear(){if(operation||viewLoading)return;release(summary?.jobId);summary=null;view=null;selected=null;notice=null;q('Rows').replaceChildren();q('Tiles').replaceChildren();renderNotice();controls();}
  async function reveal(){const target=selected,token=owner;if(!target||!isTauri||operation||viewLoading)return;try{await invoke('open_path',{path:target.path});}catch{if(owner===token)setNotice('error.reveal',{},true);}}
  function translate(){overlay.querySelectorAll('[data-i18n]').forEach(element=>element.textContent=t(element.dataset.i18n));overlay.querySelectorAll('[data-i18n-aria-label]').forEach(element=>element.setAttribute('aria-label',t(element.dataset.i18nAriaLabel)));renderNotice();renderSummary();renderView();renderProgress();controls();}
  for(const [id,fn]of[['Choose',choose],['Rescan',()=>scan(summary?.root.path)],['Cancel',cancel],['Reveal',reveal],['Up',()=>navigate(view?.node.parent)],['Previous',()=>navigate(view.node.id,view.offset-DISK_PAGE_SIZE)],['Next',()=>navigate(view.node.id,view.offset+DISK_PAGE_SIZE)],['Enter',()=>navigate(selected.id)]])scope.event(q(id),'click',()=>{void Promise.resolve().then(()=>fn()).catch(report);});
  scope.event(q('Clear'),'click',clear);
  scope.event(q('Breadcrumbs'),'click',event=>{const button=event.target.closest('[data-directory]');if(button)void navigate(Number(button.dataset.directory));});
  for(const container of [q('Tiles'),q('Rows')]){
    scope.event(container,'click',event=>{const button=event.target.closest('[data-select]');if(button)select(Number(button.dataset.select));else if(event.target.closest('[data-other]')){q('TableScroll').scrollIntoView({block:'center'});q('Rows').querySelector('button')?.focus({preventScroll:true});}});
    scope.event(container,'dblclick',event=>{const button=event.target.closest('[data-select]');if(button){select(Number(button.dataset.select));if(selected?.kind==='directory')void navigate(selected.id);}});
  }
  overlay.querySelectorAll('[data-disk-space-close]').forEach(element=>scope.event(element,'click',close));
  const observer=new ResizeObserver(drawMap);observer.observe(q('Map'));scope.use(()=>observer.disconnect());scope.use(onLangChange(translate));
  function open(){if(disposed)return false;close();owner={};modal.open();setNotice(isTauri?'ready':'desktopOnly');translate();refreshIcons();return true;}
  function close(){++viewRevision;const ids=new Set([operation?.jobId,summary?.jobId]);operation?.task.fail(diskCancelled());stopListening(operation);operation=null;owner=null;picking=false;viewLoading=false;for(const id of ids)release(id);summary=null;view=null;selected=null;progress=null;notice=null;q('Rows').replaceChildren();q('Tiles').replaceChildren();q('IssueList').replaceChildren();q('Breadcrumbs').replaceChildren();for(const id of ['SelectedName','SelectedPath','SelectedInfo','ScanningPath'])q(id).textContent='';modal.close();controls();return true;}
  translate();return {open,close,scan,get busy(){return !!operation||viewLoading||picking;},dispose(){if(disposed)return;close();disposed=true;scope.dispose();}};
}
