import { taskCenter } from './task-center.js';
import { tauriEventPromise } from '../platform/tauri-runtime.js';
export function createWorkbenchBackgroundRuntime({isTauri=false}={}){
  if(!isTauri)return;
  const jobs=new Map();let disposed=false;
  void tauriEventPromise.then(api=>api.listen('toolknit-folder-task',event=>{
    const data=event.payload;if(!data?.id)return;
    let job=jobs.get(data.id);
    if(!job){job=taskCenter.begin({label:data.label||'Folder automation',tool:'folder-automation'});jobs.set(data.id,job);}
    if(data.state==='succeeded'){job.finish({outputs:data.output?[data.output]:[]});jobs.delete(data.id);}
    else if(data.state==='failed'){job.fail(new Error(data.message));jobs.delete(data.id);}
    else if(data.state==='deferred'){job.fail(Object.assign(new Error(data.message),{code:'CANCELLED'}));jobs.delete(data.id);}
  })).then(unlisten=>{if(disposed)unlisten();else window.addEventListener('pagehide',()=>{disposed=true;unlisten();},{once:true});}).catch(error=>console.warn('Folder task history unavailable',error));
}
