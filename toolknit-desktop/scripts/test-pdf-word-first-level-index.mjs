// Complete source-bound lower-index contracts.
// Pure synthetic source records; no PDF, TeX, original coordinates or case IDs.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Paragraph, Packer } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { sourceFirstLevelIndexCandidates, sourceFirstLevelIndexRegion, sourceFirstLevelIndex } from '../src/features/pdf-to-word/core/source-first-level-index.js';
import { nativeUnicodeScalarMetric } from '../src/features/pdf-to-word/core/native-unicode-scalars.js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { createNativeMathMeasurer } from '../src/features/pdf-to-word/core/native-math-layout.js';
import { mathUnicodeRunStyle } from '../src/features/pdf-to-word/core/font-style.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';
import { positionedFrameCost, MAX_POSITIONED_FRAMES } from '../src/features/pdf-to-word/core/positioned-budget.js';

const context=createCanvas(1,1).getContext('2d'),checks=[];
const test=(name,fn)=>{fn();checks.push(name);};
const sym=g=>({type:'symbol',sourceId:g.id,text:g.text,italic:false,bold:false});

function fixture({base='𝑃',index='𝑚',em=14,dx=0,dy=0,color='314253',font='ABCDEF+XITSMath-Regular'}={}) {
  const make=(id,text,x,y,w,h,size,baseline)=>({id,sourceIds:[id],text,font,color,size,baseline,
    baselineX:x-em*.03,advanceWidth:w+em*.07,rect:{x,y,width:w,height:h},preciseInk:true,raster:false,
    bold:false,italic:false,order:id==='native-base'?1:2,horizontalScale:1,glyphPositions:[{text,rect:{x,y,width:w,height:h}}]});
  const b=make('native-base',base,em*3+dx,em*4+dy,em*.56,em*.64,em,em*4.64+dy);
  const s=make('native-index',index,b.rect.x+em*.59,b.rect.y+em*.56,em*.29,em*.43,em*.75,b.baseline+em*.25);
  const text=[b,s],sources=text.map(g=>({id:g.id,text:g.text,rect:{...g.rect},order:g.order,disposition:'editable'}));
  // This complete expected AST is handwritten, never obtained from inference.
  const expected={type:'script',base:sym(b),subscript:sym(s)};
  return {text,sources,expected};
}
function evidence(f) {
  const p=sourceFirstLevelIndexCandidates(f.text,[],f.sources,[]);
  assert.equal(p.length,1,'one complete isolated source pair');
  return {id:'native-pair',type:'image',role:'math',rect:union(f.text.map(g=>g.rect)),sourceIds:f.text.map(g=>g.id),
    mathGlyphs:structuredClone(f.text),mathStrokes:[],drawingIds:[],reasons:[],sourceFirstLevelIndex:p[0].proof};
}

// Independent OMML reader for the tiny permitted grammar. Fail on unknown nodes.
const elements=x=>(x.elements||[]).filter(e=>e.type==='element');
function canonical(node) {
  if(node.name.endsWith('Pr'))return [];
  if(node.name==='m:r') {
    const children=elements(node),rp=children.find(x=>x.name==='m:rPr');
    assert(children.every(x=>['m:rPr','w:rPr','m:t'].includes(x.name)));
    const text=children.filter(x=>x.name==='m:t').map(x=>(x.elements||[]).map(t=>t.text||'').join('')).join('');
    if(!text.trim())return [];
    const style=elements(rp||{}).find(x=>x.name==='m:sty')?.attributes?.['m:val'];
    assert.equal(style,'i','Unicode mathematical italic must retain explicit effective style');
    assert(!elements(rp||{}).some(x=>x.name==='m:nor'));
    return [...text].map(c=>['atom',c.normalize('NFKC'),'italic']);
  }
  if(['m:oMath','m:e','m:sub'].includes(node.name))return elements(node).flatMap(canonical);
  if(node.name==='m:sSub') {
    assert(elements(node).every(x=>['m:sSubPr','m:e','m:sub'].includes(x.name)));
    const role=name=>{const a=elements(node).filter(x=>x.name===name);assert.equal(a.length,1);return canonical(a[0]);};
    return [['subscript',role('m:e'),role('m:sub')]];
  }
  throw Error('Unexpected OMML node '+node.name);
}
function all(node,name) { return [ ...(node.name===name?[node]:[]), ...elements(node).flatMap(n=>all(n,name)) ]; }
const outputs=[];
for(const [base,index]of [['𝐸','𝑎'],['𝜈','𝑖'],['𝑃','𝑚'],['𝜅','𝑛']])for(const em of [10,14,19]) {
  const f=fixture({base,index,em,dx:em/7,dy:em/9}),r=evidence(f);
  test('complete source AST '+base+'_'+index+' '+em,()=>{
    assert.deepEqual(inferMathAst(r),f.expected);assert(validateMathEvidence(f.expected,r));assert(validateMathAst(f.expected,r));
    assert(sourceFirstLevelIndex(f.expected,r));assert.equal(nativeMathReaderMode(f.expected,r),'xits-first-level-index');
    assert.equal(mathUnicodeRunStyle(base,{sourceIndexRegion:r}),'italic');
    assert.equal(mathUnicodeRunStyle(index,{sourceIndexRegion:r}),'italic');
  });
  const before=structuredClone(r),math=nativeMath(f.expected,r,{measurementContext:context});
  test('source-derived serialized attachment '+base+' '+em,()=>{
    assert.deepEqual(r,before);const a=math.sourceLayout.firstLevelIndexAttachments;assert.equal(a.length,1);
    assert(Number.isFinite(a[0].serializedBaseAdvance));assert(Number.isFinite(a[0].nativeSubscriptX));
    assert(a[0].sourceSubscriptX>0);assert.equal(math.sourceLayout.shorthandAttachments,undefined);
  });
  const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[math]})]}]}));
  const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
  const doc=xml2js(xml),roots=all(doc,'m:oMath');
  test('independent complete OOXML roles '+base+' '+em,()=>{
    assert.equal(roots.length,1);assert.equal(all(doc,'m:sSub').length,1);assert.equal(all(doc,'m:sSup').length,0);
    assert.deepEqual(canonical(roots[0]),[['subscript',[['atom',base.normalize('NFKC'),'italic']],[['atom',index.normalize('NFKC'),'italic']]]]);
    assert.equal(all(doc,'w:drawing').length,0);
  });
  outputs.push({base,index,em,xml});
}

const original=fixture(),region=evidence(original);
const rawMutations=[
 ['missing trace',f=>delete f.text[1].glyphPositions],
 ['missing rectangle',f=>delete f.text[1].rect],
 ['truncated trace',f=>f.text[1].glyphPositions[0].rect.width/=2],
 ['mixed subset',f=>f.text[1].font='UVWXYZ+XITSMath-Regular'],
 ['foreign face',f=>f.text[1].font='Times New Roman'],
 ['changed source spelling',f=>f.sources[1].text='m'],
 ['unbound source',f=>f.sources.pop()],
 ['duplicate source',f=>f.sources.push(structuredClone(f.sources[1]))],
 ['wrong source disposition',f=>f.sources[1].disposition='hidden'],
 ['encoding repair',f=>f.sources[1].encodingCorrections=[{}]],
 ['OCR',f=>f.text[1].ocr=true],
 ['uncertain style',f=>f.text[0].mathStyleUncertain=true],
 ['already calibrated',f=>f.text[0].nativeCalibrated=true],
 ['clipped',f=>f.text[1].clipped=true],
 ['compound run',f=>f.text[0].text+='𝑛'],
 ['normalized Greek',f=>f.text[0].text='ν'],
 ['unlicensed Greek',f=>f.text[0].text='𝛾'],
 ['bold symbol',f=>f.text[0].bold=true],
 ['wrong color',f=>f.text[1].color='991122'],
 ['upper index',f=>{f.text[1].baseline=f.text[0].baseline-5;}],
 ['same baseline',f=>f.text[1].baseline=f.text[0].baseline],
 ['same em',f=>f.text[1].size=f.text[0].size],
 ['far index',f=>{f.text[1].rect.x+=20;f.sources[1].rect.x+=20;f.text[1].glyphPositions[0].rect.x+=20;}],
];
for(const[name,mutate]of rawMutations)test('reject '+name,()=>{const f=structuredClone(original);mutate(f);assert.equal(sourceFirstLevelIndexCandidates(f.text,[],f.sources,[]).length,0);});
for(const label of ['extra index','overbar','operator','prose collision','radical'])test('reject complete-source ambiguity '+label,()=>{
  const f=structuredClone(original),b=f.text[0],x=structuredClone(f.text[1]);
  x.id='extra';x.sourceIds=['extra'];x.text=label==='operator'?'=':label==='overbar'?'̄':label==='radical'?'√':'𝑛';
  x.rect={x:b.rect.x,y:b.rect.y-2,width:4,height:2};x.baseline=b.baseline;x.glyphPositions=[{text:x.text,rect:{...x.rect}}];
  assert.equal(sourceFirstLevelIndexCandidates([...f.text,x],[],[...f.sources,{id:x.id,text:x.text,rect:x.rect,disposition:'editable'}],[]).length,0);
});
test('existing compound ownership wins',()=>assert.equal(sourceFirstLevelIndexCandidates(original.text,[],original.sources,[original.text]).length,0));
test('drawing collision blocks closure',()=>assert.equal(sourceFirstLevelIndexCandidates(original.text,[{id:'line',rect:{...original.text[0].rect}}],original.sources,[]).length,0));
test('bounded input',()=>assert.equal(sourceFirstLevelIndexCandidates(Array(20001).fill(original.text[0]),[],original.sources,[]).length,0));

for(const[name,mutate]of [
 ['boolean proof',r=>r.sourceFirstLevelIndex=true],
 ['missing member',r=>r.sourceFirstLevelIndex.members.pop()],
 ['wrong proof base',r=>r.sourceFirstLevelIndex.baseId='foreign'],
 ['proof glyph mismatch',r=>r.mathGlyphs[1].text='𝑛'],
 ['extra AST evidence',r=>r.mathGlyphs.push(structuredClone(r.mathGlyphs[0]))],
 ['duplicate source id',r=>r.sourceIds[1]=r.sourceIds[0]],
 ['wrong crop',r=>r.rect.width+=2],
 ['extra stroke',r=>r.mathStrokes.push({id:'unknown'})],
 ['raster proof',r=>r.rasterMathEvidence={}],
 ['scalar proof collision',r=>r.sourceNativeUnicodeScalar=true],
])test('reject reader proof '+name,()=>{
  const r=structuredClone(region);mutate(r);assert.equal(sourceFirstLevelIndexRegion(r),null);
  assert.equal(nativeMathReaderMode(original.expected,r),null);
  assert.throws(()=>nativeMath(original.expected,r,{measurementContext:context}));
});
for(const[name,mutate]of [
 ['changed role',a=>{a.superscript=a.subscript;delete a.subscript;}],
 ['missing role',a=>delete a.subscript],
 ['reversed roles',a=>{[a.base,a.subscript]=[a.subscript,a.base];}],
 ['extra role',a=>a.superscript=structuredClone(a.subscript)],
 ['altered text',a=>a.subscript.text='𝑛'],
 ['extra key',a=>a.verified=true],
 ['nested role',a=>a.subscript={type:'script',base:a.subscript,subscript:structuredClone(a.subscript)}],
])test('reject complete AST mutation '+name,()=>{const a=structuredClone(original.expected);mutate(a);assert.equal(sourceFirstLevelIndex(a,region),null);assert(!validateMathAst(a,region));assert.equal(nativeMathReaderMode(a,region),null);});
test('missing font measurement rejects writer',()=>assert.throws(()=>nativeMath(original.expected,region),e=>e.code==='native-math-layout'));
test('positive tofu is not coverage',()=>{
  const fake={font:'before',fontKerning:'auto',measureText:()=>({width:999,actualBoundingBoxAscent:700,actualBoundingBoxDescent:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:600})};
  assert.throws(()=>nativeMath(original.expected,region,{measurementContext:fake}),e=>e.code==='native-math-layout');
});
test('throwing coverage restores context and reports fallback',()=>{
  const fake={font:'before',fontKerning:'auto',measureText(){throw Error('no font');}};
  assert.throws(()=>nativeMath(original.expected,region,{measurementContext:fake}),e=>e.code==='native-math-layout');
  assert.equal(fake.font,'before');assert.equal(fake.fontKerning,'auto');
});
test('glyph coverage is rechecked after initial coverage',()=>{
  const real=createCanvas(1,1).getContext('2d');let calls=0;
  const fake={get font(){return real.font;},set font(x){real.font=x;},get fontKerning(){return real.fontKerning;},set fontKerning(x){real.fontKerning=x;},
    measureText(t){const m=real.measureText(t),out={};for(const k of ['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent','fontBoundingBoxAscent','fontBoundingBoxDescent'])out[k]=m[k];if(++calls>2)out.width+=100;return out;}};
  assert.throws(()=>nativeMath(original.expected,region,{measurementContext:fake}),e=>e.code==='native-math-layout');
});
test('measurer rejects bare index flag',()=>assert.throws(()=>createNativeMathMeasurer(()=>({width:1,height:1,depth:0}),{sourceIndexRegion:true}),e=>e.code==='native-math-layout'));
test('no Greek range or bare proof flag',()=>{
  assert.equal(nativeUnicodeScalarMetric('𝛾'),null);assert.equal(mathUnicodeRunStyle('𝜈'),null);
  assert.equal(mathUnicodeRunStyle('𝜈',{sourceIndexRegion:true}),null);
  assert.equal(mathUnicodeRunStyle('𝛾',{sourceIndexRegion:region}),null);
});
test('regions close the full pair before singleton recovery',()=>{
  const f=fixture(),sources=structuredClone(f.sources),out=groupPageRegions(f.text,[],[],sources,{bounds:{x:0,y:0,width:400,height:400}});
  const formulas=out.items.filter(x=>x.sourceFirstLevelIndex);assert.equal(formulas.length,1);
  assert.deepEqual(formulas[0].sourceIds,f.text.map(g=>g.id));assert(sourceFirstLevelIndex(f.expected,formulas[0]));
  assert.equal(out.items.filter(x=>x.sourceNativeUnicodeScalar).length,0);
  assert.equal(formulas[0].sourceFirstLevelIndex.members[0].source.disposition,'editable');
});
test('existing ASCII first-level script remains unannotated',()=>{
  const f=fixture();f.text.forEach((g,i)=>{g.text=i?'k':'X';g.font='ABCDEF+Cambria-Italic';g.italic=true;});
  const r={role:'math',mathGlyphs:f.text,mathStrokes:[],reasons:[]},a=inferMathAst(r);assert(a);assert.equal(nativeMathReaderMode(a,r),'script');
});
test('complete index consumes one positioned frame, limit stays 512',()=>{
  assert.equal(MAX_POSITIONED_FRAMES,512);assert.equal(positionedFrameCost([region]),1);
  assert.equal(positionedFrameCost([{type:'paragraph',lines:[{items:[region]}]}]),1);
  assert.equal(positionedFrameCost(Array(512).fill(region)),512);assert.equal(positionedFrameCost(Array(513).fill(region)),513);
});

export const syntheticChecksPassed=checks.length;
export {fixture,evidence,canonical};
console.log(JSON.stringify({syntheticChecksPassed,completeOmmlCases:outputs.length,scope:'private source/AST/cmap-hmtx/attachment/XML contracts; actual reader acceptance remains separate'}));
