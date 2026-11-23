import { analyzeRemovalPdf,buildRemovalPdf } from './processor.js';
let analysis=null;
self.onmessage=async({data})=>{const {id,action}=data;try{
 const progress=value=>self.postMessage({id,progress:value});
 if(action==='load'){analysis=null;analysis=await analyzeRemovalPdf(data.bytes,{progress});self.postMessage({id,result:analysis.summary});}
 else if(action==='build'){if(!analysis)throw Error('pdf-remove:session');const bytes=await buildRemovalPdf(analysis,data.ids,{progress});self.postMessage({id,result:bytes},[bytes.buffer]);}
 else throw Error('pdf-remove:request');
}catch(error){self.postMessage({id,error:/pdf-remove:[a-z-]+/.exec(String(error))?.[0]||'pdf-remove:failed'});}};
