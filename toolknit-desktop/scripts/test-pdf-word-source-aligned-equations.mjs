// Invented source coordinates, labels and formulas; independent serialized roles.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Paragraph, Packer } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { sourceAlignedEquationCandidates, sourceAlignedEquationRegion, sourceAlignedEquation,
  sourceAlignedRow, sourceAlignedRowContext } from '../src/features/pdf-to-word/core/source-aligned-equations.js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { createNativeMathMeasurer } from '../src/features/pdf-to-word/core/native-math-layout.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';
import { positionedFrameCost, MAX_POSITIONED_FRAMES } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';

const checks=[],test=(name,fn)=>{fn();checks.push(name);};
export function aligned({em=14,dx=0,dy=0,minus=false}={}) {
  const op=minus?'−':'+',a=['𝑃','=','𝑟',op,'𝑠',op,'𝑡'],b=['=','𝑢',op,'𝑣'];
  const build=(values,index)=>{
    const id=index?'lower-source-run':'upper-source-run',x=em*5+dx+(index?em:0),baseline=em*9+dy+index*em*1.7;
    let offset=0;
    const parts=values.map((text,i)=>{const r={text,sourceOffset:offset,spaceBefore:i>0,baseline,baselineX:x+i*em,
      advanceWidth:em*.62,rect:{x:x+i*em+em*.025,y:baseline-em*(text==='='?.33:.57),width:em*.52,height:em*(text==='='?.21:.57)}};
      offset+=text.length+1;return r;});
    return {id,text:values.join(' '),font:'UVWXYZ+XITSMath-Regular',sourceIds:[id],order:index+3,size:em,
      color:'315273',preciseInk:true,raster:false,horizontalScale:1,italic:false,bold:false,
      baseline,baselineX:x,advanceWidth:(values.length-.38)*em,rect:union(parts.map(p=>p.rect)),
      mathGlyphPositions:parts,glyphPositions:parts.map(p=>({text:p.text,rect:{...p.rect}}))};
  };
  const text=[build(a,0),build(b,1)],sources=text.map(g=>({id:g.id,text:g.text,rect:{...g.rect},disposition:'editable',order:g.order}));
  const rows=text.map(g=>({type:'row',children:g.mathGlyphPositions.map(p=>({type:'symbol',sourceId:g.id+':math-part:'+p.sourceOffset,
    text:p.text,italic:false,bold:false}))}));
  return {text,sources,ast:{type:'aligned-equations',rows,sharedLhsSourceId:rows[0].children[0].sourceId},
    oracle:[a,b].map(r=>r.map(c=>[c.normalize('NFKC'),/^[A-Za-z]$/.test(c.normalize('NFKC'))?'italic':'upright']))};
}
export function evidence(f){const p=sourceAlignedEquationCandidates(f.text,[],f.sources,[]);assert.equal(p.length,1);return p[0].region;}
const context=createCanvas(1,1).getContext('2d'),elements=x=>(x.elements||[]).filter(e=>e.type==='element');
const all=(n,name)=>[...(n.name===name?[n]:[]),...elements(n).flatMap(c=>all(c,name))];
function atoms(n){return all(n,'m:r').flatMap(r=>{
  const text=all(r,'m:t').map(t=>(t.elements||[]).map(v=>v.text||'').join('')).join('');
  if(!text.trim())return [];
  const math=elements(r).find(x=>x.name==='m:rPr'),style=all(math||{},'m:sty')[0]?.attributes?.['m:val'];
  const italic=style==='i';assert(italic?!all(math,'m:nor').length:all(math,'m:nor').length===1);
  return [...text].map(c=>[c.normalize('NFKC'),italic?'italic':'upright']);
});}
let outputCases=0;
for(const em of [10,14,19])for(const minus of [false,true]){
  const f=aligned({em,minus,dx:em/9,dy:em/5}),r=evidence(f),before=structuredClone(r);
  test('source roles '+em+minus,()=>{
    assert.deepEqual(inferMathAst(r),f.ast);assert(validateMathAst(f.ast,r));assert(validateMathEvidence(f.ast,r));
    assert(sourceAlignedEquation(f.ast,r));assert.equal(nativeMathReaderMode(f.ast,r),'source-aligned-equation');
    assert.equal(positionedFrameCost([r]),1);
    for(let index=0;index<2;index++){const c={parent:r,index},row=sourceAlignedRowContext(c);assert(row);
      assert(sourceAlignedRow(row.ast,row.region,c));assert(validateMathEvidence(row.ast,row.region));}
  });
  const result=nativeMath(f.ast,r,{measurementContext:context}),serialized=result.prepForXml({stack:[]})['m:oMath'];
  test('source-derived frame '+em+minus,()=>{assert.deepEqual(r,before);const l=result.sourceLayout;
    assert(l.alignedFrame);assert(l.measured.width>0);assert(l.alignedFrame.height>l.alignedFrame.lineHeight);
    assert(l.alignedFrame.y<f.text[0].baseline);assert(l.alignedFrame.y+l.alignedFrame.height>f.text[1].baseline);
  });
  const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[result]})]}]}));
  const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'),doc=xml2js(xml,{captureSpacesBetweenElements:true});
  test('whole independent OMML oracle '+em+minus,()=>{
    const roots=all(doc,'m:oMath'),arrays=all(doc,'m:eqArr');assert.equal(roots.length,1);assert.equal(arrays.length,1);
    assert.equal(all(doc,'m:m').length,0);assert.equal(all(doc,'w:drawing').length,0);
    const rows=elements(arrays[0]).filter(n=>n.name==='m:e');assert.equal(rows.length,2);
    assert.deepEqual(rows.map(atoms),f.oracle);
    for(const run of all(arrays[0],'m:r'))for(const t of all(run,'m:t'))if((t.elements||[]).some(x=>x.text===' ')){
      assert.equal(t.attributes?.['xml:space'],'preserve');assert.equal(all(run,'m:nor').length,0);
      assert.equal(all(run,'m:sty')[0].attributes['m:val'],'i');assert.equal(all(run,'m:lit').length,1);
    }
  });
  test('scope rejects booleans and nested arrays '+em+minus,()=>{
    const measure=()=>({width:1,height:1,depth:0});
    assert.throws(()=>createNativeMathMeasurer(measure)(serialized,em));
    assert.throws(()=>createNativeMathMeasurer(measure,{sourceAlignedEquationRegion:true}));
    const measured=createNativeMathMeasurer(measure,{sourceAlignedEquationRegion:r});
    assert.throws(()=>measured(serialized,em,{depth:1}));assert.throws(()=>measured(serialized,em,{mathLevel:1}));
    const bad=structuredClone(serialized);bad[0]['m:eqArr'].push({'m:e':[]});assert.throws(()=>measured(bad,em));
  });
  outputCases++;
}
const reject=(name,mutate)=>test('reject '+name,()=>{const f=aligned();mutate(f);assert.equal(sourceAlignedEquationCandidates(f.text,[],f.sources,[]).length,0);});
for(const key of ['preciseInk','raster','clipped','truncated','ocr','bold','italic','mathStyleUncertain'])
  reject(key,f=>{f.text[1][key]=key==='preciseInk'?false:true;});
reject('wrong source text',f=>{f.sources[0].text+='x';});
reject('missing source',f=>{f.sources.pop();});
reject('duplicate source',f=>{f.sources.push(structuredClone(f.sources[0]));});
reject('duplicate item',f=>{f.text.push(structuredClone(f.text[0]));});
reject('noneditable source',f=>{f.sources[1].disposition='visible-image';});
reject('mixed source font',f=>{f.text[1].font='OTHERF+XITSMath-Regular';});
reject('unknown source font',f=>{f.text.forEach(g=>g.font='UnknownMath');});
reject('wrong equals alignment',f=>{f.text[1].mathGlyphPositions[0].baselineX+=1;});
reject('same baseline',f=>{f.text[1].baseline=f.text[0].baseline;});
reject('incomplete trace',f=>{f.text[0].mathGlyphPositions.pop();});
reject('reordered trace',f=>{f.text[0].mathGlyphPositions.reverse();});
reject('changed physical trace',f=>{f.text[1].glyphPositions[0].text='+';});
reject('foreign generated ID',f=>{f.sources.push({id:f.ast.rows[0].children[0].sourceId});});
test('foreign collision and wider source owner',()=>{
 const f=aligned(),stroke={id:'unowned-line',rect:{...f.text[1].rect}};
 assert.equal(sourceAlignedEquationCandidates(f.text,[stroke],f.sources,[]).length,0);
 assert.equal(sourceAlignedEquationCandidates(f.text,[],f.sources,[[f.text[1],stroke]]).length,0);
 assert.equal(sourceAlignedEquationCandidates(f.text,[],f.sources,[[f.text[0]],[f.text[1]]]).length,1);
 const group=groupPageRegions(f.text,[],[],structuredClone(f.sources),{bounds:{x:0,y:0,width:700,height:900}});
 assert.equal(group.items.filter(i=>i.sourceAlignedEquation).length,1);
});
test('whole and row proof mutations',()=>{
 const f=aligned(),r=evidence(f),wrong=structuredClone(f.ast);wrong.rows[0].children[2].text='𝑎';
 assert.equal(sourceAlignedEquation(wrong,r),null);assert.throws(()=>nativeMath(wrong,r,{measurementContext:context}));
 for(const name of ['sourceUpperAttachment','sourceIndexedSum','sourceNativeUnicodeScalar','rasterMathEvidence','sourceScalarRelation','sourceFirstLevelIndex'])
  for(const value of [true,false,{}])assert.equal(sourceAlignedEquationRegion({...r,[name]:value}),null);
 assert(sourceAlignedEquationRegion({...r,ocrMath:false}));
 for(const value of [true,{},null])assert.equal(sourceAlignedEquationRegion({...r,sourceAlignedEquation:value}),null);
 assert.equal(sourceAlignedRowContext({parent:r,index:2}),null);
 const row=sourceAlignedRowContext({parent:r,index:0});
 assert.equal(sourceAlignedRow(row.ast,row.region,{parent:r,index:1}),null);
 assert.throws(()=>nativeMath(row.ast,row.region,{measurementContext:context,sourceAlignedRow:{parent:true,index:0}}));
 const bad=structuredClone(r);bad.sourceAlignedEquation.members[1].item.baseline+=1;assert.equal(sourceAlignedEquationRegion(bad),null);
 const cycle=structuredClone(f.ast);cycle.rows.push(cycle);assert.equal(sourceAlignedEquation(cycle,r),null);
 assert.throws(()=>nativeMath(f.ast,r));
 const fake={font:'',measureText:()=>({width:100,actualBoundingBoxLeft:1,actualBoundingBoxRight:90,actualBoundingBoxAscent:50,actualBoundingBoxDescent:1})};
 assert.throws(()=>nativeMath(f.ast,r,{measurementContext:fake}),/coverage/);
});
test('fixed resource bounds include proof copies',()=>{
 assert.equal(MAX_POSITIONED_FRAMES,512);const f=aligned(),r=evidence(f);
 assert.equal(positionedFrameCost(Array(513).fill(r)),513);
 assert.equal(sourceAlignedEquationCandidates(Array(20001).fill(f.text[0]),[],f.sources,[]).length,0);
 const bytes=b=>sceneLayoutBytes({items:[b]});
 const plain={...r};delete plain.sourceAlignedEquation;
 assert(bytes(r)>=bytes(plain)+4096+2*32768);assert(bytes({...plain,sourceAlignedEquation:true})>=bytes(plain)+4096);
});
console.log(JSON.stringify({checks:checks.length,actualOMMLCases:outputCases,passed:true}));
