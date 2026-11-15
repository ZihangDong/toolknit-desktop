import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareHorizontalTables } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { indexedRuleBands } from '../src/features/pdf-to-word/core/indexed-horizontal-tables.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { resultTargets, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';

function fixture(){
  const rows=[['Item','No.','Description'],['1','Work','detail'],['2','Another','description'],
    ['Continued','explanation'],['3','Third','requirement'],['4','Final','requirement']];
  const baselines=[24,50,85,100,130,175];
  const text=rows.map((row,i)=>{
    const xs=i===0?[25,50,95]:i===3?[95,155]:[30,95,155];
    const words=row.map((text,col)=>({text,spaceBefore:col>0,rect:{x:xs[col],y:baselines[i]-8,width:text.length*5,height:8},baselineX:xs[col],advanceWidth:text.length*5}));
    return {id:'p1:t'+i,sourceIds:['p1:t'+i],text:row.join(' '),words,baseline:baselines[i],baselineX:xs[0],
      size:10,font:'Arial',color:'000000',preciseInk:true,order:i,
      rect:{x:xs[0],y:baselines[i]-8,width:words.at(-1).rect.x+words.at(-1).rect.width-xs[0],height:8}};
  });
  const rules=[...[10,10.4,240].flatMap(at=>[{axis:'h',at,from:20,to:80},{axis:'h',at,from:80,to:370}]),{axis:'h',at:30,from:20,to:370}];
  const graphics=rules.map((r,i)=>({id:'rule'+i,type:'image',sourceIds:[],decoration:true,thin:true,opaque:true,
    rect:{x:r.from,y:r.at-.15,width:r.to-r.from,height:.3}}));
  const sources=text.map(item=>({id:item.id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
  return {text,rules,graphics,sources,bounds:{x:0,y:0,width:400,height:280}};
}
const value=fixture(),before=structuredClone(value),bands=indexedRuleBands(value.rules);
assert.equal(bands.length,1,'touching fragments and double header rules form a bounded three-rule band');
assert.equal(bands[0][0].at,10,'a double rule keeps an actual source boundary rather than an invented midpoint');
assert.equal(bands[0].nativeRules.length,7,'original split lines stay available for pixel ownership');
const prepared=prepareHorizontalTables(value.text,value.graphics,value.rules,value.sources,value.bounds);
assert.equal(prepared.tables.length,1);const table=prepared.tables[0];
assert.equal(table.rows,5);assert.equal(table.cells.length,10);assert.equal(table.columnWidths.length,2);
assert.deepEqual(table.cells.filter(c=>c.col===0).map(c=>c.blocks.flatMap(b=>b.lines).map(l=>l.text).join('').replace(/\s/g,'')),['ItemNo.','1','2','3','4']);
assert.equal(table.cells.find(c=>c.row===2&&c.col===1).blocks.flatMap(b=>b.lines).length,2,'wrapped prose remains in the same indexed row');
assert.deepEqual(value.text,before.text,'caller extraction is immutable');
assert.equal(value.sources.map(s=>s.text).join('').replace(/\s/g,''),before.sources.map(s=>s.text).join('').replace(/\s/g,''));
const grouped=groupPageRegions(prepared.text,value.graphics,value.rules,value.sources,{horizontalTables:prepared.tables,bounds:value.bounds});
assert.equal(grouped.items.filter(i=>i.type==='table').length,1);
assert.equal(grouped.items.filter(i=>i.type==='image').flatMap(i=>i.sourceIds).length,0,'line images cannot reclaim editable table letters');
const doc=inferDocument([{number:1,width:400,height:280,items:[table],sources:value.sources,rules:value.rules,risks:[],characters:0}],{preserveGeometry:true});
assert.equal(validateCoverage(doc).imageCharacters,0);
const output=await createWordBytes(doc,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
const xml=await(await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);assert.equal((xml.match(/<w:tc>/g)||[]).length,10);
assert(xml.includes('Continued')&&xml.includes('explanation'));
const target=resultTargets(doc.pages[0]).find(t=>t.type==='text'&&t.text.includes('Another'));
assert(target);const deleted=applyResultEdits(doc,{[target.key]:{type:'delete'}});
assert(!resultTargets(deleted.pages[0]).some(t=>t.key===target.key));
assert.equal(deleted.pages[0].blocks[0].cells.length,10,'deleting prose retains the actual grid and other cells');
for(const damage of [
  d=>{d.text[0].words[0].text='Notes';d.text[0].text='Notes No. Description';},
  d=>{d.text[4].text='8 Third requirement';d.text[4].words[0].text='8';},
  d=>{d.rules=d.rules.filter(r=>r.at!==240);},
  d=>{d.rules=d.rules.map(r=>r.from===80?{...r,from:84}:r);},
  d=>{d.text[3].words[0].rect.x=50;d.text[3].rect.x=50;},
  d=>{d.graphics.push({rect:{x:120,y:75,width:30,height:20},sourceIds:[]});},
  d=>{d.rules.push({axis:'v',at:80,from:10,to:240});},
]){
  const data=fixture();damage(data);const original=structuredClone(data.sources);
  assert.equal(prepareHorizontalTables(data.text,data.graphics,data.rules,data.sources,data.bounds).tables.length,0,'ambiguous lists, rows, gaps and graphics cannot create an indexed table');
  assert.deepEqual(data.sources,original);
}
console.log('Indexed tables: split rules, long bodies, named header, consecutive indices, wrapped text, real DOCX cells and conservative rejection passed.');

function exampleFixture(){
  const data=fixture(),rows=[['Category','Examples'],['Email','Messages','Clients'],['Country','Local','Teams'],
    ['Continued','explanation'],['People','Students','Workers'],['Devices','Computers','Phones']];
  data.text=data.text.map((item,i)=>{
    const xs=i===0?[25,180]:i===3?[180,240]:[30,180,240];
    const words=rows[i].map((text,col)=>({text,spaceBefore:col>0,rect:{x:xs[col],y:item.baseline-8,width:text.length*5,height:8},baselineX:xs[col],advanceWidth:text.length*5}));
    return {...item,text:rows[i].join(' '),words,rect:{x:xs[0],y:item.baseline-8,width:words.at(-1).rect.x+words.at(-1).rect.width-xs[0],height:8}};
  });
  data.rules=data.rules.map(r=>({...r,from:r.from===80?160:r.from,to:r.to===80?160:r.to}));
  data.graphics=data.rules.map((r,i)=>({id:'rule'+i,type:'image',sourceIds:[],decoration:true,thin:true,opaque:true,rect:{x:r.from,y:r.at-.15,width:r.to-r.from,height:.3}}));
  data.sources=data.text.map(item=>({id:item.id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
  return data;
}
const examples=exampleFixture(),exampleResult=prepareHorizontalTables(examples.text,examples.graphics,examples.rules,examples.sources,examples.bounds);
assert.equal(exampleResult.tables.length,1);const exampleTable=exampleResult.tables[0];
assert(exampleTable.id.endsWith(':example-horizontal-table'));assert.equal(exampleTable.cells.length,10);
assert.equal(exampleTable.columnWidths[0],140,'the original repeated column endpoint controls the column width, not the broad textual gutter');
assert.equal(exampleTable.cells.find(c=>c.row===2&&c.col===1).blocks.flatMap(b=>b.lines).length,2);
const exampleDoc=inferDocument([{number:1,width:400,height:280,items:[exampleTable],sources:examples.sources,rules:examples.rules,risks:[],characters:0}],{preserveGeometry:true});
const exampleBytes=await createWordBytes(exampleDoc,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
const exampleXml=await(await JSZip.loadAsync(exampleBytes.bytes)).file('word/document.xml').async('string');
assert.equal((exampleXml.match(/<w:tc>/g)||[]).length,10);assert(exampleXml.includes('Country')&&exampleXml.includes('Continued'));
for(const damage of [
  d=>{d.rules=d.rules.filter(r=>r.at!==240).concat({axis:'h',at:240,from:20,to:370});},
  d=>{d.text[0].words[1].text='Details';d.text[0].text='Category Details';},
  d=>{d.text[1].words[0].text='email';d.text[1].text='email Messages Clients';},
  d=>{d.text[1].words[0].rect.width=120;},
  d=>{d.text[2].words[1].rect.x=195;},
  d=>{d.text[3].words[0].rect.x=145;},
]){
  const input=exampleFixture();damage(input);const before=structuredClone(input.sources);
  assert.equal(prepareHorizontalTables(input.text,input.graphics,input.rules,input.sources,input.bounds).tables.length,0,'incomplete column evidence or ambiguous example rows stay in their original representation');
  assert.deepEqual(input.sources,before);
}
console.log('Example tables: independent repeated rule endpoint, stable short labels, aligned wrapped examples, real DOCX and ambiguous-row rejection passed.');

function labelledFixture() {
  const data=exampleFixture();
  data.text=data.text.slice(1).map((item,i)=>{
    const words=item.words.map(word=>({...word,bold:word.rect.x<160,italic:false}));
    if(i===2)words.unshift({text:'control',spaceBefore:false,bold:true,italic:false,baselineX:30,advanceWidth:35,
      rect:{x:30,y:item.baseline-8,width:35,height:8}});
    return {...item,words,text:words.map(word=>word.text).join(' '),rect: {
      x:words[0].rect.x,y:item.baseline-8,width:words.at(-1).rect.x+words.at(-1).rect.width-words[0].rect.x,height:8}};
  });
  data.rules=data.rules.filter(rule=>rule.at!==30);
  data.graphics=data.rules.map((rule,i)=>({id:'line'+i,type:'image',sourceIds:[],decoration:true,thin:true,opaque:true,
    rect:{x:rule.from,y:rule.at-.15,width:rule.to-rule.from,height:.3}}));
  data.sources=data.text.map(item=>({id:item.id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
  return data;
}
const labelled=labelledFixture(),labelledBefore=structuredClone(labelled.text);
const labelResult=prepareHorizontalTables(labelled.text,labelled.graphics,labelled.rules,labelled.sources,labelled.bounds);
assert.equal(labelResult.tables.length,1);
const labelTable=labelResult.tables[0];
assert(labelTable.id.endsWith(':labelled-horizontal-table'));
assert.equal(labelTable.rows,4);assert.equal(labelTable.cells.length,8,'an unheaded table cannot gain a synthetic header row');
assert.equal(labelTable.columnWidths[0],140);
const wrapped=labelTable.cells.find(cell=>cell.row===1&&cell.col===0);
assert.equal(wrapped.blocks.flatMap(block=>block.lines).length,2,'a lowercase continuation belongs to the same bold label');
assert.equal(labelTable.cells.find(cell=>cell.row===1&&cell.col===1).blocks.flatMap(block=>block.lines).length,2);
assert.deepEqual(labelled.text,labelledBefore,'the caller text and word styles remain immutable');
const labelDocument=inferDocument([{number:1,width:400,height:280,items:[labelTable],sources:labelled.sources,rules:labelled.rules,risks:[],characters:0}],{preserveGeometry:true});
const labelBytes=await createWordBytes(labelDocument,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
const labelXml=await(await JSZip.loadAsync(labelBytes.bytes)).file('word/document.xml').async('string');
assert.equal((labelXml.match(/<w:tc>/g)||[]).length,8);assert(labelXml.includes('control')&&labelXml.includes('Continued'));
for(const damage of [
  data=>{data.rules.push({axis:'h',at:30,from:20,to:370});},
  data=>{data.rules=data.rules.filter(rule=>rule.at!==240).concat({axis:'h',at:240,from:20,to:370});},
  data=>{data.text[0].words[0].bold=false;},
  data=>{data.text[0].words[1].bold=true;},
  data=>{data.text[0].words[1].rect.x=200;},
  data=>{data.text[1].words[0].rect.width=135;},
  data=>{data.rules.push({axis:'v',at:160,from:10,to:240});},
  data=>{data.graphics.push({rect:{x:180,y:60,width:20,height:10},sourceIds:[]});},
]){
  const input=labelledFixture();damage(input);const before=structuredClone(input.sources);
  assert.equal(prepareHorizontalTables(input.text,input.graphics,input.rules,input.sources,input.bounds).tables.length,0,
    'unheaded label tables require original column support, distinct typography and complete row ownership');
  assert.deepEqual(input.sources,before);
}
console.log('Unheaded label tables: actual outer rules/column endpoint, bold row labels, wrapped cells, no invented header, real DOCX and conservative rejection passed.');
