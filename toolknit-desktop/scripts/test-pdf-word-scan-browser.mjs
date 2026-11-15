import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createScanFigureFixture} from './lib/pdf-word-scan-fixture.mjs';
import {desktopScanFixtureMarkup} from './lib/pdf-word-desktop-scan-fixture.mjs';
import {pdfjsAssets} from './lib/pdfjs-assets.mjs';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const out=path.resolve('tmp/pdf-word-scan-browser');await mkdir(out,{recursive:true});
const fixture=createScanFigureFixture({scale:300/72}),pdf=await PDFDocument.create(),page=pdf.addPage([720,960]);
const picture=await pdf.embedPng(fixture.canvas.toBuffer('image/png'));page.drawImage(picture,{x:0,y:0,width:720,height:960});
const input={name:'synthetic-scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
const server=await createServer({configFile:false,logLevel:'error',cacheDir:path.join(out,'vite'),optimizeDeps:{entries:[]},
  plugins:[pdfjsAssets(),{name:'desktop-scan-fixture',configureServer(server){server.middlewares.use('/__desktop_scan',(_,res)=>{res.setHeader('content-type','text/html');res.end(desktopScanFixtureMarkup());});}}],
  server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/tmp/**','**/dist/**','**/cli/**','**/src-tauri/target/**']}}});
await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],external=[];
try{
  const origin=server.resolvedUrls.local[0],context=await browser.newContext({viewport:{width:1380,height:900},acceptDownloads:true});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(origin).origin||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const p=await context.newPage();p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'__desktop_scan');
  await p.waitForFunction(()=>window.desktopScan);await p.evaluate(result=>window.scanOcrResult=result,fixture.result);
  const initialDownload=p.waitForEvent('download');await p.locator('#pdfWordFileInput').setInputFiles(input);
  const original=path.join(out,'original.docx');await(await initialDownload).saveAs(original);await p.locator('#pdfWordSuccessOverlay.visible').waitFor();
  const state=await p.evaluate(()=>({packets:scanPackets,figures:scanScenes.flatMap(s=>s.items.filter(i=>i.scanFigure)),raw:scanRaw[0]}));
  assert.deepEqual(state.packets,[{preserveScanFigures:true,refineScanText:true}]);assert.equal(state.figures.length,1);
  const zip=await JSZip.loadAsync(await readFile(original)),box=state.figures[0].scanFigure.pixelRect;
  const raw=await loadImage(Buffer.from(state.raw.split(',')[1],'base64')),source=createCanvas(box.width,box.height),target=createCanvas(box.width,box.height);
  source.getContext('2d').drawImage(raw,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
  let matched=false;
  for(const [name,file]of Object.entries(zip.files))if(/^word\/media\/.*\.png$/.test(name)){
    const image=await loadImage(await file.async('nodebuffer'));if(image.width!==box.width||image.height!==box.height)continue;
    target.getContext('2d').drawImage(image,0,0);assert.deepEqual(target.getContext('2d').getImageData(0,0,box.width,box.height).data,source.getContext('2d').getImageData(0,0,box.width,box.height).data);matched=true;
  }
  assert(matched,'real desktop converter publishes an exact original diagram crop');
  await p.locator('#pdfWordEditDocument').click();await p.locator('#wordDocumentOverlay.visible').waitFor();
  const key=state.figures[0].id;
  const targetKey=await p.evaluate(id=>{const nodes=[...document.querySelectorAll('#wordDocumentRegions [data-type="image"]')];return nodes.find(n=>n.dataset.key.includes(id))?.dataset.key;},key);
  assert(targetKey,'independent scan figure is selectable in the real document editor');
  await p.locator('#wordDocumentRegions [data-key='+JSON.stringify(targetKey)+']').evaluate(n=>n.click());
  await p.locator('#wordDocumentDelete').evaluate(n=>n.click());
  const deletedDownload=p.waitForEvent('download');await p.locator('#wordDocumentExport').evaluate(n=>n.click());await(await deletedDownload).saveAs(path.join(out,'deleted.docx'));
  await p.locator('#wordDocumentSuccessOverlay.visible').waitFor();
  assert(!await p.evaluate(id=>JSON.stringify(scanFinishes.at(-1)).includes('"id":"'+id+'"'),key));
  await p.locator('#wordDocumentSuccessOk').evaluate(n=>n.click());await p.locator('#wordDocumentUndo').evaluate(n=>n.click());
  const text=p.locator('#wordDocumentRegions [data-type="text"]').first();await text.evaluate(n=>n.click());await p.locator('#wordDocumentEdit').evaluate(n=>n.click());
  const value=await p.locator('#wordDocumentEditText').inputValue();await p.locator('#wordDocumentEditText').fill(value+'123');
  await p.locator('#wordDocumentEditForm').evaluate(n=>n.requestSubmit());await p.locator('#wordDocumentEditOverlay.visible').waitFor({state:'hidden'});
  const editedDownload=p.waitForEvent('download');await p.locator('#wordDocumentExport').evaluate(n=>n.click());await(await editedDownload).saveAs(path.join(out,'edited.docx'));
  await p.locator('#wordDocumentSuccessOverlay.visible').waitFor();
  const edited=await JSZip.loadAsync(await readFile(path.join(out,'edited.docx')));assert((await edited.file('word/document.xml').async('string')).includes('123'));
  await p.evaluate(()=>{desktopScan.editor.dispose();desktopScan.controller.dispose();});assert.equal(await p.evaluate(()=>scanWorkers.size),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,desktopOptions:state.packets,exactFigurePixels:true,realEditorDeleteUndoTextEditAndDocx:true,workersReleased:true,errors,external},null,2));
  console.log('Desktop scan workflow passed: real converter flags/Worker, exact diagram PNG, editor delete/undo/text edit, actual DOCX and release.');
}finally{await browser.close();await server.close();}
