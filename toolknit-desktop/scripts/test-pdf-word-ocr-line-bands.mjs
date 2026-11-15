import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { planOcrLineBands } from '../src/features/pdf-to-word/core/ocr-line-bands.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';

const canvas=createCanvas(400,240),context=canvas.getContext('2d');
context.fillStyle='white';context.fillRect(0,0,400,240);
context.strokeStyle='#999';context.lineWidth=2;context.strokeRect(40,30,300,170);
context.fillStyle='black';context.font='40px "Times New Roman"';context.fontKerning='none';
const lines=[['Computer',80,100,{x:70,y:60,width:260,height:70}],['Self-Efficacy',65,150,{x:55,y:100,width:290,height:70}]]
  .map(([text,start,baseline,rect])=>{
    let x=start;const words=[];
    for(const character of text){const m=context.measureText(character);context.fillText(character,x,baseline);
      words.push({text:character,x:x+m.width*.35,y:rect.y,width:Math.max(1,m.width*.3),height:rect.height,confidence:1});x+=m.width;}
    return {...rect,text,confidence:1,words};
  });
const pixels=context.getImageData(0,0,400,240).data,before=structuredClone(lines);
const inkAt=(x,y)=>Math.min(pixels[(y*400+x)*4],pixels[(y*400+x)*4+1],pixels[(y*400+x)*4+2])<220;
const bands=planOcrLineBands(lines,{width:400,height:240,inkAt});
assert.equal(bands.size,2);assert.equal(bands.get(0).bottom,bands.get(1).top);
assert(bands.get(0).bottom>105&&bands.get(0).bottom<125,'the split lies in source whitespace between the two real text rows');
assert.equal(bands.get(0).rules.length,4,'a complete gray rectangle needs all four original corner junctions');
assert.deepEqual(lines,before,'line ownership cannot mutate recognized text, confidence, polygons or CTC positions');
const prepared=prepareOcrScene({scene:{number:1,width:400,height:240,sources:[],items:[],rules:[],risks:['image-page'],characters:0},
  result:{width:400,height:240,lines,rules:[]},pixels,width:400,height:240,preserveGeometry:true,
  measurementContext:createCanvas(1,1).getContext('2d'),fitTypography:createOcrTypography(createCanvas)});
assert(prepared.changed);
assert.equal(prepared.scene.items.filter(item=>item.type==='text').length,2);
assert.equal(prepared.scene.items.filter(item=>item.type==='table').length,0,'a local measurement frame cannot become an invented Word table');
assert.equal(prepared.scene.rules.length,0,'local picture borders stay outside the semantic table-rule ledger');
for(const item of prepared.scene.items.filter(item=>item.type==='text')){
  assert(item.rect.height<45,'a row cannot take the adjacent row into its font bounds');
  assert(item.size<52,'detector padding and a gray picture border cannot inflate the text size');
}
for(const [x,y]of [[40,50],[340,50],[80,30],[80,200]])for(let c=0;c<4;c++)
  assert.equal(prepared.pixels[(y*400+x)*4+c],pixels[(y*400+x)*4+c],'source gray frame pixels survive erasure');
for(const [x1,y1,x2,y2]of [[78,70,260,109],[63,121,270,159]]){
  let remaining=0;
  for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)if(prepared.pixels[(y*400+x)*4]<200)remaining++;
  assert.equal(remaining,0,'old row ink is removed without retaining a second image copy');
}
assert.deepEqual(lines,before);

assert.equal(planOcrLineBands(lines,{width:400,height:240,inkAt:()=>false}).size,0,'empty source pixels prove no row split');
assert.equal(planOcrLineBands(lines,{width:400,height:240,inkAt:()=>true}).size,0,'solid artwork cannot prove a whitespace boundary');
const columns=structuredClone(lines);columns[1].x=345;columns[1].width=40;
assert.equal(planOcrLineBands(columns,{width:400,height:240,inkAt}).size,0,'separate columns cannot reassign each other’s ink');
const sameBaseline=structuredClone(lines);sameBaseline[1].y=61;
assert.equal(planOcrLineBands(sameBaseline,{width:400,height:240,inkAt}).size,0,'side-by-side fragments on the same line are not separate rows');
const openFrame=planOcrLineBands(lines,{width:400,height:240,inkAt:(x,y)=>y>=198?false:inkAt(x,y)});
assert([...openFrame.values()].every(band=>band.rules.length===0),'missing frame edges cannot authorize local rule preservation');
const singleGlyphs=structuredClone(lines);singleGlyphs.forEach(line=>{line.text='A';line.words=line.words.slice(0,1);});
assert([...planOcrLineBands(singleGlyphs,{width:400,height:240,inkAt}).values()].every(band=>!band.rules.length),
  'a character-shaped box is not proven as a diagram frame');
for(const bad of [{width:0,height:240},{width:400.5,height:240},{width:5000,height:5000}])
  assert.equal(planOcrLineBands(lines,{...bad,inkAt}).size,0);
let calls=0;
assert.equal(planOcrLineBands(Array.from({length:1001},()=>lines[0]),{width:400,height:240,inkAt:()=>{calls++;return true;}}).size,0);
assert.equal(calls,0,'malformed/excessive input cannot consume the pixel budget');
canvas.width=canvas.height=0;
console.log('OCR line bands: source whitespace, four-corner gray frames, bounded work, unchanged CTC/text, independent ink and erasure ownership passed.');
