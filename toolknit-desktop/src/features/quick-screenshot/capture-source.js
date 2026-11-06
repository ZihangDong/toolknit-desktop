const MAX_BYTES=32*1024*1024;
export async function loadCaptureSource({source,data,runtime,scope,isCurrent=()=>true}) {
  const current=()=>!scope.disposed&&isCurrent();
  let url, released=false;
  const release=()=>{if(released)return;released=true;if(url)URL.revokeObjectURL(url);};
  scope.use(release);
  try {
    if(data.image) source.src=data.image;
    else {
      const bytes=await runtime.image(data.session);
      if(!current())throw new Error('screenshot:expired');
      const buffer=bytes instanceof ArrayBuffer?new Uint8Array(bytes):ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):null;
      if(!buffer || buffer.byteLength<8 || buffer.byteLength>MAX_BYTES || ![137,80,78,71,13,10,26,10].every((value,index)=>buffer[index]===value))throw new Error('screenshot:invalid-image');
      url=URL.createObjectURL(new Blob([buffer],{type:'image/png'}));source.src=url;
    }
    await source.decode();
    if(!current())throw new Error('screenshot:expired');
    if(source.naturalWidth!==data.desktop.bounds.width || source.naturalHeight!==data.desktop.bounds.height)throw new Error('screenshot:invalid-image');
  } catch(error) { source.removeAttribute('src');throw error; }
  finally { release(); }
}
