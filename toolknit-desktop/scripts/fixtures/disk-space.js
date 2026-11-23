import markup from '../../src/features/disk-space/template.js';
import { initDiskSpaceTool } from '../../src/features/disk-space/tool.js';
import { createTaskCenter } from '../../src/app/task-center.js';
import { applyTheme } from '../../src/app/theme-palette.js';
import { setLangWithoutFade } from '../../src/i18n.js';
import { createIcons, icons } from 'lucide';
const params=new URLSearchParams(location.search);applyTheme(document.documentElement,{mode:params.get('theme')||'light'});setLangWithoutFade(params.get('lang')||'zh');document.body.insertAdjacentHTML('beforeend',markup);
function synthetic(){
 const nodes=[],add=(name,parent,kind,bytes='0',extra={})=>{const id=nodes.length;nodes.push({id,parent,name,path:parent===null?'C:\\SyntheticDisk':nodes[parent].path+'\\'+name,kind,bytes,logicalBytes:kind==='file'?bytes:'0',files:kind==='file'?1:0,directories:0,duplicate:false,partial:false,reason:null,...extra});return id;};
 add('SyntheticDisk',null,'directory');const documents=add('文档资料',0,'directory');for(let i=0;i<125;i++)add(`资料文件-${String(i).padStart(3,'0')}.bin`,documents,'file',String(1000+i));const media=add('Media',0,'directory');add('movie.mp4',media,'file','1500000');add('空目录',0,'directory');add('alias.bin',0,'file','0',{logicalBytes:'1500000',duplicate:true});
 for(let i=0;i<80;i++)add(i===4?'<img src=x onerror=alert(1)>':`root-file-${i}.txt`,0,'file',String(1+i));
 for(let id=nodes.length-1;id>0;id--){const current=nodes[id],parent=nodes[current.parent];parent.bytes=String(BigInt(parent.bytes)+BigInt(current.bytes));parent.files+=current.files;parent.directories+=current.directories+(current.kind==='directory'?1:0);}
 return {nodes,summary:{root:nodes[0],files:nodes[0].files,directories:nodes[0].directories+1,entries:nodes.length-1,hardLinks:1,skipped:0,issueCount:0,issues:[],cancelled:false,partial:false,limitReason:null,elapsedMs:15}};
}
const dataset=params.has('real')?await(await fetch('/tmp/disk-space-native/native-report.json')).json():synthetic();
const state=window.diskSpaceTest={calls:[],listeners:new Set(),mode:'normal',choosePath:dataset.summary.root.path,failReveal:false,holdQuery:false,center:createTaskCenter({storage:localStorage}),data:dataset};
const clone=value=>structuredClone(value),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function makeView(jobId,nodeId=0,offset=0,limit=100){
 const data=state.cache;if(!data||data.jobId!==jobId)throw Error('disk:expired');const node=data.nodes.find(node=>node.id===nodeId);if(node?.kind!=='directory')throw Error('disk:node');const children=data.nodes.filter(child=>child.parent===nodeId).sort((a,b)=>BigInt(a.bytes)>BigInt(b.bytes)?-1:BigInt(a.bytes)<BigInt(b.bytes)?1:a.name.localeCompare(b.name));const breadcrumbs=[];let ancestor=node;while(ancestor){breadcrumbs.unshift(ancestor);ancestor=data.nodes.find(n=>n.id===ancestor.parent);}
 const positive=children.filter(child=>BigInt(child.bytes)>0n);return{jobId,node:clone(node),breadcrumbs:clone(breadcrumbs),items:clone(children.slice(offset,offset+limit)),total:children.length,offset,limit,tiles:clone(positive.slice(0,60)),otherBytes:String(positive.slice(60).reduce((sum,n)=>sum+BigInt(n.bytes),0n)),otherCount:Math.max(0,positive.length-60),zeroCount:children.length-positive.length};
}
state.controller=initDiskSpaceTool({overlay:document.getElementById('diskSpaceOverlay'),isTauri:!params.has('browser'),center:state.center,chooseDirectory:async()=>state.choosePath,refreshIcons:()=>createIcons({icons}),listenNative:async(_name,fn)=>{state.listeners.add(fn);let released=false;return()=>{if(released)throw Error('Event listener released twice');released=true;state.listeners.delete(fn);};},invokeNative:async(command,args)=>{
 state.calls.push({command,args});if(command==='open_path'){if(state.failReveal)throw Error('synthetic missing path');return;}
 if(command!=='disk_space')throw Error('Unexpected command '+command);const request=args.request,{action,jobId}=request;
 if(action==='start'){
  if(state.mode==='error')throw Error('disk:root');state.active=jobId;state.cancelled=false;
  const emit=(id,bytes)=>{for(const fn of state.listeners)fn({payload:{jobId:id,files:7,directories:2,entries:9,bytes,currentPath:state.choosePath,elapsedMs:1500}});};emit('unrelated-job','99999999999');emit(jobId,'7000');
  if(state.mode==='hold'||state.mode==='late')await new Promise(resolve=>{state.resolveRun=resolve;});
  const data=clone(state.data);data.jobId=jobId;data.summary.jobId=jobId;
  if(state.cancelled||state.mode==='partial'){data.summary.partial=true;data.summary.cancelled=state.cancelled;if(!state.cancelled){data.summary.skipped=1;data.summary.issueCount=1;data.summary.issues=[{path:state.choosePath+'\\denied',reason:'permission'}];}}
  state.cache=data;state.active=null;if(state.mode==='bad')return{jobId};return clone(data.summary);
 }
 if(action==='cancel'){if(state.cancelFailure)throw Error('synthetic cancel transport failure');state.cancelled=true;if(state.mode==='hold')state.resolveRun?.();return{accepted:state.active===jobId};}
 if(action==='release'){if(state.cache?.jobId===jobId)state.cache=null;if(state.active===jobId){state.cancelled=true;if(state.mode==='hold')state.resolveRun?.();}return{accepted:true};}
 if(action==='children'){if(state.failQuery)throw Error('disk:node');if(state.holdQuery)await new Promise(resolve=>state.resolveQuery=resolve);return makeView(jobId,request.nodeId,request.offset,request.limit);}
 throw Error('Unknown action '+action);
}});
state.lang=setLangWithoutFade;state.theme=mode=>applyTheme(document.documentElement,{mode});state.controller.open();if(params.has('sample'))await state.controller.scan(state.choosePath);
