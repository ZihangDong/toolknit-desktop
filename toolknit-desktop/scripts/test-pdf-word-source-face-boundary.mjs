import assert from'node:assert/strict';
import{createCanvas}from'@napi-rs/canvas';import{Document,Packer,TextRun}from'docx';import JSZip from'jszip';
import{positionedPage}from'../src/features/pdf-to-word/adapters/docx-positioned.js';
import{positionedFrameCost,MAX_POSITIONED_FRAMES}from'../src/features/pdf-to-word/core/positioned-budget.js';
import{runOptions,textMetrics,originX,measureLineBox,positionedTextRuns}from'../src/features/pdf-to-word/adapters/text-layout.js';
import{PdfParagraph as Paragraph}from'../src/features/pdf-to-word/adapters/docx-paragraph.js';
const context=createCanvas(1,1).getContext('2d'),checks=[];
function check(name,work){work();checks.push({name,result:'ok'});}
function item(text,x,sourceFont='OriginalFace-One',extra={}){
 const i={id:text+':'+x,type:'text',sourceIds:[text+':'+x],text,font:'Times New Roman',sourceFont,fontFamily:'serif',size:12,bold:false,italic:false,color:'000000',raster:false,preciseInk:true,baseline:100,baselineX:x,...extra};
 const m=textMetrics(i,context);return{...i,advanceWidth:m.width,rect:{x:x-m.left,y:i.baseline-m.ascent,width:m.width+m.left,height:m.ascent+m.inkDescent}};
}
const textRuns=(line,assets,ctx)=>positionedTextRuns(line,ctx).map(r=>r.kind==='space'?new TextRun({text:' ',font:'Arial',size:2,characterSpacing:r.spacing,snapToGrid:false}):new TextRun({...r.options,text:r.item.text,characterSpacing:r.spacing,position:r.position}));
const line=items=>({id:'line',type:'line',items,baseline:100,rect:{x:100,y:80,width:120,height:25}});
function build(blocks){return positionedPage({width:595,height:842,rasterPage:false,header:[],footer:[],blocks},[],{textRuns,runOptions,originX,measureLineBox,measurementContext:context,empty:()=>new Paragraph({children:[]}),image:()=>{throw Error('Unexpected image');},table:()=>{throw Error('Unexpected table');}});}
const a=item('Alpha',100,'OriginalFace-One'),b=item('Beta',170,'OriginalFace-Two');
assert.deepEqual(runOptions(a),runOptions(b));
const blocks=[{type:'paragraph',lines:[line([a,b])]}],built=build(blocks);
check('Two arbitrary original faces with identical mapped runOptions reserve and emit two frames',()=>{assert.equal(positionedFrameCost(blocks),2);assert.equal(built.lines,2);});
const document=new Document({sections:[{children:built.children}]});const bytes=await Packer.toBuffer(document),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
const paragraphs=[...xml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);
const anchor=text=>{const p=paragraphs.find(p=>p.includes('>'+text+'<'));assert(p);return Number(p.match(/<w:framePr\b[^>]*\bw:x="(-?\d+)"/)[1]);};
check('Actual serialized frame x values retain independent source origins',()=>{assert.equal(anchor('Alpha'),2000);assert.equal(anchor('Beta'),3400);assert.equal(originX(a,context),100);assert.equal(originX(b,context),170);});
for(const [name,items,expected]of[
 ['Same original face/style remains one frame',[a,item('Beta',170,'OriginalFace-One')],1],
 ['Original identity falls back to item.font when sourceFont is absent',[{...a,sourceFont:undefined,font:'Times-Roman'},{...b,sourceFont:undefined,font:'TimesNewRomanPSMT'}],2],
 ['Existing raw-font budget key stays effective',[a,{...b,sourceFont:a.sourceFont,font:'Arial'}],2],
 ['Existing size key stays effective',[a,{...b,sourceFont:a.sourceFont,size:13}],2],
 ['Existing bold key stays effective',[a,{...b,sourceFont:a.sourceFont,bold:true}],2],
 ['Existing italic key stays effective',[a,{...b,sourceFont:a.sourceFont,italic:true}],2],
 ['Existing color key stays effective',[a,{...b,sourceFont:a.sourceFont,color:'123456'}],2],
 ['Existing baseline split stays effective',[a,{...b,sourceFont:a.sourceFont,baseline:101}],2]
])check(name,()=>{const blocks=[{type:'paragraph',lines:[line(items)]}];assert.equal(positionedFrameCost(blocks),expected);assert.equal(build(blocks).lines,expected);});
check('Existing image boundary resets font grouping',()=>assert.equal(positionedFrameCost([{lines:[line([a,{type:'image'},a])]}]),2));
check('Existing column/option-grid recursion preserves source-face reservations',()=>{
 assert.equal(positionedFrameCost([{type:'columns',columns:[{blocks}]},{type:'option-grid',cells:[{blocks}]}]),4);
});
const many=n=>[{type:'paragraph',lines:Array.from({length:n},(_,i)=>({...line([a]),id:'line-'+i}))}];
check('512 cap remains unchanged, 512 emits, 513 is rejected by the actual writer',()=>{
 assert.equal(MAX_POSITIONED_FRAMES,512);assert.equal(positionedFrameCost(many(512)),512);assert.equal(build(many(512)).lines,512);assert.equal(positionedFrameCost(many(513)),513);assert.throws(()=>build(many(513)),e=>e.code==='layout-quality');
});
console.log(JSON.stringify({syntheticChecks:checks.length,writerXTwips:[anchor('Alpha'),anchor('Beta')],cap:MAX_POSITIONED_FRAMES}));
