import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { word_to_pdf } from '../cli/lib/word-runtime.mjs';
import { createWordWatermark } from '../src/word-watermark-core.js';
import { resolveQpdf, runProcess } from '../cli/lib/pdf-runtime.mjs';

const run=promisify(execFile),base=path.resolve('tmp/word-encryption');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-')),checks=[],outputs=[];const password='本机临时密码😀-'+randomBytes(12).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=path.join(root,'中文 合同.docx'),short=path.join(root,'short.docx'),large=path.join(root,'201-pages.docx'),corrupt=path.join(root,'broken.docx');
await writeFile(source,await Packer.toBuffer(new Document({sections:[
  {children:[new Paragraph('BODY_1 中文正文'),new Paragraph({text:'BODY_2 中文正文',pageBreakBefore:true})]},
  {properties:{page:{size:{width:11906,height:16838,orientation:'landscape'}}},children:[new Paragraph('BODY_3 横向正文')]}
]})));
await writeFile(short,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('SHORT_BODY')]}]})));
await writeFile(large,await Packer.toBuffer(new Document({sections:[{children:Array.from({length:201},(_,i)=>new Paragraph({text:`PAGE_${i+1}`,pageBreakBefore:i>0}))}]})));
await writeFile(corrupt,'not a Word file');const sourceHash=digest(await readFile(source));
const cli=path.resolve('cli/toolknit.mjs');
async function cliCall(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'run','toolknit_word_to_pdf','--arguments-stdin','--json'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('CLI timed out'));},180000);
    child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});child.once('error',reject);
    child.once('close',code=>{clearTimeout(timer);try{assert.ok(!out.includes(password)&&!err.includes(password));assert.equal(code,0,'CLI process succeeds without diagnostics');assert.equal(err,'');resolve(JSON.parse(out).result);}catch(error){reject(error);}});
    child.stdin.end(JSON.stringify(args));
  });
}
const qpdf=await resolveQpdf();
async function inspectEncrypted(file,{name,selected=[],printing='low',copying=false}={}) {
  const info=await runProcess(qpdf,['--show-encryption',file]);assert.equal(info.code,0);const text=info.stdout.toString('utf8');
  assert.match(text,/R = 6/);assert.match(text,/stream encryption method: AESv3/);assert.ok(!text.includes(password));
  if(!copying)assert.match(text,/extract for any purpose: not allowed/);
  if(printing!=='full')assert.match(text,/print high resolution: not allowed/);
  if(printing==='none')assert.match(text,/print low resolution: not allowed/);
  assert.match(text,/extract for accessibility: allowed/);assert.match(text,/modify document assembly: not allowed/);
  assert.match(text,/modify forms: allowed/);assert.match(text,/modify annotations: allowed/);assert.match(text,/modify other: not allowed/);
  const prefix=['--password-mode=unicode','--password-file=-'];
  for(const credential of [undefined,'wrong-password']) {const input=credential===undefined?undefined:Buffer.from(credential+'\n');const result=await runProcess(qpdf,credential===undefined?['--check',file]:[...prefix,'--check',file],input);assert.notEqual(result.code,0);result.stdout.fill(0);result.stderr.fill(0);input?.fill(0);}
  const secret=Buffer.from(password+'\n'),decrypted=path.join(root,`${name}-decrypted.pdf`);
  try {const result=await runProcess(qpdf,[...prefix,'--decrypt',file,decrypted],secret);assert.equal(result.code,0);result.stdout.fill(0);result.stderr.fill(0);}finally{secret.fill(0);}
  await inspectPdf(decrypted,selected,name);outputs.push({name,encrypted:true,pages:3,watermarkPages:selected,sha256:digest(await readFile(file))});
}
const reference=[];
async function inspectPdf(file,selected,name,baseline=false) {
  const task=getDocument({data:new Uint8Array(await readFile(file)),standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts')+'/'});const pdf=await task.promise;assert.equal(pdf.numPages,3);
  try{for(let i=1;i<=3;i++){const page=await pdf.getPage(i),text=(await page.getTextContent()).items.map(x=>x.str).join(' ');assert.ok(text.includes(`BODY_${i}`)&&text.includes('正文'));
    const view=page.getViewport({scale:0.5}),canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
    const pixels=Buffer.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
    if(baseline)reference.push({view:page.view,pixels});else{assert.deepEqual(page.view,reference[i-1].view);assert.equal(!pixels.equals(reference[i-1].pixels),selected.includes(i),`${name}: pixels only change for watermark-selected pages`);assert.equal(text.includes('内部资料 DRAFT'),selected.includes(i));}
  }}finally{await task.destroy();}
}
const baseline=await cliCall({input_path:source,output_path:path.join(root,'baseline.pdf')});await inspectPdf(baseline.output_path,[],'baseline',true);
assert.equal(baseline.files[0].encrypted,undefined);checks.push('default-off CLI output remains a normal searchable PDF');
const permissions={printing:'lowResolution',copying:false,modifying:false,annotating:true,fillingForms:true,documentAssembly:false};
const watermark={text:'内部资料 DRAFT',pages:'1,3',opacity:0.25,width:65,angle:45};
const single=await cliCall({input_path:source,output_path:path.join(root,'single.pdf'),refresh_fields:true,watermark,encryption:{password,permissions}});
assert.equal(single.files[0].encrypted,true);assert.equal(single.files[0].field_update.enabled,true);assert.equal(single.files[0].watermark_pages,2);
await inspectEncrypted(single.output_path,{name:'cli-watermark',selected:[1,3]});checks.push('actual CLI stdin composes internal field refresh, text watermark and AES-256; correct password recovers exact body/paper geometry and selected-page changes');
const zip=path.join(root,'batch.zip'),archive=new JSZip();for(const [name,file] of [['合同/valid.docx',source],['too-long.docx',large],['broken.docx',corrupt]])archive.file(name,await readFile(file));await writeFile(zip,await archive.generateAsync({type:'nodebuffer'}));const zipHash=digest(await readFile(zip));
const batch=await cliCall({input_paths:[zip],output_dir:path.join(root,'zip-output'),encryption:{password,permissions}});assert.equal(batch.status,'partial');assert.equal(batch.outputs.length,1);assert.match(batch.files[1].error.message,/encryption-pages/);assert.equal(batch.files[2].status,'failed');assert.equal((await readdir(batch.output_dir)).filter(n=>n.endsWith('.pdf')).length,1);await inspectEncrypted(batch.outputs[0].output_path,{name:'cli-zip'});checks.push('ZIP partial batch publishes only encrypted successes; 201-page and damaged inputs expose no plain outputs');
const client=new Client({name:'word-encryption-local-qa',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[cli,'mcp','serve'],cwd:path.resolve('.'),stderr:'pipe'});
try{await client.connect(transport);const reply=await client.callTool({name:'toolknit_word_to_pdf',arguments:{input_path:source,output_path:path.join(root,'mcp.pdf'),encryption:{password,permissions:{...permissions,printing:false}}}},undefined,{timeout:180000});assert.equal(reply.isError,false);assert.ok(!JSON.stringify(reply).includes(password));assert.equal(reply.structuredContent.result.files[0].encrypted,true);await inspectEncrypted(reply.structuredContent.result.output_path,{name:'mcp',printing:'none'});}finally{await client.close();}
checks.push('actual MCP accepts encryption and no-print permissions without returning credentials');
const preserved=path.join(root,'preserved.pdf');await copyFile(baseline.output_path,preserved);const before=await readFile(preserved);
await assert.rejects(word_to_pdf({input_path:large,output_path:preserved,overwrite:true,encryption:{password,permissions}}),/encryption-pages/);assert.deepEqual(await readFile(preserved),before);
const previousEngine=process.env.TOOLKNIT_QPDF_PATH;process.env.TOOLKNIT_QPDF_PATH=process.execPath;
try{await assert.rejects(word_to_pdf({input_path:source,output_path:preserved,overwrite:true,encryption:{password,permissions}}),/encryption-failed/);assert.deepEqual(await readFile(preserved),before);}finally{if(previousEngine===undefined)delete process.env.TOOLKNIT_QPDF_PATH;else process.env.TOOLKNIT_QPDF_PATH=previousEngine;}
checks.push('page-limit and engine failures preserve an existing overwrite target and return stable secret-free errors');
const abort=new AbortController();const cancelled=await word_to_pdf({input_paths:[source,short],output_dir:path.join(root,'cancel-output'),encryption:{password,permissions}}, {signal:abort.signal,reportProgress:(_n,message)=>{if(message.startsWith('Saved Word file'))abort.abort();}});
assert.equal(cancelled.outputs.length,1);assert.equal(cancelled.files[1].status,'cancelled');await inspectEncrypted(cancelled.outputs[0].output_path,{name:'cancel-kept'});checks.push('cancellation after first publication keeps exactly that verified encrypted PDF');
const nativeRoot=await mkdtemp(path.join(os.tmpdir(),'toolknit-word-encryption-'));
try{
 const layer=await createWordWatermark(watermark,{fontBytes:new Uint8Array(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'))}),requests=path.join(root,'native-requests.json');
 await writeFile(requests,JSON.stringify([{inputs:[source,large,corrupt],permissions,refresh:true,watermark:{pdfBase64:Buffer.from(layer.bytes).toString('base64'),pages:'1,3'}},{inputs:[source,short],permissions,cancelAfterFirst:true}]));
 const native=await run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','word_encryption_real_runtime_qa','--lib','--','--ignored','--test-threads=1'],{env:{...process.env,TOOLKNIT_WORD_ENCRYPTION_REQUESTS:requests,TOOLKNIT_WORD_ENCRYPTION_OUTPUT:nativeRoot,TOOLKNIT_WORD_ENCRYPTION_PASSWORD:password},windowsHide:true,timeout:300000,maxBuffer:4*1024*1024});
 assert.ok(!(native.stdout+native.stderr).includes(password));await writeFile(path.join(root,'native-tests.log'),native.stdout+native.stderr);
 const reports=JSON.parse(await readFile(path.join(nativeRoot,'report.json'),'utf8'));assert.ok(!JSON.stringify(reports).includes(password));
 for(const [index,name] of ['rust-watermark','rust-cancel-kept'].entries()){const file=path.join(root,`${name}.pdf`);await copyFile(reports[index].result.files[0].outputPath,file);reports[index].result.files[0].outputPath=file;await inspectEncrypted(file,{name,selected:index===0?[1,3]:[]});}
 assert.equal(reports[1].result.cancelled,true);assert.equal(reports[1].result.files[1].status,'cancelled');await writeFile(path.join(root,'native-report.json'),JSON.stringify(reports,null,2));
 checks.push('real Rust/UNO/qpdf preserves encrypted-only publication, watermark/field composition, oversized failures and cancellation; progress/results omit passwords');
}finally{assert.ok(path.resolve(nativeRoot).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(nativeRoot).startsWith('toolknit-word-encryption-'));await rm(nativeRoot,{recursive:true,force:true});}
assert.equal(digest(await readFile(source)),sourceHash);assert.equal(digest(await readFile(zip)),zipHash);checks.push('original DOCX/ZIP hashes unchanged');
const report={root,checks,outputs,sourceUnchanged:true,zipUnchanged:true};await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await writeFile(path.join(base,'report.json'),JSON.stringify(report,null,2));
console.log(`Word encryption: ${checks.length} real acceptance groups, ${outputs.length} independently decrypted and inspected PDFs.`);
