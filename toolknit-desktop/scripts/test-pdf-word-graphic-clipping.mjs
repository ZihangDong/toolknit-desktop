import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, moveTo, clip, clipEvenOdd, endPath, fill, setFillingColor, concatTransformationMatrix, setGraphicsState } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { boundedGraphicClip } from '../src/features/pdf-to-word/core/graphic-clipping.js';
import { protectClippedRuleLayers } from '../src/features/pdf-to-word/core/graphic-text-layers.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const graphics = [{ name: 'constructPath', args: ['endPath'] }, { name: 'save' }, { name: 'setFillRGBColor', args: ['#ffffff'] },
  { name: 'constructPath', args: ['fill'] }, { name: 'restore' }, { name: 'restore' }];
assert.deepEqual(boundedGraphicClip(graphics, 0, true), { end: 5, painted: true });
assert.equal(boundedGraphicClip(graphics, 0, false), null);
assert.deepEqual(boundedGraphicClip([{ name: 'constructPath' }, { name: 'restore' }], 0, true), { end: 1, painted: false });
for (const name of ['showText', 'beginText', 'beginAnnotation', 'paintFormXObjectBegin', 'beginGroup', 'endMarkedContent', 'unknown']) {
  assert.equal(boundedGraphicClip([graphics[0], { name }, { name: 'restore' }], 0, true), null);
}
for (const state of [[['Font', ['face', 12]]], [['SMask', true]], [['BM', 'multiply']]]) {
  assert.equal(boundedGraphicClip([graphics[0], { name: 'setGState', args: [state] }, { name: 'restore' }], 0, true), null);
}
assert.deepEqual(boundedGraphicClip([graphics[0], { name: 'setGState', args: [[['BM', 'source-over'], ['SMask', false], ['ca', 1]]] },
  { name: 'shadingFill' }, { name: 'restore' }], 0, true), { end: 3, painted: true });
assert.equal(boundedGraphicClip(graphics.slice(0, -1), 0, true), null);
assert.equal(boundedGraphicClip([graphics[0], ...Array.from({ length: 2050 }, () => ({ name: 'dependency' })), { name: 'restore' }], 0, true), null);

const ruleFixture = () => ({number:1,maxLayers:2,
  operations:[{name:'beginText'},{name:'setTextMatrix',args:[1,0,0,1,0,0]},{name:'showText'},{name:'showText'},{name:'endText'}],
  sources:[2,3].map((index,i)=>({id:`p1:t${index}`,disposition:'editable',rect:{x:20+i*80,y:30,width:25,height:8}})),
  whiteClips:[{rect:{x:10,y:29,width:160,height:12}}],
  items:[20,100].map((x,i)=>({id:`rule${i}`,type:'image',sourceIds:[],decoration:true,thin:true,rect:{x,y:38.1,width:50,height:.4}}))});
const ruleInput=ruleFixture(),unchanged=structuredClone(ruleInput),cleanRules=protectClippedRuleLayers(ruleInput);
assert.equal(cleanRules.count,2);
assert(cleanRules.items.every(item=>JSON.stringify(item.decorationTextPaintIndexes)==='[2,3]'),
  'one independently reset text group can be removed from several rule crops');
assert.deepEqual(ruleInput,unchanged,'rule cleanup does not change text ownership or inputs');
assert(sceneLayoutBytes({items:cleanRules.items,sources:[]})>=4*16,'shared text-removal selections stay in the scene memory estimate');
for(const change of [d=>{d.maxLayers=0;},d=>{d.whiteClips=[];},d=>{d.sources[1].disposition='visible-image';},
  d=>{d.items.forEach(item=>item.sourceIds=['p1:t2']);},d=>{d.items.forEach(item=>item.thin=false);},
  d=>{d.operations[3].name='nextLineShowText';}]){
  const input=ruleFixture();change(input);assert.equal(protectClippedRuleLayers(input).count,0);
}
assert.equal(protectClippedRuleLayers({...ruleFixture(),maxLayers:1}).count,1,'rule cleanup shares the existing layer cap');
const partitionedRules=ruleFixture();
partitionedRules.sources=partitionedRules.sources.flatMap(source=>source.id==='p1:t2'?[0,1].map(i=>({...source,id:source.id+':part'+i,splitFrom:source.id})):source);
assert.equal(protectClippedRuleLayers(partitionedRules).count,2,'partitioned cell sources still point to the original complete paint group');
partitionedRules.sources[0].disposition='visible-image';
assert.equal(protectClippedRuleLayers(partitionedRules).count,0,'one uneditable child protects its whole original paint group');

const directory = 'tmp/pdf-word-graphic-clipping'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([360, 320]);
page.drawText('Editable heading', { x: 20, y: 285, size: 14, font });
page.drawText('COVERED', { x: 25, y: 220, size: 10, font });
page.drawText('Hole visible', { x: 140, y: 220, size: 10, font });
page.pushOperators(pushGraphicsState(), rectangle(20, 200, 90, 50), rectangle(260, 200, 80, 50), clipEvenOdd(), endPath(),
  setFillingColor(rgb(1, 1, 1)), rectangle(20, 200, 320, 50), fill(), popGraphicsState());
page.drawText('Editable row 123.45', { x: 20, y: 160, size: 12, font });
page.pushOperators(pushGraphicsState(), rectangle(20, 90, 100, 40), rectangle(240, 90, 100, 40), clipEvenOdd(), endPath(),
  setFillingColor(rgb(.2, .4, .7)), rectangle(0, 0, 360, 320), fill(), popGraphicsState());
page.drawText('Editable footer', { x: 20, y: 40, size: 12, font });
const second=pdf.addPage([360,320]);
second.drawText('Native outside figure', {x:20,y:280,size:12,font});
second.pushOperators(pushGraphicsState(),moveTo(0,0),rectangle(20,160,140,70),moveTo(340,300),clip(),endPath());
second.drawText('Inside clip', {x:30,y:190,size:12,font});
second.drawText('NOT VISIBLE', {x:200,y:190,size:12,font});
second.pushOperators(popGraphicsState());
second.drawText('Native after restore', {x:20,y:100,size:12,font});
const strips=pdf.addPage([360,320]);
strips.drawLine({start:{x:20,y:240},end:{x:290,y:240},thickness:.4});
strips.drawLine({start:{x:20,y:212.55},end:{x:290,y:212.55},thickness:.1});
strips.drawText('Covered', {x:21,y:215,size:6,font});
strips.pushOperators(pushGraphicsState(),moveTo(350,310),rectangle(20,200,30,40),rectangle(260,200,30,40),
  moveTo(0,0),clipEvenOdd(),endPath(),setFillingColor(rgb(1,1,1)),rectangle(0,0,360,320),fill(),popGraphicsState());
strips.drawText('Later native header gypq', {x:60,y:215,size:10,font});
strips.drawText('Unrelated body', {x:20,y:150,size:12,font});
const hole=pdf.addPage([360,320]);
hole.drawText('Covered outside', {x:25,y:210,size:8,font});
hole.drawText('Visible inside hole', {x:110,y:210,size:10,font});
hole.pushOperators(pushGraphicsState(),rectangle(20,190,300,60),rectangle(90,200,200,40),clipEvenOdd(),endPath(),
  setFillingColor(rgb(1,1,1)),rectangle(0,0,360,320),fill(),popGraphicsState());
hole.drawText('Outside clip', {x:20,y:100,size:12,font});
const textClip=pdf.addPage([360,320]);
textClip.pushOperators(pushGraphicsState(),rectangle(20,200,100,40),rectangle(240,200,100,40),clipEvenOdd(),endPath());
textClip.drawText('Visible', {x:30,y:215,size:10,font});
textClip.drawText('Hidden in gap', {x:140,y:215,size:10,font});
textClip.pushOperators(popGraphicsState());
const rotated=pdf.addPage([360,320]);
rotated.pushOperators(pushGraphicsState(),concatTransformationMatrix(0,1,-1,0,320,0),rectangle(20,20,30,40),rectangle(260,20,30,40),
  clip(),endPath(),setFillingColor(rgb(.2,.4,.7)),rectangle(0,0,360,320),fill(),popGraphicsState());
rotated.drawText('Native between rotated strips', {x:20,y:150,size:12,font});
const translucent=pdf.addPage([360,320]);
translucent.drawText('Still visible', {x:25,y:215,size:10,font});
const opacity=pdf.context.obj({Type:'ExtGState',ca:.4}),opacityKey=translucent.node.newExtGState('Opacity',pdf.context.register(opacity));
translucent.pushOperators(pushGraphicsState(),rectangle(20,200,100,40),rectangle(240,200,100,40),clipEvenOdd(),endPath(),
  setGraphicsState(opacityKey),setFillingColor(rgb(1,1,1)),rectangle(0,0,360,320),fill(),popGraphicsState());
// Independent graphics-only reference: the same original rules and clipping,
// with no text drawn in the first place.
const ruleReference=pdf.addPage([360,320]);
ruleReference.drawLine({start:{x:20,y:240},end:{x:290,y:240},thickness:.4});
ruleReference.drawLine({start:{x:20,y:212.55},end:{x:290,y:212.55},thickness:.1});
ruleReference.pushOperators(pushGraphicsState(),moveTo(350,310),rectangle(20,200,30,40),rectangle(260,200,30,40),
  moveTo(0,0),clipEvenOdd(),endPath(),setFillingColor(rgb(1,1,1)),rectangle(0,0,360,320),fill(),popGraphicsState());
const bytes = await pdf.save(); await writeFile(`${directory}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(!scene.rasterPage, 'bounded graphic-only compound clips must not rasterize unrelated text');
  for (const label of ['Editable heading', 'Editable row 123.45', 'Editable footer']) {
    assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable');
  }
  assert.equal(scene.sources.find(source => source.text === 'Hole visible').disposition,'editable',
    'disjoint graphics must not claim native text in the unpainted gap');
  assert(inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale).accepted);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const coveredSource = scene.sources.find(source => source.text === 'COVERED');
  assert.equal(coveredSource.disposition,'excluded-hidden','proven opaque white strips hide earlier text');
  assert(!scene.items.some(item=>item.sourceIds?.includes(coveredSource.id)));
  const rect = coveredSource.rect;
  const pixels = canvas.getContext('2d').getImageData(Math.floor(rect.x * plan.scale),
    Math.floor(rect.y * plan.scale), Math.ceil(rect.width * plan.scale), Math.ceil(rect.height * plan.scale)).data;
  for (let index = 0; index < pixels.length; index += 4) assert(Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 240);
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('COVERED')); assert(xml.includes('Editable'));
  const clippedPage=await document.getPage(2),clippedSnapshot=await snapshotPage(clippedPage,OPS,()=>{},operation.optionalContentConfig);
  await renderPage(clippedPage,canvas,operation);clippedSnapshot.fonts=snapshotFonts(clippedPage,clippedSnapshot.fontIds);
  const precise=prepareWordScene(clippedSnapshot,{measurementContext:createCanvas(1,1).getContext('2d')});
  assert(!precise.rasterPage,'move-only subpaths around a real rectangle do not force whole-page OCR');
  for(const label of ['Native outside figure','Inside clip','Native after restore'])assert.equal(precise.sources.find(s=>s.text===label).disposition,'editable');
  assert.equal(precise.sources.find(s=>s.text==='NOT VISIBLE').disposition,'excluded-hidden','empty path origins cannot enlarge the actual clip');
  const nativeOutput=await createWordBytes(inferDocument([precise],{preserveGeometry:true}),await collectPageAssets(precise,canvas,createCanvas),
    {preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
  const nativeXml=await(await JSZip.loadAsync(nativeOutput.bytes)).file('word/document.xml').async('string');
  assert(nativeXml.includes('Inside'));assert(!nativeXml.includes('NOT VISIBLE'));
  for (const [number, labels, hidden] of [
    [3,['Later native header gypq','Unrelated body'],'Covered'],
    [4,['Outside clip'],'Covered outside'],
    [6,['Native between rotated strips'],null],
  ]) {
    const original=await document.getPage(number),snap=await snapshotPage(original,OPS,()=>{},operation.optionalContentConfig);
    const render=await renderPage(original,canvas,operation);snap.fonts=snapshotFonts(original,snap.fontIds);
    const prepared=prepareWordScene(snap,{measurementContext:createCanvas(1,1).getContext('2d')});
    assert(!prepared.rasterPage);
    for(const label of labels)assert.equal(prepared.sources.find(source=>source.text===label).disposition,'editable',label);
    const ink=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    assert(inspectSceneInk(prepared,ink,canvas.width,canvas.height,render.scale).accepted);
    const assets=await collectPageAssets(prepared,canvas,createCanvas);
    const result=await createWordBytes(inferDocument([prepared],{preserveGeometry:true}),assets,
      {preserveGeometry:true,measurementContext:createCanvas(1,1).getContext('2d')});
    const xml=await(await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
    if(hidden)assert(!xml.includes(hidden),'covered text must not leak into the editable document');
    for(const label of labels)assert(xml.includes(label.split(' ')[0]));
    if(number===4){
      const source=prepared.sources.find(source=>source.text==='Visible inside hole');
      assert.equal(source.disposition,'visible-image','nested even-odd holes retain conservative final pixels');
      const image=prepared.items.find(item=>item.type==='image'&&item.sourceIds.includes(source.id));
      assert(image,'hole text remains owned by the final visible image');
    }
    if(number===6)assert.equal(prepared.items.filter(item=>item.type==='image').length,2,
      'quarter-turn disjoint clips retain two separate graphic regions');
    if(number===3){
      const rules=prepared.items.filter(item=>item.decorationTextPaintIndexes?.length);
      assert(rules.length,'rules beside the white clip use a verified text-free crop');
      for(const item of rules)assert.deepEqual(assets.find(asset=>asset.id===item.id).excludedPaintIndexes,item.decorationTextPaintIndexes);
      const reference=await document.getPage(8),referenceCanvas=createCanvas(1,1),referencePlan=await renderPage(reference,referenceCanvas,operation);
      let originalFringePixels=0;
      for(const item of rules){
        const asset=assets.find(asset=>asset.id===item.id),decoded=await loadImage(asset.bytes),crop=createCanvas(decoded.width,decoded.height);
        crop.getContext('2d').drawImage(decoded,0,0);
        const x=Math.floor(item.rect.x*referencePlan.scale),y=Math.floor(item.rect.y*referencePlan.scale);
        const expected=referenceCanvas.getContext('2d').getImageData(x,y,decoded.width,decoded.height).data;
        const actual=crop.getContext('2d').getImageData(0,0,decoded.width,decoded.height).data;
        assert.deepEqual(actual,expected,'cleaned rule pixels match a PDF which never contained the text');
        const before=canvas.getContext('2d').getImageData(x,y,decoded.width,decoded.height).data;
        for(let i=0;i<actual.length;i+=4)if(before[i]!==actual[i]||before[i+1]!==actual[i+1]||before[i+2]!==actual[i+2])originalFringePixels++;
        crop.width=crop.height=0;
      }
      assert(originalFringePixels>0,'the real fixture must actually contain text-fringe pixels in the original rule crop');
      referenceCanvas.width=referenceCanvas.height=0;reference.cleanup();
      const doc=inferDocument([prepared],{preserveGeometry:true});
      await assert.rejects(createWordBytes(doc,assets.map(asset=>({...asset,excludedPaintIndexes:undefined})),{preserveGeometry:true}),/pdf-to-word:image/);
      const first=rules[0];
      for(const bad of [{...first,sourceIds:['p3:fake']},{...first,thin:false},{...first,decorationTextPaintIndexes:[-1]},
        {...first,decorationTextPaintIndexes:[...first.decorationTextPaintIndexes,...first.decorationTextPaintIndexes]}]){
        await assert.rejects(collectPageAssets({...prepared,items:[bad]},canvas,createCanvas),/pdf-to-word:image/);
      }
    }
    original.cleanup();
  }
  const textPage=await document.getPage(5),textSnapshot=await snapshotPage(textPage,OPS,()=>{},operation.optionalContentConfig);
  await renderPage(textPage,canvas,operation);textSnapshot.fonts=snapshotFonts(textPage,textSnapshot.fontIds);
  const conservative=prepareWordScene(textSnapshot,{measurementContext:createCanvas(1,1).getContext('2d')});
  assert(conservative.rasterPage,'compound clips containing text are not graphics-only scopes');
  const alphaPage=await document.getPage(7),alphaSnapshot=await snapshotPage(alphaPage,OPS,()=>{},operation.optionalContentConfig);
  await renderPage(alphaPage,canvas,operation);alphaSnapshot.fonts=snapshotFonts(alphaPage,alphaSnapshot.fontIds);
  const alphaScene=prepareWordScene(alphaSnapshot,{measurementContext:createCanvas(1,1).getContext('2d')});
  assert.equal(alphaScene.sources.find(source=>source.text==='Still visible').disposition,'visible-image',
    'translucent white fills must preserve the composited earlier text');
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = 0;
} finally { await task.destroy(); }
console.log('Graphic-only clipping: bounded compound artwork, restored state, visible holes, hidden-text protection and real DOCX passed.');
