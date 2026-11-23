import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { normalizeWordEncryption } from '../src/word-encryption-core.js';
import { applyWordEncryption } from '../cli/lib/word-encryption.mjs';
import { resolveQpdf, runProcess } from '../cli/lib/pdf-runtime.mjs';
import { createTrackedInvoke } from '../src/platform/tracked-invoke.js';
import { createTaskCenter } from '../src/app/task-center.js';

const root=path.resolve('tmp/word-encryption');await mkdir(root,{recursive:true});const checks=[];
const password='临时密码QA-😀-123456789';
for(const value of [{password:'short'},{password:'01234567\n'},{password:'01234567\0'},{password:'01234567\uD800'},{password:'字'.repeat(43)},
  {password,permissions:{printing:'yes'}},{password,permissions:{copying:'false'}},{password,permissions:{contentAccessibility:false}},
  {password,permissions:{unknown:true}},{password,unknown:true}]) assert.throws(()=>normalizeWordEncryption(value),/word-render:encryption-/);
assert.equal(normalizeWordEncryption({password:'😀'.repeat(8)}).password.length,16);
assert.equal(normalizeWordEncryption({password:'a'.repeat(127)}).password.length,127);
checks.push('Unicode character/UTF-8 byte limits, control characters, strict permission types and unsupported accessibility restriction');
const encryption=normalizeWordEncryption({password,permissions:{printing:'lowResolution',copying:false,modifying:false,annotating:true,fillingForms:true,documentAssembly:false}});
const source=path.join(root,'temporary.pdf');const doc=await PDFDocument.create();doc.addPage([600,800]).drawText('BODY_ENCRYPTION');doc.addPage([800,600]);await writeFile(source,await doc.save());const original=await readFile(source);
await applyWordEncryption(source,encryption,{});const encrypted=await readFile(source);assert.notDeepEqual(encrypted,original);
const command=await resolveQpdf();
const info=await runProcess(command,['--show-encryption',source]);const description=info.stdout.toString('utf8');assert.match(description,/R = 6/);assert.match(description,/AESv3/);assert.match(description,/extract for any purpose: not allowed/);assert.match(description,/print high resolution: not allowed/);assert.ok(!description.includes(password));
checks.push('real qpdf output is AES-256 R6 with requested low-resolution print and no-copy restrictions');
assert.match(description,/extract for accessibility: allowed/);assert.match(description,/modify document assembly: not allowed/);assert.match(description,/modify forms: allowed/);assert.match(description,/modify annotations: allowed/);assert.match(description,/modify other: not allowed/);
const prefix=['--password-mode=unicode','--password-file=-'];const correct=Buffer.from(password+'\n');
const good=await runProcess(command,[...prefix,'--check',source],correct);assert.equal(good.code,0);good.stdout.fill(0);good.stderr.fill(0);
const bad=await runProcess(command,[...prefix,'--check',source],Buffer.from('wrong-password\n'));assert.notEqual(bad.code,0);
const absent=await runProcess(command,['--check',source]);assert.notEqual(absent.code,0);
checks.push('correct Unicode password opens the file; missing and wrong passwords fail');
const recovered=path.join(root,'decrypted.pdf');assert.equal((await runProcess(command,[...prefix,'--decrypt',source,recovered],correct)).code,0);correct.fill(0);
assert.equal((await PDFDocument.load(await readFile(recovered))).getPageCount(),2);checks.push('decryption preserves page count and paper sizes');
const tooLong=await PDFDocument.create();for(let i=0;i<201;i++)tooLong.addPage([100,100]);const large=path.join(root,'too-many-pages.pdf');await writeFile(large,await tooLong.save());const before=await readFile(large);
await assert.rejects(applyWordEncryption(large,encryption,{}),/encryption-pages/);assert.deepEqual(await readFile(large),before);
const abort=new AbortController();abort.abort();await assert.rejects(applyWordEncryption(large,encryption,{signal:abort.signal}));assert.deepEqual(await readFile(large),before);
assert.ok(!(await readdir(root)).some(name=>name.endsWith('.encrypted.pdf')));checks.push('page-limit failure and cancellation leave no encrypted partial and do not replace a temporary source');
let persisted='';const center=createTaskCenter({storage:{getItem:()=>null,setItem:(_key,value)=>{persisted=value;}}});
const tracked=createTrackedInvoke({center,listen:async()=>()=>{},invoke:async()=>{throw new Error(`private engine diagnostic ${password}`);}});
const args={jobId:'secret-qa',encryption:{password}};await assert.rejects(tracked('convert_word_to_pdf',args),/word-render:encryption-failed/);
assert.equal(args.encryption.password,'');assert.equal(center.list()[0].canRetry,false);assert.ok(!JSON.stringify(center.list()).includes(password));assert.ok(persisted.length>0 && !persisted.includes(password));
checks.push('tracked native failures clear secret references, omit automatic retry and never persist raw engine diagnostics');
const partial = createTrackedInvoke({
  center, listen: async () => () => {},
  invoke: async () => ({ files: [
    { status: 'success', outputPath: 'published.pdf' },
    { status: 'failed', error: 'word-render:invalid-document' },
    { status: 'failed', error: `word-render:private-diagnostic ${password}` },
  ] }),
});
const partialArgs = { jobId: 'secret-partial', encryption: { password } };
await partial('convert_word_to_pdf', partialArgs);
const partialTask = center.list()[0];
assert.equal(partialTask.message, 'word-render:invalid-document\nword-render:encryption-failed');
assert.deepEqual(partialTask.outputs, ['published.pdf']);
assert.equal(partialArgs.encryption.password, '');
assert.ok(!persisted.includes(password) && !persisted.includes('private-diagnostic'));
checks.push('protected partial failures retain known failure codes and successful outputs without persisting private diagnostics');
const queueCenter=createTaskCenter();let release;const queued=createTrackedInvoke({center:queueCenter,listen:async()=>()=>{},invoke:async command=> command==='convert_image_batch'?new Promise(resolve=>{release=resolve;}):{files:[]}});
const first=queued('convert_image_batch',{});await new Promise(resolve=>setImmediate(resolve));const queueArgs={jobId:'queued-secret',encryption:{password}};const second=queued('convert_word_to_pdf',queueArgs).catch(error=>error);await new Promise(resolve=>setImmediate(resolve));await queueCenter.cancel(queueCenter.list().find(row=>row.tool==='word-to-pdf').id);assert.equal(queueArgs.encryption.password,'');release({success_count:1});await first;assert.equal((await second).code,'CANCELLED');
checks.push('cancelling queued encryption clears its password before an earlier task finishes');
const report={passed:true,checks};await writeFile(path.join(root,'core-report.json'),JSON.stringify(report,null,2));console.log(`Word encryption: ${checks.length} groups passed.`);
