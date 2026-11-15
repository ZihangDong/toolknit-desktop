import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { prepareHorizontalTables } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { groupedHeaderBands } from '../src/features/pdf-to-word/core/grouped-horizontal-tables.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

function fixture(partial = false) {
  const text = [], rules = [], top = 10, end = partial ? 140 : 134, width = partial ? 240 : 280;
  const add = (value, center, baseline) => {
    if (!value) return;
    const id = 'p1:t'+text.length, w=value.length*4;
    text.push({ id, sourceIds:[id], text:value, size:8, font:'Arial', color:'000000',
      preciseInk:true, order:text.length, baseline, baselineX:center-w/2,
      rect:{x:center-w/2,y:baseline-6,width:w,height:6} });
  };
  const rule = (at, from=10, to=10+width) => rules.push({axis:'h',at,from,to});
  rule(top);
  if (partial) {
    add('Input Rates',70,24);add('Output Scores',190,24);
    ['A','B','C','Main'].forEach((v,i)=>add(v,30+i*40,38));add('Extras',210,38);
    add('Fit',150,52);add('Tune',190,52);add('Feature',230,52);
    rule(28,10,128);rule(28,132,250);
    rule(58,10,128);rule(58,132,168);rule(58,172,250);
    for(let row=0;row<6;row++)for(let col=0;col<6;col++)add(String(11+row*2+col),30+col*40,72+row*12);
  } else {
    add('System',65,24);add('Dev',168.5,24);add('Test',250,24);
    ['EM','F1','EM','F1'].forEach((v,i)=>add(v,150+i*40,38));rule(44);
    const data=[['Section One'],['ModelAlphaConfiguration','-','-','74.1','80.4'],
      ['ModelBetaConfiguration','22.3','31.5','75.6','81.3'],['Section Two'],
      ['ModelGammaConfiguration','23.2','','76.2','82.1'],['ModelDeltaConfiguration','24.4','33.3','77.3','83.7']];
    data.forEach((row,i)=>row.length===1?add(row[0],150,56+i*14):row.forEach((v,col)=>add(v,col?150+(col-1)*40:20+v.length*2,56+i*14)));
    rule(90);
  }
  rule(end);
  const graphics=rules.map((r,i)=>({id:'d'+i,decoration:true,thin:true,opaque:true,
    rect:{x:r.from,y:r.at-.25,width:r.to-r.from,height:.5}}));
  const sources=text.map(t=>({id:t.id,text:t.text,rect:t.rect,disposition:'editable'}));
  return {text,graphics,rules,sources,bounds:{x:0,y:0,width:width+20,height:end+20}};
}
const contents = c => c.blocks.flatMap(p=>p.lines).map(l=>l.text).join('');
for(const partial of [false,true]){
  const data=fixture(partial),before=structuredClone(data);
  const prepared=prepareHorizontalTables(data.text,data.graphics,data.rules,data.sources,data.bounds);
  assert.equal(prepared.tables.length,1,partial?'three header levels use actual partial rules':'section rows preserve sparse values and real blanks');
  const table=prepared.tables[0];assert.equal(table.rows,partial?9:8);assert.equal(table.columnWidths.length,partial?6:5);
  assert.equal(table.cells.length,partial?49:30);
  assert.deepEqual(data,before,'source inputs are unchanged when no operation needs partitioning');
  assert.deepEqual(new Set(table.sourceIds),new Set(data.text.map(t=>t.id)));
  if(partial){
    assert.equal(table.cells.find(c=>c.row===0&&c.col===0).colSpan,3);
    assert.equal(table.cells.find(c=>c.row===0&&c.col===3).colSpan,3);
    assert.equal(table.cells.find(c=>c.row===1&&c.col===4).colSpan,2);
    assert(table.nativeRules.some(r=>r.to-r.from<40),'the short header rule remains owned');
  }else{
    assert.equal(contents(table.cells.find(c=>c.row===6&&c.col===2)),'');
    assert.equal(contents(table.cells.find(c=>c.row===3&&c.col===1)),'-');
    assert.equal(table.cells.find(c=>c.row===2&&c.col===0).colSpan,5);
    assert.equal(table.cells.find(c=>c.row===5&&c.col===0).colSpan,5);
  }
  const scene={number:1,width:data.bounds.width,height:data.bounds.height,items:[table],sources:data.sources,rules:data.rules,risks:[]};
  const document=inferDocument([scene],{preserveGeometry:true});validateCoverage(document);
  const result=await createWordBytes(document,[],{preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
  const xml=await(await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);assert.equal((xml.match(/<w:tc>/g)||[]).length,table.cells.length);
  for(const mutate of [
    d=>{d.graphics.push({id:'picture',rect:{x:20,y:65,width:30,height:20}});},
    d=>{d.sources[0].disposition='visible-image';},
    d=>{d.text[0].alphabet='script';},
    d=>{d.text[0].rect.x=5;},
  ]){
    const invalid=fixture(partial);mutate(invalid);const original=structuredClone(invalid);
    assert.equal(prepareHorizontalTables(invalid.text,invalid.graphics,invalid.rules,invalid.sources,invalid.bounds).tables.length,0,`partial=${partial}: ${mutate}`);
    assert.deepEqual(invalid,original,'rejected evidence cannot claim or mutate source content');
  }
}
assert.deepEqual(groupedHeaderBands(Array.from({length:1501},(_,i)=>({axis:'h',at:i,from:0,to:200}))),[],'excessive rules retain the existing bounded fallback');
console.log('Grouped tables: complete editable cells, source sections, real blanks/dashes, three header levels, short rules, source ownership and conservative rejection passed.');
