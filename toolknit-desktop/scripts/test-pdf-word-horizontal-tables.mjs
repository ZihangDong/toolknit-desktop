import assert from 'node:assert/strict';
import { prepareHorizontalTables, horizontalTableRule } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument,validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { LIMITS } from '../src/features/pdf-to-word/core/input.js';

function fixture() {
  const text=[['Label','Count','Price','Total'],['Paper','12','24.50','294'],['Pens','3','15.75','47.25'],['Books','25','7.25','181.25']]
    .map((row,index)=>{
      const baseline=index?44+index*20:26;
      const words=row.map((value,col)=>({text:value,spaceBefore:Boolean(col),rect:{x:20+col*80,y:baseline-8,width:value.length*5,height:8},baselineX:20+col*80,advanceWidth:value.length*5}));
      return {id:'p1:t'+index,sourceIds:['p1:t'+index],text:row.join(' '),rect:{x:20,y:baseline-8,width:240+words.at(-1).rect.width,height:8},
        baseline,size:10,font:'Arial',color:'000000',order:index,preciseInk:true,words};
    });
  const rules=[{axis:'h',at:10,from:10,to:330},{axis:'h',at:42,from:10,to:330},{axis:'h',at:112,from:10,to:330}];
  const graphics=rules.map((rule,index)=>({id:'d'+index,rect:{x:10,y:rule.at-.25,width:320,height:.5},decoration:true,thin:true,opaque:true}));
  const sources=text.map(item=>({id:item.id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
  return {text,rules,graphics,sources,bounds:{x:0,y:0,width:350,height:140}};
}
const data=fixture(),original=structuredClone(data),prepared=prepareHorizontalTables(data.text,data.graphics,data.rules,data.sources,data.bounds);
assert.equal(prepared.tables.length,1);const table=prepared.tables[0];
assert.equal(table.rows,4);assert.equal(table.columnWidths.length,4);assert.equal(table.cells.length,16);
assert.equal(data.sources.length,16,'one source drawing containing four values becomes four independently owned cells');
assert.equal(new Set(data.sources.map(source=>source.id)).size,16);
assert.equal(data.sources.map(source=>source.text).join('').replace(/\s/g,''),original.sources.map(source=>source.text).join('').replace(/\s/g,''));
assert.deepEqual(data.text,original.text,'the caller owns the original extraction array');
assert(data.graphics.every(item=>horizontalTableRule(item,table)));
const grouped=groupPageRegions(prepared.text,data.graphics,data.rules,data.sources,{horizontalTables:prepared.tables,bounds:data.bounds});
assert.equal(grouped.items.filter(item=>item.type==='table').length,1);
assert.equal(grouped.drawingOwnership.filter(owner=>owner.owner==='table').length,0,'native horizontal rules remain separate original image assets');
const document=inferDocument([{number:1,width:350,height:140,items:grouped.items.filter(item=>item.type==='table'),sources:data.sources,rules:data.rules,risks:[],characters:original.sources.reduce((sum,s)=>sum+s.text.replace(/\s/g,'').length,0)}],{preserveGeometry:true});
assert.equal(validateCoverage(document).imageCharacters,0);
const generated=await createWordBytes(document,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
const xml=await(await JSZip.loadAsync(generated.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);assert.equal((xml.match(/<w:tc>/g)||[]).length,16);
assert(xml.includes('294')&&xml.includes('181.25'));
const corrected=fixture();
corrected.sources.forEach(source=>{let offset=0;source.encodingCorrections=[...source.text].map((to,glyph)=>{
  const result={glyph,textRange:[offset,offset+to.length],from:'?',to,rule:'fixture-outline'};offset+=to.length;return result;
});});
const correctedBefore=structuredClone(corrected.sources),correctedTable=prepareHorizontalTables(corrected.text,corrected.graphics,corrected.rules,corrected.sources,corrected.bounds);
assert.equal(correctedTable.tables.length,1,'fully traced encoding repairs can be partitioned into real cells');
assert.equal(corrected.sources.flatMap(source=>source.encodingCorrections).length,correctedBefore.flatMap(source=>source.encodingCorrections).length,
  'each original correction, including whitespace, is retained once rather than copied to every child');
const repairedSlots=new Set();
for(const child of corrected.sources){
  const parent=correctedBefore.find(source=>source.id===child.splitFrom);
  assert.equal(parent.text.slice(...child.sourceRange),child.text);
  for(const correction of child.encodingCorrections){
    assert.equal(correction.sourceId,parent.id);
    assert.equal(parent.text.slice(...correction.textRange),correction.to);
    const slot=correction.sourceId+'/'+correction.glyph;assert(!repairedSlots.has(slot));repairedSlots.add(slot);
    if(correction.betweenParts)assert(/^\s+$/u.test(correction.to));
    else assert(correction.textRange[0]>=child.sourceRange[0]&&correction.textRange[1]<=child.sourceRange[1]);
  }
}
for(const damage of [d=>{d.sources[1].encodingCorrections[0].textRange=[1,2];},
  d=>{d.sources[1].encodingCorrections[1].glyph=0;},d=>{d.sources[1].encodingCorrections[0].to='invented';}]){
  const input=fixture();input.sources=structuredClone(correctedBefore);damage(input);const before=structuredClone(input.sources);
  assert.equal(prepareHorizontalTables(input.text,input.graphics,input.rules,input.sources,input.bounds).tables.length,0);
  assert.deepEqual(input.sources,before,'unproven provenance cannot mutate sources or create a table');
}
const cjk=fixture(),cjkRows=[['项目','数量','单价','金额'],['纸张','12','24.50','294'],['签字笔','3','15.75','47.25'],['笔记本','25','7.25','181.25']];
cjk.text=cjk.text.map((item,row)=>{
  const words=cjkRows[row].flatMap((value,col)=>{let x=20+col*80;return [...value].map((text,index)=>{
    const width=/\p{Script=Han}/u.test(text)?10:5,word={text,spaceBefore:col>0&&index===0,rect:{x,y:item.baseline-8,width,height:8},baselineX:x,advanceWidth:width};x+=width;return word;
  });});
  return {...item,font:'SimSun',text:cjkRows[row].join(' '),words,rect:{...item.rect,width:words.at(-1).rect.x+words.at(-1).rect.width-item.rect.x}};
});
cjk.sources=cjk.text.map(item=>({id:item.id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
const chinese=prepareHorizontalTables(cjk.text,cjk.graphics,cjk.rules,cjk.sources,cjk.bounds);
assert.equal(chinese.tables.length,1,'CJK glyph positions still form Chinese labels and complete decimal values');
assert.deepEqual(chinese.tables[0].cells.map(cell=>cell.blocks.flatMap(block=>block.lines).map(line=>line.text.replace(/\s/g,'')).join('')),cjkRows.flat());
const chineseDocument=inferDocument([{number:1,width:350,height:140,items:chinese.tables,sources:cjk.sources,rules:cjk.rules,risks:[],characters:cjkRows.flat().join('').length}],{preserveGeometry:true});
const chineseOutput=await createWordBytes(chineseDocument,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
const chineseXml=await(await JSZip.loadAsync(chineseOutput.bytes)).file('word/document.xml').async('string');
assert.deepEqual([...chineseXml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(cell=>[...cell[1].matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/gs)].map(value=>value[1]).join('').replace(/\s/g,'')),cjkRows.flat(),'the actual DOCX keeps every Chinese label and complete numeric value in its own cell');
const limited=fixture();
while(limited.sources.length<LIMITS.itemsPerPage)limited.sources.push({id:'padding'+limited.sources.length,text:'',disposition:'excluded-hidden'});
assert.equal(prepareHorizontalTables(limited.text,limited.graphics,limited.rules,limited.sources,limited.bounds).tables.length,0,'word partitions retain the existing per-page source cap');
assert.equal(limited.sources.length,LIMITS.itemsPerPage);
for(const change of [
  d=>{d.rules.pop();},
  d=>{d.text=d.text.slice(0,3);},
  d=>{d.text[2].words[2].rect.x+=25;},
  d=>{d.text[1].words.reverse();},
  d=>{d.text[1].words[0].text='wrong';},
  d=>{d.rules.push({axis:'v',at:90,from:10,to:112});},
  d=>{d.graphics[0].opaque=false;},
  d=>{d.graphics.push({rect:{x:30,y:50,width:40,height:30}});},
  d=>{d.sources[1].disposition='excluded-hidden';},
  d=>{d.sources[1].encodingCorrections=[{}];},
  d=>{d.sources.push({...d.sources[1],id:'redraw',disposition:'redraw',equivalentTo:d.sources[1].id});},
  d=>{d.text[0].rect.y=8;},
]){
  const value=fixture();change(value);const before=structuredClone(value.sources);
  assert.equal(prepareHorizontalTables(value.text,value.graphics,value.rules,value.sources,value.bounds).tables.length,0,'unproven columns, source identity, graphics or rule boundaries cannot create a table');
  assert.deepEqual(value.sources,before,'a rejected candidate cannot mutate the source ledger');
}
console.log('Horizontal-rule tables: source partitions, native editable cells, original rules, independent columns and conservative rejection passed.');
