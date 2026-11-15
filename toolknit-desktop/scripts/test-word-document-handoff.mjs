import assert from 'node:assert/strict';
import { openWordDocumentSession } from '../src/app/word-document-handoff.js';
const factory=()=>({}),load=async()=>({createWordDocumentEditor:factory});
for(const kind of ['accepted','declined','missing','load-error','stale']){
  let releases=0,restores=0,received=0;
  const session={canTransfer:()=>kind!=='stale',release(){releases++;},restore(){restores++;return kind==='declined';}};
  const open=async()=>kind==='missing'?null:{raw:{openDocumentSession(value,create){received++;assert.equal(value,session);assert.equal(create,factory);return kind!=='declined';}}};
  const action=openWordDocumentSession(session,open,kind==='load-error'?async()=>{throw Error('fixture');}:load);
  if(['declined','missing','load-error'].includes(kind))await assert.rejects(action);else await action;
  assert.equal(releases,['missing','load-error','stale'].includes(kind)?1:0,kind);
  assert.equal(restores,['declined','missing','load-error'].includes(kind)?1:0,kind);
  assert.equal(received,['accepted','declined'].includes(kind)?1:0,kind);
}
console.log('Word handoff: accepted ownership, target veto, failed load, missing editor and stale source cleanup passed.');
