// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
// Pure invented source fixtures. Place/map this file at scripts/test-pdf-word-source-scalar-relation.mjs.
// No original PDF/TeX/manifest/reader artifacts, filesystem reads, or private loader dependency.
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {Document,Paragraph,Packer} from 'docx';
import JSZip from 'jszip';
import {xml2js} from 'xml-js';
import {sourceScalarRelationCandidates as discover,sourceScalarRelationRegion as proof,sourceScalarRelation as proveAst} from '../src/features/pdf-to-word/core/source-scalar-relation.js';
import {inferMathAst,validateMathAst,validateMathEvidence} from '../src/features/pdf-to-word/core/math.js';
import {nativeMathReaderMode as mode} from '../src/features/pdf-to-word/core/native-math-policy.js';
import {nativeMath} from '../src/features/pdf-to-word/adapters/docx-math.js';
import {createNativeMathMeasurer} from '../src/features/pdf-to-word/core/native-math-layout.js';
import {groupPageRegions} from '../src/features/pdf-to-word/core/regions.js';
import {positionedFrameCost,MAX_POSITIONED_FRAMES} from '../src/features/pdf-to-word/core/positioned-budget.js';
import {mathUnicodeRunStyle} from '../src/features/pdf-to-word/core/font-style.js';
import {union} from '../src/features/pdf-to-word/core/geometry.js';
import {positionedPage} from '../src/features/pdf-to-word/adapters/docx-positioned.js';
const context=createCanvas(1,1).getContext('2d'),checks=[],failures=[];
const test=(name,fn)=>{try{fn();checks.push(name);}catch(e){failures.push({name,error:e.stack});}};
const sym=g=>({type:'symbol',sourceId:g.id,text:g.text,italic:false,bold:false});

// Entirely invented source records. No source text, IDs, boxes or order from F13.
function fixture({base='𝜇',upper='3',relation='≤',rhs='7',em=16,dx=0,dy=0}={}){
 const x=45+dx,y=100+dy;
 const make=(id,text,rx,ry,w,h,size,baseline)=>({id,sourceIds:[id],text,font:'ABCDEF+XITSMath-Regular',color:'314253',size,baseline,
  baselineX:rx-em*.02,advanceWidth:w+em*.04,rect:{x:rx,y:ry,width:w,height:h},preciseInk:true,raster:false,bold:false,italic:false,
  glyphPositions:[{text,rect:{x:rx,y:ry,width:w,height:h}}]});
 const b=make('invented-base',base,x,y-em*.48,em*.5,em*.49,em,y);
 const u=make('invented-upper',upper,x+em*.59,y-em*.92,em*.32,em*.52,em*.75,y-em*.4);
 const op=make('invented-tail',relation,x+em*1.3,y-em*.68,em*.59,em*.82,em,y);
 const digit=make('temporary-digit',rhs,x+em*2.2,y-em*.69,em*.44,em*.69,em,y);
 const tail={...op,text:relation+' '+rhs,rect:union([op.rect,digit.rect]),advanceWidth:em*1.4,
  glyphPositions:[{text:relation,rect:op.rect},{text:rhs,rect:digit.rect}],
  mathGlyphPositions:[{text:relation,rect:op.rect,baseline:y,baselineX:op.baselineX,advanceWidth:em*.68,sourceOffset:0},
   {text:rhs,rect:digit.rect,baseline:y,baselineX:digit.baselineX,advanceWidth:em*.5,sourceOffset:2}]};
 const text=[b,u,tail],sources=text.map((g,i)=>({id:g.id,text:g.text,rect:{...g.rect},order:i+1,disposition:'editable'}));
 const expected={type:'row',children:[{type:'script',base:sym(b),superscript:sym(u)},
  {type:'symbol',sourceId:tail.id+':math-part:0',text:relation,italic:false,bold:false},
  {type:'symbol',sourceId:tail.id+':math-part:2',text:rhs,italic:false,bold:false}]};
 return {text,sources,expected};
}
function evidence(f,groups=[]){
 const ps=discover(f.text,[],f.sources,groups);assert.equal(ps.length,1,'one complete unique proposal');const p=ps[0];
 return {id:'invented-whole',type:'image',role:'math',rect:union(f.text.map(g=>g.rect)),sourceIds:f.text.map(g=>g.id),
  mathGlyphs:p.glyphs,mathStrokes:[],drawingIds:[],reasons:[],sourceScalarRelation:p.proof};
}
const elements=x=>(x?.elements||[]).filter(n=>n.type==='element');
const all=(n,name)=>[...(n.name===name?[n]:[]),...elements(n).flatMap(x=>all(x,name))];
function canonical(n){
 if(n.name.endsWith('Pr'))return [];
 if(n.name==='m:r'){
  const cs=elements(n),rp=cs.find(x=>x.name==='m:rPr'),wp=cs.find(x=>x.name==='w:rPr');
  assert(cs.every(x=>['m:rPr','w:rPr','m:t'].includes(x.name)));
  const text=cs.filter(x=>x.name==='m:t').flatMap(x=>x.elements||[]).map(x=>x.text||'').join('');if(!text.trim())return [];
  const font=elements(wp).find(x=>x.name==='w:rFonts')?.attributes?.['w:ascii'];assert.equal(font,'Cambria Math');
  const style=elements(rp).find(x=>x.name==='m:sty')?.attributes?.['m:val'];
  const italic=/[\u{1d400}-\u{1d7ff}]/u.test(text);
  if(italic){assert.equal(style,'i');assert(!elements(rp).some(x=>x.name==='m:nor'));}
  else assert(elements(rp).some(x=>x.name==='m:nor'));
  return [...text].map(c=>['atom',c,italic?'italic':'upright']);
 }
 if(['m:oMath','m:e','m:sup'].includes(n.name))return elements(n).flatMap(canonical);
 if(n.name==='m:sSup'){
  assert(elements(n).every(x=>['m:sSupPr','m:e','m:sup'].includes(x.name)));
  const role=name=>{const a=elements(n).filter(x=>x.name===name);assert.equal(a.length,1);return canonical(a[0]);};
  return [['superscript',role('m:e'),role('m:sup')]];
 }
 throw Error('Unknown OMML node '+n.name);
}
for(const base of ['𝜇','𝑥','𝜎'])for(const em of [10,16,21]){
 const f=fixture({base,em,dx:em/7,dy:em/9});let r,math;
 test('invented complete source/AST '+base+' '+em,()=>{r=evidence(f);assert.deepEqual(inferMathAst(r),f.expected);assert(validateMathAst(f.expected,r));assert(validateMathEvidence(f.expected,r));assert(proveAst(f.expected,r));assert.equal(mode(f.expected,r),'source-scalar-relation');});
 if(!r)continue;
 test('invented measured writer '+base+' '+em,()=>{const before=structuredClone(r);math=nativeMath(f.expected,r,{measurementContext:context});assert.deepEqual(r,before);
  assert.equal(math.sourceLayout.scalarRelationAttachments.length,1);assert(Number.isFinite(math.sourceLayout.measured.width));});
 if(!math)continue;
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[math]})]}]}));
 const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'),doc=xml2js(xml);
 test('invented independent XML semantics '+base+' '+em,()=>{assert.equal(all(doc,'m:oMath').length,1);assert.equal(all(doc,'m:sSup').length,1);assert.equal(all(doc,'m:sSub').length,0);
  assert.deepEqual(canonical(all(doc,'m:oMath')[0]),[['superscript',[['atom',base,'italic']],[['atom','3','upright']]],['atom','≤','upright'],['atom','7','upright']]);assert.equal(all(doc,'w:drawing').length,0);});
}
const f=fixture(),r=evidence(f);
for(const relation of ['=','≠','≥'])test('invented alternate complete relation '+relation,()=>{const x=fixture({base:'𝜈',upper:'4',rhs:'9',relation});const r=evidence(x);assert.deepEqual(inferMathAst(r),x.expected);assert(proveAst(x.expected,r));});
for(const [name,mutate]of [
 ['unsupported Greek',f=>f.text[0].text='𝛾'],['normalized source',f=>f.text[0].text='μ'],['missing upper',f=>f.text.splice(1,1)],
 ['compound exponent',f=>f.text[1].text='-1'],['same baseline',f=>f.text[1].baseline=f.text[0].baseline],['lower script',f=>f.text[1].baseline+=14],
 ['wrong em',f=>f.text[1].size=f.text[0].size],['split tail absent',f=>delete f.text[2].mathGlyphPositions],['null tail trace',f=>f.text[2].mathGlyphPositions[0]=null],
 ['wrong UTF16 offset',f=>f.text[2].mathGlyphPositions[1].sourceOffset=1],['partial tail trace',f=>f.text[2].mathGlyphPositions.pop()],
 ['extra RHS',f=>f.text[2].text+='8'],['tail digit changed',f=>f.text[2].mathGlyphPositions[1].text='8'],['null glyph trace',f=>f.text[0].glyphPositions[0]=null],
 ['clipped base',f=>f.text[0].clipped=true],['raster upper',f=>f.text[1].raster=true],['italic flag',f=>f.text[0].italic=true],
 ['mixed font subset',f=>f.text[2].font='UVWXYZ+XITSMath-Regular'],['mixed color',f=>f.text[1].color='000000'],
 ['source ledger mismatch',f=>f.sources[0].text='other'],['missing ledger',f=>f.sources.pop()],['duplicate ledger',f=>f.sources.push({...f.sources[0]})],
 ['wrong disposition',f=>f.sources[2].disposition='hidden'],['encoding repair',f=>f.sources[0].encodingCorrections=[{}]],
 ['duplicate run',f=>f.text.push(structuredClone(f.text[0]))],['nonfinite baseline',f=>f.text[1].baseline=NaN],
 ])test('reject invented raw '+name,()=>{const x=structuredClone(f);mutate(x);assert.equal(discover(x.text,[],x.sources,[]).length,0);});
for(const label of ['competing base','extra mathematical tail','accent','drawing','prose overlap'])test('reject invented ambiguity '+label,()=>{
 const x=structuredClone(f),extra=structuredClone(x.text[0]);extra.id='competing';extra.sourceIds=[extra.id];
 extra.text=label==='extra mathematical tail'?'+':label==='accent'?'̄':label==='prose overlap'?'文':extra.text;
 extra.rect={...x.text[0].rect,x:x.text[0].rect.x+(label==='extra mathematical tail'?x.text[0].size*2.7:0)};
 if(label==='prose overlap')extra.font='SimSun';extra.glyphPositions=[{text:extra.text,rect:{...extra.rect}}];
 const graphics=label==='drawing'?[{id:'line',rect:{...extra.rect}}]:[];
 assert.equal(discover([...x.text,...(label==='drawing'?[]:[extra])],graphics,[...x.sources,{id:extra.id,text:extra.text,rect:extra.rect,disposition:'editable'}],[]).length,0);
});
test('adjacent ordinary-font mathematical continuation rejects',()=>{const x=fixture(),g={...structuredClone(x.text[0]),id:'ordinary-continuation',text:'x',font:'TimesNewRomanPSMT',rect:{x:x.text[2].rect.x+x.text[2].rect.width+1,y:x.text[0].rect.y,width:4,height:7}};assert.equal(discover([...x.text,g],[],x.sources,[]).length,0);});
test('complete preexisting ownership wins',()=>assert.equal(discover(f.text,[],f.sources,[f.text]).length,0));
test('partial preexisting ownership wins',()=>assert.equal(discover(f.text,[],f.sources,[[f.text[0]]]).length,0));
test('only complete old tail singleton is replaced',()=>assert.equal(discover(f.text,[],f.sources,[[f.text[2]]]).length,1));
test('bounded candidates reject over limit',()=>assert.deepEqual(discover(Array(20001).fill(f.text[0]),[],f.sources,[]),[]));
test('global Greek gate unchanged',()=>{assert.equal(mathUnicodeRunStyle('𝜎'),null);assert.equal(mathUnicodeRunStyle('𝜇'),null);});
for(const [name,mutate]of [
 ['boolean proof',r=>r.sourceScalarRelation=true],['null member',r=>r.sourceScalarRelation.members[0]=null],['null proof item',r=>r.sourceScalarRelation.members[0].item=null],
 ['missing proof member',r=>r.sourceScalarRelation.members.pop()],['null base glyph',r=>r.sourceScalarRelation.members[0].item.glyphPositions[0]=null],
 ['nonfinite proof geometry',r=>r.sourceScalarRelation.members[1].item.baseline=NaN],['duplicate source ID',r=>r.sourceIds[1]=r.sourceIds[0]],
 ['wrong union crop',r=>r.rect.width-=1],['extra glyph',r=>r.mathGlyphs.push({...r.mathGlyphs[0]})],['missing glyph',r=>r.mathGlyphs.pop()],
 ['changed source spelling',r=>r.sourceScalarRelation.members[2].source.text='= 9'],['wrong glyph text',r=>r.mathGlyphs[0].text='𝜈'],
 ['wrong glyph split',r=>r.mathGlyphs[3].sourceRange=[1,2]],['extra vector',r=>r.mathStrokes.push({id:'line'})],['OCR evidence',r=>r.rasterMathEvidence={}],
 ['glyph origin changed',r=>r.mathGlyphs[0].baselineX+=1],['glyph advance changed',r=>r.mathGlyphs[2].advanceWidth+=1],
 ['singleton collision',r=>r.sourceNativeUnicodeScalar=true],['index collision',r=>r.sourceFirstLevelIndex=true],
 ])test('reject invalid optional whole proof '+name,()=>{const a=structuredClone(r);mutate(a);assert.equal(proof(a),null);assert.equal(mode(f.expected,a),null);assert.throws(()=>nativeMath(f.expected,a,{measurementContext:context}));});
for(const [name,mutate]of [
 ['swapped roles',a=>[a.children[0].base,a.children[0].superscript]=[a.children[0].superscript,a.children[0].base]],
 ['lower role',a=>{a.children[0].subscript=a.children[0].superscript;delete a.children[0].superscript;}],
 ['power on RHS Mill class',a=>[a.children[0],a.children[2]]=[a.children[2],a.children[0]]],
 ['incomplete AST',a=>a.children.pop()],['duplicate AST source',a=>a.children[2]=structuredClone(a.children[1])],
 ])test('reject semantic roles '+name,()=>{const ast=structuredClone(f.expected);mutate(ast);assert.equal(proveAst(ast,r),null);assert.equal(mode(ast,r),null);assert.throws(()=>nativeMath(ast,r,{measurementContext:context}));});
test('measurement required',()=>assert.throws(()=>nativeMath(f.expected,r)));
test('missing-font measurement fails closed',()=>assert.throws(()=>nativeMath(f.expected,r,{measurementContext:{measureText:()=>({width:999,actualBoundingBoxLeft:0,actualBoundingBoxRight:0,actualBoundingBoxAscent:0,actualBoundingBoxDescent:0})}})));
test('measurer rejects proof boolean',()=>assert.throws(()=>createNativeMathMeasurer(()=>({}),{sourceScalarRelationRegion:true})));
test('one honest frame, same cap',()=>{assert.equal(positionedFrameCost([r]),1);assert.equal(MAX_POSITIONED_FRAMES,512);assert.equal(positionedFrameCost(Array(513).fill(r)),513);});
test('positioned writer refuses 513 actual native frames',()=>{assert.throws(()=>positionedPage({width:600,height:800,header:[],blocks:Array(513).fill(r),footer:[],risks:[]},{},
 {empty:()=>new Paragraph({}),mathFor:()=>({sourceLayout:null})}),e=>e.code==='layout-quality');});


// Optional source proofs are exclusive, regardless of property insertion order.
for(const other of [null,false,{}, {version:1,members:structuredClone(r.sourceScalarRelation.members.slice(0,2))}])for(const order of ['upper-first','scalar-first']) {
 test('reject upper+scalar source proof collision '+order+' '+JSON.stringify(other).slice(0,40),()=>{
  const x=order==='upper-first'?{sourceUpperAttachment:other,...structuredClone(r)}:{...structuredClone(r),sourceUpperAttachment:other};
  assert.equal(proof(x),null);assert.equal(mode(f.expected,x),null);
  assert.throws(()=>nativeMath(f.expected,x,{measurementContext:context}));
  assert.throws(()=>createNativeMathMeasurer(()=>({}),{sourceScalarRelationRegion:x}));
 });
}
test('reject upper-shaped region carrying both optional proofs',()=>{
 const x=structuredClone(r);x.mathGlyphs=x.mathGlyphs.slice(0,2);x.sourceIds=x.sourceIds.slice(0,2);
 x.sourceUpperAttachment={version:1,members:x.sourceScalarRelation.members.slice(0,2)};
 const ast={type:'script',base:sym(x.mathGlyphs[0]),superscript:sym(x.mathGlyphs[1])};
 assert.equal(mode(ast,x),null);assert.throws(()=>nativeMath(ast,x,{measurementContext:context}));
});
console.log(JSON.stringify({scope:'Portable invented-source scalar relation contracts only; no reader certificate.',passed:checks.length,failed:failures.length,failures}));
assert.equal(failures.length,0,'All scalar-source/AST/measurement/Writer/budget/proof-collision contracts must pass');
