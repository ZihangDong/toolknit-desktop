import { removeError } from './core.js';
export function createRemovalWorker(){let worker=null,sequence=0,pending=null,sourceKey=null;
 function dispose(error=removeError('cancelled')){const current=pending;pending=null;sourceKey=null;worker?.terminate();worker=null;if(current){current.cleanup();current.reject(error);}}
 function request(action,payload,operation,transfer=[]){
  operation.check();if(pending)throw removeError('busy');
  if(!worker){worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(!pending||data.id!==pending.id)return;if(data.progress){pending.progress?.(data.progress);return;}const current=pending;pending=null;current.cleanup();data.error?current.reject(new Error(data.error)):current.resolve(data.result);};worker.onerror=()=>dispose(removeError('worker'));}
  return new Promise((resolve,reject)=>{const id=++sequence,abort=()=>dispose(removeError('cancelled')),timer=setTimeout(()=>dispose(removeError('timeout')),120000);const cleanup=()=>{clearTimeout(timer);operation.abort.signal.removeEventListener('abort',abort);};pending={id,resolve,reject,cleanup,progress:operation.progress};operation.abort.signal.addEventListener('abort',abort,{once:true});try{worker.postMessage({id,action,...payload},transfer);}catch(error){dispose(error);}});
 }
 async function load(source,operation){sourceKey=null;const bytes=source.bytes.slice(),result=await request('load',{bytes},operation,[bytes.buffer]);operation.check();sourceKey=source.key;return result;}
 return{load,async build(source,ids,operation){if(sourceKey!==source.key)await load(source,operation);operation.check();return request('build',{ids},operation);},dispose};
}
