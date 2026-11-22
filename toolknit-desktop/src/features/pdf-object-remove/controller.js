import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { tauriCorePromise,loadTauriDialog } from '../../platform/tauri-runtime.js';
import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
import { t,onLangChange } from '../../i18n.js';
import { REMOVE_LIMITS,removeError,validateRemoveFile,removeOutputName,removalPages,removalHistory,exactRemovalMatches } from './core.js';
import { createRemovalWorker } from './worker-client.js';
import { openRemovalDocument,renderRemovalPage,releaseRemovalDocument,copyRemovalCanvas,removalDifference } from './preview.js';

export function createPdfObjectRemoveController({overlay,isTauri=false,invokeNative,chooseFile,getOutputDir,center=taskCenter,refreshIcons=()=>{}}={}){
 const scope=createLifecycleScope(),q=id=>overlay.querySelector(`#pdfRemove${id}`),tr=(key,params)=>t(`home.pdfObjectRemove.${key}`,params),processor=createRemovalWorker();
 const invoke=async(...args)=>(invokeNative||(await tauriCorePromise).invoke)(...args);
 let owner=null,operation=null,source=null,analysis=null,sourcePdf=null,resultPdf=null,resultBytes=null,resultMode='',previewKey='',pageIndex=0,focusId=null,selected=new Set(),history=removalHistory(),difference=null,output='',notice=null,disposed=false;
 const modal=createModalSession({root:overlay,background:document.querySelector('.app'),initialFocus:q('Pick'),onClose:close});scope.use(modal.dispose);
 const focus=()=>analysis?.candidates.find(item=>item.id===focusId),selectionKey=()=>[...selected].sort().join(','),alive=op=>owner&&operation===op&&op.owner===owner&&!op.abort.signal.aborted;
 const errorCode=error=>/pdf-remove:([a-z-]+)/.exec(String(error?.message||error))?.[1]||'failed';
 function setNotice(key,params={},error=false){notice={key,params,error};renderNotice();}
 function renderNotice(){q('Status').textContent=notice?tr(notice.key,notice.params):'';q('Status').classList.toggle('is-error',!!notice?.error);}
 function report(error){const code=errorCode(error),key=`error.${code}`;setNotice(code==='cancelled'||error?.name==='AbortError'?'cancelled':tr(key)===`home.pdfObjectRemove.${key}`?'error.failed':key,{},code!=='cancelled');}
 function begin(kind){const op={owner,kind,abort:new AbortController(),committing:false};op.check=()=>{if(!alive(op))throw removeError('cancelled');};op.progress=()=>{};operation=op;if(['load','export'].includes(kind))op.task=center.begin({label:tr(kind==='load'?'loading':'export'),tool:'pdf-object-remove',cancel:()=>cancel(op)});op.task?.progress(null);if(kind!=='export')op.timer=setTimeout(()=>{if(alive(op)){op.timedOut=true;cancel(op);}},180000);controls();setNotice(kind==='load'?'loading':kind==='export'?'saving':'previewing');return op;}
 function cancel(op=operation){if(!op||op.committing||op.abort.signal.aborted)return;op.abort.abort();op.renderTask?.cancel();void op.loadingTask?.destroy().catch(()=>{});if(operation===op){setNotice('cancelled');controls();}}
 function end(op){clearTimeout(op.timer);if(operation!==op)return;operation=null;controls();}
 function matchIds(){const item=focus();return item?exactRemovalMatches(analysis.candidates,item,removalPages(q('Range').value,analysis.pageCount)):[];}
 function objectLabel(item){
  const content=item.kind==='stamp'?tr('stampLabel',{number:item.annotationNumber})
   :item.label||tr(item.kind.includes('text')?'encodedText':'imageLabel',{width:item.width||0,height:item.height||0});
  const kind=tr('kind.'+item.kind);
  const label=item.formDepth?tr('insideForm',{kind}):kind;
  return `${selected.has(item.id)?tr('markedPrefix')+' ':''}${label} · ${content}`;
 }
 function controls(){
  const busy=!!operation,loaded=!!source,item=focus();for(const id of ['Pick','Page','Objects','Range','Reset','ClearSelection'])q(id).disabled=busy||(id!=='Pick'&&!loaded);
  for(const id of ['Inspect','Mark'])q(id).disabled=busy||!item;
  q('Mark').textContent=tr(item&&selected.has(item.id)?'unmark':'mark');q('Undo').disabled=busy||!history.canUndo;q('Redo').disabled=busy||!history.canRedo;
  q('Preview').disabled=busy||!selected.size;q('Export').disabled=busy||!resultBytes||resultMode!=='changes'||previewKey!==selectionKey()||!selected.size;
  q('Cancel').hidden=!busy;q('Cancel').disabled=!!operation?.committing||!!operation?.abort.signal.aborted;
  q('Folder').hidden=!output||!isTauri;q('Folder').disabled=busy;q('Output').textContent=output;
  q('Before').hidden=!loaded;q('Selection').textContent=tr('selectionCount',{count:selected.size});
  try{const ids=matchIds();q('MatchCount').textContent=tr('matchCount',{count:ids.length});q('Match').disabled=busy||!ids.length;}catch{q('MatchCount').textContent=tr('error.range');q('Match').disabled=true;}
  q('Zoom').disabled=busy||!loaded;applyZoom();
 }
 function applyZoom(){const value=q('Zoom').value;for(const id of ['Before','After']){const canvas=q(id);canvas.style.width=value==='fit'?'100%':`${canvas.width*Number(value)}px`;}q('Before').parentElement.style.width=value==='fit'?'100%':`${q('Before').width*Number(value)}px`;}
 function options(){
  q('Page').replaceChildren(...Array.from({length:analysis?.pageCount||0},(_,index)=>new Option(tr('pageNumber',{number:index+1,count:analysis.pageCount}),String(index))));q('Page').value=String(pageIndex);
  const items=analysis?.candidates.filter(item=>item.pageIndex===pageIndex)||[];q('Objects').replaceChildren(...items.map(item=>Object.assign(new Option(objectLabel(item),item.id),{title:objectLabel(item)})));q('Objects').value=focusId||'';
  const page=analysis?.pages[pageIndex];
  const pageKey=page?.reason?(page.count?'pagePartial':'pageUnsupported'):'pageObjects';
  q('PageNote').textContent=page?tr(pageKey,{count:page.count,reason:page.reason?tr('unsupported.'+page.reason):''}):'';
  q('File').textContent=source?tr('fileInfo',{name:source.name,pages:analysis.pageCount,count:analysis.candidates.length}):'';
  q('ObjectInfo').textContent=focus()?tr('objectInfo',{number:focus().id,kind:tr('kind.'+focus().kind)}):tr('noObject');controls();
 }
 function showDifference(){q('Difference').hidden=!difference||!q('Highlight').checked;if(difference)Object.assign(q('Difference').style,{left:`${difference.x*100}%`,top:`${difference.y*100}%`,width:`${difference.width*100}%`,height:`${difference.height*100}%`});q('DifferenceNote').textContent=!resultPdf?'':difference?tr('difference',{count:difference.count}):tr('noDifference');}
 function modeLabel(){q('PreviewMode').textContent=resultMode==='inspect'?tr('inspectMode'):resultMode==='changes'?tr('changesMode',{count:selected.size}):tr('needsPreview');}
 function invalidate(){const previous=resultPdf;resultPdf=null;resultBytes=null;resultMode='';previewKey='';difference=null;output='';q('After').hidden=true;q('Placeholder').hidden=false;void releaseRemovalDocument(previous);showDifference();modeLabel();}
 function remember(){history.push(selected);invalidate();options();setNotice('selectionChanged');}
 async function importFile(file){
  if(!owner||operation||!file||disposed)return;const op=begin('load');let loaded=null,canvas=null;
  try{
   const size=file.path?Number(await invoke('get_file_size',{path:file.path})):file.size;op.check();validateRemoveFile({name:file.name,size});
   const bytes=file.path?Uint8Array.from(await invoke('read_file_bytes_limited',{path:file.path,maxBytes:REMOVE_LIMITS.inputBytes})):new Uint8Array(await file.arrayBuffer());op.check();validateRemoveFile({name:file.name,size:bytes.length});
   const nextSource={name:file.name,bytes,key:crypto.randomUUID()};loaded=await openRemovalDocument(bytes,op);op.check();if(loaded.numPages>REMOVE_LIMITS.pages)throw removeError('pages');const next=await processor.load(nextSource,op);op.check();if(loaded.numPages!==next.pageCount)throw removeError('decode');
   canvas=await renderRemovalPage(loaded,0,op);op.check();const previous=sourcePdf;invalidate();sourcePdf=loaded;loaded=null;void releaseRemovalDocument(previous);source=nextSource;analysis=next;pageIndex=0;focusId=analysis.candidates.find(item=>item.pageIndex===0)?.id||null;selected=new Set();history=removalHistory();q('Range').value='';
   copyRemovalCanvas(canvas,q('Before'));options();modeLabel();setNotice('loaded',{pages:next.pageCount,count:next.candidates.length});op.task?.finish();
  }catch(error){const actual=op.abort.signal.aborted?removeError(op.timedOut?'timeout':'cancelled'):error;op.task?.fail(removeError(errorCode(actual)));if(owner===op.owner)report(actual);}
  finally{if(canvas)canvas.width=canvas.height=1;if(loaded)await releaseRemovalDocument(loaded);end(op);}
 }
 async function pick(){
  if(!owner||operation)return;if(!isTauri){q('FileInput').click();return;}const token=owner;
  try{const choose=chooseFile||(options=>loadTauriDialog().then(api=>api.open(options))),path=await choose({multiple:false,filters:[{name:'PDF',extensions:['pdf']}]});if(path&&owner===token)await importFile({path,name:path.split(/[\\/]/).pop()});}catch(error){if(owner===token)report(error);}
 }
 async function pageChange(target){
  if(!sourcePdf||operation||!owner||target===pageIndex)return;const op=begin('page');let before=null,after=null;
  try{before=await renderRemovalPage(sourcePdf,target,op);if(resultMode==='changes'&&resultPdf)after=await renderRemovalPage(resultPdf,target,op);const nextDifference=after?await removalDifference(before,after,op):null;op.check();if(resultMode==='inspect')invalidate();pageIndex=target;focusId=analysis.candidates.find(item=>item.pageIndex===target)?.id||null;copyRemovalCanvas(before,q('Before'));if(after){copyRemovalCanvas(after,q('After'));q('After').hidden=false;q('Placeholder').hidden=true;}difference=nextDifference;options();showDifference();modeLabel();setNotice('pageShown',{number:target+1});}
  catch(error){q('Page').value=String(pageIndex);if(owner===op.owner)report(op.abort.signal.aborted?removeError(op.timedOut?'timeout':'cancelled'):error);}finally{for(const canvas of [before,after])if(canvas)canvas.width=canvas.height=1;end(op);}
 }
 async function preview(kind){
  if(!owner||operation||!source)return;const item=focus(),ids=kind==='inspect'?(item?[item.id]:[]):[...selected];if(!ids.length)return;const op=begin('preview');let loaded=null,canvas=null;
  try{const bytes=await processor.build(source,ids,op);op.check();loaded=await openRemovalDocument(bytes,op);canvas=await renderRemovalPage(loaded,pageIndex,op);const nextDifference=await removalDifference(q('Before'),canvas,op);op.check();const previous=resultPdf;resultPdf=loaded;loaded=null;void releaseRemovalDocument(previous);resultBytes=bytes;resultMode=kind;previewKey=kind==='changes'?selectionKey():'';difference=nextDifference;copyRemovalCanvas(canvas,q('After'));q('After').hidden=false;q('Placeholder').hidden=true;showDifference();modeLabel();setNotice(kind==='inspect'?'inspected':'previewed');}
  catch(error){if(owner===op.owner)report(op.abort.signal.aborted?removeError(op.timedOut?'timeout':'cancelled'):error);}finally{if(canvas)canvas.width=canvas.height=1;if(loaded)await releaseRemovalDocument(loaded);end(op);}
 }
 async function save(){
  if(!owner||operation||!resultBytes||resultMode!=='changes'||previewKey!==selectionKey()||!selected.size)return;const op=begin('export'),bytes=resultBytes,name=removeOutputName(source.name);
  try{
   let path='';if(isTauri){const directory=await getOutputDir('PDF_Objects');op.check();op.committing=true;op.task?.disableCancellation();controls();path=await writeUniqueBinaryFile(invoke,{directory,fileName:name,bytes});}
   else{op.check();const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
   op.task?.finish({outputs:path?[path]:[]});if(owner===op.owner){output=path;setNotice(isTauri?'saved':'downloaded');}
  }catch(error){const actual=op.abort.signal.aborted?removeError(op.timedOut?'timeout':'cancelled'):error;op.task?.fail(removeError(errorCode(actual)));if(owner===op.owner)report(actual);}finally{end(op);}
 }
 function reset(){if(operation)return;const previous=sourcePdf;sourcePdf=null;void releaseRemovalDocument(previous);invalidate();processor.dispose();source=null;analysis=null;selected=new Set();history=removalHistory();pageIndex=0;focusId=null;q('Before').width=q('Before').height=1;q('After').width=q('After').height=1;q('Range').value='';notice=null;options();renderNotice();}
 function translate(){overlay.querySelectorAll('[data-i18n]').forEach(element=>element.textContent=t(element.dataset.i18n));q('Range').placeholder=tr('rangePlaceholder');options();modeLabel();showDifference();renderNotice();}
 for(const [id,fn]of[['Pick',pick],['Inspect',()=>preview('inspect')],['Preview',()=>preview('changes')],['Export',save],['Cancel',()=>cancel()]])scope.event(q(id),'click',()=>{void Promise.resolve().then(fn).catch(report);});
 scope.event(q('Mark'),'click',()=>{const item=focus();if(!item||operation)return;selected.has(item.id)?selected.delete(item.id):selected.add(item.id);remember();});
 scope.event(q('Match'),'click',()=>{if(operation)return;try{for(const id of matchIds())selected.add(id);remember();}catch(error){report(error);}});
 for(const [id,method]of[['Undo','undo'],['Redo','redo']])scope.event(q(id),'click',()=>{if(operation)return;selected=history[method]();invalidate();options();setNotice(method);});
 scope.event(q('ClearSelection'),'click',()=>{if(!operation){selected.clear();remember();}});scope.event(q('Reset'),'click',reset);scope.event(q('Range'),'input',controls);
 scope.event(q('Objects'),'change',()=>{focusId=q('Objects').value;options();});scope.event(q('Page'),'change',()=>{void pageChange(Number(q('Page').value));});scope.event(q('Highlight'),'change',showDifference);scope.event(q('Zoom'),'change',applyZoom);
 scope.event(q('FileInput'),'change',()=>{const file=q('FileInput').files?.[0];q('FileInput').value='';void importFile(file);});
 scope.event(q('JumpPreview'),'click',()=>{q('PreviewTitle').scrollIntoView({block:'start'});q('PreviewTitle').tabIndex=-1;q('PreviewTitle').focus({preventScroll:true});});scope.event(q('JumpControls'),'click',()=>{q('Title').scrollIntoView({block:'start'});q('Pick').focus({preventScroll:true});});
 scope.event(q('Folder'),'click',()=>{if(output)void invoke('open_path',{path:output}).catch(()=>setNotice('error.folder',{},true));});
 overlay.querySelectorAll('[data-pdf-remove-close]').forEach(element=>scope.event(element,'click',close));scope.use(onLangChange(translate));
 function open(){if(disposed||close()===false)return false;owner={};modal.open();translate();refreshIcons();return true;}
 function close(){if(operation?.committing){setNotice('saving');return false;}if(operation){const pending=operation;cancel(pending);pending.task?.fail(removeError('cancelled'));clearTimeout(pending.timer);}operation=null;owner=null;reset();modal.close();return true;}
 translate();return{open,close,importFile,get busy(){return!!operation;},dispose(){if(disposed||close()===false)return;disposed=true;scope.dispose();}};
}
