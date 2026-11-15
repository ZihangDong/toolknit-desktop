import assert from 'node:assert/strict';
import { withoutTextStrokeRules, provenTextStrokeRules } from '../src/features/pdf-to-word/core/ocr-rule-ownership.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const line={text:'国园',x:10,y:10,width:100,height:50,confidence:.99,
  words:[{text:'国',x:30,y:10,width:4,height:50},{text:'园',x:80,y:10,width:4,height:50}]};
const inside={axis:'h',at:25,from:20,to:45};
const crossing={axis:'h',at:25,from:20,to:90};
const underline={axis:'h',at:59,from:20,to:45};
const junction={axis:'v',at:20,from:20,to:60};
assert.deepEqual(withoutTextStrokeRules([inside],[line]),[]);
for(const rule of[crossing,underline])assert.deepEqual(withoutTextStrokeRules([rule],[line]),[rule]);
assert.deepEqual(withoutTextStrokeRules([inside,junction],[line]),[inside,junction]);
for(const change of[l=>l.confidence=.5,l=>l.words.reverse(),l=>l.text='Wrong',l=>l.words[0].width=NaN,
  l=>l.words[0].y=-100,l=>l.words=[null],l=>l.text=null,l=>l.width=20]){
  const probe=structuredClone(line);change(probe);
  assert.deepEqual(withoutTextStrokeRules([inside],[probe]),[inside],'unproven word membership must retain the rule');
}
const before=structuredClone(line);withoutTextStrokeRules([inside],[line]);assert.deepEqual(line,before);
const title={text:'施工合同',x:10,y:10,width:400,height:100,confidence:.99,
  words:[... '施工合同'].map((text,index)=>({text,x:40+index*100,y:10,width:10,height:100}))};
const titleStroke={axis:'h',at:40,from:12,to:103};
const titleBefore=structuredClone(title);
assert.deepEqual(withoutTextStrokeRules([titleStroke],[title]),[],
  'a bounded bold-title CTC drift cannot leave its character crossbar in the background');
const titleGrid={axis:'v',at:103,from:30,to:80};
assert.deepEqual(withoutTextStrokeRules([titleStroke,titleGrid],[title]),[titleStroke,titleGrid]);
const titleUnderline={...titleStroke,at:109};
assert.deepEqual(withoutTextStrokeRules([titleUnderline],[title]),[titleUnderline]);
assert.deepEqual(title,titleBefore);
assert.deepEqual(withoutTextStrokeRules([inside],[null]),[inside]);
const canvas=createCanvas(200,100),context=canvas.getContext('2d');
context.fillStyle='white';context.fillRect(0,0,200,100);context.fillStyle='black';
context.fillRect(20,25,26,2);context.fillRect(20,38,26,2);context.fillRect(20,25,2,15);
context.fillRect(75,25,20,15);
const pixels=context.getImageData(0,0,200,100).data;
const scene={number:1,width:200,height:100,items:[],sources:[],rules:[],risks:['image-page'],rasterPage:false,characters:0};
const result={width:200,height:100,lines:[line],rules:[inside]};
const erased=prepareOcrScene({scene,result,pixels,width:200,height:100,preserveGeometry:true});
assert(erased.changed);assert.equal(erased.pixels[(25*200+30)*4],255,
  'a recognized letter crossbar is removed from the source background before editable text is painted');
assert.equal(erased.scene.rules.length,0);
const native=prepareOcrScene({scene:{...scene,rules:[inside]},result,pixels,width:200,height:100,preserveGeometry:true});
assert.equal(native.pixels[(25*200+30)*4],0,'a genuine native PDF vector rule is never pruned');
assert.equal(native.scene.rules.length,1);
const grid=prepareOcrScene({scene,result:{...result,rules:[inside,junction]},pixels,width:200,height:100,preserveGeometry:true});
assert.equal(grid.pixels[(25*200+30)*4],0,'raster grid junctions retain the horizontal rule');
assert.equal(grid.scene.rules.length,2);
canvas.width=canvas.height=0;
{
 const word={text:'风',rect:{x:10,y:10,width:40,height:50},preciseInk:true,confidence:.99,ocrGlyphScore:.9};
 const stem={axis:'v',at:20,from:15,to:55},crossbar={axis:'h',at:25,from:15,to:45};
 assert.deepEqual([...provenTextStrokeRules([stem,crossbar],[word])],[stem,crossbar]);
 assert.equal(provenTextStrokeRules([{...stem,from:0}],[word]).size,0,'a true border extending beyond a letter cannot become its stem');
 assert.equal(provenTextStrokeRules([stem],[{...word,ocrGlyphScore:.7,ocrGlyphOwnershipScore:.9}]).size,1,
  'independent raw-ink identity proof does not require changing the chosen output font');
 for(const probe of [{...word,confidence:.5},{...word,ocrGlyphScore:.5},{...word,text:'口'},{...word,preciseInk:false}])
  assert.equal(provenTextStrokeRules([stem],[probe]).size,0,'ambiguous membership, shape and rectangular-only characters preserve rules');
}
{
 const c=createCanvas(2000,600),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,2000,600);
 ctx.fillStyle='#2E74B5';ctx.fontKerning='none';const lines=[];
 const draw=(text,px,baseline)=>{
  ctx.font=`bold ${px}px "Microsoft YaHei"`;const words=[];let x=35;
  for(const char of text){const m=ctx.measureText(char);ctx.fillText(char,x,baseline);
   words.push({text:char,x:x+m.width*.5-2,y:baseline-m.actualBoundingBoxAscent,width:4,
    height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence:.99});x+=m.width;}
  const m=ctx.measureText(text);lines.push({text,words,x:35-m.actualBoundingBoxLeft,y:baseline-m.actualBoundingBoxAscent,
   width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence:.99});
 };
 draw('风险监测预警信息',180,250);draw('正文内容',60,480);
 const pixels=ctx.getImageData(0,0,2000,600).data,rules=[];
 for(let x=35;x<1700;x+=3){let start=-1,last=-1;
  for(let y=40;y<=270;y++){
   if(y<270&&pixels[(y*2000+x)*4]<180){if(start<0)start=y;last=y;}
   else if(y===270||y-last>2){if(start>=0&&last-start>=90)rules.push({axis:'v',at:x,from:start,to:last});start=-1;}
  }
 }
 assert(rules.length>5,'the synthetic large title really creates long raster-rule candidates');
 const scene={number:1,width:2000/3,height:200,items:[],sources:[],rules:[],risks:['image-page'],characters:0};
 const before=structuredClone(lines),fit=createOcrTypography(createCanvas);let bodyCalls=0;
 const result=prepareOcrScene({scene,result:{width:2000,height:600,lines,rules},pixels,width:2000,height:600,
  preserveGeometry:true,measurementContext:ctx,fitTypography:input=>{if(input.line===lines[1])bodyCalls++;return fit(input);}});
 let oldInk=0;for(let y=40;y<280;y++)for(let x=25;x<1750;x++)if(Math.min(...result.pixels.slice((y*2000+x)*4,(y*2000+x)*4+3))<180)oldInk++;
 assert.equal(oldInk,0,'proven vertical title strokes must not survive whole-text deletion in the background');
 assert.equal(result.scene.rules.length,0,'letter stems do not become semantic table rules');
 assert(result.scene.items.filter(item=>item.type==='text').every(item=>item.words.every(word=>!Object.hasOwn(word,'ocrGlyphOwnershipScore'))),
  'temporary raw-ink proof must not bloat the saved document model');
 assert.equal(bodyCalls,1,'remote title rules must not trigger raw-ink retries on another row');
 assert.deepEqual(lines,before);
 const nativeRule={axis:'v',at:rules[0].at/3,from:rules[0].from/3,to:rules[0].to/3};
 const native=prepareOcrScene({scene:{...scene,rules:[nativeRule]},result:{width:2000,height:600,lines,rules},
  pixels,width:2000,height:600,preserveGeometry:true,measurementContext:ctx,fitTypography:fit});
 assert(native.scene.rules.includes(nativeRule),'a native vector keeps ownership even when it coincides with a matched glyph');
 const sample=(Math.round((rules[0].from+rules[0].to)/2)*2000+rules[0].at)*4;
 assert.deepEqual(native.pixels.slice(sample,sample+4),pixels.slice(sample,sample+4));
 c.width=c.height=0;
}
{
 const c=createCanvas(350,220),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,350,220);
 ctx.strokeStyle='black';ctx.lineWidth=2;const rules=[];
 for(const y of [20,110,200]){ctx.beginPath();ctx.moveTo(10,y);ctx.lineTo(330,y);ctx.stroke();rules.push({axis:'h',at:y,from:10,to:330});}
 for(const x of [10,170,330]){ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,200);ctx.stroke();rules.push({axis:'v',at:x,from:20,to:200});}
 ctx.fillStyle='black';ctx.font='42px "Microsoft YaHei"';ctx.fontKerning='none';const lines=[];
 for(const [row,labels]of [['甲方','乙方'],['金额','工期']].entries()){
  const baseline=85+row*90,words=[];
  for(const [col,label]of labels.entries()){
   let x=30+col*160;
   for(const text of label){const m=ctx.measureText(text);ctx.fillText(text,x,baseline);
    words.push({text,x:x-m.actualBoundingBoxLeft,y:baseline-m.actualBoundingBoxAscent,
     width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence:.99});x+=m.width;}
  }
  const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));
  lines.push({text:labels.join(''),words,x,y,width:Math.max(...words.map(w=>w.x+w.width))-x,
   height:Math.max(...words.map(w=>w.y+w.height))-y,confidence:.99});
 }
 const pixels=ctx.getImageData(0,0,350,220).data,before=structuredClone({lines,rules});
 const result=prepareOcrScene({scene:{number:1,width:350,height:220,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
  result:{width:350,height:220,lines,rules},pixels,width:350,height:220,preserveGeometry:true,
  measurementContext:ctx,fitTypography:createOcrTypography(createCanvas)});
 assert.equal(result.scene.rules.length,6,'a real two-by-two raster grid survives raw-glyph retries');
 const table=result.scene.items.find(item=>item.type==='table');assert(table,'real raster cells remain a structured Word table');
 assert.equal(table.cells.length,4);assert.deepEqual({lines,rules},before);
 const clean=ctx.createImageData(350,220);clean.data.set(result.pixels);ctx.putImageData(clean,0,0);
 const document=inferDocument([result.scene],{preserveGeometry:true});
 const output=await createWordBytes(document,await collectPageAssets(result.scene,c,createCanvas),
  {preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
 const xml=xml2js(await(await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string'));
 const nodes=(node,name)=>[...(node.name===name?[node]:[]),...(node.elements||[]).flatMap(child=>nodes(child,name))];
 const tables=nodes(xml,'w:tbl');assert.equal(tables.length,1,'the raster grid exports as a real Word table');
 assert.deepEqual(nodes(tables[0],'w:tc').map(cell=>nodes(cell,'w:t').flatMap(n=>n.elements||[]).map(n=>n.text||'').join('')),
  ['甲方','乙方','金额','工期'],'all original labels remain editable in their own cells');
 assert.equal(output.quality.characters,output.quality.editableCharacters,'split sources remain completely covered');
 c.width=c.height=0;
}
console.log('OCR rule ownership: old glyph strokes erased; real raster grids, cross-letter lines, underlines, native vectors and invalid evidence preserved.');
