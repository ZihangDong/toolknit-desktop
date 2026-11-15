import assert from 'node:assert/strict';
import { createThumbnails } from '../src/features/file-search/thumbnails.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAALSURBVAiZY2AAAgAABQABYlUyiAAAAABJRU5ErkJggg==';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const item=id=>({row:{id:String(id),size:1,modified:1},mark:{dataset:{}},picture:{src:'fallback',isConnected:true,complete:true,naturalWidth:1},fallback:'fallback'});
let calls=[],pending=[];
const previews=createThumbnails({runtime:{call:async(action,payload)=>{assert.equal(action,'thumbnail');calls.push(payload);return new Promise(resolve=>pending.push(resolve));}}});
const initial=[item(1),item(2),item(3),item(4)];previews.update(initial,'one');await tick();
assert.equal(calls.length,2,'only two visible preview requests run concurrently');
const newest=[item(9),item(10)];previews.update(newest,'two');await tick();
assert.equal(calls.length,4,'a new query releases the old front-end waits without awaiting stale IPC');
pending[0]({image:png});pending[1]({image:png});await tick();
assert.equal(initial[0].picture.src,'fallback','late image cannot mutate old or newer rows');
pending[2]({image:png});pending[3]({image:png});await tick();
assert.equal(newest[0].mark.dataset.thumbnail,'ready');assert.equal(newest[0].picture.src,png);
previews.update(newest,'two');await tick();assert.equal(calls.length,4,'unchanged rows use the bounded cache');
const rebound=[item(9)];previews.update(rebound,'two');await tick();
assert.equal(rebound[0].picture.src,png,'recreated virtual rows reuse the small decoded preview');
previews.dispose();previews.dispose();

let cachedCalls=0;
const cache=createThumbnails({cacheLimit:2,runtime:{call:async()=>{cachedCalls++;return {image:png};}}});
cache.update([item(1),item(2),item(3)],'cache');for(let i=0;i<5;i++)await tick();
cache.update([item(1)],'cache');await tick();assert.equal(cachedCalls,4,'old thumbnails are evicted instead of retaining an unbounded image cache');cache.dispose();

let failures=0;
const retry=createThumbnails({runtime:{call:async()=>{if(failures++===0)throw Error('file-search:busy');return {image:png};}}});
const retried=item(1);retry.update([retried],'retry');await new Promise(resolve=>setTimeout(resolve,130));
assert.equal(retried.picture.src,png,'a previous window finishing its worker does not leave permanent icon fallbacks');retry.dispose();

const slow=createThumbnails({timeout:15,runtime:{call:()=>new Promise(()=>{})}});const timed=item(1);
slow.update([timed],'slow');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(timed.mark.dataset.thumbnail,'unavailable');slow.dispose();
const invalid=createThumbnails({runtime:{call:async()=>({image:'https://example.invalid/private-image'})}});const bad=item(1);
invalid.update([bad],'unsafe');await tick();assert.equal(bad.picture.src,'fallback','thumbnail IPC cannot inject a remote image URL');invalid.dispose();
console.log('File search thumbnails: bounded work/cache, cancellation, stale replies, virtual rows, retry, timeout and local PNG-only payloads passed.');

let refreshCalls = 0;
const warm = createThumbnails({runtime:{call:async()=>{refreshCalls++; return {image:png};}}});
warm.update([item(1)],'ticket-a','same-query');await tick();
warm.update([item(1)],'ticket-b','same-query');await tick();
assert.equal(refreshCalls,1,'same-query refresh preserves successful previews across new leases');warm.dispose();
let slowBusy = 0;
const patient = createThumbnails({runtime:{call:async()=>{if(slowBusy++<3)throw Error('file-search:busy');return {image:png};}}});
const patientRow=item(2);patient.update([patientRow],'patient');await new Promise(resolve=>setTimeout(resolve,850));
assert.equal(patientRow.picture.src,png,'brief native worker contention is not permanently cached as failure');patient.dispose();
let unavailable = 0;
const negatives=createThumbnails({runtime:{call:async()=>{unavailable++;return unavailable===1?null:{image:png};}}});
negatives.update([item(3)],'first','query');await tick();
const newlyAvailable=item(3);negatives.update([newlyAvailable],'second','query');await tick();
assert.equal(newlyAvailable.picture.src,png,'refresh retries previously unavailable files while keeping good previews');negatives.dispose();

const loadingCache=createThumbnails({runtime:{call:async()=>({image:png})}});
const loadingImage=item(12);loadingImage.picture.complete=false;loadingImage.picture.naturalWidth=0;
loadingCache.update([loadingImage],'old-lease','same');await tick();
loadingCache.update([loadingImage],'new-lease','same');await tick();
assert.equal(typeof loadingImage.picture.onload,'function','changing a lease restores the pending image load handler even when src is unchanged');
loadingImage.picture.onload();assert.equal(loadingImage.mark.dataset.thumbnail,'ready');loadingCache.dispose();

let identityCalls=0;
const identities=createThumbnails({runtime:{call:async()=>{identityCalls++;return {image:png};}}});
const beforeScope=item(6);beforeScope.row.parent='C:/one';identities.update([beforeScope],'one','query');await tick();
const afterScope=item(6);afterScope.row.parent='D:/different';identities.update([afterScope],'two','query');await tick();
assert.equal(identityCalls,2,'reused IDs after index changes cannot borrow another path thumbnail');identities.dispose();
