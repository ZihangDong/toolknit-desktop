import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCaptureSource } from '../src/features/quick-screenshot/capture-source.js';
import { createLifecycleScope } from '../src/app/tool-lifecycle.js';

const png=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
const data={session:7,desktop:{bounds:{width:100,height:80}}};
const original={create:URL.createObjectURL,revoke:URL.revokeObjectURL};
let created=0,revoked=0;
URL.createObjectURL=()=>{created++;return 'blob:synthetic-only';};
URL.revokeObjectURL=()=>{revoked++;};
const source=()=>({naturalWidth:100,naturalHeight:80,src:'',decode:async()=>{},removeAttribute(){this.src='';}});
try {
  const scope=createLifecycleScope(), image=source();
  await loadCaptureSource({source:image,data,runtime:{image:async id=>{assert.equal(id,7);return png.buffer;}},scope});
  assert.equal(created,1);assert.equal(revoked,1);scope.dispose();assert.equal(revoked,1);
  let current=true,resolve;
  const late=source(),lateScope=createLifecycleScope();
  const pending=loadCaptureSource({source:late,data,runtime:{image:()=>new Promise(done=>resolve=done)},scope:lateScope,isCurrent:()=>current});
  current=false;lateScope.dispose();resolve(png.buffer);
  await assert.rejects(pending,/expired/);assert.equal(late.src,'');assert.equal(created,1);
  const ownerOnly=createLifecycleScope();let resolveOwner;
  const stopped=loadCaptureSource({source:source(),data,runtime:{image:()=>new Promise(done=>resolveOwner=done)},scope:ownerOnly});
  ownerOnly.dispose();resolveOwner(png.buffer);await assert.rejects(stopped,/expired/);assert.equal(created,1);
  for(const invalid of [[],new Uint8Array([137,80,78,71,0,0,0,0]),new Uint8Array(33*1024*1024)]) {
    const owner=createLifecycleScope();
    await assert.rejects(loadCaptureSource({source:source(),data,runtime:{image:async()=>invalid},scope:owner}),/invalid-image/);owner.dispose();
  }
  const damaged=source();damaged.decode=async()=>{throw new Error('decode');};
  const damagedScope=createLifecycleScope();
  await assert.rejects(loadCaptureSource({source:damaged,data,runtime:{image:async()=>png},scope:damagedScope}),/decode/);
  damagedScope.dispose();assert.equal(created,2);assert.equal(revoked,2);assert.equal(damaged.src,'');
  const mismatch=source();mismatch.naturalWidth=101;
  const wrongScope=createLifecycleScope();
  await assert.rejects(loadCaptureSource({source:mismatch,data,runtime:{image:async()=>png},scope:wrongScope}),/invalid-image/);wrongScope.dispose();
  const legacyScope=createLifecycleScope();
  await loadCaptureSource({source:source(),data:{...data,image:'data:image/png;base64,fixture'},runtime:{image(){throw Error('legacy should not fetch');}},scope:legacyScope});legacyScope.dispose();
} finally {URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;}
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
assert.match(read('src-tauri/src/native_runtime/quick_screenshot/mod.rs'),/window\.label\(\) != CAPTURE_LABEL/);
assert.match(read('src-tauri/src/native_runtime/quick_screenshot/mod.rs'),/quick_screenshot_image[\s\S]*spawn_blocking[\s\S]*require_session/);
assert.match(read('src/features/quick-screenshot/capture-editor.js'),/afterReady\(\)/);
assert.doesNotMatch(read('src/features/quick-screenshot/capture-editor.js').split('function currentPoint')[0],/await localTranslation/);
console.log('Screenshot startup passed: binary validation, legacy support, stale sessions, decode failures and URL release.');
