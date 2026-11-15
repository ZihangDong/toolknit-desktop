// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createCanvas} from '@napi-rs/canvas';
import {Document,Paragraph,Packer} from 'docx';
import JSZip from 'jszip';
import {xml2js} from 'xml-js';
import {sourceIndexedSumCandidates as discover,sourceIndexedSumRegion as proveRegion,sourceIndexedSum as proveAst} from '../src/features/pdf-to-word/core/source-indexed-sum.js';
import {inferMathAst,validateMathEvidence,validateMathAst} from '../src/features/pdf-to-word/core/math.js';
import {nativeMathReaderMode as mode} from '../src/features/pdf-to-word/core/native-math-policy.js';
import {nativeMath} from '../src/features/pdf-to-word/adapters/docx-math.js';
import {createNativeMathMeasurer} from '../src/features/pdf-to-word/core/native-math-layout.js';
import {union} from '../src/features/pdf-to-word/core/geometry.js';
import {MAX_POSITIONED_FRAMES,positionedFrameCost} from '../src/features/pdf-to-word/core/positioned-budget.js';
import {calibrateNativeTypography} from '../src/features/pdf-to-word/adapters/native-typography.js';
import {sceneLayoutBytes} from '../src/features/pdf-to-word/core/scene-budget.js';
const context=createCanvas(1,1).getContext('2d'),passed=[],failures=[];
function test(name,fn){try{fn();passed.push(name);}catch(error){failures.push({name,error:error.stack});}}
const sym=g=>({type:'symbol',sourceId:g.id,text:g.text,italic:false,bold:false});
// Independently invented: ratios, identifiers, colors, characters and translation.
// No original document coordinates, source files or observations are loaded.
function fixture({em=16,dx=0,dy=0,base='𝑁',index='𝑚',lower='𝑘',numerator='3',digit='2'}={}){
 const x=61+dx,y=123+dy;
 const make=(id,text,rx,ry,w,h,size=em,baseline=y)=>({id,sourceIds:[id],text,font:'ABCDEF+XITSMath-Regular',size,baseline,baselineX:rx,advanceWidth:w+em*.025,
  rect:{x:rx,y:ry,width:w,height:h},color:'243546',preciseInk:true,raster:false,bold:false,italic:false,glyphPositions:[{text,rect:{x:rx,y:ry,width:w,height:h}}]});
 const a=make('test-overbar','\u0304',x+em*.35,y-em*.8,em*.32,em*.054,em,y-em*.2);a.advanceWidth=0;
 const b=make('test-base',base,x,y-em*.65,em*.78,em*.65);
 const l=make('test-index',index,x+em*.82,y-em*.05,em*.4,em*.45,em*.7,y+em*.3);
 const e=make('test-relation','=',x+em*1.65,y-em*.65,em*.59,em*.8);
 const lineStart=x+em*2.6,axis=y-em*.25,sw=em*.04;
 const d={id:'test-rule',rect:{x:lineStart-sw/2,y:axis-sw/2,width:em*.5+sw,height:sw},thin:true,strokeColor:b.color,strokeWidth:sw,opaque:true,
  path:{complete:true,paint:'stroke',color:b.color,from:[lineStart,axis],to:[lineStart+em*.5,axis]}};
 const p=make('test-numerator',numerator,lineStart+em*.09,y-em*.92,em*.3,em*.5,em*.7,y-em*.42);
 const q=make('test-denominator',index,lineStart+em*.08,y+em*.05,em*.33,em*.45,em*.7,y+em*.5);
 const o=make('test-operator','∑',x+em*3.6,y-em*.8,em*.75,em*1.1);
 const u=make('test-upper',index,x+em*4.37,y-em*.95,em*.34,em*.45,em*.7,y-em*.5);
 const ks=[make('temp-i',lower,x+em*4.37,y+em*.1,em*.25,em*.45,em*.7,y+em*.55),
  make('temp-plus','+',x+em*4.65,y+em*.1,em*.48,em*.45,em*.7,y+em*.55),
  make('temp-number',digit,x+em*5.16,y+em*.1,em*.25,em*.45,em*.7,y+em*.55)];
 const k={...ks[0],id:'test-lower',sourceIds:['test-lower'],text:lower+'+'+digit,rect:union(ks.map(g=>g.rect)),advanceWidth:em*1.04,
  glyphPositions:ks.map(g=>({text:g.text,rect:g.rect})),mathGlyphPositions:ks.map((g,i)=>({text:g.text,rect:g.rect,baseline:g.baseline,baselineX:g.baselineX,advanceWidth:i===2?em*.25:em*.28+(i===1?em*.23:0),sourceOffset:[0,2,3][i]}))};
 const c=make('test-body',base,x+em*5.63,y-em*.65,em*.78,em*.65);
 const r=make('test-body-index',lower,x+em*6.48,y-em*.05,em*.35,em*.5,em*.7,y+em*.3);
 const text=[a,b,l,e,p,q,o,u,k,c,r],sources=text.map((g,i)=>({id:g.id,text:g.text,rect:{...g.rect},order:i+1,disposition:'editable'}));
 const parts=ks.map((g,i)=>sym({...g,id:k.id+':math-part:'+([0,2,3][i])}));
 const expected={type:'row',children:[{type:'script',base:{type:'accent',sourceId:a.id,text:a.text,base:sym(b)},subscript:sym(l)},sym(e),
  {type:'fraction',strokeId:d.id,numerator:sym(p),denominator:sym(q)},
  {type:'nary',operator:sym(o),lower:{type:'row',children:parts},upper:sym(u),body:{type:'script',base:sym(c),subscript:sym(r)}}]};
 return{text,sources,graphics:[d],expected};
}
function evidence(f){const ps=discover(f.text,f.graphics,f.sources,[]);assert.equal(ps.length,1,'one complete source candidate');return ps[0].region;}
const elements=n=>(n?.elements||[]).filter(c=>c.type==='element');
const all=(n,name)=>[...(n.name===name?[n]:[]),...elements(n).flatMap(c=>all(c,name))];
function role(n){
 if(n.name.endsWith('Pr'))return [];
 const direct=name=>{const xs=elements(n).filter(x=>x.name===name);assert.equal(xs.length,1,name);return role(xs[0]);};
 if(n.name==='m:r')return all(n,'m:t').flatMap(t=>[...(t.elements||[]).map(c=>c.text||'').join('')]).filter(c=>c.trim()).map(c=>['atom',c]);
 if(n.name==='m:acc')return [['accent',all(n,'m:chr')[0].attributes['m:val'],direct('m:e')]];
 if(n.name==='m:sSub')return [['subscript',direct('m:e'),direct('m:sub')]];
 if(n.name==='m:sSubSup')return [['subsup',direct('m:e'),direct('m:sub'),direct('m:sup')]];
 if(n.name==='m:f')return [['fraction',direct('m:num'),direct('m:den')]];
 if(['m:oMath','m:e','m:sub','m:sup','m:num','m:den','m:phant','m:box'].includes(n.name))return elements(n).flatMap(role);
 throw Error('Unexpected OMML '+n.name);
}
for(const em of [12,16,20])for(const base of ['𝑁','𝑃']){
 const f=fixture({em,base,dx:em*.11,dy:em*.17});let r,math;
 test('invented source/AST '+base+em,()=>{r=evidence(f);assert.deepEqual(inferMathAst(r),f.expected);assert(proveRegion(r));assert(proveAst(f.expected,r));assert(validateMathEvidence(f.expected,r));assert(validateMathAst(f.expected,r));assert.equal(mode(f.expected,r),'source-indexed-sum');});
 if(!r)continue;
 test('measured source writer '+base+em,()=>{const before=structuredClone(r);math=nativeMath(f.expected,r,{measurementContext:context});assert.deepEqual(r,before);assert(Number.isFinite(math.sourceLayout.measured.width));});
 if(!math)continue;
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[math]})]}]}));
 const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'),doc=xml2js(xml);
 test('complete independent XML roles '+base+em,()=>{const math=all(doc,'m:oMath');assert.equal(math.length,1);assert.deepEqual(role(math[0]),[
  ['subscript',[['accent','\u0304',[['atom',base]]]],[['atom','𝑚']]],['atom','='],['fraction',[['atom','3']],[['atom','𝑚']]],
  ['subsup',[['atom','∑']],[['atom','𝑘'],['atom','+'],['atom','2']],[['atom','𝑚']]],['subscript',[['atom',base]],[['atom','𝑘']]]]);assert.equal(all(doc,'w:drawing').length,0);assert.equal(all(doc,'m:phant').length,3);});
}
const f=fixture(),r=evidence(f);
for(const [name,mutate]of [
 ['missing overbar',f=>f.text.shift()],['missing source',f=>f.sources.pop()],['duplicate source',f=>f.sources.push(structuredClone(f.sources[1]))],
 ['missing rule',f=>f.graphics=[]],['diagonal rule',f=>f.graphics[0].path.to[1]+=1],['transparent rule',f=>f.graphics[0].opaque=false],
 ['wrong source font',f=>f.text[0].font='Cambria Math'],['mixed subset font',f=>f.text[1].font='UVWXYZ+XITSMath-Regular'],
 ['missing lower trace',f=>delete f.text[8].mathGlyphPositions],['bad UTF16 offset',f=>f.text[8].mathGlyphPositions[1].sourceOffset=1],
 ['partially hidden lower',f=>f.sources[8].disposition='hidden'],['wrong lower trace',f=>f.text[8].glyphPositions[1].text='='],
 ['missing numerator',f=>f.text.splice(4,1)],['wrong denominator',f=>f.text[5].text='𝑡'],['baseline conflict',f=>f.text[1].baseline+=10],
 ['source mismatch',f=>f.sources[2].text='other'],['encoding uncertainty',f=>f.sources[3].encodingCorrections=[{}]],['raster source',f=>f.text[0].raster=true],
 ['nonfinite geometry',f=>f.text[2].baseline=NaN],['nonzero accent advance',f=>f.text[0].advanceWidth=1],['duplicate glyph ID',f=>f.text[2].id=f.text[1].id],
 ['null lower trace',f=>f.text[8].mathGlyphPositions[1]=null],['null glyph trace',f=>f.text[0].glyphPositions[0]=null],
 ])test('reject raw '+name,()=>{const x=structuredClone(f);mutate(x);assert.deepEqual(discover(x.text,x.graphics,x.sources,[]),[]);});
test('complete ownership may replace old full group',()=>assert.equal(discover(f.text,f.graphics,f.sources,[f.text]).length,1));
test('partial cross-group ownership rejects',()=>assert.equal(discover(f.text,f.graphics,f.sources,[[f.text[0],{id:'outsider'}]]).length,0));
test('raw items cap',()=>assert.deepEqual(discover(Array(20001).fill(f.text[0]),f.graphics,f.sources,[]),[]));
test('one frame and unchanged cap',()=>{assert.equal(positionedFrameCost([r]),1);assert.equal(MAX_POSITIONED_FRAMES,512);});
for(const [name,mutate]of [
 ['boolean proof',r=>r.sourceIndexedSum=true],['null proof member',r=>r.sourceIndexedSum.members[1]=null],['null proof glyph',r=>r.sourceIndexedSum.members[0].item=null],
 ['wrong union',r=>r.rect.width+=1],['duplicate source',r=>r.sourceIds[1]=r.sourceIds[0]],['missing source',r=>r.sourceIds.pop()],
 ['extra glyph',r=>r.mathGlyphs.push(structuredClone(r.mathGlyphs[0]))],['altered split',r=>r.mathGlyphs[8].sourceRange=[0,1]],
 ['null math stroke',r=>r.mathStrokes[0]=null],['nonfinite source',r=>r.sourceIndexedSum.members[0].item.baseline=NaN],
 ['raster proof collision',r=>r.rasterMathEvidence={}],['scalar relation collision',r=>r.sourceScalarRelation={}],['index collision',r=>r.sourceFirstLevelIndex={}],
 ])test('reject whole proof '+name,()=>{const a=structuredClone(r);mutate(a);assert.equal(proveRegion(a),null);assert.equal(mode(f.expected,a),null);assert.throws(()=>nativeMath(f.expected,a,{measurementContext:context}));});
for(const [name,mutate]of [
 ['wrong fraction roles',a=>[a.children[2].numerator,a.children[2].denominator]=[a.children[2].denominator,a.children[2].numerator]],
 ['wrong accent base',a=>{a.children[0].base={...a.children[0].base,base:a.children[0].subscript};}],
 ['correcting original plus to equals',a=>a.children[3].lower.children[1].text='='],['missing lower',a=>delete a.children[3].lower],
 ['cycle',a=>a.children.push(a)],['missing body',a=>delete a.children[3].body],['duplicate glyph',a=>a.children[3].upper=a.children[3].body.subscript],
 ])test('reject AST '+name,()=>{const a=structuredClone(f.expected);mutate(a);assert.equal(proveAst(a,r),null);assert.equal(mode(a,r),null);assert.throws(()=>nativeMath(a,r,{measurementContext:context}));});
test('requires physical font metrics',()=>assert.throws(()=>nativeMath(f.expected,r)));
test('reject fallback metrics',()=>assert.throws(()=>nativeMath(f.expected,r,{measurementContext:{measureText:()=>({width:99,actualBoundingBoxLeft:0,actualBoundingBoxRight:0,actualBoundingBoxAscent:0,actualBoundingBoxDescent:0})}})));
test('reject boolean measurer proof',()=>assert.throws(()=>createNativeMathMeasurer(()=>({}),{sourceIndexedSumRegion:true})));
test('complete math proof consumes additional working allowance',()=>{
 const bare=structuredClone(r);delete bare.sourceIndexedSum;
 const amount=sceneLayoutBytes({items:[r]})-sceneLayoutBytes({items:[bare]});
 assert.equal(amount,12*4096);assert(amount>JSON.stringify(r.sourceIndexedSum).length*2);
});
test('multiple complete proofs are additive',()=>{
 const bare=structuredClone(r);delete bare.sourceIndexedSum;
 const amount=sceneLayoutBytes({items:Array(3).fill(r)})-sceneLayoutBytes({items:Array(3).fill(bare)});
 assert.equal(amount,3*12*4096);
});
test('table/column/paragraph traversal charges each proof once',()=>{
 const scene={items:[{type:'columns',columns:[{blocks:[{type:'table',cells:[{blocks:[{lines:[{items:[r]}]}]}]}]}]}]};
 const bare=structuredClone(scene);delete bare.items[0].columns[0].blocks[0].cells[0].blocks[0].lines[0].items[0].sourceIndexedSum;
 assert.equal(sceneLayoutBytes(scene)-sceneLayoutBytes(bare),12*4096);
});
test('scalar source records share the same conservative allowance',()=>assert.equal(sceneLayoutBytes({items:[{sourceScalarRelation:{members:Array(3).fill({})}}]}),4*4096));
for(const value of [null,false,true,{}, {members:null},{members:'not an array'}])test('malformed proof still has a fixed overhead '+JSON.stringify(value),()=>assert.equal(sceneLayoutBytes({items:[{sourceIndexedSum:value}]}),4096));
test('conflicting optional proofs charge independently',()=>assert.equal(sceneLayoutBytes({items:[{sourceIndexedSum:{members:Array(11).fill({})},sourceScalarRelation:{members:Array(3).fill({})}}]}),16*4096));
test('source proof overhead retains the existing working ceiling',()=>{
 const other=sceneLayoutBytes({items:[{words:[{text:'unchanged'}]}]});assert.equal(other,512+2048);
 const many=sceneLayoutBytes({items:Array(12000).fill({sourceIndexedSum:{members:Array(11).fill({})}})});assert(many>512*1024*1024);
});
test('actual worker rejects proof metadata beyond the working ceiling',()=>{
 const workerUrl=new URL('../src/features/pdf-to-word/worker.js',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';
 const replies=[];globalThis.self=globalThis;self.postMessage=value=>replies.push(value);
 await import(${JSON.stringify(workerUrl)});
 await self.onmessage({data:{id:1,type:'page',scene:{items:[{sourceIndexedSum:{members:Array(11).fill({})}}],sources:[],characters:0},assets:[]}});
 assert.deepEqual(replies.shift(),{id:1,result:true});
 await self.onmessage({data:{id:2,type:'page',scene:{items:Array(12000).fill({sourceIndexedSum:{members:Array(11).fill({})}}),sources:[],characters:0},assets:[]}});
 assert.deepEqual(replies.shift(),{id:2,error:'complexity'});assert.equal(replies.length,0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr||child.error?.message);
});
const runMetrics=format=>{
 context.font=`${format.italic?'italic ':''}${format.bold?'bold ':''}1000px "${format.font}"`;context.fontKerning='none';
 const m=context.measureText(format.text),s=format.size/1000;
 return{width:Math.max(0,m.width*s*format.scale/100+[...format.text].length*format.spacing),height:m.actualBoundingBoxAscent*s,depth:m.actualBoundingBoxDescent*s};
};
const measuredMath=nativeMath(f.expected,r,{measurementContext:context});
const raw=measuredMath.prepForXml({stack:[]})['m:oMath'];
const findRaw=(o,key)=>{
 if(!o||typeof o!=='object')return null;
 if(Object.hasOwn(o,key))return o[key];
 for(const v of Object.values(o)){const found=findRaw(v,key);if(found!==null)return found;}
 return null;
};
test('visible wrapper requires complete source proof',()=>assert.throws(()=>createNativeMathMeasurer(runMetrics)(raw,16)));
test('visible source wrapper measures positively',()=>assert(createNativeMathMeasurer(runMetrics,{sourceIndexedSumRegion:r})(raw,16).width>0));
for(const [name,mutate]of [
 ['hidden ink',p=>p[0]['m:show']._attr['m:val']='0'],['nonzero width',p=>p[1]['m:zeroWid']._attr['m:val']='0'],
 ['zero ascent',p=>p.push({'m:zeroAsc':{_attr:{'m:val':'1'}}})],['zero descent',p=>p.push({'m:zeroDesc':{_attr:{'m:val':'1'}}})],
 ['transparency',p=>p.push({'m:transp':{_attr:{'m:val':'1'}}})],['duplicate show',p=>p.push(structuredClone(p[0]))],
 ['unknown property',p=>p.push({'m:unknown':{_attr:{'m:val':'1'}}})],
 ])test('reject source wrapper '+name,()=>{const x=structuredClone(raw),p=findRaw(x,'m:phantPr');assert(p);mutate(p);assert.throws(()=>createNativeMathMeasurer(runMetrics,{sourceIndexedSumRegion:r})(x,16));});
test('font calibration donor survives whole-formula recovery without crossing Unicode math/ASCII faces',()=>{
 const singleton={...structuredClone(f.text[10]),id:'outside-single',type:'text',text:'𝑥',glyphPositions:[{text:'𝑥',rect:{x:20,y:20,width:5,height:12}}]};
 const ascii={...structuredClone(singleton),id:'outside-ascii',text:')',glyphPositions:[{text:')',rect:{x:40,y:20,width:5,height:12}}]};
 const scene={width:200,height:200,items:[structuredClone(r),singleton,ascii]},calls=[];
 const fit=({line,fontHint})=>{calls.push(line.text);return{font:fontHint?.font||'Times New Roman',fontFamily:fontHint?.font||'Times New Roman',bold:false,ocrFontScore:.95};};
 const proof=structuredClone(scene.items[0].sourceIndexedSum);
 calibrateNativeTypography(scene,new Uint8ClampedArray(200*200*4),200,200,fit);
 assert.deepEqual(calls,['𝑘+2']);assert.equal(singleton.font,'Cambria Math');assert.equal(ascii.font,'ABCDEF+XITSMath-Regular');assert.deepEqual(scene.items[0].sourceIndexedSum,proof);
});
test('invalid formula proof cannot create font calibration donor',()=>{
 const a=structuredClone(r);a.sourceIndexedSum.members[8].source.text='different';
 const singleton={...structuredClone(f.text[10]),id:'outside-single',type:'text'};let calls=0;
 calibrateNativeTypography({width:200,height:200,items:[a,singleton]},new Uint8ClampedArray(200*200*4),200,200,()=>{calls++;return{font:'Arial',ocrFontScore:1};});
 assert.equal(calls,0);assert.equal(singleton.font,'ABCDEF+XITSMath-Regular');
});
console.log(JSON.stringify({suite:'independent-indexed-sum',passed:passed.length,failed:failures.length,failures},null,2));
assert.equal(failures.length,0);
