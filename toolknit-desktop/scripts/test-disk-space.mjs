import assert from 'node:assert/strict';
import { diskBytes,formatDiskBytes,diskPercent,diskTreemap,validateDiskSummary,validateDiskView } from '../src/features/disk-space/core.js';
assert.equal(diskBytes('18446744073709551615'),18446744073709551615n);for(const value of [-1,1,'-1','1.1','NaN','18446744073709551616'])assert.throws(()=>diskBytes(value));
assert.equal(formatDiskBytes('0'),'0 B');assert.equal(formatDiskBytes('1024'),'1 KiB');assert.equal(formatDiskBytes('1536'),'1.5 KiB');assert.equal(formatDiskBytes('9007199254740993'),'8 PiB');assert.equal(diskPercent('1','10000'),'<0.1%');assert.equal(diskPercent('0','0'),'0%');
let seed=20261120;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let iteration=0;iteration<40;iteration++){
 const items=Array.from({length:1+Math.floor(random()*60)},(_,id)=>({id,bytes:String(1+Math.floor(random()*1e12))})),width=300+random()*1000,height=200+random()*500,tiles=diskTreemap(items,width,height),total=items.reduce((s,n)=>s+Number(n.bytes),0);
 assert.equal(tiles.length,items.length);let area=0;
 for(const tile of tiles){assert(tile.x>=-.001&&tile.y>=-.001&&tile.x+tile.width<=width+.001&&tile.y+tile.height<=height+.001);area+=tile.width*tile.height;assert(Math.abs(tile.width*tile.height/(width*height)-Number(tile.bytes)/total)<1e-10);}
 assert(Math.abs(area-width*height)<1e-5);
 for(let a=0;a<tiles.length;a++)for(let b=a+1;b<tiles.length;b++){const x=Math.min(tiles[a].x+tiles[a].width,tiles[b].x+tiles[b].width)-Math.max(tiles[a].x,tiles[b].x),y=Math.min(tiles[a].y+tiles[a].height,tiles[b].y+tiles[b].height)-Math.max(tiles[a].y,tiles[b].y);assert(x<1e-6||y<1e-6,'treemap tiles do not overlap');}
}
assert.deepEqual(diskTreemap([{bytes:'0'}],400,300),[]);assert.deepEqual(diskTreemap([{bytes:'1'}],0,300),[]);
const root={id:0,parent:null,name:'root',path:'C:/Synthetic',kind:'directory',bytes:'42',logicalBytes:'0'},child={...root,id:1,parent:0,name:'file',kind:'file'};
const summary={jobId:'one',root,files:1,directories:1,skipped:0,issues:[]};validateDiskSummary(summary,'one');assert.throws(()=>validateDiskSummary(summary,'other'));
const view={jobId:'one',node:root,items:[child],tiles:[child],total:1,offset:0,breadcrumbs:[root],otherBytes:'0'};validateDiskView(view,'one');assert.throws(()=>validateDiskView({...view,items:[{...child,parent:100}]},'one'));assert.throws(()=>validateDiskView({...view,items:Array(101).fill(child)},'one'));
console.log('Disk space core passed: exact 64-bit byte parsing, size/share formatting, 40 proportional non-overlapping treemaps and native response boundaries.');
