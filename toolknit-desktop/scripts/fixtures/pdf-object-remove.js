import markup from '../../src/features/pdf-object-remove/template.js';
import { initPdfObjectRemoveTool } from '../../src/features/pdf-object-remove/tool.js';
import { createTaskCenter } from '../../src/app/task-center.js';
import { applyTheme } from '../../src/app/theme-palette.js';
import { setLangWithoutFade } from '../../src/i18n.js';
import { createIcons,icons } from 'lucide';
const params=new URLSearchParams(location.search);applyTheme(document.documentElement,{mode:params.get('theme')||'light'});setLangWithoutFade(params.get('lang')||'zh');document.body.insertAdjacentHTML('beforeend',markup);
const state=window.pdfRemoveTest={calls:[],holdWrite:false,failWrite:false,holdSize:false,workers:[],center:createTaskCenter({storage:localStorage})},NativeWorker=window.Worker,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);this.entry={url:String(url),terminated:false,pendingAction:null};state.workers.push(this.entry);this.addEventListener('message',event=>{if(event.data?.id&&!event.data.progress)this.entry.pendingAction=null;});}postMessage(message,transfer){this.entry.pendingAction=message?.action||null;return super.postMessage(message,transfer);}terminate(){this.entry.terminated=true;return super.terminate();}};
state.controller=initPdfObjectRemoveTool({overlay:document.getElementById('pdfRemoveOverlay'),isTauri:params.has('native'),center:state.center,chooseFile:async()=>null,getOutputDir:async()=> 'QA PDF Objects',refreshIcons:()=>createIcons({icons}),invokeNative:async(command,args,options)=>{
 state.calls.push({command,args:args instanceof Uint8Array?undefined:args,options});if(command==='open_path')return;
 if(command==='get_file_size'){while(state.holdSize)await wait(10);return state.nativeSize;}
 if(command==='read_file_bytes_limited')return Array.from(new Uint8Array(await(await fetch(state.nativeUrl)).arrayBuffer()));
 if(command==='write_unique_file_binary'){while(state.holdWrite)await wait(10);if(state.failWrite)throw Error('synthetic disk failure');const response=await fetch('/__pdf-remove-write',{method:'POST',body:args,headers:{'x-toolknit-output':options.headers['x-toolknit-output']}});if(!response.ok)throw Error('fixture writer failed');return(await response.json()).path;}
 throw Error('Unexpected command '+command);
}});
state.lang=setLangWithoutFade;state.theme=mode=>applyTheme(document.documentElement,{mode});state.controller.open();
if(params.has('sample')){
 const blob=await(await fetch('/tmp/pdf-object-remove/source.pdf')).blob();await state.controller.importFile(new File([blob],'合成水印样例.pdf'));
 const data=await(await fetch('/tmp/pdf-object-remove/analysis.json')).json(),item=data.candidates.filter(item=>item.pageIndex===0&&item.label==='DRAFT').at(-1),objects=document.getElementById('pdfRemoveObjects');objects.value=item.id;objects.dispatchEvent(new Event('change'));document.getElementById('pdfRemoveMatch').click();document.getElementById('pdfRemovePreview').click();
}
