import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { localOcrWritingRules, extendIsolatedWritingRules, coincidentWritingRules } from '../src/features/pdf-to-word/core/ocr-rule-ownership.js';
import { fitOcrWritingPunctuation } from '../src/features/pdf-to-word/adapters/ocr-line-typography.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
const canvas=createCanvas(800,200),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,200);
ctx.font='60px "FangSong"';ctx.fontKerning='none';ctx.fillStyle='black';const words=[];
function draw(text,start){let x=start;for(const char of text){const m=ctx.measureText(char);ctx.fillText(char,x,100);words.push({text:char,x:x+m.width*.4,y:45,width:Math.max(3,m.width*.2),height:65,confidence:.99});x+=m.width;}}
draw('试用工资为',20);words.push({text:'_',x:400,y:45,width:15,height:65,confidence:.99});draw('元/月',530);
ctx.strokeStyle='black';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(330,105);ctx.lineTo(500,105);ctx.stroke();
const pixels=ctx.getImageData(0,0,800,200).data,line={text:'试用工资为_元/月',x:15,y:45,width:690,height:65,confidence:.99,words};const before=structuredClone(line);
const scene={number:1,width:800/3,height:200/3,sources:[],items:[],rules:[],risks:['image-page'],characters:0};
const result=prepareOcrScene({scene,result:{width:800,height:200,lines:[line],rules:[{axis:'h',at:105,from:330,to:500}]},pixels,width:800,height:200,preserveGeometry:true,measurementContext:ctx,fitTypography:createOcrTypography(createCanvas)});
const text=result.scene.items.find(item=>item.type==='text');assert(text.words?.length);assert.equal(text.font,'FangSong');
assert.equal(text.ocrOriginalText,line.text);assert.equal(text.text.replaceAll(' ',''),'试用工资为元/月');
assert.equal(text.words.map(w=>w.text).join(''),'试用工资为元/月');assert.equal(text.ocrRuleTokens.length,1);
assert.deepEqual(line,before,'recognizer tokens and CTC remain immutable');assert.equal(result.pixels[(105*800+400)*4],pixels[(105*800+400)*4],'the original writing line remains in the background');
const local=prepareOcrScene({scene,result:{width:800,height:200,lines:[line],rules:[]},pixels,width:800,height:200,preserveGeometry:true,measurementContext:ctx,fitTypography:createOcrTypography(createCanvas)});
const localText=local.scene.items.find(item=>item.type==='text');assert.equal(localText.font,'FangSong');
assert.equal(localText.ocrRuleTokens.length,1,'an isolated local stroke does not require the whole-page detector');
assert.equal(local.scene.rules.length,0,'local writing lines do not become table rules');
assert.equal(local.pixels[(105*800+400)*4],pixels[(105*800+400)*4]);
const implicitLine={...line,text:line.text.replace('_',''),words:line.words.filter(word=>word.text!=='_')};
const implicitBefore=structuredClone(implicitLine);
const implicit=prepareOcrScene({scene,result:{width:800,height:200,lines:[implicitLine],rules:[]},pixels,width:800,height:200,
  preserveGeometry:true,measurementContext:ctx,fitTypography:createOcrTypography(createCanvas)});
for(let x=330;x<500;x++)assert.equal(implicit.pixels[(105*800+x)*4],pixels[(105*800+x)*4],
  'an isolated baseline field survives when OCR omitted every underscore');
assert.equal(implicit.scene.rules.length,0);assert.deepEqual(implicitLine,implicitBefore);
const sample={text:'甲_乙',x:5,y:10,width:140,height:50,confidence:1,words:[{text:'甲',x:15,width:4},{text:'_',x:70,width:4},{text:'乙',x:125,width:4}]};
const stroke=(x,y)=>x>=45&&x<=100&&y===55;
assert.equal(localOcrWritingRules(sample,{width:160,height:100,inkAt:stroke,budget:{remaining:100000}}).length,1);
const tapered=(x,y)=>x>=45&&x<=105&&y===55||x>=50&&x<=105&&y===56;
const taperedRules=localOcrWritingRules(sample,{width:160,height:100,inkAt:tapered,budget:{remaining:100000}});
assert.equal(taperedRules.length,1,'nested raster cores of one isolated field do not become ambiguous anchors');
assert.equal(taperedRules[0].from,45);assert.equal(taperedRules[0].to,105);
assert.equal(localOcrWritingRules(sample,{width:160,height:100,
 inkAt:(x,y)=>x>=45&&x<=105&&y>=54&&y<=55||x>=45&&x<=75&&y>=56&&y<=57,budget:{remaining:100000}}).length,1,
 'thin interpolation rows with partial coverage belong to the same isolated field');
assert.equal(localOcrWritingRules(sample,{width:160,height:100,
 inkAt:(x,y)=>x>=45&&x<=105&&y>=53&&y<=55||x>=45&&x<=48&&y>=56&&y<=58,budget:{remaining:100000}}).length,1,
 'a short tapered end can exceed the dominant thin core without accepting a thick band');
assert.equal(localOcrWritingRules(sample,{width:160,height:100,inkAt:(x,y)=>stroke(x,y)||x===72&&y>=45&&y<=55,budget:{remaining:100000}}).length,0,'a character stem prevents reclassifying its crossbar');
assert.equal(localOcrWritingRules(sample,{width:160,height:100,inkAt:(x,y)=>stroke(x,y)||x===45&&y>=45&&y<=55,budget:{remaining:100000}}).length,0,'a grid junction is preserved as uncertain geometry');
assert.equal(localOcrWritingRules(sample,{width:160,height:100,inkAt:(x,y)=>stroke(x,y)||x===102&&y>=45&&y<=54,budget:{remaining:100000}}).length,1,'a neighbouring glyph across a real white gap is not a stroke junction');
const absent={text:'甲年月',x:5,y:10,width:140,height:50,confidence:1,
  words:[{text:'甲',x:15,width:4,confidence:1},{text:'年',x:115,width:4,confidence:1},{text:'月',x:135,width:4,confidence:1}]};
assert.equal(localOcrWritingRules(absent,{width:160,height:100,inkAt:stroke,budget:{remaining:100000}}).length,1);
assert.equal(localOcrWritingRules({...absent,words:absent.words.map(word=>word.text==='年'?{...word,x:70}:word)},
  {width:160,height:100,inkAt:stroke,budget:{remaining:100000}}).length,1,
  'a displaced year peak cannot turn a proven isolated horizontal field into the multi-stroke year glyph');
assert.equal(localOcrWritingRules(absent,{width:160,height:100,inkAt:(x,y)=>x>=45&&x<=100&&y===61,budget:{remaining:100000}}).length,1,
  'the source writing baseline may sit just below the detector box');
assert.equal(localOcrWritingRules(absent,{width:160,height:100,inkAt:(x,y)=>x>=45&&x<=100&&y>=55&&y<=58,budget:{remaining:100000}}).length,1,
  'four-pixel scan interpolation remains a thin isolated writing line');
assert.equal(localOcrWritingRules(absent,{width:160,height:100,inkAt:(x,y)=>x>=45&&x<=100&&y>=62&&y<=65,budget:{remaining:100000}}).length,1,
  'proof includes the white isolation margin below a thick scan line outside the detector');
assert.equal(localOcrWritingRules(absent,{width:160,height:100,inkAt:(x,y)=>x>=45&&x<=100&&y>=53&&y<=59,budget:{remaining:100000}}).length,0,
  'a thick band cannot become a field stroke');
assert.equal(localOcrWritingRules({...absent,text:'甲一年月',words:[absent.words[0],{text:'一',x:70,width:4,confidence:1},...absent.words.slice(1)]},
  {width:160,height:100,inkAt:stroke,budget:{remaining:100000}}).length,0,'a confident actual glyph cannot become a blank field');
const short={...sample,words:sample.words.map((word,index)=>({...word,y:10,height:50,confidence:.99,
  ...(index===1?{x:38}:{} )}))};
const shortInk=(x,y)=>x>=45&&x<=75&&y===55;
assert.equal(localOcrWritingRules(short,{width:160,height:100,inkAt:shortInk,budget:{remaining:100000}}).length,1,
  'a short baseline field retains a bounded underscore-peak drift');
for(const bad of [
  {...short,words:short.words.map((word,index)=>index===1?{...word,x:20}:word)},
  {...short,words:short.words.map((word,index)=>index===1?{...word,confidence:.5}:word)},
  {...short,text:'甲_二乙',words:[...short.words.slice(0,2),{text:'二',x:58,y:10,width:4,height:50,confidence:.99},short.words[2]]}
]) assert.equal(localOcrWritingRules(bad,{width:160,height:100,inkAt:shortInk,budget:{remaining:100000}}).length,0,
  'distant/weak peaks and a competing confident character cannot own a short line');
assert.equal(localOcrWritingRules(short,{width:160,height:100,inkAt:(x,y)=>x>=45&&x<=75&&y===35,budget:{remaining:100000}}).length,0,
  'a middle-height horizontal glyph stroke is not a baseline field');
{
 const c=createCanvas(200,150),paint=c.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,200,150);
 paint.fillStyle='black';paint.font='60px "SimSun"';paint.fillText('甲',20,100);
 paint.fillRect(110,105,31,1);paint.fillRect(108,106,36,1);
 const p=paint.getImageData(0,0,200,150).data;
 const raw={text:'甲_',x:15,y:45,width:130,height:65,confidence:1,
  words:[{text:'甲',x:46,y:45,width:8,height:65,confidence:1},{text:'_',x:100,y:45,width:10,height:65,confidence:1}]};
 const before=structuredClone(raw),result=createOcrTypography(createCanvas)({line:raw,pixels:p,width:200,height:150,sx:1,sy:1,
  tight:{x:15,y:45,width:130,height:65},inkAt:(x,y)=>p[(y*200+x)*4]<180&&Math.abs(y-105)>3,
  ruleInkAt:(x,y)=>p[(y*200+x)*4]<180,allowSymbolCorrection:true,protectedRules:[{axis:'h',at:105,from:110,to:140}]});
 assert.equal(result.text,'甲','a proven source line remains structural even without enough letters to infer the font');
 assert.equal(result.words,undefined,'partial ownership does not invent full-line word geometry');
 assert.equal(result.ocrRuleTokens.length,1);assert.deepEqual(raw,before);
 const weak={...raw,words:raw.words.map((word,i)=>i?{...word,confidence:.7}:word)};
 const weakOptions={line:weak,pixels:p,width:200,height:150,sx:1,sy:1,tight:{x:15,y:45,width:130,height:65},
  inkAt:(x,y)=>p[(y*200+x)*4]<180&&Math.abs(y-105)>3,ruleInkAt:(x,y)=>p[(y*200+x)*4]<180,allowSymbolCorrection:true};
 const weakFit=createOcrTypography(createCanvas);
 assert(!weakFit({...weakOptions,protectedRules:[{axis:'h',at:105,from:110,to:140}]})?.ocrRuleTokens,
  'a weak underscore and generic rule alone cannot authorize text removal');
 assert.equal(weakFit({...weakOptions,protectedRules:[{axis:'h',at:105,from:110,to:140,isolatedWriting:true}]}).text,'甲',
  'independently isolated local field evidence can own a weak underscore peak');
 const local=prepareOcrScene({scene:{number:1,width:200,height:150,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
  result:{width:200,height:150,lines:[raw],rules:[]},pixels:p,width:200,height:150,preserveGeometry:true,measurementContext:paint,
  fitTypography:createOcrTypography(createCanvas)});
 for(let x=108;x<=143;x++)assert.equal(local.pixels[(106*200+x)*4],0,
  'local writing-line ends share the existing extension proof and survive erasure');
 assert.equal(local.scene.rules.length,0,'the local extension never invents a semantic table boundary');
 c.width=c.height=0;
}
let calls=0;assert.equal(localOcrWritingRules(sample,{width:160,height:100,inkAt:()=>{calls++;return true;},budget:{remaining:0}}).length,0);assert.equal(calls,0);
const inkAt=(x,y)=>pixels[(y*800+x)*4]<150&&Math.abs(y-105)>3;
const fit=createOcrTypography(createCanvas),options={line,pixels,width:800,height:200,sx:3,sy:3,tight:{x:5,y:15,width:230,height:65/3},inkAt,allowSymbolCorrection:true};
assert.equal(fit(options),null,'missing pixels alone cannot authorize removing an underscore token');
assert.equal(fit({...options,protectedRules:[{axis:'h',at:50,from:330,to:500}]}),null,'an unrelated stroke cannot own the OCR token');
const detected={axis:'h',at:60,from:80,to:180},isolated=(x,y)=>x>=20&&x<=200&&y>=60&&y<=61;
const detectorBefore=structuredClone(detected);
assert.deepEqual(extendIsolatedWritingRules([detected],{width:240,height:100,inkAt:isolated,budget:{remaining:100000}}),
  [{...detected,from:20,to:200}], 'continuous thin source ink proves the omitted ends');
for(const ink of[(x,y)=>isolated(x,y)||x===80&&y>=50&&y<=70,(x,y)=>x>=20&&x<=200&&y>=57&&y<=63]){
  assert.deepEqual(extendIsolatedWritingRules([detected],{width:240,height:100,inkAt:ink,budget:{remaining:100000}}),[],
    'a grid junction or thick character stroke cannot authorize extending a line');
}
let probes=0;const smallBudget={remaining:12};
assert.deepEqual(extendIsolatedWritingRules([detected],{width:240,height:100,inkAt:(x,y)=>{probes++;return isolated(x,y);},budget:smallBudget}),[]);
assert(probes<=12&&smallBudget.remaining===0);assert.deepEqual(detected,detectorBefore);
const tailCanvas=createCanvas(260,120),tc=tailCanvas.getContext('2d');tc.fillStyle='white';tc.fillRect(0,0,260,120);
tc.fillStyle='black';tc.fillRect(20,30,20,30);tc.fillRect(45,64,166,2);
const tailPixels=tc.getImageData(0,0,260,120).data,tailRule={axis:'h',at:64,from:100,to:210};
const tail=prepareOcrScene({scene:{number:1,width:260,height:120,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
  result:{width:260,height:120,lines:[{text:'自',x:15,y:25,width:35,height:40,confidence:1}],rules:[tailRule]},
  pixels:tailPixels,width:260,height:120,preserveGeometry:true});
assert.equal(tail.pixels[(40*260+30)*4],255,'body ink is removed');
for(let x=45;x<=210;x++)assert.equal(tail.pixels[(64*260+x)*4],0,'the writing line keeps its independently proven beginning');
assert.equal(tail.scene.rules[0].from,100,'additional erase protection never moves semantic table boundaries');
tailCanvas.width=tailCanvas.height=0;
canvas.width=canvas.height=0;
{
 const raw=[{axis:'h',at:80,from:100,to:200},{axis:'h',at:80.5,from:99,to:202,isolatedWriting:true},
  {axis:'h',at:81,from:100,to:200},{axis:'h',at:80,from:199,to:280},{axis:'v',at:150,from:20,to:90}];
 const before=structuredClone(raw),merged=coincidentWritingRules(raw);
 assert.equal(merged.length,4,'only coincident horizontal evidence is coalesced');
 assert.deepEqual(merged[0],{axis:'h',at:80,from:99,to:202,isolatedWriting:true});
 assert.equal(merged[1].at,81,'a chain of half-pixel neighbours does not merge parallel strokes transitively');
 assert.deepEqual(raw,before);assert.deepEqual(coincidentWritingRules(null),[]);
 const bounded=Array.from({length:129},()=>({...raw[0]}));assert.equal(coincidentWritingRules(bounded),bounded);
 const thin=[{axis:'h',at:81.25,from:100,to:200},{axis:'h',at:80,from:100,to:200,isolatedWriting:true}];
 assert.equal(coincidentWritingRules(thin,{width:300,height:120,inkAt:(x,y)=>y>=80&&y<=82}).length,1,
  'two detector baselines need continuous source ink to identify one thick scan stroke');
 assert.equal(coincidentWritingRules(thin,{width:300,height:120,inkAt:(x,y)=>y===80||y===82}).length,2,
  'parallel strokes separated by white pixels remain different candidates');
 assert.equal(coincidentWritingRules(thin).length,2,'a larger detector offset requires actual source pixels');
 const lateProof=[{axis:'h',at:81,from:108,to:220},{axis:'h',at:81,from:104,to:220},
  {axis:'h',at:80.5,from:104,to:220,isolatedWriting:true}];
 const lateBefore=structuredClone(lateProof);
 assert.deepEqual(coincidentWritingRules(lateProof),[{...lateProof[0],from:104,isolatedWriting:true}],
  'a late isolated proof reconciles both earlier detector cores');
 assert.deepEqual(lateProof,lateBefore);
 assert.equal(coincidentWritingRules(lateProof.slice(0,2)).length,2,'detector spans alone cannot prove the reconciliation');
 assert.equal(coincidentWritingRules([...lateProof,{axis:'h',at:82,from:104,to:220}]).length,2,
  'reconciliation keeps the original baseline rather than growing a transitive chain');
 assert.equal(coincidentWritingRules([...lateProof,{axis:'h',at:81,from:102,to:220}]).length,2,
  'an independent proof cannot authorize ink outside its complete span');
 const contained=[{axis:'h',at:80,from:108,to:200},{axis:'h',at:80,from:100,to:200,isolatedWriting:true}];
 assert.equal(coincidentWritingRules(contained).length,1,'a proven complete local core may contain the shorter detector span');
 assert.equal(coincidentWritingRules(contained.map(r=>({...r,isolatedWriting:undefined}))).length,2,
  'generic detector geometry cannot grow a writing field');
 assert.equal(coincidentWritingRules([contained[0],{...contained[1],to:198}]).length,2,
  'overlapping cores with unproven exterior ends are not a complete isolated-span proof');
}
{
 const c=createCanvas(600,150),paint=c.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,600,150);
 paint.fillStyle='black';paint.font='60px "FangSong"';paint.fontKerning='none';
 for(const [letter,x]of [['甲',20],['年',176],['月',300],['日',430],['乙',510]])paint.fillText(letter,x,100);
 const rules=[{axis:'h',at:105,from:90,to:168,isolatedWriting:true},{axis:'h',at:105,from:238,to:292,isolatedWriting:true},
  {axis:'h',at:105,from:360,to:418,isolatedWriting:true}];
 for(const r of rules)paint.fillRect(r.from,105,r.to-r.from+1,2);
 const pixels=paint.getImageData(0,0,600,150).data;
 const ordered=[['甲',50],['_',115],['_',171],['年',206],['_',265],['月',330],['_',382],['_',417],['日',460],['乙',540]];
 const raw={text:ordered.map(([text])=>text).join(''),x:15,y:45,width:560,height:65,confidence:.99,
  words:ordered.map(([text,center])=>({text,x:center-3,y:45,width:6,height:65,confidence:.99}))};
 const before=structuredClone(raw),result=createOcrTypography(createCanvas)({line:raw,pixels,width:600,height:150,sx:1,sy:1,
  tight:{x:15,y:45,width:560,height:65},inkAt:(x,y)=>pixels[(y*600+x)*4]<180&&Math.abs(y-105)>3,
  ruleInkAt:(x,y)=>pixels[(y*600+x)*4]<180,allowSymbolCorrection:true,
  protectedRules:[...rules,...rules.map(r=>({...r,from:r.from-1,to:r.to+1,isolatedWriting:undefined}))]});
 assert.equal(result.font,'FangSong');assert.equal(result.words.map(w=>w.text).join(''),'甲年月日乙');
 assert.equal(result.ocrRuleTokens.length,5,'duplicate stroke evidence and an end peak do not block writing-field ownership');
 const year=result.words.find(w=>w.text==='年');let left=236,right=176,top=100,bottom=45;
 for(let y=45;y<110;y++)for(let x=176;x<236;x++)if(pixels[(y*600+x)*4]<180&&Math.abs(y-105)>3){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
 assert.deepEqual(year.rect,{x:left,y:top,width:right-left,height:bottom-top},
  'a displaced underscore peak cannot cut away the next glyph after its source stroke is proven');
 assert.deepEqual(raw,before);c.width=c.height=0;
}
function punctuationFixture({font='FangSong',size=60,symbol='。',symbolSize=size,zeroOwner=false}={}){
 const c=createCanvas(1600,260),paint=c.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,c.width,c.height);
 paint.fillStyle='black';paint.font=`${size}px "${font}"`;paint.fontKerning='none';let x=30;const words=[],ctc=[];const baseline=150;
 for(const char of '联系信息填写'){
  const m=paint.measureText(char);paint.fillText(char,x,baseline);const rect={x:(x-m.actualBoundingBoxLeft)/3,y:(baseline-m.actualBoundingBoxAscent)/3,
   width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3};
  words.push({text:char,rect,baseline:baseline/3,size:size/3,font,fontFamily:font,bold:false,confidence:1,ocrGlyphScore:1});
  ctc.push({text:char,x:x+m.width*.4,y:baseline-size,width:Math.max(4,m.width*.2),height:size*1.1,confidence:1});x+=m.width;
 }
 const rule={axis:'h',at:Math.round(baseline+size*.13),from:Math.ceil(x+8),to:1200};paint.fillRect(rule.from,rule.at,rule.to-rule.from+1,2);
 paint.font=`${symbolSize}px "${font}"`;const m=paint.measureText(symbol),origin=rule.to+12+m.actualBoundingBoxLeft;paint.fillText(symbol,origin,baseline);
 const markRect={x:(origin-m.actualBoundingBoxLeft)/3,y:(baseline-m.actualBoundingBoxAscent)/3,
  width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3};
 const rect={x:words[0].rect.x,y:Math.min(...words.map(w=>w.rect.y)),width:words.at(-1).rect.x+words.at(-1).rect.width-words[0].rect.x,height:Math.max(...words.map(w=>w.rect.height))};
 const text=[{id:'p1:ocr0',type:'text',sourceIds:['p1:ocr0'],text:'联系信息填写',rect,words,baseline:baseline/3,size:size/3,font,bold:false,ocr:true,ocrFontScore:1}];
 if(zeroOwner)text.push({id:'p1:ocr1',type:'text',sourceIds:['p1:ocr1'],text:'0',rect:markRect,ocr:true,confidence:.7});
 const pixels=paint.getImageData(0,0,c.width,c.height).data,options={rules:[rule],text,pixels,width:c.width,height:c.height,sx:3,sy:3,budget:{remaining:4_000_000}};
 return{canvas:c,paint,rule,markRect,options,ctc};
}
for(const font of ['FangSong','SimSun'])for(const size of [36,60,90]){
 const f=punctuationFixture({font,size}),before=structuredClone({rules:f.options.rules,text:f.options.text});
 const marks=fitOcrWritingPunctuation(createCanvas,f.options);assert.equal(marks.length,1,`${font}/${size}: isolated printed full stop`);
 assert.equal(marks[0].text,'。');assert(marks[0].confidence>=.93);assert.equal(marks[0].font,font);
 assert(Math.abs(marks[0].baseline-50)<1);assert.equal(marks[0].replaces,undefined);
 assert.deepEqual({rules:f.options.rules,text:f.options.text},before,'source marks do not mutate recognizer or table-rule data');
 assert(sceneLayoutBytes({items:[marks[0]],sources:[]})>=2048,'mark provenance consumes the existing scene budget');
 f.canvas.width=f.canvas.height=0;
}
for(const options of [{symbol:'0'},{symbol:'0',symbolSize:20},{symbol:'o'},{symbol:'O'},{symbol:'°'},{symbol:'·'}]){
 const f=punctuationFixture(options);assert.equal(fitOcrWritingPunctuation(createCanvas,f.options).length,0,`${options.symbol}/${options.symbolSize||60}: true symbols are not rewritten`);f.canvas.width=f.canvas.height=0;
}
for(const change of [
 f=>{f.options.text=[];},f=>{f.options.text[0].ocr=false;},f=>{f.options.text[0].ocrFontScore=.6;},
 f=>{f.options.rules=[];},f=>{f.options.budget.remaining=0;},f=>{f.options.protectedRects=[f.markRect];},
 f=>{f.options.rules.push({axis:'v',at:f.rule.to,from:f.rule.at-20,to:f.rule.at+20});},
 f=>{f.options.text.push({id:'owned',text:'。',rect:f.markRect,ocr:true});},
 f=>{f.options.text.push({id:'native',text:'0',rect:f.markRect,ocr:true,ocrNative:true,confidence:.7});},
 f=>{f.options.text.push({id:'certain',text:'0',rect:f.markRect,ocr:true,confidence:.999});},
]){
 const f=punctuationFixture();change(f);assert.equal(fitOcrWritingPunctuation(createCanvas,f.options).length,0,'missing/competing/native/source evidence remains untouched');f.canvas.width=f.canvas.height=0;
}
{
 const f=punctuationFixture({zeroOwner:true}),lines=[{id:0,text:'联系信息填写',x:25,y:90,width:f.rule.from-25,height:66,confidence:1,words:f.ctc},
  {id:1,text:'0',x:f.markRect.x*3-2,y:f.markRect.y*3-2,width:f.markRect.width*3+4,height:f.markRect.height*3+4,confidence:.7,
   words:[{text:'0',x:f.markRect.x*3+f.markRect.width*1.5-2,y:f.markRect.y*3-2,width:4,height:f.markRect.height*3+4,confidence:.76}]}];
 const raw=structuredClone(lines),fixtureScene={number:1,width:f.canvas.width/3,height:f.canvas.height/3,items:[],sources:[],rules:[],risks:['image-page'],characters:0};
 const converted=prepareOcrScene({scene:fixtureScene,result:{width:f.canvas.width,height:f.canvas.height,lines,rules:[f.rule]},pixels:f.options.pixels,width:f.canvas.width,height:f.canvas.height,
  preserveGeometry:true,measurementContext:f.paint,fitTypography:createOcrTypography(createCanvas)});
 const stop=converted.scene.items.find(t=>t.id==='p1:ocr1');assert.equal(stop.text,'。');assert.equal(stop.ocrOriginalText,'0');assert(!Object.hasOwn(stop,'ocrRecognitionConfidence'));
 assert.equal(stop.ocrCorrections[0].rule,'source-ink-writing-full-stop');assert.equal(converted.scene.sources.find(s=>s.id===stop.id).text,'。');assert.deepEqual(lines,raw);
 for(let x=f.rule.from;x<=f.rule.to;x++)assert.equal(converted.pixels[(f.rule.at*f.canvas.width+x)*4],0,'the original writing stroke survives recovery and erasure');
 f.canvas.width=f.canvas.height=0;
}
console.log('OCR writing lines: source-proven stroke/mark ownership, physical baseline/shape rivals, amount preservation, calibrated Chinese body, preserved rule pixels and immutable raw tokens passed.');
