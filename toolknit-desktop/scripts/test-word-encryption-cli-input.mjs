import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { dispatchCatalogCli } from '../cli/lib/catalog-cli.mjs';

const directory=path.resolve('tmp/word-encryption');await mkdir(directory,{recursive:true});
// A public dummy value checks rejected input transports; no real test credential is persisted.
const secret='PUBLIC_DUMMY_FOR_REJECTION',request={input_path:'C:/nonexistent.docx',output_path:'C:/nonexistent.pdf',encryption:{password:secret}};
let executed=0;const run=async(_name,_options,callback)=>{executed++;return callback({});};
await assert.rejects(dispatchCatalogCli(['run','toolknit_word_to_pdf','--encryption',JSON.stringify(request.encryption)],{run}),error=>/arguments-stdin/.test(error.message)&&!error.message.includes(secret));
const file=path.join(directory,'reject-nested-password.json');await writeFile(file,JSON.stringify(request));
try{await assert.rejects(dispatchCatalogCli(['run','toolknit_word_to_pdf','--arguments-file',file],{run}),error=>/arguments-stdin/.test(error.message)&&!error.message.includes(secret));}finally{await rm(file,{force:true});}
assert.equal(executed,2);
await writeFile(file,JSON.stringify({input_path:request.input_path,output_path:request.output_path,max_tokens:100}));
try{await assert.rejects(dispatchCatalogCli(['run','toolknit_word_to_pdf','--arguments-file',file],{run}),error=>error.code==='INVALID_ARGUMENT'&&!/arguments-stdin/.test(error.message));}finally{await rm(file,{force:true});}
console.log('Word encryption CLI: nested secrets are rejected from command arguments and JSON files with secret-free errors.');
