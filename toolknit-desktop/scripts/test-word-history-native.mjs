import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createTaskCenter } from '../src/app/task-center.js';
import { createWordHistory, updateWordHistory } from '../src/app/word-conversion-history.js';

const run=promisify(execFile),base=path.resolve('tmp/word-history');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));
await writeFile(path.join(root,'.history-fixture'),'synthetic Word history QA');
const doc=marker=>Packer.toBuffer(new Document({sections:[{children:[new Paragraph(marker+' 中文正文'),new Paragraph({text:marker+' 第二页',pageBreakBefore:true})]}]}));
const a=await doc('ORIGINAL_A'),b=await doc('ORIGINAL_B'),changed=await doc('CHANGED_B');
for(const[name,bytes]of [['source-a.docx',a],['source-b.docx',b],['changed.docx',changed]])await writeFile(path.join(root,name),bytes);
for(const[name,bytes]of [['batch.zip',a],['changed.zip',changed]]){const zip=new JSZip();zip.file('合同/source.docx',bytes);await writeFile(path.join(root,name),await zip.generateAsync({type:'nodebuffer'}));}
const initialZipHash=createHash('sha256').update(await readFile(path.join(root,'batch.zip'))).digest('hex');
const output=await mkdtemp(path.join(os.tmpdir(),'toolknit-word-history-')),checks=[],outputs=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const native=await run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','word_history_real_runtime_qa','--lib','--','--ignored','--test-threads=1'],{env:{...process.env,TOOLKNIT_WORD_HISTORY_FIXTURE:root,TOOLKNIT_WORD_HISTORY_OUTPUT:output},windowsHide:true,timeout:300000,maxBuffer:4*1024*1024});
 await writeFile(path.join(root,'native-tests.log'),native.stdout+native.stderr);const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
 assert.equal(report.initial.files[0].sourceHash,sha(a));assert.equal(report.initial.files[1].sourceHash,sha(b));assert.equal(report.initial.files[2].sourceHash,sha(a));
 assert.ok(report.before.every(x=>x.sourceState==='available'&&x.outputState==='available'));checks.push('real DOCX/ZIP conversions report source and output SHA-256; unchanged history probes match all three inputs/results');
 assert.equal(report.changed[0].outputState,'missing');assert.equal(report.changed[0].sourceState,'available');assert.equal(report.changed[1].sourceState,'changed');assert.equal(report.changed[1].outputState,'available');assert.equal(report.changed[2].outputState,'changed');checks.push('read-only probe distinguishes a lost output, changed source and same-size altered PDF without deleting retained results');
 assert.equal(report.regenerated.files[0].status,'success');assert.notEqual(report.regenerated.files[0].outputPath,report.initial.files[0].outputPath);checks.push('missing output regenerates from its fingerprint-checked source into a new directory');
 assert.equal(report.rejected.files[0].error,'word-render:source-changed');assert.equal(report.raced.files[0].error,'word-render:source-changed');assert.equal(report.rejected.files[0].outputPath,null);assert.equal(report.raced.files[0].outputPath,null);checks.push('old source fingerprints and a change after probing are rejected before rendering/publication');
 assert.equal(report.accepted.files[0].sourceHash,sha(changed));assert.notEqual(report.accepted.files[0].outputPath,report.initial.files[1].outputPath);checks.push('explicitly accepting the current version creates a new result and preserves the previous PDF');
 assert.equal(report.missing[0].sourceState,'missing');assert.equal(report.missing[0].outputState,'available');assert.equal(report.zipChanged[0].sourceState,'changed');checks.push('moved source retains its existing PDF; modified ZIP remains blocked until re-added');
 const [archivePath,entryName]=JSON.parse(report.initial.files[2].inputPath.slice(4));const archiveInput={archivePath,entryName,archiveHash:initialZipHash};
 let recipe=createWordHistory({inputPaths:report.initial.files.map(x=>x.inputPath),archiveInputs:[archiveInput]});
 assert.ok(recipe);for(const result of report.initial.files)recipe=updateWordHistory(recipe,result);
 const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};const center=createTaskCenter({storage});center.begin({label:'Real Word history',tool:'word-to-pdf',recovery:recipe}).finish({outputs:report.initial.files.map(x=>x.outputPath)});
 const restored=createTaskCenter({storage}).list()[0];assert.equal(restored.canRecover,true);assert.equal(restored.canRetry,false);assert.equal(restored.recovery.files[1].sourceHash,sha(b));checks.push('real native results survive task storage/restart with fingerprints and no replay callbacks');
 const artifacts=path.join(root,'outputs');await mkdir(artifacts);
 for(const[name,row,marker]of [['initial-b',report.initial.files[1],'ORIGINAL_B'],['edited-zip-pdf',report.initial.files[2],'ORIGINAL_A'],['regenerated-a',report.regenerated.files[0],'ORIGINAL_A'],['accepted-b',report.accepted.files[0],'CHANGED_B']]){
   const target=path.join(artifacts,name+'.pdf');await copyFile(row.outputPath,target);const bytes=await readFile(target);if(name!=='edited-zip-pdf')assert.equal(sha(bytes),row.outputHash);
   const task=getDocument({data:new Uint8Array(bytes)});const pdf=await task.promise;try{assert.equal(pdf.numPages,2);const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');assert.ok(text.includes(marker)&&text.includes('中文'));}finally{await task.destroy();}
   await run('src-tauri/resources/qpdf/qpdf.exe',['--check',target],{windowsHide:true,timeout:15000});outputs.push({name,pages:2,sha256:sha(bytes),expectedText:marker});row.outputPath=target;
 }
 checks.push('four retained/regenerated PDFs reopen independently with the expected Chinese text and page counts; retained originals keep their hashes');
 await writeFile(path.join(root,'native-report.json'),JSON.stringify(report,null,2));const evidence={root,checks,outputs};await writeFile(path.join(root,'report.json'),JSON.stringify(evidence,null,2));await writeFile(path.join(base,'report.json'),JSON.stringify(evidence,null,2));console.log(`Word history: ${checks.length} real acceptance groups and ${outputs.length} independently inspected PDFs.`);
}finally{assert.ok(path.resolve(output).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(output).startsWith('toolknit-word-history-'));await rm(output,{recursive:true,force:true});}
