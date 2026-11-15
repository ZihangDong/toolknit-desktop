import assert from 'node:assert/strict';
import { createConversionDeadline } from '../src/features/pdf-to-word/deadline.js';
let now=0,sequence=0,expired=0;const timers=new Map();
const deadline=createConversionDeadline({baseMs:600000,clock:()=>now,schedule:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),onTimeout:()=>expired++});
now=10000;const resume=deadline.pause();assert.equal(timers.size,0);now+=300000;resume();resume();assert.equal([...timers.values()][0].ms,590000,'dependency/user time is excluded');
deadline.addOcrPage();assert.equal([...timers.values()][0].ms,635000);
for(let i=0;i<200;i++)deadline.addOcrPage();assert.equal([...timers.values()][0].ms,3590000,'budget remains bounded to sixty minutes minus consumed CPU time');
const release=deadline.pause();deadline.dispose();release();assert.equal(timers.size,0,'late setup completion never revives a disposed operation');assert.equal(expired,0);
console.log('Word conversion deadline: setup suspension, OCR budget, global bound and disposal passed.');
