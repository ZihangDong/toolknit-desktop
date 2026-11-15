import assert from 'node:assert/strict';
import { createFileSearchContextRuntime } from '../src/app/file-search-context-runtime.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const view = new EventTarget(), motion = new EventTarget();
motion.matches = false; view.matchMedia = () => motion;
let observer, disconnected = 0, onLanguage, lang = 'zh', navigated = 0, unlistened = 0;
view.MutationObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() { disconnected++; } };
const root = { documentElement: { dataset: { theme:'light' } } };
const calls = [], pending = []; let onNavigate;
const runtime = {
  call: (action, payload) => { calls.push({action,payload}); return new Promise((resolve,reject) => pending.push({resolve,reject})); },
  onPanelEvent: async (_name, callback) => { onNavigate = callback; return () => unlistened++; }
};
const context = createFileSearchContextRuntime({ isTauri:true, runtime, root, windowRef:view, getLang:()=>lang,
  onLangChange:callback=>{ onLanguage=callback; return ()=>{ onLanguage=null; }; }, onNavigate:()=>{navigated++;}, translate:key=>key });
assert.equal(calls.length,1);
for(let i=0;i<100;i++)observer();
assert.equal(calls.length,1,'only one in-flight context write');
pending[0].resolve();await tick();assert.equal(calls.length,1,'same context never emits duplicate writes');
root.documentElement.dataset.theme='dark';observer();
lang='en';onLanguage(); motion.matches=true;motion.dispatchEvent(new Event('change'));
assert.equal(calls.length,2,'later context waits for the first write');
pending[1].resolve();await tick();
assert.equal(calls.length,3);assert.deepEqual(calls[2].payload,{lang:'en',theme:'dark',reducedMotion:true});
pending[2].reject(new Error('synthetic IPC failure'));await tick();
observer();assert.equal(calls.length,4,'failed context is retried on the next meaningful event');
pending[3].resolve();await tick();
onNavigate();await tick();assert.equal(navigated,1);
root.documentElement.dataset.theme='light';observer();lang='zh';onLanguage();
onNavigate();
context.dispose();pending[4].resolve();await tick();
assert.equal(calls.length,5,'dispose drops queued context');
assert.equal(disconnected,1);assert.equal(unlistened,1);assert.equal(onLanguage,null);
context.dispose();assert.equal(disconnected,1);
onNavigate();await tick();assert.equal(navigated,1,'queued and late navigation cannot resurrect a disposed context');
console.log('File search context: deduplicated metadata, latest-state serialization, retry and cleanup passed.');
