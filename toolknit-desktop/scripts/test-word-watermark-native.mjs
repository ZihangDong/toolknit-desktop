import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph, Footer, TextRun, PageNumber } from 'docx';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { word_to_pdf } from '../cli/lib/word-runtime.mjs';
import { createWordWatermark } from '../src/word-watermark-core.js';

const run = promisify(execFile), base = path.resolve('tmp/word-watermark'); await mkdir(base,{recursive:true});
const root = await mkdtemp(path.join(base,'run-')), checks=[], outputs=[];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = path.join(root,'中文 合同.docx'), short = path.join(root,'short.docx');
const footer = new Footer({children:[new Paragraph({children:[new TextRun('FOOTER_'),new TextRun({children:[PageNumber.CURRENT]})]})]});
await writeFile(source,await Packer.toBuffer(new Document({ sections:[
  {properties:{page:{size:{width:11906,height:16838}}}, footers:{default:footer},children:[new Paragraph('BODY_1 中文正文'),new Paragraph({text:'BODY_2 中文正文',pageBreakBefore:true})]},
  {properties:{page:{size:{width:11906,height:16838,orientation:'landscape'}}},children:[new Paragraph('BODY_3 横向正文')]}
]})));
await writeFile(short,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('SHORT_BODY')]}]})));
const sourceHash=hash(await readFile(source));
const cli = path.resolve('cli/toolknit.mjs');
async function cliCall(name,args) { const argFile=path.join(root,`${name}.json`);await writeFile(argFile,JSON.stringify(args));const result=await run(process.execPath,[cli,'run','toolknit_word_to_pdf','--arguments-file',argFile,'--json'],{windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});assert.equal(result.stderr,'');return JSON.parse(result.stdout).result; }
const baseline=await cliCall('baseline',{input_path:source,output_path:path.join(root,'baseline.pdf')});
assert.equal(baseline.page_count,3); assert.equal(baseline.files[0].watermark_pages,undefined);
const reference = [];
async function inspect(file, selected, name, image=false, baselineRun=false) {
  const bytes=await readFile(file), task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts')+'/',useSystemFonts:true});
  const pdf=await task.promise; assert.equal(pdf.numPages,3);
  try { for(let i=1;i<=3;i++){
    const page=await pdf.getPage(i), text=(await page.getTextContent()).items.map(x=>x.str).join(' ');
    assert.ok(text.includes(`BODY_${i}`) && text.includes('正文'), `${name} preserves body ${i}`);
    const viewport=page.getViewport({scale:0.5}), canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    const pixels=Buffer.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
    if(baselineRun) { reference.push({pixels,view:page.view}); await writeFile(path.join(root,`baseline-${i}.png`),await canvas.encode('png')); }
    else { assert.deepEqual(page.view,reference[i-1].view,'paper geometry retained'); const changed=!pixels.equals(reference[i-1].pixels); assert.equal(changed,selected.includes(i),`${name}: exact page ${i} pixels`);
      if(!image) assert.equal(text.includes('内部资料 DRAFT'),selected.includes(i),`${name}: embedded CJK watermark`);
      await writeFile(path.join(root,`${name}-${i}.png`),await canvas.encode('png'));
    }
  }}finally{await task.destroy();}
  await run('src-tauri/resources/qpdf/qpdf.exe',['--check',file],{windowsHide:true,timeout:15000});
  outputs.push({name,pages:3,selected,sha256:hash(bytes)});
}
await inspect(baseline.output_path,[],'baseline',false,true); checks.push('default-off baseline is a searchable three-page mixed portrait/landscape PDF');
const textSettings={text:'内部资料 DRAFT',pages:'1,3',opacity:0.25,width:65,angle:45};
const text=await cliCall('text',{input_path:source,output_path:path.join(root,'text.pdf'),watermark:textSettings});
assert.equal(text.files[0].watermark_pages,2); await inspect(text.output_path,[1,3],'cli-text'); checks.push('actual CLI embeds CJK text, stamps only 1/3 and preserves all other page pixels and dimensions');
const png=path.resolve(base,'stamp.png'),jpg=path.resolve(base,'stamp.jpg');
const archive=new JSZip();archive.file('合同/valid.docx',await readFile(source));archive.file('short.docx',await readFile(short));
const zip=path.join(root,'batch.zip');await writeFile(zip,await archive.generateAsync({type:'nodebuffer'}));const zipHash=hash(await readFile(zip));
const batch=await cliCall('zip-image',{input_paths:[zip],output_dir:path.join(root,'zip-output'),watermark:{type:'image',image_path:png,pages:'3',angle:-45,opacity:0.4}});
assert.equal(batch.status,'partial');assert.equal(batch.files[1].status,'failed');assert.match(batch.files[1].error.message,/watermark-pages/);assert.equal((await readdir(batch.output_dir)).filter(x=>x.endsWith('.pdf')).length,1);
await inspect(batch.outputs[0].output_path,[3],'cli-zip-image',true);checks.push('ZIP image watermark retains successful output and fails short document without exposing its plain PDF');
const transport=new StdioClientTransport({command:process.execPath,args:[cli,'mcp','serve'],cwd:path.resolve('.'),stderr:'pipe'}),client=new Client({name:'watermark-local-qa',version:'1'});
try{await client.connect(transport);const response=await client.callTool({name:'toolknit_word_to_pdf',arguments:{input_path:source,output_path:path.join(root,'mcp.pdf'),refresh_fields:true,watermark:{type:'image',image_path:jpg,pages:'2',angle:0,opacity:0.5}}},undefined,{timeout:180000});assert.equal(response.isError,false);const result=response.structuredContent.result;assert.equal(result.files[0].watermark_pages,1);assert.equal(result.files[0].field_update.enabled,true);await inspect(result.output_path,[2],'mcp-jpeg',true);}finally{await client.close();}
checks.push('actual MCP schema accepts JPEG watermark alongside internal field refresh');
const preserved=path.join(root,'preserved.pdf'); await copyFile(baseline.output_path,preserved);
await assert.rejects(word_to_pdf({input_path:short,output_path:preserved,overwrite:true,watermark:textSettings}),/watermark-pages/);
assert.equal(hash(await readFile(preserved)),hash(await readFile(baseline.output_path)));checks.push('failed single-file stamping preserves an existing overwrite target');
const controller=new AbortController(); const cancelled=await word_to_pdf({input_paths:[source,short],output_dir:path.join(root,'cancel-output'),watermark:{...textSettings,pages:''}}, {signal:controller.signal,reportProgress:(_n,message)=>{if(message.startsWith('Saved Word file'))controller.abort();}});
assert.equal(cancelled.outputs.length,1);assert.equal(cancelled.files[1].status,'cancelled');await inspect(cancelled.outputs[0].output_path,[1,2,3],'cancelled-kept');checks.push('cancelling after first publication retains exactly that stamped PDF and reports remaining items cancelled');
const fontBytes=new Uint8Array(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'));
const layer=await createWordWatermark(textSettings,{fontBytes}), imageLayer=await createWordWatermark({type:'image',pages:'2',angle:-45,opacity:0.5},{imageBytes:new Uint8Array(await readFile(png))});
const nativeRoot=await mkdtemp(path.join(os.tmpdir(),'toolknit-watermark-native-'));const requests=path.join(root,'native-requests.json');
await writeFile(requests,JSON.stringify([{inputs:[source,short],watermark:{pdfBase64:Buffer.from(layer.bytes).toString('base64'),pages:'1,3'}},{inputs:[source],refresh:true,watermark:{pdfBase64:Buffer.from(imageLayer.bytes).toString('base64'),pages:'2'}}]));
const native=await run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','word_watermark_real_runtime_qa','--lib','--','--ignored','--test-threads=1'],{env:{...process.env,TOOLKNIT_WORD_WATERMARK_REQUESTS:requests,TOOLKNIT_WORD_WATERMARK_OUTPUT:nativeRoot},windowsHide:true,timeout:300000,maxBuffer:4*1024*1024});
await writeFile(path.join(root,'native-tests.log'),native.stdout+native.stderr);const nativeReport=JSON.parse(await readFile(path.join(nativeRoot,'report.json'),'utf8'));
for(const [index,name] of ['rust-text','rust-image'].entries()){const target=path.join(root,`${name}.pdf`);await copyFile(nativeReport[index].files[0].outputPath,target);nativeReport[index].files[0].outputPath=target;}
await writeFile(path.join(root,'native-report.json'),JSON.stringify(nativeReport,null,2));
await inspect(nativeReport[0].files[0].outputPath,[1,3],'rust-text');await inspect(nativeReport[1].files[0].outputPath,[2],'rust-image',true);
assert.match(nativeReport[0].files[1].error,/watermark-pages/);assert.equal(nativeReport[1].files[0].fieldUpdate.enabled,true);checks.push('actual Rust batch stamps text/image before publication, isolates page-range failures and composes with internal field refresh');
assert.equal(hash(await readFile(source)),sourceHash);assert.equal(hash(await readFile(zip)),zipHash); checks.push('source DOCX and ZIP hashes unchanged');
assert.ok(path.resolve(nativeRoot).startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(nativeRoot).startsWith('toolknit-watermark-native-'));
await rm(nativeRoot,{recursive:true,force:true});
const evidence={root,checks,outputs,sourceUnchanged:true,zipUnchanged:true};await writeFile(path.join(root,'report.json'),JSON.stringify(evidence,null,2));await writeFile(path.join(base,'report.json'),JSON.stringify(evidence,null,2));
console.log(`Word watermark: ${checks.length} real acceptance groups, ${outputs.length} independently inspected PDFs.`);
