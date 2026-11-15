const MAX_BYTES=32*1024*1024;
const WARMUP_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAALSURBVAiZY2AAAgAABQABYlUyiAAAAABJRU5ErkJggg==';
export async function prewarmCaptureSource({signal,createImage=()=>new Image()}={}) {
  const image=createImage();
  try { image.src=WARMUP_PNG;await waitForCaptureStage(image.decode(),{signal,timeoutMs:1500}); }
  finally { image.removeAttribute('src'); }
}
// A cancelled/failed decode or IPC request must not block the next capture's boot queue.
export function waitForCaptureStage(value,{signal,timeoutMs=8000}={}) {
  return new Promise((resolve,reject)=>{
    let done=false,timer;
    const finish=(run,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);run(result);};
    const cancel=()=>finish(reject,new Error('screenshot:expired'));
    Promise.resolve(value).then(result=>finish(resolve,result),error=>finish(reject,error));
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>finish(reject,new Error('screenshot:window-failed')),timeoutMs);
  });
}
export async function loadCaptureSource({source,data,runtime,scope,isCurrent=()=>true,signal}) {
  const current=()=>!scope.disposed&&isCurrent();
  const owner=scope.abortController();
  if(signal?.aborted)owner.abort();
  else if(signal)scope.event(signal,'abort',()=>owner.abort(),{once:true});
  const wait=value=>waitForCaptureStage(value,{signal:owner.signal});
  let url, ownedSource, released=false;
  const release=()=>{if(released)return;released=true;if(url)URL.revokeObjectURL(url);};
  scope.use(release);
  try {
    if(!current()||owner.signal.aborted)throw new Error('screenshot:expired');
    if(data.image) source.src=ownedSource=data.image;
    else {
      const bytes=await wait(runtime.image(data.session));
      if(!current())throw new Error('screenshot:expired');
      const buffer=bytes instanceof ArrayBuffer?new Uint8Array(bytes):ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):null;
      if(!buffer || buffer.byteLength<8 || buffer.byteLength>MAX_BYTES || ![137,80,78,71,13,10,26,10].every((value,index)=>buffer[index]===value))throw new Error('screenshot:invalid-image');
      url=URL.createObjectURL(new Blob([buffer],{type:'image/png'}));source.src=ownedSource=url;
    }
    await wait(source.decode());
    if(!current())throw new Error('screenshot:expired');
    if(source.naturalWidth!==data.desktop.bounds.width || source.naturalHeight!==data.desktop.bounds.height)throw new Error('screenshot:invalid-image');
  } catch(error) { if(source.src===ownedSource)source.removeAttribute('src');throw error; }
  finally { release(); }
}
