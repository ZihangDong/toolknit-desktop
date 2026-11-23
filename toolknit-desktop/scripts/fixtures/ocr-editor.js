import markup from '../../src/features/ocr-editor/template.js';
import { initOcrEditorTool } from '../../src/features/ocr-editor/tool.js';
import { createTaskCenter } from '../../src/app/task-center.js';
import { applyTheme } from '../../src/app/theme-palette.js';
import { setLangWithoutFade } from '../../src/i18n.js';
import { createIcons, icons } from 'lucide';
const params=new URLSearchParams(location.search);applyTheme(document.documentElement,{mode:params.get('theme')||'light'});setLangWithoutFade(params.get('lang')||'zh');
document.body.insertAdjacentHTML('beforeend',markup);
const state=window.ocrEditTest={mode:'normal',holdSave:false,failSave:false,calls:[],center:createTaskCenter({storage:localStorage}),native:params.has('native')};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(params.has('adapter')) window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 if(command!=='local_ocr')throw Error(command);state.calls.push({command,args});const {action,image}=args.request;
 if(action==='status')return{ready:true};if(action==='cancel')return;
 if(action==='recognize'){if(!image.startsWith('data:image/png;base64,'))throw Error('Expected PNG data URL');return(await fetch('/tmp/ocr-editor-browser/source.ocr.json')).json();}throw Error(action);
}};
state.controller=initOcrEditorTool({overlay:document.getElementById('ocrEditOverlay'),isTauri:state.native,center:state.center,getOutputDir:async()=> 'QA OCR',refreshIcons:()=>createIcons({icons}),
 ocrRuntime:params.has('adapter')?undefined:{browserAvailable:true,ensure:async signal=>{if(state.mode==='missing')throw Error('ocr:not-installed');if(signal.aborted)throw Error('ocr:cancelled');},recognize:async(_image,signal)=>{
   if(state.mode==='hold'||state.mode==='late')return new Promise((resolve,reject)=>{state.resolveOcr=()=>resolve(state.result||{width:800,height:400,lines:[]});if(state.mode==='hold')signal.addEventListener('abort',()=>reject(Error('ocr:cancelled')),{once:true});});
   if(state.mode==='bad')return{width:800,height:400,lines:[{text:'bad',x:NaN,y:2,width:20,height:20}]};
   if(state.mode==='real')return(await fetch('/tmp/ocr-editor-browser/source.ocr.json')).json();
   return state.result||{width:800,height:400,lines:[{text:'项目验收 2026',x:38,y:38,width:330,height:60},{text:'Invoice 123',x:38,y:138,width:330,height:60}]};
 }},invokeNative:async(command,args,options)=>{
   state.calls.push({command,options,args:args instanceof Uint8Array?undefined:args});
   if(command==='open_path')return;
   if(command==='write_unique_file_binary'){while(state.holdSave)await wait(20);if(state.failSave)throw Error('synthetic disk failure');const res=await fetch('/__ocr-write',{method:'POST',body:args,headers:{'x-toolknit-output':options.headers['x-toolknit-output']}});if(!res.ok)throw Error('fixture write failed');return(await res.json()).path;}
   if(command==='get_file_size')return state.nativeFileSize;
   if(command==='read_file_bytes_limited')return Array.from(new Uint8Array(await(await fetch(state.nativeFileUrl)).arrayBuffer()));
   throw Error(command);
 }});
state.lang=setLangWithoutFade;state.theme=mode=>applyTheme(document.documentElement,{mode});state.controller.open();
if(params.has('sample')){const blob=await(await fetch('/tmp/ocr-editor-browser/source.png')).blob();await state.controller.importFile(new File([blob],'扫描件.png'));document.getElementById('ocrEditRecognize').click();}
