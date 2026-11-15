import assert from 'node:assert/strict';
import {splitOcrTableCells} from '../src/features/pdf-to-word/core/ocr-table-cells.js';
import {ruledTableGrids,ruledTables} from '../src/features/pdf-to-word/core/tables.js';
import {groupLines} from '../src/features/pdf-to-word/core/text.js';
import {ocrSignatureFormGrids} from '../src/features/pdf-to-word/core/ocr-signature-forms.js';
import {union} from '../src/features/pdf-to-word/core/geometry.js';
import {inferDocument} from '../src/features/pdf-to-word/core/layout.js';
import {createWordBytes} from '../src/features/pdf-to-word/adapters/docx.js';
import {resultTargets,applyResultEdits} from '../src/features/pdf-to-word/core/result-edit.js';
import {createCanvas} from '@napi-rs/canvas';
import JSZip from 'jszip';

const rules=[20,110,200].map(at=>({axis:'h',at,from:10,to:330}))
  .concat([10,170,330].map(at=>({axis:'v',at,from:20,to:200})));
const grids=ruledTableGrids(rules);
function row(text='甲方 乙㎡',id='p1:ocr0',y=45){
 const labels=[...text].filter(c=>c.trim()),words=labels.map((text,i)=>({text,rect:{x:(i<2?30:190)+(i%2)*20,y,width:18,height:20},
  size:22,font:i<2?'SimSun':'Microsoft YaHei',bold:i>=2,preciseInk:true,baseline:y+19,confidence:.99}));
 return {id,type:'text',ocr:true,sourceIds:[id],text,rect:{x:30,y,width:218,height:20},baseline:y+19,baselineX:30,size:22,
  font:'SimSun',fontFamily:'SimSun',order:0,words,ocrOriginalText:text.replace('㎡','m'),
  ocrCorrections:[{word:3,original:'m',text:'㎡',rule:'source-ink-square-metre'}]};
}
const original=[row(),row('金额 工期','p1:ocr1',135)],before=structuredClone(original);
const result=splitOcrTableCells(original,grids);
assert.equal(result.text.length,4);assert.equal(result.sources.length,4);
assert.equal(result.text.map(item=>item.text).join(''),original.map(item=>item.text).join(''));
assert.deepEqual(original,before,'splitting does not mutate recognizer-derived geometry or styles');
for(const parent of original){
 const children=result.text.filter(item=>item.ocrParentId===parent.id);
 assert.equal(children[0].ocrTextRange[0],0);assert.equal(children.at(-1).ocrTextRange[1],parent.text.length);
 assert.equal(children[0].ocrTextRange[1],children[1].ocrTextRange[0]);
 assert(children.every(item=>parent.text.slice(...item.ocrTextRange)===item.text));
 assert.deepEqual(children.flatMap(item=>item.words),parent.words,'each calibrated word/style appears once');
 assert.equal(children.filter(item=>item.ocrCorrections).length,1,'parent-relative corrections are stored only once');
 assert.equal(children[0].ocrParentText,parent.text);
}
assert.equal(new Set(result.sources.map(source=>source.id)).size,4);
const tables=ruledTables(groupLines(result.text),rules,grids);
assert.equal(tables.length,1);assert.equal(tables[0].cells.length,4);
assert.equal(tables[0].sourceIds.length,4);
for(const bad of [
 {...original[0],ocrNative:true},
 {...original[0],words:original[0].words.map((w,i)=>i? w:{...w,rect:{x:168,y:45,width:5,height:20}})},
 {...original[0],words:original[0].words.map((w,i)=>i? w:{...w,preciseInk:false})},
 {...original[0],text:'unmatched'},
 {...original[0],words:original[0].words.map((w,i)=>i? w:{...w,rect:{...w.rect,width:0}})}
]){
 const input=[bad],saved=structuredClone(input),out=splitOcrTableCells(input,grids);
 assert.deepEqual(out.text,input,'unknown or boundary-crossing ownership retains the parent row');
 assert.equal(out.sources.length,0);assert.deepEqual(input,saved);
}
for(const maxExtra of [0,-1,NaN])assert.deepEqual(splitOcrTableCells(original,grids,{maxExtra}),{text:original,sources:[]});
const conflict=[original[0],{...original[1],id:'p1:ocr0:cell0',ocrNative:true}];
assert.deepEqual(splitOcrTableCells(conflict,grids).text,conflict,'existing source IDs are never overwritten');
const mergedRules=rules.map(rule=>rule.axis==='v'&&rule.at===170?{...rule,from:110}:rule);
const mergedGrids=ruledTableGrids(mergedRules),merged=splitOcrTableCells(original,mergedGrids);
assert.equal(merged.text.length,3,'a complete merged cell keeps its full row while the next row partitions');
const mergedTable=ruledTables(groupLines(merged.text),mergedRules,mergedGrids)[0];
assert.equal(mergedTable.cells.length,3);assert.equal(mergedTable.cells[0].colSpan,2);

// Open signature compartments need real cell ownership but no invented outer
// borders. Both complete label/date rows and the full divider must be proven.
const context=createCanvas(1,1).getContext('2d');context.font='1000px "SimSun"';
function formFixture(){
 const glyph=(text,x,baseline)=>{const m=context.measureText(text);return{text,size:12,font:'SimSun',
  baseline,baselineX:x,preciseInk:true,confidence:.999,
  rect:{x:x-m.actualBoundingBoxLeft*.012,y:baseline-m.actualBoundingBoxAscent*.012,
   width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*.012,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*.012}};};
 const words=(text,x,y,advance=12)=>[...text].map((c,i)=>glyph(c,x+i*advance,y));
 const row=(id,words)=>({id,type:'text',ocr:true,preciseInk:true,sourceIds:[id],words,
  text:words.map(w=>w.text).join(''),rect:union(words.map(w=>w.rect)),baseline:words[0].baseline,
  size:12,font:'SimSun',order:0});
 return{bounds:{x:0,y:0,width:350,height:200},
  text:[row('labels',[...words('甲方（盖章）',30,60),...words('乙方（签字）',205,60)]),
   row('dates',[...words('年月日',35,144,35),...words('年月日',205,144,35)])],
  rules:[{axis:'h',at:20,from:12,to:327},{axis:'h',at:160,from:10,to:330},{axis:'v',at:170,from:20,to:160}]};
}
const form=formFixture(),formBefore=structuredClone(form);
const open=ocrSignatureFormGrids(form.text,form.rules,form.bounds);
assert.equal(open.length,1);assert.equal(open[0].rows,1);assert(open[0].borderless);
assert.deepEqual(open[0].columnWidths,[160,160]);
assert.deepEqual(form,formBefore,'recognition does not modify source strokes or glyphs');
const neighbouringEdge=formFixture();neighbouringEdge.rules[1].to=322;
neighbouringEdge.rules.push({axis:'v',at:322,from:145,to:200});
assert.equal(ocrSignatureFormGrids(neighbouringEdge.text,neighbouringEdge.rules,neighbouringEdge.bounds).length,1,
 'a short edge meeting a horizontal endpoint belongs to the retained backdrop');
const parts=splitOcrTableCells(form.text,open),forms=ruledTables(groupLines(parts.text),form.rules,open);
assert.equal(parts.text.length,4);assert.equal(forms.length,1);assert.equal(forms[0].cells.length,2);
assert.equal(parts.text.map(p=>p.text).join(''),form.text.map(p=>p.text).join(''));
const formDoc=inferDocument([{number:1,width:350,height:200,items:forms,sources:parts.sources,
 rules:form.rules,risks:['ocr'],characters:form.text.reduce((n,p)=>n+p.text.length,0)}],{preserveGeometry:true});
const exportForm=async doc=>{const r=await createWordBytes(doc,[],{preserveGeometry:true,measurementContext:context});
 return (await JSZip.loadAsync(r.bytes)).file('word/document.xml').async('string');};
const formXml=await exportForm(formDoc);
assert.equal((formXml.match(/<w:tbl>/g)||[]).length,1);assert.equal((formXml.match(/<w:tc>/g)||[]).length,2);
assert(!/<w:(?:top|bottom|left|right) w:val="single"/u.test(formXml),'source backdrop retains visible borders; logical outer sides stay invisible');
const firstLabel=resultTargets(formDoc.pages[0]).find(t=>t.text==='甲方（盖章）');assert(firstLabel);
const formOriginal=structuredClone(formDoc),removed=applyResultEdits(formDoc,{[firstLabel.key]:{type:'delete'}});
assert(!resultTargets(removed.pages[0]).some(t=>t.text==='甲方（盖章）'));
assert(resultTargets(removed.pages[0]).some(t=>t.text==='乙方（签字）'));
assert.equal((await exportForm(removed)).match(/<w:tc>/g).length,2);
assert.deepEqual(formDoc,formOriginal,'editing one cell does not mutate the baseline or its neighbour');
for(const change of [
 f=>{f.rules.pop();},f=>{f.rules[2].to-=5;},f=>{f.rules[1].from+=20;},
 f=>{f.rules.push({axis:'v',at:250,from:20,to:160});},
 f=>{f.text[0].words[0].preciseInk=false;},
 f=>{f.text[0].ocrNative=true;},f=>{f.text[0].words[0].rect.x=169;},
 f=>{f.text[0].text='different';},f=>{f.text[1].words[0].text='目';f.text[1].text=f.text[1].words.map(w=>w.text).join('');},
 f=>{f.text[1].words.forEach(w=>{w.baseline-=60;w.rect.y-=60;});f.text[1].rect.y-=60;},
]){const f=formFixture();change(f);const before=structuredClone(f);
 assert.equal(ocrSignatureFormGrids(f.text,f.rules,f.bounds).length,0,'unknown, incomplete, uncalibrated or ambiguous forms retain their prior representation');
 assert.deepEqual(f,before);}
console.log('OCR table cells: unique calibrated ownership, merged cells, exact text/ranges/styles, single parent evidence, source-ID safety and bounded fallback passed.');
