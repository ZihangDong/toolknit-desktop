import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
const {nativePairSpacing}=await import('../src/features/pdf-to-word/core/native-pair-spacing.js');
const {nativePairEditStyle}=await import('../src/features/pdf-to-word/core/native-pair-policy.js');
const {textMetrics,positionedTextRuns}=await import('../src/features/pdf-to-word/adapters/text-layout.js');
const {inferDocument}=await import('../src/features/pdf-to-word/core/layout.js');
const {resultTargets,layoutEditedText,applyResultEdits}=await import('../src/features/pdf-to-word/core/result-edit.js');
const {measureResultText}=await import('../src/features/pdf-to-word/result-preview.js');
const {drawResultText}=await import('../src/features/pdf-to-word/adapters/text-rendering.js');
const {createWordBytes}=await import('../src/features/pdf-to-word/adapters/docx.js');
const ctx=createCanvas(1,1).getContext('2d');let checks=0;const ok=()=>checks++;
function fixture(text='Teapot',font='ABCDEF+Arial-BoldMT',bold=true,size=20,x=50,compatible=false){
 const base={id:'invented-'+x,type:'text',sourceIds:['invented-'+x],text,font,size,bold,italic:false,color:'225577',horizontalScale:1,preciseInk:true,raster:false,baselineX:x,baseline:50};
 ctx.font=`${bold?'bold ':''}1000px "${font.includes('Arial')?'Arial':'Times New Roman'}"`;ctx.fontKerning='none';
 const widths=[...text].map(c=>ctx.measureText(c).width*size/1000);let at=x;
 const gs=[...text].map((c,i)=>{const value={text:c,baselineX:at,baseline:50,advanceWidth:widths[i]};
  ctx.fontKerning='normal';const pair=i+1<text.length?ctx.measureText(text.slice(i,i+2)).width*size/1000-widths[i]-widths[i+1]:0;
  at+=widths[i]+pair;return value;});
 const m=textMetrics(base,ctx);base.advanceWidth=at-x;base.rect={x:x-m.left,y:50-m.ascent,width:at-x,height:m.ascent+m.inkDescent};
 const proof=nativePairSpacing(base,gs,{compatibleFace:compatible});return{item:{...base,...(proof?{nativePairSpacing:proof}:{})},proof};
}
const {item,proof}=fixture();assert(proof);ok();
const neighbour=fixture('HOLLOW','GHIJKL+TimesNewRomanPSMT',false,16,250).item;delete neighbour.nativePairSpacing;
const child=i=>{const v={...i};delete v.id;delete v.sourceIds;delete v.type;return v;};
const parent={...item,id:'invented-paragraph',sourceIds:['invented-paragraph'],text:item.text+' '+neighbour.text,words:[child(item),child(neighbour)],
 advanceWidth:neighbour.baselineX+neighbour.advanceWidth-item.baselineX,rect:{...item.rect,width:neighbour.rect.x+neighbour.rect.width-item.rect.x}};
delete parent.nativePairSpacing;
const doc=inferDocument([{number:1,width:600,height:300,items:[parent],characters:parent.text.length,risks:[],rasterPage:false,
 sources:[{id:parent.id,text:parent.text,rect:parent.rect,order:1,disposition:'editable'}]}],{preserveGeometry:true});
const page=doc.pages[0],target=resultTargets(page).find(t=>t.text.includes('Teapot'));assert(target);ok();
const measure=(text,style)=>measureResultText(text,style,ctx);measure.metrics=(text,style)=>measureResultText.metrics(text,style,ctx);
const change=(text,previous)=>layoutEditedText(target,text,measure,{page,edits:previous?{[target.key]:previous}:{}});
assert.deepEqual(change(target.text),{type:'noop'});assert.equal(applyResultEdits(doc,{[target.key]:{type:'noop'}}),doc);ok();
const oldPlan=positionedTextRuns({items:[item],baseline:item.baseline},ctx).filter(r=>r.kind==='text');
const edits=[];
for(const [name,word]of[['replace-one','Teapoz'],['append','Teapotq'],['delete-character','Teapo']]){
 const value=change(target.text.replace('Teapot',word)),changed=applyResultEdits(doc,{[target.key]:value});
 const edited=value.lines.flatMap(l=>l.items).find(i=>i.text===word);assert(edited,JSON.stringify(value));ok();
 assert(edited.nativePairPolicy);assert.equal(edited.nativePairPolicy.evidence.text,'Teapot');assert(!edited.nativePairSpacing);ok();
 if(name!=='delete-character')assert.equal(edited.nativePairMap.at(-1),null);ok();
 const plan=positionedTextRuns({items:[edited],baseline:edited.baseline},ctx).filter(r=>r.kind==='text');
 assert.equal(plan[0].spacing,oldPlan[0].spacing);assert.equal(plan[0].item.text,'T');
 assert(Math.abs(plan[1].x-plan[0].x-(oldPlan[1].x-oldPlan[0].x))<1e-8);ok();
 const untouched=value.lines.flatMap(l=>l.items).find(i=>i.text==='HOLLOW');
 assert(untouched,'The unchanged different-face suffix must be in the edited paragraph');
 for(const key of['font','size','bold','italic','color','baselineX','baseline','advanceWidth','rect'])assert.deepEqual(untouched[key],neighbour[key],name+' untouched '+key);ok();
 const bytes=await createWordBytes(changed,[],{preserveGeometry:true,measurementContext:ctx});const zip=await JSZip.loadAsync(bytes.bytes),xml=await zip.file('word/document.xml').async('string');
 assert(xml.includes('<w:kern w:val="32767"/>'));assert(xml.includes(`w:spacing w:val="${oldPlan[0].spacing}"`));ok();
 const canvas=createCanvas(600,300),calls=[],paint=canvas.getContext('2d');
 const proxy=new Proxy(paint,{get(t,k){if(k==='fillText')return(...args)=>{calls.push({text:args[0],spacing:t.letterSpacing,fontKerning:t.fontKerning});return t.fillText(...args);};const v=t[k];return typeof v==='function'?v.bind(t):v;},set(t,k,v){t[k]=v;return true;}});
 drawResultText(changed.pages[0],proxy);assert(calls.some(c=>c.text==='T'&&c.fontKerning==='none'&&Math.abs(parseFloat(c.spacing)-oldPlan[0].spacing/20)<1e-8));ok();
 assert.equal(applyResultEdits(doc,{}),doc);assert.deepEqual(doc.pages[0],page);ok();
 edits.push({name,word,sourceMap:edited.nativePairMap,plan:plan.map(r=>({text:r.item.text,spacing:r.spacing,x:r.x}))});
}
const replaced=change(target.text.replace('Teapot','Teapoz'));
const repeated=change(target.text.replace('Teapot','Teapozq'),replaced);assert(repeated);ok();
const ritem=repeated.lines.flatMap(l=>l.items).find(i=>i.text==='Teapozq');assert.deepEqual(ritem.nativePairMap,[0,1,2,3,4,null,null]);ok();
const deletion=applyResultEdits(doc,{[target.key]:{type:'delete'}});assert(!resultTargets(deletion.pages[0]).some(t=>t.key===target.key));assert.equal(applyResultEdits(doc,{}),doc);ok();
const custom=fixture('Tester:').item;assert.equal(nativePairEditStyle(custom),null);ok();
const changedStyle={...nativePairEditStyle(item),bold:false};assert.equal(nativePairEditStyle(changedStyle),null);ok();
for(const [text,font,bold]of[['Tsarina','ABCDEF+Arial-BoldMT',true],['Tsarina','ABCDEF+TimesNewRomanPS-BoldMT',true],['Weaver','ABCDEF+TimesNewRomanPSMT',false]]){
 const source=fixture(text,font,bold).item,style=nativePairEditStyle(source);assert(style);ok();
 const edited={...style,text:text+'q',nativePairMap:[...style.nativePairMap,null]};delete edited.nativePairSpacing;
 const before=positionedTextRuns({items:[source],baseline:source.baseline},ctx),after=positionedTextRuns({items:[edited],baseline:edited.baseline},ctx);
 assert.equal(after[0].spacing,before[0].spacing);assert(after.some(r=>r.options?.kern===32767));assert.equal(edited.nativePairMap.at(-1),null);ok();
}
const unsupported=fixture('AVOID').item;assert(unsupported.nativePairSpacing);assert.equal(nativePairEditStyle(unsupported),null);
assert(!positionedTextRuns({items:[unsupported],baseline:50},ctx).some(r=>r.options?.kern));ok();
for(const [value,expectsPair]of[['TeapotTe',true],['TeapotAV',false]]){
 const edit=change(target.text.replace('Teapot',value)),r=edit.lines.flatMap(l=>l.items).find(i=>i.text===value);
 assert(r&&r.nativePairMap.slice(-2).every(v=>v===null));
 const plan=positionedTextRuns({items:[r],baseline:50},ctx).filter(v=>v.kind==='text');
 assert.equal(plan.filter(v=>v.spacing<0).length,expectsPair?2:1);ok();
}
assert.throws(()=>change(target.text.replace('Teapot','Teapot'+'q'.repeat(65))),/edit-fit/);assert.equal(item.size,20);ok();
// Independent invented font-metric fixtures, including the two linked edits.
// No document body, source screenshot, original PDF path or reader result.
const deniedYa=fixture('Yarn','ABCDEF+TimesNewRomanPSMT',false).item;
assert(deniedYa.nativePairSpacing);assert.equal(nativePairEditStyle(deniedYa),null);ok();
assert(!positionedTextRuns({items:[deniedYa],baseline:50},ctx).some(r=>r.options?.kern));ok();
const linkedSource=fixture('Template').item,linkedProof=structuredClone(linkedSource.nativePairSpacing);
assert(linkedProof);assert(nativePairEditStyle(linkedSource));ok();
// Malformed optional evidence must conservatively return null, never throw.
const invalidProofCases=[
 ['null glyph',p=>p.glyphs[0]=null],['undefined glyph',p=>p.glyphs[0]=undefined],
 ['sparse glyph slot',p=>delete p.glyphs[0]],['primitive glyph',p=>p.glyphs[0]='T'],
 ['missing glyph text',p=>delete p.glyphs[0].text],['null glyph text',p=>p.glyphs[0].text=null],
 ['empty glyph text',p=>p.glyphs[0].text=''],['multiple glyph text',p=>p.glyphs[0].text='Te'],
 ['nonfinite glyph offset',p=>p.glyphs[0].offset=NaN],['infinite glyph offset',p=>p.glyphs[0].offset=Infinity],
 ['string glyph offset',p=>p.glyphs[0].offset='0'],['bigint glyph offset',p=>p.glyphs[0].offset=0n],
 ['nonfinite glyph advance',p=>p.glyphs[0].advance=NaN],['infinite glyph advance',p=>p.glyphs[0].advance=Infinity],
 ['missing glyph advance',p=>delete p.glyphs[0].advance],['zero glyph advance',p=>p.glyphs[0].advance=0],
 ['negative glyph advance',p=>p.glyphs[0].advance=-1],['string glyph advance',p=>p.glyphs[0].advance='12'],
 ['null proof text',p=>p.text=null],['non-string proof text',p=>p.text=[]],
 ['nonfinite size',p=>p.size=NaN],['infinite origin',p=>p.origin=Infinity],
 ['infinite proof advance',p=>p.advance=Infinity],['zero proof advance',p=>p.advance=0],
 ['null glyph array',p=>p.glyphs=null],['non-array glyphs',p=>p.glyphs={}],
 ['oversized glyph array',p=>p.glyphs=Array(65).fill(p.glyphs[0])],
 ['non-string source face',p=>p.sourceFont={}],['oversized source face',p=>p.sourceFont='A'.repeat(161)],
 ['overflowing derived pair delta',p=>{p.glyphs[0].offset=-1e308;p.glyphs[1].offset=1e308;}],
];
for(const [name,mutate]of invalidProofCases){
 const bad=structuredClone(linkedProof);mutate(bad);
 for(const inherited of[false,true]){
  const value=inherited?{...linkedSource,nativePairSpacing:undefined,nativePairPolicy:{version:1,evidence:bad},nativePairMap:[0,1,2,3,4,5,6,7]}
   :{...linkedSource,nativePairSpacing:bad};
  let result;assert.doesNotThrow(()=>{result=nativePairEditStyle(value);},name);
  assert.equal(result,null,name+(inherited?' inherited':' original'));
 }
 ok();
}
assert.doesNotThrow(()=>assert.equal(nativePairEditStyle({...linkedSource,text:null}),null));ok();
assert.deepEqual(linkedSource.nativePairSpacing,linkedProof);assert(nativePairEditStyle(linkedSource));ok();
const linkedParent={...linkedSource,id:'invented-linked-paragraph',sourceIds:['invented-linked-paragraph'],
 text:'Template '+neighbour.text,words:[child(linkedSource),child(neighbour)],
 advanceWidth:neighbour.baselineX+neighbour.advanceWidth-linkedSource.baselineX,
 rect:{...linkedSource.rect,width:neighbour.rect.x+neighbour.rect.width-linkedSource.rect.x}};
delete linkedParent.nativePairSpacing;
const linkedDoc=inferDocument([{number:1,width:600,height:300,items:[linkedParent],characters:linkedParent.text.length,risks:[],rasterPage:false,
 sources:[{id:linkedParent.id,text:linkedParent.text,rect:linkedParent.rect,order:1,disposition:'editable'}]}],{preserveGeometry:true});
const linkedOriginal=structuredClone(linkedDoc),linkedPage=linkedDoc.pages[0],linkedTarget=resultTargets(linkedPage).find(t=>t.text.includes('Template'));
assert(linkedTarget);assert.deepEqual(layoutEditedText(linkedTarget,linkedTarget.text,measure,{page:linkedPage,edits:{}}),{type:'noop'});ok();
const linkedWriter=async d=>{const result=await createWordBytes(d,[],{preserveGeometry:true,measurementContext:ctx});
 return(await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');};
const linkedOriginalXml=await linkedWriter(linkedDoc),linkedEdits=[];
for(const [word,newOrdinal]of[['Tamplate',1],['Aemplate',0]]){
 const text=linkedTarget.text.replace('Template',word);
 const value=layoutEditedText(linkedTarget,text,measure,{page:linkedPage,edits:{}});
 const edited=value.lines.flatMap(l=>l.items).find(i=>i.text===word);assert(edited);ok();
 const expectedMap=[0,1,2,3,4,5,6,7];expectedMap[newOrdinal]=null;
 assert.deepEqual(edited.nativePairMap,expectedMap);assert(!edited.nativePairSpacing);
 assert.deepEqual(edited.nativePairPolicy.evidence,linkedProof);ok();
 for(const key of['font','size','bold','italic','color','horizontalScale','baselineX','baseline'])assert.deepEqual(edited[key],linkedSource[key]);ok();
 const plan=positionedTextRuns({items:[edited],baseline:edited.baseline},ctx).filter(r=>r.kind==='text');
 assert.equal(plan.map(r=>r.item.text).join(''),word);assert(plan.every(r=>r.spacing===0&&r.options.kern===32767));ok();
 const width=measureResultText(word,edited,ctx);assert(Math.abs(width-edited.advanceWidth)<1e-8);ok();
 const untouched=value.lines.flatMap(l=>l.items).find(i=>i.text===neighbour.text);assert(untouched);
 for(const key of['font','size','bold','italic','color','baselineX','baseline','advanceWidth','rect'])assert.deepEqual(untouched[key],neighbour[key]);ok();
 const changed=applyResultEdits(linkedDoc,{[linkedTarget.key]:value}),xml=await linkedWriter(changed);
 const wordRun=[...xml.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)].map(m=>m[0]).find(r=>r.includes('>'+word+'<'));assert(wordRun);
 assert(wordRun.includes('<w:kern w:val="32767"/>'));assert(!/<w:spacing w:val="-/.test(wordRun));
 assert(wordRun.includes('w:ascii="Arial"'));assert(wordRun.includes('<w:sz w:val="40"/>'));assert(/<w:b(?:\/|>)/.test(wordRun));ok();
 const paint=createCanvas(600,300).getContext('2d'),calls=[];
 const proxy=new Proxy(paint,{get(t,k){if(k==='fillText')return(...args)=>{const m=t.getTransform();calls.push({text:args[0],font:t.font,kerning:t.fontKerning,spacing:t.letterSpacing,x:m.e,y:m.f});return t.fillText(...args);};
  const v=t[k];return typeof v==='function'?v.bind(t):v;},set(t,k,v){t[k]=v;return true;}});
 drawResultText(changed.pages[0],proxy);const call=calls.find(c=>c.text===word);assert(call);
 assert.equal(call.kerning,'none');assert.equal(parseFloat(call.spacing),0);assert.equal(call.font,'bold 20px "Arial"');
 assert(Math.abs(call.x-plan[0].x)<.001&&Math.abs(call.y-plan[0].baseline)<.001);ok();
 // Keep an appended character so this is a real subsequent edit. The public
 // exact-original-text contract deliberately returns noop/restores the source.
 const restored=layoutEditedText(linkedTarget,linkedTarget.text.replace('Template','Templateq'),measure,{page:linkedPage,edits:{[linkedTarget.key]:value}});
 const retyped=restored.lines.flatMap(l=>l.items).find(i=>i.text==='Templateq');assert(retyped);
 assert.equal(retyped.nativePairMap[newOrdinal],null);assert.equal(retyped.nativePairMap.at(-1),null);
 assert.deepEqual(retyped.nativePairPolicy.evidence,linkedProof);ok();
 assert.deepEqual(layoutEditedText(linkedTarget,linkedTarget.text,measure,{page:linkedPage,edits:{[linkedTarget.key]:value}}),{type:'noop'});ok();
 const undo=applyResultEdits(linkedDoc,{});assert.equal(undo,linkedDoc);assert.equal(await linkedWriter(undo),linkedOriginalXml);
 assert.deepEqual(linkedDoc,linkedOriginal);assert.deepEqual(linkedSource.nativePairSpacing,linkedProof);ok();
 linkedEdits.push({word,newOrdinal,sourceMap:edited.nativePairMap,oldTeAdjustmentRetained:false,
  runs:plan.map(r=>({text:r.item.text,spacing:r.spacing,kern:r.options.kern,x:r.x})),newAdvance:edited.advanceWidth,
  noForgedProvenanceAfterRetype:true,undoWriterXmlExact:true,unchangedDifferentFaceNeighbour:true});
}

const report={scope:'Independent invented words; actual layoutEditedText, applyResultEdits, Canvas and DOCX writer. No source/body fixture or reader vote.',checks,edits,linkedEdits,deleteUndoRestoresOriginal:true,unsupportedYaRemainsRejected:true};
console.log(JSON.stringify(report));

// Compatible source text in a proven native open grid may have a non-halfpoint
// nominal size. Source verification stays raw; serialized spacing uses actual
// halfpoint font metrics and bounds cumulative rounding at every original slot.
{
 const {nativePairRuns}=await import('../src/features/pdf-to-word/core/native-pair-spacing.js');
 const {runOptions}=await import('../src/features/pdf-to-word/adapters/text-layout.js');
 const plain=fixture('Variational','ABCDEF+NimbusRomNo9L-Regu',false,8.9664,50);assert.equal(plain.proof,null,'legacy source capture remains opt-in');ok();
 const {item,proof}=fixture('Variational','ABCDEF+NimbusRomNo9L-Regu',false,8.9664,50,true);assert(proof);assert.equal(proof.size,8.9664);assert(nativePairEditStyle(item));ok();
 const options=runOptions(item),parts=nativePairRuns(item,ctx,options);assert(parts&&parts.length>1&&parts.length<=8);assert.equal(options.size,18);ok();
 let cursor=0,index=0;
 for(const part of parts)for(const char of part.text){assert(Math.abs(cursor-proof.glyphs[index].offset)<=.05+1e-8);cursor+=textMetrics({...item,text:char},ctx).width+part.spacing/20;index++;}
 assert.equal(index,proof.glyphs.length);assert(Math.abs(cursor-proof.advance)<=.05+1e-8);ok();
 for(const mutate of[
  i=>i.nativePairSpacing.glyphs[1].offset+=.3,i=>i.nativePairSpacing.glyphs[0].advance+=.3,
  i=>i.nativePairSpacing.size+=.5,i=>i.font='UnknownFace',i=>i.nativePairSpacing.sourceFont='ABCDEF+NimbusRomNo9L-Medi',
  i=>i.horizontalScale=.9,i=>i.bold=true,i=>i.italic=true,i=>i.nativePairSpacing.glyphs[1]=null
 ]){const bad=structuredClone(item);mutate(bad);assert.equal(nativePairRuns(bad,ctx,runOptions(bad)),null,'raw source evidence and output identity remain mandatory');ok();}
 const noPermission=fixture('Teapot','ABCDEF+NimbusRomNo9L-Regu',false,12,50,true);assert.equal(noPermission.proof,null,'other source pair patterns are not enabled');ok();
}
console.log('Compatible native table pair: explicit admission, original non-halfpoint source, real serialized slot positions and refusal checks passed.');
