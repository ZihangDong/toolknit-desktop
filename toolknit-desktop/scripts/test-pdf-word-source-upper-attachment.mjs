// Invented complete source runs only. No original PDF/TeX, paths, case IDs or coordinates.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Paragraph, Packer, RunProperties } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { sourceUpperAttachmentCandidates, sourceUpperAttachmentRegion, sourceUpperAttachment } from '../src/features/pdf-to-word/core/source-upper-attachment.js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';
import { positionedFrameCost, MAX_POSITIONED_FRAMES } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { mathUnicodeRunStyle } from '../src/features/pdf-to-word/core/font-style.js';
import { nativeUnicodeScalarMetric } from '../src/features/pdf-to-word/core/native-unicode-scalars.js';
import { createNativeMathMeasurer } from '../src/features/pdf-to-word/core/native-math-layout.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';

const checks=[],test=(name,fn)=>{fn();checks.push(name);};
const sym=(id,text)=>({type:'symbol',sourceId:id,text,italic:false,bold:false});
const row=children=>({type:'row',children});
const ledgers=text=>text.map(g=>({id:g.id,text:g.text,rect:{...g.rect},order:g.order,disposition:'editable'}));
const common=(id,text,em,font)=>({id,sourceIds:[id],text,size:em,font,color:'314253',preciseInk:true,raster:false,
  horizontalScale:1,italic:false,bold:false,order:id==='main-run'?10:11});

export function equality({lhs='𝑃',base='𝑘',power='𝑎',em=14,dx=0,dy=0}={}) {
 const x=em*4+dx,baseline=em*8+dy,font='ABCDEF+XITSMath-Regular';
 const values=[lhs,'=',base],offsets=[0,lhs.length+1,lhs.length+3];
 const parts=values.map((text,i)=>({text,sourceOffset:offsets[i],spaceBefore:i>0,
  rect:{x:x+em*i*.9+em*.02,y:baseline-em*(i===0?.65:i===1?.35:.46),width:em*(i===1?.5:.45),height:em*(i===0?.65:i===1?.25:.46)},
  baseline,baselineX:x+em*i*.9,advanceWidth:em*.52}));
 const main={...common('main-run',lhs+' = '+base,em,font),rect:union(parts.map(p=>p.rect)),baseline,baselineX:x,advanceWidth:em*2.32,
  mathGlyphPositions:parts,glyphPositions:parts.map(p=>({text:p.text,rect:{...p.rect}}))};
 const eb=baseline-em*.4,ex=x+em*2.38;
 const exp={...common('power-run',power,em*.7,font),rect:{x:ex,y:eb-em*.42,width:em*.31,height:em*.42},
  baseline:eb,baselineX:ex-em*.02,advanceWidth:em*.35};
 exp.glyphPositions=[{text:power,rect:{...exp.rect}}];
 const text=[main,exp],expected=row([sym('main-run:math-part:0',lhs),sym('main-run:math-part:'+offsets[1],'='),
  {type:'script',base:sym('main-run:math-part:'+offsets[2],base),superscript:sym('power-run',power)}]);
 const oracle=[['atom',lhs.normalize('NFKC'),'italic'],['atom','=','upright'],['superscript',
  [['atom',base.normalize('NFKC'),'italic']],[['atom',power.normalize('NFKC'),'italic']]]];
 return {text,sources:ledgers(text),expected,oracle};
}

export function unit({factors=['cm','r','t'],power='−3',em=12,dx=0,dy=0}={}) {
 const x=em*5+dx,baseline=em*9+dy;let at=x;
 const words=factors.map((text,i)=>{const width=text.length*em*.4,part={text,spaceBefore:false,rect:{x:at+em*.02,
  y:baseline-em*(i===0?.65:.48),width:width-em*.04,height:em*(i===0?.65:.48)},baselineX:at,advanceWidth:width};
  at+=width+(i<factors.length-1?em*.16:0);return part;});
 const main={...common('main-run',factors.join(''),em,'GHIJKL+TimesNewRomanPSMT'),rect:union(words.map(p=>p.rect)),words,
  baseline,baselineX:x,advanceWidth:at-x};
 const eb=baseline-em*.4,ex=at+em*.06,sz=em*.75;
 const parts=[{text:'−',sourceOffset:0,spaceBefore:false,baseline:eb,baselineX:ex,advanceWidth:sz*.68,
  rect:{x:ex+sz*.06,y:eb-sz*.29,width:sz*.56,height:sz*.07}},
 {text:power[1],sourceOffset:1,spaceBefore:false,baseline:eb,baselineX:ex+sz*.68,advanceWidth:sz*.5,
  rect:{x:ex+sz*.76,y:eb-sz*.68,width:sz*.3,height:sz*.68}}];
 const exp={...common('power-run',power,sz,'MNOPQR+XITSMath-Regular'),rect:union(parts.map(p=>p.rect)),
  baseline:eb,baselineX:ex,advanceWidth:sz*1.18,mathGlyphPositions:parts,glyphPositions:parts.map(p=>({text:p.text,rect:{...p.rect}}))};
 let start=0;const atoms=factors.map((v,i)=>{const s=sym('main-run:upper-word:'+start,v);start+=v.length;return s;});
 const expected=row([...atoms.slice(0,-1),{type:'script',base:atoms.at(-1),superscript:row([
  sym('power-run:math-part:0','−'),sym('power-run:math-part:1',power[1])])}]);
 const oracle=[...factors.slice(0,-1).flatMap(v=>[...v].map(c=>['atom',c,'upright'])),
  ['superscript',[['atom',factors.at(-1),'upright']],[['atom','−','upright'],['atom',power[1],'upright']]]];
 const text=[main,exp];return {text,sources:ledgers(text),expected,oracle};
}

function evidence(f,groups=[]) {
 const p=sourceUpperAttachmentCandidates(f.text,[],f.sources,groups);assert.equal(p.length,1);
 return {type:'image',role:'math',rect:union(f.text.map(g=>g.rect)),sourceIds:f.text.map(g=>g.id),
  mathGlyphs:p[0].glyphs,mathStrokes:[],drawingIds:[],reasons:[],sourceUpperAttachment:p[0].proof};
}
function precedingRow(f) {
 const main=structuredClone(f.text[0]),em=main.size;
 main.id='preceding-row';main.sourceIds=[main.id];main.text='𝑁 ⩾ 0';main.order=1;
 main.baseline-=em*1.2;main.rect.y-=em*1.2;
 main.mathGlyphPositions.forEach((p,i)=>{p.text=['𝑁','⩾','0'][i];p.baseline-=em*1.2;p.rect.y-=em*1.2;});
 main.glyphPositions=main.mathGlyphPositions.map(p=>({text:p.text,rect:{...p.rect}}));
 return main;
}
const elements=x=>(x.elements||[]).filter(e=>e.type==='element');
const all=(node,name)=>[...(node.name===name?[node]:[]),...elements(node).flatMap(n=>all(n,name))];
export function canonical(node) {
 if(node.name.endsWith('Pr'))return [];
 if(node.name==='m:r') {
  const c=elements(node),rp=c.find(n=>n.name==='m:rPr'),props=elements(rp||{});
  assert(c.every(n=>['m:rPr','w:rPr','m:t'].includes(n.name)));
  const text=c.filter(n=>n.name==='m:t').map(n=>(n.elements||[]).map(t=>t.text||'').join('')).join('');
  if(!text.trim())return [];
  const italic=props.find(n=>n.name==='m:sty')?.attributes?.['m:val']==='i';
  assert(italic?!props.some(n=>n.name==='m:nor'):props.some(n=>n.name==='m:nor'));
  return [...text].map(c=>['atom',c.normalize('NFKC'),italic?'italic':'upright']);
 }
 if(['m:oMath','m:e','m:sup'].includes(node.name))return elements(node).flatMap(canonical);
 if(node.name==='m:sSup') {
  assert(elements(node).every(n=>['m:sSupPr','m:e','m:sup'].includes(n.name)));
  const role=name=>{const x=elements(node).filter(n=>n.name===name);assert.equal(x.length,1);return canonical(x[0]);};
  return [['superscript',role('m:e'),role('m:sup')]];
 }
 throw Error('Unknown OMML structure '+node.name);
}
const context=createCanvas(1,1).getContext('2d');let outputCases=0;
for(const make of [equality,unit])for(const em of [10,14,18]) {
 const f=make({em,dx:em/7,dy:em/9}),r=evidence(f);
 test('complete invented AST '+make.name+' '+em,()=>{assert.deepEqual(inferMathAst(r),f.expected);
  assert(validateMathAst(f.expected,r));assert(validateMathEvidence(f.expected,r));assert(sourceUpperAttachment(f.expected,r));
  assert.equal(nativeMathReaderMode(f.expected,r),'source-upper-attachment');});
 const before=structuredClone(r),formula=nativeMath(f.expected,r,{measurementContext:context});
 test('bounded actual serialized attachment '+make.name+' '+em,()=>{
  assert.deepEqual(r,before);assert.equal(formula.sourceLayout.upperAttachments.length,1);
  const p=formula.sourceLayout.upperAttachments[0];assert(Number.isFinite(p.serializedBaseAdvance+p.nativeSuperscriptX+p.sourceSuperscriptX));
  assert.equal(formula.sourceLayout.shorthandAttachments,undefined);assert.equal(formula.sourceLayout.firstLevelIndexAttachments,undefined);});
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[formula]})]}]}));
 const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'),doc=xml2js(xml,{captureSpacesBetweenElements:true}),roots=all(doc,'m:oMath');
 test('independent full OMML oracle '+make.name+' '+em,()=>{
  assert.equal(roots.length,1);assert.equal(all(doc,'m:sSup').length,1);assert.equal(all(doc,'m:sSub').length,0);
  assert.deepEqual(canonical(roots[0]),f.oracle);assert.equal(all(doc,'w:drawing').length,0);});
 test('superscript spacer preserves replacement math style '+make.name+' '+em,()=>{
  const sup=all(roots[0],'m:sup');assert.equal(sup.length,1);
  const spaces=all(sup[0],'m:r').filter(r=>all(r,'m:t').some(t=>(t.elements||[]).map(x=>x.text||'').join('')===' '));
  assert(spaces.length>=1);assert.equal(all(spaces[0],'m:nor').length,0,'leading attachment spacer must not supply normal-text mode to replacement typing');
  assert.equal(all(spaces[0],'m:sty')[0]?.attributes?.['m:val'],'i');assert.equal(all(spaces[0],'m:lit').length,1);
 });
 test('closure and one frame '+make.name+' '+em,()=>{
  const text=make===equality?[precedingRow(f),...f.text]:f.text;
  const grouped=groupPageRegions(text,[],[],ledgers(text),{bounds:{x:0,y:0,width:600,height:800}});
  const got=grouped.items.filter(x=>x.sourceUpperAttachment);assert.equal(got.length,1);
  assert.deepEqual(inferMathAst(got[0]),f.expected);assert.equal(positionedFrameCost([got[0]]),1);});
 outputCases++;
}

for(const make of [equality,unit]) {
 const reject=(name,fn)=>test(make.name+' reject '+name,()=>{const f=make();fn(f);
  assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[]).length,0);});
 for(const key of ['preciseInk','raster','clipped','truncated','ocr','bold','italic','mathStyleUncertain'])
  reject('unverified '+key,f=>{f.text[1][key]=key==='preciseInk'?false:true;});
 reject('wrong source text',f=>{f.sources[0].text+='z';});
 reject('missing source',f=>{f.sources.pop();});
 reject('duplicate source',f=>{f.sources.push(structuredClone(f.sources[0]));});
 reject('duplicate item',f=>{f.text.push(structuredClone(f.text[0]));});
 reject('raster ledger',f=>{f.sources[1].disposition='visible-image';});
 reject('encoding repair',f=>{f.sources[1].encodingCorrections=[{text:'x'}];});
 reject('mixed unknown source font',f=>{f.text[1].font='STUVWX+UnverifiedMath';});
 reject('lower attachment',f=>{f.text[1].baseline=f.text[0].baseline+f.text[0].size*.3;});
 reject('ambiguous unshifted tier',f=>{f.text[1].baseline=f.text[0].baseline;});
 reject('far tier',f=>{f.text[1].baseline=f.text[0].baseline-f.text[0].size;});
 reject('Greek exponent expansion',f=>{f.text[1].text='𝛾';f.sources[1].text='𝛾';});
 test(make.name+' rejects collision, larger owner and competing exponent',()=>{
  const f=make(),collision={id:'foreign-stroke',rect:{...f.text[1].rect}};
  assert.equal(sourceUpperAttachmentCandidates(f.text,[collision],f.sources,[]).length,0);
  const other={...f.text[1],id:'other-exponent',sourceIds:['other-exponent']};
  assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[[f.text[1],other]]).length,0);
  const parallel={...structuredClone(f.text[1]),id:'other-power',sourceIds:['other-power']};
  assert.equal(sourceUpperAttachmentCandidates([...f.text,parallel],[],[...f.sources,...ledgers([parallel])],[]).length,0);
 });
 test(make.name+' rejects wrong whole AST and glyph mutations',()=>{
  const r=evidence(make()),expected=structuredClone(make().expected);
  assert.equal(nativeMathReaderMode(expected,{...r,sourceUpperAttachment:true}),null);
  const bad=structuredClone(r);bad.mathGlyphs[0].text='z';assert.equal(sourceUpperAttachmentRegion(bad),null);
  const wrong=structuredClone(expected);wrong.children.at(-1).base=wrong.children[0];
  assert.equal(sourceUpperAttachment(wrong,r),null);assert.throws(()=>nativeMath(wrong,r,{measurementContext:context}));
  assert.equal(sourceUpperAttachment(expected.children.at(-1),r),null);
 });
 test(make.name+' rejects missing/fake measurement',()=>{
  const f=make(),r=evidence(f);assert.throws(()=>nativeMath(f.expected,r));
  const fake={font:'',measureText:()=>({width:100,actualBoundingBoxLeft:1,actualBoundingBoxRight:90,actualBoundingBoxAscent:50,actualBoundingBoxDescent:1})};
  assert.throws(()=>nativeMath(f.expected,r,{measurementContext:fake}),/coverage/);
 });
}
test('truncated and reordered native compound traces',()=>{
 for(const mutate of [f=>f.text[0].mathGlyphPositions.pop(),f=>f.text[0].mathGlyphPositions.reverse(),
  f=>f.text[0].mathGlyphPositions[2].sourceOffset=0,f=>f.text[1].glyphPositions[0].text='z']){
  const f=equality();mutate(f);assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[]).length,0);
 }
});
test('word spans cannot be manufactured by substring or gap guesses',()=>{
 for(const mutate of [f=>delete f.text[0].words,f=>f.text[0].words.pop(),f=>f.text[0].words.reverse(),
  f=>f.text[0].words[0].spaceBefore=true,f=>f.text[0].words[1].baselineX-=10,
  f=>f.text[0].words[2].text='tt',f=>f.text[1].mathGlyphPositions.pop()]){
  const f=unit();mutate(f);assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[]).length,0);
 }
});
test('existing exponent-only fragment may be reclaimed, larger owner may not',()=>{
 const f=unit();assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[[f.text[1]]]).length,1);
 assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[f.text]).length,0);
});
test('unknown AST properties, cycles and evidence work limits fail closed',()=>{
 const f=equality(),r=evidence(f),bad=structuredClone(f.expected);bad.children.at(-1).confidence=1;
 assert.equal(sourceUpperAttachment(bad,r),null);
 const cyclic=structuredClone(f.expected);cyclic.loop=cyclic;assert.equal(sourceUpperAttachment(cyclic,r),null);
 const huge=Array(20001).fill(f.text[0]);assert.equal(sourceUpperAttachmentCandidates(huge,[],f.sources,[]).length,0);
});
test('mixed XITS source identity and generated identity collisions fail closed',()=>{
 const f=equality();f.text[1].font='STUVWX+XITSMath-Regular';assert.equal(sourceUpperAttachmentCandidates(f.text,[],f.sources,[]).length,0);
 const g=equality();g.text[1].id='main-run:math-part:0';g.text[1].sourceIds=[g.text[1].id];g.sources=ledgers(g.text);
 assert.equal(sourceUpperAttachmentCandidates(g.text,[],g.sources,[]).length,0);
 const h=equality();h.sources.push({id:'main-run:math-part:0',text:'other source',rect:{x:2,y:2,width:2,height:2},disposition:'editable'});
 assert.equal(sourceUpperAttachmentCandidates(h.text,[],h.sources,[]).length,0);
});
test('already complete generic equation keeps its existing unannotated ownership',()=>{
 const f=equality(),g=groupPageRegions(f.text,[],[],structuredClone(f.sources),{bounds:{x:0,y:0,width:600,height:800}});
 assert.equal(g.items.filter(i=>i.sourceUpperAttachment).length,0);
 const old=g.items.find(i=>i.type==='image'&&i.role==='math');assert(old);
});
test('other invented letters, factors and negative integer retain complete roles',()=>{
 for(const f of [equality({lhs:'𝑁',base:'𝑎',power:'𝑚'}),unit({factors:['mm','g','q'],power:'−2'})]){
  const r=evidence(f);assert.deepEqual(inferMathAst(r),f.expected);
  assert(sourceUpperAttachment(f.expected,r));assert(nativeMath(f.expected,r,{measurementContext:context}).sourceLayout.upperAttachments.length===1);
 }
});
test('base advance fitting is derived from actual serialization and bounded',()=>{
 const f=equality(),b=f.text[0].mathGlyphPositions.at(-1),p=f.text[1],dx=b.rect.x+b.rect.width+.001-p.rect.x;
 p.rect.x+=dx;p.baselineX+=dx;p.glyphPositions[0].rect.x+=dx;f.sources=ledgers(f.text);
 const r=evidence(f),formula=nativeMath(f.expected,r,{measurementContext:context}),a=formula.sourceLayout.upperAttachments[0];
 assert(a.baseCharacterSpacing<0);assert(Number.isFinite(a.serializedBaseAdvance));
 assert(Math.abs(a.sourceSuperscriptX-a.serializedBaseAdvance)<=.05);
});
test('no scalar16/Greek expansion and existing budget unchanged',()=>{
 assert.equal(nativeUnicodeScalarMetric('𝑦'),null);assert.equal(nativeUnicodeScalarMetric('𝛾'),null);
 assert.equal(mathUnicodeRunStyle('𝜈'),null);assert.equal(mathUnicodeRunStyle('𝛾'),null);
 assert.equal(MAX_POSITIONED_FRAMES,512);const r=evidence(equality());assert.equal(positionedFrameCost(Array(513).fill(r)),513);
});
test('math-mode spacer requires complete source and exact one-point shape',()=>{
 const region=evidence(equality()),paint=()=>({width:.2,height:0,depth:0});
 const raw={'m:r':[{'m:rPr':[{'m:lit':{_attr:{'m:val':'1'}}},{'m:sty':{_attr:{'m:val':'i'}}}]},new RunProperties({font:'Arial',size:2,sizeComplexScript:2,characterSpacing:2}).prepForXml({stack:[]}),{'m:t':[' ']}]};
 assert.throws(()=>createNativeMathMeasurer(paint)([raw],12,{depth:1,mathLevel:1}),/Unsupported nonliteral/);
 assert.throws(()=>createNativeMathMeasurer(paint,{sourceUpperAttachmentRegion:true}),/Incomplete upper attachment/);
 const measure=createNativeMathMeasurer(paint,{sourceUpperAttachmentRegion:region});assert(measure([raw],12,{depth:1,mathLevel:1}).width>0);
 for(const mutate of[
  r=>r['m:r'][2]['m:t']=['x'],r=>r['m:r'][0]['m:rPr'].push({'m:zeroWid':{_attr:{'m:val':'1'}}}),
  r=>r['m:r'][0]['m:rPr'][1]['m:sty']._attr['m:val']='p',r=>r['m:r'][0]['m:rPr'].shift(),
  r=>r['m:r'][1]=new RunProperties({font:'Cambria Math',size:2}).prepForXml({stack:[]}),
  r=>r['m:r'][1]=new RunProperties({font:'Arial',size:4}).prepForXml({stack:[]})
 ]){const copy=structuredClone(raw);mutate(copy);assert.throws(()=>measure([copy],12,{depth:1,mathLevel:1}),/Unsupported nonliteral/);}
});
test('present and invalid upper-source copies consume the existing scene budget',()=>{
 const region=evidence(equality()),base={...region};delete base.sourceUpperAttachment;
 assert.equal(sceneLayoutBytes({items:[region]})-sceneLayoutBytes({items:[base]}),4096+2*4096);
 assert.equal(sceneLayoutBytes({items:[{...base,sourceUpperAttachment:false}]})-sceneLayoutBytes({items:[base]}),4096);
});
export const syntheticChecksPassed=checks.length;
console.log(JSON.stringify({syntheticChecksPassed,completeInventedOmmlCases:outputCases,actualReaderAcceptance:false}));
